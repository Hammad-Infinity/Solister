import { BodyShapes } from "./body-shapes.js";

const MAP_KEYS = Object.freeze([ "mercury", "venus", "earth", "mars", "moon" ]);

const DATA_WIDTH = 2048;

const DATA_HEIGHT = 1024;

const DEM_LONGITUDE_OFFSET = Object.freeze({
    earth: .25
});

const DEM_FLIP_V = true;

function demLongitudeOffset(key) {
    return DEM_LONGITUDE_OFFSET[key] || 0;
}

const ELEVATION_VERTICAL_EXAGGERATION = 1;

const LANDED_DETAIL_SEGMENTS = Object.freeze({
    mercury: Object.freeze([ 512, 256 ]),
    venus: Object.freeze([ 512, 256 ]),
    earth: Object.freeze([ 512, 256 ]),
    mars: Object.freeze([ 512, 256 ]),
    moon: Object.freeze([ 512, 256 ])
});

function wrap01(value) {
    return value - Math.floor(value);
}

export class ElevationCatalog {
    constructor({THREE: THREE, objectRegistry: objectRegistry = {}, baseUrl: baseUrl = "./data/elevation/", fetcher: fetcher = globalThis.fetch?.bind(globalThis), getRenderer: getRenderer = null, onStatus: onStatus = null}) {
        Object.assign(this, {
            THREE: THREE,
            objectRegistry: objectRegistry,
            baseUrl: baseUrl,
            fetcher: fetcher,
            getRenderer: getRenderer,
            onStatus: onStatus
        });
        this.catalog = null;
        this.maps = new Map;
        this.detailCacheKey = null;
        this.detailCacheGeometry = null;
        this.pending = new Set;
        this.errors = new Map;
        this.detailPreparation = new Map;
        this.mapLoadPromises = new Map;
        this.loadComplete = false;
        this.surfaceDirection = new this.THREE.Vector3;
        this.surfacePoint = new this.THREE.Vector3;
        this.surfacePointLonMinus = new this.THREE.Vector3;
        this.surfacePointLonPlus = new this.THREE.Vector3;
        this.surfacePointLatMinus = new this.THREE.Vector3;
        this.surfacePointLatPlus = new this.THREE.Vector3;
        this.surfaceEast = new this.THREE.Vector3;
        this.surfaceNorth = new this.THREE.Vector3;
        this.surfaceNormal = new this.THREE.Vector3;
        this.surfaceNormalMatrix = new this.THREE.Matrix3;
        this.ready = this.load();
    }
    async load() {
        if (typeof this.fetcher !== "function") {
            this.notify("error", "Fetch is unavailable; elevation catalog is disabled.");
            return false;
        }
        try {
            const response = await this.fetcher(new URL("catalog.json", this.baseUrl), {
                cache: "no-cache"
            });
            if (!response.ok) throw new Error(`catalog request returned ${response.status}`);
            this.catalog = await response.json();
            if (!this.catalog || this.catalog.schemaVersion !== 1 || !this.catalog.entries) {
                throw new Error("unsupported elevation catalog schema");
            }
            const jobs = MAP_KEYS.map(key => {
                const job = this.loadMap(key);
                this.mapLoadPromises.set(key, job);
                return job;
            });
            await Promise.allSettled(jobs);
            this.applyExistingBodies();
            this.loadComplete = true;
            this.notify("ready", "Elevation catalog loaded.");
            return true;
        } catch (error) {
            this.loadComplete = true;
            this.notify("error", `Elevation catalog could not be loaded: ${error.message || error}`);
            return false;
        }
    }
    async loadMap(key) {
        const entry = this.catalog?.entries?.[key];
        if (!entry?.dataFile) return null;
        this.pending.add(key);
        this.notify("loading", `Loading ${entry.name || key} elevation grid.`);
        try {
            const response = await this.fetcher(new URL(entry.dataFile, this.baseUrl), {
                cache: "force-cache"
            });
            if (!response.ok) throw new Error(`map request returned ${response.status}`);
            const buffer = await response.arrayBuffer();
            const expected = DATA_WIDTH * DATA_HEIGHT * 2;
            if (buffer.byteLength !== expected || buffer.byteLength !== entry.fileBytes) {
                throw new Error(`unexpected grid size (${buffer.byteLength} bytes; expected ${expected})`);
            }
            const values = new Uint16Array(buffer);
            const T = this.THREE;
            const bumpValues = new Uint8Array(values.length);
            for (let i = 0; i < values.length; i++) bumpValues[i] = values[i] >>> 8;
            const isWebGL2 = this.getRenderer?.()?.capabilities?.isWebGL2 !== false;
            const textureFormat = isWebGL2 && T.RedFormat !== undefined ? T.RedFormat : T.LuminanceFormat;
            const heightTexture = new T.DataTexture(bumpValues, DATA_WIDTH, DATA_HEIGHT, textureFormat, T.UnsignedByteType);
            heightTexture.name = `${key}-global-elevation-bump`;
            heightTexture.colorSpace = T.NoColorSpace;
            heightTexture.wrapS = T.RepeatWrapping;
            heightTexture.wrapT = T.ClampToEdgeWrapping;
            heightTexture.magFilter = T.LinearFilter;
            heightTexture.minFilter = T.LinearMipmapLinearFilter;
            heightTexture.generateMipmaps = true;
            heightTexture.unpackAlignment = 1;
            heightTexture.repeat.set(1, DEM_FLIP_V ? -1 : 1);
            heightTexture.offset.set(demLongitudeOffset(key), DEM_FLIP_V ? 1 : 0);
            heightTexture.userData = { sourceBitsPerSample: 16, gpuBitsPerSample: 8 };
            heightTexture.needsUpdate = true;
            const map = {
                key: key,
                entry: entry,
                values: values,
                heightTexture: heightTexture,
                width: DATA_WIDTH,
                height: DATA_HEIGHT
            };
            this.maps.set(key, map);
            this.applyBody(this.objectRegistry[key], key);
            this.notify("loaded", `${entry.name || key} elevation grid ready.`);
            return map;
        } catch (error) {
            this.errors.set(key, error);
            this.notify("map-error", `${entry.name || key} elevation data is unavailable: ${error.message || error}`);
            return null;
        } finally {
            this.pending.delete(key);
        }
    }
    notify(code, message) {
        try {
            this.onStatus?.(code, message);
        } catch (_) {}
    }
    getEntry(key) {
        return this.catalog?.entries?.[key] || null;
    }
    getMap(key) {
        return this.maps.get(key) || null;
    }
    hasMap(key) {
        return this.maps.has(key);
    }
    isPending(key) {
        return this.pending.has(key);
    }
    getMaxElevationM(key) {
        const range = this.getEntry(key)?.runtimeElevationRangeM;
        return Array.isArray(range) && Number.isFinite(range[1]) ? range[1] : 0;
    }
    describe(key) {
        if (!key || key === "solarsystem") return "";
        const entry = this.getEntry(key);
        if (!entry) return "No global elevation model is cataloged.";
        if (entry.status === "no-solid-surface") return "No solid-surface elevation model.";
        if (entry.status === "not-applicable") return "Topographic elevation is not applicable.";
        if (entry.dataFile) {
            if (this.maps.has(key)) return "Global DEM loaded; terrain relief is rendered at source scale.";
            if (this.pending.has(key)) return "Global DEM loading…";
            if (this.errors.has(key)) return "DEM unavailable; reference shape shown.";
            return "Global DEM is cataloged; waiting to load.";
        }
        return "Reference shape only; no global DEM is bundled.";
    }
    applyExistingBodies() {
        for (const key of MAP_KEYS) this.applyBody(this.objectRegistry[key], key);
    }
    restoreTextures() {
        for (const map of this.maps.values()) if (map.heightTexture) map.heightTexture.needsUpdate = true;
    }
    sampleElevationM(key, latitude, longitude) {
        const map = this.maps.get(key);
        if (!map) return 0;
        const qx = Math.cos(latitude) * Math.sin(longitude);
        const qy = Math.sin(latitude);
        const qz = Math.cos(latitude) * Math.cos(longitude);
        const sphereU = Math.atan2(qz, -qx) / (Math.PI * 2);
        const u = wrap01(sphereU + demLongitudeOffset(key));
        const vSphere = 1 - Math.acos(Math.max(-1, Math.min(1, qy))) / Math.PI;
        const v = DEM_FLIP_V ? 1 - vSphere : vSphere;
        const x = u * map.width - .5;
        const x0Raw = Math.floor(x);
        const x0 = (x0Raw % map.width + map.width) % map.width;
        const x1 = (x0 + 1) % map.width;
        const fx = x - x0Raw;
        const y = Math.max(0, Math.min(map.height - 1, v * map.height - .5));
        const y0 = Math.floor(y);
        const y1 = Math.min(map.height - 1, y0 + 1);
        const fy = y - y0;
        const i00 = y0 * map.width + x0;
        const i10 = y0 * map.width + x1;
        const i01 = y1 * map.width + x0;
        const i11 = y1 * map.width + x1;
        const h0 = map.values[i00] * (1 - fx) + map.values[i10] * fx;
        const h1 = map.values[i01] * (1 - fx) + map.values[i11] * fx;
        const [minimum, maximum] = map.entry.encodingRangeM;
        return minimum + (h0 * (1 - fy) + h1 * fy) / 65535 * (maximum - minimum);
    }
    setSurfacePoint(key, latitude, longitude, radius, scaleX, scaleY, scaleZ, referenceRadiusKm, out) {
        const map = this.maps.get(key);
        const maxAxis = Math.max(scaleX, scaleY, scaleZ);
        const x = Math.cos(latitude) * Math.sin(longitude);
        const y = Math.sin(latitude);
        const z = Math.cos(latitude) * Math.cos(longitude);
        const px = x * radius * scaleX / maxAxis;
        const py = y * radius * scaleY / maxAxis;
        const pz = z * radius * scaleZ / maxAxis;
        const length = Math.hypot(px, py, pz) || 1;
        const heightM = this.sampleElevationM(key, latitude, longitude);
        const heightOffset = map ? heightM * radius / (referenceRadiusKm * 1e3) * ELEVATION_VERTICAL_EXAGGERATION : 0;
        const factor = 1 + heightOffset / length;
        return out.set(px * factor, py * factor, pz * factor);
    }
    surfaceHit(key, body, center, radial, pointOut, normalOut) {
        const map = this.maps.get(key);
        const geometry = body?.geometry;
        const axes = geometry?.userData?.referenceAxesKm;
        const radius = geometry?.parameters?.radius;
        if (!map || !axes?.length || !(radius > 0)) return false;
        body.updateWorldMatrix(true, false);
        this.surfaceDirection.set(center.x + radial.x, center.y + radial.y, center.z + radial.z);
        body.worldToLocal(this.surfaceDirection);
        if (this.surfaceDirection.lengthSq() < 1e-18) return false;
        this.surfaceDirection.normalize();
        const maxAxis = Math.max(...axes);
        const scaleX = axes[0] / maxAxis;
        const scaleY = axes[2] / maxAxis;
        const scaleZ = axes[1] / maxAxis;
        const qxRaw = this.surfaceDirection.x / scaleX;
        const qyRaw = this.surfaceDirection.y / scaleY;
        const qzRaw = this.surfaceDirection.z / scaleZ;
        const qLength = Math.hypot(qxRaw, qyRaw, qzRaw) || 1;
        const qx = qxRaw / qLength;
        const qy = qyRaw / qLength;
        const qz = qzRaw / qLength;
        const latitude = Math.asin(Math.max(-1, Math.min(1, qy)));
        const longitude = Math.atan2(qx, qz);
        const referenceRadiusKm = maxAxis;
        const stepLatitude = Math.PI / map.height;
        const stepLongitude = Math.PI * 2 / map.width;
        this.setSurfacePoint(key, latitude, longitude - stepLongitude, radius, scaleX, scaleY, scaleZ, referenceRadiusKm, this.surfacePointLonMinus);
        this.setSurfacePoint(key, latitude, longitude + stepLongitude, radius, scaleX, scaleY, scaleZ, referenceRadiusKm, this.surfacePointLonPlus);
        this.setSurfacePoint(key, Math.max(-Math.PI / 2, latitude - stepLatitude), longitude, radius, scaleX, scaleY, scaleZ, referenceRadiusKm, this.surfacePointLatMinus);
        this.setSurfacePoint(key, Math.min(Math.PI / 2, latitude + stepLatitude), longitude, radius, scaleX, scaleY, scaleZ, referenceRadiusKm, this.surfacePointLatPlus);
        this.surfaceEast.subVectors(this.surfacePointLonPlus, this.surfacePointLonMinus);
        this.surfaceNorth.subVectors(this.surfacePointLatPlus, this.surfacePointLatMinus);
        this.surfaceNormal.crossVectors(this.surfaceEast, this.surfaceNorth);
        this.setSurfacePoint(key, latitude, longitude, radius, scaleX, scaleY, scaleZ, referenceRadiusKm, this.surfacePoint);
        if (this.surfaceNormal.lengthSq() < 1e-18) {
            this.surfaceNormal.set(this.surfacePoint.x / (scaleX * scaleX), this.surfacePoint.y / (scaleY * scaleY), this.surfacePoint.z / (scaleZ * scaleZ));
        }
        this.surfaceNormal.normalize();
        if (this.surfaceNormal.dot(this.surfacePoint) < 0) this.surfaceNormal.negate();
        pointOut.copy(this.surfacePoint);
        body.localToWorld(pointOut);
        this.surfaceNormalMatrix.getNormalMatrix(body.matrixWorld);
        normalOut.copy(this.surfaceNormal).applyMatrix3(this.surfaceNormalMatrix).normalize();
        if (normalOut.dot(radial) < 0) normalOut.negate();
        return true;
    }
    hasPreparedSurfaceDetail(key) {
        return this.detailCacheKey === key && !!this.detailCacheGeometry || !!this.objectRegistry[key]?.userData?.elevationDetailActive;
    }
    prepareSurfaceDetail(key) {
        const mesh = this.objectRegistry[key];
        const segments = LANDED_DETAIL_SEGMENTS[key];
        if (!mesh?.geometry || !segments) return Promise.resolve(false);
        if (!this.maps.has(key)) {
            const mapLoad = this.mapLoadPromises.get(key);
            if (mapLoad && this.pending.has(key)) return mapLoad.then(() => this.prepareSurfaceDetail(key));
            if (!this.catalog && !this.loadComplete && this.ready) return this.ready.then(() => this.prepareSurfaceDetail(key));
            return Promise.resolve(false);
        }
        if (mesh.userData?.elevationDetailActive || this.detailCacheKey === key && this.detailCacheGeometry) return Promise.resolve(true);
        if (this.detailPreparation.has(key)) return this.detailPreparation.get(key);
        const preparation = new Promise(resolve => {
            const build = () => {
                const baseGeometry = mesh.userData?.elevationBaseGeometry || mesh.geometry;
                const radius = baseGeometry.parameters?.radius;
                const width = baseGeometry.parameters?.widthSegments || 64;
                const height = baseGeometry.parameters?.heightSegments || 32;
                if (!(radius > 0) || width >= segments[0] && height >= segments[1]) {
                    resolve(false);
                    return;
                }
                if (this.detailCacheGeometry) this.detailCacheGeometry.dispose();
                const detailGeometry = BodyShapes.createGeometry(this.THREE, key, radius, segments[0], segments[1]);
                this.applyBody({ geometry: detailGeometry, material: null }, key);
                this.detailCacheKey = key;
                this.detailCacheGeometry = detailGeometry;
                resolve(true);
            };
            if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(build, { timeout: 250 });
            else setTimeout(build, 0);
        }).finally(() => this.detailPreparation.delete(key));
        this.detailPreparation.set(key, preparation);
        return preparation;
    }
    setSurfaceDetail(key, enabled) {
        const mesh = this.objectRegistry[key];
        if (!mesh?.geometry || !this.getEntry(key)?.dataFile || !this.maps.has(key)) return false;
        if (enabled) {
            if (mesh.userData?.elevationDetailActive) return true;
            const baseGeometry = mesh.geometry;
            const radius = baseGeometry.parameters?.radius;
            const segments = LANDED_DETAIL_SEGMENTS[key];
            if (!(radius > 0) || !segments) return false;
            const width = baseGeometry.parameters?.widthSegments || 64;
            const height = baseGeometry.parameters?.heightSegments || 32;
            if (width >= segments[0] && height >= segments[1]) return false;
            if (this.detailCacheKey !== key || !this.detailCacheGeometry) return false;
            const detailGeometry = this.detailCacheGeometry;
            this.detailCacheKey = null;
            this.detailCacheGeometry = null;
            mesh.userData.elevationBaseGeometry = baseGeometry;
            mesh.geometry = detailGeometry;
            mesh.userData.elevationDetailActive = true;
            this.applyBody(mesh, key);
            return true;
        }
        if (!mesh.userData?.elevationDetailActive) return false;
        const detailGeometry = mesh.geometry;
        const baseGeometry = mesh.userData.elevationBaseGeometry;
        if (!baseGeometry) return false;
        mesh.geometry = baseGeometry;
        delete mesh.userData.elevationBaseGeometry;
        delete mesh.userData.elevationDetailActive;
        if (this.detailCacheGeometry && this.detailCacheGeometry !== detailGeometry) {
            detailGeometry.dispose();
            return true;
        }
        this.detailCacheKey = key;
        this.detailCacheGeometry = detailGeometry;
        return true;
    }
    applyBody(mesh, key) {
        const map = this.maps.get(key);
        const geometry = mesh?.geometry;
        if (!map || !geometry) return false;
        const positions = geometry.getAttribute("position");
        const uvs = geometry.getAttribute("uv");
        const radiusUnits = geometry.parameters?.radius;
        const axes = geometry.userData?.referenceAxesKm;
        const referenceRadiusKm = axes?.length ? Math.max(...axes) : null;
        if (!positions || !uvs || !(radiusUnits > 0) || !(referenceRadiusKm > 0)) return false;
        const unitScale = radiusUnits / referenceRadiusKm / 1e3;
        if (geometry.userData?.elevationApplied !== key) {
            const {values: values, width: width, height: height, entry: entry} = map;
            const [minimum, maximum] = entry.encodingRangeM;
            const range = maximum - minimum;
            const px = positions.array;
            const elevationAt = i => {
                const u = wrap01(uvs.getX(i) + demLongitudeOffset(key));
                const v = Math.max(0, Math.min(1, DEM_FLIP_V ? 1 - uvs.getY(i) : uvs.getY(i)));
                const x = u * width - .5;
                const x0Raw = Math.floor(x);
                const x0 = (x0Raw % width + width) % width;
                const x1 = (x0 + 1) % width;
                const fx = x - x0Raw;
                const y = Math.max(0, Math.min(height - 1, v * height - .5));
                const y0 = Math.floor(y);
                const y1 = Math.min(height - 1, y0 + 1);
                const fy = y - y0;
                const i00 = y0 * width + x0;
                const i10 = y0 * width + x1;
                const i01 = y1 * width + x0;
                const i11 = y1 * width + x1;
                const h0 = values[i00] * (1 - fx) + values[i10] * fx;
                const h1 = values[i01] * (1 - fx) + values[i11] * fx;
                return minimum + (h0 * (1 - fy) + h1 * fy) / 65535 * range;
            };
            const demRowAt = (i, h) => {
                const v = Math.max(0, Math.min(1, DEM_FLIP_V ? 1 - uvs.getY(i) : uvs.getY(i)));
                return v * h;
            };
            let firstNorthRow = Infinity, firstSouthRow = -Infinity;
            for (let i = 0; i < positions.count; i++) {
                const row = demRowAt(i, height);
                if (row > 0 && row < firstNorthRow) firstNorthRow = row;
                if (row < height && row > firstSouthRow) firstSouthRow = row;
            }
            if (!Number.isFinite(firstNorthRow) || firstNorthRow <= 0) firstNorthRow = 1;
            if (!Number.isFinite(firstSouthRow) || firstSouthRow >= height) firstSouthRow = height - 1;
            let northSum = 0, northCount = 0, southSum = 0, southCount = 0;
            for (let i = 0; i < positions.count; i++) {
                const row = demRowAt(i, height);
                if (row > 0 && row <= firstNorthRow) {
                    northSum += elevationAt(i);
                    northCount++;
                } else if (row < height && row >= firstSouthRow) {
                    southSum += elevationAt(i);
                    southCount++;
                }
            }
            const northPoleM = northCount ? northSum / northCount : null;
            const southPoleM = southCount ? southSum / southCount : null;
            for (let i = 0; i < positions.count; i++) {
                const p = i * 3;
                const x0p = px[p], y0p = px[p + 1], z0p = px[p + 2];
                const length = Math.hypot(x0p, y0p, z0p) || 1;
                let elevationM = elevationAt(i);
                const row = demRowAt(i, height);
                if (row <= firstNorthRow && northPoleM !== null) {
                    elevationM += (northPoleM - elevationM) * Math.max(0, 1 - row / firstNorthRow);
                } else if (row >= firstSouthRow && southPoleM !== null) {
                    elevationM += (southPoleM - elevationM) * Math.max(0, 1 - (height - row) / Math.max(1e-6, height - firstSouthRow));
                }
                const elevationOffset = elevationM * ELEVATION_VERTICAL_EXAGGERATION * unitScale;
                const delta = elevationOffset / length;
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
        const displaced = geometry.userData?.elevationApplied === key;
        const gridWidth = geometry.parameters?.widthSegments || 0;
        const gridHeight = geometry.parameters?.heightSegments || 0;
        const resolvedBand = displaced && gridWidth > 0 && gridHeight > 0 ? Math.min(1, Math.min(gridWidth / DATA_WIDTH, gridHeight / DATA_HEIGHT)) : 0;
        const residualRelief = displaced ? Math.max(.15, 1 - Math.sqrt(resolvedBand)) : 1;
        const bumpScale = (maximum - minimum) * unitScale * ELEVATION_VERTICAL_EXAGGERATION * residualRelief;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [ mesh.material ]) {
            if (!material) continue;
            const bumpMapChanged = material.bumpMap !== map.heightTexture;
            material.bumpMap = map.heightTexture;
            material.bumpScale = bumpScale;
            material.userData = material.userData || {};
            material.userData.elevationMap = key;
            material.userData.elevationVerticalExaggeration = ELEVATION_VERTICAL_EXAGGERATION;
            material.userData.elevationBumpResidualRelief = residualRelief;
            if (bumpMapChanged) material.needsUpdate = true;
        }
        return true;
    }
}
