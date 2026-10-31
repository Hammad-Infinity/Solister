import { MILKYWAY_GLSL, createMilkyWayUniforms } from "./procedural-milkyway.js";

import { OBLIQUITY_RADIANS, eqUnitToScene, galacticBasis } from "./sky-frame.js";

const DEG = Math.PI / 180;

const COS_E = Math.cos(OBLIQUITY_RADIANS);

const SIN_E = Math.sin(OBLIQUITY_RADIANS);

export const SKY_RADIUS = 8e6;

export const SKY_LAYER_DEFS = {
    milkyway: {
        frame: "equatorial"
    },
    celgrid: {
        frame: "equatorial"
    },
    eclipticgrid: {
        frame: "ecliptic"
    },
    galacticgrid: {
        frame: "galactic"
    }
};

function buildEquirectSphere(THREE, frame, lonSegs = 360, latSegs = 180) {
    const vcount = (lonSegs + 1) * (latSegs + 1);
    const pos = new Float32Array(vcount * 3);
    const uv = new Float32Array(vcount * 2);
    const idx = new Uint32Array(lonSegs * latSegs * 6);
    const v3 = new THREE.Vector3;
    let p = 0, q = 0;
    for (let iy = 0; iy <= latSegs; iy++) {
        const v = iy / latSegs;
        const lat = 90 - 180 * v;
        for (let ix = 0; ix <= lonSegs; ix++) {
            const u = ix / lonSegs;
            const lon = ((180 - 360 * u) % 360 + 360) % 360;
            coordinateToScene(THREE, frame, lon, lat, v3);
            pos[p++] = v3.x;
            pos[p++] = v3.y;
            pos[p++] = v3.z;
            uv[q++] = u;
            uv[q++] = 1 - v;
        }
    }
    let k = 0;
    for (let iy = 0; iy < latSegs; iy++) {
        for (let ix = 0; ix < lonSegs; ix++) {
            const a = iy * (lonSegs + 1) + ix;
            const b = a + 1;
            const c = a + lonSegs + 1;
            const d = c + 1;
            idx[k++] = a; idx[k++] = c; idx[k++] = d;
            idx[k++] = a; idx[k++] = d; idx[k++] = b;
        }
    }
    const geo = new THREE.BufferGeometry;
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
}

function coordinateToScene(THREE, frame, lonDeg, latDeg, out = new THREE.Vector3) {
    const lon = lonDeg * DEG, lat = latDeg * DEG;
    const cl = Math.cos(lat);
    const eq = { x: cl * Math.cos(lon), y: cl * Math.sin(lon), z: Math.sin(lat) };
    if (frame === "ecliptic") {
        const y = eq.y * COS_E - eq.z * SIN_E;
        eq.z = eq.y * SIN_E + eq.z * COS_E;
        eq.y = y;
    } else if (frame === "galactic") {
        const basis = galacticBasis();
        const gx = eq.x, gy = eq.y, gz = eq.z;
        eq.x = basis.x[0] * gx + basis.y[0] * gy + basis.z[0] * gz;
        eq.y = basis.x[1] * gx + basis.y[1] * gy + basis.z[1] * gz;
        eq.z = basis.x[2] * gx + basis.y[2] * gy + basis.z[2] * gz;
    }
    return eqUnitToScene(eq, out);
}

function buildCoordinateGrid(THREE, frame) {
    const vertices = [];
    const addLine = points => {
        for (let i = 1; i < points.length; i++) {
            vertices.push(points[i - 1].x, points[i - 1].y, points[i - 1].z, points[i].x, points[i].y, points[i].z);
        }
    };
    for (let lat = -75; lat <= 75; lat += 15) {
        const points = [];
        for (let lon = 0; lon <= 360; lon += 1) points.push(coordinateToScene(THREE, frame, lon, lat));
        addLine(points);
    }
    for (let lon = 0; lon < 360; lon += 15) {
        const points = [];
        for (let lat = -82; lat <= 82; lat += 1) points.push(coordinateToScene(THREE, frame, lon, lat));
        addLine(points);
    }
    for (const lat of [ -82, 82 ]) {
        const points = [];
        for (let lon = 0; lon <= 360; lon += 1) points.push(coordinateToScene(THREE, frame, lon, lat));
        addLine(points);
    }
    const geometry = new THREE.BufferGeometry;
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    return geometry;
}

const GRID_LABEL_TEXTURES = new Map;

