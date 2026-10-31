

function floatToHalf(value) {
    const f32 = _floatView;
    const u32 = _intView;
    f32[0] = value;
    const f = u32[0];
    const sign = (f >>> 16) & 0x8000;
    const exponent = (f >>> 23) & 0xff;
    const mantissa = f & 0x7fffff;

    if (exponent === 0xff) return sign | 0x7c00;
    if (exponent === 0 && mantissa === 0) return sign;

    const e = exponent - 127;
    if (e > 15) return sign | 0x7c00;
    if (e < -24) return sign;

    if (e < -14) {

        const scaled = Math.abs(value) / Math.pow(2, -24);
        return sign | (Math.round(scaled) & 0x3ff);
    }

    const rounded = (mantissa + 0x1000) >>> 13;
    return sign | (((e + 15) << 10) + rounded);
}

const _floatView = new Float32Array(1);
const _intView = new Uint32Array(_floatView.buffer);
const ONE_HALF = 0x3c00;

const ENCODED_MAX_MIN = 4;
const ENCODED_MAX_MAX = 20;

const USEFUL_TAU_CLAMP = 9;

const TRANSMITTANCE_TABLE_WIDTH = 128;
const TRANSMITTANCE_TABLE_HEIGHT = 64;

const TRANSMITTANCE_TABLE_STEPS = 48;

function transmittanceTableX(cosChi, width) {
    const clamped = Math.max(-1, Math.min(1, cosChi));
    return (1 - clamped) * 0.5;
}

function transmittanceTableY(heightFraction, height) {
    const clamped = Math.max(0, Math.min(1, heightFraction));
    return clamped;
}

function opticalDepthAlongRay(cosChi, height, terms, topRadius) {
    const r0 = 1 + Math.max(0, height);
    const rTop = Math.max(topRadius, r0 + 1e-6);

    const bHalf = r0 * cosChi;
    const disc = bHalf * bHalf - r0 * r0 + rTop * rTop;
    if (disc <= 0) return [0, 0, 0];
    const length = -bHalf + Math.sqrt(disc);
    if (!(length > 0)) return [0, 0, 0];

    const steps = TRANSMITTANCE_TABLE_STEPS;
    const stepLength = length / steps;
    const tau = [0, 0, 0];

    const safe = [];
    for (const term of terms) {
        const scaleHeight = Math.max(Number.isFinite(term.scaleHeight) ? term.scaleHeight : 1e-9, 1e-9);
        const beta = [0, 1, 2].map(ch => Number.isFinite(term.beta[ch]) ? Math.max(0, term.beta[ch]) : 0);
        if (beta[0] + beta[1] + beta[2] <= 0) continue;
        safe.push({ beta: beta, inverseHeight: 1 / scaleHeight });
    }
    if (!safe.length) return tau;

    for (let i = 0; i < steps; i++) {

        const t = (i + 0.5) * stepLength;
        const r = Math.sqrt(Math.max(r0 * r0 + 2 * r0 * cosChi * t + t * t, 0));
        const altitude = r - 1;
        if (altitude < 0) break;
        let any = false;
        for (const term of safe) {
            const density = Math.exp(-altitude * term.inverseHeight);
            if (density < 1e-7) continue;
            any = true;
            for (let ch = 0; ch < 3; ch++) tau[ch] += term.beta[ch] * density * stepLength;
        }
        if (!any) break;
    }
    return tau;
}

