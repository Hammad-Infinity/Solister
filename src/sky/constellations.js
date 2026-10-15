import { SKY_RADIUS } from "./sky-maps.js";

const [constellationDataModule, motionDataModule, gaiaDataModule] = await Promise.all([
    import("../../data/sky/constellation-data.js").catch(() => ({})),
    import("../../data/sky/constellation-motion-data.js").catch(() => ({})),
    import("../../data/sky/constellation-gaia-astrometry.js").catch(() => ({}))
]);

const CONST_DATA = constellationDataModule.CONST_DATA || {};

const STAR_DESIGNATIONS = constellationDataModule.STAR_DESIGNATIONS || [];

const CONSTELLATION_MOTION = motionDataModule.CONSTELLATION_MOTION || new Float32Array(0);

const CONSTELLATION_MOTION_EPOCH = Number.isFinite(motionDataModule.CONSTELLATION_MOTION_EPOCH)
    ? motionDataModule.CONSTELLATION_MOTION_EPOCH
    : 2000;

const gaiaAstrometry = gaiaDataModule.CONSTELLATION_GAIA_ASTROMETRY;

const CONSTELLATION_GAIA_ASTROMETRY = gaiaAstrometry && typeof gaiaAstrometry.get === "function"
    ? gaiaAstrometry
    : new Map;

const CONSTELLATION_DATA_AVAILABLE = !!(
    CONST_DATA.stars?.length >= 4
    && CONST_DATA.figures?.length
    && CONST_DATA.segs?.length
    && CONST_DATA.segCounts?.length
    && CONST_DATA.labels?.length >= 176
    && CONST_DATA.names?.length >= 88
    && CONST_DATA.abbr?.length >= 88
    && CONST_DATA.polys?.length >= 88
    && CONST_DATA.starNames
);

const DEG = Math.PI / 180;

const EPS = 23.4392911 * DEG;

const COS_EPS = Math.cos(EPS);

const SIN_EPS = Math.sin(EPS);

const STAR_SEED = 12648430;

const CATALOG_REFERENCE_RADIUS = 8e3;

const STAR_POINT_EXPOSURE = 1.35;

const SOLAR_RADIUS_KM = 695700;

const PARSEC_KM = 30856775814913.67;

function catalogStarDistancePc(index) {
    const parallaxMas = CONSTELLATION_GAIA_ASTROMETRY.get(index)?.[2];
    if (Number.isFinite(parallaxMas) && parallaxMas > 0) return 1e3 / parallaxMas;
    const distancePc = CONSTELLATION_MOTION[index * 4 + 2];
    return Number.isFinite(distancePc) && distancePc > 0 ? distancePc : 0;
}

function catalogStarRadiusKm(index) {
    const radiiKm = CONST_DATA.starRadiiKm || CONST_DATA.stellarRadiiKm || CONST_DATA.radiiKm;
    const radiusKm = Number(radiiKm?.[index]);
    return Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : SOLAR_RADIUS_KM;
}

