// Atmosphere lab: drives the real GPU LUT generator and the real shell
// material from the app, and checks the tables against an independent
// double-precision reference (tests/atmo/reference.js).
import "../../src/app/three-runtime.js";
import * as REF from "./reference.js";

// Eclipse stub formerly inlined in harness.html; it must run after the
// r186 runtime has installed the THREE global.
// Eclipse helpers normally come from src/app/state.js (classic script).  The
// lab renders the shell without an eclipse, so stub them as no-ops.
globalThis.eclipseUniforms = {
  uEclipseMoon: { value: new THREE.Vector3() },
  uEclipseSun: { value: new THREE.Vector3(1e9, 0, 0) },
  uEclipseMoonRadius: { value: 0 },
  uEclipseSunRadius: { value: 0 }
};
// Same signature and behaviour as state.js: without a moon in front of the
// sun, visibility is 1 everywhere.
globalThis.ECLIPSE_GLSL = [
  "uniform vec3 uEclipseMoon;",
  "uniform vec3 uEclipseSun;",
  "uniform float uEclipseMoonRadius;",
  "uniform float uEclipseSunRadius;",
  "float solarVisibility(vec3 p) {",
  "    vec3 toSun = uEclipseSun - p;",
  "    vec3 toMoon = uEclipseMoon - p;",
  "    float ds = length(toSun);",
  "    float dm = length(toMoon);",
  "    if (dm >= ds || dm <= uEclipseMoonRadius || uEclipseSunRadius <= 0.0 || uEclipseMoonRadius <= 0.0) return 1.0;",
  "    vec3 s = toSun / ds;",
  "    vec3 m = toMoon / dm;",
  "    float separation = atan(length(cross(s, m)), dot(s, m));",
  "    float rs = asin(clamp(uEclipseSunRadius / ds, 0.0, 1.0));",
  "    float rm = asin(clamp(uEclipseMoonRadius / dm, 0.0, 1.0));",
  "    float d = separation / max(rs, 1e-8);",
  "    float r = rm / max(rs, 1e-8);",
  "    if (d >= 1.0 + r) return 1.0;",
  "    if (d <= abs(1.0 - r)) return 1.0 - min(1.0, r * r);",
  "    float d2 = d * d;",
  "    float r2 = r * r;",
  "    float a = acos(clamp((d2 + 1.0 - r2) / (2.0 * d), -1.0, 1.0));",
  "    float b2 = acos(clamp((d2 + r2 - 1.0) / (2.0 * d * r), -1.0, 1.0));",
  "    float product = (-d + 1.0 + r) * (d + 1.0 - r) * (d - 1.0 + r) * (d + 1.0 + r);",
  "    float overlap = a + r2 * b2 - 0.5 * sqrt(max(0.0, product));",
  "    return clamp(1.0 - overlap / 3.14159265359, 0.0, 1.0);",
  "}"
].join("\n");

// The classic atmosphere modules build some state at load time with THREE
// (planet-atmosphere profiles use THREE.Color), so they are loaded only after
// the r186 runtime has installed the global. Same order as the old harness.
async function loadClassicScript(src) {
    await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = new URL(src, document.baseURI).href;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load " + script.src));
        document.head.appendChild(script);
    });
}
for (const src of [
    "../../src/render/atmosphere/bruneton-luts.js",
    "../../src/render/atmosphere/lut-binary.js",
    "../../src/data/atmosphere-reference-models.js",
    "../../src/render/atmosphere/transmittance-table.js",
    "../../src/shaders/planet-atmosphere.glsl.js"
]) await loadClassicScript(src);

const canvas = document.getElementById("view");
const logEl = document.getElementById("log");
const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance"
});
renderer.setPixelRatio(1);
renderer.setSize(512, 512, false);
renderer.autoClear = true;

globalThis.renderer = renderer;
globalThis.THREE = THREE;
globalThis.cloudMeshes = globalThis.cloudMeshes || {};
globalThis.objectRegistry = globalThis.objectRegistry || {};

function log(message) {
    logEl.textContent = String(message).slice(0, 4000);
}

// ---------------------------------------------------------------------------
// table readback + CPU re-implementation of the runtime sampler
// ---------------------------------------------------------------------------
const LAYOUT = globalThis.BRUNETON_LAYOUT;

function readTarget(target) {
    const out = new Float32Array(target.width * target.height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, out);
    return out;
}

function texel2D(table, width, height, u, v) {
    // Bilinear, clamp-to-edge, matching GL_LINEAR on a non-mipmapped texture.
    const x = Math.min(Math.max(u * width - 0.5, 0), width - 1);
    const y = Math.min(Math.max(v * height - 0.5, 0), height - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const fx = x - x0;
    const fy = y - y0;
    const out = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
        const a = table[(y0 * width + x0) * 4 + c];
        const b = table[(y0 * width + x1) * 4 + c];
        const d = table[(y1 * width + x0) * 4 + c];
        const e = table[(y1 * width + x1) * 4 + c];
        out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
    }
    return out;
}

function transmittanceUV(P, r, mu) {
    const uR = Math.sqrt(Math.min(Math.max((r - P.Rg) / Math.max(P.Rt - P.Rg, 1e-9), 0), 1));
    const uMu = Math.atan((mu + 0.15) / 1.15 * Math.tan(1.5)) / 1.5;
    return [Math.min(Math.max(uMu, 0), 1), uR];
}

function lookupTransmittance(P, table, r, mu) {
    const [u, v] = transmittanceUV(P, Math.min(Math.max(r, P.Rg), P.Rt), Math.min(Math.max(mu, -1), 1));
    const t = texel2D(table, LAYOUT.TRANS_W, LAYOUT.TRANS_H, u, v);
    return [t[0], t[1], t[2]];
}

