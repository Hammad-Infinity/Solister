import { outsideData, extrapolateTable } from "../../sim/approximate-orbits.js";

import { OrbitGeometry } from "../../core/orbit-geometry.js";

import { BodyShapes } from "../body-shapes.js";

import { EXTRA_BODIES } from "../catalog.js";

export const EXTRA_START = Date.UTC(2020, 0, 1), EXTRA_END = Date.UTC(2041, 0, 1);

import { UTC_START, UTC_END_EXCLUSIVE } from "./neptune-core.js";

export const PLUTO_START = UTC_START, PLUTO_END = UTC_END_EXCLUSIVE;

export function sampleState(d, et, out) {
    if (!Number.isFinite(et) || !(d.step > 0) || d.count < 2) return false;
    const x = (et - d.startEt) / d.step;
    if (x < 0 || x > d.count - 1) return false;
    const i = Math.min(d.count - 2, Math.floor(x)), u = x - i, u2 = u * u, u3 = u2 * u, a = i * 6, b = a + 6, v = d.values;
    for (let k = 0; k < 3; k++) {
        out[k] = (2 * u3 - 3 * u2 + 1) * v[a + k] + (u3 - 2 * u2 + u) * d.step * v[a + k + 3] + (-2 * u3 + 3 * u2) * v[b + k] + (u3 - u2) * d.step * v[b + k + 3];
        if (out.length >= 6) out[k + 3] = ((6 * u2 - 6 * u) * v[a + k] + (-6 * u2 + 6 * u) * v[b + k]) / d.step + (3 * u2 - 4 * u + 1) * v[a + k + 3] + (3 * u2 - 2 * u) * v[b + k + 3];
    }
    return true;
}

