import {
    Fn,
    If,
    Loop,
    abs,
    atan,
    clamp,
    cross,
    dot,
    exp,
    exp2,
    float,
    floor,
    fract,
    greaterThanEqual,
    length,
    lessThanEqual,
    mat3,
    max,
    min,
    mix,
    normalize,
    positionView,
    positionWorld,
    pow,
    select,
    sign,
    smoothstep,
    sqrt,
    struct,
    tan,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
    viewportCoordinate
} from "three/tsl";

// TSL counterparts for planet-atmosphere.glsl.js, built one proved piece
// at a time. That file mixes three kinds of content: a plain-JavaScript
// physical derivation (gas data, per-body profiles — no shader text, it
// stays JavaScript and feeds uniform values), the fallback atmosphere
// shell shaders (analytic march for bodies without baked tables and for
// the period before a body's table loads), and the material factory.
// This module owns the shader arithmetic counterparts; the classic file
// remains the production owner until the flip.
//
// First piece: the two shared sky helpers both shell fragments include.
// They are pure functions of scalars, so they port without any sampling
// or material machinery. tools/p5atmskyhelpers.mjs renders them against
// the extracted production GLSL on both node backends.

// Analytic slant optical depth through an exponential atmosphere, in
// ground-radius units: H is the scale height, r the eye radius, mu the
// ray cosine, d the path length. This is the closed form the baked
// tables themselves come from; the inside-shell sky uses it directly
// because a table's 32 height slices cannot resolve a grazing ray at a
// two-metre eye. The NaN guard and the finite cap are production
// behaviour, kept in the same order: a non-finite depth becomes 0
// before the cap is applied.
export const atmSkyOpticalDepth = Fn(([H, r, mu, d]) => {
    const rcpH = float(1.0).div(max(H, float(1e-9))).toVar();
    const a = sqrt(float(0.5).mul(r).mul(rcpH)).toVar();
    const dr = d.div(max(r, float(1e-9))).toVar();
    const a01 = a.mul(vec2(mu, dr.add(mu))).toVar();
    const a01s = sign(a01).toVar();
    const a01sq = a01.mul(a01).toVar();
    const x = select(a01s.y.greaterThan(a01s.x), exp(a01sq.x), float(0.0)).toVar();
    const y = a01s
        .div(abs(a01).mul(2.3193).add(sqrt(a01sq.mul(1.52).add(4.0))))
        .mul(vec2(1.0, exp(d.mul(rcpH).mul(dr.mul(0.5).add(mu)).mul(-1.0))))
        .toVar();
    const raw = sqrt(float(6.2831).mul(H).mul(r))
        .mul(exp(float(1.0).sub(r).mul(rcpH)))
        .mul(x.add(dot(y, vec2(1.0, -1.0))))
        .toVar();
    const od = select(raw.greaterThanEqual(0.0), raw, float(0.0)).toVar();
    return min(od, H.mul(4096.0).add(d));
});

// Distance from radius r along a ray with cosine c to the top of the
// shell, shortened to the ground intersection when the ray still meets
// the ground (unit sphere). Branch-for-branch the production form: the
// ground root only replaces the top distance when its discriminant is
// positive and the near intersection lies ahead of the eye.
export const atmRayLimit = Fn(([r, c, rTop]) => {
    const discTop = r.mul(r).mul(c.mul(c).sub(1.0)).add(rTop.mul(rTop)).toVar();
    const dTopRaw = r.mul(c).mul(-1.0).add(sqrt(max(discTop, float(0.0)))).toVar();
    const discGround = r.mul(r).mul(c.mul(c).sub(1.0)).add(1.0).toVar();
    const dGround = r.mul(c).mul(-1.0).sub(sqrt(max(discGround, float(0.0)))).toVar();
    const useGround = discGround.greaterThan(0.0).and(dGround.greaterThan(0.0));
    const dTop = select(useGround, min(dTopRaw, dGround), dTopRaw).toVar();
    return max(dTop, float(0.0));
});

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? float(value) : value;
}

function asVec2Node(value, fallback) {
    if (value === undefined) return vec2(fallback[0], fallback[1]);
    if (Array.isArray(value)) return vec2(value[0], value[1]);
    if (value?.isVector2) return uniform(value);
    if (value && typeof value.x === "number" && typeof value.y === "number" && !value.isNode) {
        return vec2(value.x, value.y);
    }
    return value;
}

function asVec3Node(value, fallback) {
    if (value === undefined) return vec3(fallback[0], fallback[1], fallback[2]);
    if (Array.isArray(value)) return vec3(value[0], value[1], value[2]);
    if (value?.isVector3 || value?.isColor) return uniform(value);
    if (value && typeof value.x === "number" && typeof value.y === "number" &&
        typeof value.z === "number" && !value.isNode) {
        return vec3(value.x, value.y, value.z);
    }
    return value;
}

function asMat3Node(value) {
    if (value === undefined) {
        return mat3(
            vec3(1.0, 0.0, 0.0),
            vec3(0.0, 1.0, 0.0),
            vec3(0.0, 0.0, 1.0)
        );
    }
    if (Array.isArray(value) && value.length === 9) {
        return mat3(
            vec3(value[0], value[1], value[2]),
            vec3(value[3], value[4], value[5]),
            vec3(value[6], value[7], value[8])
        );
    }
    if (value?.isMatrix3) return uniform(value);
    return value;
}

function asTextureNode(value) {
    if (value === undefined || value === null) return null;
    return value?.isTexture ? texture(value) : value;
}

function member(node, name) {
    return typeof node.get === "function" ? node.get(name) : node[name];
}

// Main fallback-shell fragment counterpart: ATMOSPHERE_FRAGMENT_GLSL.
//
// This is the analytic atmosphere every body without a baked table
// renders with (and every tabled body renders until its table loads):
// an ellipsoid-metric view march of viewSamples steps through
// exponential Rayleigh/Mie/absorber (+ optional Gaussian band) media,
// with the sun transmittance per sample taken either from the body's
// optical-depth table (log2-packed, unpacked exactly as production) or
// from the analytic slant depth along the real sun ray, an optional
// multiple-scatter ambient table, and the production post terms in
// production order (mean-response form, ambient floor, rim treatment,
// backlight roll-off, inside albedo gain, soft knee, finite guard,
// horizon melt, dark-occlusion, Eclipse).
//
// Deliberate scope boundaries, mirroring how production assembles the
// shader from pieces:
// - The inside-shell splice (ATMOSPHERE_SKY_INSIDE_GLSL) is the
//   build-time options.insideSky block below — with it, the uniforms
//   only it reads (uBetaR/uHR/uSkySamples-style) become inputs. The
//   inside *gain* branch that lives in this fragment is included
//   regardless.
// - The Eclipse placeholders are an input: options.eclipseVisibility is
//   a function of world position returning a float node (production
//   splices solarVisibility(vWorldPos) for Earth; its arithmetic has
//   its own proved counterpart). Default is 1, production's non-Earth
//   assembly.
// - Build-time choices match production's string choices: viewSamples
//   (16) and hasBand (the ATMOSPHERE_HAS_BAND define).
// - The log-depth pars/head chunks and the colorspace include are not
//   colour arithmetic: log depth belongs to the vertex/depth step, and
//   output colour conversion is the renderer's in node materials.
// - Production `discard`s (ray miss, empty chord, alpha floor) cannot
//   be statements in a pure function, so the result is a struct: the
//   premultiplied-style vec4(radiance, alpha) exactly as production
//   writes it, plus keep = 1 where production would keep the pixel.
//   Callers map keep = 0 to their own discard/background handling.
// tools/p5atmshell.mjs renders this against the assembled production
// fragment on both node backends.
export const AtmosphereShellOutput = struct({
    color: "vec4",
    keep: "float"
}, "AtmosphereShellOutput");