// texture4DAtlas, transcribed from bruneton-luts.js but operating on the
// readback array so the GPU sampler and the CPU agree on the parameterisation.
function texture4D(P, atlas, r, mu, muS, nu) {
    const H = Math.sqrt(Math.max(P.Rt * P.Rt - P.Rg * P.Rg, 1e-12));
    const rho = Math.sqrt(Math.max(r * r - P.Rg * P.Rg, 0));
    const rmu = r * mu;
    const delta = rmu * rmu - r * r + P.Rg * P.Rg;
    const ground = rmu < 0 && delta > 0;
    const cst = ground ? [1, 0, 0, 0.5 - 0.5 / LAYOUT.RES_MU] : [-1, H * H, H, 0.5 + 0.5 / LAYOUT.RES_MU];
    const uR = 0.5 / LAYOUT.RES_R + rho / H * (1 - 1 / LAYOUT.RES_R);
    const denom = rho + cst[2];
    let uMu = cst[3];
    if (denom > 0) uMu += (rmu * cst[0] + Math.sqrt(Math.max(delta + cst[1], 0))) / denom * (0.5 - 1 / LAYOUT.RES_MU);
    let uMuS = 0.5 / LAYOUT.RES_MU_S
        + (Math.atan(Math.max(muS, -0.1975) * Math.tan(1.26 * 1.1)) / 1.1 + (1 - 0.26)) * 0.5
        * (1 - 1 / LAYOUT.RES_MU_S);
    uMuS = Math.min(Math.max(uMuS, 0.5 / LAYOUT.RES_MU_S), 1 - 0.5 / LAYOUT.RES_MU_S);
    const lerpNu = (Math.min(Math.max(nu, -1), 1) + 1) / 2 * (LAYOUT.RES_NU - 1);
    const uNu = Math.floor(lerpNu);
    const fNu = lerpNu - uNu;
    const sliceF = Math.min(Math.max(uR, 0), 1) * LAYOUT.RES_R - 0.5;
    const s0 = Math.min(Math.max(Math.floor(sliceF), 0), LAYOUT.RES_R - 2);
    const fR = Math.min(Math.max(sliceF - s0, 0), 1);
    const W = LAYOUT.ATLAS_W;
    const Hh = LAYOUT.ATLAS_H;
    const sample = (x, y) => texel2D(atlas, W, Hh, x, y);
    const uv = (s, xs) => [(uNu + xs) / LAYOUT.RES_NU, (s + uMu) / LAYOUT.RES_R];
    const mix4 = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
    let lo = mix4(sample(...uv(s0, uMuS)), sample(...uv(s0, uMuS + 1)), fNu);
    let hi = mix4(sample(...uv(s0 + 1, uMuS)), sample(...uv(s0 + 1, uMuS + 1)), fNu);
    return mix4(lo, hi, fR);
}

// ---------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------
function normalisedParams(params) {
    return {
        Rg: 1,
        Rt: params.Rt / params.Rg,
        HR: params.HR / params.Rg,
        HM: params.HM / params.Rg,
        betaR: params.betaR.map(v => v * params.Rg),
        betaMSca: params.betaMSca.map(v => v * params.Rg),
        betaMEx: params.betaMEx.map(v => v * params.Rg),
        mieG: params.mieG
    };
}

function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = s * 1664525 + 1013904223 >>> 0;
        return s / 4294967296;
    };
}

function verifyBody(key, sampleCount = 120, orders = null) {
    const params = globalThis.brunetonParamsForBody(key);
    if (!params) return { key, error: "no params" };
    globalThis.brunetonClearCache();
    const built = globalThis.buildBrunetonLuts(THREE, renderer, key, params, {
        orders: orders ?? globalThis.atmosphereOrderBudget(key)
    });
    if (!built) return { key, error: "build failed" };
    const trans = readTarget(built.targets[0]);
    const ins = readTarget(built.targets[2]);
    const P = normalisedParams(params);
    const rng = makeRng(0x9e3779b9 ^ key.length);

    const transErrors = [];
    for (let i = 0; i < 40; i++) {
        const r = P.Rg + (0.02 + 0.96 * rng()) * (P.Rt - P.Rg);
        const mu = -0.9 + 1.9 * rng();
        const exact = REF.transmittanceExactPath(P, r, mu, 3072);
        const table = lookupTransmittance(P, trans, r, mu);
        for (let c = 0; c < 3; c++) {
            const denom = Math.max(Math.abs(exact[c]), 1e-3);
            transErrors.push(Math.abs(table[c] - exact[c]) / denom);
        }
    }

    const scatterErrors = [];
    const scatterSamples = [];
    let attempts = 0;
    while (scatterSamples.length < sampleCount && attempts < sampleCount * 40) {
        attempts++;
        const r = P.Rg + (0.004 + 0.7 * rng() * rng()) * (P.Rt - P.Rg);
        const mu = -0.98 + 1.96 * rng();
        const muS = -0.5 + 1.5 * rng();
        const vx = Math.sqrt(Math.max(1 - mu * mu, 0));
        const lo = muS * mu - vx * Math.sqrt(Math.max(1 - muS * muS, 0));
        const hi = muS * mu + vx * Math.sqrt(Math.max(1 - muS * muS, 0));
        const nu = lo + (hi - lo) * rng();
        const exact = REF.singleScatterExact(P, r, mu, muS, nu, 700);
        if (!exact) continue;
        const stored = texture4D(P, ins, r, mu, muS, nu);
        const rayMag = Math.hypot(exact.ray[0], exact.ray[1], exact.ray[2]);
        const mieMag = Math.hypot(exact.mie[0], exact.mie[1], exact.mie[2]);
        if (rayMag < 2e-5 && mieMag < 2e-5) continue;
        const denom = Math.max(rayMag, 2e-4);
        const err = Math.hypot(stored[0] - exact.ray[0], stored[1] - exact.ray[1], stored[2] - exact.ray[2]) / denom;
        scatterErrors.push(err);
        scatterSamples.push({ r, mu, muS, nu, table: [stored[0], stored[1], stored[2], stored[3]], exactRay: exact.ray, exactMie: exact.mie });
    }

    const pct = (arr, q) => {
        if (!arr.length) return 0;
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
    };
    return {
        key,
        buildMs: Math.round(built.buildMs),
        params,
        transmittance: {
            samples: transErrors.length,
            median: pct(transErrors, 0.5),
            p90: pct(transErrors, 0.9),
            max: Math.max(...transErrors)
        },
        singleScatter: {
            samples: scatterErrors.length,
            median: pct(scatterErrors, 0.5),
            p90: pct(scatterErrors, 0.9),
            max: Math.max(...scatterErrors)
        },
        worst: scatterSamples.sort((a, b) => b.err - a.err).slice(0, 5)
    };
}

