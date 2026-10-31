// Procedural surface maps baked on the GPU, in the same spirit as the atmosphere bake.
// One full-screen pass writes an equirectangular albedo map, which becomes the
// body's diffuse texture; nothing runs again after startup.
// Surface colour generator: climate bands (latitude to climate, ice caps,
// beach, snow line, elevation gradation), sedimentary layers on steep slopes,
// global albedo variation, the water mask in alpha, and terrain height from a
// cellular lithosphere field plus ridged detail (the height map).
// Not used: a precomputed 3D noise texture and a photographic material atlas are not
// in the shader pak, so the noise is analytic gradient noise and the atlas is a
// per-body palette. Crater, river, city, cloud and volcano branches are out.
// Not on the startup path: bodies keep their canvas fallback and each map is baked
// on an idle callback, one body at a time, then swapped in.

const TERRA_BAKE_VERTEX = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const TERRA_BAKE_FRAGMENT = `
precision highp float;
varying vec2 vUv;

uniform vec3  uSeed;
uniform float uFreq;        // continent cell frequency
uniform float uDetail;      // ridged detail frequency
uniform float uRelief;      // how much of the height is ridged detail
uniform float uSeaLevel;    // height below which the surface is water
uniform float uSnowLevel;
uniform float uLatIce;
uniform float uLatTropic;
uniform vec3  uSnow;
uniform vec3  uRock;
uniform vec3  uLow;
uniform vec3  uMid;
uniform vec3  uHigh;
uniform vec3  uWater;
uniform float uWaterMask;   // 1 = allow water, 0 = dry body

#define PI 3.14159265359
// Shared noise constants: lacunarity 2.218281828459, H 0.5,
// gain = pow(noiseLacunarity, -noiseH) = 0.6710.
#define LAC  2.218281828459
#define GAIN 0.6710

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453);
}

// Gradient noise, the cheap equivalent of a noise-texture lookup,
// a precomputed 3D texture. Range [-1,1].
float gnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float n000 = dot(hash33(i + vec3(0.0, 0.0, 0.0)) * 2.0 - 1.0, f - vec3(0.0, 0.0, 0.0));
    float n100 = dot(hash33(i + vec3(1.0, 0.0, 0.0)) * 2.0 - 1.0, f - vec3(1.0, 0.0, 0.0));
    float n010 = dot(hash33(i + vec3(0.0, 1.0, 0.0)) * 2.0 - 1.0, f - vec3(0.0, 1.0, 0.0));
    float n110 = dot(hash33(i + vec3(1.0, 1.0, 0.0)) * 2.0 - 1.0, f - vec3(1.0, 1.0, 0.0));
    float n001 = dot(hash33(i + vec3(0.0, 0.0, 1.0)) * 2.0 - 1.0, f - vec3(0.0, 0.0, 1.0));
    float n101 = dot(hash33(i + vec3(1.0, 0.0, 1.0)) * 2.0 - 1.0, f - vec3(1.0, 0.0, 1.0));
    float n011 = dot(hash33(i + vec3(0.0, 1.0, 1.0)) * 2.0 - 1.0, f - vec3(0.0, 1.0, 1.0));
    float n111 = dot(hash33(i + vec3(1.0, 1.0, 1.0)) * 2.0 - 1.0, f - vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
               mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

// Fbm: amplitude *= pow(lacunarity, -H) per octave.
// Normalised so the result has mean 0.5; the unnormalised form made
// callers compensate by subtracting constants.
float fbm(vec3 p, float octaves) {
    float sum = 0.0;
    float amp = 1.0;
    float norm = 0.0;
    for (int i = 0; i < 8; i++) {
        if (float(i) >= octaves) break;
        sum += (0.5 + 0.5 * gnoise(p)) * amp;
        norm += amp;
        amp *= GAIN;
        p *= LAC;
    }
    return sum / max(norm, 1e-5);
}

// Ridged multifractal, noise offset 0.8, ridge smooth 1e-4.
float ridged(vec3 p, float octaves, float offset) {
    float signal = 1.0;
    float sum = 0.0;
    float freq = 1.0;
    float amp = 1.0;
    float norm = 0.0;
    for (int i = 0; i < 8; i++) {
        if (float(i) >= octaves) break;
        float weight = clamp(signal * 2.0, 0.0, 1.0);
        signal = 0.5 + 0.5 * gnoise(p * freq);
        signal = offset - sqrt(1e-4 + signal * signal);
        signal *= signal * weight;
        sum += signal * pow(freq, -0.5);
        norm += pow(freq, -0.5);
        freq *= LAC;
    }
    return sum / max(norm, 1e-5);
}

// Cell noise: distance to the nearest and second
// nearest feature point, plus the random colour of the nearest cell.
vec2 cell3(vec3 p, out vec3 cellColor) {
    vec3 ip = floor(p);
    vec3 fp = fract(p);
    float d1 = 1e9;
    float d2 = 1e9;
    cellColor = vec3(0.5);
    for (int z = -1; z <= 1; z++) {
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec3 g = vec3(float(x), float(y), float(z));
                vec3 o = hash33(ip + g);
                vec3 r = g + o - fp;
                float d = dot(r, r);
                if (d < d1) {
                    d2 = d1;
                    d1 = d;
                    cellColor = o;
                } else if (d < d2) {
                    d2 = d;
                }
            }
        }
    }
    return sqrt(vec2(d1, d2));
}

// The height map, reduced to what decides the silhouette:
// warped fbm continents, ridged detail, and the cellular field only as basins.
// Using the cellular field as the continents puts a hard ridge on every cell
// boundary, which the slope term turns into a visible vein.
float terrainHeight(vec3 point) {
    vec3 p = point * uFreq + uSeed;
    vec3 warp = vec3(fbm(p * 0.73, 3.0) - 0.5, fbm(p * 0.73 + 17.3, 3.0) - 0.5, fbm(p * 0.73 + 41.7, 3.0) - 0.5);
    p += warp * 0.9;
    float continents = fbm(p, 5.0) - 0.5;
    float ridges = ridged(point * uDetail + uSeed, 5.0, 0.8) - 0.5;
    vec3 cellColor;
    float basins = 1.0 - cell3(p * 0.55, cellColor).x;
    return continents * 2.2 + uRelief * ridges * 0.55 + 0.3 * (basins - 0.55);
}

vec3 terrainNormalSlope(vec3 point) {
    // Two extra height samples along a fixed tangent frame. The slope only
    // drives the rock and snow lines, so a one-directional estimate is enough
    // and costs a third of a full gradient.
    vec3 up = abs(point.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 tangent = normalize(cross(up, point));
    const float e = 0.0015;
    float h0 = terrainHeight(point);
    float h1 = terrainHeight(normalize(point + tangent * e));
    // The height is unitless (roughly -0.7..0.7) while e is an angle, so the
    // raw difference divided by e is a number in the tens. The constant turns
    // it into an approximate slope: a 0.02 height step across e is ~2% grade.
    return vec3(h0, clamp(abs(h1 - h0) * 0.75, 0.0, 1.0), 0.0);
}

// ColourMapTerra's climate logic in two outputs, because they mean different things:
// climate is temperature (1 hot equator, 0.15 coldest bare ground) and snow is ice
// cover (0 none, 1 full cap). Folding them into one scalar made the polar end of the
// temperature ramp be snow, so every body came out white.
void climateAt(vec3 point, float height, float slope, out float climate, out float snow) {
    float latitude = abs(point.y);
    latitude += 0.15 * (fbm(point * 0.7 + uSeed, 3.0) - 0.5);
    latitude = clamp(latitude, 0.0, 1.0);

    climate = mix(1.0, 0.15, smoothstep(uLatTropic - 0.16, uLatTropic + 0.16, latitude));

    // Beach: only the first few percent above the water line. Dry bodies skip
    // the term entirely - with no sea there is no shoreline to cool.
    if (uWaterMask > 0.5) {
        float beach = clamp((height / uSeaLevel - 1.0) * 50.0, 0.0, 1.0);
        climate = mix(0.375, climate, beach);
    }

    // Ice caps: polar latitude only.
    float iceCap = clamp((latitude / uLatIce - 1.0) * 22.0, 0.0, 1.0);

    // Snow line, softened by the terrain variation.
    float vary = fbm(point * 1700.0 + uSeed, 3.0);
    float snowLine = height + 0.25 * vary * slope;
    float montSnow = clamp((snowLine - uSnowLevel) * 8.0, 0.0, 1.0);
    snow = max(iceCap, montSnow);

    // Elevation cools the ground; it must not erase the caps, so it only moves
    // the palette, never the snow term.
    float montHeight = clamp(height / max(uSnowLevel, 1e-3), 0.0, 1.0);
    climate -= 0.35 * montHeight;
    climate = clamp(climate, 0.0, 1.0);
}

// Surface colour: where a photographic atlas would pick a tile,
// MaterialTable, we pick a colour off a five-stop per-body ramp.
vec3 palette(float height, float slope, float climate) {
    // Colour is keyed off (height, slope), height first, so the elevation ramp
    // is primary; driving colour from latitude climate paints horizontal bands.
    // Stops span the range the terrain actually produces, about -0.5..0.45.
    vec3 c = mix(uRock, uLow, smoothstep(-0.45, -0.15, height));
    c = mix(c, uMid, smoothstep(-0.15, 0.08, height));
    c = mix(c, uHigh, smoothstep(0.08, 0.32, height));
    // Exposed rock on the steepest ground.
    c = mix(c, uRock, smoothstep(0.35, 0.85, slope));
    // Cold ground sits a little darker and greyer towards the poles.
    c *= mix(0.82, 1.0, clamp(climate, 0.0, 1.0));
    return c;
}

void main() {
    // Equirectangular direction for this texel. v = 0 is the south pole so the
    // image lines up with three's sphere UVs, where v = 1 is the north pole.
    float lon = (vUv.x - 0.5) * 2.0 * PI;
    float lat = (vUv.y - 0.5) * PI;
    vec3 point = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));

    vec3 ns = terrainNormalSlope(point);
    float height = ns.x;
    float slope = ns.y;
    if (uWaterMask > 0.5) height = max(height, uSeaLevel * 0.85);

    float climate;
    float snow;
    climateAt(point, height, slope, climate, snow);
    vec3 color = mix(palette(height, slope, climate), uSnow, snow);

    // Sedimentary layers, only on steep slopes.
    // The frequency is tied to height units; 168 on a 0..1 height
    // aliases into blocks at bake resolution, so the same banding runs at a
    // frequency that resolves.
    float layers = fbm(vec3(height * 60.0, 0.43 * (point.x + point.z), 0.43 * (point.z - point.y)), 4.0);
    layers *= smoothstep(0.55, 0.7, slope);
    color *= vec3(1.0) - vec3(0.0, 0.5, 1.0) * layers * 0.35;

    // Global albedo variation: a brown-grey tint mixed with white by vary.
    float distort = (fbm(point * 0.07 + uSeed, 3.0) - 0.5) * 1.5;
    float vary = 1.0 - fbm((point + distort) * 0.78, 4.0);
    color *= mix(vec3(0.78, 0.72, 0.56), vec3(1.0), vary);

    // Fine grain. A material atlas would supply this; with
    // no atlas, three octaves of fine noise keep the map from reading as a
    // smooth gradient at close range.
    float grain = fbm(point * 90.0 + uSeed, 3.0);
    color *= 0.94 + 0.12 * grain;

    // Water mask in alpha, as the colour generator defines it.
    float water = 0.0;
    if (uWaterMask > 0.5) {
        water = clamp((uSeaLevel - height) * 200.0, 0.0, 1.0);
        color = mix(color, uWater, smoothstep(0.0, 0.25, uSeaLevel - height));
    }

    color = clamp(color, 0.0, 1.0);
    gl_FragColor = vec4(color, water);
}
`;

