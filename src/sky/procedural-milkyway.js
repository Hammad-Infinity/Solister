import { galacticFrame } from "./sky-frame.js";

// Milky Way for the sky dome, built to an all-sky photograph.
//
// The old model integrated a four-disc galaxy along the view ray. That gives a
// smooth exponential fall with latitude, which is not what the sky looks like:
// this band is a wide glow with a flat-topped ridge about eight degrees across,
// a shoulder that still holds a third of the peak at thirty degrees, and a hard
// dark lane cut through the middle. No sum of exponentials produces that shape,
// so the vertical profile is now measured and written down directly.
//
// Everything here is evaluated in galactic (l, b) degrees. Noise is taken on a
// circle in longitude, so the field wraps without a seam at the anticentre.
//
// Fitted against the ESO panorama: latitude profile to 0.02, colour ratio r/b to
// 0.02, clipped-band brightness spread p5/p50/p95 = .30/.57/.83.

const D2R = Math.PI / 180;

// One place for every number. The shader and the JavaScript below are generated
// from this object, so the band and the star catalog cannot drift apart.
export const BAND = {
    // Light: two Gaussians make the flat-topped ridge and its shoulder, an
    // exponent 1.4 knee carries the middle, and a long tail fades into the pole.
    ridgeShift: 3.4,
    env: [ [ .554, 10.375 ], [ .441, 34.375 ] ],
    knee: [ .077, 30, 1.4 ],
    tail: [ .026, 21.667 ],
    gain: .5138,
    // Galactic-centre brightening.
    centre: [ 0.2833, 52, 0.07 ],
    bulge: [ .55, 11, [ 1, .74, .52 ] ],
    // Dust lane: depth, width, wander, raggedness, north and south weights.
    lane: [ .30, 1.90, 1.1, .55, 1.05, 1.02 ],
    // Filaments: cell size in degrees along and across the plane, octaves.
    filament: [ 3.2, 1.6, 5, 0.58, 0.26, 6 ],
    // Star clouds.
    cloud: [ 26, 10, .05, 10 ],
    // Broad, faint brightness structure: the photograph's high latitudes are
    // not flat, they carry slow variations of the diffuse light itself.
    veil: [ .080, 42, 34, 70, [ .82, .96, 1.15 ] ],
    // Fine mottling of unresolved starlight: the milky speckle of the disc.
    grain: [ .55, .05, 30 ],
    // Dust blobs: big irregular black patches, on top of the fine filaments.
    blob: [ 0.34, 0.1, 7.5, 9 ],
    // Cirrus: faint dust far from the plane, which keeps the high latitudes
    // structured instead of dying to a flat wash.
    cirrus: [ 0.2143, 34, 26, 60 ],
    // Warp of the dust field.
    warp: [ 2.6, 40, 18 ],
    // Colour: warm near the plane and the centre, cool in the halo.
    warmTint: [ 1.30, 1.06, 1.00 ],
    coolTint: [ .58, .80, 1.00 ],
    warm: [ 14, 0.6193, 46 ],
    // Sky pedestal of the photograph: faint diffuse light under everything.
    pedestal: [ .078, .102, .125 ],
    // Mean transmittance the dust divides out, so it changes texture, not level.
    meanT: [ [ .46, 2.6 ], [ .12, 7 ], [ .05, 9, 1.5 ] ],
    // Rift: the plane is dimmer than its own shoulders. The normalisation above
    // divides the mean extinction out, so without this the band has texture but
    // no lane at b = 0. Depth, width in degrees, patchiness along the plane.
    rift: [ 0.4297, 1.4277, 0.05 ]
};

// Angular frequency of a cell size in degrees: cells around the circle are
// 2*pi*K, so K = 360 / (2*pi*cellDeg); in latitude one radian is 1/K cells.
const kLong = cellDeg => 360 / (2 * Math.PI * cellDeg);
const kLat = cellDeg => 180 / (Math.PI * cellDeg);