function mulberry32(seed) {
    let a = seed | 0;
    return function() {
        a = a + 1831565813 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function hslToRgb(h, s, l) {
    const q = l < .5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = t => {
        t = (t % 1 + 1) % 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [ f(h + 1 / 3), f(h), f(h - 1 / 3) ];
}

export function sceneToEq(s, out) {
    const X = s.x;
    const Z = s.y;
    const Y = -s.z;
    const x = X;
    const y = Y * COS_EPS - Z * SIN_EPS;
    const z = Y * SIN_EPS + Z * COS_EPS;
    out.ra = (Math.atan2(y, x) / DEG + 360) % 360;
    out.dec = Math.asin(Math.max(-1, Math.min(1, z))) / DEG;
    return out;
}

export class ConstellationLayer {
    constructor({THREE: THREE, scene: scene, CSS2DObject: CSS2DObject, radius: radius = SKY_RADIUS}) {
        this.THREE = THREE;
        this.scene = scene;
        this.group = new THREE.Group;
        this.group.name = "constellation-layer";
        scene.add(this.group);
        this.labels = [];
        this.starLabels = [];
        this.rnd = mulberry32(STAR_SEED);
        this._tmpV = new THREE.Vector3;
        this._radius = radius;
        this._labelOccProvider = null;
        this._pic = null;
        this._labelOcc = {
            world: new THREE.Vector3,
            screen: new THREE.Vector3,
            center: new THREE.Vector3,
            scale: new THREE.Vector3,
            camera: new THREE.Vector3,
            items: []
        };
        if (CONSTELLATION_DATA_AVAILABLE) {
            this._buildFigures();
            this._buildBoundaries();
            this._buildStars();
            this._buildFigureEndpointStars();
            this._buildLabels(CSS2DObject);
            this._buildPointInConstellation();
        } else {
            this.hoverNames = null;
            this.hoverPoints = null;
            console.warn("Constellation catalog is missing or incomplete; the constellation layer is disabled.");
        }
        this._installCameraLock();
        this.setRadius(radius);
    }
    _installCameraLock() {
        const tmp = this._tmpV;
        const group = this.group;
        const self = this;
        const snap = (renderer, scene, camera) => {
            if (!camera) return;
            camera.getWorldPosition(tmp);
            group.position.copy(tmp);
            group.scale.setScalar(self._radius || SKY_RADIUS);
            group.updateMatrixWorld(true);
        };
        this.group.traverse(obj => {
            if (obj.isLineSegments || obj.isPoints || obj.isLine || obj.isInstancedMesh) {
                obj.onBeforeRender = snap;
                obj.frustumCulled = false;
            }
        });
    }
    _unitVec(ra, dec, out) {
        const a = ra * DEG;
        const d = dec * DEG;
        return out.set(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
    }
    _sceneVecFromUnit(eqUnit, out) {
        const x = eqUnit.x;
        const y = eqUnit.y;
        const z = eqUnit.z;
        const X = x;
        const Y = y * COS_EPS + z * SIN_EPS;
        const Z = -y * SIN_EPS + z * COS_EPS;
        return out.set(X, Z, -Y);
    }
    _starScenePosition(index, year, out) {
        const masToRad = Math.PI / (180 * 3600 * 1e3);
        const gaia = CONSTELLATION_GAIA_ASTROMETRY.get(index);
        let ra, dec, pmRa, pmDec, distance, rv, epoch;
        if (gaia) {
            [ra, dec, distance, pmRa, pmDec, rv, epoch] = gaia;
            if (distance > 0) distance = 1e3 / distance; else distance = 0;
        } else {
            const S = CONST_DATA.stars, mi = index * 4;
            ra = S[mi];
            dec = S[mi + 1];
            pmRa = CONSTELLATION_MOTION[mi];
            pmDec = CONSTELLATION_MOTION[mi + 1];
            distance = CONSTELLATION_MOTION[mi + 2];
            rv = CONSTELLATION_MOTION[mi + 3];
            epoch = CONSTELLATION_MOTION_EPOCH;
        }
        const a = ra * DEG, d = dec * DEG, dt = year - epoch;
        const cr = Math.cos(a), sr = Math.sin(a), cd = Math.cos(d), sd = Math.sin(d);
        const ux = cd * cr, uy = cd * sr, uz = sd;
        const ex = -sr, ey = cr, nx = -sd * cr, ny = -sd * sr, nz = cd;
        let x, y, z;
        if (distance > 0) {
            const rvPcYear = rv * 1022712165e-15;
            x = distance * ux + dt * (distance * pmRa * masToRad * ex + distance * pmDec * masToRad * nx + rvPcYear * ux);
            y = distance * uy + dt * (distance * pmRa * masToRad * ey + distance * pmDec * masToRad * ny + rvPcYear * uy);
            z = distance * uz + dt * (distance * pmDec * masToRad * nz + rvPcYear * uz);
        } else {
            const vx = (pmRa * ex + pmDec * nx) * masToRad;
            const vy = (pmRa * ey + pmDec * ny) * masToRad;
            const vz = pmDec * nz * masToRad, omega = Math.hypot(vx, vy, vz);
            if (omega > 0) {
                const angle = omega * dt, c = Math.cos(angle), k = Math.sin(angle) / omega;
                x = ux * c + vx * k;
                y = uy * c + vy * k;
                z = uz * c + vz * k;
            } else {
                x = ux;
                y = uy;
                z = uz;
            }
        }
        const inv = 1 / (Math.hypot(x, y, z) || 1);
        return this._sceneVecFromUnit({
            x: x * inv,
            y: y * inv,
            z: z * inv
        }, out);
    }
    _refreshMotion(year) {
        if (this._lastMotionYear !== undefined && Math.abs(year - this._lastMotionYear) < 1 / (365.25 * 24)) return;
        const starAttr = this._starPositionAttribute;
        if (!starAttr) return;
        const n = CONST_DATA.stars.length / 4, v = new this.THREE.Vector3;
        for (let i = 0; i < n; i++) {
            this._starScenePosition(i, year, v);
            starAttr.setXYZ(i, v.x, v.y, v.z);
        }
        starAttr.needsUpdate = true;
        this._refreshStarInstances(this.stars);
        this._refreshStarInstances(this.figureEndpointStars);
        this._refreshStarInstances(this.namedStars);
        const F = CONST_DATA.figures, lineAttr = this.figures?.geometry?.attributes?.position;
        if (lineAttr) {
            for (let i = 0; i < F.length / 3; i++) {
                const a = F[i * 3 + 1], b = F[i * 3 + 2];
                lineAttr.setXYZ(i * 2, starAttr.getX(a), starAttr.getY(a), starAttr.getZ(a));
                lineAttr.setXYZ(i * 2 + 1, starAttr.getX(b), starAttr.getY(b), starAttr.getZ(b));
            }
            lineAttr.needsUpdate = true;
        }
        for (const label of this.starLabels || []) {
            const i = label.userData.starIndex;
            if (Number.isInteger(i) && i >= 0 && i < n) label.position.fromBufferAttribute(starAttr, i);
        }
        this._lastMotionYear = year;
    }
    _buildStars() {
        const T = this.THREE;
        const S = CONST_DATA.stars;
        const n = S.length / 4;
        const positions = new Float32Array(n * 3);
        const colors = new Float32Array(n * 3);
        const pointColors = new Float32Array(n * 3);
        const radiusScales = new Float32Array(n);
        const v = new T.Vector3;
        for (let i = 0; i < n; i++) {
            const ra = S[i * 4];
            const dec = S[i * 4 + 1];
            const V = S[i * 4 + 2];
            this._sceneVecFromUnit(this._unitVec(ra, dec, v), v);
            positions[i * 3] = v.x;
            positions[i * 3 + 1] = v.y;
            positions[i * 3 + 2] = v.z;
            const h = this.rnd();
            const c = hslToRgb(h, .18 + .12 * this.rnd(), .86 + .1 * this.rnd());
            const distancePc = catalogStarDistancePc(i);
            const distanceKm = distancePc * PARSEC_KM;
            const radiusKm = catalogStarRadiusKm(i);
            const angularRadius = distancePc > 0 ? Math.atan2(radiusKm, distanceKm) : 0;
            radiusScales[i] = Math.sin(angularRadius);
            const magnitudeSignal = Math.max(.3, Math.min(4.6, .72 * (.5 + 2.4 * Math.pow(10, -.16 * V))));
            const brightness = Math.max(.12, Math.min(1, magnitudeSignal * magnitudeSignal / 9));
            colors[i * 3] = c[0] * brightness;
            colors[i * 3 + 1] = c[1] * brightness;
            colors[i * 3 + 2] = c[2] * brightness;
            const flux = Math.min(1.5, Math.pow(10, -.4 * V) * STAR_POINT_EXPOSURE);
            pointColors[i * 3] = c[0] * flux;
            pointColors[i * 3 + 1] = c[1] * flux;
            pointColors[i * 3 + 2] = c[2] * flux;
        }
        this._starPositionAttribute = new T.BufferAttribute(positions, 3);
        this._starRadiusScales = radiusScales;
        this._starColors = colors;
        this._starCount = n;
        this._starSphereGeometry = new T.IcosahedronGeometry(1, 0);
        this.starMaterial = new T.MeshBasicMaterial({
            color: 16777215,
            transparent: true,
            blending: T.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            toneMapped: false,
            fog: false
        });
        this.stars = this._makeStarInstances(null, "Catalog stars · physical angular discs");
        this.stars.renderOrder = -500;
        this.group.add(this.stars);
        const pointGeometry = new T.BufferGeometry;
        pointGeometry.setAttribute("position", this._starPositionAttribute);
        pointGeometry.setAttribute("color", new T.BufferAttribute(pointColors, 3));
        this.starPointMaterial = new T.PointsMaterial({
            size: 1,
            sizeAttenuation: false,
            vertexColors: true,
            transparent: true,
            opacity: 1,
            blending: T.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            toneMapped: false,
            fog: false
        });
        this.starPointSources = new T.Points(pointGeometry, this.starPointMaterial);
        this.starPointSources.name = "Catalog star point-source flux";
        this.starPointSources.renderOrder = -499;
        this.starPointSources.frustumCulled = false;
        this.starPointSources.raycast = () => {};
        this.group.add(this.starPointSources);
    }
    _makeStarInstances(indices, name) {
        const T = this.THREE;
        const catalogIndices = indices ? Array.from(indices) : Array.from({
            length: this._starCount
        }, (_, index) => index);
        const geometry = this._starSphereGeometry.clone();
        const mesh = new T.InstancedMesh(geometry, this.starMaterial, catalogIndices.length);
        const position = new T.Vector3;
        const scale = new T.Vector3;
        const rotation = new T.Quaternion;
        const matrix = new T.Matrix4;
        const color = new T.Color;
        for (let instance = 0; instance < catalogIndices.length; instance++) {
            const starIndex = catalogIndices[instance];
            position.fromBufferAttribute(this._starPositionAttribute, starIndex);
            scale.setScalar(this._starRadiusScales[starIndex]);
            matrix.compose(position, rotation, scale);
            mesh.setMatrixAt(instance, matrix);
            color.setRGB(this._starColors[starIndex * 3], this._starColors[starIndex * 3 + 1], this._starColors[starIndex * 3 + 2]);
            mesh.setColorAt(instance, color);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.name = name;
        mesh.userData.catalogIndices = catalogIndices;
        mesh.frustumCulled = false;
        mesh.raycast = () => {};
        return mesh;
    }
    _refreshStarInstances(mesh) {
        const catalogIndices = mesh?.userData?.catalogIndices;
        if (!catalogIndices?.length) return;
        const position = new this.THREE.Vector3;
        const scale = new this.THREE.Vector3;
        const rotation = new this.THREE.Quaternion;
        const matrix = new this.THREE.Matrix4;
        for (let instance = 0; instance < catalogIndices.length; instance++) {
            const starIndex = catalogIndices[instance];
            position.fromBufferAttribute(this._starPositionAttribute, starIndex);
            scale.setScalar(this._starRadiusScales[starIndex]);
            matrix.compose(position, rotation, scale);
            mesh.setMatrixAt(instance, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
    }
    _buildFigures() {
        const T = this.THREE;
        const S = CONST_DATA.stars;
        const F = CONST_DATA.figures;
        const n = F.length / 3;
        const pos = new Float32Array(n * 2 * 3);
        const v = new T.Vector3;
        for (let i = 0; i < n; i++) {
            const a = F[i * 3 + 1] * 4;
            const b = F[i * 3 + 2] * 4;
            this._sceneVecFromUnit(this._unitVec(S[a], S[a + 1], v), v);
            pos[i * 6] = v.x;
            pos[i * 6 + 1] = v.y;
            pos[i * 6 + 2] = v.z;
            this._sceneVecFromUnit(this._unitVec(S[b], S[b + 1], v), v);
            pos[i * 6 + 3] = v.x;
            pos[i * 6 + 4] = v.y;
            pos[i * 6 + 5] = v.z;
        }
        const geometry = new T.BufferGeometry;
        geometry.setAttribute("position", new T.BufferAttribute(pos, 3));
        this.figureMaterial = new T.ShaderMaterial({
            uniforms: {
                uColor: {
                    value: new T.Color(9417446)
                },
                uOpacity: {
                    value: .46
                }
            },
            vertexShader: `\n        void main() {\n          vec4 mv = modelViewMatrix * vec4(position, 1.0);\n          gl_Position = projectionMatrix * mv;\n          gl_Position.z = gl_Position.w * 0.99997;\n        }\n      `,
            fragmentShader: `\n        uniform vec3 uColor;\n        uniform float uOpacity;\n        void main() {\n          gl_FragColor = vec4(uColor, uOpacity);\n        }\n      `,
            transparent: true,
            blending: T.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            toneMapped: false,
            fog: false
        });
        this.figures = new T.LineSegments(geometry, this.figureMaterial);
        this.figures.frustumCulled = false;
        this.figures.renderOrder = -400;
        this.group.add(this.figures);
    }
    _buildFigureEndpointStars() {
        const F = CONST_DATA.figures;
        const endpointSet = new Set;
        for (let i = 0; i < F.length / 3; i++) {
            endpointSet.add(F[i * 3 + 1]);
            endpointSet.add(F[i * 3 + 2]);
        }
        this.figureEndpointStars = this._makeStarInstances(endpointSet, "Constellation figure endpoint stars");
        this.figureEndpointStars.renderOrder = -450;
        this.figureEndpointStars.visible = false;
        this.group.add(this.figureEndpointStars);
    }
    _buildBoundaries() {
        const T = this.THREE;
        const G = CONST_DATA.segs;
        const segCounts = CONST_DATA.segCounts;
        let pairCount = 0;
        for (const c of segCounts) pairCount += c - 1;
        const pos = new Float32Array(pairCount * 2 * 3);
        const v = new T.Vector3;
        let o = 0;
        let g = 0;
        for (let r = 0; r < segCounts.length; r++) {
            const c = segCounts[r];
            const p = new Float64Array(c * 3);
            for (let k = 0; k < c; k++) {
                this._sceneVecFromUnit(this._unitVec(G[g], G[g + 1], v), v);
                g += 2;
                p[k * 3] = v.x;
                p[k * 3 + 1] = v.y;
                p[k * 3 + 2] = v.z;
            }
            for (let k = 0; k < c - 1; k++) {
                pos[o++] = p[k * 3];
                pos[o++] = p[k * 3 + 1];
                pos[o++] = p[k * 3 + 2];
                pos[o++] = p[(k + 1) * 3];
                pos[o++] = p[(k + 1) * 3 + 1];
                pos[o++] = p[(k + 1) * 3 + 2];
            }
        }
        const geometry = new T.BufferGeometry;
        geometry.setAttribute("position", new T.BufferAttribute(pos, 3));
        this.boundaryMaterial = new T.ShaderMaterial({
            uniforms: {
                uColor: {
                    value: new T.Color(14478079)
                },
                uOpacity: {
                    value: .58
                }
            },
            vertexShader: `\n        void main() {\n          vec4 mv = modelViewMatrix * vec4(position, 1.0);\n          gl_Position = projectionMatrix * mv;\n          gl_Position.z = gl_Position.w * 0.99996;\n        }\n      `,
            fragmentShader: `\n        uniform vec3 uColor;\n        uniform float uOpacity;\n        void main() {\n          gl_FragColor = vec4(uColor * uOpacity, uOpacity);\n        }\n      `,
            transparent: true,
            blending: T.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            toneMapped: false,
            fog: false
        });
        this.boundaries = new T.LineSegments(geometry, this.boundaryMaterial);
        this.boundaries.frustumCulled = false;
        this.boundaries.renderOrder = -300;
        this.group.add(this.boundaries);
    }
    _buildLabels(CSS2DObject) {
        const T = this.THREE;
        const L = CONST_DATA.labels;
        for (let i = 0; i < 88; i++) {
            const el = document.createElement("div");
            el.className = "constellation-label";
            el.textContent = CONST_DATA.names[i];
            const obj = new CSS2DObject(el);
            obj.center?.set(.5, .5);
            obj.userData.constellationIndex = i;
            this._sceneVecFromUnit(this._unitVec(L[i * 2], L[i * 2 + 1], new T.Vector3), obj.position);
            this.group.add(obj);
            this.labels.push(obj);
        }
        const N = CONST_DATA.starNames;
        const labelByIndex = new Map;
        for (let i = 0; i < N.length; i += 2) labelByIndex.set(Number(N[i]), String(N[i + 1]));
        const endpointSet = new Set;
        const F = CONST_DATA.figures;
        for (let i = 0; i < F.length / 3; i++) {
            endpointSet.add(F[i * 3 + 1]);
            endpointSet.add(F[i * 3 + 2]);
        }
        for (const starIndex of endpointSet) {
            if (labelByIndex.has(starIndex)) continue;
            const designation = STAR_DESIGNATIONS[starIndex];
            if (designation) labelByIndex.set(starIndex, String(designation));
        }
        this._labelMag = [];
        for (const [starIndex, labelText] of [ ...labelByIndex.entries() ].sort((a, b) => a[0] - b[0])) {
            const idx = starIndex * 4;
            const el = document.createElement("div");
            el.className = "star-name-label";
            el.textContent = labelText;
            const obj = new CSS2DObject(el);
            if (!Number.isInteger(starIndex) || starIndex < 0 || starIndex >= this._starPositionAttribute.count) {
                console.warn("Invalid named-star catalog index", labelText, starIndex);
                continue;
            }
            obj.position.fromBufferAttribute(this._starPositionAttribute, starIndex);
            obj.userData.starIndex = starIndex;
            obj.center?.set(.5, .5);
            this.group.add(obj);
            this.starLabels.push(obj);
            this._labelMag.push(CONST_DATA.stars[idx + 2]);
        }
        this._namedStarIndices = new Set(this.starLabels.map(label => label.userData.starIndex));
        this.namedStars = this._makeStarInstances(this._namedStarIndices, "Named catalog stars · label anchors");
        this.namedStars.renderOrder = -500;
        this.namedStars.visible = false;
        this.group.add(this.namedStars);
        this.hoverNames = STAR_DESIGNATIONS;
        this.hoverPoints = this.stars;
    }
    getLabelAudit() {
        const T = this.THREE, positions = this._starPositionAttribute;
        const angle = (a, b) => a.clone().normalize().angleTo(b.clone().normalize()) / DEG;
        const stars = this.starLabels.map(label => {
            const index = label.userData.starIndex, target = (new T.Vector3).fromBufferAttribute(positions, index);
            return {
                name: label.element.textContent,
                index: index,
                raDegrees: CONST_DATA.stars[index * 4],
                decDegrees: CONST_DATA.stars[index * 4 + 1],
                anchorErrorArcsec: angle(label.position, target) * 3600
            };
        });
        const constellations = this.labels.map((label, index) => {
            const ra = CONST_DATA.labels[index * 2], dec = CONST_DATA.labels[index * 2 + 1];
            const region = this._pic ? this.constellationAt(ra, dec) : null;
            const ids = new Set;
            for (let j = 0; j < CONST_DATA.figures.length; j += 3) if (Number(CONST_DATA.figures[j]) === index) {
                ids.add(Number(CONST_DATA.figures[j + 1]));
                ids.add(Number(CONST_DATA.figures[j + 2]));
            }
            const center = new T.Vector3;
            for (const i of ids) if (Number.isInteger(i) && i >= 0 && i < positions.count) center.add((new T.Vector3).fromBufferAttribute(positions, i));
            const candidate = center.lengthSq() > 1e-12 ? sceneToEq(center.normalize(), {}) : null;
            return {
                name: label.element.textContent,
                raDegrees: ra,
                decDegrees: dec,
                containingRegion: region?.name || null,
                figureStarCount: ids.size,
                candidateFigureCenter: candidate,
                figureCenterOffsetDegrees: candidate ? angle(label.position, center) : null
            };
        });
        return {
            note: "Catalog self-consistency audit. Figure centroids assume zero-based constellation tags. A figure centroid is not the same as a boundary-region center. CSS offsets and external name identities are not verified here.",
            stars: stars,
            constellations: constellations
        };
    }
    pickStarName(clientX, clientY, camera, width, height) {
        if (!this.hoverPoints || !this.hoverNames || !(width > 0 && height > 0) || !this.group.visible) return null;
        if (!this.stars.visible && !this.namedStars?.visible) return null;
        if (!this._pickScreen) this._pickScreen = new this.THREE.Vector3;
        this.hoverPoints.updateWorldMatrix(true, false);
        camera.updateMatrixWorld();
        const positions = this._starPositionAttribute;
        let best = -1, bestDistance = 49;
        for (let i = 0; i < positions.count; i++) {
            if (!this.hoverNames[i] || !this.stars.visible && !this._namedStarIndices?.has(i)) continue;
            this._pickScreen.fromBufferAttribute(positions, i).applyMatrix4(this.hoverPoints.matrixWorld).project(camera);
            if (this._pickScreen.z < -1 || this._pickScreen.z > 1) continue;
            const x = (this._pickScreen.x * .5 + .5) * width, y = (-this._pickScreen.y * .5 + .5) * height;
            const d = (x - clientX) ** 2 + (y - clientY) ** 2;
            if (d < bestDistance) {
                bestDistance = d;
                best = i;
            }
        }
        return best < 0 ? null : this.hoverNames[best];
    }
    _buildPointInConstellation() {
        const boundaryPoints = this._projectBoundaryPoints();
        const {centers: centers, bases: bases} = this._constellationBases();
        const recordStarts = this._boundaryRecordStarts();
        const polys = this._constellationEdges(boundaryPoints, bases, recordStarts);
        this._pic = {
            centers: centers,
            bases: bases,
            polys: polys
        };
    }
    _projectBoundaryPoints() {
        const G = CONST_DATA.segs;
        const T = this.THREE;
        const v = new T.Vector3;
        const vertexCount = G.length / 2;
        const points = new Float64Array(vertexCount * 3);
        for (let i = 0; i < vertexCount; i++) {
            this._sceneVecFromUnit(this._unitVec(G[i * 2], G[i * 2 + 1], v), v);
            points[i * 3] = v.x;
            points[i * 3 + 1] = v.y;
            points[i * 3 + 2] = v.z;
        }
        this._bp = points;
        return points;
    }
    _boundaryRecordStarts() {
        const segCounts = CONST_DATA.segCounts;
        const starts = new Array(segCounts.length);
        let acc = 0;
        for (let r = 0; r < segCounts.length; r++) {
            starts[r] = acc;
            acc += segCounts[r];
        }
        return starts;
    }
    _constellationBases() {
        const L = CONST_DATA.labels;
        const T = this.THREE;
        const v = new T.Vector3;
        const centers = new Array(88);
        const bases = new Array(88);
        for (let i = 0; i < 88; i++) {
            this._sceneVecFromUnit(this._unitVec(L[i * 2], L[i * 2 + 1], v), v);
            const n = Math.hypot(v.x, v.y, v.z) || 1;
            const c = {
                x: v.x / n,
                y: v.y / n,
                z: v.z / n
            };
            centers[i] = c;
            const ref = Math.abs(c.z) < .9 ? {
                x: 0,
                y: 0,
                z: 1
            } : {
                x: 1,
                y: 0,
                z: 0
            };
            const e1x = c.y * ref.z - c.z * ref.y;
            const e1y = c.z * ref.x - c.x * ref.z;
            const e1z = c.x * ref.y - c.y * ref.x;
            const n1 = Math.hypot(e1x, e1y, e1z) || 1;
            const e1 = {
                x: e1x / n1,
                y: e1y / n1,
                z: e1z / n1
            };
            const e2 = {
                x: e1.y * c.z - e1.z * c.y,
                y: e1.z * c.x - e1.x * c.z,
                z: e1.x * c.y - e1.y * c.x
            };
            bases[i] = {
                e1: e1,
                e2: e2
            };
        }
        return {
            centers: centers,
            bases: bases
        };
    }
    _constellationEdges(boundaryPoints, bases, recordStarts) {
        const segCounts = CONST_DATA.segCounts;
        const polys = new Array(88);
        for (let ci = 0; ci < 88; ci++) {
            const frame = bases[ci];
            const edges = [];
            for (const r of CONST_DATA.polys[ci]) {
                const c = segCounts[r];
                const p0 = recordStarts[r];
                for (let k = 0; k < c - 1; k++) {
                    const i0 = p0 + k;
                    const i1 = p0 + k + 1;
                    edges.push(boundaryPoints[i0 * 3] * frame.e1.x + boundaryPoints[i0 * 3 + 1] * frame.e1.y + boundaryPoints[i0 * 3 + 2] * frame.e1.z, boundaryPoints[i0 * 3] * frame.e2.x + boundaryPoints[i0 * 3 + 1] * frame.e2.y + boundaryPoints[i0 * 3 + 2] * frame.e2.z, boundaryPoints[i1 * 3] * frame.e1.x + boundaryPoints[i1 * 3 + 1] * frame.e1.y + boundaryPoints[i1 * 3 + 2] * frame.e1.z, boundaryPoints[i1 * 3] * frame.e2.x + boundaryPoints[i1 * 3 + 1] * frame.e2.y + boundaryPoints[i1 * 3 + 2] * frame.e2.z);
                }
            }
            polys[ci] = edges;
        }
        return polys;
    }
    constellationAt(ra, dec) {
        if (!this._pic || !Number.isFinite(ra) || !Number.isFinite(dec)) return null;
        const a = ra * DEG;
        const d = dec * DEG;
        const x = Math.cos(d) * Math.cos(a);
        const y = Math.cos(d) * Math.sin(a);
        const z = Math.sin(d);
        const X = x;
        const Y = y * COS_EPS + z * SIN_EPS;
        const Z = -y * SIN_EPS + z * COS_EPS;
        const v = {
            x: X,
            y: Z,
            z: -Y
        };
        const {centers: centers, bases: bases, polys: polys} = this._pic;
        const hit = [];
        for (let i = 0; i < 88; i++) {
            const c = centers[i];
            if (v.x * c.x + v.y * c.y + v.z * c.z <= 0) continue;
            const edges = polys[i];
            const e = bases[i];
            const ppx = v.x * e.e1.x + v.y * e.e1.y + v.z * e.e1.z;
            const ppy = v.x * e.e2.x + v.y * e.e2.y + v.z * e.e2.z;
            let cnt = 0;
            for (let k = 0; k < edges.length; k += 4) {
                const ax = edges[k], ay = edges[k + 1], bx = edges[k + 2], by = edges[k + 3];
                if (ay > ppy !== by > ppy) {
                    const xint = ax + (ppy - ay) * (bx - ax) / (by - ay);
                    if (xint > ppx) cnt++;
                }
            }
            if (cnt % 2 === 1) hit.push(i);
        }
        if (hit.length === 0) return null;
        let best = hit[0];
        for (const i of hit) {
            const d = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
            if (d(v, centers[i]) > d(v, centers[best])) best = i;
        }
        return {
            name: CONST_DATA.names[best],
            abbr: CONST_DATA.abbr[best]
        };
    }
    declutterStarLabels(camera, width, height, opts = {}) {
        if (!camera) return;
        const T = this.THREE;
        if (!this._dcV) {
            this._dcV = new T.Vector3;
            this._dcOrder = this.starLabels.map((_, i) => i).sort((a, b) => (this._labelMag[a] ?? 99) - (this._labelMag[b] ?? 99));
            this._dcSize = new Array(this.starLabels.length).fill(null);
            this._dcConOrder = this.labels.map((_, i) => i);
            this._dcPlacedPool = [];
            this._dcBoxPool = [];
            this._dcNamePool = [];
            this._dcNames = [];
            this._dcProjected = { x: 0, y: 0 };
        }
        const starBudget = Number.isFinite(opts.starBudget) ? opts.starBudget : Infinity;
        const conBudget = Number.isFinite(opts.constellationBudget) ? opts.constellationBudget : Infinity;
        const placed = this._dcPlacedPool;
        placed.length = 0;
        const project = (label, el, out) => {
            if (!label.visible) {
                el.style.visibility = "hidden";
                el.style.opacity = "0";
                return null;
            }
            this._dcV.copy(label.position).applyMatrix4(this.group.matrixWorld).project(camera);
            if (this._dcV.z < -1 || this._dcV.z > 1) {
                el.style.visibility = "hidden";
                return null;
            }
            const x = (this._dcV.x * .5 + .5) * width;
            const y = (-this._dcV.y * .5 + .5) * height;
            if (x < -140 || x > width + 140 || y < -70 || y > height + 70) {
                el.style.visibility = "hidden";
                return null;
            }
            el.style.visibility = "visible";
            out.x = x;
            out.y = y;
            return out;
        };
        const place = (x, y, w, h) => {
            const index = placed.length;
            let box = this._dcBoxPool[index];
            if (!box) this._dcBoxPool[index] = box = { x: 0, y: 0, w: 0, h: 0 };
            box.x = x;
            box.y = y;
            box.w = w;
            box.h = h;
            placed.push(box);
        };
        const fits = (x, y, w, h, pad) => {
            for (const k of placed) {
                if (Math.abs(x - k.x) * 2 < w + k.w + pad * 2 && Math.abs(y - k.y) * 2 < h + k.h + pad * 2) return false;
            }
            return true;
        };
        const names = this._dcNames;
        names.length = 0;
        let nameCount = 0;
        for (const i of this._dcConOrder) {
            const label = this.labels[i];
            const el = label?.element;
            if (!el) continue;
            let entry = this._dcNamePool[nameCount];
            if (!entry) this._dcNamePool[nameCount] = entry = { label: null, p: { x: 0, y: 0 }, rank: 0 };
            const p = project(label, el, entry.p);
            if (p) {
                entry.label = label;
                entry.rank = Math.hypot(p.x - width / 2, p.y - height / 2);
                names.push(entry);
                nameCount++;
            }
        }
        names.sort((a, b) => a.rank - b.rank);
        let conKept = 0;
        for (const entry of names) {
            const label = entry?.label;
            const el = label?.element;
            if (!el) continue;
            const w = el.offsetWidth || 96, h = el.offsetHeight || 18;
            if (conKept >= conBudget || !fits(entry.p.x, entry.p.y, w, h, 26)) {
                el.style.opacity = "0";
                continue;
            }
            place(entry.p.x, entry.p.y, w, h);
            el.style.opacity = "1";
            conKept++;
        }
        let starKept = 0;
        for (const i of this._dcOrder) {
            const label = this.starLabels[i];
            if (!label?.element) continue;
            const el = label.element;
            const p = project(label, el, this._dcProjected);
            if (!p) continue;
            let sz = this._dcSize[i];
            if (!sz) {
                const w = el.offsetWidth || 60, h = el.offsetHeight || 14;
                sz = this._dcSize[i] = {
                    w: w,
                    h: h
                };
            }
            if (starKept >= starBudget || !fits(p.x, p.y, sz.w, sz.h, 12)) {
                el.style.opacity = "0";
                continue;
            }
            place(p.x, p.y, sz.w, sz.h);
            el.style.opacity = "1";
            starKept++;
        }
        this._dcKeptCount = starKept;
        this._dcConKeptCount = conKept;
    }
    setOccluderProvider(provider) {
        this._labelOccProvider = typeof provider === "function" ? provider : null;
    }
    _isLabelOccluderOwnObject(obj) {
        for (let p = obj; p; p = p.parent) {
            if (p === this.group) return true;
        }
        return false;
    }
    _labelOccluders(camera, width, height) {
        const cache = this._labelOcc.items;
        cache.length = 0;
        if (!camera || !this._labelOccProvider) return cache;
        const list = this._labelOccProvider() || [];
        const focal = .5 * height * camera.projectionMatrix.elements[5];
        camera.getWorldPosition(this._labelOcc.camera);
        for (const obj of list) {
            if (!obj || !obj.visible || !obj.geometry || this._isLabelOccluderOwnObject(obj)) continue;
            const name = String(obj.name || "") + " " + String(obj.userData?.planetKey || "") + " " + String(obj.userData?.planetName || "");
            if (obj.userData?.isPopulationAnchor || /sky|constellation|orbit|trail|path|label|ring|belt|marker|guide/i.test(name)) continue;
            const geometry = obj.geometry;
            if (!geometry.boundingSphere && typeof geometry.computeBoundingSphere === "function") {
                try {
                    geometry.computeBoundingSphere();
                } catch (e) {}
            }
            const sphere = geometry.boundingSphere;
            if (!sphere) continue;
            obj.updateWorldMatrix(true, false);
            this._labelOcc.center.copy(sphere.center).applyMatrix4(obj.matrixWorld);
            obj.getWorldScale(this._labelOcc.scale);
            const scale = Math.max(Math.abs(this._labelOcc.scale.x), Math.abs(this._labelOcc.scale.y), Math.abs(this._labelOcc.scale.z));
            const radius = sphere.radius * scale;
            if (!Number.isFinite(radius) || radius <= 0 || radius > CATALOG_REFERENCE_RADIUS * .08) continue;
            const dist = this._labelOcc.camera.distanceTo(this._labelOcc.center);
            if (!Number.isFinite(dist) || dist <= radius * .05) continue;
            this._labelOcc.screen.copy(this._labelOcc.center).project(camera);
            if (this._labelOcc.screen.z < -1 || this._labelOcc.screen.z > 1) continue;
            const px = radius * focal / Math.sqrt(Math.max(1e-6, dist * dist - radius * radius));
            if (!Number.isFinite(px) || px <= 0) continue;
            const x = (this._labelOcc.screen.x * .5 + .5) * width;
            const y = (-this._labelOcc.screen.y * .5 + .5) * height;
            if (x < -px || x > width + px || y < -px || y > height + px) continue;
            cache.push({
                x: x,
                y: y,
                r: px + 1.5,
                nearDistance: dist - radius
            });
        }
        return cache;
    }
    _skyLabelOccluded(label, camera, occluders, width, height) {
        this._labelOcc.world.copy(label.position).applyMatrix4(this.group.matrixWorld);
        this._labelOcc.screen.copy(this._labelOcc.world).project(camera);
        if (this._labelOcc.screen.z < -1 || this._labelOcc.screen.z > 1) return true;
        const x = (this._labelOcc.screen.x * .5 + .5) * width;
        const y = (-this._labelOcc.screen.y * .5 + .5) * height;
        const labelDistance = this._labelOcc.camera.distanceTo(this._labelOcc.world);
        const labelWidth = Math.max(1, label.element?.offsetWidth || 1);
        const labelHeight = Math.max(1, label.element?.offsetHeight || 1);
        const left = x - labelWidth * .5;
        const right = x + labelWidth * .5;
        const top = y - labelHeight * .5;
        const bottom = y + labelHeight * .5;
        for (let i = 0; i < occluders.length; i++) {
            const o = occluders[i];
            if (o.nearDistance > labelDistance) continue;
            const nearestX = Math.max(left, Math.min(right, o.x));
            const nearestY = Math.max(top, Math.min(bottom, o.y));
            const dx = nearestX - o.x;
            const dy = nearestY - o.y;
            if (dx * dx + dy * dy <= o.r * o.r) return true;
        }
        return false;
    }
    updateLabelOcclusion(camera, width = window.innerWidth, height = window.innerHeight) {
        if (!camera) return;
        const conOn = this.labels.some(l => l.visible);
        const starOn = this.starLabels.some(l => l.visible);
        if (!conOn && !starOn) return;
        const occluders = this._labelOccluders(camera, width || 1, height || 1);
        for (const label of this.labels) {
            if (!label.element) continue;
            if (!label.visible) {
                label.element.style.visibility = "hidden";
                continue;
            }
            label.element.style.visibility = this._skyLabelOccluded(label, camera, occluders, width || 1, height || 1) ? "hidden" : "visible";
        }
        for (const label of this.starLabels) {
            if (!label.element) continue;
            if (!label.visible) {
                label.element.style.visibility = "hidden";
                continue;
            }
            label.element.style.visibility = this._skyLabelOccluded(label, camera, occluders, width || 1, height || 1) ? "hidden" : "visible";
        }
    }
    setRadius(r) {
        this._radius = r;
        this.group.scale.setScalar(r);
    }
    update(camera, radius, simTimeMs = Date.now()) {
        const t = Number.isFinite(simTimeMs) ? simTimeMs : Date.now();
        const year = 2e3 + (t - Date.UTC(2e3, 0, 1, 12)) / (365.25 * 864e5);
        this._refreshMotion(year);
        if (radius && isFinite(radius) && Math.abs((this._radius || 0) - radius) > .01) {
            this.setRadius(radius);
        }
        if (!camera) return;
        camera.getWorldPosition(this._tmpV);
        this.group.position.copy(this._tmpV);
        this.group.scale.setScalar(this._radius || SKY_RADIUS);
    }
    setVisibility(figuresOn, starsOn, starNamesOn) {
        if (this.figures) this.figures.visible = figuresOn;
        if (this.figureEndpointStars) this.figureEndpointStars.visible = figuresOn;
        if (this.boundaries) this.boundaries.visible = figuresOn;
        if (this.stars) this.stars.visible = true;
        if (this.starPointSources) this.starPointSources.visible = true;
        if (this.namedStars) this.namedStars.visible = false;
        for (const l of this.labels) l.visible = figuresOn;
        for (const l of this.starLabels) l.visible = starNamesOn;
    }
    dispose() {
        const disposedMaterials = new Set;
        this.group.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                for (const m of Array.isArray(o.material) ? o.material : [ o.material ]) if (!disposedMaterials.has(m)) {
                    disposedMaterials.add(m);
                    m.dispose();
                }
            }
            if (o.element && o.element.parentNode) o.element.parentNode.removeChild(o.element);
        });
        this._starSphereGeometry?.dispose();
        this.scene.remove(this.group);
    }
}
