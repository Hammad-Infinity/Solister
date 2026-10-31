// comet-volume.tsl.js — TSL port of the coma volume material in
// src/bodies/small-bodies/comet-volume.js (port step P5e14).
//
// Classic counterpart: one ShaderMaterial on a BackSide unit box
// (createCometVolume). The vertex carries vLocal = position; the
// fragment splices the COMET_OCCLUSION_SHADER provider (ported at
// P5e13 as comet-occlusion.tsl.js — this file consumes that proved
// provider instead of re-expressing it) and evaluates the coma
// analytically along the eye ray: atan closed-form columns for a
// 1/r coma over the dust sphere and the unit gas sphere
// (radialColumn), a 6-sample noise/sunward variation average, and
// an exponential optical-depth alpha. The factory JS (mesh,
// per-frame eye/sun updates in onBeforeRender, occlusion.update)
// is renderer-generic orchestration and is not part of this port;
// the caller passes the same uniform values it computes.
//
// Discards: production discards on the nucleus-pixel test, on
// activity/opticalDepth <= 0, on finish <= start, and on
// alpha < 0.00002. They become one keep-select emitting
// transparent black (the P5e12 pattern): a discarded fragment
// contributes nothing; an emitted alpha-0 fragment under normal
// blending with depth writes off contributes the same nothing,
// whether its written-depth test passes or fails.
//
// Depth: production writes the provider's linear perspective
// depth at the ray entry via cometWriteDepth (its log branch is
// dead under r186 — see comet-occlusion.tsl.js). The port returns
// that value as depthNode; the P5e13 rig proved a depthNode-set
// MeshBasicNodeMaterial needs no further depth configuration on
// this three build.

import {
    Fn,
    Loop,
    atan,
    cameraProjectionMatrix,
    color,
    cross,
    dFdx,
    dFdy,
    dot,
    exp,
    float,
    length,
    max,
    min,
    mix,
    modelViewMatrix,
    normalize,
    positionGeometry,
    select,
    sin,
    smoothstep,
    sqrt,
    uniform,
    varying,
    vec3,
    vec4
} from "three/tsl";
import { createCometOcclusion } from "./comet-occlusion.tsl.js";

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? uniform(value) : value;
}

function asVec3Node(value, fallback) {
    if (value === undefined) return fallback;
    if (Array.isArray(value) && value.length === 3) return vec3(value[0], value[1], value[2]);
    if (value?.isColor || value?.isVector3) return uniform(value);
    return value;
}