export class ExtraBodies {
    constructor(options) {
        Object.assign(this, options);
        this.meshes = [];
        this.entries = new Map;
        this.data = {};
        this.loading = null;
        this.error = "";
        this.sample = new Float64Array(6);
        this.lastNotice = "";
        for (const [key, p] of Object.entries(EXTRA_BODIES)) this.bodyFacts[key] = {
            name: p.name,
            kind: key === "pluto" ? "Dwarf Planet" : "Moon of " + p.parentName,
            tagline: "Physical-size reference ellipsoid (not a terrain model); bundled JPL positions within coverage; approximate endpoint conics outside 1800–2199 when available.",
            stats: [ [ "Mean / approximate radius", p.radiusKm + " km" ], [ "Parent", p.parentName ], [ "Local date coverage", key === "pluto" ? "1800-01-03 through 2199-12-28 UTC (shared date controls)" : "2020-01-01 through 2040-12-31 UTC" ], [ "Position source", key === "pluto" ? "JPL PLU060/DE440 body centre; DE441 plus periodic body offset for boundary days" : p.source ], [ "Interpolation spot-check maximum", key === "pluto" ? "Daily table: 5.13 km in 15 checked midpoints; not a global error bound. Original fine table is preferred where available." : p.validationKm + " km relative to the source" ], [ "Accuracy note", key === "pluto" ? "Boundary padding uses a short body-offset model over JPL barycentre data, including the final UTC/TDB endpoint margin. See bundled provenance." : "Not absolute observational accuracy. Parent-planet accuracy also applies." ], [ "Path coverage", key === "pluto" ? "Orbit: closed instantaneous osculating ellipse. Trail: body-centre history where available; earlier JPL barycentre history back to 1530" : "Orbits: instantaneous closed osculating ellipse. Trails: sampled ephemeris history" ] ]
        };
        this.notice = document.createElement("p");
        this.notice.className = "extra-ephemeris-status";
        this.notice.style.cssText = "font-size:11px;line-height:1.4;color:#bbb;margin:6px 12px";
        this.notice.hidden = true;
        document.getElementById("solar-accuracy-status")?.after(this.notice);
    }
    load() {
        if (this.loading) return;
        const read = async path => {
            const response = await fetch(new URL(path, import.meta.url));
            if (!response.ok) throw Error(path + ": " + response.status);
            const d = await response.json();
            d.values = new Float64Array(d.values);
            return d;
        };
        this.stateLoading = read("../../../data/pluto/pluto-state-1800-2199.json").then(d => {
            this.plutoState = d;
            this.stateError = "";
        }).catch(e => {
            this.stateError = "Extended Pluto positions unavailable: " + e.message;
            console.warn(this.stateError);
        });
        this.historyLoading = read("../../../data/pluto/pluto-barycenter-history-1530-2201.json").then(d => {
            this.plutoHistory = d;
            this.historyError = "";
        }).catch(e => {
            this.historyError = "Early Pluto trail history unavailable: " + e.message;
            console.warn(this.historyError);
        });
        this.localErrors = {};
        this.loading = Promise.all(Object.keys(EXTRA_BODIES).map(async key => {
            try {
                this.data[key] = await read("../../../data/extra-bodies/extra-" + key + ".json");
            } catch (e) {
                this.localErrors[key] = String(e.message);
                console.warn("Local extra-body table unavailable", key, e);
            }
        }));
    }
    samplePluto(et, out, history = false) {
        if (this.data.pluto && sampleState(this.data.pluto, et, out)) return true;
        if (this.plutoState && sampleState(this.plutoState, et, out)) return true;
        return !!(history && this.plutoHistory && sampleState(this.plutoHistory, et, out));
    }
    plutoPositionSource(et) {
        const d = this.data.pluto;
        if (d && et >= d.startEt && et <= d.startEt + (d.count - 1) * d.step) return "Original fine Pluto body-centre ephemeris";
        const p = this.plutoState;
        if (p && (et < p.trustedStartEt || et > p.trustedEndEt)) return "Short boundary approximation: JPL barycentre plus phase-matched body offset";
        return "Daily JPL Pluto body-centre ephemeris";
    }
    rebuild() {
        for (const [key, e] of this.entries) {
            if (e.trail) {
                e.trail.mesh.removeFromParent();
                e.trail.mesh.geometry.dispose();
                e.trail.mesh.material.dispose();
                e.trail.halo?.material.dispose();
                this.getTrailLayer().entries.delete(key);
            }
            if (e.orbit) {
                e.orbit.removeFromParent();
                e.orbit.geometry.dispose();
                e.orbit.material.dispose();
            }
        }
        this.entries.clear();
        this.meshes = [];
        this.load();
        const T = this.THREE;
        for (const [key, p] of Object.entries(EXTRA_BODIES)) {
            const radius = this.km2u(BodyShapes.maxRadiusKm(key, p.radiusKm)), mesh = new T.Mesh(BodyShapes.createGeometry(T, key, radius, 256, 128), (() => {
                const mat = new T.MeshStandardMaterial({
                    color: p.color,
                    roughness: 1,
                    metalness: 0
                });
                applySurfaceBrdf(mat, key, T);
                return mat;
            })());
            mesh.userData = {
                planetKey: key,
                planetName: p.name,
                parentKey: p.parent,
                extraEphemeris: true,
                isEphemerisMoon: key !== "pluto",
                radiusKm: p.radiusKm,
                minZoomDistance: radius * 1.65,
                maxZoomDistance: this.km2u(p.aKm * 3)
            };
            mesh.visible = false;
            this.solarSystem.add(mesh);
            this.objectRegistry[key] = mesh;
            this.meshes.push(mesh);
            if (key === "titan") {
                const atmosphereProfile = globalThis.PLANET_ATMOSPHERE_PROFILES?.titan;
                globalThis.createPlanetAtmosphere?.(key, mesh, atmosphereProfile);
            }
            let label = null;
            if (false && this.CSS2DObject && this.labelObjects) {
                const el = document.createElement("div");
                el.className = "planet-label";
                el.textContent = p.name;
                label = new this.CSS2DObject(el);
                label.position.y = radius * 1.65;
                mesh.add(label);
                this.labelObjects.push(label);
            }
            this.entries.set(key, {
                mesh: mesh,
                label: label,
                curve: null,
                epoch: NaN,
                orbit: null,
                trail: null
            });
        }
    }
    inCoverage(ms, key = "pluto") {
        if (outsideData(ms)) return true;
        return key === "pluto" ? ms >= PLUTO_START && ms < PLUTO_END : ms >= EXTRA_START && ms < EXTRA_END;
    }
    limitRate(rate, dt, key) {
        const p = EXTRA_BODIES[key];
        return p ? Math.min(rate, p.periodDays * 86400 * .04 / (2 * Math.PI * Math.max(dt, 1 / 240))) : rate;
    }
    sampleExtended(key, et, out) {
        if (!this.approximate) return key === "pluto" ? this.samplePluto(et, out) : !!this.data[key] && sampleState(this.data[key], et, out);
        const d = key === "pluto" ? this.plutoState : this.data[key];
        if (!d) return false;
        const mu = OrbitGeometry.PARENT_GM[EXTRA_BODIES[key].parent] + ({
            charon: 105.88,
            himalia: .15155,
            phoebe: .5532
        }[key] || 0);
        return extrapolateTable(d, et, d.startEt, d.startEt + (d.count - 1) * d.step, sampleState, mu, out);
    }
    update(state) {
        const {ms: ms, available: available, et: et, showLabels: showLabels} = state;
        this.approximate = outsideData(ms);
        const localRange = ms >= EXTRA_START && ms < EXTRA_END;
        const messages = [];
        if (this.approximate) messages.push("APPROXIMATE: Pluto and additional moons use fixed endpoint conics when usable data is loaded. Not reliable predictions; historical trails unavailable."); else {
            if (!this.inCoverage(ms, "pluto")) messages.push("Pluto coverage: 1800–2199."); else if (!this.plutoState) messages.push(this.stateError || "Loading Pluto positions for 1800–2199…");
            if (!this.plutoHistory) messages.push(this.historyError || "Loading early Pluto trail history…");
            if (!localRange) messages.push("Charon, Himalia and Phoebe retain their 2020–2040 coverage."); else if ([ "charon", "himalia", "phoebe" ].some(k => !this.data[k])) messages.push("Additional moons: " + ([ "charon", "himalia", "phoebe" ].some(k => this.localErrors?.[k]) ? "one or more local tables could not load." : "loading local tables…"));
        }
        const text = messages.join(" ");
        if (text !== this.lastNotice) {
            this.lastNotice = text;
            this.notice.textContent = text;
            this.notice.hidden = !text;
        }
        for (const [key, e] of this.entries) {
            const p = EXTRA_BODIES[key], parent = this.objectRegistry[p.parent], d = this.data[key];
            const covered = this.inCoverage(ms, key), sampled = this.sampleExtended(key, et, this.sample);
            const visible = available && covered && !!parent && (p.parent !== "pluto" || parent.visible) && sampled;
            e.mesh.userData.approximate = this.approximate;
            e.mesh.visible = visible;
            if (e.label) e.label.visible = visible && showLabels;
            if (visible) e.mesh.position.set(this.km2u(this.sample[0]), this.km2u(this.sample[2]), -this.km2u(this.sample[1])).add(parent.position);
            if (key === "pluto" && visible) e.mesh.userData.positionSource = this.plutoPositionSource(et);
            const item = document.querySelector('#body-select [data-key="' + key + '"]');
            if (item) {
                item.hidden = false;
                item.setAttribute("aria-disabled", String(!visible));
                item.title = key === "pluto" ? visible ? this.plutoPositionSource(et) : this.stateError || "Available during 1800–2199 once its data is loaded" : visible ? "Local JPL positions; coverage 2020–2040" : "Available during 2020–2040 once local data is loaded";
            }
            if (this.approximate) {
                e.mesh.userData.positionSource = "Approximate endpoint two-body orbit";
                if (item) item.title = visible ? "APPROXIMATE endpoint two-body orbit" : "Approximation unavailable: waiting for data or unusable endpoint state";
            }
            if (!visible) {
                if (e.trail) e.trail.mesh.visible = false;
                if (e.orbit) e.orbit.visible = false;
            }
        }
    }
    makeCurve(key, et, length) {
        const d = key === "pluto" && (this.plutoHistory || this.plutoState) || this.data[key], p = EXTRA_BODIES[key], duration = p.periodDays * 86400;
        const historyFraction = key === "pluto" && (this.plutoHistory || this.plutoState) ? Math.min(1.05, Math.max(.85, length + .2)) : Math.max(length, .5) * 1.05;
        const start = Math.max(d.startEt, et - duration * historyFraction), end = Math.min(d.startEt + (d.count - 1) * d.step - 1, et + Math.min(duration * .03, 30 * 86400));
        const n = 1280, points = new Float64Array(n * 3), times = new Float64Array(n), lengths = new Float64Array(n);
        let previous = null;
        for (let i = 0; i < n; i++) {
            const t = start + (end - start) * i / (n - 1);
            if (key === "pluto") this.samplePluto(t, this.sample, true); else sampleState(d, t, this.sample);
            const pos = [ this.km2u(this.sample[0]), this.km2u(this.sample[2]), -this.km2u(this.sample[1]) ];
            points.set(pos, i * 3);
            times[i] = t;
            if (previous) lengths[i] = lengths[i - 1] + Math.hypot(...pos.map((v, k) => v - previous[k]));
            previous = pos;
        }
        return {
            points: points,
            times: times,
            lengths: lengths,
            period: duration,
            start: start,
            end: end,
            extended: key === "pluto" && !!(this.plutoState || this.plutoHistory),
            sources: key === "pluto" ? [ this.data.pluto, this.plutoState, this.plutoHistory ] : null
        };
    }
    renderPaths({et: et, enabled: enabled, style: style, settings: settings, trailLayer: trailLayer, focusedKey: focusedKey}) {
        for (const [key, e] of this.entries) {
            const p = EXTRA_BODIES[key], parent = this.objectRegistry[p.parent];
            const eligible = !(this.approximate && style === "trails") && e.mesh.visible && enabled && (key === "pluto" || !focusedKey || focusedKey === "sun" || focusedKey === "solarsystem" || focusedKey === key || focusedKey === p.parent);
            if (e.trail) e.trail.mesh.visible = eligible && style === "trails";
            if (e.orbit) e.orbit.visible = eligible && style === "orbits";
            if (!eligible) continue;
            if (style === "orbits") {
                this._showMoonOrbit(key, e, p, et);
                continue;
            }
            const length = style === "orbits" ? 1 : settings.length || .65;
            this._ensureCurve(key, e, p, et, length);
            if (style !== "trails") continue;
            this._showTrail(key, e, p, parent, et, length, trailLayer, settings);
            if (e.orbit) e.orbit.visible = false;
        }
    }
    _ensureCurve(key, e, p, et, length) {
        if (!e.curve || key === "pluto" && (!e.curve.sources || e.curve.sources[0] !== this.data.pluto || e.curve.sources[1] !== this.plutoState || e.curve.sources[2] !== this.plutoHistory) || Math.abs(et - e.epoch) > Math.min(p.periodDays * 86400 / 1e3, 86400) || e.length !== length) {
            e.curve = this.makeCurve(key, et, length);
            e.epoch = et;
            e.length = length;
            if (e.orbit && !e.orbit.geometry.userData.bodyAnchoredOrbit) {
                e.orbit.geometry.dispose();
                e.orbit.geometry = (new this.THREE.BufferGeometry).setAttribute("position", new this.THREE.BufferAttribute(Float32Array.from(e.curve.points), 3));
            }
        }
    }
    _showMoonOrbit(key, e, p, et) {
        const data = this.data[key];
        if (!this.sampleExtended(key, et, this.sample)) {
            if (e.orbit) e.orbit.visible = false;
            return;
        }
        const satelliteGM = {
            charon: 105.88,
            himalia: .15155,
            phoebe: .5532
        }[key] || 0;
        const ellipse = OrbitGeometry.ellipseFromState(this.sample.subarray(0, 3), this.sample.subarray(3, 6), OrbitGeometry.PARENT_GM[p.parent] + satelliteGM);
        if (!ellipse) {
            if (e.orbit) e.orbit.visible = false;
            return;
        }
        if (!e.orbit || !e.orbit.geometry.userData.bodyAnchoredOrbit) {
            if (e.orbit) {
                e.orbit.removeFromParent();
                e.orbit.geometry.dispose();
                e.orbit.material.dispose();
            }
            e.orbit = new this.THREE.LineLoop(OrbitGeometry.createAnchoredOrbitGeometry(this.THREE, OrbitGeometry.ORBIT_LINE_SEGMENTS), new this.THREE.LineBasicMaterial({
                color: p.color,
                transparent: true,
                opacity: .6,
                blending: this.THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            }));
            e.orbit.raycast = () => {};
            e.orbit.userData.orbitModel = "instantaneous osculating ellipse";
            this.solarSystem.add(e.orbit);
        }
        const axes = OrbitGeometry.sceneAxes(ellipse, this.km2u);
        OrbitGeometry.setAnchoredOrbitMatrix(e.orbit, axes.U, axes.V, ellipse.cosE, ellipse.sinE, e.mesh.position);
        e.orbit.visible = true;
    }
    _showTrail(key, e, p, parent, et, length, trailLayer, settings) {
        if (!e.trail || trailLayer.entries.get(key) !== e.trail) {
            e.trail = trailLayer.create({
                key: key,
                parent: p.parent
            });
            e.trail.body = e.mesh;
        }
        const trail = e.trail, c = e.curve;
        trail.mesh.visible = true;
        trail.mesh.position.copy(e.mesh.position);
        const head = e.mesh.position.clone().sub(parent.position);
        let lo = 0, hi = c.times.length - 1;
        while (lo < hi) {
            const m = lo + hi + 1 >> 1;
            if (c.times[m] <= et) lo = m; else hi = m - 1;
        }
        const i = Math.min(c.times.length - 2, lo), fraction = (et - c.times[i]) / (c.times[i + 1] - c.times[i]);
        const headLength = c.lengths[i] + fraction * (c.lengths[i + 1] - c.lengths[i]);
        let orbitLength = Math.max(1e-15, headLength / length);
        if (key === "pluto" && c.extended && this.samplePluto(et, this.sample)) {
            const ellipse = OrbitGeometry.ellipseFromState(this.sample.subarray(0, 3), this.sample.subarray(3, 6), OrbitGeometry.PARENT_GM.sun);
            if (ellipse) {
                const a = ellipse.a, b = a * Math.sqrt(1 - ellipse.e * ellipse.e);
                orbitLength = this.km2u(Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))));
            }
        }
        trail.mesh.userData.pathModel = c.extended ? "JPL body-centre history, with earlier barycentre history where needed" : "local sampled history";
        trailLayer.draw(trail, c, headLength, i, orbitLength, head, settings);
    }
}
