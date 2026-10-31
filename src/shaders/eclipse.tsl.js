import { Fn, float, abs, acos, asin, atan, cameraPosition, clamp, cross, dot,
    frontFacing, length, mat3, max, min, mix, modelWorldMatrix, normalGeometry,
    normalize, positionGeometry, positionWorld, select, sin, smoothstep, sqrt,
    struct, texture, uniform, uv, varying, vec2, vec3, vec4 } from "three/tsl";
import { CLOUD_EXTINCTION_PER_KM, cloudChord, cloudTransmittance } from "./cloud-medium.tsl.js";

// TSL counterpart of the ECLIPSE_GLSL solarVisibility() helper in
// src/app/state.js.
//
// The GLSL form reads four global uniforms. The node form takes the same
// quantities explicitly (shaded point, occluder centre, sun centre, and the
// two radii), so the Earth-eclipse, ring-particle and atmosphere users can
// share one function without a material knowing which backend is live. The
// disc-overlap arithmetic is unchanged; tools/p3Eclipse.mjs renders both
// forms over several occluder geometries and compares the frames.

export const solarVisibility = Fn(([p, occluder, sun, occluderRadius, sunRadius]) => {
    const toSun = sun.sub(p);
    const toOccluder = occluder.sub(p);
    const ds = length(toSun);
    const dm = length(toOccluder);

    const early = dm.greaterThanEqual(ds)
        .or(dm.lessThanEqual(occluderRadius))
        .or(sunRadius.lessThanEqual(0.0))
        .or(occluderRadius.lessThanEqual(0.0));

    const s = toSun.div(ds);
    const m = toOccluder.div(dm);
    const separation = atan(length(cross(s, m)), dot(s, m));
    const rs = asin(clamp(sunRadius.div(ds), float(0.0), float(1.0)));
    const rm = asin(clamp(occluderRadius.div(dm), float(0.0), float(1.0)));
    const rsSafe = max(rs, float(1e-8));
    const d = separation.div(rsSafe);
    const r = rm.div(rsSafe);

    const noOverlap = d.greaterThanEqual(r.add(1.0));
    const contained = d.lessThanEqual(abs(float(1.0).sub(r)));
    const containedValue = float(1.0).sub(min(float(1.0), r.mul(r)));

    const d2 = d.mul(d);
    const r2 = r.mul(r);
    const a = acos(clamp(d2.add(1.0).sub(r2).div(d.mul(2.0)), float(-1.0), float(1.0)));
    const b = acos(clamp(d2.add(r2).sub(1.0).div(d.mul(r).mul(2.0)), float(-1.0), float(1.0)));
    const product = r.add(1.0).sub(d)
        .mul(d.add(1.0).sub(r))
        .mul(d.add(r).sub(1.0))
        .mul(d.add(r).add(1.0));
    const overlap = a.add(r2.mul(b)).sub(sqrt(max(product, float(0.0))).mul(0.5));
    const partial = clamp(float(1.0).sub(overlap.div(float(3.14159265359))), float(0.0), float(1.0));

    return select(early, float(1.0),
        select(noOverlap, float(1.0),
            select(contained, containedValue, partial)));
});

// P5e20: the installEarthEclipse application, completing
// the counterpart. Production's installer
// (eclipse.glsl.js, a page-global classic script) patches
// two materials by string surgery, keyed on
// material.userData.earthCloudCoverage. On the Earth
// surface material it carries the world and local
// positions as varyings, writes a smoothstepped day mask
// over diffuse colour and alpha, darkens the diffuse by
// a sun-shifted sample of the cloud deck (the deck's
// ground shadow), and after the lighting accumulation
// scales direct diffuse and direct specular by
// solarVisibility. On the cloud-coverage material it
// discards the shell's far side by view shell side,
// whites the diffuse, combines the deck's three etage
// channels into coverage and extinction weight, turns
// view chord into alpha through the cloud medium, zeroes
// both specular terms, and darkens direct diffuse by the
// visibility and the below-horizon sun-chord
// transmittance. The factories below return those
// applications in the createSatelliteEclipse form
// (apply Fns over the reflected-light terms, plus the
// diffuse-level factors as nodes). The JS around them —
// the shared eclipseUniforms object, updateEarthEclipse's
// per-frame writes, the frame loop's cloud-shadow writes
// — stays JavaScript; deriveEarthEclipseInstall mirrors
// the installer's decisions and initial values.

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? uniform(value) : value;
}

