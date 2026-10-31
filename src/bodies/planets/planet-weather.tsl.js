// planet-weather.tsl.js — TSL counterpart of the lightning bolt
// material in bodies/planets/planet-weather.js (port step
// P5e21). The weather system itself — strike models, regions,
// bolt path generation into the ribbon attributes, the pulse
// envelopes and every per-frame uniform write — stays
// JavaScript there; makeLightningGeometry(T) is already
// namespace-generic. What is ported here is exactly what
// makeMaterial builds: the screen-space ribbon vertex (both
// segment ends projected, widened along the screen normal by
// halfWidth pixels, branches at 0.42 of the width), the
// fragment (earth-cloud coverage gate, edge falloff, branch
// colour mix) and the production log-depth chunks (LDB_*),
// which the explicit depthNode matches (the star-field /
// marker / path-line proved equivalent).
//
// Production's two discards (gate coverage < 0.002, final
// alpha < 0.002) become one keep factor: identical under this
// material's additive blending with depth writes off (the
// plume/path-lines precedent), with the two conditions kept
// separate exactly as production tests them (uAlpha can
// exceed 1, so the alpha test does not subsume the coverage
// test).
//
// The earth-cloud gate samples only when a texture is
// supplied: production binds one only for earth and gates on
// a uniform, so a null texture builds the coverage as the
// constant 1 the classic takes with the gate at 0.
// tools/p5lightning.mjs renders this factory against
// production's real PlanetWeather on both node backends.

import {
    Fn,
    abs,
    acos,
    atan,
    attribute,
    cameraFar,
    cameraNear,
    cameraProjectionMatrix,
    clamp,
    float,
    fract,
    length,
    max,
    mix,
    modelViewMatrix,
    normalize,
    positionGeometry,
    select,
    smoothstep,
    texture,
    uniform,
    varying,
    vec2,
    vec3,
    vec4,
    viewZToLogarithmicDepth
} from "three/tsl";

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? uniform(value) : value;
}

function asVec2Node(value, fallback) {
    if (value === undefined) return vec2(fallback[0], fallback[1]);
    if (Array.isArray(value)) return vec2(value[0], value[1]);
    if (value?.isVector2) return uniform(value);
    return value;
}

function asVec3Node(value, fallback) {
    if (value === undefined) return vec3(fallback[0], fallback[1], fallback[2]);
    if (Array.isArray(value) && value.length === 3) return vec3(value[0], value[1], value[2]);
    if (value?.isColor || value?.isVector3) return uniform(value);
    return value;
}

function asMat3Node(value) {
    if (value === undefined || value === null) return null;
    return value.isMatrix3 ? uniform(value) : value;
}

function asTextureNode(value) {
    if (value === undefined || value === null) return null;
    return value.isTexture ? texture(value) : value;
}

// The earth-cloud uv of one bolt vertex, from its direction
// in the body's own frame (production's vertex head verbatim).
export const lightningEarthCloudUv = Fn(([localPosition]) => {
    const localNormal = normalize(localPosition).toVar();
    const cloudU = fract(atan(localNormal.z, localNormal.x.negate())
        .mul(0.15915494309189535).add(1.0));
    const cloudV = float(1.0).sub(acos(clamp(localNormal.y, -1.0, 1.0))
        .mul(0.3183098861837907));
    return vec2(cloudU, cloudV);
});

// The gate coverage at one fragment: production's
// smoothstep over the deck density (rgb-max or alpha by
// useAlpha), sampled through the deck texture's own matrix.
export const lightningCloudCoverage = Fn(([cloudSample, useAlpha]) => {
    const rgbDensity = max(cloudSample.r, max(cloudSample.g, cloudSample.b));
    const density = mix(rgbDensity, cloudSample.a, useAlpha);
    return smoothstep(0.38, 0.60, density);
});

