// Precomputed atmospheric scattering, ported from Bruneton & Neyret (2008) as
// in the classic generator pass set (transmittance, irradiance, in-scatter and
// their copy passes). BSD 3-clause, see the original paper.
// Tables: transmittance 256x64, irradiance 64x16, inscatter 256x2048 atlas.
// The atlas replaces the 3D textures the original uses, which WebGL2 lacks here.
// One full-screen pass per table: the slice comes from gl_FragCoord.y, not 32
// redraws, which removes the per-slice draw overhead and its clip rounding.
// The cache key is the physical parameter set, so equal atmospheres share tables.
// Baked tables (lut-binary.js) bypass generation entirely when a body has one.
const BRUNETON_RES_R = 32;
const BRUNETON_RES_MU = 64;
const BRUNETON_RES_MU_S = 32;
const BRUNETON_RES_NU = 8;
const BRUNETON_TRANS_W = 256;
const BRUNETON_TRANS_H = 64;
const BRUNETON_SKY_W = 64;
const BRUNETON_SKY_H = 16;

const BRUNETON_ATLAS_W = BRUNETON_RES_MU_S * BRUNETON_RES_NU;
const BRUNETON_ATLAS_H = BRUNETON_RES_MU * BRUNETON_RES_R;

// Version tag mixed into the cache key; bump when the generator changes so a
// stale baked table or a stale in-memory entry can never be reused.
const BRUNETON_VERSION = "r54";

const brunetonLutCache = new Map();

function brunetonOrders() {
    const o = parseInt(globalThis.__brunetonOrders, 10);
    return Number.isFinite(o) ? Math.max(1, Math.min(4, o)) : 4;
}

function brunetonSampleScale() {
    const s = Number(globalThis.__brunetonSampleScale);
    if (Number.isFinite(s) && s > 0) return Math.min(s, 1);
    // The scattering atlas is sampled on a fixed grid; a smaller scale means
    // fewer in-shader steps per texel, which is the cheapest way to cut the
    // startup burst on hardware that cannot take it.
    const tier = globalThis.__solisterGraphicsTier;
    if (tier === "low") return 0.5;
    if (tier === "medium") return 0.75;
    return 1;
}

// Everything below and on the GPU runs in ground radii: Rg = 1, Rt = Rt/Rg,
// H = H/Rg, beta = beta * Rg. The physics is invariant, fp32 is not: at radii in
// kilometres Rg^2 - r^2 cancels catastrophically and Uranus comes out black.
function brunetonNormalise(params) {
    const Rg = Math.max(params.Rg, 1e-6);
    const clampBeta = (arr) => {
        const maxC = Math.max(...arr, 1e-9);
        return arr.map(v => Math.max(v, maxC * 0.02, 1e-9));
    };
    const betaR = clampBeta(params.betaR);
    const betaMSca = clampBeta(params.betaMSca);
    const betaMEx = params.betaMEx.map((v, i) => Math.max(v, betaMSca[i]));
    return {
        Rg: Rg,
        Rt: Math.max(params.Rt, Rg * 1.0005),
        HR: Math.max(params.HR, Rg * 1e-6),
        HM: Math.max(params.HM, Rg * 1e-6),
        betaR: betaR,
        betaMSca: betaMSca,
        betaMEx: betaMEx,
        mieG: Math.max(-0.95, Math.min(0.95, params.mieG ?? 0))
    };
}

function brunetonSignature(params) {
    const n = brunetonNormalise(params);
    const t = (v) => Number(v).toPrecision(9);
    return [
        BRUNETON_VERSION,
        t(n.Rt / n.Rg), t(n.HR / n.Rg), t(n.HM / n.Rg),
        ...n.betaR.map(v => t(v * n.Rg)),
        ...n.betaMSca.map(v => t(v * n.Rg)),
        ...n.betaMEx.map(v => t(v * n.Rg)),
        t(n.mieG)
    ].join(",");
}

// Per-slice geometry, identical in the generator shaders and the baker below.
//   r      : sqrt(Rg^2 + (t*H)^2), t = layer/(RES_R-1) - the exact inverse of
//            the uR = rho/H lookup used by the runtime sampler.
// dhdH   : (dminTop, dmaxTop, dminGround, dmaxGround), Bruneton's (dmin, dmax, dminp, dmaxp) for that radius.
function brunetonLayerGeometry(Rg, Rt, layer) {
    const H = Math.sqrt(Math.max(Rt * Rt - Rg * Rg, 1e-12));
    const t = layer / (BRUNETON_RES_R - 1);
    const rho = t * H;
    const r = Math.sqrt(rho * rho + Rg * Rg);
    const dHorizon = Math.sqrt(Math.max(r * r - Rg * Rg, 0));
    return {
        r: r,
        dhdH: [
            Math.max(Rt - r, 0),
            dHorizon + H,
            Math.max(r - Rg, 0),
            dHorizon
        ]
    };
}