const F = BAND;
const N = {
    warpL: kLong(F.warp[1]).toFixed(5), warpB: kLat(F.warp[2]).toFixed(5),
    filL: kLong(F.filament[0]).toFixed(5), filB: kLat(F.filament[1]).toFixed(5),
    cloudL: kLong(F.cloud[0]).toFixed(5), cloudB: kLat(F.cloud[1]).toFixed(5),
    // Lane wander runs on its own scale: about 12 degrees along, very broad across.
    wanderL: kLong(11.8).toFixed(5), wanderB: kLat(60).toFixed(5),
    raggedL: kLong(5.1).toFixed(5), raggedB: kLat(30).toFixed(5),
    grainL: kLong(F.grain[0]).toFixed(5), grainB: kLat(F.grain[0]).toFixed(5),
    blobL: kLong(F.blob[3]).toFixed(5), blobB: kLat(F.blob[3] * 0.62).toFixed(5),
    cirrusL: kLong(F.cirrus[2]).toFixed(5), cirrusB: kLat(F.cirrus[3]).toFixed(5),
    veilL: kLong(F.veil[2]).toFixed(5), veilB: kLat(F.veil[3]).toFixed(5),
    riftL: kLong(14).toFixed(5), riftB: kLat(9).toFixed(5)
};

const num = v => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const vec = v => `vec3(${v.map(num).join(", ")})`;