function buildTransmittanceTable(profile, bodyRadiusKm = 6371, width = TRANSMITTANCE_TABLE_WIDTH, height = TRANSMITTANCE_TABLE_HEIGHT) {
    if (!profile || !profile.derived) return null;

    const derived = profile.derived;
    const topKm = Number.isFinite(derived.renderTopKm) ? derived.renderTopKm : derived.topKm;

    const groundRadiusKm = Number.isFinite(derived.groundRadiusKm)
        ? derived.groundRadiusKm
        : (Number.isFinite(bodyRadiusKm) && bodyRadiusKm > 0 ? bodyRadiusKm : 6371);
    if (!(topKm > 0) || !(groundRadiusKm > 0)) return null;

    const rayleighScaleHeightKm = Math.max(derived.rayleighScaleHeightKm || 8, 0.001);
    const mieScaleHeightKm = Math.max(derived.mieScaleHeightKm || rayleighScaleHeightKm, 0.001);
    const rayleighScaleHeight = rayleighScaleHeightKm / groundRadiusKm;
    const mieScaleHeight = mieScaleHeightKm / groundRadiusKm;
    const topRadius = 1 + topKm / groundRadiusKm;

    const rayleighPerRadius = groundRadiusKm / rayleighScaleHeightKm;
    const miePerRadius = groundRadiusKm / mieScaleHeightKm;
    const mieExt = derived.tauMExt && Number.isFinite(derived.tauMExt.r)
        ? derived.tauMExt
        : { r: derived.tauM || 0, g: derived.tauM || 0, b: derived.tauM || 0 };
    const methane = derived.methaneTau || null;

    const terms = [
        {
            beta: [
                ((derived.tauR?.r || 0) + (methane ? methane.r || 0 : 0)) * rayleighPerRadius,
                ((derived.tauR?.g || 0) + (methane ? methane.g || 0 : 0)) * rayleighPerRadius,
                ((derived.tauR?.b || 0) + (methane ? methane.b || 0 : 0)) * rayleighPerRadius
            ],
            scaleHeight: rayleighScaleHeight
        },
        {
            beta: [
                (mieExt.r || 0) * miePerRadius,
                (mieExt.g || 0) * miePerRadius,
                (mieExt.b || 0) * miePerRadius
            ],
            scaleHeight: mieScaleHeight
        }
    ];

    const total = terms.reduce((sum, term) => sum + term.beta[0] + term.beta[1] + term.beta[2], 0);
    if (!(total > 1e-9)) return null;

    const data = new Float32Array(width * height * 3);

    for (let y = 0; y < height; y++) {

        const heightFraction = (y + 0.5) / height;
        for (let x = 0; x < width; x++) {
            const cosChi = 1 - 2 * (x + 0.5) / width;
            const tau = opticalDepthAlongRay(
                cosChi, heightFraction * (topRadius - 1), terms, topRadius
            );
            const o = (y * width + x) * 3;
            data[o] = tau[0];
            data[o + 1] = tau[1];
            data[o + 2] = tau[2];
        }
    }

    let peak = 0;
    for (let i = 0; i < data.length; i++) if (data[i] > peak) peak = data[i];

    let usefulPeak = 0;
    for (let i = 0; i < data.length; i++) {
        const v = Math.min(data[i], USEFUL_TAU_CLAMP);
        if (v > usefulPeak) usefulPeak = v;
    }
    const encodedMax = Math.max(
        ENCODED_MAX_MIN,
        Math.min(ENCODED_MAX_MAX, usefulPeak > 0 ? Math.log2(1 + usefulPeak) * 1.02 : ENCODED_MAX_MIN)
    );

    const encoded = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
        for (let ch = 0; ch < 3; ch++) {
            encoded[i * 3 + ch] = Math.log2(1 + Math.max(0, data[i * 3 + ch]));
        }
    }

    const half = new Uint16Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        for (let ch = 0; ch < 3; ch++) half[i * 4 + ch] = floatToHalf(encoded[i * 3 + ch]);
        half[i * 4 + 3] = ONE_HALF;
    }

    const packed = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        for (let ch = 0; ch < 3; ch++) {
            packed[i * 4 + ch] = Math.round(Math.min(1, encoded[i * 3 + ch] / encodedMax) * 255);
        }
        packed[i * 4 + 3] = 255;
    }

    return {
        data: data,
        packed: packed,
        half: half,
        encodedMax: encodedMax,
        peakTau: peak,
        usefulPeakTau: usefulPeak,
        width: width,
        height: height,
        sampleCoeff: {
            x: 0.5,
            y: 1,
            topRadius: topRadius,
            scaleHeight: rayleighScaleHeight
        }
    };
}