// createCometVolume -> { vertexNode, colorNode, depthNode }.
// Options mirror the classic uniforms (defaults are the factory's
// creation values): eye [vec3, (0,0,0)], sunDirection [(1,0,0)],
// flow [(0,0,0)], dustTint [Color 16117475], gasTint
// [Color 9689018], opticalDepth [0], activity [0], dustRadius
// [0.5], gasLength [1], gasFraction [0.12], coreRadius [5e-5];
// numbers/vectors become uniforms, so everything production
// rewrites per frame stays mutable. occlusion: a
// createCometOcclusion() provider instance (P5e13); omitted, one
// is built from options.occlusionOptions — production's wiring
// shares one provider between the coma and tail volumes.
// Caller (dual construction): transparent BackSide mesh material,
// normal blending, depthWrite false, depthTest on, toneMapped
// true — the production material state; geometry the unit box
// (BoxGeometry(2,2,2) in production), so position spans [-1,1].
export function createCometVolume(options = {}) {
    const occlusion = options.occlusion ?? createCometOcclusion(options.occlusionOptions ?? {});

    const eye = asVec3Node(options.eye, vec3(0.0, 0.0, 0.0));
    const sunDirection = asVec3Node(options.sunDirection, vec3(1.0, 0.0, 0.0));
    const flow = asVec3Node(options.flow, vec3(0.0, 0.0, 0.0));
    const dustTint = asVec3Node(options.dustTint, color(16117475));
    const gasTint = asVec3Node(options.gasTint, color(9689018));
    const opticalDepth = asFloatNode(options.opticalDepth, 0.0);
    const activity = asFloatNode(options.activity, 0.0);
    const dustRadius = asFloatNode(options.dustRadius, 0.5);
    const gasLength = asFloatNode(options.gasLength, 1.0);
    const gasFraction = asFloatNode(options.gasFraction, 0.12);
    const coreRadius = asFloatNode(options.coreRadius, 0.00005);

    const comaNoise = Fn(([point]) => {
        return float(0.5)
            .add(float(0.25)
                .mul(sin(point.x.mul(3.1).add(flow.x)))
                .mul(sin(point.y.mul(4.3).sub(flow.y))))
            .add(float(0.25)
                .mul(sin(point.z.mul(5.2).add(point.x.mul(1.7)).add(flow.z))));
    });

    const radialColumn = Fn(([origin, direction, start, finish, core, extent, lengthScale]) => {
        const along = dot(origin, direction).negate().toVar();
        const nearest = cross(origin, direction).toVar();
        const impact = length(nearest).toVar();
        const softened = sqrt(dot(nearest, nearest).add(core.mul(core))).toVar();
        const extentHit = occlusion.cometSphereHit(origin, direction, extent).toVar();
        const clippedStart = max(start, extentHit.x).toVar();
        const clippedFinish = min(finish, extentHit.y).toVar();
        const integral = atan(clippedFinish.sub(along).div(softened))
            .sub(atan(clippedStart.sub(along).div(softened)))
            .div(softened).toVar();
        const boundary = float(1.0).sub(smoothstep(extent.mul(0.65), extent, impact)).toVar();
        const column = max(float(0.0), integral)
            .mul(exp(impact.negate().div(max(float(0.005), lengthScale))))
            .mul(boundary).toVar();
        // Production returns 0 when clippedFinish <= clippedStart.
        return select(clippedFinish.greaterThan(clippedStart), column, float(0.0));
    });

    const vLocal = varying(positionGeometry);
    const mv = modelViewMatrix.mul(vec4(positionGeometry, 1.0)).toVar();

    // Shared ray values: the depthNode needs eye/direction/start
    // from the same graph the colour evaluates.
    const direction = normalize(vLocal.sub(eye)).toVar();
    const hit = occlusion.cometSphereHit(eye, direction, float(1.0)).toVar();
    const start = max(float(0.0), hit.x).toVar();
    const finish = occlusion.cometRayLimit(eye, direction, hit.y).toVar();

    const coma = Fn(() => {
        const nearest = eye.sub(direction.mul(dot(eye, direction))).toVar();
        const pixelRadius = max(length(dFdx(nearest)), length(dFdy(nearest)))
            .mul(0.45).toVar();
        const core = max(coreRadius, max(pixelRadius,
            max(dustRadius.mul(0.07), float(0.000001)))).toVar();
        const dust = radialColumn(eye, direction, start, finish, core,
            dustRadius, max(float(0.025), dustRadius.mul(0.65))).toVar();
        const gas = radialColumn(eye, direction, start, finish,
            max(core, float(0.065)), float(1.0), gasLength).toVar();
        const variation = float(0.0).toVar();
        const weight = float(0.0).toVar();
        Loop(6, ({ i }) => {
            const t = mix(start, finish, float(i).add(0.5).div(6.0)).toVar();
            const point = eye.add(direction.mul(t)).toVar();
            const sampleWeight = float(1.0).div(dot(point, point).add(0.035)).toVar();
            const sunward = dot(
                normalize(point.add(vec3(0.000001, 0.000001, 0.000001))),
                sunDirection
            ).toVar();
            variation.addAssign(sampleWeight
                .mul(float(0.94).add(comaNoise(point).mul(0.12)))
                .mul(float(1.0)
                    .add(sunward.mul(0.12))
                    .add(max(float(0.0), sunward.negate()).mul(0.08))));
            weight.addAssign(sampleWeight);
        });
        dust.mulAssign(variation.div(max(weight, float(0.000001))));
        dust.mulAssign(float(1.0).sub(gasFraction.mul(0.4)));
        gas.mulAssign(float(0.24).add(gasFraction.mul(0.85)));
        const column = dust.add(gas).toVar();
        const alpha = float(1.0).sub(exp(column.mul(opticalDepth).negate())).toVar();
        const tint = dust.mul(dustTint).add(gas.mul(gasTint))
            .div(max(column, float(0.000001))).toVar();
        const scattering = float(0.92)
            .add(max(float(0.0), dot(direction, sunDirection)).mul(0.08)).toVar();
        const keep = occlusion.cometNucleusPixel().not()
            .and(activity.greaterThan(0.0))
            .and(opticalDepth.greaterThan(0.0))
            .and(finish.greaterThan(start))
            .and(alpha.greaterThanEqual(0.00002)).toVar();
        return select(keep,
            vec4(tint.mul(scattering).mul(1.12), min(alpha, float(0.98))),
            vec4(0.0, 0.0, 0.0, 0.0));
    });

    return {
        vertexNode: cameraProjectionMatrix.mul(mv),
        colorNode: coma(),
        depthNode: occlusion.cometOcclusionDepth(eye, direction, start)
    };
}