const BRUNETON_VERT_FULL = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Shared generator core. The 4D table is a 2D
// atlas; sliceRadius/layerDhdH reproduce setupInscatter() from the reference.
const BRUNETON_COMMON = `
uniform float uRg;
uniform float uRt;
uniform float uHR;
uniform float uHM;
uniform vec3 uBetaR;
uniform vec3 uBetaMSca;
uniform vec3 uBetaMEx;
uniform float uMieG;
varying vec2 vUv;

#define BR_PI 3.141592653589793
#define RES_R ${BRUNETON_RES_R}.0
#define RES_MU ${BRUNETON_RES_MU}.0
#define RES_MU_S ${BRUNETON_RES_MU_S}.0
#define RES_NU ${BRUNETON_RES_NU}.0

float sliceRadius(float layer) {
    float H = sqrt(max(uRt * uRt - uRg * uRg, 1e-12));
    float t = clamp(layer, 0.0, RES_R - 1.0) / (RES_R - 1.0);
    return sqrt(uRg * uRg + t * t * H * H);
}

vec4 sliceDhdH(float layer) {
    float H = sqrt(max(uRt * uRt - uRg * uRg, 1e-12));
    float r = sliceRadius(layer);
    float dHorizon = sqrt(max(r * r - uRg * uRg, 0.0));
    return vec4(max(uRt - r, 0.0), dHorizon + H, max(r - uRg, 0.0), dHorizon);
}

// Fragment coordinate in slice space -> (mu, muS, nu) for that radius.
void getMuMuSNu(vec2 fc, float r, vec4 dhdH, out float mu, out float muS, out float nu) {
    float x = fc.x - 0.5;
    float y = fc.y - 0.5;
    if (y < RES_MU / 2.0) {
        float d = 1.0 - y / (RES_MU / 2.0 - 1.0);
        d = min(max(dhdH.z, d * dhdH.w), dhdH.w * 0.999);
        d = max(d, 1e-4);
        mu = (uRg * uRg - r * r - d * d) / (2.0 * r * d);
        mu = min(mu, -sqrt(max(1.0 - (uRg / r) * (uRg / r), 0.0)) - 0.001);
    } else {
        float d = (y - RES_MU / 2.0) / (RES_MU / 2.0 - 1.0);
        d = min(max(dhdH.x, d * dhdH.y), dhdH.y * 0.999);
        d = max(d, 1e-4);
        mu = (uRt * uRt - r * r - d * d) / (2.0 * r * d);
    }
    muS = mod(x, RES_MU_S) / (RES_MU_S - 1.0);
    muS = tan((2.0 * muS - 1.0 + 0.26) * 1.1) / tan(1.26 * 1.1);
    nu = -1.0 + floor(x / RES_MU_S) / (RES_NU - 1.0) * 2.0;
}

vec2 getTransmittanceUV(float r, float mu) {
    float uR = sqrt(clamp((r - uRg) / max(uRt - uRg, 1e-9), 0.0, 1.0));
    float uMu = atan((mu + 0.15) / 1.15 * tan(1.5)) / 1.5;
    return vec2(clamp(uMu, 0.0, 1.0), uR);
}

vec2 getIrradianceUV(float r, float muS) {
    return vec2(clamp((muS + 0.2) / 1.2, 0.0, 1.0),
                clamp((r - uRg) / max(uRt - uRg, 1e-9), 0.0, 1.0));
}

vec3 lutTransmittance(sampler2D table, float r, float mu) {
    return texture(table, getTransmittanceUV(clamp(r, uRg, uRt), clamp(mu, -1.0, 1.0))).rgb;
}

// Bruneton's ratio form; assumes the segment never crosses the ground.
vec3 lutTransmittanceBetween(sampler2D table, float r, float mu, float r1, float mu1) {
    vec3 a, b;
    if (mu > 0.0) {
        a = lutTransmittance(table, r, mu);
        b = lutTransmittance(table, r1, mu1);
    } else {
        a = lutTransmittance(table, r1, -mu1);
        b = lutTransmittance(table, r, -mu);
    }
    return min(a / max(b, vec3(1e-6)), vec3(1.0));
}

vec3 lutTransmittanceDist(sampler2D table, float r, float mu, float d) {
    float r1 = sqrt(max(r * r + d * d + 2.0 * r * mu * d, 0.0));
    float mu1 = (r * mu + d) / max(r1, 1e-6);
    return lutTransmittanceBetween(table, r, mu, r1, mu1);
}

// Nearest intersection with the ground or the top boundary.
float limit(float r, float mu) {
    float dout = -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + uRt * uRt, 0.0));
    float delta2 = r * r * (mu * mu - 1.0) + uRg * uRg;
    if (delta2 >= 0.0) {
        float din = -r * mu - sqrt(delta2);
        if (din >= 0.0) dout = min(dout, din);
    }
    return max(dout, 0.0);
}

float phaseFunctionR(float mu) {
    return (3.0 / (16.0 * BR_PI)) * (1.0 + mu * mu);
}

float phaseFunctionM(float mu) {
    float g = uMieG;
    return 1.5 / (4.0 * BR_PI) * (1.0 - g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-6), -1.5)
        * (1.0 + mu * mu) / (2.0 + g * g);
}

// Approximate full Mie spectrum from the packed (rayleigh.rgb, mie.r) texel.
vec3 mieFromPacked(vec4 rayMie) {
    return rayMie.rgb * rayMie.w / max(rayMie.r, 1e-4) * (uBetaR.r / max(uBetaR, vec3(1e-6)));
}

// texture4D against the 2D atlas: nu interpolated manually, as in the
// reference), hardware filtering covers mu/muS inside a slice.
vec4 texture4DAtlas(sampler2D table, float r, float mu, float muS, float nu) {
    float H = sqrt(max(uRt * uRt - uRg * uRg, 1e-12));
    float rho = sqrt(max(r * r - uRg * uRg, 0.0));
    float rmu = r * mu;
    float delta = rmu * rmu - r * r + uRg * uRg;
    vec4 cst = (rmu < 0.0 && delta > 0.0)
        ? vec4(1.0, 0.0, 0.0, 0.5 - 0.5 / RES_MU)
        : vec4(-1.0, H * H, H, 0.5 + 0.5 / RES_MU);
    float uR = 0.5 / RES_R + rho / H * (1.0 - 1.0 / RES_R);
    float denom = rho + cst.z;
    float uMu = cst.w + (denom > 0.0 ? (rmu * cst.x + sqrt(max(delta + cst.y, 0.0))) / denom : 0.0)
        * (0.5 - 1.0 / RES_MU);
    float uMuS = 0.5 / RES_MU_S
        + (atan(max(muS, -0.1975) * tan(1.26 * 1.1)) / 1.1 + (1.0 - 0.26)) * 0.5
        * (1.0 - 1.0 / RES_MU_S);
    uMuS = clamp(uMuS, 0.5 / RES_MU_S, 1.0 - 0.5 / RES_MU_S);
    float lerpNu = (clamp(nu, -1.0, 1.0) + 1.0) / 2.0 * (RES_NU - 1.0);
    float uNu = floor(lerpNu);
    float fNu = lerpNu - uNu;
    float sliceF = clamp(uR, 0.0, 1.0) * RES_R - 0.5;
    float s0 = clamp(floor(sliceF), 0.0, RES_R - 2.0);
    float fR = clamp(sliceF - s0, 0.0, 1.0);
    vec2 uv00 = vec2((uNu + uMuS) / RES_NU, (s0 + uMu) / RES_R);
    vec2 uv10 = vec2((uNu + 1.0 + uMuS) / RES_NU, (s0 + uMu) / RES_R);
    vec2 uv01 = vec2((uNu + uMuS) / RES_NU, (s0 + 1.0 + uMu) / RES_R);
    vec2 uv11 = vec2((uNu + 1.0 + uMuS) / RES_NU, (s0 + 1.0 + uMu) / RES_R);
    vec4 lo = texture(table, uv00) * (1.0 - fNu) + texture(table, uv10) * fNu;
    vec4 hi = texture(table, uv01) * (1.0 - fNu) + texture(table, uv11) * fNu;
    return lo * (1.0 - fR) + hi * fR;
}

// Atlas fragment -> slice index / in-slice row.
void atlasSlice(out float layer, out float localY) {
    layer = clamp(floor(gl_FragCoord.y / RES_MU), 0.0, RES_R - 1.0);
    localY = gl_FragCoord.y - layer * RES_MU;
}
`;

