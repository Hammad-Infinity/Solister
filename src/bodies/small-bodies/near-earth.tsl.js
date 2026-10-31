import {
    attribute,
    cameraFar,
    cameraNear,
    cameraProjectionMatrix,
    dot,
    float,
    max,
    min,
    mix,
    modelViewMatrix,
    normalize,
    positionGeometry,
    select,
    sqrt,
    uniform,
    varying,
    viewZToLogarithmicDepth,
    vec2,
    vec3,
    vec4
} from "three/tsl";
import { createSmallBodyPropagation, createSmallBodyAttributes } from "./smallbody-gpu.tsl.js";

// TSL counterparts for the two GPU-propagated materials
// owned by near-earth.js: the population markers (points)
// and the instanced rock meshes, both composed over the
// ported propagation head (smallbody-gpu.tsl.js, P5e5).
// Catalogue loading, subset selection, packing, statistics
// and visibility/LOD switching stay JavaScript in
// near-earth.js / asteroid-catalog.js; the classic file
// remains the production owner until the flip.
// tools/p5nearearth.mjs renders these factories against
// the extracted production shaders on both node backends.
//
// Both materials depth-test in log depth (production
// carries the real LDB chunks), so both return the
// explicit log-depth depthNode of the final view position
// -- the marker centre, the offset rock vertex -- unless
// options.logDepth is false. Attribute buffers follow the
// P5e5 interleaved layout (WebGPU's 8 vertex-buffer
// limit); note production's repackPendulum writes
// deinterleaved per-attribute arrays, so at wiring time
// its writes must go through the packed offsets instead.

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? float(value) : value;
}

function asVec2Node(value, fallback) {
    if (value === undefined) return vec2(fallback[0], fallback[1]);
    if (Array.isArray(value)) return vec2(value[0], value[1]);
    if (value?.isVector2) return uniform(value);
    return value;
}

function asVec3Node(value, fallback) {
    if (value === undefined) return vec3(fallback[0], fallback[1], fallback[2]);
    if (Array.isArray(value)) return vec3(value[0], value[1], value[2]);
    if (value?.isVector3 || value?.isColor) return uniform(value);
    return value;
}

// Population markers: the build() ShaderMaterial of
// near-earth.js. One instanced quad per body (WebGPU has
// no programmable point size), sized by the body's
// physical pixel diameter with the 1.7 px visibility
// floor and the coverage alpha production pairs with it.
// Returns the material slot nodes; the caller owns the
// material (production settings: transparent, no depth
// write, depth test on, normal blending) and the geometry
// from createNearEarthMarkerGeometry. options.propagation
// is forwarded to createSmallBodyPropagation; km is the
// scene-units-per-kilometre scale (production:
//
// km2u(1)); viewH is the drawing-buffer height production
// writes per frame; viewport is the drawing-buffer size
// the quad sizing needs.
export function createNearEarthMarkers(options = {}) {
    const prop = createSmallBodyPropagation(options.propagation || {});
    const km = asFloatNode(options.km, 1.0);
    const viewH = asFloatNode(options.viewH, 1080.0);
    const viewport = asVec2Node(options.viewport, [1.0, 1.0]);

    const aSize = attribute("aSize", "float");
    const aColor = attribute("color", "vec3");

    const pos = prop.propagateSmallBody().toVar();
    const mv = modelViewMatrix.mul(vec4(pos, 1.0)).toVar();
    const d = max(float(1e-4), mv.z.mul(-1.0)).toVar();
    const radius = max(aSize.mul(km), float(0.0)).toVar();
    const focal = float(0.5).mul(cameraProjectionMatrix[1].y).mul(viewH).toVar();
    const physical = max(float(0.0), radius.mul(2.0).mul(focal).div(d)).toVar();
    const pointPx = max(physical, float(1.7)).toVar();
    const coverage = select(
        physical.greaterThanEqual(1.0),
        min(float(1.0), physical.mul(physical).div(pointPx.mul(pointPx))),
        float(0.85)).toVar();

    const clip = cameraProjectionMatrix.mul(mv).toVar();
    const sizePx = select(clip.w.greaterThan(0.0), pointPx, float(0.0)).toVar();
    const vp = max(viewport, vec2(1.0, 1.0)).toVar();
    const corner = positionGeometry.xy.toVar();
    const vertexNode = vec4(
        clip.x.add(corner.x.mul(sizePx.div(vp.x)).mul(clip.w)),
        clip.y.add(corner.y.mul(sizePx.div(vp.y)).mul(clip.w)),
        clip.z,
        clip.w);

    const vColor = varying(aColor);
    const vCoverage = varying(coverage);
    const vViewZ = varying(mv.z);
    const vCorner = varying(corner);

    // Fragment: production's disc profile. The discard
    // becomes a keep select emitting transparent black,
    // equivalent under normal blending with depth write
    // off. (Production's vertex also computes vLight,
    // which its fragment never reads; not reproduced.)
    const dd = dot(vCorner, vCorner).toVar();
    const shade = float(0.62).add(float(0.38).mul(
        sqrt(max(float(0.0), float(1.0).sub(dd))))).toVar();
    const colorNode = select(
        dd.lessThanEqual(1.0),
        vec4(vColor.mul(shade), vCoverage),
        vec4(0.0, 0.0, 0.0, 0.0));

    const depthNode = options.logDepth === false
        ? null
        : viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return {
        vertexNode,
        colorNode,
        depthNode
    };
}

