import {
    Fn,
    cameraPosition,
    color,
    float,
    abs,
    clamp,
    dot,
    exp,
    length,
    max,
    min,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    smoothstep,
    uniform,
    vec3
} from "three/tsl";

// TSL counterpart of RING_SUN_FRAGMENT in ring-sun-shading.glsl.js.
//
// ringSunShadingTerms returns (direct-light factor, glow, planetshine).
// The GLSL form reads production uniforms and cameraPosition; the node form
// takes those quantities explicitly. The optical-path, front/back,
// shadow-cone opening, forward-scatter glow and planetshine falloff terms
// are unchanged. tools/p3ringsunshading.mjs renders both forms and
// compares the frames.
//
// P5c20 completion, below: the material-factory and installer-
// derivation counterparts (the P5c9 pattern). The classic
// installer binds a nine-uniform set from its options with
// nullish defaults (opacity floored at the material's own
// opacity, or 1), registers the material for per-frame
// sun/planet positions (updateRingSunShading), and applies
// the returned terms in two places: direct diffuse+specular
// multiplied by the factor (at lights_fragment_end), and
// emissive recomposed as emissive*factor + glowColor*glow +
// shineColor*shine (at emissivemap_fragment).
// createRingSunShading binds the same quantities as nodes and
// returns the pieces for the caller to compose into the same
// two slots; deriveRingSunShadingInstall mirrors the
// install-time defaulting. The classic file remains the
// production owner until the flip.
// tools/p5ringsunshading.mjs proves the factory/derivation
// half (installer behaviour captured exactly, application
// strings included).

export const ringSunOpticalPath = Fn(([axis, light, view]) => {
    return float(1.0).div(max(abs(dot(axis, light)), float(0.06)))
        .add(float(1.0).div(max(abs(dot(axis, view)), float(0.06))));
});

export const ringSunShadingTerms = Fn(([
    fragWorld, fragNormal, cameraPos, diffuseAlpha,
    sunPos, density, opacity, glowStrength,
    shinePos, shineRadius, shineStrength
]) => {
    const axis = normalize(fragNormal);
    const light = normalize(sunPos.sub(fragWorld));
    const view = normalize(cameraPos.sub(fragWorld));
    const front = smoothstep(float(-0.05), float(0.05), dot(axis, light).mul(dot(axis, view)));
    const alpha = clamp(diffuseAlpha.div(opacity), float(0.0), float(1.0));
    const transmit = exp(density.mul(alpha).mul(ringSunOpticalPath(axis, light, view)).mul(-1.0));
    const factor = mix(transmit, float(1.0), front);

    const sunward = normalize(sunPos.sub(shinePos));
    const rel = fragWorld.sub(shinePos);
    const along = dot(rel, sunward);
    const perp = length(rel.sub(sunward.mul(along)));
    const cone = smoothstep(shineRadius.mul(1.02), shineRadius.mul(1.25), perp);
    const umbra = smoothstep(shineRadius.mul(-0.5), shineRadius.mul(0.06), along);
    const open = min(float(1.0), max(cone, umbra));

    const toPlanet = shinePos.sub(fragWorld);
    const planetDist = max(length(toPlanet), shineRadius);
    const litFace = clamp(float(0.5).sub(dot(toPlanet.div(planetDist), sunward).mul(0.5)), float(0.0), float(1.0));
    const falloff = shineRadius.div(planetDist).mul(shineRadius.div(planetDist));
    const forward = max(dot(light.mul(-1.0), view), float(0.0));
    const scatter = alpha.mul(float(1.0).sub(alpha)).mul(4.0);
    const glow = open.mul(clamp(
        float(1.0).sub(front).mul(glowStrength).mul(scatter).mul(transmit).mul(forward).mul(forward),
        float(0.0), float(1.0)
    ));
    const shine = open.mul(shineStrength).mul(falloff).mul(litFace).mul(alpha).mul(float(1.0).sub(front));

    return vec3(factor, glow, shine);
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

function colorOr(value, fallbackHex) {
    if (value === undefined) return color(fallbackHex);
    if (typeof value === "number" || typeof value === "string") return color(value);
    return vec3Or(value, [1.0, 1.0, 1.0]);
}

// Installer derivation counterpart: what installRingSunShading
// decides from plain values -- the nullish defaulting of its
// options against the material (opacity falls back to the
// material opacity, then 1, floored at 0.001), with the two
// colours kept as their input spec (number/string/Color;
// production constructs THREE.Color from the same spec).
// cacheKeySuffix records the classic program-cache suffix of
// the same install (classic-only data). The sun and
// planetshine positions are not derived: production
// initialises both to the origin and updateRingSunShading
// writes the sun's and the bound body's world positions per
// frame, so the node caller passes uniform nodes for them.
export function deriveRingSunShadingInstall(options = {}) {
    return {
        density: options.density ?? 1.2,
        opacity: Math.max(0.001, options.opacity ?? options.materialOpacity ?? 1),
        glow: options.glow ?? 0.4,
        glowColor: options.glowColor ?? 16777215,
        shineRadius: options.shineRadius ?? 1,
        shine: options.shine ?? 0,
        shineColor: options.shineColor ?? 16777215,
        cacheKeySuffix: "|ring-sun-shading"
    };
}

// Options mirror the production binding: fragWorld (default
// positionWorld) and fragNormal (default normalWorld, the
// world normal the production vertex patch computes at
// begin_vertex), diffuseAlpha (the diffuseColor.a the classic
// patch reads; default 1), cameraPos (default cameraPosition,
// the GLSL builtin the helper reads), the per-frame sunPos and
// shinePos (pass uniform nodes), and the install-time scalars
// and colours defaulted exactly as the derivation records.
// The caller composes the classic application: direct
// diffuse/specular multiplied by factor; emissive as
// emissive*factor + glowLight + shineLight.
export function createRingSunShading(options = {}) {
    const install = deriveRingSunShadingInstall(options);
    const fragWorld = options.fragWorld !== undefined ? options.fragWorld : positionWorld;
    const fragNormal = options.fragNormal !== undefined ? options.fragNormal : normalWorld;
    const cameraPos = options.cameraPos !== undefined ? options.cameraPos : cameraPosition;
    const diffuseAlpha = floatOr(options.diffuseAlpha, 1.0);
    const sunPos = vec3Or(options.sunPos, [0.0, 0.0, 0.0]);
    const density = floatOr(options.density, install.density);
    // Opacity goes through the derivation when numeric/omitted so
    // the installer's 0.001 floor applies; a node passes through.
    const opacity = (options.opacity === undefined || typeof options.opacity === "number")
        ? float(install.opacity) : options.opacity;
    const glowStrength = floatOr(options.glow, install.glow);
    const glowColor = colorOr(options.glowColor, install.glowColor);
    const shinePos = vec3Or(options.shinePos, [0.0, 0.0, 0.0]);
    const shineRadius = floatOr(options.shineRadius, install.shineRadius);
    const shineStrength = floatOr(options.shine, install.shine);
    const shineColor = colorOr(options.shineColor, install.shineColor);

    const terms = ringSunShadingTerms(
        fragWorld, fragNormal, cameraPos, diffuseAlpha,
        sunPos, density, opacity, glowStrength,
        shinePos, shineRadius, shineStrength);

    return {
        terms,
        factor: terms.x,
        glowLight: glowColor.mul(terms.y),
        shineLight: shineColor.mul(terms.z),
        install
    };
}
