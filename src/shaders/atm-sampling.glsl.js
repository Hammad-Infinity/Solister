// Sampling of the precomputed atmosphere tables.
//
// The tables are written by an offline generator and read here with exactly the
// mappings the generator wrote them with. Two mappings are in circulation for
// tables of this shape -- one used when they are written, one used by at least
// one runtime that reads them -- and they disagree. The tables themselves say
// which is right:
//
//   transmittance ground row, first lit column ................... 183
//   writer's map  atan((mu+0.15)*tan(1.5)/1.15)/1.5  predicts ..... 183.09
//   reading map   atan(mu*11.950355887 + 2.1510640597)*2/3 ....... 193.81
//
// The same disagreement exists for the in-scatter sun axis and for irradiance.
// Reading a table with a mapping other than the one it was written with shifts
// every sample by a few percent, which is invisible until it is measured.
//
// So: one mapping, the writer's. Whoever bakes the tables in future must
// use these same formulas, or the drift comes straight back.
//
// Deliberately absent: colour adjustment, density/sky-brightness/exposure knobs
// and layered fog. Those are presentation controls; exposure belongs to the
// renderer, and adjusting hue here would be a second, hidden colour pipeline.
//
// Coordinates: radii in kilometres, from the table header. All functions take
// light direction and geometry in planet-centred space.
const ATM_SAMPLING_GLSL = `
const int ATM_RES_R = 32;
const int ATM_RES_MU = 64;
const int ATM_RES_MU_S = 32;
const int ATM_RES_NU = 8;
const float ATM_PI = 3.14159265359;
// tan(1.26 * 1.1) is the constant the generator's muS map is built around.
const float ATM_TAN_K = 5.3496235;
const float ATM_TAN_15 = 14.1014199;

uniform sampler3D uAtmInscatter;
uniform sampler2D uAtmTransmittance;
uniform sampler2D uAtmIrradiance;
uniform vec4 uAtmRadii;   // (Rg, Rt, HR, HM) km
uniform vec3 uAtmBetaR;   // rayleigh scattering, 1/km
uniform vec3 uAtmBetaMieExt;  // mie extinction, 1/km
uniform vec2 uAtmMie;     // (mieG, mieFade)

// The stretch that maps the drawn ellipsoid onto the sphere the table was
// baked on: (1, a/c, 1) in the body's own axes, where a is the equatorial
// semi-axis and c the polar one. A sphere is (1, 1, 1) and every formula below
// then reduces to what it was.
//
// The table's density is a function of radius only, so the atmosphere it
// describes is a sphere of radius Rg. Drawing that sphere around a body
// flattened by 11 % -- Saturn -- puts its ground 6 000 km above the visible
// surface at the poles, and the air beside the polar limb is then sampled
// through a shell that does not exist. Stretching the body's local space
// lengthwise by a/c turns the ellipsoid into that sphere exactly: height above
// the drawn surface becomes height above the table's ground, the ellipsoid
// normal becomes the radial direction, and the cosine to the sun is measured
// against the normal for free.
uniform vec3 uAtmAxisScale;

// The reference's colour stage, verbatim in structure: the finished inscatter
// is taken to HSL, its hue shifted, its saturation scaled and clamped, its
// lightness scaled, and it is turned back into RGB. Two numbers, and their
// defaults are the identity -- (0, 1) -- because the reference's own values
// live in a per-body config we do not have. The stage exists so that the
// atmosphere's maths runs in the same order as the reference's; when the
// config values are known they are set here and nothing else moves.
uniform vec2 uAtmColAdjust;      // (hue shift, saturation scale)
uniform float uAtmScatterBright; // multiplies the inscatter's lightness

vec3 atmToTable(vec3 v) { return v * uAtmAxisScale; }

vec3 atmRgb2Hsl(vec3 rgb) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(rgb.bg, K.wz), vec4(rgb.gb, K.xy), step(rgb.b, rgb.g));
    vec4 q = mix(vec4(p.xyw, rgb.r), vec4(rgb.r, p.yzx), step(p.x, rgb.r));
    float d = q.x - min(q.w, q.y);
    const float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 atmHsl2Rgb(vec3 hsl) {
    const vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(hsl.xxx + K.xyz) * 6.0 - K.www);
    return hsl.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), hsl.y);
}

vec3 atmColourAdjust(vec3 inscatter) {
    vec3 hsl = atmRgb2Hsl(inscatter);
    hsl.x += uAtmColAdjust.x;
    hsl.y = clamp(hsl.y * uAtmColAdjust.y, 0.0, 1.0);
    hsl.z *= uAtmScatterBright;
    return atmHsl2Rgb(hsl);
}

struct AtmRay {
    vec3 eyePos;    // planet centred, km
    float eyeR;     // length(eyePos)
    float eyeMu;    // cos between eyePos and viewDir
    vec3 viewDir;   // unit
    float viewLen;  // km along the ray to the ground (or to the top of the shell)
    vec3 fragPos;   // planet centred ground hit, km
    float fragR;
    float fragMu;
};

float atmShellLength() {
    return sqrt(max(uAtmRadii.y * uAtmRadii.y - uAtmRadii.x * uAtmRadii.x, 1e-6));
}

// 0 at the ground, 1 at the top of the shell.
float atmHeight01(float r) {
    return clamp((r - uAtmRadii.x) / max(uAtmRadii.y - uAtmRadii.x, 1e-6), 0.0, 1.0);
}

// Transmittance for the infinite ray (r, mu), ground intersections ignored.
vec3 atmTransmittance(float r, float mu) {
    float uR = sqrt(atmHeight01(r));
    float uMu = atan((mu + 0.15) * (ATM_TAN_15 / 1.15)) / 1.5;
    return texture(uAtmTransmittance, vec2(uMu, uR)).rgb;
}

// Sky irradiance at height h, sun cosine muS. Texel centres, as written.
vec3 atmIrradiance(float h, float muS) {
    float v = (h * 15.0 + 0.5) / 16.0;
    float u = (((muS + 0.2) / 1.2) * 63.0 + 0.5) / 64.0;
    return texture(uAtmIrradiance, vec2(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0))).rgb;
}

// The 3D in-scatter fetch. rgb is phase-free Rayleigh, alpha is the packed Mie
// term; the nu axis is 8 slices blended in two fetches.
vec4 atmTable4D(float r, float mu, float muS, float nu) {
    float H = atmShellLength();
    float ground2 = uAtmRadii.x * uAtmRadii.x;
    float rho = sqrt(max(r * r - ground2, 0.0));
    float rmu = r * mu;
    float delta = rmu * rmu - r * r + ground2;
    // Rays that meet the ground use the first half of the mu axis.
    vec4 cst = (rmu < 0.0 && delta > 0.0)
        ? vec4(1.0, 0.0, 0.0, 0.5 - 0.5 / float(ATM_RES_MU))
        : vec4(-1.0, H * H, H, 0.5 + 0.5 / float(ATM_RES_MU));
    float uR = 0.5 / float(ATM_RES_R) + rho / H * (1.0 - 1.0 / float(ATM_RES_R));
    float uMu = cst.w;
    if (rho + cst.z > 0.0) {
        uMu += (rmu * cst.x + sqrt(max(delta + cst.y, 0.0))) / (rho + cst.z)
             * (0.5 - 1.0 / float(ATM_RES_MU));
    }
    // Inverse of the generator's muS map, clamped where its tan would blow up.
    float muSNorm = atan(max(muS, -0.1975) * ATM_TAN_K) / 1.1 * 0.5 + 0.37;
    float uMuS = 0.5 / float(ATM_RES_MU_S) + muSNorm * (1.0 - 1.0 / float(ATM_RES_MU_S));
    float nuLerp = (nu + 1.0) * 0.5 * float(ATM_RES_NU - 1);
    float nuSlice = floor(nuLerp);
    vec3 uvw = vec3((nuSlice + uMuS) / float(ATM_RES_NU), uMu, uR);
    vec4 sliceA = texture(uAtmInscatter, uvw);
    uvw.x += 1.0 / float(ATM_RES_NU);
    return mix(sliceA, texture(uAtmInscatter, uvw), nuLerp - nuSlice);
}

float atmPhaseR(float mu) {
    const float ca = 3.0 / (16.0 * ATM_PI);
    return ca + ca * mu * mu;
}

float atmPhaseM(float mu) {
    const float ca = 3.0 / (8.0 * ATM_PI);
    float g = uAtmMie.x;
    float g2 = g * g;
    return (ca - ca * g2) * pow(1.0 + g2 - 2.0 * g * mu, -1.5) * (1.0 + mu * mu) / (2.0 + g2);
}

// Unpacks the Mie single scattering stored in .w, scaled by the Rayleigh red
// channel so Rayleigh and Mie can share one rgb slot per table cell.
vec3 atmGetMie(vec4 rayMie) {
    return (rayMie.w * uAtmBetaR.r / max(rayMie.x, 1e-4)) * (rayMie.rgb / uAtmBetaR);
}

// Transmittance of the air between two points on the same ray line, read from
// the transmittance table.
//
// The table stores the transmittance from (r, mu) out to space, and only for
// mu >= about -0.15: a ray that points into the ground is shadowed and reads
// zero. Both ends of our segment are therefore looked up on the upward side of
// the line, and the segment is the ratio lower/higher, which telescopes to
// exp(-integral between the two points) whichever end you start from.
//
// A segment's transmittance is the ratio of two column lookups, which is what
// the table format stores (transmittance(sqrt h, mu, sqrt h0, mu0)). The
// analytic closed form for the same quantity is not used on the surface for a
// measured reason: it evaluates a difference of two exponentials
// whose magnitudes run to exp(+/-50) at grazing geometry, which float32 cannot
// resolve. The table is sampled at 256 x 64 and interpolated, which is what the
// generator baked.
vec3 atmTransmittanceSegment(float eyeR, float eyeMu, float fragR, float fragMu) {
    float rLo = min(eyeR, fragR);
    float rHi = max(eyeR, fragR);
    float muLo = eyeR < fragR ? eyeMu : fragMu;
    float muHi = eyeR < fragR ? fragMu : eyeMu;
    // -mu is the upward cosine at that point; the table has no data for a
    // downward ray (it is shadowed by the ground) and would read zero.
    vec3 lower = atmTransmittance(rLo, -muLo);
    vec3 upper = atmTransmittance(rHi, -muHi);
    // A floor on the divisor keeps a fully absorbing column from dividing by
    // zero; the result is clamped to [0,1] anyway, so the floor only decides
    // which of two saturated answers comes out.
    return clamp(lower / max(upper, vec3(1e-4)), 0.0, 1.0);
}

// The ray the sky term is integrated on.
//
// Same world ray, started at the top of the shell instead of at the eye. This
// matters because the table's mu axis is normalised against the eye distance:
// from 5.2 radii the whole 60 km grazing band maps into one texel and comes
// back flat (measured: 9.88e-1 at the limb and 1.01e+0 at the top, where the
// same row sampled from r = Rt gives 9.88e-1 -> 3.29e-1 -> 2.95e-2 -> 2.86e-6).
// Moving the start of the ray down to Rt changes no air -- everything above it
// is vacuum -- and puts the fetch where the table can answer.
AtmRay atmSkyRay(vec3 eyeKm, vec3 dir) {
    float eyeR = max(length(eyeKm), 1e-6);
    float rSample = min(eyeR, uAtmRadii.y);
    float along = dot(eyeKm, dir);
    // The impact parameter, from the cross product: for a grazing ray it is
    // equal to rSample, and 1 - perp^2/r^2 would then be a difference of nearly
    // equal numbers -- which is how the band ended up 2.6 % wrong on one mesh
    // row. (r - p)(r + p) keeps the small factor small and the large one exact.
    float perp = length(cross(eyeKm, dir));
    float sag2 = (rSample - perp) * (rSample + perp);
    float mu = sign(along) * sqrt(max(sag2, 0.0)) / rSample;
    AtmRay ray;
    ray.eyePos = eyeKm * (rSample / eyeR);
    ray.eyeR = rSample;
    ray.eyeMu = mu;
    ray.viewDir = dir;
    ray.viewLen = 0.0;
    ray.fragPos = ray.eyePos;
    ray.fragR = rSample;
    ray.fragMu = mu;
    return ray;
}

// Scattering along the eye ray itself: the air seen beside the disc, and the
// haze over the disc. Sun cosine fades the Mie channel at the terminator.
vec3 atmInscatterSky(AtmRay ray, vec3 lightDir) {
    float eyeMuS = dot(ray.eyePos, lightDir) / max(ray.eyeR, 1e-6);
    float nu = dot(ray.viewDir, lightDir);
    vec4 inScatter = max(atmTable4D(ray.eyeR, ray.eyeMu, eyeMuS, nu), 0.0);
    inScatter.w *= smoothstep(0.0, uAtmMie.y, eyeMuS);
    return atmColourAdjust(inScatter.rgb * atmPhaseR(nu) + atmGetMie(inScatter) * atmPhaseM(nu));
}

// Scattering along the eye-to-surface segment, as the difference of two table
// fetches. This is the inscatter that belongs on the disc.
vec3 atmInscatterGround(AtmRay ray, vec3 lightDir, vec3 attenuation) {
    float eyeMuS = dot(ray.eyePos, lightDir) / max(ray.eyeR, 1e-6);
    float fragMuS = dot(ray.fragPos, lightDir) / max(ray.fragR, 1e-6);
    float nu = dot(ray.viewDir, lightDir);
    vec4 eyeScatter = atmTable4D(ray.eyeR, ray.eyeMu, eyeMuS, nu);
    vec4 fragScatter = atmTable4D(ray.fragR, ray.fragMu, fragMuS, nu);
    vec4 inScatter = max(eyeScatter - vec4(attenuation, attenuation.r) * fragScatter, 0.0);
    inScatter.w *= smoothstep(0.0, uAtmMie.y, eyeMuS);
    return atmColourAdjust(inScatter.rgb * atmPhaseR(nu) + atmGetMie(inScatter) * atmPhaseM(nu));
}

// Same, with the two-sided interpolation across the horizon that removes the
// seam where the ray stops meeting the ground. eps is in mu units, ~1e-3.
vec3 atmInscatterGroundFix(AtmRay ray, vec3 lightDir, vec3 attenuation, float eps) {
    float invR = uAtmRadii.x / max(ray.eyeR, 1e-6);
    float horizonMu = -sqrt(max(0.0, 1.0 - invR * invR));
    float blend = clamp(((ray.eyeMu - horizonMu) + eps) / (2.0 * eps), 0.0, 1.0);
    float eyeMuS = dot(ray.eyePos, lightDir) / max(ray.eyeR, 1e-6);
    float fragMuS = dot(ray.fragPos, lightDir) / max(ray.fragR, 1e-6);
    float nu = dot(ray.viewDir, lightDir);
    vec4 acc = vec4(0.0);
    vec4 frag = vec4(0.0);
    for (int i = 0; i < 2; i++) {
        float mu = horizonMu + (i == 0 ? -eps : eps);
        float fragR = sqrt(max(ray.eyeR * ray.eyeR + ray.viewLen * ray.viewLen
                             + 2.0 * ray.eyeR * ray.viewLen * mu, 0.0));
        float fragMu = (ray.eyeR * mu + ray.viewLen) / max(fragR, 1e-6);
        vec4 eyeScatter = atmTable4D(ray.eyeR, mu, eyeMuS, nu);
        vec4 fragScatter = atmTable4D(fragR, fragMu, fragMuS, nu);
        vec4 candidate = max(eyeScatter - vec4(attenuation, attenuation.r) * fragScatter, 0.0);
        if (i == 0) acc = candidate; else frag = candidate;
    }
    vec4 inScatter = mix(acc, frag, blend);
    inScatter.w *= smoothstep(0.0, uAtmMie.y, eyeMuS);
    return atmColourAdjust(inScatter.rgb * atmPhaseR(nu) + atmGetMie(inScatter) * atmPhaseM(nu));
}
`;