export const MILKYWAY_GLSL = `
uniform mat3 uToGalactic;
uniform float uRhoZero;
uniform float uDust;

// One hash, reused by every noise field. Cheap on purpose: it runs per pixel.
float cellHash(vec3 p) {
    p = fract(p * vec3(0.3183099, 0.3678794, 0.4142136) + vec3(0.11, 0.37, 0.73));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = p - i;
    f = f * f * (3.0 - 2.0 * f);
    float x00 = mix(cellHash(i), cellHash(i + vec3(1.0, 0.0, 0.0)), f.x);
    float x10 = mix(cellHash(i + vec3(0.0, 1.0, 0.0)), cellHash(i + vec3(1.0, 1.0, 0.0)), f.x);
    float x01 = mix(cellHash(i + vec3(0.0, 0.0, 1.0)), cellHash(i + vec3(1.0, 0.0, 1.0)), f.x);
    float x11 = mix(cellHash(i + vec3(0.0, 1.0, 1.0)), cellHash(i + vec3(1.0, 1.0, 1.0)), f.x);
    return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z) * 2.0 - 1.0;
}

// Noise on the sky itself: longitude enters as a point on a circle, so the field
// is continuous across l = +-180 and never shows a seam at the anticentre.
float skyNoise(float kl, float kb, float lr, float br) {
    return valueNoise(vec3(kl * cos(lr), kl * sin(lr), kb * br));
}

float ridged(float n) {
    return 1.0 - abs(n);
}

// Vertical profile of the light, degrees in, relative brightness out.
float bandEnvelope(float b) {
    float x = b - ${num(F.ridgeShift)};
    float ax = abs(x);
    float g1 = ${num(F.env[0][0])} * exp(-pow(x / ${num(F.env[0][1])}, 2.0));
    float g2 = ${num(F.env[1][0])} * exp(-pow(x / ${num(F.env[1][1])}, 2.0));
    float knee = ${num(F.knee[0])} * exp(-pow(ax / ${num(F.knee[1])}, ${num(F.knee[2])}));
    float tail = ${num(F.tail[0])} * exp(-ax / ${num(F.tail[1])});
    return g1 + g2 + knee + tail;
}

float bandLongitude(float l) {
    return 1.0 + ${num(F.centre[0])} * exp(-pow(l / ${num(F.centre[1])}, 2.0))
         + ${num(F.centre[2])} * cos(l * ${(Math.PI / 360).toFixed(8)});
}

// Average dust along a latitude line. Dividing by it keeps the fitted envelope
// exact: the dust decides where the light is cut, never how bright the band is.
float meanTransmittance(float b) {
    float ab = abs(b);
    return 1.0 - ${num(F.meanT[0][0])} * exp(-pow(b / ${num(F.meanT[0][1])}, 2.0))
               - ${num(F.meanT[1][0])} * exp(-pow(b / ${num(F.meanT[1][1])}, 2.0))
               - ${num(F.meanT[2][0])} * exp(-pow(ab / ${num(F.meanT[2][1])}, ${num(F.meanT[2][2])}));
}

// Dust: one meandering lane on the plane plus ridged filaments that branch away
// from it. Returns the fraction of light that gets through.
float bandTransmittance(float l, float b, float lr, float br) {
    float wu = skyNoise(${N.warpL}, ${N.warpB}, lr, br);
    float wv = skyNoise(${N.warpL} * 2.3, ${N.warpB} * 2.1, lr, br + 2.7);
    float lu = l + (wu * ${num(F.warp[0] * 6)} + wv * ${num(F.warp[0] * 2)});
    float lb = b + (wu * ${num(F.warp[0] * 1.2)} + wv * ${num(F.warp[0] * 0.5)});
    float wander = ${num(F.lane[2])} * skyNoise(${N.wanderL}, ${N.wanderB}, lr, br + 1.3) * 2.0;
    float ragged = 1.0 - ${num(F.lane[3])} * skyNoise(${N.raggedL}, ${N.raggedB}, lr, br + 4.1) * 2.0;
    float side = b < 0.0 ? ${num(F.lane[5])} : ${num(F.lane[4])};
    float lane = ${num(F.lane[0])} * side * ragged * exp(-pow((b - wander) / ${num(F.lane[1])}, 2.0));
    float filament = 0.0, amplitude = 1.0;
    float fl = lu * ${(1 / 57.2958).toFixed(6)}, fb = lb * ${(1 / 57.2958).toFixed(6)};
    for (int i = 0; i < ${F.filament[2]}; i++) {
        float k = pow(2.0, float(i));
        float n = ridged(skyNoise(${N.filL} * k, ${N.filB} * k, fl * 57.2958, fb * 57.2958));
        filament += amplitude * pow(max(0.0, n - 0.25) / 0.75, 1.5);
        amplitude *= ${num(F.filament[3])};
    }
    float height = exp(-pow(b / ${num(F.filament[5])}, 2.0));
    // Big dust blobs ride on the lane; they are what gives the rift its chunks.
    float blobN = skyNoise(${N.blobL}, ${N.blobB}, lr, br + 6.1);
    float blob = ${num(F.blob[0])} * smoothstep(${num(F.blob[1])}, 1.0, blobN) * exp(-pow(b / ${num(F.blob[2])}, 2.0)) * uDust;
    float cirrus = smoothstep(0.25, 0.95, skyNoise(${N.cirrusL}, ${N.cirrusB}, lr, br + 8.3));
    float tau = (lane + ${num(F.filament[4])} * filament * height * side) * uDust + blob
              + ${num(F.cirrus[0])} * cirrus * exp(-pow(b / ${num(F.cirrus[1])}, 2.0)) * uDust;
    return max(0.02, 1.0 - min(0.96, tau));
}

// Bright mottling: rectified noise, so the band breaks into bright lumps the
// way unresolved star clouds do, instead of a smooth gradient.
float bandGrain(float lr, float br, float b) {
    float n = skyNoise(${N.grainL}, ${N.grainB}, lr, br);
    float m = skyNoise(${N.grainL} * 2.7, ${N.grainB} * 2.3, lr, br + 1.9);
    float k = max(0.0, n * 0.65 + m * 0.35);
    return ${num(F.grain[1])} * k * exp(-pow(b / ${num(F.grain[2])}, 2.0));
}

// Slow brightness variation over the whole sky, strongest away from the plane.
vec3 bandVeil(float lr, float br, float b) {
    float n = skyNoise(${N.veilL}, ${N.veilB}, lr, br);
    float m = skyNoise(${N.veilL} * 2.3, ${N.veilB} * 2.1, lr, br + 5.7);
    float v = ${num(F.veil[0])} * (n * 0.7 + m * 0.3 + 0.45) * smoothstep(12.0, ${num(F.veil[1])}, abs(b));
    return ${vec(F.veil[4])} * v;
}

float bandClouds(float lr, float br, float b) {
    float a = skyNoise(${N.cloudL}, ${N.cloudB}, lr, br);
    float c = skyNoise(${N.cloudL} * 2.2, ${N.cloudB} * 2.4, lr, br + 3.9);
    // The photograph's high latitudes are smooth: clouds live near the plane.
    return ${num(F.cloud[2])} * (a * 1.25 + c * 0.75) * 2.0 * exp(-pow(b / ${num(F.cloud[3])}, 2.0));
}

float bandWarm(float l, float b) {
    return exp(-pow(b / ${num(F.warm[0])}, 2.0))
         * (0.78 + ${num(F.warm[1])} * exp(-pow(l / ${num(F.warm[2])}, 2.0)));
}

// The whole sky, in display units: what the photograph shows, including its
// faint pedestal. milkyWayBand() below converts to the linear light the rest of
// the app expects.
vec3 milkyWayShoulder(vec3 d) {
    const float knee = 0.55;
    vec3 over = max(d - knee, vec3(0.0));
    return min(d, vec3(knee)) + (1.0 - knee) * (1.0 - exp(-over / (1.0 - knee)));
}

vec3 milkyWayTarget(vec3 dir) {
    vec3 g = uToGalactic * dir;
    float b = degrees(asin(clamp(g.z, -1.0, 1.0)));
    float l = degrees(atan(g.y, g.x));
    float lr = radians(l), br = radians(b);
    float ratio = min(1.35, bandTransmittance(l, b, lr, br) / meanTransmittance(b));
    float rift = 1.0 - ${num(F.rift[0])} * exp(-pow(b / ${num(F.rift[1])}, 2.0))
               * (1.0 - ${num(F.rift[2])} + ${num(F.rift[2])} * skyNoise(${N.riftL}, ${N.riftB}, lr, br));
    float light = ${num(F.gain)} * bandEnvelope(b) * bandLongitude(l) * ratio * rift
                * (1.0 + bandClouds(lr, br, b) + bandGrain(lr, br, b));
    float w = bandWarm(l, b);
    vec3 warm = ${vec(F.warmTint)} * w + ${vec(F.coolTint)} * (1.0 - w);
    // Compact warm core: the bulge, independent of the dust that hides it.
    float coreGlow = ${num(F.bulge[0])} * exp(-pow(l / ${num(F.bulge[1])}, 2.0)) * exp(-pow(b / ${num(F.bulge[1] * .62)}, 2.0));
    vec3 sky = ${vec(F.pedestal)} + light * warm * uRhoZero + bandVeil(lr, br, b) * uRhoZero
             + ${vec(F.bulge[2])} * coreGlow * uRhoZero;
    return milkyWayShoulder(sky);
}

// Display units to the linear scene, undoing the roll-off in the sky shader so
// the delivered pixels the fitted numbers describe.
vec3 milkyWayBand(vec3 worldDir) {
    vec3 d = clamp(milkyWayTarget(normalize(worldDir)), vec3(0.0), vec3(1.0));
    // Display values back to linear light; the sky material is not tone-mapped,
    // so the sRGB encode at the end of the shader returns these exactly.
    return pow(d, vec3(2.2));
}
`;