// The inside-sky splice (ATMOSPHERE_SKY_INSIDE_GLSL) as one shared
// builder: production splices the same GLSL block into both shell
// shaders -- inserted just before the eclipse term (P5d3), so the
// Eclipse multiply after it applies to the inside integral as well.
// The block works in ground radii with its own uniform set and fully
// overwrites radiance and alpha when insideShell > 0.5; outside, the
// host's radiance/alpha pass through unchanged. Its per-pixel sample
// dither reads gl_FragCoord in production; fragCoord supplies the
// equivalent node. radiance/alpha are the host's vars, assigned in
// place. tools/p5atmshellinside.mjs and p5atmshellse.mjs render the
// two hosts against the assembled production fragments.
function insideSkyNodes(options) {
    return options.insideSky ? {
        betaR: asVec3Node(options.insideSky.betaR, [0.0, 0.0, 0.0]),
        betaMS: asVec3Node(options.insideSky.betaMS, [0.0, 0.0, 0.0]),
        betaMX: asVec3Node(options.insideSky.betaMX, [0.0, 0.0, 0.0]),
        HR: asFloatNode(options.insideSky.HR, 1.0),
        HM: asFloatNode(options.insideSky.HM, 1.0),
        rtNorm: asFloatNode(options.insideSky.rtNorm, 1.0),
        skyGain: asFloatNode(options.insideSky.skyGain, 1.0),
        eyeHeightR: asFloatNode(options.insideSky.eyeHeightR, 1e-6),
        skySamples: asFloatNode(options.insideSky.skySamples, 32.0)
    } : null;
}

function applyInsideSky({
    insideShell, inside, bodyRadiusU, originMetric, rayMetric,
    rayMetricSq, viewToBodyLocal, sun, axes, mieG, mieTint,
    sunIntensity, intensity, fragCoord, radiance, alpha
}) {
    const LUMINANCE = vec3(0.3333333, 0.3333333, 0.3333333);
    If(insideShell.greaterThan(0.5), () => {
        const rgToBody = max(bodyRadiusU, float(1e-12)).toVar();
        const originMetricR = originMetric.div(rgToBody).toVar();
        const skyDirKm = rayMetric
            .div(max(sqrt(rayMetricSq), float(1e-9))).toVar();
        const skySunKm = normalize(
            viewToBodyLocal.mul(sun).div(axes)).toVar();
        const originLenR = length(originMetricR).toVar();
        const r0 = max(originLenR,
            float(1.0).add(max(inside.eyeHeightR, float(1e-7)))).toVar();
        const up0 = originMetricR
            .div(max(originLenR, float(1e-9))).toVar();
        const mu0 = dot(up0, skyDirKm).toVar();
        const discTop0 = r0.mul(r0).mul(mu0.mul(mu0).sub(1.0))
            .add(inside.rtNorm.mul(inside.rtNorm)).toVar();
        const segTop = r0.mul(mu0).mul(-1.0)
            .add(sqrt(max(discTop0, float(0.0)))).toVar();
        const discGround0 = r0.mul(r0).mul(mu0.mul(mu0).sub(1.0))
            .add(1.0).toVar();
        const dG = r0.mul(mu0).mul(-1.0)
            .sub(sqrt(max(discGround0, float(0.0)))).toVar();
        const segGround = select(
            discGround0.greaterThan(0.0).and(dG.greaterThan(0.0)),
            min(segTop, dG), segTop).toVar();
        const muHorizon = sqrt(max(
            float(1.0).sub(float(1.0).div(r0.mul(r0))),
            float(0.0))).mul(-1.0).toVar();
        const horizonBlend = smoothstep(
            muHorizon.sub(0.014), muHorizon.add(0.014), mu0).toVar();
        const skyMu = dot(skyDirKm, skySunKm).toVar();
        const skyPhaseR = float(0.75)
            .div(float(4.0).mul(3.141592653589793))
            .mul(float(1.0).add(skyMu.mul(skyMu))).toVar();
        const skyG2 = mieG.mul(mieG).toVar();
        const skyPhaseM = float(1.5)
            .div(float(4.0).mul(3.141592653589793))
            .mul(float(1.0).sub(skyG2))
            .mul(pow(max(
                float(1.0).add(skyG2).sub(mieG.mul(skyMu).mul(2.0)),
                float(1e-6)), float(-1.5)))
            .mul(float(1.0).add(skyMu.mul(skyMu))
                .div(float(2.0).add(skyG2))).toVar();
        const skySamplesF = clamp(inside.skySamples,
            float(1.0), float(32.0)).toVar();
        const skyDither = fract(float(52.9829189).mul(fract(
            fragCoord.x.mul(0.06711056)
                .add(fragCoord.y.mul(0.00583715))))).toVar();
        const splitPaths = abs(segTop.sub(segGround))
            .greaterThan(1e-6).toVar();
        const scatterI = vec3(0.0, 0.0, 0.0).toVar();
        const tauI = vec3(0.0, 0.0, 0.0).toVar();
        const expPush = exp(float(6.0)).sub(1.0).toVar();
        Loop(2, ({ i: passI }) => {
            const pass = float(passI).toVar();
            If(pass.lessThan(0.5).or(splitPaths), () => {
                const len = select(splitPaths,
                    select(pass.lessThan(0.5), segGround, segTop),
                    segTop).toVar();
                const w = select(splitPaths,
                    select(pass.lessThan(0.5),
                        float(1.0).sub(horizonBlend), horizonBlend),
                    float(1.0)).toVar();
                If(w.greaterThanEqual(1e-4), () => {
                    const skyLen = max(len, float(1e-7)).toVar();
                    const passScatter = vec3(0.0, 0.0, 0.0).toVar();
                    const prevT = float(0.0).toVar();
                    Loop(32, ({ i: sampleI }) => {
                        If(float(sampleI).lessThan(skySamplesF), () => {
                            const u = clamp(
                                float(sampleI).add(0.5).add(skyDither)
                                    .div(skySamplesF),
                                float(0.0), float(1.0)).toVar();
                            const tEnd = skyLen.mul(
                                exp(u.mul(6.0)).sub(1.0).div(expPush)).toVar();
                            const tMid = prevT.add(tEnd).mul(0.5).toVar();
                            const dsLen = max(
                                tEnd.sub(prevT), float(1e-9)).toVar();
                            prevT.assign(tEnd);
                            const p = originMetricR
                                .add(skyDirKm.mul(tMid)).toVar();
                            const r = max(length(p), float(1.0)).toVar();
                            const up = p.div(r).toVar();
                            const h = max(r.sub(1.0), float(0.0)).toVar();
                            const densityRI = exp(
                                h.div(inside.HR).mul(-1.0)).toVar();
                            const densityMI = exp(
                                h.div(inside.HM).mul(-1.0)).toVar();
                            const sunMuI = dot(up, skySunKm).toVar();
                            const sunDist = atmRayLimit(
                                r, sunMuI, inside.rtNorm).toVar();
                            const sunTauI = inside.betaR.mul(
                                atmSkyOpticalDepth(inside.HR, r, sunMuI, sunDist))
                                .add(inside.betaMX.mul(
                                    atmSkyOpticalDepth(inside.HM, r, sunMuI, sunDist)))
                                .toVar();
                            const sunT = exp(min(
                                max(sunTauI, vec3(0.0, 0.0, 0.0)),
                                vec3(9.0, 9.0, 9.0)).mul(-1.0))
                                .mul(smoothstep(
                                    float(-0.12), float(0.22), sunMuI)).toVar();
                            const tauToSample = inside.betaR.mul(
                                atmSkyOpticalDepth(inside.HR, r0, mu0, tMid))
                                .add(inside.betaMX.mul(
                                    atmSkyOpticalDepth(inside.HM, r0, mu0, tMid)))
                                .toVar();
                            const viewT = exp(min(tauToSample,
                                vec3(9.0, 9.0, 9.0)).mul(-1.0)).toVar();
                            passScatter.addAssign(
                                inside.betaR.mul(densityRI).mul(skyPhaseR)
                                    .add(inside.betaMS.mul(mieTint)
                                        .mul(densityMI).mul(skyPhaseM))
                                    .mul(sunT).mul(viewT).mul(dsLen));
                        });
                    });
                    const passTau = inside.betaR.mul(
                        atmSkyOpticalDepth(inside.HR, r0, mu0, skyLen))
                        .add(inside.betaMX.mul(
                            atmSkyOpticalDepth(inside.HM, r0, mu0, skyLen)))
                        .toVar();
                    scatterI.addAssign(passScatter.mul(w));
                    tauI.addAssign(passTau.mul(w));
                });
            });
        });
        const scatterGain = max(scatterI, vec3(0.0, 0.0, 0.0))
            .mul(sunIntensity).mul(intensity).mul(inside.skyGain).toVar();
        const scatterL = dot(scatterGain, LUMINANCE).toVar();
        const knee = float(1.0)
            .sub(exp(max(scatterL, float(0.0)).mul(-1.0))).toVar();
        radiance.assign(scatterGain
            .mul(knee.div(max(scatterL, float(1e-6)))));
        const scatterPeak = max(radiance.r,
            max(radiance.g, radiance.b)).toVar();
        radiance.assign(radiance.div(max(float(1.0), scatterPeak)));
        const viewTransmitI = exp(
            min(tauI, vec3(9.0, 9.0, 9.0)).mul(-1.0)).toVar();
        alpha.assign(clamp(
            float(1.0).sub(dot(viewTransmitI, LUMINANCE)),
            float(0.0), float(1.0)));
    });
}

