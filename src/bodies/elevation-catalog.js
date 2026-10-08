const MAP_KEYS = Object.freeze(['mercury', 'venus', 'earth', 'mars', 'moon']);
const DATA_WIDTH = 2048;
const DATA_HEIGHT = 1024;
const LONGITUDE_OFFSET = 0.75; // SphereGeometry u=0 is local -X; 0 E is local +Z.
const ELEVATION_VERTICAL_EXAGGERATION = 20.0;

function wrap01(value) { return value - Math.floor(value); }

function installReliefColorHook(material, key) {
    if (material.userData?.elevationReliefShader === key) return;
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = function(shader, renderer) {
        if (previousCompile) previousCompile.call(this, shader, renderer);
        const token = '#include <map_fragment>';
        if (!shader.fragmentShader.includes(token)) return;
        shader.fragmentShader = shader.fragmentShader.replace(token, `${token}
#ifdef USE_BUMPMAP
    // A restrained hypsometric contrast remains visible even when mountains
    // occupy less than a screen pixel; the geometry and bump map supply shape.
    float elevationTone = texture2D(bumpMap, vBumpMapUv).r;
    float elevationContrast = mix(0.68, 1.35, smoothstep(0.02, 0.98, elevationTone));
    diffuseColor.rgb *= elevationContrast;
#endif`);
    };
    material.customProgramCacheKey = () => `${previousKey()}|elevation-relief-v1-${key}`;
    material.userData = material.userData || {};
    material.userData.elevationReliefShader = key;
}

export class ElevationCatalog {
    constructor({ THREE, objectRegistry = {}, baseUrl = './data/elevation/', fetcher = globalThis.fetch?.bind(globalThis), onStatus = null }) {
        Object.assign(this, { THREE, objectRegistry, baseUrl, fetcher, onStatus });
        this.catalog = null;
        this.maps = new Map();
        this.pending = new Set();
        this.errors = new Map();
        this.ready = this.load();
    }

    async load() {
        if (typeof this.fetcher !== 'function') {
            this.notify('error', 'Fetch is unavailable; elevation catalog is disabled.');
            return false;
        }
        try {
            const response = await this.fetcher(new URL('catalog.json', this.baseUrl), { cache: 'no-cache' });
            if (!response.ok) throw new Error(`catalog request returned ${response.status}`);
            this.catalog = await response.json();
            if (!this.catalog || this.catalog.schemaVersion !== 1 || !this.catalog.entries) {
                throw new Error('unsupported elevation catalog schema');
            }
            const jobs = MAP_KEYS.map(key => this.loadMap(key));
            await Promise.allSettled(jobs);
            this.applyExistingBodies();
            this.notify('ready', 'Elevation catalog loaded.');
            return true;
        } catch (error) {
            this.notify('error', `Elevation catalog could not be loaded: ${error.message || error}`);
            return false;
        }
    }

    async loadMap(key) {
        const entry = this.catalog?.entries?.[key];
        if (!entry?.dataFile) return null;
        this.pending.add(key);
        this.notify('loading', `Loading ${entry.name || key} elevation grid.`);
        try {
            const response = await this.fetcher(new URL(entry.dataFile, this.baseUrl), { cache: 'force-cache' });
            if (!response.ok) throw new Error(`map request returned ${response.status}`);
            const buffer = await response.arrayBuffer();
            const expected = DATA_WIDTH * DATA_HEIGHT * 2;
            if (buffer.byteLength !== expected || buffer.byteLength !== entry.fileBytes) {
                throw new Error(`unexpected grid size (${buffer.byteLength} bytes; expected ${expected})`);
            }
            const values = new Uint16Array(buffer);
            const T = this.THREE;
            const heightTexture = new T.DataTexture(
                values, DATA_WIDTH, DATA_HEIGHT, T.RedFormat, T.UnsignedShortType
            );
            heightTexture.name = `${key}-global-elevation`;
            heightTexture.colorSpace = T.NoColorSpace;
            heightTexture.wrapS = T.RepeatWrapping;
            heightTexture.wrapT = T.ClampToEdgeWrapping;
            heightTexture.magFilter = T.LinearFilter;
            heightTexture.minFilter = T.LinearMipmapLinearFilter;
            heightTexture.generateMipmaps = true;
            heightTexture.unpackAlignment = 1;
            heightTexture.offset.x = LONGITUDE_OFFSET;
            heightTexture.needsUpdate = true;
            const map = { key, entry, values, heightTexture, width: DATA_WIDTH, height: DATA_HEIGHT };
            this.maps.set(key, map);
            this.applyBody(this.objectRegistry[key], key);
            this.notify('loaded', `${entry.name || key} elevation grid ready.`);
            return map;
        } catch (error) {
            this.errors.set(key, error);
            this.notify('map-error', `${entry.name || key} elevation data is unavailable: ${error.message || error}`);
            return null;
        } finally {
            this.pending.delete(key);
        }
    }