// createLightningBolt -> { vertexNode, colorNode, depthNode }.
// Options mirror makeMaterial's arguments and uniforms:
// color / branchColor (production passes Color objects built
// by `new T.Color(...)` in makeMaterial, inc. from hex ints —
// pass the Color, not the int), halfWidthPx, alpha (both
// rewritten per frame by the owner: a number becomes a
// uniform, or pass a uniform node to keep writing it),
// viewport (the drawing-buffer size the owner shares),
// earthCloudTexture (+ earthCloudTextureMatrix,
// earthCloudUseAlpha, earthCloudGate) for the earth gate.
// Caller (dual construction): basic (unlit) mesh material
// with the deriveLightningMaterial state; geometry from
// production's makeLightningGeometry layout.
export function createLightningBolt(options = {}) {
    const color = asVec3Node(options.color, [1.0, 1.0, 1.0]);
    const branchColor = options.branchColor === undefined
        ? color
        : asVec3Node(options.branchColor, [1.0, 1.0, 1.0]);
    const halfWidthPx = asFloatNode(options.halfWidthPx, 1.0);
    const alpha = asFloatNode(options.alpha, 0.0);
    const viewportUniform = asVec2Node(options.viewport, [1.0, 1.0]);
    const earthCloudTex = asTextureNode(options.earthCloudTexture);
    const earthCloudMatrix = asMat3Node(options.earthCloudTextureMatrix);
    const earthCloudUseAlpha = asFloatNode(options.earthCloudUseAlpha, 0.0);
    const earthCloudGate = asFloatNode(options.earthCloudGate, 0.0);

    const aOther = attribute("aOther", "vec3");
    const aSide = attribute("aSide", "float");
    const aStrength = attribute("aStrength", "float");
    const aBranch = attribute("aBranch", "float");

    const vEarthCloudUv = varying(lightningEarthCloudUv(positionGeometry));
    const mvPosition = modelViewMatrix.mul(vec4(positionGeometry, 1.0)).toVar();
    const mvOther = modelViewMatrix.mul(vec4(aOther, 1.0)).toVar();
    const clip = cameraProjectionMatrix.mul(mvPosition).toVar();
    const otherClip = cameraProjectionMatrix.mul(mvOther).toVar();
    const viewport = max(viewportUniform, vec2(1.0, 1.0)).toVar();
    const pixelDirection = otherClip.xy.div(max(otherClip.w, 1e-6))
        .sub(clip.xy.div(max(clip.w, 1e-6))).mul(viewport).toVar();
    const directionLength = length(pixelDirection).toVar();
    const direction = select(
        directionLength.greaterThan(1e-5),
        pixelDirection.div(directionLength),
        vec2(0.0, 1.0)).toVar();
    const screenNormal = vec2(direction.y.negate(), direction.x).toVar();
    const branchWidth = mix(float(1.0), float(0.42), aBranch).toVar();
    const offset = screenNormal.mul(aSide).mul(halfWidthPx)
        .mul(branchWidth).mul(2.0).div(viewport).mul(clip.w).toVar();
    const vertexNode = vec4(clip.xy.add(offset), clip.z, clip.w);

    const vSide = varying(aSide);
    const vStrength = varying(aStrength);
    const vBranch = varying(aBranch);
    const vViewZ = varying(mvPosition.z);

    let coverage;
    let gateKeep = null;
    if (earthCloudTex) {
        const cloudUv = earthCloudMatrix
            ? earthCloudMatrix.mul(vec3(vEarthCloudUv, 1.0)).xy
            : vEarthCloudUv;
        const sampled = lightningCloudCoverage(
            earthCloudTex.sample(cloudUv), earthCloudUseAlpha).toVar();
        const gateOn = earthCloudGate.greaterThan(0.5).toVar();
        coverage = select(gateOn, sampled, float(1.0)).toVar();
        gateKeep = gateOn.not().or(sampled.greaterThanEqual(0.002)).toVar();
    } else {
        coverage = float(1.0).toVar();
    }
    const edge = float(1.0).sub(smoothstep(0.72, 1.0, abs(vSide))).toVar();
    const boltAlpha = alpha.mul(vStrength).mul(edge).mul(coverage).toVar();
    const keep = (gateKeep
        ? gateKeep.and(boltAlpha.greaterThanEqual(0.002))
        : boltAlpha.greaterThanEqual(0.002)).toVar();
    const boltColor = mix(color, branchColor, vBranch).toVar();
    const colorNode = select(
        keep,
        vec4(boltColor, boltAlpha),
        vec4(0.0, 0.0, 0.0, 0.0));
    const depthNode = viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return { vertexNode, colorNode, depthNode };
}

// three's SRGBToLinear (the fitted form Color.setHex runs
// under colour management): makeMaterial accepts hex ints
// (production passes the earth branch colours as ints and
// the gas tint as a Color), so the derivation reproduces
// `new T.Color(value)` for both shapes without importing a
// namespace.
function srgbChannelToLinear(c) {
    return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

// Mirror of makeMaterial(T, shaders, color, widthPx, alpha,
// branchColor): the fixed material state and the initial
// uniform values. side/blending are the THREE enum values
// (DoubleSide 2, AdditiveBlending 2), identical in both
// namespaces; colors ride as the component triples
// production's `new T.Color(...)` produces from the same
// argument (a Color passes through; a hex int converts).
export function deriveLightningMaterial(options = {}) {
    const toComponents = (value) => {
        if (value === undefined || value === null) return null;
        if (Array.isArray(value)) return [value[0], value[1], value[2]];
        if (value.isColor || value.isVector3) return [value.r ?? value.x, value.g ?? value.y, value.b ?? value.z];
        if (typeof value === "number") {
            return [
                srgbChannelToLinear((value >> 16 & 255) / 255),
                srgbChannelToLinear((value >> 8 & 255) / 255),
                srgbChannelToLinear((value & 255) / 255)
            ];
        }
        return value;
    };
    const color = toComponents(options.color);
    return {
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: 2,
        blending: 2,
        toneMapped: false,
        fog: false,
        uniforms: {
            viewport: [1, 1],
            halfWidthPx: options.widthPx ?? 1,
            color,
            branchColor: options.branchColor === undefined ? color : toComponents(options.branchColor),
            alpha: options.alpha ?? 0,
            earthCloudTexture: null,
            earthCloudTextureMatrixIsIdentity: true,
            earthCloudUseAlpha: 0,
            earthCloudGate: 0
        }
    };
}
