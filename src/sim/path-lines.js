import { PLANETS, ALL_MOONS } from "../bodies/catalog.js";

import { lowerBound, lengthAt } from "./path-history-core.js";

import { LDB_VERTEX_PARS, LDB_VERTEX_TAIL, LDB_FRAGMENT_PARS, LDB_FRAGMENT_HEAD } from "../render/log-depth-glsl.js";

const MAX_SEGMENTS = 4400;

const LOD_LEVELS = [ {
    maxTrails: 2,
    segments: 4400,
    glowStrength: 1
}, {
    maxTrails: 4,
    segments: 2200,
    glowStrength: .85
}, {
    maxTrails: 8,
    segments: 1100,
    glowStrength: .7
}, {
    maxTrails: Infinity,
    segments: 550,
    glowStrength: .55
} ];

const FADE_CURVE_POWER = .8;

const DYNAMIC_ATTRIBUTES = [ "position", "aEnd", "aFade" ];

const COLORS = {
    mercury: 13879481,
    venus: 15781267,
    earth: 9623532,
    mars: 15769728,
    jupiter: 14795426,
    saturn: 15784868,
    uranus: 10675174,
    neptune: 10205695
};

const BODIES = [ ...PLANETS.map(key => ({
    key: key,
    parent: null
})), ...Object.values(ALL_MOONS) ];