const BRUNETON_FRAG_TRANSMITTANCE = BRUNETON_COMMON + `
void main() {
    vec2 fc = vUv * vec2(${BRUNETON_TRANS_W}.0, ${BRUNETON_TRANS_H}.0);
    float rFrac = fc.y / ${BRUNETON_TRANS_H}.0;
    float muFrac = fc.x / ${BRUNETON_TRANS_W}.0;
    float r = uRg + (rFrac * rFrac) * (uRt - uRg);
    float mu = -0.15 + tan(1.5 * muFrac) / tan(1.5) * (1.0 + 0.15);
    float dx = limit(r, mu) / float(TRANS_SAMPLES);
    float odR = 0.0;
    float odM = 0.0;
    float densRi = exp(-(r - uRg) / uHR);
    float densMi = exp(-(r - uRg) / uHM);
    for (int i = 1; i <= TRANS_SAMPLES; ++i) {
        float xj = float(i) * dx;
        float rij = max(sqrt(max(r * r + xj * xj + 2.0 * r * mu * xj, 0.0)), uRg);
        float densRj = exp(-(rij - uRg) / uHR);
        float densMj = exp(-(rij - uRg) / uHM);
        odR += (densRi + densRj) * 0.5 * dx;
        odM += (densMi + densMj) * 0.5 * dx;
        densRi = densRj;
        densMi = densMj;
    }
    gl_FragColor = vec4(exp(-(uBetaR * odR + uBetaMEx * odM)), 1.0);
}`;

const BRUNETON_FRAG_IRRADIANCE1 = BRUNETON_COMMON + `
uniform sampler2D uTransmittance;
void main() {
    vec2 fc = vUv * vec2(${BRUNETON_SKY_W}.0, ${BRUNETON_SKY_H}.0);
    float r = uRg + (fc.y - 0.5) / (${BRUNETON_SKY_H}.0 - 1.0) * (uRt - uRg);
    float muS = -0.2 + (fc.x - 0.5) / (${BRUNETON_SKY_W}.0 - 1.0) * (1.0 + 0.2);
    gl_FragColor = vec4(lutTransmittance(uTransmittance, r, muS) * max(muS, 0.0), 1.0);
}`;