// Multiple-scatter ambient table, after the Bruneton irradiance precompute.
// Per (sun zenith cosine, height) it stores the spherically averaged sunlight
// transmittance: rgb weighted by the Rayleigh phase, alpha the plain directional
// average for the near-isotropic Mie source. Built once per body, it gives the
// shader a real higher-order term instead of a constant lift.
const MS_TABLE_WIDTH = 64;
const MS_TABLE_HEIGHT = 32;
const MS_ENCODE_SCALE = 1.5;

function buildMultipleScatterTable(profile, bodyRadiusKm = 6371) {
    if (!profile || !profile.derived) return null;
    const derived = profile.derived;
    const topKm = Number.isFinite(derived.renderTopKm) ? derived.renderTopKm : derived.topKm;
    const groundRadiusKm = Number.isFinite(derived.groundRadiusKm)
        ? derived.groundRadiusKm
        : (Number.isFinite(bodyRadiusKm) && bodyRadiusKm > 0 ? bodyRadiusKm : 6371);
    if (!(topKm > 0) || !(groundRadiusKm > 0)) return null;
    const rayleighScaleHeightKm = Math.max(derived.rayleighScaleHeightKm || 8, 0.001);
    const mieScaleHeightKm = Math.max(derived.mieScaleHeightKm || rayleighScaleHeightKm, 0.001);
    const rayleighScaleHeight = rayleighScaleHeightKm / groundRadiusKm;
    const mieScaleHeight = mieScaleHeightKm / groundRadiusKm;
    const topRadius = 1 + topKm / groundRadiusKm;
    const rayleighPerRadius = groundRadiusKm / rayleighScaleHeightKm;
    const miePerRadius = groundRadiusKm / mieScaleHeightKm;
    const mieExt = derived.tauMExt && Number.isFinite(derived.tauMExt.r)
        ? derived.tauMExt
        : { r: derived.tauM || 0, g: derived.tauM || 0, b: derived.tauM || 0 };
    const methane = derived.methaneTau || null;
    const terms = [
        {
            beta: [
                ((derived.tauR?.r || 0) + (methane ? methane.r || 0 : 0)) * rayleighPerRadius,
                ((derived.tauR?.g || 0) + (methane ? methane.g || 0 : 0)) * rayleighPerRadius,
                ((derived.tauR?.b || 0) + (methane ? methane.b || 0 : 0)) * rayleighPerRadius
            ],
            scaleHeight: rayleighScaleHeight
        },
        {
            beta: [
                (mieExt.r || 0) * miePerRadius,
                (mieExt.g || 0) * miePerRadius,
                (mieExt.b || 0) * miePerRadius
            ],
            scaleHeight: mieScaleHeight
        }
    ];
    const total = terms.reduce((sum, term) => sum + term.beta[0] + term.beta[1] + term.beta[2], 0);
    if (!(total > 1e-9)) return null;

    const width = MS_TABLE_WIDTH, height = MS_TABLE_HEIGHT;
    const data = new Float32Array(width * height * 4);
    const zenithBands = 4, azimuthSteps = 8;
    const dirWeight = 1 / (zenithBands * azimuthSteps);
    for (let y = 0; y < height; y++) {
        const heightFraction = (y + 0.5) / height;
        const r0 = 1 + heightFraction * (topRadius - 1);
        for (let x = 0; x < width; x++) {
            const muS = 1 - 2 * (x + 0.5) / width;
            const sunDir = [ Math.sqrt(Math.max(0, 1 - muS * muS)), muS, 0 ];
            const jr = [ 0, 0, 0 ];
            let jm = 0;
            for (let iz = 0; iz < zenithBands; iz++) {
                const cosT = -1 + (iz + 0.5) * (2 / zenithBands);
                const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
                for (let ia = 0; ia < azimuthSteps; ia++) {
                    const phi = (ia + 0.5) / azimuthSteps * Math.PI * 2;
                    const dir = [ sinT * Math.cos(phi), cosT, sinT * Math.sin(phi) ];
                    // Rays that intersect the body contribute no light.
                    const b = r0 * cosT;
                    const disc = b * b - (r0 * r0 - 1);
                    if (disc > 0 && -b - Math.sqrt(disc) > 0) continue;
                    const tau = opticalDepthAlongRay(cosT, r0 - 1, terms, topRadius);
                    const cosGamma = dir[0] * sunDir[0] + dir[1] * sunDir[1] + dir[2] * sunDir[2];
                    const phaseR = 0.75 * (1 + cosGamma * cosGamma);
                    let lum = 0;
                    for (let ch = 0; ch < 3; ch++) {
                        const t = Math.exp(-Math.min(Math.max(tau[ch], 0), 20));
                        jr[ch] += t * phaseR * dirWeight;
                        lum += t / 3;
                    }
                    jm += lum * dirWeight;
                }
            }
            // Couple the ambient to the sunlight that actually reaches this air:
            // transmittance toward the sun one Rayleigh scale height up, so the term
            // dies through the terminator (no night glow) but keeps a twilight tail.
            const tauSun = opticalDepthAlongRay(muS, Math.min(r0 - 1 + rayleighScaleHeight, topRadius - 1), terms, topRadius);
            // The transmittance table deliberately leaves body-blocking to
            // the shader's terminator gate; apply the same gate here so the
            // ambient term is zero on the night side and tails off through
            // twilight exactly like the direct term.
            const gateT = Math.min(1, Math.max(0, (muS + 0.12) / 0.34));
            const gate = gateT * gateT * (3 - 2 * gateT);
            let lumSun = 0;
            for (let ch = 0; ch < 3; ch++) {
                const tSun = Math.exp(-Math.min(Math.max(tauSun[ch], 0), 20)) * gate;
                jr[ch] *= tSun;
                lumSun += tSun / 3;
            }
            jm *= lumSun;
            const o = (y * width + x) * 4;
            data[o] = jr[0];
            data[o + 1] = jr[1];
            data[o + 2] = jr[2];
            data[o + 3] = jm;
        }
    }
    const half = new Uint16Array(width * height * 4);
    for (let i = 0; i < width * height * 4; i++) half[i] = floatToHalf(data[i]);
    const packed = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height * 4; i++) {
        packed[i] = Math.round(Math.min(1, Math.max(0, data[i]) / MS_ENCODE_SCALE) * 255);
    }
    return {
        data: data,
        half: half,
        packed: packed,
        width: width,
        height: height,
        encodeScale: MS_ENCODE_SCALE
    };
}

