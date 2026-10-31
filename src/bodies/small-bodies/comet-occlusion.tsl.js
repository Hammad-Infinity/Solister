// comet-occlusion.tsl.js — TSL port of the COMET_OCCLUSION_SHADER
// provider in src/bodies/small-bodies/comet-occlusion.js (port
// step P5e13), in the propagation-head pattern: the shader
// functions the coma/tail volume consumers share, ported before
// the consumers. The classic file's JS side (createCometOcclusion:
// nucleus-depth target management, occluder gathering from the
// registry) is renderer-generic orchestration and is not part of
// this port; the caller passes the same uniform values its
// update() computes.
//
// Mirrored production defect, deliberately preserved: the
// classic cometWriteDepth's logarithmic branch guards on
// USE_LOGDEPTHBUF / USE_LOGDEPTHBUF_EXT, which three r186 renamed
// (the P5d1 defect class; the shared chunk file was fixed there,
// this inline copy was not). Under r186 the live branch is the
// linear perspective depth, so cometOcclusionDepth below returns
// exactly that. "Fixing" it to log depth would change which
// fragments win against the scene's log depth — a behaviour
// change for its own step, not a port.
//
// Fragment coordinates: production reads gl_FragCoord (GL
// bottom-left drawing-buffer pixels) against depthViewport in the
// same convention. three's screenCoordinate is WebGPU-standard
// (top-left) on both backends, so the port converts with
// screenSize.y before applying depthViewport — same values
// production sees, on both backends.
// occluderCount is an int uniform in production; here it is a
// float compared against float(i) (small counts are exact in
// fp32, so the guard is value-identical).

import {
    Fn,
    If,
    Loop,
    all,
    array,
    bool,
    clamp,
    cross,
    dot,
    float,
    mat4,
    max,
    min,
    mix,
    screenCoordinate,
    screenSize,
    select,
    sqrt,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec4
} from "three/tsl";

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? uniform(value) : value;
}

function asBoolNode(value, fallback) {
    if (value === undefined) return bool(fallback);
    return typeof value === "boolean" ? uniform(value) : value;
}

function asVec4Node(value, fallback) {
    if (value === undefined) return vec4(fallback[0], fallback[1], fallback[2], fallback[3]);
    if (Array.isArray(value) && value.length === 4) return vec4(value[0], value[1], value[2], value[3]);
    if (value?.isVector4) return uniform(value);
    return value;
}

function asMat4Node(value) {
    if (value === undefined) {
        return mat4(
            vec4(1.0, 0.0, 0.0, 0.0),
            vec4(0.0, 1.0, 0.0, 0.0),
            vec4(0.0, 0.0, 1.0, 0.0),
            vec4(0.0, 0.0, 0.0, 1.0)
        );
    }
    if (value?.isMatrix4) return uniform(value);
    return value;
}

function asOccludersNode(value) {
    if (value === undefined) {
        // Never read while occluderCount is 0 (the classic initial
        // state), but the graph still needs an indexable array.
        return array(Array.from({ length: 12 }, () => vec4(0.0, 0.0, 0.0, 0.0)));
    }
    if (Array.isArray(value)) return uniformArray(value);
    return value;
}

// r186 packing chunk: UnpackFactors4.
const unpackRGBAToDepth = (v) => dot(v, vec4(
    255 / 256,
    (255 / 256) / 256,
    (255 / 256) / 65536,
    1 / 16777216
));