export function createAtmosphereShell(options = {}) {
    const viewSamples = Math.max(1, Math.floor(options.viewSamples ?? 16));
    const hasBand = !!options.hasBand;

    const intensity = asFloatNode(options.intensity, 1.0);
    const bodyRadiusU = asFloatNode(options.bodyRadius, 1.0);
    const shellRadius = asFloatNode(options.shellRadius, 1.0);
    const insideShell = asFloatNode(options.insideShell, 0.0);
    const haloEdgeStart = asFloatNode(options.haloEdgeStart, 0.0);
    const viewToBodyLocal = asMat3Node(options.viewToBodyLocal);
    const bodyAxisScale = asVec3Node(options.bodyAxisScale, [1.0, 1.0, 1.0]);
    const scaleHeightR = asFloatNode(options.scaleHeightR, 1.0);
    const scaleHeightM = asFloatNode(options.scaleHeightM, 1.0);
    const tauRayleigh = asVec3Node(options.tauRayleigh, [0.0, 0.0, 0.0]);
    const tauMieScatter = asVec3Node(options.tauMieScatter, [0.0, 0.0, 0.0]);
    const tauMieExt = asVec3Node(options.tauMieExt, [0.0, 0.0, 0.0]);
    const mieG = asFloatNode(options.mieG, 0.0);
    const mieTint = asVec3Node(options.mieTint, [1.0, 1.0, 1.0]);
    const absorbTau = asVec3Node(options.absorbTau, [0.0, 0.0, 0.0]);
    const bandTau = asVec3Node(options.bandTau, [0.0, 0.0, 0.0]);
    const bandCenter = asFloatNode(options.bandCenter, 0.0);
    const bandWidth = asFloatNode(options.bandWidth, 1.0);
    const bandNorm = asFloatNode(options.bandNorm, 1.0);
    const bodyCenterView = asVec3Node(options.bodyCenterView, [0.0, 0.0, 0.0]);
    const limbDarken = asFloatNode(options.limbDarken, 1.0);
    const backlightLevel = asFloatNode(options.backlightLevel, 0.45);
    const darkOcclusion = asFloatNode(options.darkOcclusion, 1.0);
    const sunDir = asVec3Node(options.sunDir, [1.0, 0.0, 0.0]);
    const sunIntensity = asFloatNode(options.sunIntensity, 1.0);
    const opticalDepthTex = asTextureNode(options.opticalDepth);
    const opticalDepthCoeff = asVec2Node(options.opticalDepthCoeff, [0.5, 1.0]);
    const hasOpticalDepth = asFloatNode(options.hasOpticalDepth, 0.0);
    const opticalDepthMax = asFloatNode(options.opticalDepthMax, 1.0);
    const msTex = asTextureNode(options.msTable);
    const hasMs = asFloatNode(options.hasMs, 0.0);
    const msScale = asFloatNode(options.msScale, 1.0);
    const eclipseVisibilityOf = typeof options.eclipseVisibility === "function"
        ? options.eclipseVisibility
        : () => (options.eclipseVisibility !== undefined
            ? asFloatNode(options.eclipseVisibility, 1.0)
            : float(1.0));

    // The inside-sky splice, build-time as in production (shared
    // builder above).
    const inside = insideSkyNodes(options);
    const fragCoord = options.fragCoord !== undefined
        ? options.fragCoord
        : viewportCoordinate.xy;

    const LUMINANCE = vec3(0.3333333, 0.3333333, 0.3333333);
    const SAMPLES = float(viewSamples);

    const sampleMultipleScatter = (cosChi, heightNorm) => {
        if (!msTex) return vec4(0.0, 0.0, 0.0, 0.0);
        const u = float(1.0).sub(clamp(cosChi, float(-1.0), float(1.0))).mul(0.5);
        const v = clamp(heightNorm, float(0.0), float(1.0));
        return msTex.sample(vec2(u, v)).mul(msScale);
    };

    const sampleOpticalDepth = (cosChi, heightNorm) => {
        if (!opticalDepthTex) return vec3(0.0, 0.0, 0.0);
        const u = float(1.0).sub(clamp(cosChi, float(-1.0), float(1.0)))
            .mul(opticalDepthCoeff.x);
        const v = clamp(heightNorm, float(0.0), float(1.0)).mul(opticalDepthCoeff.y);
        const encoded = opticalDepthTex.sample(vec2(u, v)).rgb.mul(opticalDepthMax);
        return exp2(encoded).sub(vec3(1.0, 1.0, 1.0));
    };

    // The fragment's own slant depth: identical closed form to the sky
    // helper above except the density falloff is measured from
    // uBodyRadius (this fragment works in model units, not ground
    // radii) — kept as the separate production function it is.
    const atmOpticalDepth = Fn(([H, r, mu, d]) => {
        const rcpH = float(1.0).div(max(H, float(1e-9))).toVar();
        const a = sqrt(float(0.5).mul(r).mul(rcpH)).toVar();
        const dr = d.div(max(r, float(1e-9))).toVar();
        const a01 = a.mul(vec2(mu, dr.add(mu))).toVar();
        const a01s = sign(a01).toVar();
        const a01sq = a01.mul(a01).toVar();
        const x = select(a01s.y.greaterThan(a01s.x), exp(a01sq.x), float(0.0)).toVar();
        const y = a01s
            .div(abs(a01).mul(2.3193).add(sqrt(a01sq.mul(1.52).add(4.0))))
            .mul(vec2(1.0, exp(d.mul(rcpH).mul(dr.mul(0.5).add(mu)).mul(-1.0))))
            .toVar();
        const raw = sqrt(float(6.2831).mul(H).mul(r))
            .mul(exp(bodyRadiusU.sub(r).mul(rcpH)))
            .mul(x.add(dot(y, vec2(1.0, -1.0))))
            .toVar();
        const od = select(raw.greaterThanEqual(0.0), raw, float(0.0)).toVar();
        return min(od, H.mul(4096.0).add(d));
    });

    const rayleighPhaseOf = (mu) => mu.mul(mu).add(1.0).mul(0.75);
    const miePhaseOf = (mu) => {
        const g2 = mieG.mul(mieG);
        return min(float(2.5),
            float(1.0).sub(g2).div(pow(max(
                float(1.0).add(g2).sub(mieG.mul(mu).mul(2.0)),
                float(0.035)), float(1.5))));
    };

    const atmosphereShellColor = Fn(([atmoView, worldPos]) => {
        const ray = normalize(atmoView).toVar();
        const axes = max(bodyAxisScale, vec3(1e-6, 1e-6, 1e-6)).toVar();
        const rayMetric = viewToBodyLocal.mul(ray).div(axes).toVar();
        const originMetric = viewToBodyLocal.mul(bodyCenterView.mul(-1.0)).div(axes).toVar();
        const rayMetricSq = dot(rayMetric, rayMetric).toVar();
        const b = dot(originMetric, rayMetric).toVar();
        const originSq = dot(originMetric, originMetric).toVar();
        const outerDiscriminant = b.mul(b)
            .sub(rayMetricSq.mul(originSq.sub(shellRadius.mul(shellRadius))))
            .toVar();
        const outerRoot = sqrt(max(outerDiscriminant, float(0.0))).toVar();
        const startRaw = max(float(0.0),
            b.mul(-1.0).sub(outerRoot).div(rayMetricSq)).toVar();
        const finishRaw = b.mul(-1.0).add(outerRoot).div(rayMetricSq).toVar();
        const innerDiscriminant = b.mul(b)
            .sub(rayMetricSq.mul(originSq.sub(bodyRadiusU.mul(bodyRadiusU))))
            .toVar();
        const bodyEntry = b.mul(-1.0)
            .sub(sqrt(max(innerDiscriminant, float(0.0))))
            .div(rayMetricSq).toVar();
        const finishClipped = select(
            innerDiscriminant.greaterThan(0.0).and(bodyEntry.greaterThan(startRaw)),
            min(finishRaw, bodyEntry),
            finishRaw).toVar();
        const start = startRaw.toVar();
        const finish = finishClipped.toVar();
        // Production also derives bodyHit here; nothing downstream reads
        // it in this fragment (the rim treatment uses grazeDepth), so it
        // is not carried.
        const perpDist = length(cross(originMetric, rayMetric))
            .div(max(sqrt(rayMetricSq), float(1e-9))).toVar();
        const grazeDepth = bodyRadiusU.sub(perpDist)
            .div(max(bodyRadiusU, float(1e-8))).toVar();
        const rimBlend = smoothstep(float(-0.02), float(0.06), grazeDepth).toVar();
        const chord = finish.sub(start).toVar();
        const bodyRadius = max(bodyRadiusU, float(1e-8)).toVar();
        const stepF = float(1.0).div(SAMPLES).toVar();
        const stepLength = stepF.mul(chord).toVar();
        const weight = stepF.mul(chord).div(bodyRadius).toVar();
        const inverseHeightR = float(1.0).div(max(scaleHeightR, float(1e-9))).toVar();
        const inverseHeightM = float(1.0).div(max(scaleHeightM, float(1e-9))).toVar();
        // grazingTerm is computed but unused in production; not carried.
        const shellFadeStart = shellRadius
            .sub(max(shellRadius.sub(bodyRadiusU).mul(0.30), float(1e-6)))
            .toVar();
        const sun = normalize(sunDir).toVar();
        const sunBodyLocal = normalize(viewToBodyLocal.mul(sun)).toVar();
        const mu = dot(ray.mul(-1.0), sun).toVar();
        const phaseR = rayleighPhaseOf(mu).toVar();
        const phaseM = miePhaseOf(mu).toVar();
        const sunMetricDir = normalize(viewToBodyLocal.mul(sun).div(axes)).toVar();
        const heightSpan = max(shellRadius.sub(bodyRadiusU), float(1e-9)).toVar();

        const tauView = vec3(0.0, 0.0, 0.0).toVar();
        const scatter = vec3(0.0, 0.0, 0.0).toVar();
        const sunAccum = float(0.0).toVar();

        Loop(viewSamples, ({ i }) => {
            const fi = float(i).toVar();
            const pointMetric = originMetric.add(
                rayMetric.mul(start.add(fi.add(0.5).mul(stepLength)))).toVar();
            const rMetric = length(pointMetric).toVar();
            const altitude = max(rMetric.sub(bodyRadiusU), float(0.0)).toVar();
            const shellFade = float(1.0)
                .sub(smoothstep(shellFadeStart, shellRadius, rMetric)).toVar();
            const densityR = exp(altitude.mul(inverseHeightR).mul(-1.0))
                .mul(shellFade).toVar();
            If(densityR.greaterThanEqual(1e-5), () => {
                const densityM = exp(altitude.mul(inverseHeightM).mul(-1.0))
                    .mul(shellFade).toVar();
                let bandRate = vec3(0.0, 0.0, 0.0);
                if (hasBand) {
                    const bandOffset = altitude.div(bodyRadius)
                        .sub(bandCenter).div(bandWidth).toVar();
                    bandRate = bandTau.mul(
                        exp(bandOffset.mul(bandOffset).mul(-1.0)).mul(bandNorm));
                }
                const bandRateNode = bandRate.toVar ? bandRate : bandRate;
                const sunMu = dot(normalize(pointMetric.div(axes)), sunBodyLocal).toVar();
                const extinction = tauRayleigh.mul(densityR)
                    .add(tauMieExt.mul(densityM))
                    .add(absorbTau.mul(densityR))
                    .add(bandRateNode).toVar();
                const sunTau = vec3(0.0, 0.0, 0.0).toVar();
                If(hasOpticalDepth.greaterThan(0.5), () => {
                    sunTau.assign(
                        sampleOpticalDepth(sunMu, altitude.div(heightSpan))
                            .add(bandRateNode.mul(bandWidth)));
                }).Else(() => {
                    const pDotS = dot(pointMetric, sunMetricDir).toVar();
                    const pSq = dot(pointMetric, pointMetric).toVar();
                    const muSun = clamp(pDotS.div(max(rMetric, float(1e-9))),
                        float(-1.0), float(1.0)).toVar();
                    const topDisc = pDotS.mul(pDotS)
                        .sub(pSq.sub(shellRadius.mul(shellRadius))).toVar();
                    const dSunRaw = select(topDisc.greaterThan(0.0),
                        max(pDotS.mul(-1.0).add(sqrt(max(topDisc, float(0.0)))),
                            float(0.0)),
                        float(0.0)).toVar();
                    const sunBodyDisc = pDotS.mul(pDotS)
                        .sub(pSq.sub(bodyRadiusU.mul(bodyRadiusU))).toVar();
                    const tBodyEntry = pDotS.mul(-1.0)
                        .sub(sqrt(max(sunBodyDisc, float(0.0)))).toVar();
                    const dSun = select(
                        sunBodyDisc.greaterThan(0.0)
                            .and(tBodyEntry.greaterThan(0.0))
                            .and(tBodyEntry.lessThan(dSunRaw)),
                        tBodyEntry, dSunRaw).toVar();
                    sunTau.assign(
                        tauRayleigh.mul(atmOpticalDepth(scaleHeightR, rMetric, muSun, dSun))
                            .add(tauMieExt.mul(atmOpticalDepth(scaleHeightM, rMetric, muSun, dSun)))
                            .add(absorbTau.mul(atmOpticalDepth(scaleHeightR, rMetric, muSun, dSun)))
                            .div(bodyRadius)
                            .add(bandRateNode.mul(bandWidth)));
                });
                const sunTransmit = exp(
                    min(max(sunTau, vec3(0.0, 0.0, 0.0)), vec3(9.0, 9.0, 9.0)).mul(-1.0))
                    .mul(smoothstep(float(-0.12), float(0.22), sunMu)).toVar();
                const viewTransmit = exp(
                    min(max(tauView, vec3(0.0, 0.0, 0.0)), vec3(9.0, 9.0, 9.0)).mul(-1.0))
                    .toVar();
                scatter.addAssign(
                    tauRayleigh.mul(densityR).mul(phaseR)
                        .add(tauMieScatter.mul(densityM).mul(phaseM).mul(mieTint))
                        .mul(sunTransmit).mul(viewTransmit).mul(weight));
                If(hasMs.greaterThan(0.5), () => {
                    const msAmbient = sampleMultipleScatter(
                        sunMu, altitude.div(heightSpan)).toVar();
                    const msSource = tauRayleigh.mul(densityR).mul(msAmbient.rgb)
                        .add(tauMieScatter.mul(densityM).mul(mieTint).mul(msAmbient.a))
                        .toVar();
                    scatter.addAssign(msSource.mul(viewTransmit).mul(weight).mul(0.6));
                });
                tauView.addAssign(extinction.mul(weight));
                sunAccum.addAssign(dot(sunTransmit, LUMINANCE));
            });
        });

        const transmittance = exp(
            min(max(tauView, vec3(0.0, 0.0, 0.0)), vec3(9.0, 9.0, 9.0)).mul(-1.0))
            .toVar();
        const avgSun = sunAccum.div(SAMPLES).toVar();
        const meanResponse = max(scatter, vec3(0.0, 0.0, 0.0))
            .div(max(min(tauView, vec3(9.0, 9.0, 9.0)), vec3(1e-5, 1e-5, 1e-5)))
            .toVar();
        const radiance = meanResponse
            .mul(vec3(1.0, 1.0, 1.0).sub(transmittance)).toVar();
        const rayleighShare = tauRayleigh
            .div(max(tauRayleigh.add(tauMieScatter), vec3(1e-5, 1e-5, 1e-5)))
            .toVar();
        radiance.addAssign(rayleighShare
            .mul(vec3(1.0, 1.0, 1.0).sub(transmittance))
            .mul(avgSun.mul(0.35))
            .mul(phaseR.mul(0.18).add(0.06)));
        radiance.mulAssign(sunIntensity.mul(intensity));

        const rim = rimBlend.mul(float(1.0).sub(insideShell)).mul(limbDarken).toVar();
        const alpha = clamp(
            float(1.0).sub(dot(transmittance, LUMINANCE)),
            float(0.0), mix(float(0.88), float(0.66), rim)).toVar();
        alpha.mulAssign(smoothstep(float(0.0), float(0.02), dot(radiance, LUMINANCE)));
        radiance.mulAssign(mix(float(1.0), float(0.35), rim.mul(alpha)));

        // Reversed smoothstep edges are production text; the formula is
        // evaluated identically here.
        const backlight = smoothstep(float(-0.15), float(-0.75),
            dot(normalize(sunDir), normalize(bodyCenterView.mul(-1.0)))).toVar();
        radiance.mulAssign(mix(float(1.0),
            mix(float(1.0), backlightLevel, backlight), limbDarken));

        If(insideShell.greaterThan(0.5), () => {
            const scatSum = dot(tauRayleigh.add(tauMieScatter), LUMINANCE).toVar();
            const extSum = dot(
                tauRayleigh.add(tauMieExt).add(absorbTau), LUMINANCE).toVar();
            const skyAlbedo = clamp(scatSum.div(max(extSum, float(1e-5))),
                float(0.0), float(0.94)).toVar();
            radiance.assign(radiance.div(max(
                float(1.0).sub(skyAlbedo.mul(dot(transmittance, LUMINANCE))),
                float(0.06))));
        });

        radiance.assign(vec3(1.0, 1.0, 1.0).sub(exp(radiance.mul(1.05).mul(-1.0))));
        // Finite-value guard, componentwise exactly as the
        // classic mix(vec3(0), radiance, vec3(lessThanEqual)):
        // a single bad channel is zeroed, the others stream.
        // (select() with a vector condition would collapse to
        // all() on this three build — port step P5e16.)
        radiance.assign(mix(vec3(0.0, 0.0, 0.0), radiance,
            vec3(lessThanEqual(abs(radiance), vec3(1.0, 1.0, 1.0)))));
        alpha.assign(select(alpha.greaterThanEqual(0.0), alpha, float(0.0)));

        If(insideShell.lessThan(0.5), () => {
            const haloEdge = float(1.0).sub(smoothstep(haloEdgeStart, float(1.0),
                perpDist.div(max(shellRadius, float(1e-8))))).toVar();
            radiance.mulAssign(haloEdge);
            alpha.mulAssign(haloEdge);
        });

        alpha.mulAssign(mix(float(1.0), darkOcclusion, backlight));
        if (inside) {
            applyInsideSky({
                insideShell, inside, bodyRadiusU, originMetric,
                rayMetric, rayMetricSq, viewToBodyLocal, sun, axes,
                mieG, mieTint, sunIntensity, intensity, fragCoord,
                radiance, alpha
            });
        }
        const eclipseVisibility = eclipseVisibilityOf(worldPos).toVar();
        radiance.mulAssign(eclipseVisibility);

        const keep = rayMetricSq.greaterThan(1e-12)
            .and(outerDiscriminant.greaterThan(0.0))
            .and(finish.greaterThan(start))
            .and(alpha.greaterThanEqual(0.0005)
                .or(max(radiance.r, max(radiance.g, radiance.b)).greaterThanEqual(0.002)));

        return AtmosphereShellOutput({
            color: vec4(radiance, alpha),
            keep: select(keep, float(1.0), float(0.0))
        });
    });

    // Material-ready forms: the view-space fragment position and world
    // position nodes corresponding to the production varyings.
    const atmosphereShellColorNode = (
        atmoView = positionView, worldPos = positionWorld) => {
        return atmosphereShellColor(atmoView, worldPos);
    };

    return {
        viewSamples,
        hasBand,
        hasInsideSky: !!inside,
        atmosphereShellColor,
        atmosphereShellColorNode,
        AtmosphereShellOutput
    };
}

