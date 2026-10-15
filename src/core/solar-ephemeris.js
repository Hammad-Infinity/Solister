import { OrbitGeometry } from "./orbit-geometry.js";

import { BodyShapes } from "../bodies/body-shapes.js";

import { MOONS, ALL_MOONS, PLANETS } from "../bodies/catalog.js";

import { UTC_START, UTC_END_EXCLUSIVE } from "../bodies/small-bodies/neptune-core.js";

export class SolarEphemerisLayer {
    constructor(options) {
        Object.assign(this, options);
        this.onStatus ||= () => {};
        this.available = false;
        this.generation = 0;
        this.serial = 0;
        this.meshes = [];
        this.paths = new Map;
        this.pendingPaths = [];
        this.worker = null;
        this.busy = false;
        this.snapshot = null;
        this.error = null;
        this.lastRequested = NaN;
        this.lastJob = "";
        this.lastMessage = "";
        this.applied = null;
        for (const [key, info] of Object.entries(MOONS)) {
            const parent = info.parent[0].toUpperCase() + info.parent.slice(1);
            this.bodyFacts[key] = {
                kind: `Moon of ${parent}`,
                name: info.name,
                tagline: "Physical-size, plain-color representation. NASA/JPL reference ellipsoids where available; no resolved terrain shape models.",
                stats: [ [ "Mean / approximate radius", `${info.radiusKm.toLocaleString()} km` ], [ "Parent", parent ], [ "Position model", info.source ], [ "Date controls", "1800-01-03 to 2199-12-28" ], [ "Accuracy", info.parent === "neptune" ? "Interpolation < 1 km relative to NEP098; not absolute accuracy" : "Older analytical model; NOT a 1 km guarantee. See analytical-validation.json." ], [ "Orbit display", "Closed instantaneous osculating ellipse; Trails show ephemeris history" ], [ "Appearance", "Representative color; no texture or size exaggeration" ] ]
            };
        }
        if (this.bodyFacts.moon) this.bodyFacts.moon.stats.push([ "Position model", "ELPMPP02 LLR; parent-relative trajectory" ]);
    }
    status(code, text = "") {
        const key = code + "|" + text;
        if (key === this.lastMessage) return;
        this.lastMessage = key;
        this.onStatus(code, text);
    }
    post(type, fields) {
        this.ensureWorker();
        const id = ++this.serial;
        this.job = {
            id: id,
            generation: this.generation
        };
        this.busy = true;
        this.lastJob = type;
        this.worker.postMessage({
            id: id,
            type: type,
            ...fields
        });
    }
    rebuild() {
        this.generation++;
        this.available = false;
        this.snapshot = null;
        this.applied = null;
        this.lastRequested = NaN;
        this.paths.clear();
        this.pendingPaths = [];
        this.meshes = [];
        this.ensureWorker();
        this.solarSystem.rotation.set(0, 0, 0);
        const T = this.THREE;
        for (const [key, info] of Object.entries(MOONS)) {
            const radius = this.km2u(BodyShapes.maxRadiusKm(key, info.radiusKm));
            const geometry = BodyShapes.createGeometry(T, key, radius, 24, 12);
            const material = new T.MeshStandardMaterial({
                color: info.color,
                roughness: 1,
                metalness: 0,
                emissive: 0
            });
            applySurfaceBrdf(material, key, T);
            const parent = this.objectRegistry[info.parent];
            if (this.installShadow && parent) this.installShadow(material, parent, false);
            const mesh = new T.Mesh(geometry, material);
            mesh.userData = {
                planetKey: key,
                planetName: info.name,
                parentKey: info.parent,
                isEphemerisMoon: true,
                radiusKm: info.radiusKm,
                minZoomDistance: radius * 1.5,
                maxZoomDistance: this.km2u(info.aKm * 4),
                lod: 0
            };
            mesh.visible = false;
            this.solarSystem.add(mesh);
            this.objectRegistry[key] = mesh;
            this.meshes.push(mesh);
        }
    }
    sceneVector(p) {
        return [ this.km2u(p[0]), this.km2u(p[2]), -this.km2u(p[1]) ];
    }
    _placePlanets(s) {
        for (const key of PLANETS) {
            const mesh = this.objectRegistry[key];
            if (mesh) mesh.position.set(...this.sceneVector(s.positions[key]));
        }
    }
    _placeMoons(s) {
        for (const [key, info] of Object.entries(ALL_MOONS)) {
            const mesh = this.objectRegistry[key], parent = this.objectRegistry[info.parent];
            if (mesh && parent) {
                mesh.position.set(...this.sceneVector(s.relative[key])).add(parent.position);
                mesh.visible = true;
            }
        }
    }
    _updateOrbitMatrices(s) {
        for (const line of this.getOrbitLines()) {
            const key = line.userData.realisticOrbitKey, o = s.orbits[key], body = this.objectRegistry[key];
            if (!o || !body) continue;
            if (!line.geometry.userData.bodyAnchoredOrbit) {
                line.geometry.dispose();
                line.geometry = OrbitGeometry.createAnchoredOrbitGeometry(this.THREE, OrbitGeometry.ORBIT_LINE_SEGMENTS);
            }
            OrbitGeometry.setAnchoredOrbitMatrix(line, this.sceneVector(o.U), this.sceneVector(o.V), Math.cos(o.E), Math.sin(o.E), body.position);
        }
    }
    _updateMoonOrbits(s) {
        if (!s.velocities) return;
        for (const [key, info] of Object.entries(ALL_MOONS)) {
            const body = this.objectRegistry[key];
            if (!body) continue;
            const ellipse = OrbitGeometry.ellipseFromState(s.relative[key], s.velocities[key], OrbitGeometry.PARENT_GM[info.parent] + info.gm);
            if (!ellipse) {
                const old = this.paths.get(key);
                if (old?.kind === "osculating") {
                    old.valid = false;
                    old.line.visible = false;
                }
                continue;
            }
            let path = this.paths.get(key);
            if (path?.kind !== "osculating") {
                if (path) {
                    path.line.removeFromParent();
                    path.line.geometry.dispose();
                    path.line.material.dispose();
                }
                const T = this.THREE, line = new T.LineLoop(OrbitGeometry.createAnchoredOrbitGeometry(T, OrbitGeometry.ORBIT_LINE_SEGMENTS), new T.LineBasicMaterial({
                    color: 11647945,
                    transparent: true,
                    opacity: .3,
                    depthWrite: false
                }));
                line.raycast = () => {};
                line.visible = false;
                line.userData.trajectoryKey = key;
                line.userData.orbitModel = "instantaneous osculating ellipse";
                this.solarSystem.add(line);
                path = {
                    line: line,
                    kind: "osculating",
                    valid: true,
                    et: s.et
                };
                this.paths.set(key, path);
            }
            const axes = OrbitGeometry.sceneAxes(ellipse, this.km2u);
            OrbitGeometry.setAnchoredOrbitMatrix(path.line, axes.U, axes.V, ellipse.cosE, ellipse.sinE, body.position);
            path.et = s.et;
            path.valid = true;
        }
    }
    applySnapshot() {
        const s = this.snapshot;
        if (!s || s === this.applied) return;
        this._placePlanets(s);
        this._placeMoons(s);
        this._updateOrbitMatrices(s);
        this._updateMoonOrbits(s);
        this.applied = s;
    }
    setPath(result) {
        if (this.paths.get(result.key)?.kind === "osculating") return;
        const T = this.THREE, previous = this.paths.get(result.key);
        if (previous) {
            this.solarSystem.remove(previous.line);
            previous.line.geometry.dispose();
            previous.line.material.dispose();
        }
        const coords = new Float32Array(result.points.length);
        for (let i = 0; i < coords.length; i += 3) {
            coords[i] = this.km2u(result.points[i]);
            coords[i + 1] = this.km2u(result.points[i + 2]);
            coords[i + 2] = -this.km2u(result.points[i + 1]);
        }
        const geometry = new T.BufferGeometry;
        geometry.setAttribute("position", new T.BufferAttribute(coords, 3));
        const material = new T.LineBasicMaterial({
            color: 11647945,
            transparent: true,
            opacity: .3,
            depthWrite: false
        });
        const line = new T.Line(geometry, material);
        line.raycast = () => {};
        line.visible = false;
        line.userData.trajectoryKey = result.key;
        this.solarSystem.add(line);
        this.paths.set(result.key, {
            ...result,
            line: line,
            points: undefined,
            builtAt: performance.now()
        });
    }
    update(ms, {focusedKey: focusedKey = null, camera: camera = null, showOrbits: showOrbits = true, ttMinusUtcSeconds: ttMinusUtcSeconds} = {}) {
        if (!Number.isFinite(ms) || ms < UTC_START || ms >= UTC_END_EXCLUSIVE) {
            this.available = false;
            this.solarSystem.visible = false;
            this.status("range", "Date range: 1800-01-03 through 2199-12-28. System hidden outside local coverage.");
            return false;
        }
        if (this.error) {
            this.available = false;
            this.solarSystem.visible = false;
            this.status("error", "Local ephemeris failed. Check the browser console and local files; reload after fixing.");
            return false;
        }
        this.available = !!this.snapshot;
        this.solarSystem.visible = this.available;
        this.applySnapshot();
        const parent = ALL_MOONS[focusedKey]?.parent || focusedKey;
        const overview = !parent || parent === "sun" || parent === "solarsystem";
        const wanted = showOrbits ? Object.values(ALL_MOONS).filter(x => overview || x.parent === parent).map(x => x.key) : [];
        this.pendingPaths = wanted.filter(key => {
            const p = this.paths.get(key);
            if (p?.kind === "osculating") return false;
            return !p || performance.now() - p.builtAt > 750 && Math.abs((this.snapshot?.et || 0) - p.et) > ALL_MOONS[key].periodDays * 86400 / 100;
        }).sort((a, b) => (this.paths.get(a)?.builtAt || 0) - (this.paths.get(b)?.builtAt || 0));
        for (const [key, p] of this.paths) {
            p.line.visible = this.available && wanted.includes(key) && p.valid !== false;
            const mesh = this.objectRegistry[ALL_MOONS[key].parent];
            if (mesh && p.kind !== "osculating") p.line.position.copy(mesh.position);
        }
        if (!this.busy) {
            if (this.snapshot && this.pendingPaths.length && (this.lastJob !== "trajectory" || this.lastRequested === ms)) this.post("trajectory", {
                key: this.pendingPaths[0],
                et: this.snapshot.et
            }); else if (this.lastRequested !== ms) {
                this.lastRequested = ms;
                this.post("snapshot", {
                    ms: ms,
                    ttMinusUtcSeconds: ttMinusUtcSeconds
                });
            }
        }
        if (camera && this.available) {
            const pixelScale = (globalThis.innerHeight || 900) / (2 * Math.tan(camera.fov * Math.PI / 360));
            for (const mesh of this.meshes) {
                const radius = mesh.geometry.parameters.radius;
                const worldPosition = mesh.getWorldPosition(this._lodPosition || (this._lodPosition = new this.THREE.Vector3));
                const distance = camera.position.distanceTo(worldPosition);
                const pixels = radius / Math.max(radius, distance) * pixelScale, old = mesh.userData.lod;
                const lod = pixels > (old === 2 ? 24 : 36) ? 2 : pixels > (old >= 1 ? 4 : 6) ? 1 : 0;
                if (lod !== old) {
                    mesh.geometry.dispose();
                    const n = [ 24, 48, 96 ][lod];
                    mesh.geometry = BodyShapes.createGeometry(this.THREE, mesh.userData.planetKey, radius, n, n / 2);
                    mesh.userData.lod = lod;
                }
            }
        }
        if (!this.available) this.status("loading", "Loading local ephemerides and calculating a coherent system snapshot…"); else this.reportReadyStatus(ms);
        return this.available;
    }
    reportReadyStatus(ms) {
        const lag = Math.abs(ms - this.snapshot.ms), stamp = new Date(this.snapshot.ms).toISOString().replace(".000Z", "Z");
        this.status("ready", lag > 1e3 ? `Calculating… displayed epoch ${stamp}. No extrapolation. Analytical accuracy varies; Neptune interpolation < 1 km.` : "Local ephemerides ready. Analytical accuracy varies; Neptune interpolation < 1 km. Moon paths appear when focusing a moon or its parent.");
    }
    dispose() {
        this.worker?.terminate();
        this.worker = null;
        this.busy = false;
    }
}