const GRID_LABEL_MATERIALS = new Map;

function makeGridLabelSprite(THREE, text, color, width) {
    const key = `${text}|${color}`;
    let texture = GRID_LABEL_TEXTURES.get(key);
    if (!texture) {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 160;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = "600 116px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 12;
        ctx.strokeStyle = "rgba(0,0,0,.55)";
        ctx.strokeText(text, 320, 80);
        ctx.fillStyle = color;
        ctx.fillText(text, 320, 80);
        texture = new THREE.CanvasTexture(canvas);
        if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
        GRID_LABEL_TEXTURES.set(key, texture);
    }
    let material = GRID_LABEL_MATERIALS.get(key);
    if (!material) {
        material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            toneMapped: false,
            opacity: .78
        });
        GRID_LABEL_MATERIALS.set(key, material);
    }
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(width, width * .3, 1);
    return sprite;
}

const SKY_VERT = `\n    varying vec2 vUv;\n    varying vec3 vSkyDirection;\n    void main() {\n        vUv = uv;\n        vSkyDirection=position;\n        vec4 mv = modelViewMatrix * vec4(position, 1.0);\n        gl_Position = projectionMatrix * mv;\n        gl_Position.z = gl_Position.w;\n    }\n`;

const SKY_MILKYWAY_FRAGMENT = `
uniform float uOpacity;
${MILKYWAY_GLSL}
varying vec3 vSkyDirection;
void main() {
    // milkyWayBand() already converts the fitted display-space sky into linear
    // light, undoing the roll-off itself, so this stage must not repeat either
    // step: that used to darken the band twice.
    vec3 col = milkyWayBand(vSkyDirection) * uOpacity;
    gl_FragColor = vec4(col, 1.0);
    // Linear light must be encoded like every other shader in the app; without
    // this the band renders about two stops dark and reads as black.
    #include <colorspace_fragment>
}
`;

