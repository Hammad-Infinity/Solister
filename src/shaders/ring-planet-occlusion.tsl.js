import {
    Fn,
    cameraPosition,
    dot,
    float,
    length,
    max,
    mat3,
    positionWorld,
    sqrt,
    uniform,
    vec3
} from "three/tsl";

// TSL counterpart of RING_PLANET_OCCLUSION_GLSL in
// ring-planet-occlusion.glsl.js.
//
// The production GLSL patch discards a ring fragment when the camera ray
// reaches the planet's ellipsoid before the fragment. This node function
// returns that same boolean test, taking the camera, occluder centre,
// radius, inverse rotation and axis ratios explicitly. The ray is rotated
// into body space and squashed by the axes, after which the existing
// sphere quadratic and 0.9995 fragment-distance guard are unchanged.
// tools/p3ringplanetocclusion.mjs renders both forms and compares the
// frames (byte-exact at P3h).
//
// P5c17 completion, below: the material-factory and installer-
// derivation counterparts (the P5c9 pattern) -- createRingPlanet-
// Occlusion binds the production uniform set and built-ins around
// the helper, deriveRingPlanetOcclusionInstall mirrors what
// installRingPlanetOcclusion decides from plain values. Wiring
// note for the node caller: production *discards*, it does not
// fade; the ring materials write depth, so discard on the
// returned occluded node (e.g. If(occluded, () => Discard())).
// The registry walking and per-frame uniform updates are plain
// JavaScript and stay JavaScript; the classic file remains the
// production owner until the flip.
// tools/p5ringplanetocclusion.mjs proves the factory/derivation
// half (derivation bit-exact against the real installer).

export const ringPlanetOccluded = Fn(([
    fragWorld, cameraPos, occCenter, occRadius, occInvRot, occAxes
]) => {
    const occToFrag = fragWorld.sub(cameraPos);
    const occDist = length(occToFrag);
    const occDir = occToFrag.div(max(occDist, float(1e-12)));
    const occO = occInvRot.mul(cameraPos.sub(occCenter)).div(occAxes);
    const occD = occInvRot.mul(occDir).div(occAxes);
    const occA = dot(occD, occD);
    const occB = dot(occO, occD);
    const occC = dot(occO, occO).sub(occRadius.mul(occRadius));
    const occDiscriminant = occB.mul(occB).sub(occA.mul(occC));
    const occT = occB.mul(-1.0)
        .sub(sqrt(max(occDiscriminant, float(0.0))))
        .div(occA);

    return occDiscriminant.greaterThan(0.0)
        .and(occT.greaterThan(0.0))
        .and(occT.lessThan(occDist.mul(0.9995)));
});

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? float(value) : value;
}

function asVec3Node(value, fallback) {
    if (value === undefined) return vec3(fallback[0], fallback[1], fallback[2]);
    if (Array.isArray(value)) return vec3(value[0], value[1], value[2]);
    if (value?.isVector3 || value?.isColor) return uniform(value);
    if (value && typeof value.x === "number" && typeof value.y === "number" &&
        typeof value.z === "number" && !value.isNode) {
        return vec3(value.x, value.y, value.z);
    }
    return value;
}

function asMat3Node(value) {
    if (value === undefined) return mat3(1, 0, 0, 0, 1, 0, 0, 0, 1);
    if (value?.isMatrix3) return uniform(value);
    if (Array.isArray(value)) return mat3(...value);
    return value;
}

// Options mirror the production uniform set; pass uniform nodes
// for the per-frame ones (center, invRot). fragWorld defaults
// to positionWorld, the same value the production vertex patch
// computes from modelMatrix and the transformed position.
export function createRingPlanetOcclusion(options = {}) {
    const fragWorld = options.fragWorld !== undefined
        ? options.fragWorld : positionWorld;
    const center = asVec3Node(options.center, [0.0, 0.0, 0.0]);
    const radius = asFloatNode(options.radius, 1.0);
    const invRot = asMat3Node(options.invRot);
    const axes = asVec3Node(options.axes, [1.0, 1.0, 1.0]);

    const occluded = ringPlanetOccluded(
        fragWorld, cameraPosition, center, radius, invRot, axes);

    return { occluded };
}

// The material side effects of the classic installer, as plain
// values (pulled toward the camera so the surviving ring wins
// the depth fight against the disc limb).
export const RING_PLANET_OCCLUSION_MATERIAL_PARAMETERS = Object.freeze({
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
});

// Installer derivation counterpart: what
// installRingPlanetOcclusion decides from plain values -- the
// radius pass-through and the occluder axis ratios, with the
// same [equator, polar, equator] permutation over the km axes
// the atmosphere derivation uses. The planetKey -> axesKm
// lookup and the duplicate-install guard stay with the caller,
// as do the per-frame center/invRot updates.
export function deriveRingPlanetOcclusionInstall(options = {}) {
    const axesKm = options.axesKm;
    let axes = [1.0, 1.0, 1.0];
    if (axesKm) {
        const maxAxis = Math.max(...axesKm);
        axes = [
            axesKm[0] / maxAxis,
            axesKm[2] / maxAxis,
            axesKm[1] / maxAxis
        ];
    }
    return {
        radius: options.planetRadius,
        axes,
        materialParameters: RING_PLANET_OCCLUSION_MATERIAL_PARAMETERS
    };
}