// --- JavaScript mirror -------------------------------------------------------
// Same numbers, same noise, same order of operations. The star catalog samples
// this so the stars and the band sit on one field.

const RHO_ZERO = 1;

function fract(x) {
    return x - Math.floor(x);
}

function cellHash(x, y, z) {
    const px = fract(x * .3183099 + .11) * 17;
    const py = fract(y * .3678794 + .37) * 17;
    const pz = fract(z * .4142136 + .73) * 17;
    return fract(px * py * pz * (px + py + pz));
}

export function valueNoise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    fz = fz * fz * (3 - 2 * fz);
    const mix = (a, b, t) => a + (b - a) * t;
    const x00 = mix(cellHash(ix, iy, iz), cellHash(ix + 1, iy, iz), fx);
    const x10 = mix(cellHash(ix, iy + 1, iz), cellHash(ix + 1, iy + 1, iz), fx);
    const x01 = mix(cellHash(ix, iy, iz + 1), cellHash(ix + 1, iy, iz + 1), fx);
    const x11 = mix(cellHash(ix, iy + 1, iz + 1), cellHash(ix + 1, iy + 1, iz + 1), fx);
    return mix(mix(x00, x10, fy), mix(x01, x11, fy), fz) * 2 - 1;
}

const skyNoise = (kl, kb, lr, br) => valueNoise(kl * Math.cos(lr), kl * Math.sin(lr), kb * br);

