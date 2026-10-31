import { AM_HARMONICS, AM_ROWS_OR_BUILD, TAU, DEG } from "./asteroid-theory.js";

export const ATTR = {
    el1: {
        name: "aEl1",
        size: 4
    },
    el2: {
        name: "aEl2",
        size: 4
    },
    el3: {
        name: "aEl3",
        size: 4
    },
    pend1: {
        name: "aPend1",
        size: 4
    },
    pend2: {
        name: "aPend2",
        size: 4
    },
    pend3: {
        name: "aPend3",
        size: 4
    }
};

export const KIND = {
    free: 0,
    tadpole: 1,
    horseshoe: 2
};

const FLOATS_PER_BODY = 24;

export function packElements(catalog, indices, holders = null) {
    const n = indices.length;
    const buf = new Float32Array(n * FLOATS_PER_BODY);
    for (let k = 0; k < n; k++) {
        const j = indices[k];
        const o = k * FLOATS_PER_BODY;
        const a = catalog.a[j], e = catalog.e[j], incl = catalog.incRad[j];
        const node0 = catalog.nodeRad[j], nodeDot = catalog.nodeDot[j];
        const varpi0 = catalog.varpiRad[j];
        const omega0 = varpi0 - node0;
        const periDot = catalog.periDot[j];
        const omegaDot = periDot - nodeDot;
        const M0 = catalog.mRad[j];
        const n_ = catalog.meanMotionDay[j];
        const epochDays = catalog.epochDays[j];
        buf[o + 0] = a;
        buf[o + 1] = e;
        buf[o + 2] = incl;
        buf[o + 3] = node0;
        buf[o + 4] = omega0;
        buf[o + 5] = M0;
        buf[o + 6] = n_;
        buf[o + 7] = nodeDot;
        buf[o + 8] = omegaDot;
        buf[o + 9] = epochDays;
        buf[o + 10] = KIND.free;
        buf[o + 11] = 0;
        const h = holders ? holders[j] : null;
        if (h && h.state) {
            const s = h.state;
            const kind = s.libration ? KIND.tadpole : s.type === "horseshoe" ? KIND.horseshoe : KIND.free;
            buf[o + 10] = kind;
            buf[o + 12] = s.modulus;
            buf[o + 13] = s.halfX0;
            buf[o + 14] = s.rateX;
            buf[o + 15] = s.libration ? s.k : s.omega0 || 0;
            buf[o + 16] = s.center;
            buf[o + 17] = s.sigma0;
            buf[o + 18] = s.peri0;
            buf[o + 19] = s.lambdaJ0;
            buf[o + 20] = s.libration ? 0 : s.sign || 1;
            buf[o + 21] = s.nu;
            buf[o + 22] = s.rates ? s.rates.periDot : periDot;
            buf[o + 23] = 0;
        }
    }
    return buf;
}

export function makeAttributes(THREE, packed, count) {
    const stride = FLOATS_PER_BODY;
    const view = (off, size) => new THREE.BufferAttribute(packed.subarray(off, off + count * stride), size).setUsage(THREE.DynamicDrawUsage ?? 35048);
    const attrs = {};
    for (const [key, spec] of Object.entries(ATTR)) {
        const out = new Float32Array(count * spec.size);
        for (let k = 0; k < count; k++) {
            const src = k * stride;
            const dst = k * spec.size;
            switch (key) {
              case "el1":
                out.set(packed.subarray(src, src + 4), dst);
                break;
              case "el2":
                out.set(packed.subarray(src + 4, src + 8), dst);
                break;
              case "el3":
                out.set(packed.subarray(src + 8, src + 12), dst);
                break;
              case "pend1":
                out.set(packed.subarray(src + 12, src + 16), dst);
                break;
              case "pend2":
                out.set(packed.subarray(src + 16, src + 20), dst);
                break;
              case "pend3":
                out.set(packed.subarray(src + 20, src + 24), dst);
                break;
            }
        }
        attrs[key] = new THREE.BufferAttribute(out, spec.size).setUsage(THREE.DynamicDrawUsage ?? 35048);
    }
    return attrs;
}