function asVec2Node(value, fallback) {
    if (value === undefined) return vec2(fallback[0], fallback[1]);
    if (Array.isArray(value) && value.length === 2) return vec2(value[0], value[1]);
    if (value?.isVector2) return uniform(value);
    return value;
}

function asVec3Node(value, fallback) {
    if (value === undefined) return vec3(fallback[0], fallback[1], fallback[2]);
    if (Array.isArray(value) && value.length === 3) return vec3(value[0], value[1], value[2]);
    if (value?.isVector3 || value?.isColor) return uniform(value);
    return value;
}

function asMat3Node(value) {
    if (value === undefined) return mat3(1, 0, 0, 0, 1, 0, 0, 0, 1);
    if (value?.isMatrix3) return uniform(value);
    if (Array.isArray(value)) return mat3(...value);
    return value;
}

function asTextureNode(value) {
    if (value === undefined || value === null) return null;
    return value.isTexture ? texture(value) : value;
}

// The smoothstepped terminator mask the installer writes
// over the diffuse term (and alpha, on the surface):
// the geometric day side from the planet centre, not the
// fragment normal.
export const earthDayMask = Fn(([worldPosition, earthCenter, sunPosition]) => {
    const surfaceNormal = normalize(worldPosition.sub(earthCenter));
    const earthToSun = normalize(sunPosition.sub(earthCenter));
    return smoothstep(float(-0.04), float(0.04), dot(surfaceNormal, earthToSun));
});

// The surface cloud shadow's sampling coordinates: the
// fragment's latitude/longitude uv on the deck, shifted
// along the sun's tangent direction by a 16 km deck
// height at the local sun altitude. Returns vec3(uv,
// active): 1 when production's nested conditions hold
// (sun above the 0.02 sine-altitude floor with a usable
// tangent), else 0 with a finite uv the caller may still
// sample harmlessly. Inputs are in the body's local
// frame (the classic patch's vEarthLocalPos and
// uCloudShadowSunLocal); the truncated circle constants
// are production's, verbatim.
export const earthCloudShadowUV = Fn(([localPosition, sunLocal, uvOffset]) => {
    const csN = normalize(localPosition).toVar();
    const csSinAlt = dot(csN, sunLocal).toVar();
    const csTangent = sunLocal.sub(csN.mul(csSinAlt)).toVar();
    const csTanLen = length(csTangent).toVar();
    const active = csSinAlt.greaterThan(0.02).and(csTanLen.greaterThan(0.00001)).toVar();
    const csProj = csTangent.div(max(csTanLen, float(1e-12))).toVar();
    const csTheta = acos(clamp(csN.y, float(-1.0), float(1.0))).toVar();
    const csPhi = atan(localPosition.z, localPosition.x.negate()).toVar();
    const rawU = csPhi.div(6.2831853).toVar();
    const csU = select(rawU.lessThan(0.0), rawU.add(1.0), rawU).toVar();
    const csV = csTheta.div(3.14159265).toVar();
    const csSinTheta = clamp(sin(csTheta), float(0.12), float(1.0)).toVar();
    const csEu = vec3(sin(csPhi), 0.0, csPhi.cos()).toVar();
    const csEv = vec3(
        csPhi.cos().negate().mul(csN.y),
        csSinTheta.negate(),
        sin(csPhi).mul(csN.y)).toVar();
    const csOffsetKm = float(16.0).mul(csSinAlt).div(max(csTanLen, float(0.15))).toVar();
    const csShift = vec2(
        dot(csProj, csEu).mul(csOffsetKm).div(float(6.2831853).mul(6371.0).mul(csSinTheta)),
        dot(csProj, csEv).mul(csOffsetKm).div(float(3.14159265).mul(6371.0))
    ).toVar();
    const csUv = vec2(csU, csV).add(uvOffset).add(csShift).toVar();
    return vec3(csUv, select(active, float(1.0), float(0.0)));
});