export function bandEnvelope(b) {
    const x = b - F.ridgeShift, ax = Math.abs(x);
    return F.env[0][0] * Math.exp(-Math.pow(x / F.env[0][1], 2))
         + F.env[1][0] * Math.exp(-Math.pow(x / F.env[1][1], 2))
         + F.knee[0] * Math.exp(-Math.pow(ax / F.knee[1], F.knee[2]))
         + F.tail[0] * Math.exp(-ax / F.tail[1]);
}

export function bandLongitude(l) {
    return 1 + F.centre[0] * Math.exp(-Math.pow(l / F.centre[1], 2)) + F.centre[2] * Math.cos(l * Math.PI / 360);
}

export function meanTransmittance(b) {
    const ab = Math.abs(b);
    return 1 - F.meanT[0][0] * Math.exp(-Math.pow(b / F.meanT[0][1], 2))
             - F.meanT[1][0] * Math.exp(-Math.pow(b / F.meanT[1][1], 2))
             - F.meanT[2][0] * Math.exp(-Math.pow(ab / F.meanT[2][1], F.meanT[2][2]));
}

export function bandTransmittance(l, b, dust = 1) {
    const lr = l * D2R, br = b * D2R;
    const wu = skyNoise(+N.warpL, +N.warpB, lr, br);
    const wv = skyNoise(N.warpL * 2.3, N.warpB * 2.1, lr, br + 2.7);
    const lu = l + (wu * F.warp[0] * 6 + wv * F.warp[0] * 2);
    const lb = b + (wu * F.warp[0] * 1.2 + wv * F.warp[0] * .5);
    const wander = F.lane[2] * skyNoise(+N.wanderL, +N.wanderB, lr, br + 1.3) * 2;
    const ragged = 1 - F.lane[3] * skyNoise(+N.raggedL, +N.raggedB, lr, br + 4.1) * 2;
    const side = b < 0 ? F.lane[5] : F.lane[4];
    const lane = F.lane[0] * side * ragged * Math.exp(-Math.pow((b - wander) / F.lane[1], 2));
    let filament = 0, amplitude = 1;
    const fl = lu / 57.2958 * 57.2958, fb = lb / 57.2958 * 57.2958;
    for (let i = 0; i < F.filament[2]; i++) {
        const k = Math.pow(2, i);
        const n = 1 - Math.abs(skyNoise(+N.filL * k, +N.filB * k, fl * D2R, fb * D2R));
        filament += amplitude * Math.pow(Math.max(0, n - .25) / .75, 1.5);
        amplitude *= F.filament[3];
    }
    const height = Math.exp(-Math.pow(b / F.filament[5], 2));
    const blobN = skyNoise(+N.blobL, +N.blobB, lr, br + 6.1);
    const ss = Math.min(1, Math.max(0, (blobN - F.blob[1]) / (1 - F.blob[1])));
    const blob = F.blob[0] * ss * ss * (3 - 2 * ss) * Math.exp(-Math.pow(b / F.blob[2], 2)) * dust;
    const cn = skyNoise(+N.cirrusL, +N.cirrusB, lr, br + 8.3);
    const cs = Math.min(1, Math.max(0, (cn - .25) / .7));
    const cirrus = cs * cs * (3 - 2 * cs);
    const tau = (lane + F.filament[4] * filament * height * side) * dust + blob
        + F.cirrus[0] * cirrus * Math.exp(-Math.pow(b / F.cirrus[1], 2)) * dust;
    return Math.max(.02, 1 - Math.min(.96, tau));
}

