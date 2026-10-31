// saturn-alignment.tsl.js — TSL port of the analytic Saturn
// ring/planet mutual-shadow factors in
// src/bodies/rings/saturn-alignment.js (port step P5e18),
// in the established ring-factor pattern (P3e-P3h helpers,
// P5c17-P5c20 factory/derivation completions).
//
// Classic counterpart: SaturnAlignment installs two
// onBeforeCompile splices after lights_fragment_end.
// On the planet material, the ring's shadow: the fragment
// point (carried in ring-local space by a vertex splice)
// is ray-cast to the ring plane toward the sun, the ring
// texture's alpha is sampled at the annulus hit, and
// directDiffuse/directSpecular are scaled by
// 1 - 0.90 * alpha * step(aCutoff, alpha). On the ring
// material, the planet's shadow: the point in planet-local
// space is squashed by the ellipsoid axes, and the terms
// (plus totalEmissiveRadiance) are scaled by
// 1 - 0.95 * blocked, blocked from the smoothstepped
// impact parameter against the unit sphere. This port
// returns the two factors as nodes; applying them to the
// lit terms is the wiring's work (the ring-port
// precedent). The SaturnAlignment class's per-frame
// update() — registry walking, the matrix/sun uniform
// updates, the ring-geometry inner/outer scan — is plain
// JavaScript and stays JavaScript;
// deriveSaturnAlignmentInstall below mirrors the plain
// values it decides (radius pass-through, the permuted
// axis scaling, opacity gating by ring visibility, the
// alphaTest cutoff).
//
// aRadius is declared in the classic ring-side splice
// but never used by its effect (the axes division
// normalises the test); the option is kept for
// uniform-set parity and is unused here, as there.

import {
    Fn,
    abs,
    atan,
    cross,
    dot,
    float,
    fract,
    length,
    mat3,
    mat4,
    normalize,
    positionGeometry,
    select,
    smoothstep,
    texture,
    uniform,
    varying,
    vec2,
    vec3,
    vec4
} from "three/tsl";

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? uniform(value) : value;
}