// Colour ramps. Chosen per body from its actual appearance: Mars oxidised dust
// over dark basalt with bright caps, Venus sulphur plains, Mercury and the Moon
// grey regolith with darker maria.
const TERRA_PROFILES = {
    mars: {
        seed: [ 11.7, 3.9, 52.1 ],
        freq: 2.4, detail: 7.0, relief: 0.85,
        seaLevel: -0.28, snowLevel: 0.62, latIce: 0.93, latTropic: 0.42,
        snow: "#ece8e2", rock: "#3a2823", low: "#8e5231", mid: "#b06a3f", high: "#ddb083",
        water: "#000000", waterMask: 0
    },
    venus: {
        seed: [ 71.2, 9.4, 3.3 ],
        freq: 1.9, detail: 6.0, relief: 0.8,
        seaLevel: -0.3, snowLevel: 1.2, latIce: 4.0, latTropic: 0.5,
        snow: "#e6dcc0", rock: "#8d7752", low: "#b9a273", mid: "#cfbb8c", high: "#e2d2a8",
        water: "#000000", waterMask: 0
    },
    mercury: {
        seed: [ 3.1, 44.8, 17.6 ],
        freq: 2.7, detail: 9.0, relief: 0.6,
        seaLevel: -0.3, snowLevel: 1.2, latIce: 4.0, latTropic: 0.5,
        snow: "#b9b4ae", rock: "#33302d", low: "#524d48", mid: "#7a756e", high: "#a8a29a",
        water: "#000000", waterMask: 0
    },
    moon: {
        seed: [ 27.5, 6.2, 88.4 ],
        freq: 2.1, detail: 8.0, relief: 0.55,
        seaLevel: -0.3, snowLevel: 1.2, latIce: 4.0, latTropic: 0.5,
        snow: "#c8c4bd", rock: "#2d2b29", low: "#4a4744", mid: "#8f8b84", high: "#cfcbc4",
        water: "#000000", waterMask: 0
    }
};

