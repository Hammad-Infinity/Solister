import { sharedCatalog, FLAG } from "./asteroid-catalog.js";

import { cumulativeCount } from "./asteroid-populations.js";

import { PROPAGATION_HEAD, propagationUniforms, ATTR } from "./smallbody-gpu.js";

import { LDB_VERTEX_PARS, LDB_VERTEX_TAIL, LDB_FRAGMENT_PARS, LDB_FRAGMENT_HEAD } from "../../render/log-depth-glsl.js";

export const NEA_GROUPS = [ "nea" ];

export const COLORS = {
    all: [ .39, .43, .49 ],
    pha: [ .6, .39, .35 ],
    inner: [ .63, .65, .68 ]
};

export const ROCK_COLORS = {
    all: [ .36, .32, .27 ],
    inner: [ .86, .88, .93 ]
};

export function markerColorFor(inner, pha) {
    return inner ? COLORS.inner : pha ? COLORS.pha : COLORS.all;
}

const INNER_AU = 1.0017;

export class NearEarthObjects {
    constructor(options) {
        Object.assign(this, options);
        this.groups = new Map;
        this.catalog = null;
        this.catalogState = "loading";
        this.drawn = 2600;
        this.useCatalog = true;
        this.stats = {
            shown: 0,
            pha: 0,
            closest: null,
            next: null
        };
        this._sweepAt = 0;
        this.rockMax = options.rockMax ?? 2600;
        this.orbitScale = typeof options.orbitScale === "function" ? options.orbitScale : null;
        this.rockMinD = 0;
        this.moduleBuild = "r27";
        this.meshes = options.meshes !== false;
        this.wantMeshes = true;
        this.rocksDrawn = 0;
        this.innerDrawn = 0;
        this._pending = false;
        this._loading = false;
        if (options.eager !== false) this.load();
    }
    load() {
        if (this._loading || this.catalog) return this.catalog;
        this._loading = true;
        sharedCatalog().then(catalog => {
            if (!catalog) {
                this.catalogState = "catalogue unavailable";
                this._loading = false;
                this._pending = false;
                this.useCatalog = false;
                this.refreshFacts();
                return;
            }
            this.catalog = catalog;
            this.catalogState = catalog.source;
            catalog.requestGroups(NEA_GROUPS);
            if (this._pending) {
                this._pending = false;
                this.applySubset();
                this.build();
            }
            this._loading = false;
            this.refreshFacts();
        });
        return this.catalog;
    }
    applySubsetSafe() {
        if (this.catalog) this.applySubset();
        this.refreshFacts?.();
    }
    applySubset() {
        if (!this.catalog) return;
        this.catalog.requestSubset({
            nea: this.drawn
        }, {
            minDiameterKm: 0
        });
    }
    rebuild(options = {}) {
        this.wantMeshes = this.meshes;
        for (const g of this.groups.values()) {
            this.solarSystem.remove(g.markers);
            g.markers.geometry.dispose();
            g.markers.material.dispose();
            if (g.rocks) {
                this.solarSystem.remove(g.rocks.rocks);
                g.rocks.rocks.geometry.dispose();
                g.rocks.rocks.material.dispose();
            }
        }
        this.groups.clear();
        this.useCatalog = options.useCatalog !== false;
        this.drawn = options.drawn ?? this.drawn;
        if (!this.useCatalog) {
            this._pending = false;
            this.refreshFacts();
            return;
        }
        if (this.useCatalog && !this.catalog) this.load();
        if (!this.catalog) {
            this._pending = true;
            return;
        }
        this.applySubset();
        this.build();
    }
    build() {
        if (!this.catalog || !this.useCatalog) return;
        const T = this.THREE;
        if (this.km2uScale === undefined) this.km2uScale = this.km2u ? this.km2u(1) : this.au / 149597870.7;
        const pack = this.catalog.gpuPack("nea", T, this.catalog.holder);
        const n = pack.count;
        const colors = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) {
            const j = pack.indices[k];
            const inner = this.isInnerAu(this.catalog.a[j], this.catalog.e[j]);
            const c = markerColorFor(inner, !!(this.catalog.flags[j] & FLAG.pha));
            colors[k * 3] = c[0];
            colors[k * 3 + 1] = c[1];
            colors[k * 3 + 2] = c[2];
        }
        const dynamic = T.DynamicDrawUsage ?? 35048;
        let maximumApoapsisAu = 1;
        for (const j of pack.indices) {
            const a = this.catalog.a[j], e = this.catalog.e[j];
            if (Number.isFinite(a) && Number.isFinite(e) && e >= 0 && e < 1) {
                maximumApoapsisAu = Math.max(maximumApoapsisAu, a * (1 + e));
            }
        }
        const orbitBound = (this.orbitScale ? this.orbitScale(maximumApoapsisAu) : maximumApoapsisAu * this.au) * 1.08;
        const populationBounds = () => new T.Sphere(new T.Vector3, orbitBound);
        const geo = new T.BufferGeometry;
        geo.boundingSphere = populationBounds();
        for (const [key, spec] of Object.entries(ATTR)) geo.setAttribute(spec.name, pack.attrs[key]);
        geo.setAttribute("color", new T.BufferAttribute(colors, 3).setUsage(dynamic));
        geo.setDrawRange(0, n);
        const mat = new T.ShaderMaterial({
            uniforms: {
                ...propagationUniforms(T, {
                    au: this.au
                }),
                uKm: {
                    value: this.km2uScale || (this.km2u ? this.km2u(1) : this.au / 149597870.7)
                },
                uViewH: {
                    value: 1080
                }
            },
            vertexShader: PROPAGATION_HEAD + `${LDB_VERTEX_PARS}\n                attribute vec3 color;\n                attribute float aSize;\n                uniform float uKm; uniform float uViewH;\n                varying vec3 vMarkerColor;\n                varying float vLight;\n                varying float vCoverage;\n                void main() {\n                    vec3 pos = propagateSmallBodyG();\n                    vec4 mv = modelViewMatrix * vec4(pos, 1.0);\n                    float d = max(1e-4, -mv.z);\n                    float radius = max(aSize * uKm, 0.0);\n                    float physicalPixels = max(0.0, 2.0 * radius * (0.5 * projectionMatrix[1][1] * uViewH) / d);\n                    gl_PointSize = max(physicalPixels, 1.0);\n                    vCoverage = min(1.0, physicalPixels * physicalPixels / (gl_PointSize * gl_PointSize));\n                    vLight = 0.025 + 0.975 * max(dot(normalize(-mv.xyz), normalize(-pos)), 0.0);\n                    vMarkerColor = color;\n                    gl_Position = projectionMatrix * mv;${LDB_VERTEX_TAIL}\n                }`,
            fragmentShader: LDB_FRAGMENT_PARS + "varying vec3 vMarkerColor;varying float vLight;varying float vCoverage;void main(){" + LDB_FRAGMENT_HEAD + "float dd=dot(gl_PointCoord-0.5,gl_PointCoord-0.5)*4.0;" + "if(dd>1.0)discard;gl_FragColor=vec4(vMarkerColor*(0.62+0.38*sqrt(max(0.0,1.0-dd))),vCoverage);}",
            transparent: true,
            depthTest: true,
            depthWrite: false
        });
        const markers = new T.Points(geo, mat);
        markers.frustumCulled = true;
        markers.raycast = () => {};
        this.solarSystem.add(markers);
        const rocks = this.buildRocks(n, pack.attrs);
        if (rocks) {
            rocks.rocks.geometry.boundingSphere = populationBounds();
            rocks.rocks.frustumCulled = true;
        }
        const sizes = rocks ? rocks.size : new Float32Array(n);
        if (rocks && pack.attrs) {
            for (let k = 0; k < rocks.cap; k++) {
                const j = pack.indices[k];
                rocks.size[k] = this.catalog.radiusKm[j] || 1;
                rocks.inner[k] = this.isInnerAu(this.catalog.a[j], this.catalog.e[j]) ? 1 : 0;
            }
            rocks.rocks.geometry.attributes.aSize.needsUpdate = true;
            rocks.rocks.geometry.attributes.aInner.needsUpdate = true;
        }
        geo.setAttribute("aSize", new T.BufferAttribute(sizes, 1).setUsage(dynamic));
        const anchor = new T.Mesh(new T.SphereGeometry(1, 8, 4), new T.MeshBasicMaterial({
            visible: false
        }));
        anchor.userData = {
            planetKey: "nea",
            planetName: "Near-Earth asteroids",
            isPopulationAnchor: true,
            focusRadius: this.orbitScale ? this.orbitScale(INNER_AU) : this.au * INNER_AU * .9
        };
        anchor.raycast = () => {};
        this.solarSystem.add(anchor);
        this.objectRegistry.nea = anchor;
        this.groups.set("nea", {
            markers: markers,
            rocks: rocks,
            anchor: anchor,
            pack: pack,
            colors: colors,
            sizes: sizes,
            list: pack.indices,
            n: n,
            drawn: n
        });
        this.refreshFacts();
    }
    buildRocks(n, attrs) {
        const T = this.THREE;
        if (!this.makeRock || !attrs) return null;
        const cap = Math.max(1, Math.min(this.rockMax, n));
        const size = new Float32Array(cap), inner = new Float32Array(cap);
        const base = this.makeRock(2), geo = new T.InstancedBufferGeometry;
        for (const [key, attribute] of Object.entries(base.attributes)) geo.setAttribute(key, attribute);
        if (base.index) geo.setIndex(base.index);
        const dynamic = T.DynamicDrawUsage ?? 35048;
        for (const [key, spec] of Object.entries(ATTR)) geo.setAttribute(spec.name, attrs[key]);
        geo.setAttribute("aSize", new T.InstancedBufferAttribute(size, 1).setUsage(dynamic));
        geo.setAttribute("aInner", new T.InstancedBufferAttribute(inner, 1).setUsage(dynamic));
        geo.instanceCount = 0;
        const uniforms = Object.assign(propagationUniforms(T, {
            au: this.au
        }), {
            uKm: {
                value: this.km2u ? this.km2u(1) : this.au / 149597870.7
            },
            uRockColor: {
                value: new T.Vector3(...ROCK_COLORS.all)
            },
            uInnerRockColor: {
                value: new T.Vector3(...ROCK_COLORS.inner)
            }
        });
        const vertexShader = PROPAGATION_HEAD + `${LDB_VERTEX_PARS}\n            attribute float aSize;\n            attribute float aInner;\n            uniform float uKm;\n            varying float vLight;\n            varying float vInner;\n            void main() {\n                vec3 center = propagateSmallBodyG();\n                float radius = max(aSize * uKm, 0.0);\n                vec3 shape = vec3(.88, 1.07, 1.02);\n                vec4 view = modelViewMatrix * vec4(center, 1.0);\n                view.xyz += mat3(modelViewMatrix) * (position * shape * radius);\n                vInner = aInner;\n                vLight = .15 + .85 * max(dot(normalize(normal / shape), normalize(-center)), 0.0);\n                gl_Position = projectionMatrix * view;${LDB_VERTEX_TAIL}\n            }`;
        const material = new T.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: vertexShader,
            fragmentShader: LDB_FRAGMENT_PARS + "uniform vec3 uRockColor;uniform vec3 uInnerRockColor;varying float vLight;varying float vInner;void main(){" + LDB_FRAGMENT_HEAD + "vec3 albedo=mix(uRockColor,uInnerRockColor,vInner);gl_FragColor=vec4(albedo*mix(vLight,vLight*vLight,.65),1.0);}",
            depthTest: true
        });
        const rocks = new T.Mesh(geo, material);
        rocks.frustumCulled = true;
        rocks.raycast = () => {};
        rocks.visible = false;
        this.solarSystem.add(rocks);
        return {
            rocks: rocks,
            size: size,
            cap: cap,
            inner: inner
        };
    }
    isInnerAu(a, e) {
        return a * (1 + e) < INNER_AU;
    }
    update({et: et, enabled: enabled}) {
        if (!this._menuRows) this._menuRows = document.querySelectorAll("[data-nea]");
        const hideMenu = !enabled || !this.groups.size;
        for (const item of this._menuRows) if (item.hidden !== hideMenu) item.hidden = hideMenu;
        const on = !!enabled && this.groups.size > 0 && this.useCatalog && !!this.catalog;
        for (const group of this.groups.values()) {
            group.markers.visible = on;
            group.anchor.visible = on;
            if (group.rocks) group.rocks.rocks.visible = on && this.wantMeshes && this.rocksDrawn > 0;
            if (group.markers.material.uniforms?.uViewH) group.markers.material.uniforms.uViewH.value = this.renderer.domElement && this.renderer.domElement.height || 1080;
        }
        if (!on) return;
        const days = Number.isFinite(et) ? et / 86400 : 0;
        const group = this.groups.get("nea");
        const uniforms = group.markers.material.uniforms;
        uniforms.uDays.value = days;
        uniforms.uViewH.value = this.renderer.domElement && this.renderer.domElement.height || uniforms.uViewH.value;
        if (group.rocks?.rocks.material.uniforms) {
            const rockUniforms = group.rocks.rocks.material.uniforms;
            rockUniforms.uDays.value = days;
            group.rocks.rocks.geometry.instanceCount = this.wantMeshes ? group.rocks.cap : 0;
        }
        this.rocksDrawn = this.wantMeshes ? group.rocks?.cap || 0 : 0;
        const now = performance.now();
        if (now - this._sweepAt > 700) {
            this._sweepAt = now;
            this.sweep();
        }
    }
    _insertTopSize(sizes, cap, diameter) {
        if (sizes.length < cap) {
            sizes.push(diameter);
            if (sizes.length === cap) sizes.sort((a, b) => b - a);
        } else if (diameter > sizes[cap - 1]) {
            sizes[cap - 1] = diameter;
            for (let i = cap - 2; i >= 0 && sizes[i] < sizes[i + 1]; i--) {
                const previous = sizes[i];
                sizes[i] = sizes[i + 1];
                sizes[i + 1] = previous;
            }
        }
    }
    sweep() {
        const catalog = this.catalog;
        const group = this.groups.get("nea");
        if (!catalog || !group) return;
        const earth = this.objectRegistry.earth;
        const ex = earth ? earth.position.x / this.au : 1;
        const ey = earth ? -earth.position.z / this.au : 0;
        let closest = null, next = null, pha = 0;
        for (const index of group.list) {
            if (!catalog.visible[index]) continue;
            if (catalog.flags[index] & FLAG.pha) pha++;
            if (!catalog.stored[index]) continue;
            const offset = index * 3;
            const distance = Math.hypot(catalog.xyz[offset] - ex, catalog.xyz[offset + 1] - ey, catalog.xyz[offset + 2]);
            const moid = catalog.moidAU[index];
            const rank = moid > 0 ? moid : distance;
            if (closest && !(rank < closest.moidAu) && next && !(rank < next.moidAu)) continue;
            const candidate = {
                name: catalog.name(index),
                distanceAu: distance,
                moidAu: rank,
                diameterKm: catalog.diameterKm[index]
            };
            if (!closest || candidate.moidAu < closest.moidAu) {
                if (closest && (!next || closest.moidAu < next.moidAu)) next = closest;
                closest = candidate;
            } else if (!next || candidate.moidAu < next.moidAu) next = candidate;
        }
        if (group.rocks) {
            const sizes = [];
            for (const index of group.list) {
                if (!catalog.visible[index]) continue;
                this._insertTopSize(sizes, this.rockMax, catalog.diameterKm[index] || 0);
            }
            this.rockMinD = sizes.length === this.rockMax ? sizes[this.rockMax - 1] : 0;
        }
        const changed = this.stats.closest?.name !== closest?.name || (this.stats.rocks ?? -1) !== this.rocksDrawn || this.stats.shown !== group.drawn;
        this.stats = {
            shown: group.drawn,
            pha: pha,
            closest: closest,
            next: next,
            rocks: this.rocksDrawn
        };
        if (changed) this.refreshFacts();
    }
    refreshFacts() {
        if (!this.bodyFacts) return;
        const row = this.catalog ? this.catalog.census().get("nea") : null;
        const stats = this.stats;
        const group = this.groups.get("nea");
        const available = this.useCatalog && !!this.catalog;
        const population = row?.represented ?? cumulativeCount("nea", .14);
        this.bodyFacts.nea = {
            name: "Near-Earth asteroids",
            kind: "Dynamical group (perihelion inside 1.3 AU)",
            tagline: available ? "Catalogued small bodies propagated from fitted orbital elements. This compact analytic model does not integrate close encounters; use JPL Horizons for precision ephemerides." : "The numbered-orbit catalogue is unavailable. No synthetic asteroid positions are substituted.",
            stats: [ [ "Drawn", available ? `${group?.drawn ?? 0} of ${(row?.catalogued ?? 0).toLocaleString("en-US")} numbered orbits` : "0 — catalogue unavailable" ], [ "Estimated population", `${population.toLocaleString("en-US")} bodies over 140 m (NEOMOD3 completeness-corrected)` ], [ "Closest now", stats.closest ? `${stats.closest.name} — MOID ${stats.closest.moidAu.toFixed(3)} AU, ${stats.closest.distanceAu.toFixed(3)} AU away, about ${stats.closest.diameterKm.toFixed(1)} km` : "—" ], [ "Next closest", stats.next ? `${stats.next.name} — MOID ${stats.next.moidAu.toFixed(3)} AU` : "—" ], [ "Potentially hazardous", stats.pha ? `${stats.pha} catalogued objects in the active sample` : "—" ], [ "Rock meshes", group?.rocks ? this.rocksDrawn ? `${this.rocksDrawn} largest drawn; smallest included size ${this.rockMinD.toFixed(1)} km; true-size rendering` : `waiting for bodies at or above ${this.rockMinD.toFixed(1)} km` : "Not built" ], [ "Markers", "Blue-grey NEAs; salmon potentially hazardous asteroids; pale inner objects" ], [ "Orbit model", "Analytic propagation from catalogue elements; close encounters are not integrated" ], [ "Data source", available ? `JPL SBDB — ${this.catalogState}` : `JPL SBDB — ${this.catalogState}` ] ]
        };
    }
}
