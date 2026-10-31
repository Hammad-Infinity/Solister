import {
    Fn,
    float,
    positionWorld,
    uniform,
    vec3
} from "three/tsl";
import { solarVisibility } from "./eclipse.tsl.js";

// TSL counterpart of ring-particle-shadow.glsl.js's shadow factor.
//
// The production patch contains no separate shadow arithmetic: it binds the
// ringed planet into the Eclipse helper's occluder uniforms
// (uEclipseMoon = planet centre, uEclipseMoonRadius = planet radius) and
// multiplies direct light / outgoing light by solarVisibility(particle).
// This wrapper keeps that exact usage mapping as one named node function so
// ring materials do not each re-derive which body is the occluder.
//
// tools/p3ringparticleshadow.mjs compares it against the production GLSL
// binding (ECLIPSE_GLSL with the planet in the occluder uniforms).
//
// P5c19 completion, below: the material-factory and installer-
// derivation counterparts (the P5c9 pattern). The classic
// installer owns no arithmetic beyond the binding: the planet
// goes into the Eclipse occluder uniforms (centre initialised
// from the body's world position, radius from its geometry),
// the sun side stays the shared global eclipseUniforms objects,
// and the visibility multiplies either direct diffuse+specular
// (mesh mode, at lights_fragment_end) or outgoing light and
// alpha (marker mode, at opaque_fragment; no current caller
// selects it). Per frame, updateRingParticleShadows refreshes
// each binding's planet centre. createRingParticleShadow
// binds the same quantities as nodes and returns the
// visibility for the caller to multiply into the matching
// slot; deriveRingParticleShadowInstall mirrors the
// install-time decisions. The classic file remains the
// production owner until the flip.
// tools/p5ringparticleshadow.mjs proves the factory/derivation
// half (installer behaviour captured exactly, incl. which
// output each mode writes).

export const ringParticleShadowFactor = Fn(([particleWorld, planet, sun, planetRadius, sunRadius]) => {
    return solarVisibility(particleWorld, planet, sun, planetRadius, sunRadius);
});

function floatOr(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? float(value) : value;
}

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

// Installer derivation counterpart: what
// installRingParticleShadow decides from plain values -- the
// occluder radius taken from the planet geometry, the
// install-time centre snapshot (refreshed per frame by
// updateRingParticleShadows), and the mode selection. The
// application names which classic output the visibility
// multiplies ("direct" = direct diffuse+specular at
// lights_fragment_end; "outgoing" = outgoing light and alpha
// at opaque_fragment), and cacheKey records the classic
// program-cache key of the same selection. The sun side is
// not derived here: production binds the shared global
// eclipse uniform objects themselves, so the node caller
// passes the shared eclipse uniform nodes.
export function deriveRingParticleShadowInstall(options = {}) {
    const isMarker = !!options.isMarker;
    return {
        planetRadius: options.planetRadius,
        planetPosition: options.planetPosition !== undefined
            ? options.planetPosition : [0.0, 0.0, 0.0],
        isMarker,
        application: isMarker ? "outgoing" : "direct",
        cacheKey: isMarker ? "ring-marker-eclipse" : "ring-mesh-eclipse"
    };
}

// Options mirror the production binding: particleWorld
// (default positionWorld, the value the production vertex
// patch computes, including its instancing branch when the
// geometry is instanced -- pass an explicit varying then),
// planetCenter and sun (per-frame; pass uniform nodes -- the
// sun pair should be the shared eclipse uniforms), and the
// two radii (0, the classic uniform initial value, yields the
// helper's unshadowed early-out).
export function createRingParticleShadow(options = {}) {
    const particleWorld = options.particleWorld !== undefined
        ? options.particleWorld : positionWorld;
    const planetCenter = vec3Or(options.planetCenter, [0.0, 0.0, 0.0]);
    const sun = vec3Or(options.sun, [0.0, 0.0, 0.0]);
    const planetRadius = floatOr(options.planetRadius, 0.0);
    const sunRadius = floatOr(options.sunRadius, 0.0);
    const install = deriveRingParticleShadowInstall(options);

    const visibility = ringParticleShadowFactor(
        particleWorld, planetCenter, sun, planetRadius, sunRadius);

    return { visibility, install };
}