function terraBakeColor(hex) {
    const value = parseInt(String(hex).replace("#", ""), 16);
    return new THREE.Vector3(
        ((value >> 16) & 255) / 255,
        ((value >> 8) & 255) / 255,
        (value & 255) / 255
    );
}

const terraBakeCache = Object.create(null);
const terraBakeFailures = Object.create(null);

function bakeTerraMap(renderer, key, options = {}) {
    if (!renderer || !renderer.capabilities || !THREE) return null;
    if (terraBakeCache[key]) return terraBakeCache[key];
    if (terraBakeFailures[key]) return null;
    const profile = TERRA_PROFILES[key];
    if (!profile) return null;
    const width = Math.max(64, Math.floor(options.width || 1024));
    const height = Math.max(32, Math.floor(width / 2));

    let target = null;
    let scene = null;
    let material = null;
    try {
        const uniforms = {
            uSeed: { value: new THREE.Vector3(...profile.seed) },
            uFreq: { value: profile.freq },
            uDetail: { value: profile.detail },
            uRelief: { value: profile.relief },
            uSeaLevel: { value: profile.seaLevel },
            uSnowLevel: { value: profile.snowLevel },
            uLatIce: { value: profile.latIce },
            uLatTropic: { value: profile.latTropic },
            uSnow: { value: terraBakeColor(profile.snow) },
            uRock: { value: terraBakeColor(profile.rock) },
            uLow: { value: terraBakeColor(profile.low) },
            uMid: { value: terraBakeColor(profile.mid) },
            uHigh: { value: terraBakeColor(profile.high) },
            uWater: { value: terraBakeColor(profile.water) },
            uWaterMask: { value: profile.waterMask }
        };
        material = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: TERRA_BAKE_VERTEX,
            fragmentShader: TERRA_BAKE_FRAGMENT,
            depthTest: false,
            depthWrite: false
        });
        target = new THREE.WebGLRenderTarget(width, height, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            generateMipmaps: false,
            depthBuffer: false,
            stencilBuffer: false
        });
        const geometry = new THREE.PlaneGeometry(2, 2);
        scene = new THREE.Scene();
        scene.add(new THREE.Mesh(geometry, material));
        const previousTarget = renderer.getRenderTarget();
        const previousAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setRenderTarget(target);
        renderer.clear(true, false, false);
        renderer.render(scene, new THREE.Camera());
        renderer.setRenderTarget(previousTarget);
        renderer.autoClear = previousAutoClear;
        // A render-target texture never gets a mip chain, and without mips the map
        // aliases at grazing angles: moire across the ground and blobby patches from
        // orbit. Read the bake back into a DataTexture, which does get mips.
        const pixels = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
        const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.name = "terra-bake:" + key;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy?.() || 1);
        texture.needsUpdate = true;
        texture.userData = texture.userData || {};
        texture.userData.surfaceSource = "terra-bake";
        texture.userData.terraBakeProfile = key;
        terraBakeCache[key] = texture;
        scene.clear();
        geometry.dispose();
        material.dispose();
        target.dispose();
        target = null;
        return texture;
    } catch (error) {
        terraBakeFailures[key] = error?.message || "bake failed";
        try {
            scene?.clear?.();
            material?.dispose?.();
            target?.dispose?.();
        } catch (ignored) {}
        if (typeof console !== "undefined" && console.warn) {
            console.warn("[Solister] procedural map bake failed for " + key + ": " + terraBakeFailures[key]);
        }
        return null;
    }
}