// Bruneton runtime shell counterpart: ATMOSPHERE_FRAGMENT_SE_GLSL.
//
// Same ellipsoid-metric ray geometry and premultiplied composite as
// the analytic shell above, but scattering comes from the baked
// Bruneton tables (buildBrunetonLuts): a 2D transmittance LUT and the
// 4D inscatter table packed into a 2D atlas (RES_R 32 slices of
// RES_MU 64 rows, RES_NU 8 slices of RES_MU_S 32 columns), evaluated
// with the production ground-difference decomposition
// S[L]|x − T(x,xs)·S[L]|xs. Two assembly facts are mirrored exactly:
// (1) this fragment's own table reader is a separate implementation
// from the atm-sampling library (different UV parameterisations — the
// tables were baked for these), so it is ported as written, not
// routed through createAtmSampling; (2) the inside-sky splice is
// inserted just before the eclipse term exactly as on the analytic
// shell (P5d3 -- the pre-fix replacement anchor missed this
// fragment: an `alpha *= shellFade;` line intervened, so the inside
// integral never ran here), via the shared applyInsideSky builder;
// this fragment's chord fade then still applies to alpha after it.
// Uniforms the production material declares but this fragment never
// reads (uHaloEdgeStart, uLimbDarken, uBacklightLevel,
// uDarkOcclusion -- analytic-path post terms) are not inputs here;
// the inside set arrives through options.insideSky, and mieTint is
// read only by the inside integral (the tables carry it baked in).
// tools/p5atmshellse.mjs renders this against the assembled
// production fragment on both node backends.
export function createAtmosphereShellSE(options = {}) {
    const intensity = asFloatNode(options.intensity, 1.0);
    const bodyRadiusU = asFloatNode(options.bodyRadius, 1.0);
    const shellRadius = asFloatNode(options.shellRadius, 1.0);
    const insideShell = asFloatNode(options.insideShell, 0.0);
    const viewToBodyLocal = asMat3Node(options.viewToBodyLocal);
    const bodyAxisScale = asVec3Node(options.bodyAxisScale, [1.0, 1.0, 1.0]);
    const bodyCenterView = asVec3Node(options.bodyCenterView, [0.0, 0.0, 0.0]);
    const sunDir = asVec3Node(options.sunDir, [1.0, 0.0, 0.0]);
    const sunIntensity = asFloatNode(options.sunIntensity, 1.0);
    const transmittanceLut = asTextureNode(options.transmittanceLut);
    const inscatterLut = asTextureNode(options.inscatterLut);
    const rgKm = asFloatNode(options.rgKm, 1.0);
    const rtNorm = asFloatNode(options.rtNorm, 1.0);
    const mieG = asFloatNode(options.mieG, 0.0);
    const mieFade = asFloatNode(options.mieFade, 0.0);
    const lutGain = asFloatNode(options.lutGain, 1.0);
    const mieTint = asVec3Node(options.mieTint, [1.0, 1.0, 1.0]);
    // The inside-sky splice, build-time as in production (shared
    // builder above).
    const inside = insideSkyNodes(options);
    const fragCoord = options.fragCoord !== undefined
        ? options.fragCoord
        : viewportCoordinate.xy;
    const eclipseVisibilityOf = typeof options.eclipseVisibility === "function"
        ? options.eclipseVisibility
        : () => (options.eclipseVisibility !== undefined
            ? asFloatNode(options.eclipseVisibility, 1.0)
            : float(1.0));

    const LUMINANCE = vec3(0.3333333, 0.3333333, 0.3333333);
    const ATM_PI = float(3.141592653589793);
    const RES_R = 32.0;
    const RES_MU = 64.0;
    const RES_MU_S = 32.0;
    const RES_NU = 8.0;

    const atmTransmittance = (r, mu) => {
        const rc = clamp(r, float(1.0), rtNorm);
        const muc = clamp(mu, float(-1.0), float(1.0));
        const uR = sqrt(clamp(
            rc.sub(1.0).div(max(rtNorm.sub(1.0), float(1e-6))),
            float(0.0), float(1.0)));
        const uMu = atan(muc.add(0.15).div(1.15).mul(tan(float(1.5)))).div(1.5);
        const uvT = vec2(clamp(uMu, float(0.0), float(1.0)), uR).toVar();
        if (!transmittanceLut) return vec3(1.0, 1.0, 1.0);
        return transmittanceLut.sample(uvT).rgb;
    };

    const atmTransmittanceBetween = (r, mu, r1, mu1) => {
        const above = min(
            atmTransmittance(r, mu)
                .div(max(atmTransmittance(r1, mu1), vec3(1e-6, 1e-6, 1e-6))),
            vec3(1.0, 1.0, 1.0));
        const below = min(
            atmTransmittance(r1, mu1.mul(-1.0))
                .div(max(atmTransmittance(r, mu.mul(-1.0)), vec3(1e-6, 1e-6, 1e-6))),
            vec3(1.0, 1.0, 1.0));
        return select(mu.greaterThan(0.0), above, below);
    };

    const atmPhaseR = (mu) => float(3.0).div(float(16.0).mul(ATM_PI))
        .mul(float(1.0).add(mu.mul(mu)));
    const atmPhaseM = (mu) => {
        const g2 = mieG.mul(mieG);
        return float(1.5).div(float(4.0).mul(ATM_PI))
            .mul(float(1.0).sub(g2))
            .mul(pow(max(
                float(1.0).add(g2).sub(mieG.mul(mu).mul(2.0)),
                float(1e-6)), float(-1.5)))
            .mul(float(1.0).add(mu.mul(mu)).div(float(2.0).add(g2)));
    };
    // The simplified Mie extractor: in exact arithmetic the reference
    // form reduces to w per channel; returning w directly avoids the
    // production-documented divide-by-floor explosion.
    const atmGetMie = (rayMie) => {
        const w = max(rayMie.w, float(0.0));
        return vec3(w, w, w);
    };

    const atmTexture4D = (r, mu, muS, nu) => {
        if (!inscatterLut) return vec4(0.0, 0.0, 0.0, 0.0);
        const H = sqrt(max(
            rtNorm.mul(rtNorm).sub(1.0), float(1e-9))).toVar();
        const rho = sqrt(max(r.mul(r).sub(1.0), float(0.0))).toVar();
        const rmu = r.mul(mu).toVar();
        const delta = rmu.mul(rmu).sub(r.mul(r)).add(1.0).toVar();
        const groundBranch = rmu.lessThan(0.0).and(delta.greaterThan(0.0));
        const cst = select(groundBranch,
            vec4(1.0, 0.0, 0.0, 0.5 - 0.5 / RES_MU),
            vec4(-1.0, H.mul(H), H, float(0.5 + 0.5 / RES_MU))).toVar();
        const uR = float(0.5 / RES_R)
            .add(rho.div(H).mul(1.0 - 1.0 / RES_R)).toVar();
        const denom = max(rho.add(cst.z), float(1e-5)).toVar();
        const uMu = cst.w.add(
            rmu.mul(cst.x).add(sqrt(max(delta.add(cst.y), float(0.0))))
                .div(denom).mul(0.5 - 1.0 / RES_MU)).toVar();
        const uMuS = clamp(
            float(0.5 / RES_MU_S).add(
                atan(max(muS, float(-0.1975)).mul(tan(float(1.26 * 1.1))))
                    .div(1.1).add(1.0 - 0.26).mul(0.5 * (1.0 - 1.0 / RES_MU_S))),
            float(0.5 / RES_MU_S), float(1.0 - 0.5 / RES_MU_S)).toVar();
        const lerpNu = clamp(nu, float(-1.0), float(1.0)).add(1.0)
            .div(2.0).mul(RES_NU - 1.0).toVar();
        const uNu = floor(lerpNu).toVar();
        const fNu = lerpNu.sub(uNu).toVar();
        const sliceF = clamp(uR, float(0.0), float(1.0)).mul(RES_R).sub(0.5).toVar();
        const s0 = clamp(floor(sliceF), float(0.0), float(RES_R - 2.0)).toVar();
        const fR = clamp(sliceF.sub(s0), float(0.0), float(1.0)).toVar();
        const lo = inscatterLut.sample(vec2(
            uNu.add(uMuS).div(RES_NU), s0.add(uMu).div(RES_R)))
            .mul(float(1.0).sub(fNu))
            .add(inscatterLut.sample(vec2(
                uNu.add(1.0).add(uMuS).div(RES_NU), s0.add(uMu).div(RES_R)))
                .mul(fNu)).toVar();
        const hi = inscatterLut.sample(vec2(
            uNu.add(uMuS).div(RES_NU), s0.add(1.0).add(uMu).div(RES_R)))
            .mul(float(1.0).sub(fNu))
            .add(inscatterLut.sample(vec2(
                uNu.add(1.0).add(uMuS).div(RES_NU), s0.add(1.0).add(uMu).div(RES_R)))
                .mul(fNu)).toVar();
        return lo.mul(float(1.0).sub(fR)).add(hi.mul(fR));
    };

    const atmosphereShellSEColor = Fn(([atmoView, worldPos]) => {
        const ray = normalize(atmoView).toVar();
        const axes = max(bodyAxisScale, vec3(1e-6, 1e-6, 1e-6)).toVar();
        const rayMetric = viewToBodyLocal.mul(ray).div(axes).toVar();
        const originMetric = viewToBodyLocal.mul(bodyCenterView.mul(-1.0)).div(axes).toVar();
        const rayMetricSq = dot(rayMetric, rayMetric).toVar();
        const b = dot(originMetric, rayMetric).toVar();
        const originSq = dot(originMetric, originMetric).toVar();
        const outerDiscriminant = b.mul(b)
            .sub(rayMetricSq.mul(originSq.sub(shellRadius.mul(shellRadius))))
            .toVar();
        const outerRoot = sqrt(max(outerDiscriminant, float(0.0))).toVar();
        const start = max(float(0.0),
            b.mul(-1.0).sub(outerRoot).div(rayMetricSq)).toVar();
        const finishRaw = b.mul(-1.0).add(outerRoot).div(rayMetricSq).toVar();
        const innerDiscriminant = b.mul(b)
            .sub(rayMetricSq.mul(originSq.sub(bodyRadiusU.mul(bodyRadiusU))))
            .toVar();
        // Production computes this intersection twice (once inside the
        // clip branch, once for bodyHit); one evaluation, same value.
        const bodyEntry = select(innerDiscriminant.greaterThan(0.0),
            b.mul(-1.0).sub(sqrt(max(innerDiscriminant, float(0.0))))
                .div(rayMetricSq),
            float(-1.0)).toVar();
        const bodyHit = innerDiscriminant.greaterThan(0.0)
            .and(bodyEntry.greaterThan(start)).toVar();
        const finish = select(bodyHit, min(finishRaw, bodyEntry), finishRaw).toVar();
        // Draw only the surface the ray meets first: near surface from
        // outside, far surface from inside (production's exact distance
        // test against the segment midpoint, as a keep condition).
        const fragDist = length(atmoView).toVar();
        const nearSurface = fragDist
            .lessThan(start.add(finish).mul(0.5)).toVar();
        const surfaceKeep = select(insideShell.lessThan(0.5),
            nearSurface, nearSurface.not()).toVar();
        const bodyRadius = max(bodyRadiusU, float(1e-8)).toVar();
        const sun = normalize(sunDir).toVar();

        const kmPerUnit = rgKm.div(bodyRadius).toVar();
        const dirKm = rayMetric.div(max(sqrt(rayMetricSq), float(1e-9))).toVar();
        const sunKm = normalize(viewToBodyLocal.mul(sun).div(axes)).toVar();
        const rGround = float(1.0)
            .add(max(rtNorm.sub(1.0), float(1e-6)).mul(1e-3)).toVar();
        const eyeKm = originMetric.add(rayMetric.mul(start)).mul(kmPerUnit).toVar();
        const eyeLen = max(length(eyeKm), float(1e-6)).toVar();
        const upE = eyeKm.div(eyeLen).toVar();
        const rE = clamp(eyeLen.div(rgKm), rGround, rtNorm.sub(1e-5)).toVar();
        const muE = dot(upE, dirKm).toVar();
        const muSun = dot(upE, sunKm).toVar();
        const nu = clamp(dot(dirKm, sunKm), float(-1.0), float(1.0)).toVar();
        const fragKm = originMetric.add(rayMetric.mul(finish)).mul(kmPerUnit).toVar();
        const fragLen = max(length(fragKm), float(1e-6)).toVar();
        const upF = fragKm.div(fragLen).toVar();
        const rF = clamp(fragLen.div(rgKm), rGround, rtNorm.sub(1e-5)).toVar();
        const muF = dot(upF, dirKm).toVar();
        const muSF = dot(upF, sunKm).toVar();

        const transmittance = atmTransmittanceBetween(rE, muE, rF, muF).toVar();
        const phaseR = atmPhaseR(nu).toVar();
        const phaseM = atmPhaseM(nu).toVar();

        const inScatter = max(atmTexture4D(rE, muE, muSun, nu),
            vec4(0.0, 0.0, 0.0, 0.0)).toVar();
        If(bodyHit.and(insideShell.lessThan(0.5)), () => {
            const fragS = max(atmTexture4D(rF, muF, muSF, nu),
                vec4(0.0, 0.0, 0.0, 0.0)).toVar();
            inScatter.assign(max(
                inScatter.sub(vec4(transmittance, transmittance.r).mul(fragS)),
                vec4(0.0, 0.0, 0.0, 0.0)));
        });
        inScatter.assign(vec4(inScatter.rgb,
            inScatter.a.mul(smoothstep(
                float(0.0), max(mieFade, float(1e-3)), muSun))));
        const radiance = max(
            inScatter.rgb.mul(phaseR).add(atmGetMie(inScatter).mul(phaseM)),
            vec3(0.0, 0.0, 0.0)).toVar();

        radiance.mulAssign(sunIntensity.mul(intensity).mul(lutGain));
        // NaN guard, componentwise as the classic
        // mix(vec3(0), radiance, vec3(greaterThanEqual))
        // (see the finite-value guard above; P5e16).
        radiance.assign(mix(vec3(0.0, 0.0, 0.0), radiance,
            vec3(greaterThanEqual(radiance, vec3(0.0, 0.0, 0.0)))));
        radiance.assign(vec3(1.0, 1.0, 1.0).sub(exp(radiance.mul(-1.0))));

        const shellChordKm = max(finish.sub(start), float(0.0))
            .mul(kmPerUnit).toVar();
        const shellThicknessKm = max(
            rtNorm.sub(1.0).mul(rgKm), float(1e-3)).toVar();
        const shellFade = smoothstep(float(0.0),
            shellThicknessKm.mul(0.35), shellChordKm).toVar();
        radiance.mulAssign(shellFade);

        const alpha = clamp(
            float(1.0).sub(dot(transmittance, LUMINANCE)),
            float(0.0), float(1.0)).toVar();
        alpha.mulAssign(smoothstep(
            float(0.0), float(0.02), dot(radiance, LUMINANCE)));

        if (inside) {
            applyInsideSky({
                insideShell, inside, bodyRadiusU, originMetric,
                rayMetric, rayMetricSq, viewToBodyLocal, sun, axes,
                mieG, mieTint, sunIntensity, intensity, fragCoord,
                radiance, alpha
            });
        }
        const eclipseVisibility = eclipseVisibilityOf(worldPos).toVar();
        radiance.mulAssign(eclipseVisibility);
        alpha.mulAssign(shellFade);

        const keep = rayMetricSq.greaterThan(1e-12)
            .and(outerDiscriminant.greaterThan(0.0))
            .and(finish.greaterThan(start))
            .and(surfaceKeep)
            .and(alpha.greaterThanEqual(0.0005)
                .or(max(radiance.r, max(radiance.g, radiance.b)).greaterThanEqual(0.002)));

        return AtmosphereShellOutput({
            color: vec4(radiance, alpha),
            keep: select(keep, float(1.0), float(0.0))
        });
    });

    const atmosphereShellSEColorNode = (
        atmoView = positionView, worldPos = positionWorld) => {
        return atmosphereShellSEColor(atmoView, worldPos);
    };

    return {
        hasInsideSky: !!inside,
        atmosphereShellSEColor,
        atmosphereShellSEColorNode,
        AtmosphereShellOutput
    };
}