export function repackPendulum(catalog, indices, holders, attrs, count) {
    for (const key of [ "pend1", "pend2", "pend3" ]) attrs[key].array.fill(0);
    for (let k = 0; k < count; k++) {
        const j = indices[k];
        const h = holders ? holders[j] : null;
        if (!h || !h.state) continue;
        const s = h.state;
        const kind = s.libration ? KIND.tadpole : s.type === "horseshoe" ? KIND.horseshoe : KIND.free;
        attrs.el3.array[k * 4 + 2] = kind;
        attrs.pend1.array[k * 4 + 0] = s.modulus;
        attrs.pend1.array[k * 4 + 1] = s.halfX0;
        attrs.pend1.array[k * 4 + 2] = s.rateX;
        attrs.pend1.array[k * 4 + 3] = s.libration ? s.k : s.omega0 || 0;
        attrs.pend2.array[k * 4 + 0] = s.center;
        attrs.pend2.array[k * 4 + 1] = s.sigma0;
        attrs.pend2.array[k * 4 + 2] = s.peri0;
        attrs.pend2.array[k * 4 + 3] = s.lambdaJ0;
        attrs.pend3.array[k * 4 + 0] = s.libration ? 0 : s.sign || 1;
        attrs.pend3.array[k * 4 + 1] = s.nu;
        attrs.pend3.array[k * 4 + 2] = s.rates ? s.rates.periDot : 0;
    }
    for (const key of [ "el3", "pend1", "pend2", "pend3" ]) attrs[key].needsUpdate = true;
}

let _harmonicTexture = null;

export function harmonicTexture(THREE) {
    if (_harmonicTexture) return _harmonicTexture;
    const rows = AM_ROWS_OR_BUILD();
    const W = AM_HARMONICS, H = rows.length;
    const data = new Float32Array(W * H);
    for (let r = 0; r < H; r++) {
        const A = rows[r].A;
        for (let k = 0; k < W; k++) data[r * W + k] = A[k] || 0;
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat ?? THREE.LuminanceFormat, THREE.FloatType ?? THREE.UnsignedByteType);

    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    _harmonicTexture = tex;
    return tex;
}