    notify(code, message) {
        try { this.onStatus?.(code, message); } catch (_) {}
    }

    getEntry(key) { return this.catalog?.entries?.[key] || null; }
    getMap(key) { return this.maps.get(key) || null; }
    hasMap(key) { return this.maps.has(key); }
    isPending(key) { return this.pending.has(key); }
    getMaxElevationM(key) {
        const range = this.getEntry(key)?.runtimeElevationRangeM;
        return Array.isArray(range) && Number.isFinite(range[1]) ? range[1] : 0;
    }

    describe(key) {
        if (!key || key === 'solarsystem') return '';
        const entry = this.getEntry(key);
        if (!entry) return 'No global elevation model is cataloged.';
        if (entry.status === 'no-solid-surface') return 'No solid-surface elevation model.';
        if (entry.status === 'not-applicable') return 'Topographic elevation is not applicable.';
        if (entry.dataFile) {
            if (this.maps.has(key)) return `Global DEM loaded; 20× vertical relief and elevation shading applied.`;
            if (this.pending.has(key)) return 'Global DEM loading…';
            if (this.errors.has(key)) return 'DEM unavailable; reference shape shown.';
            return 'Global DEM is cataloged; waiting to load.';
        }
        return 'Reference shape only; no global DEM is bundled.';
    }

    applyExistingBodies() {
        for (const key of MAP_KEYS) this.applyBody(this.objectRegistry[key], key);
    }

    applyBody(mesh, key) {
        const map = this.maps.get(key);
        const geometry = mesh?.geometry;
        if (!map || !geometry) return false;
        const positions = geometry.getAttribute('position');
        const uvs = geometry.getAttribute('uv');
        const radiusUnits = geometry.parameters?.radius;
        const axes = geometry.userData?.referenceAxesKm;
        const referenceRadiusKm = axes?.length ? Math.max(...axes) : null;
        if (!positions || !uvs || !(radiusUnits > 0) || !(referenceRadiusKm > 0)) return false;
        const unitScale = radiusUnits / referenceRadiusKm / 1000.0;
        if (geometry.userData?.elevationApplied !== key) {
            const { values, width, height, entry } = map;
            const [minimum, maximum] = entry.encodingRangeM;
            const range = maximum - minimum;
            const px = positions.array;
            for (let i = 0; i < positions.count; i++) {
                const u = wrap01(uvs.getX(i) + LONGITUDE_OFFSET);
                const v = Math.max(0, Math.min(1, uvs.getY(i)));
                const x = u * width - 0.5;
                const x0Raw = Math.floor(x);
                const x0 = ((x0Raw % width) + width) % width;
                const x1 = (x0 + 1) % width;
                const fx = x - x0Raw;
                const y = Math.max(0, Math.min(height - 1, v * height - 0.5));
                const y0 = Math.floor(y);
                const y1 = Math.min(height - 1, y0 + 1);
                const fy = y - y0;
                const i00 = y0 * width + x0;
                const i10 = y0 * width + x1;
                const i01 = y1 * width + x0;
                const i11 = y1 * width + x1;
                const h0 = values[i00] * (1 - fx) + values[i10] * fx;
                const h1 = values[i01] * (1 - fx) + values[i11] * fx;
                const elevationM = minimum + ((h0 * (1 - fy) + h1 * fy) / 65535) * range;
                const p = i * 3;
                const x0p = px[p], y0p = px[p + 1], z0p = px[p + 2];
                const length = Math.hypot(x0p, y0p, z0p) || 1;
                const exaggeratedOffset = elevationM * ELEVATION_VERTICAL_EXAGGERATION * unitScale;
                const delta = exaggeratedOffset / length;
                px[p] = x0p * (1 + delta);
                px[p + 1] = y0p * (1 + delta);
                px[p + 2] = z0p * (1 + delta);
            }
            positions.needsUpdate = true;
            geometry.computeVertexNormals();
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            geometry.userData.elevationApplied = key;
            geometry.userData.elevationModel = entry.source;
            geometry.userData.elevationReference = entry.referenceShape;
            geometry.userData.elevationVerticalExaggeration = ELEVATION_VERTICAL_EXAGGERATION;
        }
        const [minimum, maximum] = map.entry.encodingRangeM;
        const bumpScale = (maximum - minimum) * unitScale * ELEVATION_VERTICAL_EXAGGERATION;
        for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
            if (!material) continue;
            material.bumpMap = map.heightTexture;
            material.bumpScale = bumpScale;
            material.userData = material.userData || {};
            material.userData.elevationMap = key;
            material.userData.elevationVerticalExaggeration = ELEVATION_VERTICAL_EXAGGERATION;
            installReliefColorHook(material, key);
            material.needsUpdate = true;
        }
        return true;
    }
}
