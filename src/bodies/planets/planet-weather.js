import { LDB_VERTEX_PARS, LDB_VERTEX_TAIL, LDB_FRAGMENT_PARS, LDB_FRAGMENT_HEAD } from "../../render/log-depth-glsl.js";

const EARTH_STORM_HOTSPOTS = Object.freeze([ [ 4, -62 ], [ 4, 22 ], [ 9, 112 ], [ 20, 80 ], [ 14, -88 ], [ -14, 132 ], [ 32, -95 ], [ 7, 5 ], [ -5, 151 ], [ 17, 123 ], [ -4, -43 ], [ 25, 108 ] ]);

const LIGHTNING_MODELS = Object.freeze({
    earth: Object.freeze({
        seed: 3928431116,
        rate: 40,
        layerIndex: 0,
        baseAltitudeKm: .15,
        topAltitudeKm: 22,
        lateralKm: 8,
        slots: 12,
        color: 0x803DFF,
        zones: EARTH_STORM_HOTSPOTS
    }),
    venus: Object.freeze({
        seed: 10383781,
        rate: .025,
        layerIndex: 2,
        baseAltitudeKm: 72,
        topAltitudeKm: 92,
        lateralKm: 18,
        slots: 3,
        color: 16765600,
        zones: Object.freeze([ [ 4, 5 ], [ -16, 78 ], [ 24, -112 ], [ -35, 146 ] ])
    }),
    mars: Object.freeze({
        seed: 1296126547,
        rate: .1,
        layerIndex: 0,
        baseAltitudeKm: 24,
        topAltitudeKm: 42,
        lateralKm: 22,
        slots: 3,
        color: 16760179,
        zones: Object.freeze([ [ 18, -110 ], [ 8, 35 ], [ -18, 80 ], [ -32, 155 ], [ 38, -10 ] ])
    }),
    jupiter: Object.freeze({
        seed: 1247105097,
        rate: 1.35,
        layerIndex: 0,
        baseAltitudeKm: 4,
        topAltitudeKm: 42,
        lateralKm: 120,
        slots: 8,
        color: 16768946,
        zones: Object.freeze([ [ 8, 18 ], [ -17, 75 ], [ 22, -135 ], [ -31, 158 ], [ 41, -25 ], [ -7, -92 ] ])
    }),
    saturn: Object.freeze({
        seed: 1396790357,
        rate: .45,
        layerIndex: 0,
        baseAltitudeKm: 5,
        topAltitudeKm: 54,
        lateralKm: 150,
        slots: 6,
        color: 16771013,
        zones: Object.freeze([ [ 2, 15 ], [ 18, -48 ], [ -26, 90 ], [ 35, 158 ], [ -42, -125 ] ])
    }),
    uranus: Object.freeze({
        seed: 1431454030,
        rate: .03,
        layerIndex: 0,
        baseAltitudeKm: 3,
        topAltitudeKm: 22,
        lateralKm: 55,
        slots: 3,
        color: 13035775,
        zones: Object.freeze([ [ 8, 20 ], [ -18, 105 ], [ 31, -75 ], [ -38, -160 ] ])
    }),
    neptune: Object.freeze({
        seed: 1313165396,
        rate: .015,
        layerIndex: 0,
        baseAltitudeKm: 3,
        topAltitudeKm: 22,
        lateralKm: 48,
        slots: 3,
        color: 12114175,
        zones: Object.freeze([ [ 10, 12 ], [ -21, 92 ], [ 34, -88 ], [ -39, 151 ] ])
    })
});

const LIGHTNING_MODEL_ENTRIES = Object.entries(LIGHTNING_MODELS);

function visibleInHierarchy(object) {
    for (let current = object; current; current = current.parent) if (!current.visible) return false;
    return true;
}

const GAS_ELECTRICAL_RESPONSE = Object.freeze({
    N2: .95,
    O2: 1,
    Ar: .82,
    CO2: .78,
    H2: 1.12,
    He: .68,
    CH4: .92,
    NH3: 1.08,
    H2O: 1,
    H2S: .94,
    SO2: .88,
    Na: .55,
    O: .78
});

const GAS_DISCHARGE_TINT = Object.freeze({
    N2: 13230847,
    O2: 10411007,
    Ar: 14282239,
    CO2: 16765851,
    H2: 13352447,
    He: 16773318,
    CH4: 13887411,
    NH3: 15326463,
    H2O: 13166591,
    H2S: 15783582,
    SO2: 15844517,
    Na: 16763752,
    O: 14085631
});

const MAX_BOLT_SEGMENTS = 40;

const EARTH_LIGHTNING_FLASH_SLOTS = 12;

const EARTH_LIGHTNING_MAX_EVENTS_PER_FRAME = 12;

const MAX_PATH_STEPS = 16;

const MAX_BRANCH_STEPS = 5;

const EARTH_SPRITE_FORK_SOURCES = [ 2, 3, 4, 5 ];

const OTHER_FORKS = [ 6, 11 ];

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = state + 1831565813 | 0;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
}

function randomSessionSeed() {
    try {
        const cryptoApi = globalThis.crypto;
        if (cryptoApi?.getRandomValues) {
            const value = new Uint32Array(1);
            cryptoApi.getRandomValues(value);
            return value[0] >>> 0;
        }
    } catch (_) {}
    return Math.floor(Math.random() * 4294967296) >>> 0;
}

function unitFromLatLon(T, latDeg, lonDeg) {
    const lat = latDeg * Math.PI / 180;
    const lon = lonDeg * Math.PI / 180;
    const cosLat = Math.cos(lat);
    return new T.Vector3(-cosLat * Math.cos(lon), Math.sin(lat), cosLat * Math.sin(lon));
}

function unitFromEarthLatLon(T, latDeg, lonDeg) {
    const lat = latDeg * Math.PI / 180;
    const lon = lonDeg * Math.PI / 180;
    const cosLat = Math.cos(lat);
    return new T.Vector3(cosLat * Math.sin(lon), Math.sin(lat), cosLat * Math.cos(lon));
}

