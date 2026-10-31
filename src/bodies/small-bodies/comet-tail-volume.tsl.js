// comet-tail-volume.tsl.js — TSL port of the tail volume
// material in src/bodies/small-bodies/comet-tail-volume.js
// (port step P5e15).
//
// Classic counterpart: one ShaderMaterial in two build
// variants (the COMET_ION_TAIL define): the blue ion tail
// (createTailVolume(..., ionTail true)) and the sunlit dust
// tail the comet-dust-fan writer builds on
// createTailVolume(..., ionTail false). The fragment sums
// closed-form erf columns of up to 24 anisotropic Gaussian
// segments (tailColumn) along the ray's box interval
// (tailBoxHit), ray-limited by the shared occlusion
// provider (ported at P5e13; consumed here, not
// re-expressed). The vertex carries vLocal = position;
// the geometry is the unit box whose positions the JS side
// rewrites to the segment bounds (fitTailBox). Everything
// CPU-side — writeTailVolume's metric/bounds derivation,
// softenIonKernel, the per-frame eye/metric-w/sun updates,
// occlusion.update and the screen mask's bitmask build
// (comet-screen-mask.js) — is renderer-generic JS and
// stays for the wiring; the caller passes the same values
// it computes.
//
// Screen mask: production runs WebGL2 (300 es), so the
// live branch is the integer one — a 24-bit candidate mask
// per 32 px tile in an R32UI texture, tested bit by bit.
// The float `#else` branch (maskBits) is unreachable in
// production and is not ported. The port reads the tile
// with a sampler-less textureLoad at the same texel the
// classic nearest sample lands on, converts to float
// (exact below 2^24) and tests bits arithmetically
// (2^i is exact in fp32): the same candidate set, summed
// in the same increasing index order as all three classic
// loops. maskViewport is GL bottom-left drawing-buffer
// pixels, so the fragment coordinate takes the same
// conversion as the provider (screenSize.y - y). Tiles
// outside the grid cannot occur while the mask viewport
// covers the canvas (production's construction); a load
// outside returns 0 (no candidates) where the classic
// clamp-to-edge sample would repeat the edge tile.
//
// Discards (nucleus pixel, opacity <= 0 / nodeCount 0,
// finish <= start — twice for ion, empty mask tile,
// alpha < 0.00003) become the one keep-select of the
// P5e12/P5e14 pattern; an empty tile needs no test of its
// own (column 0 -> alpha 0). The ion head clip narrows
// start/finish BEFORE production writes depth, so the
// returned depthNode is built from the post-clip start
// (the provider's linear value; see
// comet-occlusion.tsl.js). nodeCount is an int uniform
// in production; here a float compared against float(i)
// (exact for counts <= 24).

import {
    Fn,
    If,
    Loop,
    abs,
    cameraProjectionMatrix,
    clamp,
    color,
    dot,
    exp,
    float,
    floor,
    int,
    ivec2,
    max,
    min,
    mix,
    mod,
    modelViewMatrix,
    normalize,
    positionGeometry,
    pow,
    screenCoordinate,
    screenSize,
    select,
    sign,
    smoothstep,
    sqrt,
    texture,
    textureLoad,
    uniform,
    uniformArray,
    varying,
    vec2,
    vec3,
    vec4,
    bool
} from "three/tsl";
import { createCometOcclusion } from "./comet-occlusion.tsl.js";

const MAX_SEGMENTS = 24;

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? uniform(value) : value;
}

function asBoolNode(value, fallback) {
    if (value === undefined) return bool(fallback);
    return typeof value === "boolean" ? uniform(value) : value;
}

function asVec3Node(value, fallback) {
    if (value === undefined) return fallback;
    if (Array.isArray(value) && value.length === 3) return vec3(value[0], value[1], value[2]);
    if (value?.isColor || value?.isVector3) return uniform(value);
    return value;
}

function asVec4Node(value, fallback) {
    if (value === undefined) return fallback;
    if (Array.isArray(value) && value.length === 4) return vec4(value[0], value[1], value[2], value[3]);
    if (value?.isVector4) return uniform(value);
    return value;
}

