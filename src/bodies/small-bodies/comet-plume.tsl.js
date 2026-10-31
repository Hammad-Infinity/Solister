// comet-plume.tsl.js — TSL port of the plume ribbon material in
// src/bodies/small-bodies/comet-plume.js (port step P5e12),
// extended at P5e17 with the comet layer's jet variant (below).
//
// Classic counterpart: one ShaderMaterial over a CPU-written tube
// (createPlume builds the (segments+1) x 41 grid with uv and an
// aEmission attribute; writePlume() fills positions/normals per frame
// and rewrites the opacity uniform). The vertex carries uv,
// aEmission, the view-space normal (normalMatrix * normal) and
// vEye = -mv.xyz; the fragment fades both ends of uv.x, modulates
// by a sin() cloud streak and by pow(|NdotV|, 1.4) so the tube
// reads soft-edged, and discards below a = 0.0001. The tube
// geometry production (createPlume's grid + writePlume's frame
// maths) is plain JS and is not part of this port; the caller
// feeds the same geometry to both materials.
//
// Unlike the nucleus depth pre-pass, this material DOES carry the
// production logarithmic-depth chunks (LDB_*), so the port writes
// the matching explicit log depth (viewZToLogarithmicDepth, the
// established equivalent proved against the LDB curve by the
// star-field / marker / path-line ports).
//
// The a < 0.0001 discard becomes a keep-select emitting
// transparent black: identical under this material's normal
// blending (a discarded fragment contributes nothing; an emitted
// alpha-0 fragment blends to the same nothing) with depth writes
// off.
//
// Jet variant (port step P5e17): comet-layer.js, the plume's
// only production consumer, rewrites every plume material's
// fragment by string surgery — it declares phase and
// transmission uniforms and multiplies the alpha by
// transmission and a travelling packet factor
// 0.38 + 0.62 * pow(0.5 + 0.5 * sin((vUv.x * 7 - phase) *
// 6.2831853), 3). Production writes phase per frame (the
// day-fraction cycle plus the streamer's index share) and
// transmission from the coma optical depth and the eye
// distance. Here that surgery is the `jetPackets` build
// option (the world-trails hover precedent): the extra
// factor enters the alpha product in the surgery's order,
// ahead of opacity.

import {
    abs,
    attribute,
    cameraFar,
    cameraNear,
    cameraProjectionMatrix,
    dot,
    float,
    modelNormalMatrix,
    modelViewMatrix,
    normalGeometry,
    normalize,
    positionGeometry,
    pow,
    select,
    sin,
    smoothstep,
    uniform,
    uv,
    varying,
    vec3,
    vec4,
    viewZToLogarithmicDepth
} from "three/tsl";

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? uniform(value) : value;
}

function asVec3Node(value, fallback) {
    if (value === undefined) return vec3(fallback[0], fallback[1], fallback[2]);
    if (Array.isArray(value) && value.length === 3) return vec3(value[0], value[1], value[2]);
    if (value?.isColor || value?.isVector3) return uniform(value);
    return value;
}

// createCometPlume -> { vertexNode, colorNode, depthNode }.
// Options mirror the classic uniforms: color (classic tint; a
// Color, linear vec3, or 3-array — production passes the profile
// dustTint through createPlume's Color), opacity (classic initial
// 0; writePlume rewrites it per frame, so a number becomes a
// uniform the caller keeps updating), startFade (classic 0.003),
// and for the layer's jets: jetPackets [build option, false],
// phase [0 — the layer's creation value; it rewrites it per
// frame] and transmission [1 — the layer's creation value; the
// jet's onBeforeRender rewrites it].
// Caller (dual construction): transparent DoubleSide mesh
// material, normal blending, depthWrite false, depthTest on,
// toneMapped false — the production plume material state. The
// geometry must provide position/normal/uv/aEmission in the
// production createPlume layout.
export function createCometPlume(options = {}) {
    const tint = asVec3Node(options.color, [1.0, 1.0, 1.0]);
    const opacity = asFloatNode(options.opacity, 0.0);
    const startFade = asFloatNode(options.startFade, 0.003);
    const phase = asFloatNode(options.phase, 0.0);
    const transmission = asFloatNode(options.transmission, 1.0);

    const aEmission = attribute("aEmission", "float");
    const mvPosition = modelViewMatrix.mul(vec4(positionGeometry, 1.0)).toVar();
    const vertexNode = cameraProjectionMatrix.mul(mvPosition);
    const vUv = varying(uv());
    const vEmission = varying(aEmission);
    const vN = varying(modelNormalMatrix.mul(normalGeometry));
    const vEye = varying(mvPosition.xyz.negate());
    const vViewZ = varying(mvPosition.z);

    const fade = smoothstep(float(0.0), startFade, vUv.x)
        .mul(float(1.0).sub(smoothstep(float(0.55), float(1.0), vUv.x))).toVar();
    const cloud = float(0.65).add(float(0.35).mul(sin(
        vUv.y.mul(37.6991).add(sin(vUv.x.mul(18.0)).mul(1.3))
    ))).toVar();
    const soft = pow(abs(dot(normalize(vN), normalize(vEye))), float(1.4)).toVar();
    let a;
    if (options.jetPackets) {
        const packets = float(0.38).add(float(0.62).mul(pow(
            float(0.5).add(float(0.5).mul(sin(
                vUv.x.mul(7.0).sub(phase).mul(6.2831853)))),
            float(3.0)))).toVar();
        a = transmission.mul(packets).mul(opacity).mul(vEmission)
            .mul(fade).mul(cloud).mul(soft).mul(0.38).toVar();
    } else {
        a = opacity.mul(vEmission).mul(fade).mul(cloud).mul(soft).mul(0.38).toVar();
    }
    const colorNode = select(
        a.lessThan(0.0001),
        vec4(0.0, 0.0, 0.0, 0.0),
        vec4(tint, a)
    );
    const depthNode = viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return { vertexNode, colorNode, depthNode };
}