export const PROPAGATION_HEAD = `\n    attribute vec4 aEl1;\n    attribute vec4 aEl2;\n    attribute vec4 aEl3;\n    attribute vec4 aPend1;\n    attribute vec4 aPend2;\n    attribute vec4 aPend3;\n    uniform float uDays;\n    uniform float uAU;\n    uniform float uResP;\n    uniform float uResQ;\n    uniform float uJupLambda;\n    uniform float uJupRate;\n    uniform sampler2D uHarm;\n    uniform vec2 uHarmSize;\n    const float PI_GLSL = 3.14159265358979323846;\n    const float TAU_GLSL = 6.28318530717958647692;\n    float wrapPi(float x) {\n        x = x - TAU_GLSL * floor(x / TAU_GLSL);\n        return x;\n    }\n    float wrapSignedPi(float x) {\n        x = mod(x + PI_GLSL, TAU_GLSL);\n        if (x < 0.0) x += TAU_GLSL;\n        return x - PI_GLSL;\n    }\n    float fromMeanMotionG(float n) {\n        float g2 = 0.00029591220828559110;\n        return pow(g2 / max(1e-30, n * n), 1.0 / 3.0);\n    }\n    float eccentricAnomalyG(float M, float e) {\n        float s = sin(M), c = cos(M);\n        float E = M + e * s * (1.0 + e * (c - 1.0) * (1.0 - e * e * 0.25));\n        for (int i = 0; i < 8; i++) {\n            float f = E - e * sin(E) - M;\n            float d = f / (1.0 - e * cos(E));\n            E -= d;\n            if (d * d < 1e-26) break;\n        }\n        return E;\n    }\n    vec3 positionFromElementsG(float a, float e, float incl, float node, float omega, float M) {\n        float E = eccentricAnomalyG(M, e);\n        float xk = a * (cos(E) - e);\n        float yk = a * sqrt(max(1e-12, 1.0 - e * e)) * sin(E);\n        float cw = cos(omega), sw = sin(omega);\n        float co = cos(node), so = sin(node);\n        float ci = cos(incl), si = sin(incl);\n        float x = (cw * co - sw * so * ci) * xk + (-sw * co - cw * so * ci) * yk;\n        float y = (cw * so + sw * co * ci) * xk + (-sw * so + cw * co * ci) * yk;\n        float z = sw * si * xk + cw * si * yk;\n        return vec3(x, y, z);\n    }\n    float texelA(int row, int k) {\n        vec2 uv = vec2((float(k) + 0.5) / uHarmSize.x, (float(row) + 0.5) / uHarmSize.y);\n        return texture2D(uHarm, uv).r;\n    }\n    float jacobiAmpG(float x, float m) {\n        float f = clamp(log(1.0 / max(1e-14, 1.0 - m)) / log(10.0) * (uHarmSize.y - 1.0) / 6.0,\n                        0.0, uHarmSize.y - 1.0);\n        int i = int(min(uHarmSize.y - 2.0, floor(f)));\n        float w = f - floor(f);\n        float frac = x - floor(x);\n        float cycles = floor(x);\n        float s0 = 0.0, s1 = 0.0;\n        for (int k = 0; k < 32; k++) {\n            float t = sin(TAU_GLSL * float(k + 1) * frac);\n            s0 += texelA(i,     k) * t;\n            s1 += texelA(i + 1, k) * t;\n        }\n        return PI_GLSL * frac + (1.0 - w) * s0 + w * s1 + PI_GLSL * cycles;\n    }\n    vec3 propagateSmallBodyG() {\n        float a     = aEl1.x;\n        float e     = aEl1.y;\n        float incl  = aEl1.z;\n        float node0 = aEl1.w;\n        float omega0   = aEl2.x;\n        float M0       = aEl2.y;\n        float nMean    = aEl2.z;\n        float nodeDot  = aEl2.w;\n        float omegaDot = aEl3.x;\n        float epoch    = aEl3.y;\n        float kind     = aEl3.z;\n        float dt = uDays - epoch;\n        float aOut, node, omega, M;\n        node = node0 + nodeDot * dt;\n        if (kind < 0.5) {\n            omega = omega0 + omegaDot * dt;\n            M = M0 + nMean * dt;\n            aOut = a;\n        } else {\n            float modulus  = aPend1.x;\n            float halfX0   = aPend1.y;\n            float rateX    = aPend1.z;\n            float kOrOmega = aPend1.w;\n            float center   = aPend2.x;\n            float sigma0   = aPend2.y;\n            float peri0    = aPend2.z;\n            float lambdaJ0 = aPend2.w;\n            float sign     = aPend3.x;\n            float nu       = aPend3.y;\n            float periDot  = aPend3.z;\n            float halfX = halfX0 + rateX * dt;\n            float psi = jacobiAmpG(halfX, modulus);\n            float sigmaRaw, sigmaDot;\n            if (kind < 1.5) {\n                float s = clamp(kOrOmega * sin(psi), -1.0, 1.0);\n                sigmaRaw = 2.0 * asin(s);\n                sigmaDot = 2.0 * nu * kOrOmega * cos(psi);\n            } else {\n                float sn = sin(psi);\n                sigmaRaw = 2.0 * sign * psi;\n                sigmaDot = 2.0 * kOrOmega * sqrt(max(0.0, 1.0 - modulus * sn * sn)) * sign;\n            }\n            float nRes = (uResP * (uJupRate - periDot) + sigmaDot) / uResQ;\n            aOut = fromMeanMotionG(clamp(nRes, 1e-8, 1.0));\n            float peri = peri0 + periDot * dt;\n            float dLamJ = uJupRate * dt\n                + wrapSignedPi(uJupLambda - wrapPi(lambdaJ0 + uJupRate * dt));\n            float lam = wrapPi(M0 + peri0\n                + (uResP * dLamJ\n                   - (uResP - uResQ) * (peri - peri0)\n                   + (sigmaRaw - sigma0)) / uResQ);\n            omega = peri - node;\n            M = wrapPi(lam - peri);\n        }\n        vec3 ecl = positionFromElementsG(aOut, e, incl, node, omega, M);\n        return vec3(ecl.x, ecl.z, -ecl.y) * uAU;\n    }\n`;

export function propagationUniforms(THREE, opts = {}) {
    return {
        uDays: {
            value: 0
        },
        uAU: {
            value: opts.au ?? 1200
        },
        uResP: {
            value: 1
        },
        uResQ: {
            value: 1
        },
        uJupLambda: {
            value: 0
        },
        uJupRate: {
            value: .0014507
        },
        uHarm: {
            value: harmonicTexture(THREE)
        },
        uHarmSize: {
            value: new THREE.Vector2(AM_HARMONICS, AM_ROWS_OR_BUILD().length)
        }
    };
}

export function setGroupResonance(uniforms, p, q) {
    uniforms.uResP.value = p;
    uniforms.uResQ.value = q;
}