const BRUNETON_FRAG_INSCATTER1 = BRUNETON_COMMON + `
uniform sampler2D uTransmittance;
uniform float uMieOut;

void integrand(float r, float mu, float muS, float nu, float t, out vec3 ray, out vec3 mie) {
    ray = vec3(0.0);
    mie = vec3(0.0);
    float ri = sqrt(max(r * r + t * t + 2.0 * r * mu * t, 0.0));
    float muSi = (nu * t + muS * r) / max(ri, 1e-6);
    ri = max(uRg, ri);
    if (muSi >= -sqrt(max(1.0 - uRg * uRg / (ri * ri), 0.0))) {
        vec3 ti = lutTransmittanceDist(uTransmittance, r, mu, t)
                * lutTransmittance(uTransmittance, ri, muSi);
        ray = exp(-(ri - uRg) / uHR) * ti;
        mie = exp(-(ri - uRg) / uHM) * ti;
    }
}

void main() {
    float layer, localY;
    atlasSlice(layer, localY);
    float layerR = sliceRadius(layer);
    float mu, muS, nu;
    getMuMuSNu(vec2(gl_FragCoord.x, localY), layerR, sliceDhdH(layer), mu, muS, nu);
    vec3 ray = vec3(0.0);
    vec3 mie = vec3(0.0);
    float dx = limit(layerR, mu) / float(INSCATTER_SAMPLES);
    vec3 rayi, miei;
    integrand(layerR, mu, muS, nu, 0.0, rayi, miei);
    for (int i = 1; i <= INSCATTER_SAMPLES; ++i) {
        float xj = float(i) * dx;
        vec3 rayj, miej;
        integrand(layerR, mu, muS, nu, xj, rayj, miej);
        ray += (rayi + rayj) * 0.5 * dx;
        mie += (miei + miej) * 0.5 * dx;
        rayi = rayj;
        miei = miej;
    }
    ray *= uBetaR;
    mie *= uBetaMSca;
    // Stored WITHOUT the phase function (cf. "Angular precision").
    gl_FragColor = vec4(uMieOut > 0.5 ? mie : ray, 1.0);
}`;

const BRUNETON_FRAG_COPY_INSCATTER1 = BRUNETON_COMMON + `
uniform sampler2D uDeltaSR;
uniform sampler2D uDeltaSM;
void main() {
    ivec2 ic = ivec2(gl_FragCoord.xy);
    vec4 ray = texelFetch(uDeltaSR, ic, 0);
    vec4 mie = texelFetch(uDeltaSM, ic, 0);
    gl_FragColor = vec4(ray.rgb, mie.r);
}`;

const BRUNETON_FRAG_INSCATTER_S = BRUNETON_COMMON + `
uniform sampler2D uTransmittance;
uniform sampler2D uDeltaE;
uniform sampler2D uDeltaSR;
uniform sampler2D uDeltaSM;
uniform float uFirst;

void main() {
    float layer, localY;
    atlasSlice(layer, localY);
    float layerR = sliceRadius(layer);
    float mu, muS, nu;
    getMuMuSNu(vec2(gl_FragCoord.x, localY), layerR, sliceDhdH(layer), mu, muS, nu);

    float r = clamp(layerR, uRg, uRt);
    mu = clamp(mu, -1.0, 1.0);
    muS = clamp(muS, -1.0, 1.0);
    float var = sqrt(max(1.0 - mu * mu, 0.0)) * sqrt(max(1.0 - muS * muS, 0.0));
    nu = clamp(nu, muS * mu - var, muS * mu + var);
    float cthetamin = -sqrt(max(1.0 - (uRg / r) * (uRg / r), 0.0));
    vec3 v = vec3(sqrt(max(1.0 - mu * mu, 0.0)), 0.0, mu);
    float sx = (v.x == 0.0) ? 0.0 : (nu - muS * mu) / v.x;
    vec3 s = vec3(sx, sqrt(max(0.0, 1.0 - sx * sx - muS * muS)), muS);

    vec3 raymie = vec3(0.0);
    float dphi = BR_PI / float(SPHERE_SAMPLES);
    float dtheta = BR_PI / float(SPHERE_SAMPLES);
    for (int itheta = 0; itheta < SPHERE_SAMPLES; ++itheta) {
        float theta = (float(itheta) + 0.5) * dtheta;
        float ctheta = cos(theta);
        float greflectance = 0.0;
        float dground = 0.0;
        vec3 gtransp = vec3(0.0);
        if (ctheta < cthetamin) {
            greflectance = 0.1 / BR_PI;
            dground = -r * ctheta - sqrt(max(r * r * (ctheta * ctheta - 1.0) + uRg * uRg, 0.0));
            gtransp = lutTransmittanceDist(uTransmittance, uRg, -(r * ctheta + dground) / uRg, dground);
        }
        for (int iphi = 0; iphi < 2 * SPHERE_SAMPLES; ++iphi) {
            float phi = (float(iphi) + 0.5) * dphi;
            float dw = dtheta * dphi * sin(theta);
            vec3 w = vec3(cos(phi) * sin(theta), sin(phi) * sin(theta), ctheta);
            float nu1 = dot(s, w);
            float nu2 = dot(v, w);
            float pr2 = phaseFunctionR(nu2);
            float pm2 = phaseFunctionM(nu2);
            vec3 gnormal = (vec3(0.0, 0.0, r) + dground * w) / uRg;
            vec3 girradiance = texture(uDeltaE, getIrradianceUV(uRg, dot(gnormal, s))).rgb;
            vec3 raymie1 = greflectance * girradiance * gtransp;
            if (uFirst > 0.5) {
                float pr1 = phaseFunctionR(nu1);
                float pm1 = phaseFunctionM(nu1);
                vec3 ray1 = texture4DAtlas(uDeltaSR, r, w.z, muS, nu1).rgb;
                vec3 mie1 = texture4DAtlas(uDeltaSM, r, w.z, muS, nu1).rgb;
                raymie1 += ray1 * pr1 + mie1 * pm1;
            } else {
                raymie1 += texture4DAtlas(uDeltaSR, r, w.z, muS, nu1).rgb;
            }
            raymie += raymie1 * (uBetaR * exp(-(r - uRg) / uHR) * pr2
                               + uBetaMSca * exp(-(r - uRg) / uHM) * pm2) * dw;
        }
    }
    gl_FragColor = vec4(raymie, 1.0);
}`;