// createCometOcclusion -> { cometSphereHit, cometNucleusPixel,
// cometRayLimit, cometOcclusionDepth }, the twin of
// COMET_OCCLUSION_SHADER. Options mirror the classic uniforms:
// nucleusDepth (the packed nucleus depth texture; omitted =
// "no nucleus", as production's null), localToClip (mat4),
// depthViewport (vec4, GL-convention drawing-buffer pixels),
// depthRange, hasNucleusDepth (bool), nucleusOpacity,
// occluderCount, occluders (12 Vector4s: xyz centre, w radius,
// in the caller's local space). All options keep production's
// per-frame mutability (numbers/vectors become uniforms).
// cometOcclusionDepth(origin, direction, distanceAlong) is the
// value production's cometWriteDepth writes; consumers assign it
// to their material's depthNode.
export function createCometOcclusion(options = {}) {
    const localToClip = asMat4Node(options.localToClip);
    const depthViewport = asVec4Node(options.depthViewport, [0.0, 0.0, 1.0, 1.0]);
    const depthRange = asFloatNode(options.depthRange, 1.0);
    const hasNucleusDepth = asBoolNode(options.hasNucleusDepth, false);
    const nucleusOpacity = asFloatNode(options.nucleusOpacity, 1.0);
    const occluderCount = asFloatNode(options.occluderCount, 0.0);
    const occluders = asOccludersNode(options.occluders);
    const nucleusDepthTex = options.nucleusDepth?.isTexture
        ? texture(options.nucleusDepth)
        : (options.nucleusDepth ?? null);

    // Production: (gl_FragCoord.xy - depthViewport.xy) / depthViewport.zw
    // with gl_FragCoord in GL bottom-left pixels.
    const nucleusUv = () => vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y))
        .sub(depthViewport.xy).div(depthViewport.zw);
    const insideNucleusUv = (uvNode) => all(uvNode.greaterThanEqual(vec2(0.0, 0.0)))
        .and(all(uvNode.lessThan(vec2(1.0, 1.0))));
    const sampleNucleusDepth = (uvNode) => nucleusDepthTex
        ? nucleusDepthTex.sample(uvNode)
        : vec4(1.0, 1.0, 1.0, 1.0);

    const cometSphereHit = Fn(([origin, direction, radius]) => {
        const along = dot(origin, direction).toVar();
        const perpendicular = cross(origin, direction).toVar();
        const distanceSquared = dot(perpendicular, perpendicular).toVar();
        const discriminant = radius.mul(radius).sub(distanceSquared).toVar();
        const chord = sqrt(max(discriminant, float(0.0))).toVar();
        return select(
            discriminant.greaterThan(0.0),
            vec2(along.negate().sub(chord), along.negate().add(chord)),
            vec2(1.0, -1.0)
        );
    });

    const cometNucleusPixel = Fn(() => {
        const uvNode = nucleusUv().toVar();
        const depth = unpackRGBAToDepth(sampleNucleusDepth(uvNode));
        return hasNucleusDepth
            .and(nucleusOpacity.greaterThanEqual(0.999))
            .and(insideNucleusUv(uvNode))
            .and(depth.lessThan(0.99999));
    });

    const cometRayLimit = Fn(([origin, direction, finishIn]) => {
        const finish = finishIn.toVar();
        Loop(12, ({ i }) => {
            If(float(i).lessThan(occluderCount), () => {
                const occluder = occluders.element(i).toVar();
                const hit = cometSphereHit(
                    origin.sub(occluder.xyz), direction, occluder.w
                ).toVar();
                If(hit.y.greaterThan(0.0)
                    .and(hit.x.lessThan(finish))
                    .and(hit.y.greaterThan(hit.x)), () => {
                    finish.assign(min(finish, max(float(0.0), hit.x)));
                });
            });
        });
        If(hasNucleusDepth, () => {
            const uvNode = nucleusUv().toVar();
            If(insideNucleusUv(uvNode), () => {
                const depth = unpackRGBAToDepth(sampleNucleusDepth(uvNode)).toVar();
                If(depth.lessThan(0.99999), () => {
                    finish.assign(mix(finish, min(finish, depth.mul(depthRange)), nucleusOpacity));
                });
            });
        });
        return finish;
    });

    const cometOcclusionDepth = Fn(([origin, direction, distanceAlong]) => {
        const clip = localToClip.mul(vec4(
            origin.add(direction.mul(distanceAlong)), 1.0
        )).toVar();
        return clamp(
            clip.z.div(max(clip.w, float(0.000001))).mul(0.5).add(0.5),
            float(0.0), float(1.0)
        );
    });

    return { cometSphereHit, cometNucleusPixel, cometRayLimit, cometOcclusionDepth };
}