// Bake one body per idle callback so a slow GPU never stalls a frame. Bodies
// that already have a supplied ktx2 map are skipped: applyTextureToObject has
// given their material a texture with surfaceResolution set.
function queueTerraBakes(renderer, keys, options = {}) {
    const schedule = globalThis.requestIdleCallback
        || ((fn) => setTimeout(fn, 90));
    const registry = options.registry || globalThis.objectRegistry || null;
    const pending = keys.filter((key) => TERRA_PROFILES[key]);
    let index = 0;

    const step = () => {
        if (index >= pending.length) return;
        const key = pending[index++];
        const body = registry?.[key];
        const material = Array.isArray(body?.material) ? body.material[0] : body?.material;
        const current = material?.map || null;
        if (current?.userData?.surfaceResolution) {
            schedule(step);
            return;
        }
        const texture = bakeTerraMap(renderer, key, options);
        if (texture && material && (!material.map || !material.map.userData?.surfaceResolution)) {
            material.map = texture;
            material.needsUpdate = true;
            if (body.userData) body.userData.terraBakedMap = texture;
        }
        schedule(step);
    };
    schedule(step);
}

globalThis.bakeTerraMap = bakeTerraMap;
globalThis.queueTerraBakes = queueTerraBakes;
globalThis.TERRA_PROFILES = TERRA_PROFILES;
