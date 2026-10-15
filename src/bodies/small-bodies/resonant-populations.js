const TAU = Math.PI * 2;

const JUPITER_N = TAU / 4332.59;

import { PROPAGATION_HEAD, propagationUniforms, setGroupResonance, ATTR } from "./smallbody-gpu.js";

import { LDB_VERTEX_PARS, LDB_VERTEX_TAIL, LDB_FRAGMENT_PARS, LDB_FRAGMENT_HEAD } from "../../render/log-depth-glsl.js";

export const ROCK_COLOR = [ .36, .32, .27 ];

export const POPULATIONS = {
    trojanl4: {
        name: "Jupiter Trojans · L4 (leading)",
        kind: 1,
        color: 7379087,
        count: 1400,
        catalog: "trojan-l4",
        drawn: 900
    },
    trojanl5: {
        name: "Jupiter Trojans · L5 (trailing)",
        kind: -1,
        color: 8687273,
        count: 1100,
        catalog: "trojan-l5",
        drawn: 700
    },
    hildas: {
        name: "Hilda asteroids",
        kind: 0,
        color: 11375984,
        count: 1200,
        catalog: "hilda",
        drawn: 700
    }
};

const ORBIT = `\n vec3 populationPosition(){\n  float peri=aOrbit.x,e=aOrbit.y,inc=aOrbit.z,node=aOrbit.w,phase=aExtra.x,amplitude=aExtra.y,branch=aExtra.z;\n  float a=uJupiterA,M;\n  if(abs(uKind)<.5){a*=.7631428284;float longitude=1.5*uLambda-.5*(peri+node)+branch*3.14159265359+.08*sin(uDays*.0000955695+phase);M=longitude-peri-node;}\n  else {float lib=amplitude*sin(uDays*.0001146815+phase);a*=1.0+.008*cos(uDays*.0001146815+phase);M=uLambda+uKind*1.0471975512+lib-peri-node;}\n  M=atan(sin(M),cos(M));float E=M;for(int j=0;j<6;j++)E-=(E-e*sin(E)-M)/(1.0-e*cos(E));\n  float x=a*(cos(E)-e),y=a*sqrt(1.0-e*e)*sin(E),cw=cos(peri),sw=sin(peri),co=cos(node),so=sin(node),ci=cos(inc),si=sin(inc);\n  float X=(cw*co-sw*so*ci)*x+(-sw*co-cw*so*ci)*y,Y=(cw*so+sw*co*ci)*x+(-sw*so+cw*co*ci)*y,Z=sw*si*x+cw*si*y;\n  return vec3(X,Z,-Y);\n }\n`;

const HEAD = "attribute vec4 aOrbit;attribute vec4 aExtra;" + "uniform float uKind;uniform float uLambda;uniform float uJupiterA;uniform float uDays;" + "uniform float uKm;uniform float uViewH;";