export const EarthEclipseLight = struct({
    directDiffuse: "vec3",
    directSpecular: "vec3"
}, "EarthEclipseLight");

// Surface-mode application factory. Options mirror the
// shared eclipseUniforms set — earthCenter, sunPosition,
// Eclipse, sunRadius, EclipseRadius, cloudShadowMap
// (texture or texture node; omitted leaves the factor 1,
// where production samples whatever the uniform holds),
// cloudShadowSunLocal [(0, 1, 0)], cloudShadowUvOffset,
// cloudShadowUseAlpha, cloudShadowStrength — plus
// worldPosition / localPosition to evaluate somewhere
// other than the fragment's own carried positions.
// Numbers and vectors become uniforms, so the frame
// loop's writes stay mutable. The diffuse-level factors
// are returned as nodes (diffuseScale over rgb,
// diffuseAlphaScale over alpha, applied by production
// after the map sample); the lighting-level application
// is the apply Fns.
export function createEarthEclipse(options = {}) {
    const install = deriveEarthEclipseInstall({ ...options, earthCloudCoverage: false });
    const earthCenter = asVec3Node(options.earthCenter, install.uniforms.earthCenter);
    const sunPosition = asVec3Node(options.sunPosition, install.uniforms.sun);
    const Eclipse = asVec3Node(options.Eclipse, install.uniforms.Eclipse);
    const sunRadius = asFloatNode(options.sunRadius, install.uniforms.sunRadius);
    const EclipseRadius = asFloatNode(options.EclipseRadius, install.uniforms.EclipseRadius);
    const cloudShadowSunLocal = asVec3Node(options.cloudShadowSunLocal, install.uniforms.cloudShadowSunLocal);
    const cloudShadowUvOffset = asVec2Node(options.cloudShadowUvOffset, install.uniforms.cloudShadowUvOffset);
    const cloudShadowUseAlpha = asFloatNode(options.cloudShadowUseAlpha, install.uniforms.cloudShadowUseAlpha);
    const cloudShadowStrength = asFloatNode(options.cloudShadowStrength, install.uniforms.cloudShadowStrength);
    const worldPosition = options.worldPosition ?? positionWorld;
    const localPosition = varying(options.localPosition ?? positionGeometry);
    const cloudShadowTex = asTextureNode(options.cloudShadowMap);

    const earthEclipseVisibility = Fn(([fragWorld]) => {
        return solarVisibility(fragWorld, Eclipse, sunPosition, EclipseRadius, sunRadius);
    });

    const earthEclipseApply = Fn(([fragWorld, directDiffuse, directSpecular]) => {
        const visibility = earthEclipseVisibility(fragWorld).toVar();
        return EarthEclipseLight({
            directDiffuse: directDiffuse.mul(visibility),
            directSpecular: directSpecular.mul(visibility)
        });
    });

    // The production-shaped entry: the receiver is the
    // fragment's own world position, as the classic
    // patch's vEclipseWorld varying carries it.
    const earthEclipseApplyAtPositionWorld = Fn(([directDiffuse, directSpecular]) => {
        return earthEclipseApply(worldPosition, directDiffuse, directSpecular);
    });

    const dayMask = earthDayMask(worldPosition, earthCenter, sunPosition).toVar();

    let cloudShadowFactor = float(1.0);
    if (cloudShadowTex) {
        const shadowUv = earthCloudShadowUV(
            localPosition, cloudShadowSunLocal, cloudShadowUvOffset).toVar();
        const tap = cloudShadowTex.sample(shadowUv.xy);
        const mask = mix(tap.r, tap.a, cloudShadowUseAlpha).toVar();
        const shaded = float(1.0).sub(
            cloudShadowStrength.mul(smoothstep(float(0.30), float(0.62), mask))).toVar();
        cloudShadowFactor = select(
            cloudShadowStrength.greaterThan(0.001).and(shadowUv.z.greaterThan(0.5)),
            shaded, float(1.0));
    }

    return {
        earthEclipseVisibility,
        earthEclipseApply,
        earthEclipseApplyAtPositionWorld,
        EarthEclipseLight,
        dayMask,
        cloudShadowFactor,
        diffuseScale: dayMask.mul(cloudShadowFactor),
        diffuseAlphaScale: dayMask
    };
}