// Uniform block for one body, straight from its .atm header.
function atmSamplingUniforms(THREE, header, tables) {
    return {
        uAtmInscatter: { value: tables.s },
        uAtmTransmittance: { value: tables.t },
        uAtmIrradiance: { value: tables.e },
        uAtmRadii: {
            value: new THREE.Vector4(
                header.groundRadiusKm,
                header.topRadiusKm,
                header.rayleighScaleHeightKm,
                header.mieScaleHeightKm)
        },
        uAtmBetaR: { value: new THREE.Vector3(...header.rayleighBeta) },
        uAtmBetaMieExt: { value: new THREE.Vector3(...header.mieExtinctionBeta) },
        uAtmMie: { value: new THREE.Vector2(header.mieG, header.mieFade) },
        // Identity until a body's own values are known; the stage itself is the
        // reference's and always runs, so turning it on is two numbers.
        uAtmColAdjust: { value: new THREE.Vector2(0, 1) },
        uAtmScatterBright: { value: 1 },
        // The body's own flattening, (1, a/c, 1). A sphere -- and every body
        // whose drawn shape is a sphere -- leaves this at (1, 1, 1) and the
        // sampler is exactly the spherical one it has always been.
        uAtmAxisScale: { value: new THREE.Vector3(1, 1, 1) }
    };
}

globalThis.ATM_SAMPLING_GLSL = ATM_SAMPLING_GLSL;
globalThis.atmSamplingUniforms = atmSamplingUniforms;