function createLightningShaders() {
    const vertexShader = `\n        attribute vec3 aOther;\n        attribute float aSide;\n        attribute float aStrength;\n        attribute float aBranch;\n        uniform vec2 uViewport;\n        uniform float uHalfWidthPx;\n        varying float vSide;\n        varying float vStrength;\n        varying float vBranch;\n        varying vec2 vEarthCloudUv;\n        ${LDB_VERTEX_PARS}\n        void main() {\n            vec3 localNormal = normalize(position);\n            float cloudU = fract(atan(localNormal.z, -localNormal.x) * 0.15915494309189535 + 1.0);\n            float cloudV = 1.0 - acos(clamp(localNormal.y, -1.0, 1.0)) * 0.3183098861837907;\n            vEarthCloudUv = vec2(cloudU, cloudV);\n            vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n            vec4 otherClip = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);\n            vec2 viewport = max(uViewport, vec2(1.0));\n            vec2 pixelDirection = (otherClip.xy / max(otherClip.w, 1e-6) - clip.xy / max(clip.w, 1e-6)) * viewport;\n            float directionLength = length(pixelDirection);\n            vec2 direction = directionLength > 1e-5 ? pixelDirection / directionLength : vec2(0.0, 1.0);\n            vec2 normal = vec2(-direction.y, direction.x);\n            float branchWidth = mix(1.0, 0.42, aBranch);\n            clip.xy += normal * aSide * uHalfWidthPx * branchWidth * 2.0 / viewport * clip.w;\n            gl_Position = clip;\n            vSide = aSide;\n            vStrength = aStrength;\n            vBranch = aBranch;\n            ${LDB_VERTEX_TAIL}\n        }\n    `;
    const fragmentShader = `\n        uniform vec3 uColor;\n        uniform vec3 uBranchColor;\n        uniform float uAlpha;\n        uniform sampler2D uEarthCloudTexture;\n        uniform mat3 uEarthCloudTextureMatrix;\n        uniform float uEarthCloudUseAlpha;\n        uniform float uEarthCloudGate;\n        varying float vSide;\n        varying float vStrength;\n        varying float vBranch;\n        varying vec2 vEarthCloudUv;\n        ${LDB_FRAGMENT_PARS}\n        void main() {\n            ${LDB_FRAGMENT_HEAD}\n            float cloudCoverage = 1.0;\n            if (uEarthCloudGate > 0.5) {\n                vec2 cloudUv = (uEarthCloudTextureMatrix * vec3(vEarthCloudUv, 1.0)).xy;\n                vec4 cloudSample = texture2D(uEarthCloudTexture, cloudUv);\n                float rgbDensity = max(cloudSample.r, max(cloudSample.g, cloudSample.b));\n                float density = mix(rgbDensity, cloudSample.a, uEarthCloudUseAlpha);\n                cloudCoverage = smoothstep(0.38, 0.60, density);\n                if (cloudCoverage < 0.002) discard;\n            }\n            float edge = 1.0 - smoothstep(0.72, 1.0, abs(vSide));\n            float alpha = uAlpha * vStrength * edge * cloudCoverage;\n            if (alpha < 0.002) discard;\n            vec3 boltColor = mix(uColor, uBranchColor, vBranch);\n            gl_FragColor = vec4(boltColor, alpha);\n            #include <colorspace_fragment>\n        }\n    `;
    return {
        vertexShader: vertexShader,
        fragmentShader: fragmentShader
    };
}

function makeMaterial(T, shaders, color, widthPx, alpha, branchColor = color) {
    return new T.ShaderMaterial({
        uniforms: {
            uViewport: {
                value: new T.Vector2(1, 1)
            },
            uHalfWidthPx: {
                value: widthPx
            },
            uColor: {
                value: new T.Color(color)
            },
            uBranchColor: {
                value: new T.Color(branchColor)
            },
            uAlpha: {
                value: alpha
            },
            uEarthCloudTexture: {
                value: null
            },
            uEarthCloudTextureMatrix: {
                value: new T.Matrix3
            },
            uEarthCloudUseAlpha: {
                value: 0
            },
            uEarthCloudGate: {
                value: 0
            }
        },
        vertexShader: shaders.vertexShader,
        fragmentShader: shaders.fragmentShader,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        toneMapped: false,
        fog: false
    });
}

function deriveGasResponse(layer, T, baseColor) {
    const composition = layer?.composition || {};
    let fractionSum = 0;
    let response = 0;
    let weightedMolar = 0;
    const gasColor = new T.Color(0, 0, 0);
    for (const [gas, fraction] of Object.entries(composition)) {
        if (!(fraction > 0)) continue;
        const share = fraction;
        fractionSum += share;
        response += share * (GAS_ELECTRICAL_RESPONSE[gas] ?? .8);
        weightedMolar += share * (layer.meanMolarMass || 28);
        gasColor.add(new T.Color(GAS_DISCHARGE_TINT[gas] ?? 15003647).multiplyScalar(share));
    }
    if (fractionSum <= 0) {
        gasColor.set(15003647);
        response = .8;
        weightedMolar = layer?.meanMolarMass || 28;
        fractionSum = 1;
    }
    gasColor.multiplyScalar(1 / fractionSum);
    const meanMolarMass = Math.max(1, weightedMolar / fractionSum);
    const temperatureFactor = Math.sqrt(Math.max(.15, (layer?.temperatureK || 220) / 250));
    const hasPressureData = Number.isFinite(layer?.pressureBottomPa) && layer.pressureBottomPa > 0;
    const pressureFactor = hasPressureData ? Math.sqrt(Math.max(.002, layer.pressureBottomPa / 101325)) : 1;
    const pressureGain = hasPressureData ? Math.max(.45, Math.min(1.45, pressureFactor)) : 1;
    const molecularFactor = Math.sqrt(Math.max(.15, Math.min(6, 28.97 / meanMolarMass)));
    const rateFactor = Math.max(.22, Math.min(2.1, response * temperatureFactor * pressureGain * molecularFactor));
    const tint = baseColor.clone().lerp(gasColor, .38);
    return {
        rateFactor: rateFactor,
        tint: tint,
        temperatureFactor: temperatureFactor,
        pressureFactor: pressureFactor,
        meanMolarMass: meanMolarMass
    };
}

