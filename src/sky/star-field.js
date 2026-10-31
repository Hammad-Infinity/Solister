// Draws the star catalog on the sky dome.
//
// Positions come from the catalog's RA/Dec through eqUnitToScene(), the same
// conversion the constellation layer and the grid labels use. The Milky Way band
// reaches the same dome through galacticFrame(), which is built from that same
// conversion, so a star at galactic latitude zero always lands on the band.
import { SKY_RADIUS } from "./sky-maps.js";
import { eqUnitToScene } from "./sky-frame.js";
// Loaded, not imported: a missing catalogue has to cost the star layer, not the
// whole app. As a static import, one 404 in data/ took `main.js` down with it and
// the page stopped at the loading screen with no renderer at all.
const catalogModule = await import("../../data/sky/star-catalog.js").catch(error => {
    console.warn("[Solister] star catalogue missing; the star layer is disabled.", error && error.message);
    return { STAR_CATALOG: [], STAR_CATALOG_NOTE: "catalogue unavailable" };
});
const { STAR_CATALOG, STAR_CATALOG_NOTE } = catalogModule;

const DEG = Math.PI / 180;

// Point sprite size in device pixels, from apparent magnitude.
const SIZE_MIN = 1.1;

const SIZE_SLOPE = .85;

const SIZE_MAX = 8;

const VERTEX_SHADER = `
attribute float aSize;
attribute vec3 aColor;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
}
`;

const FRAGMENT_SHADER = `
varying vec3 vColor;
void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float a = smoothstep(0.25, 0.02, r2);
    gl_FragColor = vec4(vColor * a, a);
}
`;

// Blackbody to display colour, normalised to peak channel one.
function temperatureRgb(kelvin) {
    const t = Math.max(1000, kelvin) / 100;
    let r, g, b;
    if (t <= 66) {
        r = 255;
        g = 99.4708025861 * Math.log(t) - 161.1195681661;
        b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    } else {
        r = 329.698727446 * Math.pow(t - 60, -.1332047592);
        g = 288.1221695283 * Math.pow(t - 60, -.0755148492);
        b = 255;
    }
    const clamp = v => Math.max(0, Math.min(255, v)) / 255;
    return [ clamp(r), clamp(g), clamp(b) ];
}

export class StarField {
    constructor(o) {
        this.THREE = o.THREE;
        this.scene = o.scene;
        this.radius = o.radius || SKY_RADIUS;
        this.catalog = STAR_CATALOG;
        this.group = new this.THREE.Group;
        this.group.name = "star-field";
        this.scene.add(this.group);
        this._tmp = new this.THREE.Vector3;
        this._build();
    }
    _build() {
        const T = this.THREE;
        const C = this.catalog;
        const n = C.count;
        const positions = new Float32Array(n * 3);
        const colors = new Float32Array(n * 3);
        const sizes = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const ra = C.ra[i] * DEG, dec = C.dec[i] * DEG;
            const eq = {
                x: Math.cos(dec) * Math.cos(ra),
                y: Math.cos(dec) * Math.sin(ra),
                z: Math.sin(dec)
            };
            eqUnitToScene(eq, this._tmp);
            positions[i * 3] = this._tmp.x;
            positions[i * 3 + 1] = this._tmp.y;
            positions[i * 3 + 2] = this._tmp.z;
            const rgb = temperatureRgb(C.temp[i]);
            // Brightness is compressed; size carries most of the magnitude range.
            const level = Math.min(1, .35 * Math.pow(10, -.25 * (C.mag[i] - 6.5)));
            colors[i * 3] = rgb[0] * level;
            colors[i * 3 + 1] = rgb[1] * level;
            colors[i * 3 + 2] = rgb[2] * level;
            sizes[i] = Math.min(SIZE_MAX, SIZE_MIN + (6.5 - C.mag[i]) * SIZE_SLOPE);
        }
        const geometry = new T.BufferGeometry;
        geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
        geometry.setAttribute("aColor", new T.BufferAttribute(colors, 3));
        geometry.setAttribute("aSize", new T.BufferAttribute(sizes, 1));
        geometry.boundingSphere = new T.Sphere(new T.Vector3, 1.01);
        this.material = new T.ShaderMaterial({
            uniforms: {
                uPixelRatio: {
                    value: Math.min(2, globalThis.devicePixelRatio || 1)
                }
            },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            transparent: true,
            blending: T.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            toneMapped: false,
            fog: false
        });
        this.points = new T.Points(geometry, this.material);
        this.points.name = "star-field-points";
        this.points.frustumCulled = false;
        this.points.renderOrder = -600;
        this.group.add(this.points);
        globalThis.__solisterStars = {
            count: n,
            note: STAR_CATALOG_NOTE,
            radius: this.radius
        };
    }
    // The dome follows the camera, so the catalog stays at infinity.
    update(camera) {
        if (!camera) return;
        camera.getWorldPosition(this._tmp);
        this.group.position.copy(this._tmp);
        this.group.scale.setScalar(this.radius);
        // Point sizes are in device pixels, so they have to track a quality change.
        const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
        if (this.material.uniforms.uPixelRatio.value !== ratio) {
            this.material.uniforms.uPixelRatio.value = ratio;
        }
    }
    setRadius(radius) {
        if (Number.isFinite(radius) && radius > 0) this.radius = radius;
    }
    setVisible(visible) {
        this.group.visible = !!visible;
    }
    dispose() {
        this.points.geometry.dispose();
        this.material.dispose();
        this.scene.remove(this.group);
    }
}