// Material-factory derivation counterpart of createPlanetAtmosphere in
// planet-atmosphere.glsl.js (the P5c9 installer pattern applied to the
// shell factory): everything the classic factory decides from plain
// values -- material selection (Bruneton SE vs analytic), geometry
// parameters, tier scaling, and every uniform value either material
// is constructed with -- derived here as plain data with production's
// exact arithmetic and guards, shaped as option bags for
// createAtmosphereShell / createAtmosphereShellSE above. What stays
// with the caller: THREE object construction, the slot cache,
// geometry building, table acquisition (buildBrunetonLuts and the
// analytic table getters resolve to the texture/metadata inputs
// below), per-frame uniform updates (live values pass through), and
// brunetonParamsForBody itself, which is shared JS derivation the
// LUT bake also consumes. tools/p5atmshellfactory.mjs runs the real
// production factory and this derivation side by side on the same
// inputs for every body in the atmosphere database.

export const ATMOSPHERE_MIN_RENDER_OPTICAL_DEPTH = 1e-4;
export const ATMOSPHERE_VIEW_SAMPLES = 16;
export const ATMOSPHERE_INSIDE_SKY_EXPOSURE = 9.0;

// Real haze tints the reference data does not carry (production
// ATMOSPHERE_MIE_TINT_OVERRIDE, verbatim). See colorComponents for
// what production's Color construction does with the array form.
export const ATMOSPHERE_MIE_TINT_OVERRIDE = Object.freeze({
    venus: [1.0, 0.94, 0.74]
});