export class PathLines {
    constructor(options) {
        Object.assign(this, options);
        const T = this.THREE;
        this.activeTrailCount = 0;
        this.lodIndex = 0;
        this.group = new T.Group;
        this.group.name = "Soft orbital history";
        this.group.matrixAutoUpdate = false;
        this.scene.add(this.group);
        this.entries = new Map;
        this.world = new T.Vector3;
        this.relative = new T.Vector3;
        this.parentPoint = new T.Vector3;
        this.scale = new T.Vector3;
        this.eye = new T.Vector3;
        this.viewport = new T.Vector2;
        this.token = "";
        this.serial = 0;
        this.busy = false;
        this.worker = null;
        this.status = "";
        this.requests = 0;
    }
    workerReady() {
        if (this.worker) return;
        this.worker = new Worker(new URL("./path-history-worker.js", import.meta.url));
        this.worker.onmessage = ({data: message}) => {
            if (message.id !== this.job?.id) return;
            this.busy = false;
            if (message.token !== this.token) return;
            const entry = this.entries.get(this.job.key);
            if (!entry) return;
            if (message.error) {
                entry.error = message.error;
                this.status = "Trail history unavailable. Orbits can still be selected.";
                console.error("Trail history:", message.error);
                return;
            }
            const cache = message.result;
            const points = cache.points;
            for (let i = 0; i < points.length; i += 3) {
                const x = points[i], y = points[i + 1], z = points[i + 2];
                points[i] = this.km2u(x);
                points[i + 1] = this.km2u(z);
                points[i + 2] = -this.km2u(y);
            }
            for (let i = 0; i < cache.lengths.length; i++) cache.lengths[i] = this.km2u(cache.lengths[i]);
            cache.estimate = this.km2u(cache.estimate);
            entry.cache = cache;
            entry.version++;
            entry.error = null;
        };
        this.worker.onerror = event => {
            this.busy = false;
            this.failure = true;
            this.status = "Trail worker failed; select Orbits or reload.";
            console.error(event);
        };
    }
    reset(token) {
        this.token = token;
        for (const entry of this.entries.values()) {
            entry.cache = null;
            entry.error = null;
            entry.requested = 0;
            entry.lastStamp = "";
            entry.mesh.geometry.setDrawRange(0, 0);
        }
    }
    create(info) {
        const T = this.THREE;
        const vertices = MAX_SEGMENTS * 6;
        const geometry = new T.BufferGeometry;
        for (const [name, size] of [ [ "position", 3 ], [ "aEnd", 3 ], [ "aCorner", 2 ], [ "aFade", 1 ] ]) {
            const attribute = new T.BufferAttribute(new Float32Array(vertices * size), size);
            if (name !== "aCorner") attribute.setUsage(T.DynamicDrawUsage);
            geometry.setAttribute(name, attribute);
        }
        const pattern = [ 0, -1, 0, 1, 1, -1, 1, -1, 0, 1, 1, 1 ];
        for (let step = 0; step < MAX_SEGMENTS; step++) geometry.attributes.aCorner.array.set(pattern, step * 12);
        geometry.setDrawRange(0, 0);
        const material = new T.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: T.AdditiveBlending,
            side: T.DoubleSide,
            toneMapped: false,
            uniforms: {
                tint: {
                    value: new T.Color(COLORS[info.key] || COLORS[info.parent] || 12574183)
                },
                viewport: {
                    value: this.viewport
                },
                halfWidth: {
                    value: 4
                },
                nearPlane: {
                    value: .1
                },
                strength: {
                    value: 1
                }
            },
            vertexShader: `attribute vec3 aEnd;attribute vec2 aCorner;attribute float aFade;\n    uniform vec2 viewport;uniform float halfWidth;uniform float nearPlane;\n    varying float vSide;varying float vFade;${LDB_VERTEX_PARS}\n    void main(){vec4 a=modelViewMatrix*vec4(position,1.0);vec4 b=modelViewMatrix*vec4(aEnd,1.0);float cut=-nearPlane*1.01;\n     vSide=aCorner.y;vFade=aFade;\n     if(a.z>cut&&b.z>cut){gl_Position=vec4(2.0,2.0,2.0,1.0);vFade=0.0;return;}\n     if(a.z>cut)a=mix(a,b,clamp((cut-a.z)/(b.z-a.z),0.0,1.0));\n     if(b.z>cut)b=mix(b,a,clamp((cut-b.z)/(a.z-b.z),0.0,1.0));\n     a=projectionMatrix*a;b=projectionMatrix*b;\n     vec2 delta=(b.xy/b.w-a.xy/a.w)*viewport;vec2 normal=vec2(-delta.y,delta.x)/max(length(delta),0.0001);\n     vec4 p=mix(a,b,aCorner.x);p.xy+=normal*aCorner.y*halfWidth*2.0/max(viewport,vec2(1.0))*p.w;gl_Position=p;${LDB_VERTEX_TAIL}}`,
            fragmentShader: `uniform vec3 tint;uniform float strength;varying float vSide;varying float vFade;${LDB_FRAGMENT_PARS}\n    void main(){${LDB_FRAGMENT_HEAD}float x=vSide*vSide;\n     float glow=0.38*exp(-3.2*x)+0.62*exp(-80.0*x);\n     float alpha=glow*clamp(vFade,0.0,1.0)*strength;if(alpha<0.002)discard;\n     gl_FragColor=vec4(tint,min(alpha,0.95));}`
        });
        const mesh = new T.Mesh(geometry, material);
        mesh.frustumCulled = true;
        mesh.raycast = () => {};
        mesh.renderOrder = 1;
        this.group.add(mesh);
        const entry = {
            mesh: mesh,
            version: 0,
            cache: null,
            error: null,
            requested: 0,
            lastStamp: "",
            body: null
        };
        this.entries.set(info.key, entry);
        return entry;
    }
    _updateLod() {
        this.lodIndex = 0;
        for (let i = 0; i < LOD_LEVELS.length; i++) {
            if (this.activeTrailCount <= LOD_LEVELS[i].maxTrails) {
                this.lodIndex = i;
                return;
            }
        }
        this.lodIndex = LOD_LEVELS.length - 1;
    }
    _currentSegments() {
        return LOD_LEVELS[this.lodIndex].segments;
    }
    _currentGlow() {
        return LOD_LEVELS[this.lodIndex].glowStrength;
    }
    draw(entry, cache, headLength, endIndex, orbitLength, head, settings) {
        const target = headLength - orbitLength * settings.length;
        const tail = Math.max(cache.lengths[0], target);
        const span = Math.max(1e-12, headLength - tail);
        const start = Math.max(1, lowerBound(cache.lengths, tail));
        const points = cache.points, lengths = cache.lengths;
        const interp = Math.max(0, Math.min(1, (tail - lengths[start - 1]) / Math.max(1e-12, lengths[start] - lengths[start - 1])));
        let ax = points[(start - 1) * 3] + interp * (points[start * 3] - points[(start - 1) * 3]), ay = points[(start - 1) * 3 + 1] + interp * (points[start * 3 + 1] - points[(start - 1) * 3 + 1]), az = points[(start - 1) * 3 + 2] + interp * (points[start * 3 + 2] - points[(start - 1) * 3 + 2]), af = 0, segmentCount = 0;
        const geometry = entry.mesh.geometry;
        const positions = geometry.attributes.position.array;
        const ends = geometry.attributes.aEnd.array;
        const fades = geometry.attributes.aFade.array;
        const maxSegments = this._currentSegments();
        let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        function emit(bx, by, bz, bf) {
            if (segmentCount >= maxSegments) return;
            const axLocal = ax - head.x, ayLocal = ay - head.y, azLocal = az - head.z;
            const bxLocal = bx - head.x, byLocal = by - head.y, bzLocal = bz - head.z;
            minX = Math.min(minX, axLocal, bxLocal);
            minY = Math.min(minY, ayLocal, byLocal);
            minZ = Math.min(minZ, azLocal, bzLocal);
            maxX = Math.max(maxX, axLocal, bxLocal);
            maxY = Math.max(maxY, ayLocal, byLocal);
            maxZ = Math.max(maxZ, azLocal, bzLocal);
            const baseVertex = segmentCount++ * 6;
            for (let corner = 0; corner < 6; corner++) {
                const offset = (baseVertex + corner) * 3;
                positions[offset] = axLocal;
                positions[offset + 1] = ayLocal;
                positions[offset + 2] = azLocal;
                ends[offset] = bxLocal;
                ends[offset + 1] = byLocal;
                ends[offset + 2] = bzLocal;
                fades[baseVertex + corner] = corner === 2 || corner === 3 || corner === 5 ? bf : af;
            }
            ax = bx;
            ay = by;
            az = bz;
            af = bf;
        }
        const emitSample = i => {
            emit(points[i * 3], points[i * 3 + 1], points[i * 3 + 2], Math.pow(Math.min(1, Math.max(0, (lengths[i] - tail) / span)), FADE_CURVE_POWER));
        };
        const sampleSegments = Math.max(0, endIndex - start + 1);
        const sampleBudget = Math.max(1, maxSegments - 1);
        if (sampleSegments <= sampleBudget) {
            for (let i = start; i <= endIndex; i++) {
                if (lengths[i] > tail) emitSample(i);
            }
        } else {
            // Spend the fixed vertex budget over the whole requested arc.
            // Selecting by accumulated path length (rather than taking the
            // first N time samples) keeps eccentric periapsis passages from
            // being chorded away and guarantees that the budget still reaches
            // the current body position below.
            let sampleIndex = start;
            let lastSample = start - 1;
            const firstLength = lengths[start];
            const lastLength = lengths[endIndex];
            for (let n = 0; n < sampleBudget; n++) {
                if (n === sampleBudget - 1) sampleIndex = endIndex; else {
                    const targetLength = firstLength + (lastLength - firstLength) * (sampleBudget === 1 ? 1 : n / (sampleBudget - 1));
                    while (sampleIndex < endIndex && lengths[sampleIndex] < targetLength) sampleIndex++;
                }
                if (sampleIndex > lastSample && lengths[sampleIndex] > tail) {
                    emitSample(sampleIndex);
                    lastSample = sampleIndex;
                }
            }
        }
        if (Math.hypot(ax - head.x, ay - head.y, az - head.z) > 1e-12) emit(head.x, head.y, head.z, 1);
        const count = segmentCount * 6;
        geometry.setDrawRange(0, count);
        entry.limited = target < cache.lengths[0] - 1e-6;
        if (!count) return;
        const T = this.THREE;
        const sphere = geometry.boundingSphere || (geometry.boundingSphere = new T.Sphere);
        sphere.center.set((minX + maxX) * .5, (minY + maxY) * .5, (minZ + maxZ) * .5);
        sphere.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * .5;
        const projectionScale = Math.max(1e-9, this.camera.projectionMatrix.elements[5] * this.viewport.y);
        this.solarSystem.getWorldScale(this.scale);
        const worldScale = Math.max(1e-12, Math.abs(this.scale.x), Math.abs(this.scale.y), Math.abs(this.scale.z));
        const depth = Math.max(this.camera.near, Math.abs(this.eye.z) + sphere.radius * worldScale);
        const worldPerPixel = 2 * depth / projectionScale;
        const halfWidth = entry.mesh.material.uniforms.halfWidth.value || 0;
        sphere.radius += halfWidth * worldPerPixel / worldScale + 1e-9;
        for (const name of DYNAMIC_ATTRIBUTES) {
            const attribute = geometry.attributes[name];
            if (attribute.clearUpdateRanges && attribute.addUpdateRange) {
                attribute.clearUpdateRanges();
                attribute.addUpdateRange(0, count * attribute.itemSize);
            } else if (attribute.updateRange) {
                attribute.updateRange.offset = 0;
                attribute.updateRange.count = count * attribute.itemSize;
            }
            attribute.needsUpdate = true;
        }
        entry.limited = target < cache.lengths[0] - 1e-6;
    }
    update({generation: generation, enabled: enabled, available: available}) {
        const settings = this.getSettings();
        const showOrbitLines = enabled && settings.style === "orbits";
        for (const line of this.getOrbitLines()) line.visible = !!(showOrbitLines && line.userData.realisticOrbitKey && !(this.accuracy.approximate && this.accuracy.snapshot?.unavailable?.includes(line.userData.realisticOrbitKey)));
        if (!showOrbitLines) for (const path of this.accuracy.paths.values()) path.line.visible = false;
        const token = String(generation);
        if (token !== this.token) this.reset(token);
        this.group.visible = !!(!this.accuracy.approximate && enabled && !showOrbitLines && this.solarSystem.visible && available);
        if (!this.group.visible) {
            this.status = "";
            return;
        }
        this.renderer.getDrawingBufferSize(this.viewport);
        const dpr = this.renderer.getPixelRatio();
        this.camera.updateWorldMatrix(true, false);
        this.solarSystem.updateWorldMatrix(true, false);
        this.scene.updateWorldMatrix(true, false);
        this.group.matrix.copy(this.scene.matrixWorld).invert().multiply(this.solarSystem.matrixWorld);
        this.group.matrixWorldNeedsUpdate = true;
        let candidate = null;
        let best = Infinity;
        let waiting = 0;
        let limited = false;
        let errors = false;
        const et = this.accuracy.snapshot?.et;
        this.activeTrailCount = 0;
        for (const info of BODIES) {
            const body = this.objectRegistry[info.key];
            const parent = info.parent && this.objectRegistry[info.parent];
            let entry = this.entries.get(info.key);
            if (!body || !body.visible || info.parent && !parent) {
                if (entry) entry.mesh.visible = false;
                continue;
            }
            if (!entry) entry = this.create(info);
            if (entry.body !== body) {
                entry.body = body;
                entry.lastStamp = "";
            }
            body.getWorldPosition(this.world);
            this.solarSystem.worldToLocal(this.world);
            this.relative.copy(this.world);
            if (parent) {
                parent.getWorldPosition(this.parentPoint);
                this.solarSystem.worldToLocal(this.parentPoint);
                this.relative.sub(this.parentPoint);
            }
            body.getWorldPosition(this.eye);
            this.eye.applyMatrix4(this.camera.matrixWorldInverse);
            const worldPerLocal = this.solarSystem.getWorldScale(this.scale).x;
            const orbitPixels = this.relative.length() * Math.abs(worldPerLocal) * this.camera.projectionMatrix.elements[5] * this.viewport.y / (2 * Math.max(Math.abs(this.eye.z), this.camera.near));
            entry.mesh.visible = !(info.parent && orbitPixels < 2);
            if (!entry.mesh.visible) continue;
            this.activeTrailCount++;
            entry.mesh.position.copy(this.world);
            const uniforms = entry.mesh.material.uniforms;
            uniforms.nearPlane.value = this.camera.near;
            uniforms.halfWidth.value = Math.max(2 * dpr, Math.min(9 * dpr, Math.sqrt(Math.max(0, orbitPixels) / dpr) * .28 * dpr)) * settings.width;
            uniforms.strength.value = settings.glow * this._currentGlow();
            const cache = entry.cache;
            const covered = cache && et >= cache.start && et <= cache.end;
            const needs = !cache || !covered || !cache.atEnd && et > cache.end - cache.period * .03;
            if (entry.error) errors = true;
            if (needs && !entry.error && !this.failure) {
                const focused = this.getFocusedKey?.();
                const priority = (info.key === focused || info.parent === focused ? -1e6 : 0) + entry.requested;
                if (priority < best) {
                    candidate = info.key;
                    best = priority;
                }
            }
            if (!covered) {
                entry.mesh.geometry.setDrawRange(0, 0);
                waiting++;
                continue;
            }
            const stamp = et + ":" + entry.version + ":" + settings.length;
            if (stamp !== entry.lastStamp) {
                const headLength = lengthAt(cache, et);
                const full = et - cache.period >= cache.start ? headLength - lengthAt(cache, et - cache.period) : cache.estimate;
                const endIndex = Math.max(0, lowerBound(cache.times, et) - 1);
                this.draw(entry, cache, headLength, endIndex, full, this.relative, settings);
                entry.lastStamp = stamp;
            }
            limited ||= entry.limited;
        }
        this._updateLod();
        this.status = this.failure ? "Trail worker failed; select Orbits or reload." : errors ? "Some history unavailable; try Orbits." : waiting ? "Preparing past-position trails…" : limited ? "Trail shortened at the local date boundary." : "";
        if (candidate && !this.busy && Number.isFinite(et)) {
            this.workerReady();
            const entry = this.entries.get(candidate);
            entry.requested = ++this.requests;
            this.busy = true;
            this.job = {
                id: ++this.serial,
                key: candidate
            };
            this.worker.postMessage({
                ...this.job,
                et: et,
                token: this.token
            });
        }
    }
    dispose() {
        this.worker?.terminate();
        for (const entry of this.entries.values()) {
            entry.mesh.geometry.dispose();
            entry.mesh.material.dispose();
        }
        this.entries.clear();
        this.group.removeFromParent();
    }
}