const BRUNETON_FRAG_IRRADIANCE_N = BRUNETON_COMMON + `
uniform sampler2D uDeltaSR;
uniform sampler2D uDeltaSM;
uniform float uFirst;
void main() {
    vec2 fc = vUv * vec2(${BRUNETON_SKY_W}.0, ${BRUNETON_SKY_H}.0);
    float r = uRg + (fc.y - 0.5) / (${BRUNETON_SKY_H}.0 - 1.0) * (uRt - uRg);
    float muS = -0.2 + (fc.x - 0.5) / (${BRUNETON_SKY_W}.0 - 1.0) * (1.0 + 0.2);
    vec3 s = vec3(sqrt(max(1.0 - muS * muS, 0.0)), 0.0, muS);
    vec3 result = vec3(0.0);
    float dphi = BR_PI / float(IRRAD_SAMPLES);
    float dtheta = BR_PI / float(IRRAD_SAMPLES);
    for (int iphi = 0; iphi < 2 * IRRAD_SAMPLES; ++iphi) {
        float phi = (float(iphi) + 0.5) * dphi;
        for (int itheta = 0; itheta < IRRAD_SAMPLES / 2; ++itheta) {
            float theta = (float(itheta) + 0.5) * dtheta;
            float dw = dtheta * dphi * sin(theta);
            vec3 w = vec3(cos(phi) * sin(theta), sin(phi) * sin(theta), cos(theta));
            float nu = dot(s, w);
            if (uFirst > 0.5) {
                float pr1 = phaseFunctionR(nu);
                float pm1 = phaseFunctionM(nu);
                vec3 ray1 = texture4DAtlas(uDeltaSR, r, w.z, muS, nu).rgb;
                vec3 mie1 = texture4DAtlas(uDeltaSM, r, w.z, muS, nu).rgb;
                result += max(ray1 * pr1 + mie1 * pm1, vec3(0.0)) * w.z * dw;
            } else {
                result += max(texture4DAtlas(uDeltaSR, r, w.z, muS, nu).rgb, vec3(0.0)) * w.z * dw;
            }
        }
    }
    gl_FragColor = vec4(result, 1.0);
}`;

const BRUNETON_FRAG_INSCATTER_N = BRUNETON_COMMON + `
uniform sampler2D uTransmittance;
uniform sampler2D uDeltaJ;

vec3 integrand(float r, float mu, float muS, float nu, float t) {
    float ri = sqrt(max(r * r + t * t + 2.0 * r * mu * t, 0.0));
    float mui = (r * mu + t) / max(ri, 1e-6);
    float muSi = (nu * t + muS * r) / max(ri, 1e-6);
    return texture4DAtlas(uDeltaJ, ri, mui, muSi, nu).rgb * lutTransmittanceDist(uTransmittance, r, mu, t);
}

void main() {
    float layer, localY;
    atlasSlice(layer, localY);
    float layerR = sliceRadius(layer);
    float mu, muS, nu;
    getMuMuSNu(vec2(gl_FragCoord.x, localY), layerR, sliceDhdH(layer), mu, muS, nu);
    vec3 raymie = vec3(0.0);
    float dx = limit(layerR, mu) / float(INSCATTER_SAMPLES);
    vec3 ii = integrand(layerR, mu, muS, nu, 0.0);
    for (int i = 1; i <= INSCATTER_SAMPLES; ++i) {
        float xj = float(i) * dx;
        vec3 ij = integrand(layerR, mu, muS, nu, xj);
        raymie += (ii + ij) * 0.5 * dx;
        ii = ij;
    }
    gl_FragColor = vec4(raymie, 1.0);
}`;

const BRUNETON_FRAG_COPY_IRRADIANCE = BRUNETON_COMMON + `
uniform sampler2D uDeltaE;
uniform sampler2D uPrev;
uniform float uHasPrev;
uniform float uK;
void main() {
    vec4 prev = uHasPrev > 0.5 ? texture(uPrev, vUv) : vec4(0.0);
    gl_FragColor = vec4(uK * texture(uDeltaE, vUv).rgb + prev.rgb, max(prev.a, 1.0));
}`;

const BRUNETON_FRAG_COPY_INSCATTER_N = BRUNETON_COMMON + `
uniform sampler2D uDeltaS;
uniform sampler2D uPrev;
uniform float uHasPrev;
void main() {
    float layer, localY;
    atlasSlice(layer, localY);
    float mu, muS, nu;
    getMuMuSNu(vec2(gl_FragCoord.x, localY), sliceRadius(layer), sliceDhdH(layer), mu, muS, nu);
    ivec2 ic = ivec2(gl_FragCoord.xy);
    vec4 deltaS = texelFetch(uDeltaS, ic, 0);
    // Back to phase-free storage, as in the copy pass. alpha must stay 0: the
    // atlas alpha is the first-order Mie term and the orders are summed, so
    // writing 1 here piled +1 per order onto Mie, a grey wash over every sky
    // and disc.
    vec3 add = deltaS.rgb / max(phaseFunctionR(nu), 1e-3);
    // The built-up orders carry the first order's alpha through untouched: the
    // atlas alpha IS the first-order Mie term. Blending with the source alpha at
    // zero used to leave it alone; a plain write has to copy it, or the Mie
    // channel is wiped for every body as soon as a second order runs.
    float prevAlpha = 0.0;
    if (uHasPrev > 0.5) {
        vec4 prev = texelFetch(uPrev, ic, 0);
        add += prev.rgb;
        prevAlpha = prev.a;
    }
    gl_FragColor = vec4(add, prevAlpha);
}`;

