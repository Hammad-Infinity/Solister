import { Fn, float, dot, length, mix, normalize, positionWorld, select, uniform, vec3 } from "three/tsl";

// TSL counterpart of MOON_EARTH_SHADOW_GLSL in moon-shadow.glsl.js.
//
// Production's Moon patch treats the Sun as sitting at the world origin, so
// the Earth-to-Sun direction is normalize(-earthPos); the shadow is the
// cylinder behind Earth along that axis, darkening direct diffuse light to
// 0.08 inside it. Keep that exact production semantics here;
// tools/p3moonshadow.mjs renders both forms and compares the frames.

export const moonEarthShadowFactor = Fn(([fragWorld, earthPos, earthRadius]) => {
    const fragFromEarth = fragWorld.sub(earthPos);
    const earthToSun = normalize(earthPos.mul(-1.0));
    const alongSun = dot(fragFromEarth, earthToSun);
    const perp = fragFromEarth.sub(earthToSun.mul(alongSun));
    const earthShadow = select(
        alongSun.lessThan(0.0).and(length(perp).lessThan(earthRadius)),
        float(1.0),
        float(0.0)
    );
    return mix(float(1.0), float(0.08), earthShadow);
});

// P5e20: the material application, completing the
// counterpart. Production's setupMaterialEffects patch
// carries the world position from the vertex stage as
// (modelMatrix * vec4(position, 1.0)).xyz — in node
// materials that is the built-in positionWorld varying —
// and after the lighting accumulation multiplies only
// direct diffuse by the factor above. The factory returns
// that application in the createSatelliteEclipse form;
// the JS that prepares the userData uniform slots and
// writes the Earth position per frame stays JavaScript.

function asVec3Node(value, fallback) {
    if (value === undefined) return vec3(fallback[0], fallback[1], fallback[2]);
    if (Array.isArray(value) && value.length === 3) return vec3(value[0], value[1], value[2]);
    if (value?.isVector3 || value?.isColor) return uniform(value);
    return value;
}

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? uniform(value) : value;
}

// Options mirror the production uniform slots: earthPos
// [the initial (0, 0, 0)], earthRadius (setup reads it
// from the Earth geometry; pass it here), and
// worldPosition to evaluate at a node other than the
// fragment's own world position. Numbers and vectors
// become uniforms.
export function createMoonEarthShadow(options = {}) {
    const install = deriveMoonEarthShadowInstall(options);
    const earthPos = asVec3Node(options.earthPos, install.earthPos);
    const earthRadius = asFloatNode(options.earthRadius, install.earthRadius);
    const worldPosition = options.worldPosition ?? positionWorld;

    const moonEarthShadowVisibility = Fn(([fragWorld]) => {
        return moonEarthShadowFactor(fragWorld, earthPos, earthRadius);
    });

    const moonEarthShadowApply = Fn(([fragWorld, directDiffuse]) => {
        return directDiffuse.mul(moonEarthShadowVisibility(fragWorld));
    });

    // The production-shaped entry: the receiver is the
    // fragment's own world position, as the classic
    // patch's vertex varying carries it.
    const moonEarthShadowApplyAtPositionWorld = Fn(([directDiffuse]) => {
        return moonEarthShadowApply(worldPosition, directDiffuse);
    });

    return {
        moonEarthShadowVisibility,
        moonEarthShadowApply,
        moonEarthShadowApplyAtPositionWorld
    };
}

// Installer derivation counterpart: the uniform slots
// setupMaterialEffects prepares on the Moon material —
// the Earth radius read from the Earth geometry (a
// pass-through here) and the Earth position slot's
// initial value (the frame loop writes the live position
// into the same object every frame).
export function deriveMoonEarthShadowInstall(options = {}) {
    return {
        earthPos: [0, 0, 0],
        earthRadius: options.earthRadius ?? 0
    };
}