const _msTableCache = new Map;

function getMultipleScatterTable(key, profile, bodyRadiusKm = 6371) {
    const cacheKey = key + ":" + bodyRadiusKm;
    const cached = _msTableCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const built = buildMultipleScatterTable(profile, bodyRadiusKm);
    _msTableCache.set(cacheKey, built);
    return built;
}

const _tableCache = new Map;

function getTransmittanceTable(key, profile, bodyRadiusKm = 6371) {
    const cacheKey = key + ":" + bodyRadiusKm;
    const cached = _tableCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const built = buildTransmittanceTable(profile, bodyRadiusKm);
    _tableCache.set(cacheKey, built);
    return built;
}

function clearTransmittanceTables() {
    _tableCache.clear();
}

globalThis.TRANSMITTANCE_TABLE_WIDTH = TRANSMITTANCE_TABLE_WIDTH;
globalThis.TRANSMITTANCE_ENCODED_MAX_MIN = ENCODED_MAX_MIN;
globalThis.TRANSMITTANCE_TABLE_HEIGHT = TRANSMITTANCE_TABLE_HEIGHT;
globalThis.buildTransmittanceTable = buildTransmittanceTable;
globalThis.getTransmittanceTable = getTransmittanceTable;
globalThis.buildMultipleScatterTable = buildMultipleScatterTable;
globalThis.getMultipleScatterTable = getMultipleScatterTable;
globalThis.clearTransmittanceTables = clearTransmittanceTables;
globalThis.transmittanceTableX = transmittanceTableX;
globalThis.transmittanceTableY = transmittanceTableY;
globalThis.opticalDepthAlongRay = opticalDepthAlongRay;