// ---------------------------------------------------------------------------
// shell rendering: a lit sphere + the app's real atmosphere material
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 20000);
let bodyMesh = null;
let shell = null;
let currentKey = null;

function buildBody(key) {
    if (currentKey === key && bodyMesh) return;
    if (bodyMesh) {
        bodyMesh.removeFromParent();
        bodyMesh.traverse(o => {
            o.geometry?.dispose?.();
            o.material?.dispose?.();
        });
        bodyMesh = null;
        shell = null;
    }
    globalThis.cloudMeshes = {};
    const profile = globalThis.PLANET_ATMOSPHERE_PROFILES[key];
    if (!profile) throw new Error("no atmosphere profile for " + key);
    const radius = 1;
    const geometry = globalThis.BodyShapes.createGeometry(THREE, key, radius, 512, 256);
    const surface = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0x9aa4b0 }));
    globalThis.objectRegistry = { [key]: surface };
    scene.add(surface);
    bodyMesh = surface;
    currentKey = key;
    shell = globalThis.createPlanetAtmosphere(key, surface, profile);
    return { profile, shell };
}

function setCamera(distance, azimuth, elevation) {
    camera.position.set(
        Math.cos(elevation) * Math.sin(azimuth) * distance,
        Math.sin(elevation) * distance,
        Math.cos(elevation) * Math.cos(azimuth) * distance
    );
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
}

let labLight = null;