function asVec4ArrayNode(value) {
    if (value === undefined) {
        return uniformArray(Array.from({ length: MAX_SEGMENTS }, () => vec4(0.0)));
    }
    if (Array.isArray(value)) return uniformArray(value);
    return value;
}

function asFloatArrayNode(value) {
    if (value === undefined) {
        return uniformArray(Array.from({ length: MAX_SEGMENTS }, () => 0.0));
    }
    if (Array.isArray(value) || ArrayBuffer.isView(value)) return uniformArray(value);
    return value;
}

// createCometTailVolume -> { vertexNode, colorNode, depthNode }.
// Options mirror the classic uniforms (defaults are the
// factory's creation values): ionTail [build option, false —
// selects the head clip/density, the rational alpha law and
// the core tint mix exactly where COMET_ION_TAIL does], eye
// [vec3 (0,0,0)], sunDirection [(1,0,0)], tint [white; a
// Color or vec3 — production passes the factory colour],
// coreTint [Color 5889535], brightness [ionTail ? 1.04 : 1.8],
// ionTailMix [ionTail ? 1 : 0 — the scattering mix uniform],
// opacity [0], comaRadius [0], headAxis [(1,0,0)],
// boundsMin/boundsMax [vec3 0], nodeCount [0],
// metricX/metricY/metricZ [24 Vector4s], columnScale
// [24 floats], nodeMask [the screen mask's integer
// DataTexture; omitted compiles the candidate test out —
// production's mask-disabled semantic], maskViewport
// [vec4 0], maskGrid [(1,1,32)], screenMaskEnabled [true
// when nodeMask is given]. occlusion: a
// createCometOcclusion() provider instance (P5e13);
// omitted, one is built from options.occlusionOptions.
// Numbers/vectors/arrays become uniforms, so everything
// production rewrites per frame stays mutable.
// The nodeMask texture is the mask's own DataTexture
// (RedIntegerFormat, UnsignedIntType, nearest) WITHOUT
// internalFormat set: production sets "R32UI" for the
// classic renderer, and copying that onto the node-side
// texture makes the WebGPU backend read zeros on this
// three build (measured; the WebGL node backend reads it
// either way).
// Caller (dual construction): transparent BackSide mesh
// material, normal blending, depthWrite false, depthTest
// on, toneMapped !ionTail — the production material state;
// geometry any box whose positions the caller keeps fitted
// to the segment bounds (production: the rewritten unit
// box).
export function createCometTailVolume(options = {}) {
    const occlusion = options.occlusion ?? createCometOcclusion(options.occlusionOptions ?? {});
    const ionTailBuild = !!options.ionTail;

    const eye = asVec3Node(options.eye, vec3(0.0, 0.0, 0.0));
    const sunDirection = asVec3Node(options.sunDirection, vec3(1.0, 0.0, 0.0));
    const tint = asVec3Node(options.tint, vec3(1.0, 1.0, 1.0));
    const coreTint = asVec3Node(options.coreTint, color(5889535));
    const brightness = asFloatNode(options.brightness, ionTailBuild ? 1.04 : 1.8);
    const ionTailMix = asFloatNode(options.ionTailMix, ionTailBuild ? 1.0 : 0.0);
    const opacity = asFloatNode(options.opacity, 0.0);
    const comaRadius = asFloatNode(options.comaRadius, 0.0);
    const headAxis = asVec3Node(options.headAxis, vec3(1.0, 0.0, 0.0));
    const boundsMin = asVec3Node(options.boundsMin, vec3(0.0, 0.0, 0.0));
    const boundsMax = asVec3Node(options.boundsMax, vec3(0.0, 0.0, 0.0));
    const nodeCount = asFloatNode(options.nodeCount, 0.0);
    const metricX = asVec4ArrayNode(options.metricX);
    const metricY = asVec4ArrayNode(options.metricY);
    const metricZ = asVec4ArrayNode(options.metricZ);
    const columnScale = asFloatArrayNode(options.columnScale);
    const nodeMaskTex = options.nodeMask?.isTexture
        ? texture(options.nodeMask)
        : (options.nodeMask ?? null);
    const maskViewport = asVec4Node(options.maskViewport, vec4(0.0, 0.0, 0.0, 0.0));
    const maskGrid = asVec3Node(options.maskGrid, vec3(1.0, 1.0, 32.0));
    const screenMaskEnabled = asBoolNode(options.screenMaskEnabled, !!nodeMaskTex);

    const tailBoxHit = Fn(([origin, direction]) => {
        // Classic: step(vec3(0), direction) * 2 - 1 (per axis
        // +1 where direction >= 0, else -1). Scalar selects:
        // a vector-condition select on this three build
        // collapses to all(), it is not componentwise.
        const signValue = vec3(
            select(direction.x.greaterThanEqual(0.0), float(1.0), float(-1.0)),
            select(direction.y.greaterThanEqual(0.0), float(1.0), float(-1.0)),
            select(direction.z.greaterThanEqual(0.0), float(1.0), float(-1.0))
        ).toVar();
        const inverse = vec3(1.0).div(
            signValue.mul(max(abs(direction), vec3(0.0000001)))
        ).toVar();
        const first = boundsMin.sub(origin).mul(inverse).toVar();
        const second = boundsMax.sub(origin).mul(inverse).toVar();
        const nearHit = min(first, second).toVar();
        const farHit = max(first, second).toVar();
        return vec2(
            max(max(nearHit.x, nearHit.y), nearHit.z),
            min(min(farHit.x, farHit.y), farHit.z)
        );
    });

    // Abramowitz-Stegun erf approximation, production's form.
    const tailErf = Fn(([value]) => {
        const magnitude = min(abs(value), float(7.0)).toVar();
        const t = float(1.0).div(float(1.0).add(magnitude.mul(0.3275911))).toVar();
        const polynomial = float(1.061405429).mul(t).sub(1.453152027).mul(t)
            .add(1.421413741).mul(t).sub(0.284496736).mul(t)
            .add(0.254829592).mul(t).toVar();
        return sign(value).mul(
            float(1.0).sub(polynomial.mul(exp(magnitude.mul(magnitude).negate())))
        );
    });

    const tailColumn = Fn(([origin, direction, start, finish, mx, my, mz, scale]) => {
        const point = vec3(mx.w, my.w, mz.w).toVar();
        const ray = vec3(
            dot(direction, mx.xyz), dot(direction, my.xyz), dot(direction, mz.xyz)
        ).toVar();
        const coefficient = max(dot(ray, ray), float(0.000000000001)).toVar();
        const center = dot(point, ray).negate().div(coefficient).toVar();
        const nearest = point.add(ray.mul(center)).toVar();
        const impact = dot(nearest, nearest).toVar();
        const root = sqrt(coefficient.mul(0.5)).toVar();
        const interval = tailErf(finish.sub(center).mul(root))
            .sub(tailErf(start.sub(center).mul(root))).toVar();
        const integral = sqrt(float(Math.PI).div(coefficient.mul(2.0)))
            .mul(max(float(0.0), interval))
            .mul(exp(impact.mul(-0.5))).toVar();
        let value = integral.mul(scale);
        if (ionTailBuild) {
            const headDensity = float(1.0).toVar();
            If(comaRadius.greaterThan(0.0), () => {
                const brightestPoint = origin
                    .add(direction.mul(clamp(center, start, finish))).toVar();
                headDensity.assign(smoothstep(
                    comaRadius.mul(-0.08), comaRadius.mul(0.02),
                    dot(brightestPoint, headAxis)
                ));
            });
            value = value.mul(headDensity);
        }
        // Production returns 0 when impact > 32.
        return select(impact.lessThanEqual(32.0), value, float(0.0));
    });

    const vLocal = varying(positionGeometry);
    const mv = modelViewMatrix.mul(vec4(positionGeometry, 1.0)).toVar();

    // Shared ray values: the depthNode needs the post-clip
    // start from the same graph the colour evaluates.
    const direction = normalize(vLocal.sub(eye)).toVar();
    const boxHit = tailBoxHit(eye, direction).toVar();
    const rayStart = max(float(0.0), boxHit.x).toVar();
    const rayFinish = occlusion.cometRayLimit(eye, direction, boxHit.y).toVar();

    let start = rayStart;
    let finish = rayFinish;
    let ionKeep = null;
    if (ionTailBuild) {
        // The COMET_ION_TAIL head-plane clip, verbatim order.
        const ionClip = Fn(([startIn, finishIn]) => {
            const s = startIn.toVar();
            const f = finishIn.toVar();
            const keep = float(1.0).toVar();
            If(comaRadius.greaterThan(0.0), () => {
                const rate = dot(direction, headAxis).toVar();
                const initial = dot(eye, headAxis).toVar();
                const boundary = comaRadius.mul(-0.08).toVar();
                If(abs(rate).lessThan(0.0000001), () => {
                    If(initial.lessThan(boundary), () => {
                        keep.assign(0.0);
                    });
                }).Else(() => {
                    const crossing = boundary.sub(initial).div(rate).toVar();
                    If(rate.greaterThan(0.0), () => {
                        s.assign(max(s, crossing));
                    }).Else(() => {
                        f.assign(min(f, crossing));
                    });
                });
            });
            return vec3(s, f, keep);
        });
        const clipped = ionClip(rayStart, rayFinish).toVar();
        start = clipped.x.toVar();
        finish = clipped.y.toVar();
        ionKeep = clipped.z;
    }

    const tail = Fn(() => {
        const candidates = float(16777215.0).toVar();
        if (nodeMaskTex) {
            If(screenMaskEnabled, () => {
                const fragCoord = vec2(
                    screenCoordinate.x, screenSize.y.sub(screenCoordinate.y)
                ).toVar();
                const tile = floor(
                    fragCoord.sub(maskViewport.xy).div(maskGrid.z)
                ).toVar();
                candidates.assign(float(textureLoad(nodeMaskTex, ivec2(
                    int(tile.x), int(tile.y)
                )).x));
            });
        }
        const column = float(0.0).toVar();
        Loop(MAX_SEGMENTS, ({ i }) => {
            const fi = float(i).toVar();
            const bitSet = mod(floor(candidates.div(pow(2.0, fi))), 2.0)
                .greaterThanEqual(0.5).toVar();
            If(fi.lessThan(nodeCount).and(bitSet), () => {
                column.addAssign(tailColumn(
                    eye, direction, start, finish,
                    metricX.element(i), metricY.element(i), metricZ.element(i),
                    columnScale.element(i)
                ));
            });
        });
        const opticalColumn = max(float(0.0), column.mul(opacity)).toVar();
        const alpha = (ionTailBuild
            ? opticalColumn.div(float(1.0).add(opticalColumn.div(0.68)))
            : float(1.0).sub(exp(opticalColumn.negate()))
        ).toVar();
        const forward = pow(max(float(0.0), dot(direction, sunDirection)), 3.0).toVar();
        const scattering = mix(
            float(0.9).add(forward.mul(0.45)), float(1.0), ionTailMix
        ).toVar();
        let tailColor = tint;
        if (ionTailBuild) {
            tailColor = mix(tint, coreTint,
                smoothstep(float(0.025), float(0.26), alpha).mul(0.72));
        }
        let keep = occlusion.cometNucleusPixel().not()
            .and(opacity.greaterThan(0.0))
            .and(nodeCount.greaterThan(0.0))
            .and(finish.greaterThan(start))
            .and(alpha.greaterThanEqual(0.00003));
        if (ionKeep) keep = keep.and(ionKeep.greaterThan(0.5));
        keep = keep.toVar();
        return select(keep,
            vec4(tailColor.mul(brightness).mul(scattering), min(alpha, float(0.92))),
            vec4(0.0, 0.0, 0.0, 0.0));
    });

    return {
        vertexNode: cameraProjectionMatrix.mul(mv),
        colorNode: tail(),
        depthNode: occlusion.cometOcclusionDepth(eye, direction, start)
    };
}
