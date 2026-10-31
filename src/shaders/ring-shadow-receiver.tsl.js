import {
    bool,
    float,
    dot,
    length,
    normalize,
    positionWorld,
    select,
    uniform,
    vec3
} from "three/tsl";

// TSL counterpart of ringShadowReceiverGlsl() in
// ring-shadow-receiver.glsl.js.
//
// The GLSL form loops over a uniform band array. In the node graph the band
// list is known when a material is built (installRingShadowReceiver receives
// it at install time), so this helper unrolls the same "project to the ring
// plane, test the radius against every band" logic at graph-construction
// time. Bands may be [inner, outer] number pairs or vec2-like nodes.
//
// tools/p3ringshadowreceiver.mjs renders both forms and compares the
// frames (byte-exact at P3e).
//
// P5c18 completion, below: the material-factory and installer-
// derivation counterparts (the P5c9 pattern).
// createRingShadowReceiver binds the production uniform set
// around the factor above; the caller multiplies the returned
// shadowFactor into direct diffuse and direct specular, which
// is where the classic patch applies it (lights_fragment_end).
// deriveRingShadowReceiverInstall mirrors what
// installRingShadowReceiver decides from plain values --
// notably the band packing: at most RING_SHADOW_MAX_BANDS
// pairs into a Float32Array, or the single [inner, outer]
// default band when no bands are given. The classic
// uRingInner/uRingOuter uniforms feed only that default; the
// factor itself reads bands and count alone. Per frame the
// app's frame loop writes centre (planet world position),
// normal (the ring mesh's world +Z) and sun position (the
// lighting origin); those updates stay with the caller as
// uniform nodes. The classic file remains the production
// owner until the flip.
// tools/p5ringshadowreceiver.mjs proves the factory/derivation
// half (derivation bit-exact against the real installer).

function asFloatNode(value) {
    return typeof value === "number" ? float(value) : value;
}

function bandEnds(band) {
    if (Array.isArray(band)) return [asFloatNode(band[0]), asFloatNode(band[1])];
    return [band.x, band.y];
}

export function ringShadowReceiverFactor(fragWorld, ringCenter, ringNormal, sunPos, darkness, bands) {
    const axis = normalize(ringNormal);
    const light = normalize(sunPos.sub(fragWorld));
    const fragPlaneDistance = dot(fragWorld.sub(ringCenter), axis);
    const lightPlaneDistance = dot(light, axis);
    const t = fragPlaneDistance.mul(-1.0).div(lightPlaneDistance);
    const projectedRadius = length(fragWorld.add(light.mul(t)).sub(ringCenter));

    let inBand = bool(false);
    for (const band of bands || []) {
        const [inner, outer] = bandEnds(band);
        inBand = inBand.or(projectedRadius.greaterThan(inner).and(projectedRadius.lessThan(outer)));
    }

    const active = fragPlaneDistance.mul(lightPlaneDistance).lessThan(0.0).and(inBand);
    return select(active, float(1.0).sub(asFloatNode(darkness)), float(1.0));
}

export const RING_SHADOW_MAX_BANDS = 10;

function vec3Or(value, fallback) {
    if (value === undefined) return vec3(fallback[0], fallback[1], fallback[2]);
    if (Array.isArray(value)) return vec3(value[0], value[1], value[2]);
    if (value?.isVector3 || value?.isColor) return uniform(value);
    if (value && typeof value.x === "number" && typeof value.y === "number" &&
        typeof value.z === "number" && !value.isNode) {
        return vec3(value.x, value.y, value.z);
    }
    return value;
}

// Installer derivation counterpart: installRingShadowReceiver's
// band packing, operation for operation (including the
// Float32Array storage, so packed values carry production's
// float32 rounding), plus the pass-through values. The returned
// bands pairs are read back from the packed array, so a factory
// built from them uses bit-identical constants to the classic
// uniform array.
export function deriveRingShadowReceiverInstall(options = {}) {
    const bandArray = new Float32Array(RING_SHADOW_MAX_BANDS * 2);
    let bandCount;
    const src = options.bands;
    if (src && src.length) {
        bandCount = Math.min(src.length, RING_SHADOW_MAX_BANDS);
        for (let i = 0; i < bandCount; i++) {
            bandArray[i * 2] = src[i][0];
            bandArray[i * 2 + 1] = src[i][1];
        }
    } else {
        bandArray[0] = options.innerR;
        bandArray[1] = options.outerR;
        bandCount = 1;
    }
    const bands = [];
    for (let i = 0; i < bandCount; i++) {
        bands.push([bandArray[i * 2], bandArray[i * 2 + 1]]);
    }
    return {
        innerR: options.innerR,
        outerR: options.outerR,
        darkness: options.darkness,
        bandArray,
        bandCount,
        bands,
        // The installer's initial ring-normal value; the frame
        // loop overwrites it every frame.
        normal: [0.0, 1.0, 0.0]
    };
}

// Options mirror the installer's parameters and uniform set:
// innerR/outerR/darkness/bands as given to
// installRingShadowReceiver (numeric bands go through the
// derivation above, so defaulting and the 10-band cap match;
// bands given as vec2 nodes bypass it), plus the per-frame
// center/normal/sunPos (pass uniform nodes). fragWorld
// defaults to positionWorld, the value the production vertex
// patch computes. darkness may be a node for a live value.
export function createRingShadowReceiver(options = {}) {
    const fragWorld = options.fragWorld !== undefined
        ? options.fragWorld : positionWorld;
    const center = vec3Or(options.center, [0.0, 0.0, 0.0]);
    const normal = vec3Or(options.normal, [0.0, 1.0, 0.0]);
    const sunPos = vec3Or(options.sunPos, [0.0, 0.0, 0.0]);
    const install = deriveRingShadowReceiverInstall(options);
    const numericBands = options.bands === undefined ||
        (Array.isArray(options.bands) &&
            options.bands.every(b => Array.isArray(b) && typeof b[0] === "number"));
    const bands = numericBands ? install.bands : options.bands;
    const darkness = typeof options.darkness === "number" ||
            options.darkness === undefined
        ? install.darkness : options.darkness;

    const shadowFactor = ringShadowReceiverFactor(
        fragWorld, center, normal, sunPos, darkness, bands);

    return { shadowFactor, install };
}