function renderFrame({ key, distance = 3.2, azimuth = 0, elevation = 0, sunAzimuth = 0.6, sunElevation = 0.25, sunIntensity = 1, inside = false }) {
    buildBody(key);
    // Same rule as renderHorizon: a camera 0.004 R above the ground (or just
    // outside the shell) has its nearest geometry well inside a fixed 0.01 near
    // plane, which clips the near hemisphere of the shell and leaves holes. The
    // app derives near from the viewing distance when it lands, so scale it with
    // the gap to the surface and leave orbit views at the old 0.01.
    camera.near = Math.min(0.01, Math.max(2e-9, 0.02 * Math.max(distance - 1, 1e-7)));
    camera.updateProjectionMatrix();
    if (shell) shell.material.depthTest = true;   // orbit views need the depth test
    const sunDir = new THREE.Vector3(
        Math.cos(sunElevation) * Math.sin(sunAzimuth),
        Math.sin(sunElevation),
        Math.cos(sunElevation) * Math.cos(sunAzimuth)
    ).normalize();
    if (!labLight) {
        labLight = new THREE.DirectionalLight(0xffffff, 3.0);
        scene.add(labLight);
        scene.add(new THREE.AmbientLight(0xffffff, 0.01));
    }
    labLight.position.copy(sunDir).multiplyScalar(50);
    setCamera(distance, azimuth, elevation);

    if (shell) {
        const uniforms = shell.material.uniforms;
        const inverseForm = new THREE.Matrix4().copy(bodyMesh.matrixWorld).invert().multiply(camera.matrixWorld);
        const rotation = new THREE.Matrix3().setFromMatrix4(inverseForm);
        const centerView = new THREE.Vector3(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
        const eyeLocal = new THREE.Vector3().setFromMatrixPosition(inverseForm);
        uniforms.intensity.value = globalThis.PLANET_ATMOSPHERE_PROFILES[key].intensity;
        uniforms.uBodyCenterView.value.copy(centerView);
        uniforms.uViewToBodyLocal.value.copy(rotation);
        uniforms.uInsideShell.value = inside || eyeLocal.length() < uniforms.uShellRadius.value ? 1 : 0;
        // Same anchoring as the app: the shell is measured from the LOCAL
        // surface, so the harness has to report the eye height it placed the
        // camera at. Without this every inside view renders from sea level.
        if (uniforms.uEyeHeightR) uniforms.uEyeHeightR.value = Math.max(eyeLocal.length() - 1, 1e-7);
        uniforms.uSunIntensity.value = sunIntensity;
        uniforms.uSunDir.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
        // uMieFade only exists on the LUT material; the march fallback has no
        // such uniform, and forcing the fallback (__solisterForceMarch) must not
        // crash the harness.
        if (uniforms.uMieFade) uniforms.uMieFade.value = globalThis.brunetonParamsForBody(key).mieFade;
    }
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    return true;
}

// ---------------------------------------------------------------------------
// table dump for baking
// ---------------------------------------------------------------------------
function dumpTables(key) {
    const params = globalThis.brunetonParamsForBody(key);
    globalThis.brunetonClearCache();
    const built = globalThis.buildBrunetonLuts(THREE, renderer, key, params, {
        orders: orders ?? globalThis.atmosphereOrderBudget(key)
    });
    if (!built) return null;
    const toBase64 = (f32) => {
        const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    };
    return {
        key,
        signature: built.signature,
        params,
        transmittance: toBase64(readTarget(built.targets[0])),
        irradiance: toBase64(readTarget(built.targets[1])),
        inscatter: toBase64(readTarget(built.targets[2]))
    };
}


// ---------------------------------------------------------------------------
// node-wise verification: reconstruct (r,mu,muS,nu) for a texel with the same
// inverse mapping the generator uses, then compare the stored value with the
// brute-force integral.  This isolates the physics and the parameterisation
// from the bilinear/trilinear interpolation error.
// ---------------------------------------------------------------------------
function layerRadius(P, layer) {
    const H = Math.sqrt(Math.max(P.Rt * P.Rt - P.Rg * P.Rg, 1e-12));
    const t = layer / (LAYOUT.RES_R - 1);
    return Math.sqrt(P.Rg * P.Rg + t * t * H * H);
}

function layerDhdH(P, layer) {
    const H = Math.sqrt(Math.max(P.Rt * P.Rt - P.Rg * P.Rg, 1e-12));
    const r = layerRadius(P, layer);
    const dh = Math.sqrt(Math.max(r * r - P.Rg * P.Rg, 0));
    return [Math.max(P.Rt - r, 0), dh + H, Math.max(r - P.Rg, 0), dh];
}

function nodeMuMuSNu(P, layer, i, j) {
    const r = layerRadius(P, layer);
    const dhdH = layerDhdH(P, layer);
    const x = i;
    const y = j;
    let mu;
    if (y < LAYOUT.RES_MU / 2) {
        let d = 1 - y / (LAYOUT.RES_MU / 2 - 1);
        d = Math.min(Math.max(dhdH[2], d * dhdH[3]), dhdH[3] * 0.999);
        d = Math.max(d, 1e-4);
        mu = (P.Rg * P.Rg - r * r - d * d) / (2 * r * d);
        mu = Math.min(mu, -Math.sqrt(Math.max(1 - (P.Rg / r) * (P.Rg / r), 0)) - 0.001);
    } else {
        let d = (y - LAYOUT.RES_MU / 2) / (LAYOUT.RES_MU / 2 - 1);
        d = Math.min(Math.max(dhdH[0], d * dhdH[1]), dhdH[1] * 0.999);
        d = Math.max(d, 1e-4);
        mu = (P.Rt * P.Rt - r * r - d * d) / (2 * r * d);
    }
    let muS = (x % LAYOUT.RES_MU_S) / (LAYOUT.RES_MU_S - 1);
    muS = Math.tan((2 * muS - 1 + 0.26) * 1.1) / Math.tan(1.26 * 1.1);
    const nu = -1 + Math.floor(x / LAYOUT.RES_MU_S) / (LAYOUT.RES_NU - 1) * 2;
    return { r, mu, muS, nu };
}

function verifyNodes(key, layers = [0, 4, 8, 12, 16, 20, 24, 28, 31], orders = 1) {
    const params = globalThis.brunetonParamsForBody(key);
    globalThis.brunetonClearCache();
    // orders = 1 isolates single scattering so the table can be compared with
    // the brute-force single-scatter integral; the shipped build runs the full
    // order budget and adds multiple scattering on top.
    const built = globalThis.buildBrunetonLuts(THREE, renderer, key, params, { orders });
    verifyNodes.lastRatio = null;
    if (!built) return { key, error: "build failed" };
    const trans = readTarget(built.targets[0]);
    const ins = readTarget(built.targets[2]);
    const P = normalisedParams(params);

    // transmittance texels
    const transErr = [];
    for (let j = 1; j < LAYOUT.TRANS_H; j += 3) {
        for (let i = 0; i < LAYOUT.TRANS_W; i += 7) {
            const rF = (j + 0.5) / LAYOUT.TRANS_H;
            const mF = (i + 0.5) / LAYOUT.TRANS_W;
            const r = P.Rg + rF * rF * (P.Rt - P.Rg);
            const mu = -0.15 + Math.tan(1.5 * mF) / Math.tan(1.5) * 1.15;
            if (r >= P.Rt) continue;
            const exact = REF.transmittanceExactPath(P, r, mu, 4096);
            const t = trans[(j * LAYOUT.TRANS_W + i) * 4];
            transErr.push(Math.abs(t - exact[0]) / Math.max(Math.abs(exact[0]), 1e-4));
        }
    }

    // inscatter texels (physics node check)
    const nodeErr = [];
    const worst = [];
    const byLayer = {};
    const byMuBand = [[], [], [], [], []];
    for (const layer of layers) {
        for (let j = 0; j < LAYOUT.RES_MU; j += 5) {
            for (let i = 0; i < LAYOUT.ATLAS_W; i += 11) {
                const node = nodeMuMuSNu(P, layer, i, j);
                if (!(node.mu > -1 && node.mu < 1)) continue;
                const exact = REF.singleScatterExact(P, node.r, node.mu, node.muS, node.nu, 700);
                if (!exact) continue;
                const mag = Math.hypot(exact.ray[0], exact.ray[1], exact.ray[2]);
                if (mag < 1e-3) continue;   // relative error is meaningless below this
                if (layer === 0) continue;   // knife-edge ground layer, checked separately
                const row = layer * LAYOUT.RES_MU + j;
                const base = (row * LAYOUT.ATLAS_W + i) * 4;
                const err = Math.hypot(ins[base] - exact.ray[0], ins[base + 1] - exact.ray[1], ins[base + 2] - exact.ray[2]) / mag;
                nodeErr.push(err);
                byLayer[layer] = byLayer[layer] || [];
                byLayer[layer].push(err);
                byMuBand[Math.min(4, Math.floor(Math.abs(node.mu) * 5))].push(err);
                if (err > 0.35) worst.push({ layer, i, j, ...node, stored: [ins[base], ins[base + 1], ins[base + 2]], exact: exact.ray, err });
            }
        }
    }
    const pct = (arr, q) => {
        if (!arr.length) return 0;
        const s2 = [...arr].sort((a, b) => a - b);
        return s2[Math.min(s2.length - 1, Math.floor(q * (s2.length - 1)))];
    };
    // how much multiple scattering adds at the same nodes (informational)
    let msRatio = null;
    if (orders === 1) {
        globalThis.brunetonClearCache();
        const multi = globalThis.buildBrunetonLuts(THREE, renderer, key, params, {
            orders: Math.max(2, globalThis.atmosphereOrderBudget(key))
        });
        if (multi) {
            const insM = readTarget(multi.targets[2]);
            const ratios = [];
            for (const entry of worst.length ? [] : []) ratios.push(entry);
            for (const layer of [8, 16, 24]) {
                for (let j = 34; j < 60; j += 4) {
                    for (let i = 0; i < LAYOUT.ATLAS_W; i += 17) {
                        const row = layer * LAYOUT.RES_MU + j;
                        const b = (row * LAYOUT.ATLAS_W + i) * 4;
                        if (ins[b] > 2e-3) ratios.push(insM[b] / ins[b]);
                    }
                }
            }
            ratios.sort((a, b2) => a - b2);
            msRatio = ratios.length ? { median: ratios[Math.floor(ratios.length / 2)], n: ratios.length } : null;
        }
    }
    return {
        key,
        orders,
        msRatio,
        transmittanceNodes: { samples: transErr.length, median: pct(transErr, 0.5), p90: pct(transErr, 0.9), max: Math.max(...transErr) },
        scatterNodes: { samples: nodeErr.length, median: pct(nodeErr, 0.5), p90: pct(nodeErr, 0.9), max: Math.max(...nodeErr) },
        byLayer: Object.fromEntries(Object.entries(byLayer).map(([k, v]) => [k, { n: v.length, median: pct(v, 0.5) }])),
        byMuBand: byMuBand.map(v => ({ n: v.length, median: pct(v, 0.5) })),
        worst: worst.sort((a, b) => b.err - a.err).slice(0, 4)
    };
}



// Transcribe ag_inscatter1 exactly, but sample the *GPU* transmittance table.
// If this reproduces the stored texel, the shader path is consistent and any
// difference from the brute force is algorithmic; if it does not, the bug is in
// how the pass is set up.
function lutT(P, table, r, mu) {
    return lookupTransmittance(P, table, r, mu);
}
function lutTBetween(P, table, r, mu, r1, mu1) {
    let a, b;
    if (mu > 0) { a = lutT(P, table, r, mu); b = lutT(P, table, r1, mu1); }
    else { a = lutT(P, table, r1, -mu1); b = lutT(P, table, r, -mu); }
    return a.map((v, i) => Math.min(v / Math.max(b[i], 1e-6), 1));
}
function lutTDist(P, table, r, mu, d) {
    const r1 = Math.sqrt(Math.max(r * r + d * d + 2 * r * mu * d, 0));
    const mu1 = (r * mu + d) / Math.max(r1, 1e-6);
    return lutTBetween(P, table, r, mu, r1, mu1);
}
function shaderInscatterFromTable(P, table, r, mu, muS, nu, N) {
    const L = REF.limit(P, r, mu);
    const dx = L / N;
    const ray = [0, 0, 0];
    let prev = [0, 0, 0];
    for (let i = 0; i <= N; i++) {
        const t = i * dx;
        let ri = Math.sqrt(Math.max(r * r + t * t + 2 * r * mu * t, 0));
        const muSi = (nu * t + muS * r) / Math.max(ri, 1e-6);
        ri = Math.max(P.Rg, ri);
        let cur = [0, 0, 0];
        if (muSi >= -Math.sqrt(Math.max(1 - P.Rg * P.Rg / (ri * ri), 0))) {
            const t1 = lutTDist(P, table, r, mu, t);
            const t2 = lutT(P, table, ri, muSi);
            const dens = Math.exp(-(ri - P.Rg) / P.HR);
            for (let c = 0; c < 3; c++) cur[c] = dens * t1[c] * t2[c];
        }
        if (i > 0) for (let c = 0; c < 3; c++) ray[c] += (prev[c] + cur[c]) * 0.5 * dx;
        prev = cur;
    }
    return ray.map((v, c) => v * P.betaR[c]);
}

function shaderInscatterExactT(P, r, mu, muS, nu, N) {
    const L = REF.limit(P, r, mu);
    const dx = L / N;
    const ray = [0, 0, 0];
    const o = [0, 0, r];
    const v = [Math.sqrt(Math.max(1 - mu * mu, 0)), 0, mu];
    const sx = v[0] > 1e-9 ? (nu - muS * mu) / v[0] : 0;
    const s = [sx, Math.sqrt(Math.max(0, 1 - sx * sx - muS * muS)), muS];
    let prev = [0, 0, 0];
    for (let i = 0; i <= N; i++) {
        const t = i * dx;
        let ri = Math.sqrt(Math.max(r * r + t * t + 2 * r * mu * t, 0));
        const muSi = (nu * t + muS * r) / Math.max(ri, 1e-6);
        ri = Math.max(P.Rg, ri);
        let cur = [0, 0, 0];
        if (muSi >= -Math.sqrt(Math.max(1 - P.Rg * P.Rg / (ri * ri), 0))) {
            const t1 = REF.transmittanceExact(P, o, v, t, 256);
            const t2 = REF.sunTransmittance(P, [v[0] * t, 0, r + v[2] * t], s, 256);
            const dens = Math.exp(-(ri - P.Rg) / P.HR);
            for (let c = 0; c < 3; c++) cur[c] = dens * t1[c] * t2[c];
        }
        if (i > 0) for (let c = 0; c < 3; c++) ray[c] += (prev[c] + cur[c]) * 0.5 * dx;
        prev = cur;
    }
    return ray.map((v2, c) => v2 * P.betaR[c]);
}

function debugNode(key, layer = 12, i = 96, j = 40, N = 50) {
    const params = globalThis.brunetonParamsForBody(key);
    globalThis.brunetonClearCache();
    const built = globalThis.buildBrunetonLuts(THREE, renderer, key, params, {
        orders: globalThis.atmosphereOrderBudget(key)
    });
    const trans = readTarget(built.targets[0]);
    const ins = readTarget(built.targets[2]);
    const P = normalisedParams(params);
    const node = nodeMuMuSNu(P, layer, i, j);
    const row = layer * LAYOUT.RES_MU + j;
    const base = (row * LAYOUT.ATLAS_W + i) * 4;
    const stored = [ins[base], ins[base + 1], ins[base + 2]];
    const js50 = shaderInscatterFromTable(P, trans, node.r, node.mu, node.muS, node.nu, N);
    const js400 = shaderInscatterFromTable(P, trans, node.r, node.mu, node.muS, node.nu, 400);
    const exact = REF.singleScatterExact(P, node.r, node.mu, node.muS, node.nu, 1200);
    const exactT = shaderInscatterExactT(P, node.r, node.mu, node.muS, node.nu, 50);
    return { node, stored, js50, js400, exact, exactT };
}

window.__lab = {
    ready: true,
    info: () => {
        const gl = renderer.getContext();
        return {
            webgl2: renderer.capabilities.isWebGL2,
            renderer: gl.getParameter(gl.RENDERER),
            floatLinear: !!renderer.extensions.get("OES_texture_float_linear"),
            layouts: LAYOUT,
            bodies: Object.keys(globalThis.PLANET_ATMOSPHERE_PROFILES)
        };
    },
    bodyParams: (key) => globalThis.brunetonParamsForBody(key),
    verify: verifyBody,
    render: renderFrame,
    dump: dumpTables,
    readbackSupported: true
};

function profileNode(key, layer, i) {
    const params = globalThis.brunetonParamsForBody(key);
    globalThis.brunetonClearCache();
    const built = globalThis.buildBrunetonLuts(THREE, renderer, key, params, {
        orders: globalThis.atmosphereOrderBudget(key)
    });
    const trans = readTarget(built.targets[0]);
    const ins = readTarget(built.targets[2]);
    const P = normalisedParams(params);
    const lines = [];
    for (let j = 0; j < LAYOUT.RES_MU; j++) {
        const node = nodeMuMuSNu(P, layer, i, j);
        const row = layer * LAYOUT.RES_MU + j;
        const base = (row * LAYOUT.ATLAS_W + i) * 4;
        const j8 = shaderInscatterFromTable(P, trans, node.r, node.mu, node.muS, node.nu, 8)[0];
        const j16 = shaderInscatterFromTable(P, trans, node.r, node.mu, node.muS, node.nu, 16)[0];
        const j50 = shaderInscatterFromTable(P, trans, node.r, node.mu, node.muS, node.nu, 50)[0];
        const j200 = shaderInscatterFromTable(P, trans, node.r, node.mu, node.muS, node.nu, 200)[0];
        lines.push(`j=${String(j).padStart(2)} mu=${node.mu.toFixed(4).padStart(8)} gpu=${ins[base].toExponential(2)} n8=${j8.toExponential(2)} n16=${j16.toExponential(2)} n50=${j50.toExponential(2)} n200=${j200.toExponential(2)}`);
    }
    return { text: lines.join('\n') };
}
function debugMap(key) {
    const params = globalThis.brunetonParamsForBody(key);
    const n = globalThis.brunetonNormalise(params);
    const RgN = n.Rg / n.Rg, RtN = n.Rt / n.Rg;
    const frag = globalThis.BRUNETON_COMMON + `
void main() {
    float layer, localY;
    atlasSlice(layer, localY);
    float mu, muS, nu;
    getMuMuSNu(vec2(gl_FragCoord.x, localY), sliceRadius(layer), sliceDhdH(layer), mu, muS, nu);
    gl_FragColor = vec4(mu, muS, nu, layer);
}`;
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uRg: { value: 1 },
            uRt: { value: RtN },
            uHR: { value: n.HR / n.Rg },
            uHM: { value: n.HM / n.Rg },
            uBetaR: { value: new THREE.Vector3(...n.betaR).multiplyScalar(n.Rg) },
            uBetaMSca: { value: new THREE.Vector3(...n.betaMSca).multiplyScalar(n.Rg) },
            uBetaMEx: { value: new THREE.Vector3(...n.betaMEx).multiplyScalar(n.Rg) },
            uMieG: { value: n.mieG }
        },
        vertexShader: globalThis.BRUNETON_VERT_FULL,
        fragmentShader: frag,
        depthTest: false,
        depthWrite: false
    });
    const target = new THREE.WebGLRenderTarget(LAYOUT.ATLAS_W, LAYOUT.ATLAS_H, {
        type: THREE.FloatType, format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        depthBuffer: false, stencilBuffer: false
    });
    const scene2 = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    scene2.add(quad);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene2, new THREE.Camera());
    renderer.setRenderTarget(null);
    const data = readTarget(target);
    const P = normalisedParams(params);
    const errs = [];
    for (const layer of [0, 7, 15, 23, 31]) {
        for (let j = 0; j < LAYOUT.RES_MU; j += 7) {
            for (let i = 0; i < LAYOUT.ATLAS_W; i += 13) {
                const n2 = nodeMuMuSNu(P, layer, i, j);
                const row = layer * LAYOUT.RES_MU + j;
                const b = (row * LAYOUT.ATLAS_W + i) * 4;
                errs.push({
                    dMu: Math.abs(data[b] - n2.mu),
                    dMuS: Math.abs(data[b + 1] - n2.muS),
                    dNu: Math.abs(data[b + 2] - n2.nu),
                    dLayer: Math.abs(data[b + 3] - layer),
                    r: n2.r, gpuR: layer
                });
            }
        }
    }
    const mx = (f) => errs.reduce((m, e) => Math.max(m, f(e)), 0);
    return { count: errs.length, maxDmu: mx(e => e.dMu), maxDmuS: mx(e => e.dMuS), maxDnu: mx(e => e.dNu), maxDlayer: mx(e => e.dLayer) };
}
function debugIntegrand(key, layer, i, j, step = 1) {
    const params = globalThis.brunetonParamsForBody(key);
    const n = globalThis.brunetonNormalise(params);
    const RtN = n.Rt / n.Rg;
    const frag = globalThis.BRUNETON_COMMON + `
uniform sampler2D uT;
void main() {
    float layer, localY;
    atlasSlice(layer, localY);
    float mu, muS, nu;
    float r = sliceRadius(layer);
    getMuMuSNu(vec2(gl_FragCoord.x, localY), r, sliceDhdH(layer), mu, muS, nu);
    float L = limit(r, mu);
    float dx = L / 50.0;
    float xj = dx * float(STEP);
    float ri = sqrt(max(r*r + xj*xj + 2.0*r*mu*xj, 0.0));
    float muSi = (nu*xj + muS*r) / max(ri, 1e-6);
    ri = max(uRg, ri);
    vec3 t1 = lutTransmittanceDist(uT, r, mu, xj);
    vec3 t2 = lutTransmittance(uT, ri, muSi);
    gl_FragColor = vec4(L, dx, muSi, t2.r);
}`.replaceAll("STEP", String(step));
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uRg: { value: 1 }, uRt: { value: RtN },
            uHR: { value: n.HR / n.Rg }, uHM: { value: n.HM / n.Rg },
            uBetaR: { value: new THREE.Vector3(...n.betaR).multiplyScalar(n.Rg) },
            uBetaMSca: { value: new THREE.Vector3(...n.betaMSca).multiplyScalar(n.Rg) },
            uBetaMEx: { value: new THREE.Vector3(...n.betaMEx).multiplyScalar(n.Rg) },
            uMieG: { value: n.mieG }, uT: { value: null }
        },
        vertexShader: globalThis.BRUNETON_VERT_FULL,
        fragmentShader: head + frag.replace("${BRUNETON_COMMON}", ""),
        depthTest: false, depthWrite: false
    });
    return { frag, mat };
}
// Hide the planet surface so the atmosphere's own radiance can be judged on
// its own (the lit Lambert disc otherwise dominates every screenshot).
// Sample a texture on the shell straight through a tiny float pass, so the
// actual GPU contents of the tables the shell is bound to can be inspected.
window.__lab.tableStats = (name = "uInscatterLut") => {
    const tex = shell?.material?.uniforms?.[name]?.value;
    if (!tex) return null;
    const N = 64;
    const mat = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: tex } },
        vertexShader: globalThis.BRUNETON_VERT_FULL,
        fragmentShader: `
            uniform sampler2D uTex;
            void main() { gl_FragColor = texture2D(uTex, gl_FragCoord.xy / ${N}.0); }`,
        depthTest: false, depthWrite: false
    });
    const target = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
    const sc = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    sc.add(quad);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(sc, new THREE.Camera());
    renderer.setRenderTarget(null);
    const data = readTarget(target);
    const ch = [0, 0, 0, 0];
    const mx = [0, 0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 4; c++) { ch[c] += data[i + c]; mx[c] = Math.max(mx[c], data[i + c]); }
    }
    const n = data.length / 4;
    return { size: [tex.image.width, tex.image.height], mean: ch.map(v => v / n), max: mx };
};
// Swap the shell's final colour expression to inspect intermediates on the
// real fragment shader path.
window.__lab.probeShader = (expr) => {
    if (!shell) return null;
    // Patch the material in place: cloning a ShaderMaterial clones its
    // render-target textures, and a cloned RenderTargetTexture has no data
    // (it would sample black) - that made every probe read zero.
    const mat = shell.material;
    if (!shell.userData.baseFrag) shell.userData.baseFrag = mat.fragmentShader;
    const base = shell.userData.baseFrag;
    const patched = base.replace("gl_FragColor = vec4(radiance, alpha);", "gl_FragColor = vec4(" + expr + ", 1.0);");
    if (patched === base) return { error: "anchor not found" };
    mat.fragmentShader = patched;
    mat.transparent = false;
    mat.blending = THREE.NoBlending;
    mat.needsUpdate = true;
    return { ok: true };
};
window.__lab.restoreShader = () => {
    if (!shell || !shell.userData.baseFrag) return false;
    const mat = shell.material;
    mat.fragmentShader = shell.userData.baseFrag;
    mat.transparent = true;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.premultipliedAlpha = true;
    mat.needsUpdate = true;
    return true;
};
window.__lab.setShellVisible = (v) => { if (!shell) return false; shell.visible = v; return true; };
window.__lab.dumpShell = () => { const m = shell?.material; return m ? { uniforms: Object.fromEntries(Object.entries(m.uniforms).map(([k,v]) => [k, v.value && v.value.isVector3 ? v.value.toArray().map(x=>+x.toFixed(4)) : (v.value && v.value.isVector2 ? v.value.toArray() : (typeof v.value === 'number' ? +v.value.toFixed(5) : (v.value === null ? null : 'tex')))])) } : null; };
window.__lab.setSurfaceVisible = (visible) => {
    if (!bodyMesh) return false;
    bodyMesh.material = visible
        ? new THREE.MeshLambertMaterial({ color: 0x9aa4b0 })
        : new THREE.MeshBasicMaterial({ color: 0x000000 });
    bodyMesh.material.needsUpdate = true;
    return true;
};
// Linear-space radiance probe used to calibrate uLutGain: renders the shell
// alone and the surface alone, so the atmosphere's contribution can be
// compared with the ground it sits on (bytes are sRGB-encoded on output).
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function samplePixel(x, y) {
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [srgbToLinear(px[0] / 255), srgbToLinear(px[1] / 255), srgbToLinear(px[2] / 255)];
}
window.__lab.calibrate = (key, gain, view = {}) => {
    const c = { key, distance: 6, elevation: 0.0, sunAzimuth: 0.0, sunElevation: 0.05, ...view };
    const H = renderer.domElement.height, W = renderer.domElement.width;
    const cx = Math.round(W / 2), cy = Math.round(H / 2);
    const setGain = (g) => { const u = shell?.material?.uniforms?.uLutGain; if (u) u.value = g; };
    const measure = () => { renderFrame(c); return samplePixel(cx, cy); };
    const litSurface = new THREE.MeshLambertMaterial({ color: 0x9aa4b0 });
    const blackSurface = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const swap = (m) => { bodyMesh.material = m; };
    setGain(gain);
    // shell is a child of the body, so hide it rather than the body
    shell.visible = false; swap(litSurface);
    const surface = measure();
    shell.visible = true;
    const composite = measure();
    swap(blackSurface);            // removes the ground so only the shell's own radiance remains
    const shellOnly = measure();
    swap(litSurface);
    return { surface, shellOnly, composite };
};
// A procedural Earth-like albedo map for judging the atmosphere against a
// realistic surface (the harness ships no texture assets). Pure canvas 2D.
function earthLikeTexture(width = 1024, height = 512) {
    const cv = document.createElement("canvas");
    cv.width = width; cv.height = height;
    const g = cv.getContext("2d");
    g.fillStyle = "#0d2b52";
    g.fillRect(0, 0, width, height);
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let i = 0; i < 26; i++) {
        const x = rnd() * width, y = height * (0.12 + rnd() * 0.72), r = 30 + rnd() * 120;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, "rgba(74, 92, 46, 0.95)");
        grad.addColorStop(0.7, "rgba(58, 74, 38, 0.75)");
        grad.addColorStop(1, "rgba(20, 40, 60, 0)");
        g.fillStyle = grad;
        g.beginPath(); g.ellipse(x, y, r, r * (0.5 + rnd()), rnd() * 3.14, 0, 6.283); g.fill();
    }
    for (let i = 0; i < 900; i++) {
        const x = rnd() * width, y = rnd() * height;
        const poleBias = Math.abs(y / height - 0.5) * 2;
        g.fillStyle = `rgba(235, 240, 245, ${0.05 + 0.25 * rnd() * poleBias})`;
        g.beginPath(); g.arc(x, y, 4 + rnd() * 26, 0, 6.283); g.fill();
    }
    g.fillStyle = "rgba(240, 246, 250, 0.95)";
    g.fillRect(0, 0, width, 10); g.fillRect(0, height - 10, width, 10);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}
