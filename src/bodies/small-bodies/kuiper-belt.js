import { KuiperTable, makeBackground, toScene, DAY } from './kuiper-core.js';
import {LDB_VERTEX_PARS,LDB_VERTEX_TAIL,LDB_FRAGMENT_PARS,LDB_FRAGMENT_HEAD} from '../../render/log-depth-glsl.js';
const BACKGROUND_COUNT = 10000;
const backgroundVertex = `
attribute vec4 aOrbit; attribute vec4 aPhase;
uniform float uDays; uniform float uAU; uniform float uPixels;
varying float vBrightness;${LDB_VERTEX_PARS}
void main(){
    float a=aOrbit.x,e=aOrbit.y,inc=aOrbit.z,node=aOrbit.w,peri=aPhase.x;
    float M=mod(aPhase.y+aPhase.z*uDays,6.28318530718);
    float E=M;for(int i=0;i<6;i++)E-=(E-e*sin(E)-M)/(1.0-e*cos(E));
    float x=a*(cos(E)-e),y=a*sqrt(1.0-e*e)*sin(E);
    float cw=cos(peri),sw=sin(peri),co=cos(node),so=sin(node),ci=cos(inc),si=sin(inc);
    float X=(cw*co-sw*so*ci)*x+(-sw*co-cw*so*ci)*y;
    float Y=(cw*so+sw*co*ci)*x+(-sw*so+cw*co*ci)*y;
    float Z=sw*si*x+cw*si*y;
    vBrightness=aPhase.w;gl_PointSize=uPixels;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(vec3(X,Z,-Y)*uAU,1.0);${LDB_VERTEX_TAIL}
}`;
const backgroundFragment = `${LDB_FRAGMENT_PARS}
varying float vBrightness;
void main(){${LDB_FRAGMENT_HEAD}float r=length(gl_PointCoord-.5);if(r>.5)discard;
    vec3 tint=mix(vec3(.16,.145,.13),vec3(.38,.35,.31),vBrightness);
    gl_FragColor=vec4(tint,(1.0-smoothstep(.1,.5,r))*.55);
}`;
const knownVertex = `uniform float uPixels;${LDB_VERTEX_PARS}void main(){gl_PointSize=uPixels;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);${LDB_VERTEX_TAIL}}`;
const knownFragment = `${LDB_FRAGMENT_PARS}void main(){${LDB_FRAGMENT_HEAD}float r=length(gl_PointCoord-.5);if(r>.5)discard;gl_FragColor=vec4(vec3(.48,.53,.61),(1.0-smoothstep(.14,.5,r))*.80);}`;
export class KuiperBelt {
    constructor(options) {
        Object.assign(this, options);
        this.root = null; this.anchor = null; this.known = null; this.background = null;
        this.labels = []; this.table = null; this.meta = null; this.loading = null;
        this.error = ''; this.enabled = false; this.lastEt = NaN;
        this.state = 'not loaded'; this.factSignature = '';
        this.row = document.querySelector('#body-select [data-key="kuiperbelt"]');
        this.refreshFacts();
    }
    focusDistance(camera) {
        const halfV = camera.fov * Math.PI / 360;
        const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
        return 68 * this.au / Math.sin(Math.min(halfV, halfH)) * 1.08;
    }
    refreshFacts() {
        const count = this.meta?.count;
        if (this._factsState === this.state && this._factsCount === count && this._factsError === this.error) return;
        this._factsState = this.state; this._factsCount = count; this._factsError = this.error;
        this.bodyFacts.kuiperbelt = {
            name: 'Kuiper Belt', kind: 'Outer small-body population',
            tagline: 'Hybrid view: catalogued objects on local JPL trajectories plus an illustrative icy-body background. Separate from the main asteroid belt.',
            stats: [
                ['Region', 'Beyond Neptune; main belt roughly 30–50 AU, not a hard cutoff for individual orbits'],
                ['Known objects', this.meta ? this.meta.count + ' selected catalogue bodies; not a complete survey' : '24 selected catalogue bodies · ' + this.state],
                ['Known markers', 'Pale blue · named labels when focused and Labels is on'],
                ['Background', BACKGROUND_COUNT.toLocaleString('en-US') + ' brown seeded markers · synthetic, not measured individual positions'],
                ['Background model', 'Two-body Kepler motion; illustrative cold/hot mix, not a measured 70/30 population ratio'],
                ['Known position model', 'Offline Horizons numerical ephemerides; lightweight cubic Hermite evaluation'],
                ['Local date coverage', '1800–2199 (TDB); no extrapolation of named objects'],
                ['Interpolation check', this.meta ? 'Maximum ' + this.meta.validation.maxKm.toFixed(2) + ' km vs source at ' + this.meta.validation.samples.toLocaleString('en-US') + ' withheld points' : '53.21 km maximum in the bundled validation; loading data'],
                ['Accuracy limits', 'Interpolation error only, not orbit uncertainty; GPU marker precision is additional'],
                ['Data state', this.error || this.state],
                ['Scope', 'No Oort Cloud or scattered-disc layer; existing Pluto is not duplicated'],
            ],
        };
        this.onFactsChange?.();
    }
    async load() {
        if (this.loading) return this.loading;
        this.state = 'loading local trajectories'; this.refreshFacts();
        this.loading = (async () => {
            try {
                const [m, b] = await Promise.all([
                    fetch(new URL('../../../data/kuiper/kuiper-meta.json', import.meta.url)),
                    fetch(new URL('../../../data/kuiper/kuiper-1800-2200.bin', import.meta.url)),
                ]);
                if (!m.ok || !b.ok) throw Error('Local Kuiper data could not load (' + m.status + '/' + b.status + ')');
                const [meta, buffer] = await Promise.all([m.json(), b.arrayBuffer()]);
                if (globalThis.crypto?.subtle && meta.sha256) {
                    const digest = await crypto.subtle.digest('SHA-256', buffer);
                    const hex = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
                    if (hex !== meta.sha256) throw Error('Kuiper data checksum mismatch');
                }
                this.table = new KuiperTable(buffer, meta); this.meta = meta;
                this.sample = new Float64Array(meta.count * 3);
                this.state = 'ready; waiting for a displayed epoch'; this.refreshFacts();
            } catch (e) {
                this.error = e.message; this.state = 'known trajectories unavailable; synthetic background only';
                console.warn('Kuiper Belt:', e.message); this.refreshFacts();
            }
            return this.table;
        })();
        return this.loading;
    }
    detach() {
        if (this.root?.parent) {
            this.root.removeFromParent();
            this.root.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
        }
        if (this.labelObjects) for (const { label } of this.labels) {
            const i = this.labelObjects.indexOf(label); if (i >= 0) this.labelObjects.splice(i, 1);
            label.element?.remove();
        }
        if (this.objectRegistry.kuiperbelt === this.anchor) delete this.objectRegistry.kuiperbelt;
        this.root = this.anchor = this.background = this.known = null;
        this.labels = []; this.lastEt = NaN;
    }
    rebuild(enabled = true) {
        this.detach(); this.enabled = !!enabled;
        if (enabled) this.build();
        this.setEnabled(enabled);
    }
    build() {
        if (this.root || !this.enabled) return;
        const T = this.THREE;
        this.root = new T.Group(); this.root.name = 'Kuiper Belt · hybrid';
        this.root.visible = false; this.solarSystem.add(this.root);
        this.anchor = new T.Object3D();
        this.anchor.userData = { planetKey: 'kuiperbelt', planetName: 'Kuiper Belt', isPopulationAnchor: true, focusRadius: 68 * this.au };
        this.root.add(this.anchor); this.objectRegistry.kuiperbelt = this.anchor;
        const field = makeBackground(BACKGROUND_COUNT);
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(new Float32Array(field.count * 3), 3));
        g.setAttribute('aOrbit', new T.BufferAttribute(field.orbit, 4));
        g.setAttribute('aPhase', new T.BufferAttribute(field.phase, 4));
        const material = new T.ShaderMaterial({
            uniforms: { uDays: { value: 0 }, uAU: { value: this.au }, uPixels: { value: 1.6 } },
            vertexShader: backgroundVertex, fragmentShader: backgroundFragment,
            transparent: true, depthTest: true, depthWrite: false,
        });
        g.boundingSphere = new T.Sphere(new T.Vector3(), 72 * this.au);
        this.background = new T.Points(g, material); this.background.frustumCulled = true;
        this.background.raycast = () => {}; this.root.add(this.background);
        if (!this.table && !this.loading) void this.load();
    }
    buildKnown() {
        if (!this.table || !this.root || this.known) return;
        const T = this.THREE, n = this.meta.count;
        this.positions = new Float32Array(n * 3);
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage));
        this.known = new T.Points(g, new T.ShaderMaterial({
            uniforms: { uPixels: { value: 3 } }, vertexShader: knownVertex, fragmentShader: knownFragment,
            transparent: true, depthTest: true, depthWrite: false,
        }));
        g.boundingSphere = new T.Sphere(new T.Vector3(), 160 * this.au);
        this.known.visible = false; this.known.frustumCulled = true; this.known.raycast = () => {};
        this.root.add(this.known);
        if (false && this.CSS2DObject && this.labelObjects) for (const object of this.meta.objects) {
            const parent = new T.Object3D(); parent.visible = false;
            const element = document.createElement('div'); element.className = 'planet-label';
            element.textContent = object.name; element.title = object.name + ' · Horizons catalogue trajectory';
            const label = new this.CSS2DObject(element); label.visible = false; parent.add(label);
            this.root.add(parent); this.labelObjects.push(label); this.labels.push({ parent, label });
        }
        this.lastEt = NaN;
    }
    setEnabled(enabled) {
        this.enabled = !!enabled;
        const on = this.enabled;
        if (this.root) this.root.visible = !!on;
        if (this.anchor) this.anchor.visible = !!on;
        if (!on) for (const { parent, label } of this.labels) { parent.visible = false; label.visible = false; }
        const hidden = !on || !this.root;
        if (this.row && this.row.hidden !== hidden) this.row.hidden = hidden;
    }
    update({ enabled, et, showLabels = false, focusedKey = '' }) {
        this.setEnabled(enabled);
        if (!enabled) return;
        this.build(); this.setEnabled(enabled); this.buildKnown();
        const valid = Number.isFinite(et);
        this.background.visible = valid;
        if (valid) this.background.material.uniforms.uDays.value = et / DAY;
        const dpr = this.renderer.getPixelRatio?.() || 1;
        this.background.material.uniforms.uPixels.value = 1.6 * dpr;
        if (this.known) this.known.material.uniforms.uPixels.value = (focusedKey === 'kuiperbelt' ? 3.6 : 2.8) * dpr;
        const covered = valid && !!this.table && this.table.inCoverage(et);
        if (this.known) this.known.visible = covered;
        if (covered && et !== this.lastEt) {
            this.table.sampleAll(et, this.sample);
            toScene(this.sample, this.positions, this.au);
            this.known.geometry.attributes.position.needsUpdate = true;
            this.known.geometry.computeBoundingSphere();
            for (let j = 0; j < this.labels.length; j++) {
                const k = j * 3; this.labels[j].parent.position.set(this.sample[k] * this.au, this.sample[k + 2] * this.au, -this.sample[k + 1] * this.au);
            }
            this.lastEt = et;
        }
        for (const { parent, label } of this.labels) {
            const visible = covered && showLabels && focusedKey === 'kuiperbelt';
            if (visible && !label.visible) label._lastOp = undefined;
            parent.visible = label.visible = visible;
        }
        if (this.table) {
            this.state = !valid ? 'waiting for a valid displayed simulation epoch' : covered
                ? '24 known trajectories + illustrative background' : 'outside local trajectory coverage; synthetic background only';
            this.refreshFacts();
        }
    }
}