export const EarthCloudEclipseLight = struct({
    directDiffuse: "vec3",
    directSpecular: "vec3",
    indirectSpecular: "vec3"
}, "EarthCloudEclipseLight");

// Cloud-coverage-mode application factory. Options add
// the deck set to the eclipse set: map (texture or
// texture node holding the three etage channels),
// mapTransform (identity default; production's uv
// arrives through the map channel transform), mapUv,
// maskUsesAlpha, insideShell, cloudShell [(6387, 6382)
// km], cloudExtinction [the medium's constant],
// deckShiftMid / deckShiftHigh (the upper etages' drift
// relative to the low layer, in uv turns), and
// worldPosition / worldNormal overrides (production
// carries normalize(mat3(modelMatrix) * normal)
// verbatim, inverse-transpose and all; that is the
// default here). Production installs this form only on
// a mapped material; with no map the taps read zero
// coverage instead. The classic patch writes
// diffuseColor.rgb = vec3(1) and scales diffuseColor.a
// by (1 - view transmittance) over the map's own alpha;
// alphaFactor below carries exactly that product
// (material opacity still multiplies on top, as
// production's does), and facingKeep realises the
// shell-side discard as a factor (production's coverage
// material writes no depth, so the factor and the
// discard are the same frame).
export function createEarthCloudCoverage(options = {}) {
    const install = deriveEarthEclipseInstall({ ...options, earthCloudCoverage: true });
    const earthCenter = asVec3Node(options.earthCenter, install.uniforms.earthCenter);
    const sunPosition = asVec3Node(options.sunPosition, install.uniforms.sun);
    const Eclipse = asVec3Node(options.Eclipse, install.uniforms.Eclipse);
    const sunRadius = asFloatNode(options.sunRadius, install.uniforms.sunRadius);
    const EclipseRadius = asFloatNode(options.EclipseRadius, install.uniforms.EclipseRadius);
    const maskUsesAlpha = asFloatNode(options.maskUsesAlpha, install.cloud.maskUsesAlpha);
    const insideShell = asFloatNode(options.insideShell, install.cloud.insideShell);
    const cloudShell = asVec2Node(options.cloudShell, install.cloud.shell);
    const cloudExtinction = asFloatNode(options.cloudExtinction, install.cloud.extinction);
    const deckShiftMid = asVec2Node(options.deckShiftMid, install.cloud.deckShiftMid);
    const deckShiftHigh = asVec2Node(options.deckShiftHigh, install.cloud.deckShiftHigh);
    const worldPosition = options.worldPosition ?? positionWorld;
    const worldNormal = varying(options.worldNormal ??
        normalize(modelWorldMatrix.mul(vec4(normalGeometry, 0.0)).xyz));
    const mapTex = asTextureNode(options.map);
    const mapTransform = asMat3Node(options.mapTransform);
    const baseUv = mapTransform.mul(vec3(options.mapUv ?? uv(), 1.0)).xy.toVar();

    const tapLow = mapTex ? mapTex.sample(baseUv) : vec4(0.0);
    const tapMid = mapTex ? mapTex.sample(baseUv.add(deckShiftMid)) : vec4(0.0);
    const tapHigh = mapTex ? mapTex.sample(baseUv.add(deckShiftHigh)) : vec4(0.0);
    const aLow = mix(tapLow.r, tapLow.a, maskUsesAlpha).toVar();
    const aMid = tapMid.g.toVar();
    const aHigh = tapHigh.b.toVar();
    // The union coverage: production computes it and
    // applies only the extinction weight below; retained
    // (and returned) as-is.
    const coverageMask = float(1.0).sub(
        float(1.0).sub(aLow).mul(float(1.0).sub(aMid)).mul(float(1.0).sub(aHigh))).toVar();
    const cloudWeight = clamp(
        aLow.add(aMid.mul(0.35)).add(aHigh.mul(0.08)), 0.0, 1.6).toVar();

    const unitNormal = normalize(worldNormal).toVar();
    const viewDir = normalize(cameraPosition.sub(worldPosition)).toVar();
    const viewMu = clamp(abs(dot(unitNormal, viewDir)), 0.0, 1.0).toVar();
    const viewChord = cloudChord(viewMu, cloudShell, insideShell).toVar();
    const facingVisible = insideShell.lessThan(0.5).and(frontFacing)
        .or(insideShell.greaterThanEqual(0.5).and(frontFacing.not())).toVar();
    const facingKeep = select(facingVisible, float(1.0), float(0.0)).toVar();
    const alphaFactor = tapLow.a
        .mul(float(1.0).sub(cloudTransmittance(cloudWeight, viewChord, cloudExtinction)))
        .mul(facingKeep).toVar();

    const earthCloudEclipseVisibility = Fn(([fragWorld]) => {
        return solarVisibility(fragWorld, Eclipse, sunPosition, EclipseRadius, sunRadius);
    });

    const earthCloudEclipseApply = Fn(([fragWorld, directDiffuse, directSpecular, indirectSpecular]) => {
        const visibility = earthCloudEclipseVisibility(fragWorld).toVar();
        const sunDir = normalize(sunPosition.sub(fragWorld)).toVar();
        const sunMu = dot(unitNormal, sunDir).toVar();
        const sunChord = select(sunMu.lessThan(0.0),
            cloudChord(sunMu.negate(), cloudShell, float(0.0)), float(0.0)).toVar();
        const sunTransmittance = cloudTransmittance(
            cloudWeight, sunChord, cloudExtinction).toVar();
        return EarthCloudEclipseLight({
            directDiffuse: directDiffuse.mul(visibility).mul(sunTransmittance),
            directSpecular: vec3(0.0),
            indirectSpecular: vec3(0.0)
        });
    });

    const earthCloudEclipseApplyAtPositionWorld = Fn(([directDiffuse, directSpecular, indirectSpecular]) => {
        return earthCloudEclipseApply(
            worldPosition, directDiffuse, directSpecular, indirectSpecular);
    });

    // Production's map_fragment splice computes the day
    // mask in this mode too and then does not apply it
    // (the medium makes the terminator instead);
    // retained.
    const dayMask = earthDayMask(worldPosition, earthCenter, sunPosition).toVar();

    return {
        earthCloudEclipseVisibility,
        earthCloudEclipseApply,
        earthCloudEclipseApplyAtPositionWorld,
        EarthCloudEclipseLight,
        alphaFactor,
        facingKeep,
        coverageMask,
        cloudWeight,
        dayMask,
        diffuseColor: vec3(1.0)
    };
}