function brunetonMakeTarget(THREE, width, height, type) {
    const target = new THREE.WebGLRenderTarget(width, height, {
        type: type || THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false
    });
    target.texture.generateMipmaps = false;
    return target;
}

// params: { Rg, Rt, HR, HM, betaR[3], betaMSca[3], betaMEx[3], mieG }
// All lengths in km, extinction coefficients per km.
// opts:  { orders, sampleScale, tables } where `tables` may contain baked
//        transmittance/irradiance/inscatter Float32Arrays (see lut-binary.js).
function buildBrunetonLuts(THREE, renderer, cacheKey, params, opts = {}) {
    if (!renderer?.capabilities?.isWebGL2 || !params) return null;
    if (typeof renderer.extensions?.get === "function"
        && !renderer.extensions.get("EXT_color_buffer_float")) return null;

    const norm = brunetonNormalise(params);
    const signature = brunetonSignature(params);
    const orders = Math.max(1, Math.min(4, opts.orders ?? brunetonOrders()));
    const scale = Math.max(0.05, Math.min(1, opts.sampleScale ?? brunetonSampleScale()));
    const key = "bruneton|" + signature + "|o" + orders + "|s" + scale;
    if (brunetonLutCache.has(key)) return brunetonLutCache.get(key);

    // No renderable float target, no tables. Without EXT_color_buffer_float the
    // framebuffer is incomplete and every draw into it is INVALID_OPERATION; the
    // stream of GL errors is what ends a context, and three reports it as every
    // program failing to validate with an empty log. Returning null here makes
    // the shell fall back to the analytic transmittance path instead.
    const floatRenderable = !!(renderer.extensions?.get?.("EXT_color_buffer_float")
        || renderer.extensions?.get?.("WEBGL_color_buffer_float"));
    if (!floatRenderable) return null;

    // Float targets are required for the ground difference (eye minus
    // surface); half float speckles around the terminator.  Linear filtering
    // of float textures is optional, so fall back to half float when the
    // extension is missing - the runtime sampler is identical.
    const floatLinear = typeof renderer.extensions?.get === "function"
        && !!renderer.extensions.get("OES_texture_float_linear");
    const tableType = floatLinear ? THREE.FloatType : THREE.HalfFloatType;

    const result = {
        transmittance: null,
        irradiance: null,
        inscatter: null,
        targets: [],
        params: {
            Rg: norm.Rg,
            Rt: norm.Rt,
            betaR: new THREE.Vector3(...norm.betaR),
            mieG: norm.mieG
        },
        signature: signature,
        baked: false,
        buildMs: 0,
        dispose() {
            for (const target of this.targets) target.dispose();
            this.targets.length = 0;
            brunetonLutCache.delete(key);
        }
    };

    // ---- baked tables -----------------------------------------------------
    const baked = opts.tables;
    if (baked && baked.transmittance && baked.irradiance && baked.inscatter) {
        const tex = (data, w, h) => {
            const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
            t.minFilter = THREE.LinearFilter;
            t.magFilter = THREE.LinearFilter;
            t.wrapS = THREE.ClampToEdgeWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
            t.generateMipmaps = false;
            t.needsUpdate = true;
            return t;
        };
        result.transmittance = tex(baked.transmittance, BRUNETON_TRANS_W, BRUNETON_TRANS_H);
        result.irradiance = tex(baked.irradiance, BRUNETON_SKY_W, BRUNETON_SKY_H);
        result.inscatter = tex(baked.inscatter, BRUNETON_ATLAS_W, BRUNETON_ATLAS_H);
        // DataTextures have no render target to dispose, but the runtime treats `targets` uniformly.
        result.baked = true;
        brunetonLutCache.set(key, result);
        return result;
    }

    // ---- GPU generation ---------------------------------------------------
    const started = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const defines = {
        TRANS_SAMPLES: Math.max(40, Math.round(500 * scale)),
        INSCATTER_SAMPLES: Math.max(8, Math.round(50 * scale)),
        SPHERE_SAMPLES: Math.max(4, Math.round(16 * scale)),
        IRRAD_SAMPLES: Math.max(8, Math.round(32 * scale))
    };
    const baseUniforms = () => ({
        uRg: { value: norm.Rg / norm.Rg },
        uRt: { value: norm.Rt / norm.Rg },
        uHR: { value: norm.HR / norm.Rg },
        uHM: { value: norm.HM / norm.Rg },
        uBetaR: { value: new THREE.Vector3(...norm.betaR).multiplyScalar(norm.Rg) },
        uBetaMSca: { value: new THREE.Vector3(...norm.betaMSca).multiplyScalar(norm.Rg) },
        uBetaMEx: { value: new THREE.Vector3(...norm.betaMEx).multiplyScalar(norm.Rg) },
        uMieG: { value: norm.mieG }
    });
    // Orders are summed by reading the previous table back in the shader, not by
    // blending into a float target. Additive blending into RGBA32F needs
    // EXT_float_blend, which is not present on every driver: where it is missing
    // each accumulation draw is INVALID_OPERATION, the error stream kills the
    // context, and three reports every program as failing to validate with an
    // empty info log. Read-add-write costs one extra tiny pass per order and
    // depends on nothing.
    // Loop counts are baked into the shader text rather than passed as
    // material defines: three's program cache does not key on define values,
    // so a second build with different counts would reuse the first program.
    const injectCounts = (src) => src
        .replaceAll("TRANS_SAMPLES", String(defines.TRANS_SAMPLES))
        .replaceAll("INSCATTER_SAMPLES", String(defines.INSCATTER_SAMPLES))
        .replaceAll("SPHERE_SAMPLES", String(defines.SPHERE_SAMPLES))
        .replaceAll("IRRAD_SAMPLES", String(defines.IRRAD_SAMPLES));
    const makeMat = (frag, extraUniforms = {}, opts2 = {}) => new THREE.ShaderMaterial({
        uniforms: { ...baseUniforms(), ...extraUniforms },
        vertexShader: BRUNETON_VERT_FULL,
        fragmentShader: injectCounts(frag),
        depthTest: false,
        depthWrite: false,
        ...opts2
    });

    const transmittance = brunetonMakeTarget(THREE, BRUNETON_TRANS_W, BRUNETON_TRANS_H, tableType);
    const irradiance = brunetonMakeTarget(THREE, BRUNETON_SKY_W, BRUNETON_SKY_H, tableType);
    const deltaE = brunetonMakeTarget(THREE, BRUNETON_SKY_W, BRUNETON_SKY_H, tableType);
    const inscatter = brunetonMakeTarget(THREE, BRUNETON_ATLAS_W, BRUNETON_ATLAS_H, tableType);
    const deltaSR = brunetonMakeTarget(THREE, BRUNETON_ATLAS_W, BRUNETON_ATLAS_H, tableType);
    const deltaSM = brunetonMakeTarget(THREE, BRUNETON_ATLAS_W, BRUNETON_ATLAS_H, tableType);
    const deltaJ = brunetonMakeTarget(THREE, BRUNETON_ATLAS_W, BRUNETON_ATLAS_H, tableType);
    const deltaS = brunetonMakeTarget(THREE, BRUNETON_ATLAS_W, BRUNETON_ATLAS_H, tableType);
    const irradianceAlt = brunetonMakeTarget(THREE, BRUNETON_SKY_W, BRUNETON_SKY_H, tableType);
    const inscatterAlt = brunetonMakeTarget(THREE, BRUNETON_ATLAS_W, BRUNETON_ATLAS_H, tableType);

    const mats = {
        transmittance: makeMat(BRUNETON_FRAG_TRANSMITTANCE),
        irradiance1: makeMat(BRUNETON_FRAG_IRRADIANCE1, { uTransmittance: { value: null } }),
        inscatter1: makeMat(BRUNETON_FRAG_INSCATTER1, { uTransmittance: { value: null }, uMieOut: { value: 0 } }),
        copyInscatter1: makeMat(BRUNETON_FRAG_COPY_INSCATTER1, { uDeltaSR: { value: null }, uDeltaSM: { value: null } }),
        inscatterS: makeMat(BRUNETON_FRAG_INSCATTER_S, {
            uTransmittance: { value: null }, uDeltaE: { value: null },
            uDeltaSR: { value: null }, uDeltaSM: { value: null }, uFirst: { value: 1 }
        }),
        irradianceN: makeMat(BRUNETON_FRAG_IRRADIANCE_N, {
            uDeltaSR: { value: null }, uDeltaSM: { value: null }, uFirst: { value: 1 }
        }),
        inscatterN: makeMat(BRUNETON_FRAG_INSCATTER_N, { uTransmittance: { value: null }, uDeltaJ: { value: null } }),
        copyIrradiance: makeMat(BRUNETON_FRAG_COPY_IRRADIANCE, { uDeltaE: { value: null }, uPrev: { value: null }, uHasPrev: { value: 0 }, uK: { value: 1 } }),
        copyInscatterN: makeMat(BRUNETON_FRAG_COPY_INSCATTER_N, { uDeltaS: { value: null }, uPrev: { value: null }, uHasPrev: { value: 0 } })
    };

    const quadScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mats.transmittance);
    quad.frustumCulled = false;
    quadScene.add(quad);
    const dummyCamera = new THREE.Camera();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    // Any GL error left from a driver that quietly refuses one of these passes
    // would otherwise sit in the error queue and surface later as a program that
    // fails to link with an empty log, and then as a lost context. Drain before,
    // check after, and hand the caller a null table (analytic fallback) instead
    // of poisoning the context.
    const gl = renderer.getContext();
    while (gl.getError() !== 0) { /* clear stale errors */ }
    // Ping-pong heads live outside the pass block: the finished tables are read
    // after the finally.
    let irradianceHead = irradiance, irradianceSpare = irradianceAlt;
    let inscatterHead = inscatter, inscatterSpare = inscatterAlt;
    try {
        const renderPass = (mat, target, clear = true) => {
            quad.material = mat;
            renderer.setRenderTarget(target);
            if (clear) renderer.clear(true, false, false);
            renderer.render(quadScene, dummyCamera);
        };
        renderPass(mats.transmittance, transmittance);
        mats.irradiance1.uniforms.uTransmittance.value = transmittance.texture;
        renderPass(mats.irradiance1, deltaE);
        mats.inscatter1.uniforms.uTransmittance.value = transmittance.texture;
        mats.inscatter1.uniforms.uMieOut.value = 0;
        renderPass(mats.inscatter1, deltaSR);
        mats.inscatter1.uniforms.uMieOut.value = 1;
        renderPass(mats.inscatter1, deltaSM);
        mats.copyInscatter1.uniforms.uDeltaSR.value = deltaSR.texture;
        mats.copyInscatter1.uniforms.uDeltaSM.value = deltaSM.texture;
        renderPass(mats.copyInscatter1, inscatter);
        mats.copyIrradiance.uniforms.uDeltaE.value = deltaE.texture;
        mats.copyIrradiance.uniforms.uK.value = 1;
        renderPass(mats.copyIrradiance, irradiance);
        // Reading back the table it is adding to: the pair swaps roles each order
        // so the pass never reads and writes one texture.
        const accumulateIrradiance = () => {
            mats.copyIrradiance.uniforms.uPrev.value = irradianceHead.texture;
            mats.copyIrradiance.uniforms.uHasPrev.value = 1;
            renderPass(mats.copyIrradiance, irradianceSpare);
            mats.copyIrradiance.uniforms.uHasPrev.value = 0;
            const spent = irradianceHead;
            irradianceHead = irradianceSpare;
            irradianceSpare = spent;
        };
        const accumulateInscatter = () => {
            mats.copyInscatterN.uniforms.uPrev.value = inscatterHead.texture;
            mats.copyInscatterN.uniforms.uHasPrev.value = 1;
            renderPass(mats.copyInscatterN, inscatterSpare);
            mats.copyInscatterN.uniforms.uHasPrev.value = 0;
            const spent = inscatterHead;
            inscatterHead = inscatterSpare;
            inscatterSpare = spent;
        };
        for (let order = 2; order <= orders; order++) {
            const first = order === 2;
            mats.inscatterS.uniforms.uTransmittance.value = transmittance.texture;
            mats.inscatterS.uniforms.uDeltaE.value = deltaE.texture;
            mats.inscatterS.uniforms.uDeltaSR.value = first ? deltaSR.texture : deltaS.texture;
            mats.inscatterS.uniforms.uDeltaSM.value = deltaSM.texture;
            mats.inscatterS.uniforms.uFirst.value = first ? 1 : 0;
            renderPass(mats.inscatterS, deltaJ);
            mats.irradianceN.uniforms.uDeltaSR.value = first ? deltaSR.texture : deltaS.texture;
            mats.irradianceN.uniforms.uDeltaSM.value = deltaSM.texture;
            mats.irradianceN.uniforms.uFirst.value = first ? 1 : 0;
            renderPass(mats.irradianceN, deltaE);
            mats.inscatterN.uniforms.uTransmittance.value = transmittance.texture;
            mats.inscatterN.uniforms.uDeltaJ.value = deltaJ.texture;
            renderPass(mats.inscatterN, deltaS);
            mats.copyIrradiance.uniforms.uK.value = 1;
            accumulateIrradiance();
            mats.copyInscatterN.uniforms.uDeltaS.value = deltaS.texture;
            accumulateInscatter();
        }
    } finally {
        renderer.autoClear = prevAutoClear;
        renderer.setRenderTarget(null);
        Object.values(mats).forEach(m => m.dispose());
        quad.geometry.dispose();
        deltaSR.dispose();
        deltaSM.dispose();
        deltaJ.dispose();
        deltaS.dispose();
        deltaE.dispose();
    }

    const firstGlError = gl.getError();
    if (firstGlError !== 0) {
        if (typeof console !== "undefined" && console.warn) {
            console.warn("[Solister] scattering tables rejected by the driver (GL error " + firstGlError + "); using the analytic transmittance fallback.");
        }
        [transmittance, irradiance, irradianceAlt, inscatter, inscatterAlt].forEach(target => target.dispose());
        return null;
    }
    result.transmittance = transmittance.texture;
    result.irradiance = irradianceHead.texture;
    result.inscatter = inscatterHead.texture;
    result.targets = [transmittance, irradiance, irradianceAlt, inscatter, inscatterAlt];
    result.buildMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
    brunetonLutCache.set(key, result);
    return result;
}