export class ResonantPopulations {
    constructor(options) {
        Object.assign(this, options);
        this.groups = new Map;
        this.rootPos = new this.THREE.Vector3;
        this.catalog = null;
        this.catalogState = "loading";
        this.useCatalog = true;
        this.orbitScale = typeof options.orbitScale === "function" ? options.orbitScale : null;
        this.moduleBuild = "r27";
        this.catalogMeshes = options.catalogMeshes === true;
        this.realMeshes = this.catalogMeshes || options.swarmMeshes === true;
        this._loading = false;
        for (const [key, p] of Object.entries(POPULATIONS)) this.bodyFacts[key] = {
            name: p.name,
            kind: "Resonant small-body population",
            tagline: "Catalogued orbits where a numbered asteroid exists, plus a statistical swarm for the population that has never been found. Marker and mesh radii use physical scale; colors and synthetic swarm sizes remain illustrative.",
            stats: [ [ "Resonance", p.kind === 0 ? "3 asteroid orbits per 2 Jupiter orbits" : "1:1 with Jupiter" ], [ "Location", p.kind === 0 ? "Near 3.97 AU; eccentric, triangular-density distribution" : p.kind > 0 ? "Around 60° ahead of Jupiter" : "Around 60° behind Jupiter" ], [ "Model", "Numbered JPL orbits + pendulum resonance; swarm is seeded statistics" ], [ "Markers", p.kind === 0 ? "Amber" : p.kind > 0 ? "Teal" : "Periwinkle" ] ]
        };
        if (options.eager !== false) this.loadCatalog();
    }
    loadCatalog() {
        this._loading = true;
        const mod = name => import(name).catch(() => null);
        Promise.all([ mod("./asteroid-catalog.js"), mod("./asteroid-populations.js") ]).then(async ([cat, populations]) => {
            if (!cat) {
                this.catalogState = "catalogue module unavailable";
                return;
            }
            const catalog = await cat.sharedCatalog();
            if (!catalog) {
                this.catalogState = "no catalogue files; statistical swarm only";
                return;
            }
            const theory = await mod("./asteroid-theory.js");
            this.populations = populations || null;
            this.Catalog = cat;
            this.jupiterMean = theory ? theory.jupiterMean : null;
            this.catalog = catalog;
            catalog.requestGroups(Object.values(POPULATIONS).map(p => p.catalog));
            this.resubset();
            this.catalogState = catalog.source;
            this._loading = false;
            if (this.useCatalog) this.buildCatalogLayers();
            this.refreshFacts();
        });
    }
    rebuild(options = {}) {
        for (const g of this.groups.values()) {
            for (const obj of [ g.markers, g.rocks, g.anchor, g.catalog?.markers, g.catalog?.rocks ]) {
                if (!obj) continue;
                if (obj.parent) obj.parent.remove(obj);
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose()); else obj.material.dispose();
                }
            }
        }
        this.groups.clear();
        this.useCatalog = options.useCatalog !== false;
        if (this.useCatalog && !this.catalog && !this._loading) this.loadCatalog();
        const T = this.THREE;
        let seed = 83421;
        const random = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296;
        for (const [key, p] of Object.entries(POPULATIONS)) {
            const n = p.count, orbits = new Float32Array(n * 4), extra = new Float32Array(n * 4);
            for (let i = 0; i < n; i++) {
                orbits.set([ random() * TAU, p.kind === 0 ? .12 + random() * .16 : .015 + random() * .09, Math.pow(random(), 1.6) * (p.kind === 0 ? .3 : .42), random() * TAU ], i * 4);
                extra.set([ random() * TAU, .08 + random() * .26, random() < .5 ? 0 : 1, .4 + Math.pow(random(), 4) * 18 ], i * 4);
            }
            const uniforms = {
                uKind: {
                    value: p.kind
                },
                uLambda: {
                    value: 0
                },
                uJupiterA: {
                    value: 1
                },
                uDays: {
                    value: 0
                },
                uKm: {
                    value: this.km2u(1)
                },
                uViewH: {
                    value: 1080
                },
                uTint: {
                    value: new T.Color(p.color)
                },
                uRockColor: {
                    value: new T.Vector3(...ROCK_COLOR)
                },
                uFade: {
                    value: .55
                }
            };
            const pointsGeo = new T.BufferGeometry;
            pointsGeo.setAttribute("position", new T.BufferAttribute(new Float32Array(n * 3), 3));
            pointsGeo.setAttribute("aOrbit", new T.BufferAttribute(orbits, 4));
            pointsGeo.setAttribute("aExtra", new T.BufferAttribute(extra, 4));
            pointsGeo.boundingSphere = new T.Sphere(new T.Vector3, 12 * this.au);
            const pointsMat = new T.ShaderMaterial({
                uniforms: uniforms,
                vertexShader: HEAD + "varying float vLight;varying float vCoverage;" + ORBIT + LDB_VERTEX_PARS + "void main(){vec3 center=populationPosition();vec4 view=modelViewMatrix*vec4(center,1.0);" + "float d=max(1e-4,-view.z);float radius=max(aExtra.w*uKm,0.0);" + "float physicalPixels=max(0.0,2.0*radius*(0.5*projectionMatrix[1][1]*uViewH)/d);" + "gl_PointSize=max(physicalPixels,1.0);vCoverage=min(1.0,physicalPixels*physicalPixels/(gl_PointSize*gl_PointSize));" + "vLight=.025+.975*max(dot(normalize(-view.xyz),normalize(-center)),0.0);gl_Position=projectionMatrix*view;" + LDB_VERTEX_TAIL + "}",
                fragmentShader: LDB_FRAGMENT_PARS + "uniform vec3 uTint;uniform float uFade;varying float vLight;varying float vCoverage;" + "void main(){" + LDB_FRAGMENT_HEAD + "float r=length(gl_PointCoord-.5);if(r>.5)discard;" + "gl_FragColor=vec4(uTint*(0.62+0.38*sqrt(max(0.0,1.0-4.0*r*r))),uFade*vCoverage);}",
                transparent: true,
                depthTest: true,
                depthWrite: false
            });
            const markers = new T.Points(pointsGeo, pointsMat);
            markers.frustumCulled = true;
            markers.raycast = () => {};
            this.solarSystem.add(markers);
            const base = this.makeRock(2), geo = new T.InstancedBufferGeometry;
            for (const [k, a] of Object.entries(base.attributes)) geo.setAttribute(k, a);
            if (base.index) geo.setIndex(base.index);
            geo.setAttribute("aOrbit", new T.InstancedBufferAttribute(orbits, 4));
            geo.setAttribute("aExtra", new T.InstancedBufferAttribute(extra, 4));
            geo.instanceCount = 0;
            geo.boundingSphere = new T.Sphere(new T.Vector3, 12 * this.au);
            const mat = new T.ShaderMaterial({
                uniforms: uniforms,
                vertexShader: HEAD + "varying float vLight;" + ORBIT + `${LDB_VERTEX_PARS}void main(){vec3 center=populationPosition();float radius=max(aExtra.w*uKm,0.0);float s=aExtra.x;vec3 shape=vec3(.88+sin(s)*.24,1.07+cos(s*1.7)*.24,1.02+sin(s*2.3)*.24);vec4 view=modelViewMatrix*vec4(center,1.0);view.xyz+=mat3(modelViewMatrix)*(position*shape*radius);vLight=.15+.85*max(dot(normalize(normal/shape),normalize(-center)),0.0);gl_Position=projectionMatrix*view;${LDB_VERTEX_TAIL}}`,
                fragmentShader: LDB_FRAGMENT_PARS + "uniform vec3 uRockColor;varying float vLight;void main(){" + LDB_FRAGMENT_HEAD + "gl_FragColor=vec4(uRockColor*mix(vLight,vLight*vLight,.65),1.0);}",
                depthTest: true
            });
            const rocks = new T.Mesh(geo, mat);
            rocks.frustumCulled = true;
            rocks.raycast = () => {};
            this.solarSystem.add(rocks);
            const anchor = new T.Mesh(new T.SphereGeometry(1, 8, 4), new T.MeshBasicMaterial({
                visible: false
            }));
            anchor.userData = {
                planetKey: key,
                planetName: p.name,
                isPopulationAnchor: true
            };
            anchor.raycast = () => {};
            this.solarSystem.add(anchor);
            this.objectRegistry[key] = anchor;
            this.groups.set(key, {
                p: p,
                uniforms: uniforms,
                markers: markers,
                rocks: rocks,
                anchor: anchor
            });
        }
        if (this.useCatalog) this.buildCatalogLayers();
    }
    buildCatalogLayers() {
        const T = this.THREE;
        if (!this.catalog || !this.groups.size || !this.useCatalog) return;
        for (const [key, g] of this.groups) {
            const n = this.drawCount(g.p.catalog);
            if (!n) continue;
            if (g.catalog) {
                for (const obj of [ g.catalog.markers, g.catalog.rocks ]) {
                    if (obj.parent) obj.parent.remove(obj);
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) obj.material.dispose();
                }
                g.catalog = null;
            }
            const dynamic = T.DynamicDrawUsage ?? 35048;
            const pack = this.catalog.gpuPack(g.p.catalog, T, this.catalog.holder);
            const radius = new Float32Array(pack.count);
            let maximumApoapsisAu = 12;
            for (let k = 0; k < pack.count; k++) {
                const j = pack.indices[k];
                radius[k] = this.catalog.radiusKm[j];
                const a = this.catalog.a[j], e = this.catalog.e[j];
                if (Number.isFinite(a) && Number.isFinite(e) && e >= 0 && e < 1) {
                    maximumApoapsisAu = Math.max(maximumApoapsisAu, a * (1 + e));
                }
            }
            const orbitBound = (this.orbitScale ? this.orbitScale(maximumApoapsisAu) : maximumApoapsisAu * this.au) * 1.08;
            const geo = new T.BufferGeometry;
            geo.boundingSphere = new T.Sphere(new T.Vector3, orbitBound);
            for (const [key, spec] of Object.entries(ATTR)) geo.setAttribute(spec.name, pack.attrs[key]);
            geo.setAttribute("aSize", new T.BufferAttribute(radius, 1).setUsage(dynamic));
            geo.setDrawRange(0, pack.count);
            const mat = new T.ShaderMaterial({
                uniforms: {
                    ...propagationUniforms(T, {
                        au: this.au
                    }),
                    uTint: {
                        value: new T.Color(g.p.color)
                    },
                    uKm: {
                        value: this.km2u(1)
                    },
                    uViewH: {
                        value: 1080
                    }
                },
                vertexShader: PROPAGATION_HEAD + `${LDB_VERTEX_PARS}\n                    attribute float aSize;\n                    uniform float uKm; uniform float uViewH;\n                    varying float vLight;\n                    varying float vCoverage;\n                    void main() {\n                        vec3 pos = propagateSmallBodyG();\n                        vec4 mv = modelViewMatrix * vec4(pos, 1.0);\n                        float d = max(1e-4, -mv.z);\n                        float radius = max(aSize * uKm, 0.0);\n                        float physicalPixels = max(0.0, 2.0 * radius * (0.5 * projectionMatrix[1][1] * uViewH) / d);\n                        gl_PointSize = max(physicalPixels, 1.0);\n                        vCoverage = min(1.0, physicalPixels * physicalPixels / (gl_PointSize * gl_PointSize));\n                        vLight = 0.025 + 0.975 * max(dot(normalize(-mv.xyz), normalize(-pos)), 0.0);\n                        gl_Position = projectionMatrix * mv;${LDB_VERTEX_TAIL}\n                    }`,
                fragmentShader: LDB_FRAGMENT_PARS + "uniform vec3 uTint;varying float vLight;varying float vCoverage;void main(){" + LDB_FRAGMENT_HEAD + "float dd=dot(gl_PointCoord-0.5,gl_PointCoord-0.5)*4.0;" + "if(dd>1.0)discard;gl_FragColor=vec4(uTint*(0.62+0.38*sqrt(max(0.0,1.0-dd))),vCoverage);}",
                transparent: true,
                depthTest: true,
                depthWrite: false
            });
            setGroupResonance(mat.uniforms, g.p.kind === 0 ? 3 : 1, g.p.kind === 0 ? 2 : 1);
            g.pack = pack;
            const markers = new T.Points(geo, mat);
            markers.frustumCulled = true;
            markers.raycast = () => {};
            this.solarSystem.add(markers);
            const base = this.makeRock(2), rgeo = new T.InstancedBufferGeometry;
            for (const [k, a] of Object.entries(base.attributes)) rgeo.setAttribute(k, a);
            if (base.index) rgeo.setIndex(base.index);
            rgeo.instanceCount = 0;
            rgeo.boundingSphere = new T.Sphere(new T.Vector3, orbitBound);
            for (const [key, spec] of Object.entries(ATTR)) rgeo.setAttribute(spec.name, pack.attrs[key]);
            const rmat = new T.ShaderMaterial({
                uniforms: {
                    ...propagationUniforms(T, {
                        au: this.au
                    }),
                    uRockColor: {
                        value: new T.Vector3(...ROCK_COLOR)
                    },
                    uKm: {
                        value: this.km2u(1)
                    }
                },
                vertexShader: PROPAGATION_HEAD + `${LDB_VERTEX_PARS}\n                    attribute float aSize;\n                    uniform float uKm;\n                    varying float vLight;\n                    void main() {\n                        vec3 center = propagateSmallBodyG();\n                        float radius = max(aSize * uKm, 0.0);\n                        vec3 shape = vec3(.88, 1.07, 1.02);\n                        vec4 view = modelViewMatrix * vec4(center, 1.0);\n                        view.xyz += mat3(modelViewMatrix) * (position * shape * radius);\n                        vLight = .15 + .85 * max(dot(normalize(normal / shape), normalize(-center)), 0.0);\n                        gl_Position = projectionMatrix * view;${LDB_VERTEX_TAIL}\n                    }`,
                fragmentShader: LDB_FRAGMENT_PARS + "uniform vec3 uRockColor;varying float vLight;void main(){" + LDB_FRAGMENT_HEAD + "gl_FragColor=vec4(uRockColor*mix(vLight,vLight*vLight,.65),1.0);}",
                depthTest: true
            });
            setGroupResonance(rmat.uniforms, g.p.kind === 0 ? 3 : 1, g.p.kind === 0 ? 2 : 1);
            const rocks = new T.Mesh(rgeo, rmat);
            rocks.frustumCulled = true;
            rocks.raycast = () => {};
            this.solarSystem.add(rocks);
            rgeo.setAttribute("aSize", new T.InstancedBufferAttribute(radius, 1).setUsage(dynamic));
            g.catalog = {
                markers: markers,
                rocks: rocks,
                pack: pack,
                radius: radius,
                count: pack.count
            };
        }
    }
    drawCount(groupKey) {
        const list = this.catalog?.indicesOf(groupKey);
        if (!list) return 0;
        let n = 0;
        for (let k = 0; k < list.length; k++) if (this.catalog.visible[list[k]]) n++;
        return n;
    }
    refreshFacts() {
        if (!this.bodyFacts) return;
        for (const [key, population] of Object.entries(POPULATIONS)) {
            const facts = this.bodyFacts[key];
            if (!facts) continue;
            const census = this.catalog?.census().get(population.catalog);
            facts.stats = facts.stats.filter(row => !/^(Catalogued|Catalogue status|Population layer|Represented|Sizes|Modelled accuracy|Survey completeness|Data source)/.test(row[0]));
            if (!this.catalog) {
                facts.stats.unshift([ "Catalogue status", this.catalogState || "loading" ]);
                facts.stats.push([ "Population layer", "Statistical swarm; catalogued positions appear when the JPL catalogue is available" ]);
                continue;
            }
            facts.stats.unshift([ "Catalogued here", `${census?.shown ?? 0} shown of ${(census?.catalogued ?? 0).toLocaleString("en-US")} numbered orbits` ]);
            facts.stats.push([ "Represented", `${(census?.represented ?? 0).toLocaleString("en-US")} real bodies (size-weighted)` ]);
            facts.stats.push([ "Survey completeness", population.catalog === "hilda" ? "~20 % of >1 km found; ~100 % above 3 km" : population.catalog === "trojan-l4" ? "~7 % of >1 km found; all above ~10 km" : "~59 % of >140 m found, nearly all above 500 m" ]);
            facts.stats.push([ "Sizes", `mean ${census?.meanDiameterKm ?? "—"} km across ${census?.withSize ?? 0} measured; faintest bodies sized from H` ]);
            facts.stats.push([ "Modelled accuracy", "Approximate analytic orbits; error varies by object and date. Not precision ephemerides." ]);
            facts.stats.push([ "Data source", `JPL SBDB — ${this.catalogState}` ]);
        }
    }
    largestDrawn(groupKey) {
        if (!this.catalog) return null;
        let best = -1, bestD = 0;
        for (const j of this.catalog.indicesOf(groupKey)) if (this.catalog.visible[j] && this.catalog.diameterKm[j] > bestD) {
            bestD = this.catalog.diameterKm[j];
            best = j;
        }
        if (best < 0) return null;
        return {
            index: best,
            name: this.catalog.name(best),
            diameterKm: bestD,
            groupKey: groupKey
        };
    }
    radiusFactor() {
        if (!this.orbitScale) return () => this.au;
        const f = this.orbitScale;
        return a => f(a) / a;
    }
    orbitRadiusAt(a) {
        return this.orbitScale ? this.orbitScale(a) : a * this.au;
    }
    resubset() {
        if (!this.catalog) return;
        const quota = Object.fromEntries(Object.values(POPULATIONS).map(p => [ p.catalog, Infinity ]));
        quota.belt = 0;
        this.catalog.requestSubset(quota, {
            minDiameterKm: 0
        });
        this.catalog.invalidate();
        this.buildCatalogLayers();
    }
    update({et: et, enabled: enabled, markersEnabled: markersEnabled, groupOn: groupOn}) {
        const j = this.objectRegistry.jupiter;
        if (!j) return;
        if (!this._rows) {
            this._rows = new Map;
            for (const el of document.querySelectorAll("[data-population]")) if (el.dataset && el.dataset.key) this._rows.set(el.dataset.key, el);
        }
        const o = this.accuracy?.snapshot?.orbits?.jupiter;
        let a, lambda, days;
        days = Number.isFinite(et) ? et / 86400 : 0;
        a = o?.U ? this.km2u(Math.hypot(...o.U)) : this.orbitRadiusAt(5.2044);
        let angle = o ? o.E - o.e * Math.sin(o.E) + Math.atan2(o.U[1], o.U[0]) : Math.atan2(-j.position.z, j.position.x);
        const expected = .600508 + TAU * days / 4332.59;
        lambda = angle + TAU * Math.round((expected - angle) / TAU);
        const visible = !!enabled;
        let catalogueAdvanced = false;
        for (const [key, g] of this.groups) {
            const shown = visible && (!groupOn || groupOn[key] !== false);
            this._updateSwarm(key, g, {
                days: days,
                a: a,
                lambda: lambda,
                shown: shown,
                markersEnabled: markersEnabled
            });
            this._updateAnchor(g, {
                a: a,
                lambda: lambda,
                shown: shown
            });
            if (this._syncCatalogue(g, {
                days: days,
                shown: shown,
                catalogueAdvanced: catalogueAdvanced
            })) catalogueAdvanced = true;
        }
    }
    _updateSwarm(key, g, {days: days, a: a, lambda: lambda, shown: shown, markersEnabled: markersEnabled}) {
        const u = g.uniforms;
        u.uLambda.value = lambda;
        u.uJupiterA.value = a;
        u.uDays.value = days;
        u.uViewH.value = this.renderer.domElement && this.renderer.domElement.height || u.uViewH.value;
        u.uFade.value = .55;
        g.markers.visible = shown && markersEnabled;
        g.rocks.visible = shown && this.realMeshes;
        g.rocks.geometry.instanceCount = shown && this.realMeshes ? g.p.count : 0;
        const row = this._rows.get(key);
        if (row && row.hidden !== !shown) row.hidden = !shown;
    }
    _updateAnchor(g, {a: a, lambda: lambda, shown: shown}) {
        const hildaFactor = .7631428284;
        const radius = g.p.kind === 0 ? a * hildaFactor : a;
        const angle = g.p.kind === 0 ? lambda * (2 / 3) : lambda + g.p.kind * Math.PI / 3;
        g.anchor.position.set(radius * Math.cos(angle), 0, -radius * Math.sin(angle));
        g.anchor.userData.focusRadius = g.p.kind === 0 ? a * .42 : a * .18;
        g.anchor.visible = shown;
    }
    _syncCatalogue(g, {days: days, shown: shown, catalogueAdvanced: catalogueAdvanced}) {
        if (!g.catalog) return false;
        const real = shown && this.useCatalog !== false;
        g.catalog.markers.visible = real;
        g.catalog.rocks.visible = real && this.realMeshes;
        const h = this.renderer.domElement && this.renderer.domElement.height || 1080;
        if (g.catalog.markers.material.uniforms?.uViewH) g.catalog.markers.material.uniforms.uViewH.value = h;
        if (real) {
            this.updateCatalog(g, days, !catalogueAdvanced);
            return true;
        }
        return false;
    }
    updateCatalog(g, daysSinceJ2000, advance = true) {
        const days = daysSinceJ2000;
        const cat = g.catalog;
        if (!cat) return;
        const model = this.jupiterMean ? this.jupiterMean(days) : null;
        const reference = model ? model.lambda : .600508 + JUPITER_N * days;
        const o = this.accuracy?.snapshot?.orbits?.jupiter;
        let lambda = reference;
        if (o?.U) {
            const page = o.E - o.e * Math.sin(o.E) + Math.atan2(o.U[1], o.U[0]);
            lambda = page + TAU * Math.round((reference - page) / TAU);
        }
        const u = cat.markers.material.uniforms;
        u.uDays.value = days;
        u.uJupLambda.value = lambda;
        u.uJupRate.value = model ? model.lambdaDot : JUPITER_N;
        u.uViewH.value = this.renderer.domElement && this.renderer.domElement.height || u.uViewH.value;
        if (cat.rocks.material.uniforms) {
            const ru = cat.rocks.material.uniforms;
            ru.uDays.value = days;
            ru.uJupLambda.value = lambda;
            ru.uJupRate.value = model ? model.lambdaDot : JUPITER_N;
        }
        if (advance) this.catalog.update(days, {
            jupiter: {
                lambda: lambda,
                lambdaDot: u.uJupRate.value,
                n: u.uJupRate.value / 1
            }
        });
    }
}