window.__lab.useEarthTexture = () => {
    if (!bodyMesh) return false;
    bodyMesh.material = new THREE.MeshLambertMaterial({ map: earthLikeTexture() });
    return true;
};
window.__lab.useFlatSurface = () => {
    if (!bodyMesh) return false;
    bodyMesh.material = new THREE.MeshLambertMaterial({ color: 0x9aa4b0 });
    return true;
};
// Standing on the surface looking at the sky: the camera sits just above the
// ground and looks along the local tangent, so the frame is split between the
// horizon and the sky instead of staring straight down.
window.__lab.renderHorizon = ({ key, height = 0.0004, azimuth = 0, yaw = 0, sunAzimuth = 0.6,
                                 sunElevation = 0.3, pitch = 0.1, sunIntensity = 1 }) => {
    buildBody(key);
    // Orthonormal surface frame: up = local zenith, north/east = tangent plane.
    const up = new THREE.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth)).normalize();
    const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), up).normalize();
    const north = new THREE.Vector3().crossVectors(up, east).normalize();
    // sunElevation is measured above the LOCAL horizon, not above world Y. With
    // azimuth 0 the local up is +z while world-Y elevation 0 is also +z, so the
    // old world-Y formula turned "sunset" (0.02) into a sun 89 degrees up and
    // lit the ground at full noon brightness. The sun has to be built from the
    // same frame the camera stands in.
    const sunHorizon = north.clone().multiplyScalar(Math.cos(sunAzimuth))
        .addScaledVector(east, Math.sin(sunAzimuth)).normalize();
    const sunDir = up.clone().multiplyScalar(Math.sin(sunElevation))
        .addScaledVector(sunHorizon, Math.cos(sunElevation)).normalize();
    if (!labLight) {
        labLight = new THREE.DirectionalLight(0xffffff, 3.0);
        scene.add(labLight);
        scene.add(new THREE.AmbientLight(0xffffff, 0.01));
    }
    labLight.position.copy(sunDir).multiplyScalar(50);
    const tangent = north.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(east, Math.sin(yaw)).normalize();
    // The shell's exit point when looking up from the ground is only
    // (shellRadius - 1 - height) away - 0.009 for Earth at 400 m. With the
    // lab's default near = 0.01 that exit sits *inside* the near plane, so the
    // far surface is clipped and the top of the frame comes back black: a hard,
    // elevation-dependent cap (47008 px of 512x512 at pitch 1.2, exactly the
    // pixels a vec3(1.0) probe also leaves black). The app sets camera.near
    // from the viewing distance when it lands (camera-system.js:
    // Math.max(1e-12, km2u(5e-4), radius * 1e-9)), so the lab has to do the
    // same or it is testing a camera the app never uses.
    const bodyRadiusKm = BodyShapes.maxRadiusKm(key) || 6371;
    camera.near = Math.max(1e-12, 5e-4 / bodyRadiusKm, 1e-9);
    camera.updateProjectionMatrix();
    camera.position.copy(up).multiplyScalar(1 + height);
    camera.up.copy(up);
    camera.lookAt(camera.position.clone().addScaledVector(tangent, 1).addScaledVector(up, pitch));
    camera.updateMatrixWorld(true);
    if (shell) {
        const uniforms = shell.material.uniforms;
        const inverseForm = new THREE.Matrix4().copy(bodyMesh.matrixWorld).invert().multiply(camera.matrixWorld);
        uniforms.uBodyCenterView.value.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
        uniforms.uViewToBodyLocal.value.setFromMatrix4(inverseForm);
        uniforms.uInsideShell.value = 1;
        // The shell is anchored to the local surface: this pose puts the eye at
        // exactly 1 + height, so that IS its height above the ground.
        uniforms.uEyeHeightR.value = Math.max(height, 1e-7);
        // Inside the shell the pass is drawn at its EXIT surface, which lies
        // behind the ground: with depthTest on, every fragment over the planet
        // is culled and the atmosphere vanishes at the horizon instead of
        // hazing the ground. Emulate what the app must do when landed.
        shell.material.depthTest = false;
        uniforms.uSunIntensity.value = sunIntensity;
        uniforms.uSunDir.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    }
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    return true;
};
window.__lab.camera = camera;
window.__lab.scene = scene;
window.__lab.THREE = THREE;
window.__lab.getShell = () => shell;
window.__lab.getSurface = () => bodyMesh;
window.__lab.debugMap = debugMap;
window.__lab.profileNode = profileNode;
window.__lab.verifyNodes = verifyNodes;
window.__lab.debugNode = debugNode;

log("ready");