export function bandGrain(lr, br, b) {
    const n = skyNoise(+N.grainL, +N.grainB, lr, br);
    const m = skyNoise(N.grainL * 2.7, N.grainB * 2.3, lr, br + 1.9);
    return F.grain[1] * Math.max(0, n * .65 + m * .35) * Math.exp(-Math.pow(b / F.grain[2], 2));
}

export function bandVeil(lr, br, b, out = [ 0, 0, 0 ]) {
    const n = skyNoise(+N.veilL, +N.veilB, lr, br);
    const m = skyNoise(N.veilL * 2.3, N.veilB * 2.1, lr, br + 5.7);
    const ab = Math.abs(b);
    const t = Math.min(1, Math.max(0, (ab - 12) / (F.veil[1] - 12)));
    const v = F.veil[0] * (n * .7 + m * .3 + .45) * t * t * (3 - 2 * t);
    for (let i = 0; i < 3; i++) out[i] = F.veil[4][i] * v;
    return out;
}

export function bandClouds(lr, br, b) {
    const a = skyNoise(+N.cloudL, +N.cloudB, lr, br);
    const c = skyNoise(N.cloudL * 2.2, N.cloudB * 2.4, lr, br + 3.9);
    return F.cloud[2] * (a * 1.25 + c * .75) * 2 * Math.exp(-Math.pow(b / F.cloud[3], 2));
}

export function bandWarm(l, b) {
    return Math.exp(-Math.pow(b / F.warm[0], 2)) * (.78 + F.warm[1] * Math.exp(-Math.pow(l / F.warm[2], 2)));
}

// Display-space colour of the sky at a galactic direction, 0..1 per channel.
export function bandTargetColour(l, b, out = [ 0, 0, 0 ]) {
    const lr = l * D2R, br = b * D2R;
    // Dust may thin the band but never brighten it: the transmittance ratio is
    // capped, otherwise a clear stretch between clouds doubles the ridge.
    const ratio = Math.min(1.35, bandTransmittance(l, b) / meanTransmittance(b));
    const rift = 1 - F.rift[0] * Math.exp(-Math.pow(b / F.rift[1], 2))
               * (1 - F.rift[2] + F.rift[2] * skyNoise(+N.riftL, +N.riftB, lr, br));
    const light = F.gain * bandEnvelope(b) * bandLongitude(l) * ratio * rift * (1 + bandClouds(lr, br, b));
    const w = bandWarm(l, b);
    const veil = bandVeil(lr, br, b);
    const coreGlow = F.bulge[0] * Math.exp(-Math.pow(l / F.bulge[1], 2)) * Math.exp(-Math.pow(b / (F.bulge[1] * .62), 2));
    const knee = .55;
    for (let i = 0; i < 3; i++) {
        const d = F.pedestal[i] + light * (F.warmTint[i] * w + F.coolTint[i] * (1 - w)) * RHO_ZERO + veil[i]
                + F.bulge[2][i] * coreGlow * RHO_ZERO;
        out[i] = Math.min(d, knee) + (1 - knee) * (1 - Math.exp(-Math.max(d - knee, 0) / (1 - knee)));
    }
    return out;
}

// Scalar weight along a galactic direction, for anything that only needs a
// density: the star catalog uses it so its stars follow this band.
export function milkyWayDensityAlong(x, y, z) {
    const l = Math.atan2(y, x) / D2R;
    const b = Math.asin(Math.max(-1, Math.min(1, z))) / D2R;
    const c = bandTargetColour(l, b);
    return Math.max(0, (c[0] * .2126 + c[1] * .7152 + c[2] * .0722) - .09);
}

export function createMilkyWayUniforms(THREE) {
    return {
        uToGalactic: {
            value: galacticFrame(THREE)
        },
        uRhoZero: {
            value: RHO_ZERO
        },
        uDust: {
            value: 1
        }
    };
}