// Marker geometry: instanced quads carrying the
// interleaved propagation attributes plus production's
// per-body colour and radius arrays, under production's
// attribute names. The namespace is injected, as the
// production class receives it.
export function createNearEarthMarkerGeometry(T, population) {
    const geometry = new T.InstancedBufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(new Float32Array([
        -1, -1, 0,
        1, -1, 0,
        1, 1, 0,
        -1, 1, 0
    ]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const attrs = createSmallBodyAttributes(T, population.packed, population.count);
    for (const name of Object.keys(attrs)) geometry.setAttribute(name, attrs[name]);
    geometry.setAttribute("color", new T.InstancedBufferAttribute(population.colors, 3));
    geometry.setAttribute("aSize", new T.InstancedBufferAttribute(population.sizes, 1));
    geometry.instanceCount = population.count;
    return geometry;
}

// Rock meshes: the buildRocks() ShaderMaterial. Each
// instance is the shared base rock geometry scaled by
// the body's radius and a fixed axial shape, placed at
// the propagated centre, lit by a single object-space
// sun term. Returns the material slot nodes; the caller
// owns the material (production settings: opaque, depth
// test on, depth write on) and the geometry from
// createNearEarthRockGeometry. Options as for the
// markers, plus the two albedo colours (production
// ROCK_COLORS).
export function createNearEarthRocks(options = {}) {
    const prop = createSmallBodyPropagation(options.propagation || {});
    const km = asFloatNode(options.km, 1.0);
    const rockColor = asVec3Node(options.rockColor, [0.36, 0.32, 0.27]);
    const innerRockColor = asVec3Node(options.innerRockColor, [0.86, 0.88, 0.93]);

    const aSize = attribute("aSize", "float");
    const aInner = attribute("aInner", "float");

    const center = prop.propagateSmallBody().toVar();
    const radius = max(aSize.mul(km), float(0.0)).toVar();
    const shape = vec3(0.88, 1.07, 1.02).toVar();
    const centreView = modelViewMatrix.mul(vec4(center, 1.0)).toVar();
    const offsetView = modelViewMatrix.mul(vec4(
        positionGeometry.mul(shape).mul(radius), 0.0)).toVar();
    const view = vec4(
        centreView.xyz.add(offsetView.xyz), centreView.w).toVar();
    const vertexNode = cameraProjectionMatrix.mul(view);

    // Production reads the raw geometry normal (no normal
    // matrix anywhere in its lighting), so read the
    // attribute directly rather than through the lit
    // materials' normal machinery.
    const aNormal = attribute("normal", "vec3");
    const light = float(0.15).add(float(0.85).mul(max(
        dot(normalize(aNormal.div(shape)), normalize(center.negate())),
        float(0.0)))).toVar();
    const vLight = varying(light);
    const vInner = varying(aInner);
    const vViewZ = varying(view.z);

    const albedo = mix(rockColor, innerRockColor, vInner).toVar();
    const colorNode = vec4(
        albedo.mul(mix(vLight, vLight.mul(vLight), float(0.65))),
        1.0);

    const depthNode = options.logDepth === false
        ? null
        : viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return {
        vertexNode,
        colorNode,
        depthNode
    };
}

// Rock geometry: production's buildRocks assembly -- the
// base rock's attributes and index on an instanced
// geometry, plus the interleaved propagation attributes
// and per-instance radius/inner flags. Production starts
// instanceCount at 0 and raises it in update(); the
// count here is the caller's to set.
//
// Production assembly defect (measured at P5e6, recorded
// for its own later step, not fixed by this port):
// buildRocks() sets the plain per-vertex BufferAttributes
// from makeAttributes() onto its InstancedBufferGeometry,
// so on the shipped classic path the element attributes
// advance per vertex and every rock vertex reads a
// different body's centre -- shard soup instead of rocks,
// presumably unnoticed because the rocks draw at all only
// for the nearest bodies. This builder (and the P5e6
// rig's classic reference, which wraps the same arrays as
// instanced attributes) implements the per-instance
// semantics the production shader and its update()
// instanceCount logic plainly intend. The Phase B wiring
// step must decide the production fix explicitly.
export function createNearEarthRockGeometry(T, base, population) {
    const geometry = new T.InstancedBufferGeometry();
    for (const [key, attribute] of Object.entries(base.attributes)) {
        geometry.setAttribute(key, attribute);
    }
    if (base.index) geometry.setIndex(base.index);
    const attrs = createSmallBodyAttributes(T, population.packed, population.count);
    for (const name of Object.keys(attrs)) geometry.setAttribute(name, attrs[name]);
    geometry.setAttribute("aSize", new T.InstancedBufferAttribute(population.sizes, 1));
    geometry.setAttribute("aInner", new T.InstancedBufferAttribute(population.inner, 1));
    geometry.instanceCount = population.count;
    return geometry;
}
