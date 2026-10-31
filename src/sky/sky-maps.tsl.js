// sky-maps.tsl.js — TSL port of src/sky/sky-maps.js (port step P5e10).
//
// Classic counterpart: the Milky Way sky shell (SKY_VERT + SKY_MILKYWAY_
// FRAGMENT over the equirect unit sphere) and the three coordinate-grid
// line layers (celestial / ecliptic / galactic, LineSegments with a
// view-z discard). The band maths lives in ./procedural-milkyway.tsl.js
// (twin of the generated MILKYWAY_GLSL block).
//
// Both classic materials carry NO logarithmic-depth chunks: the shell
// pins its clip z to the far plane (SKY_VERT sets z = w) and the grid
// uses the standard transform; both therefore ride the renderer's
// linear depth exactly as in production — depthNode is null for both
// factories (the node renderers have no automatic log depth; proved
// P5e9). The classic shell fragment's output include encodes via
// three's output stage, which both renderer families apply equally.
//
// Grid label sprites in the classic file are built-in materials and stay
// untouched, as do the geometry builders (plain JS); the caller feeds
// the same geometry to both lines (LineBasicNodeMaterial + LineSegments
// on the node side, per P5e9).
//
// The classic shell fragment is milkyWayBand(vSkyDirection) * uOpacity
// with alpha 1. The grid discard (drop the fragment when the vertex is
// behind the eye, interpolated vViewZ >= 0) becomes a keep-select:
// behind-eye fragments emit transparent black, numerically identical
// under these materials' additive blending with depth writes off.

import {
    cameraProjectionMatrix,
    float,
    modelViewMatrix,
    positionGeometry,
    select,
    uniform,
    varying,
    vec3,
    vec4
} from "three/tsl";
import { createMilkyWayBand } from "./procedural-milkyway.tsl.js";

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

// createSkyMilkyWay -> { vertexNode, colorNode, depthNode: null }.
// Options: opacity (classic uOpacity; production passes milkywayOpacity
// ?? 1), plus the band options of createMilkyWayBand (toGalactic,
// rhoZero, dust — production values from createMilkyWayUniforms()).
// Caller (dual construction): opaque DoubleSide material, normal
// blending, depthWrite false, depthTest true, toneMapped false,
// renderOrder -2100 — the production shell material state.
export function createSkyMilkyWay(options = {}) {
    const uOpacity = asFloatNode(options.opacity, 1.0);
    const band = createMilkyWayBand(options);

    const mvPosition = modelViewMatrix.mul(vec4(positionGeometry, 1.0)).toVar();
    const clip = cameraProjectionMatrix.mul(mvPosition).toVar();
    const vertexNode = vec4(clip.x, clip.y, clip.w, clip.w);
    const vSkyDirection = varying(positionGeometry);
    const colorNode = vec4(band.milkyWayBand(vSkyDirection).mul(uOpacity), 1.0);

    return { vertexNode, colorNode, depthNode: null };
}

// Production grid colours (classic sRGB hex -> linear working space,
// classic Color conversion): celestial 14411508, ecliptic 15784358,
// galactic 13681650.
const GRID_CELESTIAL_LINEAR = [0.7083757798856457, 0.7912979403281553, 0.9046611743890203];

// createSkyGrid -> { vertexNode, colorNode, depthNode: null }.
// Options: color (linear vec3 / 3-array / Color; default the celestial
// grid colour), opacity (classic uOpacity 0.5 for all three layers).
// Caller (dual construction): transparent additive line material,
// depthWrite false, depthTest true, toneMapped false, renderOrder
// -1800/-1790/-1780 — the production grid material state.
export function createSkyGrid(options = {}) {
    const uColor = asVec3Node(options.color, GRID_CELESTIAL_LINEAR);
    const uOpacity = asFloatNode(options.opacity, 0.5);

    const mvPosition = modelViewMatrix.mul(vec4(positionGeometry, 1.0)).toVar();
    const vertexNode = cameraProjectionMatrix.mul(mvPosition);
    const vViewZ = varying(mvPosition.z);
    const colorNode = select(
        vViewZ.lessThan(0.0),
        vec4(uColor.mul(uOpacity), uOpacity),
        vec4(0.0, 0.0, 0.0, 0.0)
    );

    return { vertexNode, colorNode, depthNode: null };
}