function makeLightningGeometry(T) {
    const vertices = MAX_BOLT_SEGMENTS * 4;
    const positions = new Float32Array(vertices * 3);
    const others = new Float32Array(vertices * 3);
    const sides = new Float32Array(vertices);
    const strengths = new Float32Array(vertices);
    const branches = new Float32Array(vertices);
    const indices = new Uint16Array(MAX_BOLT_SEGMENTS * 6);
    for (let segment = 0; segment < MAX_BOLT_SEGMENTS; segment++) {
        const vertex = segment * 4;
        const index = segment * 6;
        indices.set([ vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3 ], index);
        sides.set([ 1, -1, -1, 1 ], vertex);
        strengths.fill(1, vertex, vertex + 4);
    }
    const geometry = new T.BufferGeometry;
    const positionAttribute = new T.BufferAttribute(positions, 3);
    const otherAttribute = new T.BufferAttribute(others, 3);
    const sideAttribute = new T.BufferAttribute(sides, 1);
    const strengthAttribute = new T.BufferAttribute(strengths, 1);
    const branchAttribute = new T.BufferAttribute(branches, 1);
    positionAttribute.setUsage(T.DynamicDrawUsage);
    otherAttribute.setUsage(T.DynamicDrawUsage);
    strengthAttribute.setUsage(T.DynamicDrawUsage);
    branchAttribute.setUsage(T.DynamicDrawUsage);
    geometry.setAttribute("position", positionAttribute);
    geometry.setAttribute("aOther", otherAttribute);
    geometry.setAttribute("aSide", sideAttribute);
    geometry.setAttribute("aStrength", strengthAttribute);
    geometry.setAttribute("aBranch", branchAttribute);
    geometry.setIndex(new T.BufferAttribute(indices, 1));
    geometry.setDrawRange(0, 0);
    return {
        geometry: geometry,
        positions: positions,
        others: others,
        strengths: strengths,
        branches: branches,
        positionAttribute: positionAttribute,
        otherAttribute: otherAttribute,
        strengthAttribute: strengthAttribute,
        branchAttribute: branchAttribute
    };
}

function addRibbonSegment(slot, segmentIndex, a, b, strength, branch = 0) {
    const vertex = segmentIndex * 4;
    for (let j = 0; j < 4; j++) {
        const offset = (vertex + j) * 3;
        const from = j < 2 ? a : b, to = j < 2 ? b : a;
        slot.positions[offset] = from.x;
        slot.positions[offset + 1] = from.y;
        slot.positions[offset + 2] = from.z;
        slot.others[offset] = to.x;
        slot.others[offset + 1] = to.y;
        slot.others[offset + 2] = to.z;
        slot.strengths[vertex + j] = strength;
        slot.branches[vertex + j] = branch;
    }
}

function pulseEnvelope(age, duration, pulses) {
    if (age < 0 || age >= duration) return 0;
    let power = 0;
    for (const [delay, gain] of pulses) {
        const phase = age - delay;
        if (phase >= 0) power += gain * (1 - Math.exp(-phase / .01)) * Math.exp(-phase / .085);
    }
    const fade = 1 - Math.pow(age / duration, 3);
    return Math.max(0, Math.min(1.6, power)) * fade;
}