// Installer derivation counterpart: the mode decision
// (the material's earthCloudCoverage userData flag), the
// cache key both forms stamp, the shared eclipseUniforms
// initial values (state.js), and -- in cloud mode -- the
// userData uniform slots the installer creates with
// their fallback values when the material has not
// prepared them (production's deck material prepares the
// same numbers: the shell is (6371 + 16, 6371 + 16 - 5)
// km and the extinction is the medium's constant; the
// mask channel arrives from the deck map and is a
// pass-through here).
export function deriveEarthEclipseInstall(options = {}) {
    const earthCloudCoverage = options.earthCloudCoverage === true;
    return {
        earthCloudCoverage,
        cacheKey: "earth-disc-eclipse-day-mask-v6-" + (earthCloudCoverage ? "cloud" : "surface"),
        uniforms: {
            earthCenter: [0, 0, 0],
            Eclipse: [0, 0, 0],
            sun: [0, 0, 0],
            EclipseRadius: 0,
            sunRadius: 0,
            cloudShadowSunLocal: [0, 1, 0],
            cloudShadowUvOffset: [0, 0],
            cloudShadowUseAlpha: 0,
            cloudShadowStrength: 0
        },
        cloud: earthCloudCoverage ? {
            maskUsesAlpha: options.maskUsesAlpha ?? 0,
            insideShell: 0,
            shell: options.cloudShell ? [options.cloudShell[0], options.cloudShell[1]] : [6387, 6382],
            extinction: options.cloudExtinction ?? CLOUD_EXTINCTION_PER_KM,
            deckShiftMid: [0, 0],
            deckShiftHigh: [0, 0]
        } : null
    };
}