// The shell material parameters, as plain values (enum numbers are
// data here, as in the P5c9 sky parameters): premultiplied custom
// blending (One, OneMinusSrcAlpha on both colour and alpha),
// double-sided single-pass, depth tested not written, untonemapped,
// unfogged.
export const ATMOSPHERE_SHELL_MATERIAL_PARAMETERS = {
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: 2,
    forceSinglePass: true,
    blending: 5,
    blendEquation: 100,
    blendSrc: 201,
    blendDst: 205,
    blendEquationAlpha: 100,
    blendSrcAlpha: 201,
    blendDstAlpha: 205,
    premultipliedAlpha: true,
    toneMapped: false,
    fog: false
};

export const ATMOSPHERE_SHELL_MESH_PARAMETERS = {
    renderOrder: 2,
    nameSuffix: " scattering atmosphere",
    isAtmosphere: true,
    raycastDisabled: true
};

// THREE.Color single-argument semantics for the value classes the
// factory actually passes, as plain components: a hex number is
// sRGB-decoded into the linear working space (three's exact
// SRGBToLinear); anything else -- including the override map's
// array form above, which the Color constructor does not recognise
// -- leaves the default white. That makes the venus override
// currently a no-op in production; mirrored, not fixed (a fix is a
// visible production change for its own step).
function srgbByteToLinear(byte) {
    const c = byte / 255;
    return c < 0.04045
        ? c * 0.0773993808
        : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

function colorComponents(value) {
    // P5d2: float arrays are linear components taken verbatim,
    // matching the production atmosphereMieTintColor helper.
    // (Before the fix both sides shipped white for the venus
    // override: production's single-argument Color(array), and
    // this function's non-number fallback mirroring it.)
    if (Array.isArray(value)) return [value[0], value[1], value[2]];
    if (typeof value !== "number") return [1.0, 1.0, 1.0];
    const hex = Math.floor(value);
    return [
        srgbByteToLinear((hex >> 16) & 255),
        srgbByteToLinear((hex >> 8) & 255),
        srgbByteToLinear(hex & 255)
    ];
}

function tierSkySamples(tier) {
    return tier === "low" ? 8 : tier === "medium" ? 16 : 32;
}

function tierShellSegments(tier) {
    if (tier === "low") return [96, 48];
    if (tier === "medium") return [160, 80];
    return [256, 128];
}

export function deriveAtmosphereShellInstall(options = {}) {
    const key = options.key;
    const profile = options.profile;
    const derived = profile?.derived;
    if (!derived) return null;
    const radius = options.radius;
    if (!(radius > 0)) return null;
    if (!(derived.opticalDepth > ATMOSPHERE_MIN_RENDER_OPTICAL_DEPTH)) return null;
    const brunetonParams = options.brunetonParams;
    if (!brunetonParams) return null;

    const radiusKm = options.radiusKm || 6371;
    const bodyAxesKm = options.bodyAxesKm || [radiusKm, radiusKm, radiusKm];
    const maxAxisKm = Math.max(...bodyAxesKm);
    const axisScale = [
        bodyAxesKm[0] / maxAxisKm,
        bodyAxesKm[2] / maxAxisKm,
        bodyAxesKm[1] / maxAxisKm
    ];
    const shellRadius = radius * (1 + derived.renderTopKm / radiusKm);
    const segments = tierShellSegments(options.tier);
    const skySamples = tierSkySamples(options.tier);
    const kmToBodyRatio = 1 / radiusKm;
    const scaleHeightR = Math.max(derived.rayleighScaleHeightKm, 1e-6) * radius / radiusKm;
    const scaleHeightM = Math.max(derived.mieScaleHeightKm, 1e-6) * radius / radiusKm;
    const rayleighPerRadius = radiusKm / Math.max(derived.rayleighScaleHeightKm, 1e-6);
    const miePerRadius = radiusKm / Math.max(derived.mieScaleHeightKm, 1e-6);
    const band = derived.band;
    const bandWidth = band ? Math.max(band.widthKm * kmToBodyRatio, 1e-7) : 1;
    const eclipse = key === "earth";
    const hasLuts = !!options.hasLuts;
    const opticalDepthTable = hasLuts ? null : (options.opticalDepthTable || null);
    const multipleScatterTable = hasLuts ? null : (options.multipleScatterTable || null);
    const useHalfFloat = !!options.useHalfFloat;
    const Rg = brunetonParams.Rg;
    const betaR = brunetonParams.betaR.map(v => v * Rg);
    const betaMS = brunetonParams.betaMSca.map(v => v * Rg);
    const betaMX = brunetonParams.betaMEx.map(v => v * Rg);
    const HR = Math.max(brunetonParams.HR / Rg, 1e-7);
    const HM = Math.max(brunetonParams.HM / Rg, 1e-7);
    const rtNorm = brunetonParams.Rt / Rg;
    const mieTint = colorComponents(
        ATMOSPHERE_MIE_TINT_OVERRIDE[key] || derived.mieTint);

    const shared = {
        intensity: profile.intensity,
        bodyRadius: radius,
        shellRadius,
        insideShell: options.insideShell !== undefined ? options.insideShell : 0,
        viewToBodyLocal: options.viewToBodyLocal,
        bodyAxisScale: axisScale,
        bodyCenterView: options.bodyCenterView !== undefined
            ? options.bodyCenterView : [0.0, 0.0, 0.0],
        sunDir: options.sunDir !== undefined ? options.sunDir : [1.0, 0.0, 0.0],
        sunIntensity: options.sunIntensity !== undefined ? options.sunIntensity : 1,
        eclipseVisibility: options.eclipseVisibility
    };

    // Both materials splice in the same inside-sky block and are fed
    // the same ground-radius set (production computes it identically
    // for either material).
    const insideSky = {
        betaR,
        betaMS,
        betaMX,
        HR,
        HM,
        rtNorm,
        skyGain: ATMOSPHERE_INSIDE_SKY_EXPOSURE,
        eyeHeightR: options.eyeHeightR !== undefined ? options.eyeHeightR : 1e-6,
        skySamples
    };

    let shellOptions;
    if (hasLuts) {
        shellOptions = {
            ...shared,
            transmittanceLut: options.transmittanceLut,
            inscatterLut: options.inscatterLut,
            rgKm: Rg,
            rtNorm,
            mieG: options.lutsMieG,
            mieTint,
            mieFade: brunetonParams.mieFade,
            lutGain: key === "venus" ? 12.0 : 3.0,
            insideSky
        };
    } else {
        const derivedTint = colorComponents(derived.mieTint);
        const coeff = opticalDepthTable?.sampleCoeff;
        shellOptions = {
            ...shared,
            viewSamples: ATMOSPHERE_VIEW_SAMPLES,
            hasBand: !!band,
            haloEdgeStart: 0.965,
            scaleHeightR,
            scaleHeightM,
            tauRayleigh: [
                derived.tauR.r * rayleighPerRadius,
                derived.tauR.g * rayleighPerRadius,
                derived.tauR.b * rayleighPerRadius
            ],
            tauMieScatter: [
                derived.tauM * derivedTint[0] * miePerRadius,
                derived.tauM * derivedTint[1] * miePerRadius,
                derived.tauM * derivedTint[2] * miePerRadius
            ],
            tauMieExt: [
                derived.tauMExt.r * miePerRadius,
                derived.tauMExt.g * miePerRadius,
                derived.tauMExt.b * miePerRadius
            ],
            mieG: derived.mieG,
            mieTint,
            absorbTau: derived.methaneTau
                ? [
                    derived.methaneTau[0] * rayleighPerRadius,
                    derived.methaneTau[1] * rayleighPerRadius,
                    derived.methaneTau[2] * rayleighPerRadius
                ]
                : [0.0, 0.0, 0.0],
            bandTau: band ? [band.tau.r, band.tau.g, band.tau.b] : [0.0, 0.0, 0.0],
            bandCenter: band ? band.centerKm * kmToBodyRatio : 0,
            bandWidth,
            bandNorm: band ? 1 / (bandWidth * Math.sqrt(Math.PI)) : 0,
            limbDarken: key === "venus" ? 0.0 : 1.0,
            backlightLevel: key === "saturn" || key === "jupiter" ? 0.0 : 0.45,
            darkOcclusion: key === "saturn" || key === "jupiter" ? 0.0 : 1.0,
            opticalDepth: options.opticalDepthTexture,
            opticalDepthCoeff: coeff
                ? [coeff.x !== undefined ? coeff.x : coeff[0],
                   coeff.y !== undefined ? coeff.y : coeff[1]]
                : [0, 0],
            hasOpticalDepth: opticalDepthTable ? 1 : 0,
            opticalDepthMax: opticalDepthTable && !useHalfFloat
                ? opticalDepthTable.encodedMax : 1,
            msTable: options.multipleScatterTexture,
            hasMs: multipleScatterTable ? 1 : 0,
            msScale: multipleScatterTable && !useHalfFloat
                ? multipleScatterTable.encodeScale : 1,
            insideSky
        };
    }

    return {
        kind: hasLuts ? "se" : "analytic",
        eclipse,
        shellRadius,
        axisScale,
        segments,
        skySamples,
        shellOptions,
        materialParameters: ATMOSPHERE_SHELL_MATERIAL_PARAMETERS,
        meshParameters: ATMOSPHERE_SHELL_MESH_PARAMETERS
    };
}
