// comet-depth.tsl.js — TSL port of the nucleus depth pre-pass
// material in src/bodies/small-bodies/comet-depth.js (port step P5e11).
//
// Classic counterpart: one ShaderMaterial rendered into a cropped
// render target per nucleus. The vertex writes the view-space
// position divided by a world-space range; the fragment packs the
// interpolated radial distance (clamped to 0..0.99999) with three's
// packDepthToRGBA from the packing chunk. Consumers (comet occlusion)
// unpack it to occlude coma/tail volume behind the nucleus. The
// render-target orchestration around it (per-renderer targets,
// signature caching, tight viewport crop, renderer state
// save/restore) is renderer-generic JS and is not part of this port.
//
// Depth attachment: the classic material carries no logarithmic-
// depth chunks, so its target attachment holds linear hardware
// depth. A mesh node material on the log-depth renderer instead
// gets three's automatic log-depth fragment write (measured from
// the generated shader at P5e11; the P5e9 no-auto-log-depth proof
// covers line materials). The difference is inert here and the
// port deliberately keeps depthNode null: the attachment is never
// sampled (consumers unpack the packed colour), it only picks the
// winning front fragment of a single nucleus surface, and both
// depth functions are monotonic in view depth, so the winner is
// the same fragment (the proof rig's overlap case is byte-exact).
// If Phase B ever needs bit-identical attachment values, an
// explicit perspective depthNode is the place to add it.
//
// packDepthToRGBA is not exported by three/tsl, so it is ported here
// operation-for-operation from r186's packing chunk (the modf-based
// form): GLSL modf(x, i) returns the fractional part and stores the
// truncated part; for the non-negative values here that is exactly
// i = trunc(x), frac = x - i (both exact in fp32 at these
// magnitudes), which is what the statement-ordered Fn below does,
// including the chunk's v <= 0 / v >= 1 early returns. Consumer-side
// unpacking (unpackRGBAToDepth) belongs to the occlusion port.

import {
    Fn,
    If,
    cameraProjectionMatrix,
    clamp,
    float,
    length,
    max,
    modelViewMatrix,
    positionGeometry,
    trunc,
    uniform,
    varying,
    vec4
} from "three/tsl";

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? uniform(value) : value;
}

// r186 packing chunk constants.
const PACK_UPSCALE = 256 / 255;
const SHIFT_RIGHT_8 = 1 / 256;
const INV_255 = 1 / 255;
const PACK_FACTOR_A = 256 * 256 * 256;

const packDepthToRGBA = Fn(([v]) => {
    // The chunk's early returns become an If/ElseIf/Else assign
    // chain over one result var (an early Return inside If does
    // not bind to this Fn on the WGSL backend of this build —
    // measured at P5e11: it emitted a void return in main).
    const packed = vec4(0.0, 0.0, 0.0, 0.0).toVar();
    If(v.lessThanEqual(0.0), () => {
        packed.assign(vec4(0.0, 0.0, 0.0, 0.0));
    }).ElseIf(v.greaterThanEqual(1.0), () => {
        packed.assign(vec4(1.0, 1.0, 1.0, 1.0));
    }).Else(() => {
        const scaled = v.mul(PACK_FACTOR_A).toVar();
        const wholeA = trunc(scaled).toVar();
        const af = scaled.sub(wholeA).toVar();
        const shiftedB = wholeA.mul(SHIFT_RIGHT_8).toVar();
        const wholeB = trunc(shiftedB).toVar();
        const bf = shiftedB.sub(wholeB).toVar();
        const shiftedG = wholeB.mul(SHIFT_RIGHT_8).toVar();
        const wholeG = trunc(shiftedG).toVar();
        const gf = shiftedG.sub(wholeG).toVar();
        packed.assign(vec4(
            wholeG.mul(INV_255),
            gf.mul(PACK_UPSCALE),
            bf.mul(PACK_UPSCALE),
            af
        ));
    });
    return packed;
});

// createCometNucleusDepth -> { vertexNode, colorNode, depthNode: null }.
// Options: range (the classic `range` uniform: world distance that
// maps to packed depth 1; production rewrites it per render, so a
// number becomes a uniform the caller can keep updating — classic
// initial value 1).
// Caller (dual construction): opaque FrontSide material,
// NoBlending, toneMapped false, depth test/write on (the three
// defaults) — the production pre-pass material state.
export function createCometNucleusDepth(options = {}) {
    const range = asFloatNode(options.range, 1.0);

    const mvPosition = modelViewMatrix.mul(vec4(positionGeometry, 1.0)).toVar();
    const vertexNode = cameraProjectionMatrix.mul(mvPosition);
    const vView = varying(mvPosition.xyz.div(max(range, float(1e-20))));
    const colorNode = packDepthToRGBA(clamp(length(vView), float(0.0), float(0.99999)));

    return { vertexNode, colorNode, depthNode: null };
}