export class PlanetWeather {
    constructor({THREE: THREE, objectRegistry: objectRegistry, camera: camera, renderer: renderer, getLightningEnabled: getLightningEnabled, getAtmosphereProfile: getAtmosphereProfile, getRadiusKm: getRadiusKm, getEarthCloudTexture: getEarthCloudTexture, getEarthCloudOpacity: getEarthCloudOpacity, getEarthCloudGlowMaterial: getEarthCloudGlowMaterial, getEarthWeatherField: getEarthWeatherField, getSurfaceHeightKm: getSurfaceHeightKm}) {
        this.T = THREE;
        this.objectRegistry = objectRegistry;
        this.camera = camera;
        this.renderer = renderer;
        this.getLightningEnabled = getLightningEnabled;
        this.getAtmosphereProfile = getAtmosphereProfile;
        this.getRadiusKm = getRadiusKm;
        this.getEarthCloudTexture = getEarthCloudTexture;
        this.getEarthCloudOpacity = getEarthCloudOpacity;
        this.getEarthCloudGlowMaterial = getEarthCloudGlowMaterial;
        // The weather system's field: the storm population and the flash map the
        // strike regions are binned from. Injected like every other dependency
        // here, because a module-scoped const in another script file is not a
        // property of the global object and cannot be reached through it.
        this.getEarthWeatherField = getEarthWeatherField;
        this.getSurfaceHeightKm = getSurfaceHeightKm;
        this.cloudTextureCache = null;
        this.cloudPixels = null;
        this.cloudWidth = 0;
        this.cloudHeight = 0;
        this.sessionSeed = randomSessionSeed();
        this.entries = new Map;
        this.shaders = createLightningShaders();
        this.cameraPosition = new THREE.Vector3;
        this.sunPosition = new THREE.Vector3;
        this.bodyPosition = new THREE.Vector3;
        this.localSun = new THREE.Vector3;
        this.localView = new THREE.Vector3;
        this.bodyQuaternion = new THREE.Quaternion;
        this.bodyScale = new THREE.Vector3;
        this.viewport = new THREE.Vector2(1, 1);
        this.viewProjection = new THREE.Matrix4;
        this.frustum = new THREE.Frustum;
        this.boundsSphere = new THREE.Sphere(new THREE.Vector3, 1);
        this.stats = {
            strikes: 0,
            active: 0,
            observedModel: "stochastic visual approximation"
        };
    }
    sampleEarthCloudDensity(normal) {
        const texture = this.getEarthCloudTexture?.();
        const image = texture?.image;
        if (!image) return null;
        if (this.cloudTextureCache !== texture) {
            this.cloudTextureCache = texture;
            this.cloudPixels = null;
            this.cloudWidth = 0;
            this.cloudHeight = 0;
            const context = image.getContext?.("2d");
            if (context && image.width > 0 && image.height > 0) {
                try {
                    this.cloudPixels = context.getImageData(0, 0, image.width, image.height).data;
                    this.cloudWidth = image.width;
                    this.cloudHeight = image.height;
                } catch (error) {}
            }
        }
        if (!this.cloudPixels || !this.cloudWidth || !this.cloudHeight) return null;
        const sphereU = (Math.atan2(normal.z, -normal.x) / (Math.PI * 2) + 1) % 1;
        const sphereV = 1 - Math.acos(Math.max(-1, Math.min(1, normal.y))) / Math.PI;
        texture.updateMatrix?.();
        const matrix = texture.matrix?.elements;
        const imageU = matrix ? matrix[0] * sphereU + matrix[3] * sphereV + matrix[6] : sphereU;
        const imageV = matrix ? matrix[1] * sphereU + matrix[4] * sphereV + matrix[7] : sphereV;
        const u = ((imageU % 1) + 1) % 1;
        const x = Math.floor(u * this.cloudWidth) % this.cloudWidth;
        const y = Math.max(0, Math.min(this.cloudHeight - 1, Math.floor((1 - imageV) * this.cloudHeight)));
        const index = (y * this.cloudWidth + x) * 4;
        if (texture.userData?.cloudMaskChannel === "alpha") return this.cloudPixels[index + 3] / 255;
        return Math.max(this.cloudPixels[index], this.cloudPixels[index + 1], this.cloudPixels[index + 2]) / 255;
    }
    chooseStrikeLocation(entry, region) {
        if (entry.key !== "earth") return {
            lat: region.lat,
            lon: region.lon,
            normal: region.normal.clone(),
            cloudDensity: null
        };
        const random = entry.random;
        const radiusDeg = region.radiusDeg || 7;
        let best = null;
        let bestScore = -Infinity;
        for (let attempt = 0; attempt < 24; attempt++) {
            const angle = random() * Math.PI * 2;
            const distance = radiusDeg * Math.sqrt(random());
            const latitude = Math.max(-78, Math.min(78, region.lat + Math.sin(angle) * distance));
            const longitude = ((region.lon + Math.cos(angle) * distance / Math.max(.25, Math.cos(latitude * Math.PI / 180)) + 180) % 360 + 360) % 360 - 180;
            const normal = unitFromEarthLatLon(this.T, latitude, longitude);
            const cloudDensity = this.sampleEarthCloudDensity(normal);
            if (cloudDensity !== null && cloudDensity < .38) continue;
            const score = Math.pow(cloudDensity ?? .55, 2.2) + random() * .02 - distance / radiusDeg * .03;
            if (score > bestScore) {
                bestScore = score;
                best = {
                    lat: latitude,
                    lon: longitude,
                    normal: normal,
                    cloudDensity: cloudDensity
                };
            }
        }
        return best;
    }
    // Visible bolts per second on Earth: the weather system's flash rate times
    // the share of flashes that reach the ground.
    earthBoltRate(fallback) {
        const CG_FRACTION = 0.78 / 10 + 0.22 / 4;
        const flashes = this.getEarthWeatherField?.()?.stats?.flashPerSecond;
        return Number.isFinite(flashes) ? flashes * CG_FRACTION : fallback;
    }
    // Replace an Earth entry's regions with ones taken from the weather system,
    // now that it exists. The entry is created on the first frame that draws the
    // planet, which can be before the cloud deck has finished building; when
    // that happens the entry starts on the fallback hotspots and is upgraded
    // here, once, as soon as the flash map is available.
    refreshEarthStrikeRegions(entry) {
        if (!entry || entry.key !== "earth" || entry.regionsFromWeather) return false;
        const regions = this.buildEarthStrikeRegions(this.T, entry.random);
        if (!regions) return false;
        entry.regions = regions;
        entry.flashEvents = new Array(regions.length).fill(null);
        entry.flashStrengths = new Float32Array(regions.length);
        entry.rate = Math.max(1e-4, this.earthBoltRate(entry.rate));
        entry.regionsFromWeather = true;
        return true;
    }
    // Strike regions for Earth, binned from the weather system's flash map.
    //
    // Binned at 1.5 degrees, which is about 165 km: coarse enough that the
    // planet needs only a few hundred regions (the strike scheduler scans them
    // per strike), fine enough that a squall line and the cyclone 500 km away
    // land in different bins. Weight is the bin's flash rate, so a bin over a
    // violent cluster is struck far more often than one over a stray cell.
    buildEarthStrikeRegions(T, random) {
        const field = this.getEarthWeatherField?.();
        const flash = field?.flashMap;
        const texture = field?.texture;
        if (!flash || !texture) return null;
        const W = texture.image.width, H = texture.image.height;
        const BIN_DEG = 1.5;
        const bins = new Map();
        for (let y = 0; y < H; y++) {
            const lat = 90 - (y + 0.5) * 180 / H;
            const rowBase = y * W;
            for (let x = 0; x < W; x++) {
                const rate = flash[rowBase + x];
                if (rate < 1e-6) continue;
                let u = (x + 0.5) / W - 0.5; u = ((u % 1) + 1) % 1;
                const lon = u * 360;
                const key = Math.floor((lat + 90) / BIN_DEG) + ":" + Math.floor((lon + 180) / BIN_DEG);
                const bin = bins.get(key);
                if (bin) { bin.rate += rate; bin.wSum += rate * lat; bin.lSum += rate * lon; bin.n++; }
                else bins.set(key, { rate, wSum: rate * lat, lSum: rate * lon, n: 1 });
            }
        }
        const strongest = [ ...bins.values() ].filter(b => b.rate > 0).sort((a, b) => b.rate - a.rate);
        // A few hundred regions, or all of them if there are fewer.
        const LIMIT = 240;
        const kept = strongest.slice(0, LIMIT);
        if (!kept.length) return null;
        const total = kept.reduce((a, b) => a + b.rate, 0);
        if (!(total > 0)) return null;
        return kept.map((bin, index) => {
            const lat = Math.max(-76, Math.min(76, bin.wSum / bin.rate));
            const lon = bin.lSum / bin.rate;
            return {
                lat, lon,
                normal: unitFromEarthLatLon(T, lat, lon),
                radiusDeg: BIN_DEG * 1.4,
                weight: bin.rate / total,
                nextAllowed: 0,
                index
            };
        });
    }
    createEntry(key, body, now) {
        const T = this.T;
        const model = LIGHTNING_MODELS[key];
        const profile = this.getAtmosphereProfile?.(key);
        const layers = profile?.derived?.layers || [];
        const layer = layers[model.layerIndex] || layers[0] || null;
        const baseColor = new T.Color(model.color);
        const gas = deriveGasResponse(layer, T, baseColor);
        const random = seededRandom((model.seed ^ this.sessionSeed) >>> 0);
        // Earth's strike regions come from the weather system where lightning
        // actually is, not from a list of famous storm spots: the flash map has
        // already summed every cell, squall line and cyclone on the planet into
        // flashes per second per texel, so binning it gives strike regions whose
        // weights *are* the measured distribution. A hard-coded list would put
        // bolts over the Sahel on a day the Sahel is clear.
        const dynamicRegions = key === "earth" ? this.buildEarthStrikeRegions(T, random) : null;
        // How many *visible bolts* per second the planet makes. The weather
        // system gives the flash rate -- every flash, intracloud and ground,
        // which is what the satellites count -- and only the ground flashes are
        // a bolt you can see. The observed ratio is about 3 intracloud for every
        // ground flash in mid-latitudes and 9:1 in the tropics (NASA), and
        // about 78 % of all lightning is tropical, so the visible share is
        // 0.78/10 + 0.22/4 = 0.133. 44 flashes a second therefore mean about
        // 5.9 bolts a second, which is what this renders.
        const CG_FRACTION = 0.78 / 10 + 0.22 / 4;
        const earthBoltRate = this.earthBoltRate(model.rate);
        const regions = dynamicRegions || model.zones.map(([baseLat, baseLon], index) => {
            const latJitter = (random() - .5) * (key === "earth" ? 8 : 4);
            const lonJitter = (random() - .5) * (key === "earth" ? 14 : 8);
            const lat = Math.max(-76, Math.min(76, baseLat + latJitter));
            const lon = ((baseLon + lonJitter + 180) % 360 + 360) % 360 - 180;
            const latitude = Math.abs(lat);
            return {
                lat: lat,
                lon: lon,
                normal: key === "earth" ? unitFromEarthLatLon(T, lat, lon) : unitFromLatLon(T, lat, lon),
                radiusDeg: key === "earth" ? 6 + random() * 6 : 0,
                weight: (latitude < 26 ? 1.35 : .78) * (.8 + random() * .4) * (index % 3 === 0 ? 1.12 : 1),
                nextAllowed: 0
            };
        });
        const group = new T.Group;
        group.name = key + " atmospheric lightning";
        group.frustumCulled = false;
        body.add(group);
        const radiusKm = this.getRadiusKm(key) || 6371;
        const radius = body.geometry?.parameters?.radius || 1;
        const slots = [];
        for (let i = 0; i < model.slots; i++) {
            const geometryState = makeLightningGeometry(T);
            const glowMaterial = makeMaterial(T, this.shaders, gas.tint, key === "earth" ? 6.5 : 3.4, 0, key === "earth" ? 0xFF49D7 : gas.tint);
            const coreMaterial = makeMaterial(T, this.shaders, 16777215, key === "earth" ? 1.5 : .9, 0, key === "earth" ? 0xFFE0FA : 16777215);
            const glow = new T.Mesh(geometryState.geometry, glowMaterial);
            const core = new T.Mesh(geometryState.geometry, coreMaterial);
            for (const mesh of [ glow, core ]) {
                mesh.frustumCulled = false;
                mesh.raycast = () => {};
                mesh.renderOrder = key === "earth" ? -1 : 5;
                group.add(mesh);
            }
            slots.push({
                ...geometryState,
                glow: glow,
                core: core,
                materials: [ glow.material, core.material ],
                event: null
            });
        }
        const delay = key === "earth" ? random() * .01 : 1.5 + random() * 3;
        const actualBottom = model.baseAltitudeKm ?? layer?.bottomKm ?? 0;
        const actualTop = model.topAltitudeKm ?? layer?.topKm ?? actualBottom + 20;
        const rangeBottom = Math.max(0, actualBottom);
        const rangeTop = Math.max(rangeBottom + .1, actualTop);
        return {
            key: key,
            model: model,
            body: body,
            group: group,
            radius: radius,
            radiusKm: radiusKm,
            regions: regions,
            regionsFromWeather: !!dynamicRegions,
            slots: slots,
            flashEvents: new Array(regions.length).fill(null),
            flashStrengths: new Float32Array(regions.length),
            scratchPoints: Array.from({ length: MAX_PATH_STEPS + 1 }, () => new T.Vector3),
            scratchSpritePoints: Array.from({ length: 7 }, () => new T.Vector3),
            scratch: {
                surfaceDirection: new T.Vector3,
                reference: new T.Vector3,
                tangent: new T.Vector3,
                bitangent: new T.Vector3,
                point: new T.Vector3,
                previous: new T.Vector3
            },
            random: random,
            rate: Math.max(1e-4, key === "earth" ? earthBoltRate : model.rate * gas.rateFactor),
            rateFactor: gas.rateFactor,
            gasTint: gas.tint,
            layer: layer,
            baseAltitudeKm: rangeBottom,
            topAltitudeKm: rangeTop,
            nextStrike: now + delay,
            scale: new T.Vector3(1, 1, 1)
        };
    }
    destroyEntry(entry) {
        if (!entry) return;
        if (entry.group.parent) entry.group.parent.remove(entry.group);
        for (const slot of entry.slots || []) {
            slot.geometry.dispose();
            slot.glow.material.dispose();
            slot.core.material.dispose();
        }
    }
    deactivateEntry(entry, now, retryDelay = 0) {
        let clear = entry.group.visible;
        if (!clear) for (const slot of entry.slots) if (slot.event) {
            clear = true;
            break;
        }
        entry.group.visible = false;
        entry.nextStrike = now + Math.max(0, retryDelay);
        if (!clear) return;
        for (const slot of entry.slots) {
            slot.event = null;
            slot.geometry.setDrawRange(0, 0);
            slot.glow.material.uniforms.uAlpha.value = 0;
            slot.core.material.uniforms.uAlpha.value = 0;
        }
        if (entry.key === "earth") this.clearEarthCloudFlash();
    }
    getEntry(key, body, now) {
        let entry = this.entries.get(key);
        if (entry?.body === body) return entry;
        if (entry) this.destroyEntry(entry);
        entry = this.createEntry(key, body, now);
        this.entries.set(key, entry);
        return entry;
    }
    buildStrike(entry, slot, region, now, location = null, simulationRate = 1) {
        const random = entry.random;
        const isEarth = entry.key === "earth";
        const normal = location?.normal || region.normal;
        const scratch = entry.scratch;
        const surfaceDirection = scratch.surfaceDirection.copy(normal);
        let surfaceRadius = entry.radius;
        if (isEarth) {
            const axes = entry.body.geometry?.userData?.referenceAxesKm;
            if (axes?.length >= 3) {
                const maxAxis = Math.max(...axes);
                surfaceDirection.set(normal.x * axes[0] / maxAxis, normal.y * axes[2] / maxAxis, normal.z * axes[1] / maxAxis);
                surfaceRadius *= surfaceDirection.length();
                surfaceDirection.normalize();
            }
        }
        const reference = scratch.reference.set(0, 1, 0);
        if (Math.abs(surfaceDirection.y) >= .88) reference.set(1, 0, 0);
        const tangent = scratch.tangent.crossVectors(reference, surfaceDirection).normalize();
        const bitangent = scratch.bitangent.crossVectors(surfaceDirection, tangent).normalize();
        const unitPerKm = entry.radius / entry.radiusKm;
        const terrainKm = isEarth && Number.isFinite(location?.surfaceHeightKm) ? Math.max(0, location.surfaceHeightKm) : 0;
        const baseAltitudeKm = isEarth ? terrainKm + .12 : entry.baseAltitudeKm;
        const topAltitudeKm = Math.max(entry.topAltitudeKm, baseAltitudeKm + 2);
        const spanKm = topAltitudeKm - baseAltitudeKm;
        const lateral = Math.max(.2, entry.model.lateralKm) * unitPerKm;
        const stepCount = MAX_PATH_STEPS;
        const points = entry.scratchPoints;
        let segmentCount = 0;
        for (let i = 0; i <= stepCount; i++) {
            const t = i / stepCount;
            const altitude = baseAltitudeKm + spanKm * t;
            const radius = surfaceRadius + altitude * unitPerKm;
            const bend = lateral * (.1 + .9 * Math.sin(Math.PI * t));
            const sideOffset = (random() * 2 - 1) * bend;
            const crossOffset = (random() * 2 - 1) * bend * .68;
            points[i].copy(surfaceDirection).multiplyScalar(radius).addScaledVector(tangent, sideOffset).addScaledVector(bitangent, crossOffset);
        }
        for (let i = 0; i < stepCount; i++) {
            const strength = .52 + .48 * Math.sin(Math.PI * (i + 1) / (stepCount + 1));
            addRibbonSegment(slot, segmentCount++, points[i], points[i + 1], strength);
        }
        if (isEarth) {
            const spriteTopKm = 86;
            const spriteSteps = 6;
            const spritePoints = entry.scratchSpritePoints;
            spritePoints[0].copy(points[stepCount]);
            for (let i = 1; i <= spriteSteps; i++) {
                const t = i / spriteSteps;
                const altitude = topAltitudeKm + (spriteTopKm - topAltitudeKm) * t;
                const radius = surfaceRadius + altitude * unitPerKm;
                const sideOffset = (random() - .5) * lateral * .10;
                const crossOffset = (random() - .5) * lateral * .06;
                const point = spritePoints[i].copy(surfaceDirection).multiplyScalar(radius)
                    .addScaledVector(tangent, sideOffset).addScaledVector(bitangent, crossOffset);
                addRibbonSegment(slot, segmentCount++, spritePoints[i - 1], point, .18 * (1 - t * .32), 1);
            }
            const spriteSpread = Math.max(18, entry.model.lateralKm * 2.5) * unitPerKm;
            for (let forkIndex = 0; forkIndex < EARTH_SPRITE_FORK_SOURCES.length; forkIndex++) {
                const sourceIndex = EARTH_SPRITE_FORK_SOURCES[forkIndex];
                const previous = scratch.previous.copy(spritePoints[sourceIndex]);
                const branchSign = forkIndex % 2 === 0 ? -1 : 1;
                const startAltitude = topAltitudeKm + (spriteTopKm - topAltitudeKm) * sourceIndex / spriteSteps;
                for (let i = 1; i <= 3; i++) {
                    const t = i / 3;
                    const altitude = startAltitude + (spriteTopKm - startAltitude) * t;
                    const radius = surfaceRadius + altitude * unitPerKm;
                    const lateralOffset = branchSign * spriteSpread * (.10 + t * .72) + (random() - .5) * spriteSpread * .08;
                    const crossOffset = (random() - .5) * spriteSpread * .10;
                    const point = scratch.point.copy(surfaceDirection).multiplyScalar(radius)
                        .addScaledVector(tangent, lateralOffset).addScaledVector(bitangent, crossOffset);
                    addRibbonSegment(slot, segmentCount++, previous, point, .15 * (1 - t * .38), 1);
                    previous.copy(point);
                }
            }
        } else {
            for (const fork of OTHER_FORKS) {
                const sourceIndex = fork + Math.floor(random() * 2);
                const previous = scratch.previous.copy(points[Math.min(sourceIndex, points.length - 2)]);
                const branchSign = random() < .5 ? -1 : 1;
                for (let i = 1; i <= MAX_BRANCH_STEPS; i++) {
                    const t = i / MAX_BRANCH_STEPS;
                    const radialT = Math.min(1, sourceIndex / stepCount + t * .2);
                    const altitude = baseAltitudeKm + spanKm * radialT;
                    const radius = surfaceRadius + altitude * unitPerKm;
                    const lateralOffset = branchSign * lateral * (.1 + t * .2) + (random() - .5) * lateral * .14;
                    const crossOffset = (random() - .5) * lateral * .18;
                    const point = scratch.point.copy(surfaceDirection).multiplyScalar(radius)
                        .addScaledVector(tangent, lateralOffset).addScaledVector(bitangent, crossOffset);
                    addRibbonSegment(slot, segmentCount++, previous, point, .34 * (1 - t * .35), 1);
                    previous.copy(point);
                }
            }
        }
        const slotIndex = entry.slots.indexOf(slot);
        slot.positionAttribute.needsUpdate = true;
        slot.otherAttribute.needsUpdate = true;
        slot.strengthAttribute.needsUpdate = true;
        slot.branchAttribute.needsUpdate = true;
        slot.geometry.setDrawRange(0, segmentCount * 6);
        const duration = isEarth ? .12 + random() * .06 : .36 + random() * .32;
        const pulseShift = random() * .018;
        const pulses = isEarth
            ? [ [ 0, 1.05 + random() * .55 ], [ .025 + pulseShift, .34 + random() * .42 ], [ .065 + pulseShift, .22 + random() * .42 ] ]
            : [ [ 0, 1.05 + random() * .55 ], [ .055 + pulseShift, .34 + random() * .42 ], [ .15 + pulseShift, .22 + random() * .42 ] ];
        const daylight = isEarth ? Math.max(0, normal.dot(this.localSun)) : 0;
        const visibility = isEarth ? 1 - .82 * daylight : 1;
        slot.event = {
            start: now,
            duration: duration,
            pulses: pulses,
            energy: 1 + random() * .65,
            visibility: visibility,
            regionIndex: isEarth ? entry.regions.indexOf(region) : -1,
            location: location
        };
        const coolingTime = isEarth ? .08 + random() * .22 : .65 + random() * 2.4;
        region.nextAllowed = now + coolingTime / Math.max(1e-4, simulationRate);
        this.stats.strikes++;
        return slotIndex;
    }
    clearEarthCloudFlash() {
        const uniforms = this.getEarthCloudGlowMaterial?.()?.uniforms;
        const packed = uniforms?.uLightningFlash?.value;
        if (packed?.fill) packed.fill(0);
        if (uniforms?.uLightningFlashCount) uniforms.uLightningFlashCount.value = 0;
    }
    updateEarthCloudFlash(entry, now, cloudOpacity) {
        const uniforms = this.getEarthCloudGlowMaterial?.()?.uniforms;
        const packed = uniforms?.uLightningFlash?.value;
        if (!packed?.fill || !uniforms?.uLightningFlashCount) return;
        packed.fill(0);
        const strongestEvents = entry.flashEvents;
        const strongestStrengths = entry.flashStrengths;
        strongestEvents.fill(null);
        strongestStrengths.fill(0);
        for (const slot of entry.slots) {
            const event = slot.event;
            const regionIndex = event?.regionIndex;
            if (!event?.location?.normal || regionIndex < 0 || regionIndex >= strongestEvents.length) continue;
            const envelope = pulseEnvelope(now - event.start, event.duration, event.pulses);
            const strength = envelope * (event.energy || 0) * (event.visibility ?? 1) * cloudOpacity;
            if (strength > .01 && strength > strongestStrengths[regionIndex]) {
                strongestEvents[regionIndex] = event;
                strongestStrengths[regionIndex] = strength;
            }
        }
        let count = 0;
        for (let i = 0; i < strongestEvents.length && count < EARTH_LIGHTNING_FLASH_SLOTS; i++) {
            const event = strongestEvents[i];
            if (!event) continue;
            const offset = count * 4;
            packed[offset] = event.location.normal.x;
            packed[offset + 1] = event.location.normal.y;
            packed[offset + 2] = event.location.normal.z;
            packed[offset + 3] = strongestStrengths[i];
            count++;
        }
        uniforms.uLightningFlashCount.value = count;
    }
    updateEntry(entry, now, enabled, simulationRate = 1) {
        const body = entry.body;
        const isEarth = entry.key === "earth";
        if (!body || !visibleInHierarchy(body) || !enabled || document.hidden) {
            this.deactivateEntry(entry, now);
            return;
        }
        const earthCloudTexture = isEarth ? this.getEarthCloudTexture?.() : null;
        const earthCloudOpacity = isEarth
            ? Math.max(0, Math.min(1, this.getEarthCloudOpacity?.() ?? 1))
            : 1;
        if (isEarth && (!earthCloudTexture || earthCloudOpacity <= .001)) {
            this.deactivateEntry(entry, now, .25);
            return;
        }
        if (isEarth) this.refreshEarthStrikeRegions(entry);
        if (earthCloudTexture) earthCloudTexture.updateMatrix?.();
        body.getWorldPosition(this.bodyPosition);
        body.getWorldScale(entry.scale);
        const worldScale = Math.max(Math.abs(entry.scale.x), Math.abs(entry.scale.y), Math.abs(entry.scale.z));
        const distance = Math.max(this.cameraPosition.distanceTo(this.bodyPosition), entry.radius);
        const viewportHeight = this.renderer.domElement?.clientHeight || window.innerHeight || 1;
        const projectedRadius = entry.radius * worldScale * this.camera.projectionMatrix.elements[5] * viewportHeight / (2 * distance);
        const weatherExtentKm = Math.max(entry.topAltitudeKm, isEarth ? 86 : 0) + Math.max(0, entry.model.lateralKm) * 2.5;
        this.boundsSphere.center.copy(this.bodyPosition);
        this.boundsSphere.radius = entry.radius * worldScale * (1 + weatherExtentKm / Math.max(1, entry.radiusKm));
        if (!this.frustum.intersectsSphere(this.boundsSphere) || projectedRadius < 12) {
            this.deactivateEntry(entry, now, .25);
            return;
        }
        entry.group.visible = true;
        this.bodyQuaternion.copy(body.getWorldQuaternion(this.bodyQuaternion)).invert();
        this.localSun.copy(this.sunPosition).sub(this.bodyPosition).normalize().applyQuaternion(this.bodyQuaternion);
        this.localView.copy(this.cameraPosition).sub(this.bodyPosition).normalize().applyQuaternion(this.bodyQuaternion);
        for (const slot of entry.slots) {
            for (const material of slot.materials) {
                material.uniforms.uViewport.value.copy(this.viewport);
                if (isEarth) {
                    material.uniforms.uEarthCloudTexture.value = earthCloudTexture;
                    material.uniforms.uEarthCloudTextureMatrix.value.copy(earthCloudTexture.matrix);
                    material.uniforms.uEarthCloudUseAlpha.value = earthCloudTexture.userData?.cloudMaskChannel === "alpha" ? 1 : 0;
                    material.uniforms.uEarthCloudGate.value = 1;
                }
            }
        }
        const rateScale = isEarth ? Math.max(0, Number.isFinite(simulationRate) ? simulationRate : 1) : 1;
        const scaledRate = entry.rate * rateScale;
        if (!(scaledRate > 0)) {
            entry.nextStrike = now;
        } else {
            const maxEventsThisFrame = isEarth ? EARTH_LIGHTNING_MAX_EVENTS_PER_FRAME : Math.max(1, entry.slots.length);
            const viewLimit = isEarth ? -.12 : .16;
            const sunLimit = isEarth ? .12 : .08;
            let processed = 0;
            while (now >= entry.nextStrike && processed < maxEventsThisFrame) {
                const strikeTime = entry.nextStrike;
                const wait = -Math.log(Math.max(1e-6, 1 - entry.random())) / scaledRate;
                entry.nextStrike += Math.max(1e-5, wait);
                processed++;
                let totalWeight = 0;
                for (const region of entry.regions) {
                    if (region.nextAllowed > strikeTime || region.normal.dot(this.localView) < viewLimit) continue;
                    if (!isEarth && region.normal.dot(this.localSun) > sunLimit) continue;
                    totalWeight += region.weight;
                }
                if (!(totalWeight > 0)) continue;
                let pick = entry.random() * totalWeight;
                let chosen = null;
                for (const region of entry.regions) {
                    if (region.nextAllowed > strikeTime || region.normal.dot(this.localView) < viewLimit) continue;
                    if (!isEarth && region.normal.dot(this.localSun) > sunLimit) continue;
                    pick -= region.weight;
                    if (pick <= 0) {
                        chosen = region;
                        break;
                    }
                }
                if (!chosen) continue;
                const location = this.chooseStrikeLocation(entry, chosen);
                if (!location) continue;
                if (isEarth) {
                    const height = this.getSurfaceHeightKm?.("earth", location.normal);
                    location.surfaceHeightKm = Number.isFinite(height) ? height : 0;
                }
                let slot = null;
                for (const candidate of entry.slots) {
                    if (!candidate.event || now - candidate.event.start >= candidate.event.duration) {
                        slot = candidate;
                        break;
                    }
                }
                if (!slot && isEarth) {
                    let oldestTime = Infinity;
                    for (const candidate of entry.slots) {
                        if (candidate.event && candidate.event.start < oldestTime) {
                            oldestTime = candidate.event.start;
                            slot = candidate;
                        }
                    }
                }
                if (slot) this.buildStrike(entry, slot, chosen, strikeTime, location, isEarth ? simulationRate : 1);
            }
            if (processed >= maxEventsThisFrame && now >= entry.nextStrike) {
                const wait = -Math.log(Math.max(1e-6, 1 - entry.random())) / scaledRate;
                entry.nextStrike = now + Math.max(1e-5, wait);
            }
        }
        const cloudOpacity = isEarth ? earthCloudOpacity : 1;
        const glowGain = isEarth ? .9 : .55;
        const coreGain = isEarth ? 1.35 : 1.15;
        for (const slot of entry.slots) {
            const event = slot.event;
            const envelope = event ? pulseEnvelope(now - event.start, event.duration, event.pulses) : 0;
            const level = envelope * (event?.energy || 0);
            const visibility = event?.visibility ?? 1;
            slot.glow.material.uniforms.uAlpha.value = level * glowGain * visibility * cloudOpacity;
            slot.core.material.uniforms.uAlpha.value = level * coreGain * visibility * cloudOpacity;
            if (event && now - event.start >= event.duration) {
                slot.event = null;
                slot.geometry.setDrawRange(0, 0);
            }
        }
        if (isEarth) this.updateEarthCloudFlash(entry, now, earthCloudOpacity);
    }
    update(nowSeconds = performance.now() / 1e3, simulationRate = 1) {
        const now = Number.isFinite(nowSeconds) ? nowSeconds : performance.now() / 1e3;
        const rate = Math.max(0, Number.isFinite(simulationRate) ? simulationRate : 1);
        const enabled = !!this.getLightningEnabled?.();
        this.camera.updateMatrixWorld(true);
        this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.viewProjection);
        this.camera.getWorldPosition(this.cameraPosition);
        const sun = this.objectRegistry.sun;
        if (sun) sun.getWorldPosition(this.sunPosition); else this.sunPosition.set(0, 0, 0);
        this.renderer.getDrawingBufferSize(this.viewport);
        let active = 0;
        for (const [key] of LIGHTNING_MODEL_ENTRIES) {
            const body = this.objectRegistry[key];
            if (!body) continue;
            const entry = this.getEntry(key, body, now);
            this.updateEntry(entry, now, enabled, rate);
            for (const slot of entry.slots) if (slot.event) active++;
        }
        this.stats.active = active;
    }
    dispose() {
        for (const entry of this.entries.values()) this.destroyEntry(entry);
        this.entries.clear();
    }
}