// Read a table back from the GPU as RGBA float32 (verification / baking).
function brunetonReadTable(renderer, target) {
    const w = target.width;
    const h = target.height;
    const buffer = new Float32Array(w * h * 4);
    // Render target types may be half float; readback via float is not
    // possible there, so callers that need exact values must force FloatType (the baker in tools/atmo does).
    renderer.readRenderTargetPixels(target, 0, 0, w, h, buffer);
    return buffer;
}

function brunetonClearCache() {
    for (const entry of brunetonLutCache.values()) entry.dispose?.();
    brunetonLutCache.clear();
}

globalThis.buildBrunetonLuts = buildBrunetonLuts;
globalThis.BRUNETON_COMMON = BRUNETON_COMMON;
globalThis.BRUNETON_VERT_FULL = BRUNETON_VERT_FULL;
globalThis.brunetonReadTable = brunetonReadTable;
globalThis.brunetonClearCache = brunetonClearCache;
globalThis.BRUNETON_LAYOUT = Object.freeze({
    RES_R: BRUNETON_RES_R,
    RES_MU: BRUNETON_RES_MU,
    RES_MU_S: BRUNETON_RES_MU_S,
    RES_NU: BRUNETON_RES_NU,
    TRANS_W: BRUNETON_TRANS_W,
    TRANS_H: BRUNETON_TRANS_H,
    SKY_W: BRUNETON_SKY_W,
    SKY_H: BRUNETON_SKY_H,
    ATLAS_W: BRUNETON_ATLAS_W,
    ATLAS_H: BRUNETON_ATLAS_H,
    VERSION: BRUNETON_VERSION
});
globalThis.brunetonLayerGeometry = brunetonLayerGeometry;
globalThis.brunetonSignature = brunetonSignature;
globalThis.brunetonNormalise = brunetonNormalise;