export class SkyMaps {
    constructor(o) {
        this.THREE = o.THREE;
        this.scene = o.scene;
        this.renderer = o.renderer;
        this.milkywayOpacity = o.milkywayOpacity ?? 1;
        this.domeRadius = o.radius ?? SKY_RADIUS;
        this.group = new this.THREE.Group;
        this.group.name = "sky-maps";
        this.group.matrixAutoUpdate = true;
        this.scene.add(this.group);
        this._geoCache = new Map;
        this._state = {};
        this._tmpV = new this.THREE.Vector3;
        this._buildLayers();
        const tmp = this._tmpV;
        const self = this;
        const snap = (renderer, scene, camera) => {
            if (!camera) return;
            camera.getWorldPosition(tmp);
            self.group.position.copy(tmp);
            self.group.scale.setScalar(self.domeRadius);
            self.group.updateMatrixWorld(true);
        };
        this.group.traverse(obj => {
            if (obj.isMesh) {
                obj.onBeforeRender = snap;
                obj.frustumCulled = false;
            }
        });
        this.group.scale.setScalar(this.domeRadius);
    }
    _geometry(frame) {
        if (!this._geoCache.has(frame)) this._geoCache.set(frame, buildEquirectSphere(this.THREE, frame));
        return this._geoCache.get(frame);
    }
    _buildLayers() {
        const T = this.THREE;
        {
            const mat = new T.ShaderMaterial({
                uniforms: {
                    uOpacity: {
                        value: this.milkywayOpacity
                    },
                    ...createMilkyWayUniforms(T)
                },
                vertexShader: SKY_VERT,
                fragmentShader: SKY_MILKYWAY_FRAGMENT,
                side: T.DoubleSide,
                depthWrite: false,
                depthTest: true,
                transparent: false,
                blending: T.NormalBlending,
                toneMapped: false,
                fog: false
            });
            const mesh = new T.Mesh(this._geometry("equatorial"), mat);
            mesh.frustumCulled = false;
            mesh.renderOrder = -2100;
            mesh.visible = false;
            mesh.name = "sky-milkyway";
            this.group.add(mesh);
            this._state.milkyway = {
                mesh: mesh,
                ready: true,
                visible: false,
                procedural: true
            };
        }
        const addGridLayer = (key, frame, name, renderOrder, color) => {
            const hex = `#${Number(color).toString(16).padStart(6, "0")}`;
            const mat = new T.ShaderMaterial({
                uniforms: {
                    uOpacity: {
                        value: .5
                    },
                    uColor: {
                        value: new T.Color(color)
                    }
                },
                vertexShader: `varying float vViewZ; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vViewZ=mv.z; gl_Position=projectionMatrix*mv; }`,
                fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying float vViewZ; void main(){ if(vViewZ>=0.0) discard; gl_FragColor=vec4(uColor*uOpacity,uOpacity); }`,
                transparent: true,
                blending: T.AdditiveBlending,
                depthWrite: false,
                depthTest: true,
                toneMapped: false,
                fog: false
            });
            const gridGroup = new T.Group;
            gridGroup.name = name;
            gridGroup.matrixAutoUpdate = false;
            const lines = new T.LineSegments(buildCoordinateGrid(T, frame), mat);
            lines.frustumCulled = false;
            lines.renderOrder = renderOrder;
            gridGroup.add(lines);
            const labelAt = (text, lon, lat) => {
                const width = Math.min(.06, 15 * Math.PI / 180 * Math.cos(lat * Math.PI / 180) * .92);
                const sprite = makeGridLabelSprite(T, text, hex, width);
                if (!sprite) return;
                sprite.position.copy(coordinateToScene(T, frame, lon, lat)).multiplyScalar(1.001);
                sprite.renderOrder = renderOrder + 1;
                // Grid labels never move once placed. Left auto-updating they
                // cost a matrix rebuild each, every frame: 624 per grid, three
                // grids, ~1900 transforms for static text.
                sprite.matrixAutoUpdate = false;
                sprite.updateMatrix();
                gridGroup.add(sprite);
            };
            const markerLats = [ -82, -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 82 ];
            for (const lat of markerLats) {
                for (let lon = 0; lon < 360; lon += 15) {
                    let longitudeLabel, latitudeLabel;
                    if (frame === "equatorial") {
                        longitudeLabel = `${String(Math.round(lon / 15)).padStart(2, "0")}h`;
                        latitudeLabel = `${lat < 0 ? "-" : ""}${Math.abs(lat)}°`;
                    } else if (frame === "ecliptic") {
                        longitudeLabel = `λ ${String(lon).padStart(3, "0")}°`;
                        latitudeLabel = `β ${lat > 0 ? "+" : ""}${lat}°`;
                    } else {
                        longitudeLabel = `l ${String(lon).padStart(3, "0")}°`;
                        latitudeLabel = `b ${lat > 0 ? "+" : ""}${lat}°`;
                    }
                    labelAt(longitudeLabel, lon - 1, lat + 1);
                    labelAt(latitudeLabel, lon + 1, lat - 1);
                }
            }
            gridGroup.material = mat;
            this.group.add(gridGroup);
            this._state[key] = {
                mesh: gridGroup,
                ready: true,
                res: "procedural",
                visible: false,
                procedural: true
            };
        };
        addGridLayer("celgrid", "equatorial", "sky-equatorial-grid", -1800, 14411508);
        addGridLayer("eclipticgrid", "ecliptic", "sky-ecliptic-grid", -1790, 15784358);
        addGridLayer("galacticgrid", "galactic", "sky-galactic-grid", -1780, 13681650);
    }
    setLayerVisible(layer, visible) {
        const st = this._state[layer];
        if (!st) return;
        st.visible = !!visible;
        st.mesh.visible = !!visible;
        if (visible && !st._notifiedVisible) {
            st._notifiedVisible = true;
            if (this.onVisibilityApplied) this.onVisibilityApplied();
        }
        if (!visible) st._notifiedVisible = false;
    }
    update(camera) {
        if (!camera) return;
        if (isFinite(camera.far) && camera.far < this.domeRadius * 1.05) {
            camera.far = this.domeRadius * 1.25;
            camera.updateProjectionMatrix();
        }
        camera.getWorldPosition(this._tmpV);
        this.group.position.copy(this._tmpV);
        this.group.scale.setScalar(this.domeRadius);
    }
    dispose() {
        for (const g of this._geoCache.values()) g.dispose();
        const disposedMaterials = new Set;
        for (const st of Object.values(this._state)) {
            st.mesh.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                const mats = obj.material ? Array.isArray(obj.material) ? obj.material : [ obj.material ] : [];
                for (const mat of mats) {
                    if (!disposedMaterials.has(mat)) {
                        disposedMaterials.add(mat);
                        mat.dispose();
                    }
                }
            });
        }
        this.scene.remove(this.group);
    }
}