function asVec3Node(value, fallback) {
    if (value === undefined) return vec3(fallback[0], fallback[1], fallback[2]);
    if (Array.isArray(value) && value.length === 3) return vec3(value[0], value[1], value[2]);
    if (value?.isVector3 || value?.isColor) return uniform(value);
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

function asMat3Node(value) {
    if (value === undefined) return mat3(1, 0, 0, 0, 1, 0, 0, 0, 1);
    if (value?.isMatrix3) return uniform(value);
    if (Array.isArray(value)) return mat3(...value);
    return value;
}

// The ring-plane hit for the planet-side shadow, as
// production computes it: direction toward the sun in
// ring space, plane crossing, annulus band test.
// Returns vec3(u, v, active): the pre-texture-matrix
// annulus uv and 1 when production's nested conditions
// all hold (|direction.z| > 1e-6, crossing ahead, hit
// radius inside the band), else 0 with a finite uv the
// caller may still sample harmlessly.
// Inputs: annulusPoint/sunRing in ring-local space.
export const saturnRingShadowUV = Fn(([annulusPoint, sunRing, inner, outer]) => {
    const direction = normalize(sunRing.sub(annulusPoint)).toVar();
    const distanceToPlane = annulusPoint.z.negate().div(direction.z).toVar();
    const hit = annulusPoint.add(direction.mul(distanceToPlane)).toVar();
    const radius = length(hit.xy).toVar();
    const active = abs(direction.z).greaterThan(0.000001)
        .and(distanceToPlane.greaterThan(0.0))
        .and(radius.greaterThan(inner))
        .and(radius.lessThan(outer)).toVar();
    const uv = vec2(
        fract(atan(hit.y, hit.x).div(6.28318530718)),
        radius.sub(inner).div(outer.sub(inner))
    ).toVar();
    return vec3(
        select(active, uv.x, float(0.0)),
        select(active, uv.y, float(0.0)),
        select(active, float(1.0), float(0.0))
    );
});

// The planet's shadow visibility on the ring, as
// production computes it: axes-squashed point and sun
// direction, impact parameter against the unit sphere.
// Inputs: planetPoint/sunPlanet in planet-local space.
export const saturnPlanetShadowVisibility = Fn(([planetPoint, sunPlanet, axes]) => {
    const point = planetPoint.div(axes).toVar();
    const direction = normalize(sunPlanet.sub(planetPoint).div(axes)).toVar();
    const along = dot(point, direction).toVar();
    const impact = length(cross(point, direction)).toVar();
    const blocked = float(1.0)
        .sub(smoothstep(float(0.998), float(1.002), impact))
        .mul(select(along.lessThanEqual(0.0), float(1.0), float(0.0))).toVar();
    return float(1.0).sub(blocked.mul(0.95));
});

// createSaturnAlignment -> { ringShadowTransmission,
// planetShadowVisibility }, the two factors production
// multiplies into the lit terms (diffuse+specular on the
// planet; those plus emissive on the ring). Options
// mirror SaturnAlignment's uniform set (defaults are the
// class's initial values): planetToRing / ringToPlanet
// (mat4), sunRing / sunPlanet (vec3), radius [1, unused
// as in the classic effect], axes [(1,1,1)], inner
// [1.35], outer [2.4], ringTexture (sampled for its
// alpha; omitted = alpha 0, so transmission 1),
// ringUV (mat3), opacity [1], cutoff [0.1]. Numbers and
// vectors become uniforms, so everything update()
// rewrites per frame stays mutable. The two
// point varyings are built from positionGeometry exactly
// as the classic vertex splices build them from the
// position attribute; pass options.positionLocal to use
// a different node (e.g. an already-transformed local
// position).
export function createSaturnAlignment(options = {}) {
    const install = deriveSaturnAlignmentInstall(options);
    const planetToRing = asMat4Node(options.planetToRing);
    const ringToPlanet = asMat4Node(options.ringToPlanet);
    const sunRing = asVec3Node(options.sunRing, [0.0, 0.0, 0.0]);
    const sunPlanet = asVec3Node(options.sunPlanet, [0.0, 0.0, 0.0]);
    const axes = asVec3Node(options.axes, install.axes);
    const inner = asFloatNode(options.inner, install.inner);
    const outer = asFloatNode(options.outer, install.outer);
    const ringUV = asMat3Node(options.ringUV);
    // Opacity goes through the derivation when numeric/omitted
    // so the ring-visibility gate applies; a node passes through.
    const opacity = (options.opacity === undefined || typeof options.opacity === "number")
        ? float(install.opacity) : options.opacity;
    const cutoff = asFloatNode(options.cutoff, install.cutoff);
    const ringTex = options.ringTexture?.isTexture
        ? texture(options.ringTexture)
        : (options.ringTexture ?? null);
    const positionLocal = options.positionLocal ?? positionGeometry;

    const annulusPoint = varying(planetToRing.mul(vec4(positionLocal, 1.0)).xyz);
    const hitUV = saturnRingShadowUV(annulusPoint, sunRing, inner, outer).toVar();
    const sampleUV = ringUV.mul(vec3(hitUV.xy, 1.0)).xy.toVar();
    const ringAlpha = (ringTex ? ringTex.sample(sampleUV).a : float(0.0))
        .mul(opacity).toVar();
    const shaded = float(1.0).sub(ringAlpha.mul(0.90)
        .mul(select(ringAlpha.greaterThanEqual(cutoff), float(1.0), float(0.0))));
    const ringShadowTransmission = select(
        hitUV.z.greaterThan(0.5).and(opacity.greaterThan(0.0)),
        shaded,
        float(1.0)
    );

    const planetPoint = varying(ringToPlanet.mul(vec4(positionLocal, 1.0)).xyz);
    const planetShadowVisibility = saturnPlanetShadowVisibility(
        planetPoint, sunPlanet, axes);

    return { ringShadowTransmission, planetShadowVisibility };
}

// Installer derivation counterpart: the plain values
// SaturnAlignment.update() decides — the radius
// pass-through, the ellipsoid axes scaled by
// radius / max(axes) with the [x, z, y] permutation (or
// all-radius when no reference axes exist), the ring
// band pass-through (the geometry scan itself stays
// with the caller, as there), opacity gated by ring
// visibility, and the alphaTest cutoff. The classic
// installer's program-cache keys are a classic-renderer
// concern with no node counterpart.
export function deriveSaturnAlignmentInstall(options = {}) {
    const radius = options.radius ?? 1;
    let axes = [radius, radius, radius];
    if (options.axesKm) {
        const k = radius / Math.max(...options.axesKm);
        axes = [
            options.axesKm[0] * k,
            options.axesKm[2] * k,
            options.axesKm[1] * k
        ];
    }
    return {
        radius,
        axes,
        inner: options.inner ?? 1.35,
        outer: options.outer ?? 2.4,
        opacity: options.visible === false ? 0 : (options.opacity ?? 1),
        cutoff: options.alphaTest ?? 0.1
    };
}
