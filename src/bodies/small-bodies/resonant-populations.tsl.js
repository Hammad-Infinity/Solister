import {
    Fn,
    If,
    Loop,
    abs,
    atan,
    attribute,
    cameraFar,
    cameraNear,
    cameraProjectionMatrix,
    cos,
    dot,
    float,
    max,
    min,
    mix,
    modelViewMatrix,
    normalize,
    positionGeometry,
    select,
    sin,
    sqrt,
    uniform,
    varying,
    viewZToLogarithmicDepth,
    vec2,
    vec3,
    vec4
} from "three/tsl";
import { createSmallBodyPropagation, createSmallBodyAttributes } from "./smallbody-gpu.tsl.js";

// TSL counterparts for the four GPU-propagated materials
// owned by resonant-populations.js: the statistical swarm
// markers and rocks (per group, positioned by that file's
// own analytic solver -- Hilda 3:2 branch or trojan
// libration around Jupiter's mean longitude) and the
// catalogue markers and rocks (numbered bodies over the
// shared propagation head, smallbody-gpu.tsl.js, P5e5).
// Catalogue loading, subset selection, packing and the
// per-frame Jupiter longitude stay JavaScript in
// resonant-populations.js / asteroid-catalog.js; the
// classic file remains the production owner until the
// flip. tools/p5resonantpopulations.mjs renders these
// factories against the extracted production shaders on
// both node backends.
//
// All four materials depth-test in log depth, so each
// returns the explicit log-depth depthNode of its final
// view position unless options.logDepth is false. The
// marker vertex stages of production also compute a light
// varying their fragments never read; not reproduced.

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

// The swarm position solver: production's population
// position function. Options mirror the production swarm
// uniforms: kind (0 = Hilda branch, otherwise the trojan
// side sign), lambda and jupiterA (Jupiter's mean
// longitude and scene-unit distance, written per frame),
// days (simulation epoch; only the libration phases read
// it). The returned Fn reads the aOrbit/aExtra attributes
// (perihelion, eccentricity, inclination, node / phase,
// amplitude, branch, radius) and evaluates production's
// 6-iteration Kepler loop.
export function createResonantSwarmPropagation(options = {}) {
    const kind = asFloatNode(options.kind, 1.0);
    const lambda = asFloatNode(options.lambda, 0.0);
    const jupiterA = asFloatNode(options.jupiterA, 1.0);
    const days = asFloatNode(options.days, 0.0);

    const aOrbit = attribute("aOrbit", "vec4");
    const aExtra = attribute("aExtra", "vec4");

    const populationPosition = Fn(() => {
        const peri = aOrbit.x.toVar();
        const e = aOrbit.y.toVar();
        const inc = aOrbit.z.toVar();
        const node = aOrbit.w.toVar();
        const phase = aExtra.x.toVar();
        const amplitude = aExtra.y.toVar();
        const branch = aExtra.z.toVar();
        const a = jupiterA.toVar();
        const M = float(0.0).toVar();
        If(abs(kind).lessThan(0.5), () => {
            a.assign(a.mul(0.7631428284));
            const longitude = lambda.mul(1.5)
                .sub(peri.add(node).mul(0.5))
                .add(branch.mul(3.14159265359))
                .add(sin(days.mul(0.0000955695).add(phase)).mul(0.08)).toVar();
            M.assign(longitude.sub(peri).sub(node));
        }).Else(() => {
            const lib = amplitude.mul(
                sin(days.mul(0.0001146815).add(phase))).toVar();
            a.assign(a.mul(float(1.0).add(
                cos(days.mul(0.0001146815).add(phase)).mul(0.008))));
            M.assign(lambda.add(kind.mul(1.0471975512)).add(lib)
                .sub(peri).sub(node));
        });
        M.assign(atan(sin(M), cos(M)));
        const E = M.toVar();
        Loop(6, () => {
            E.assign(E.sub(E.sub(e.mul(sin(E))).sub(M)
                .div(float(1.0).sub(e.mul(cos(E))))));
        });
        const x = a.mul(cos(E).sub(e)).toVar();
        const y = a.mul(sqrt(float(1.0).sub(e.mul(e)))).mul(sin(E)).toVar();
        const cw = cos(peri).toVar(), sw = sin(peri).toVar();
        const co = cos(node).toVar(), so = sin(node).toVar();
        const ci = cos(inc).toVar(), si = sin(inc).toVar();
        const X = cw.mul(co).sub(sw.mul(so).mul(ci)).mul(x)
            .add(sw.negate().mul(co).sub(cw.mul(so).mul(ci)).mul(y)).toVar();
        const Y = cw.mul(so).add(sw.mul(co).mul(ci)).mul(x)
            .add(sw.negate().mul(so).add(cw.mul(co).mul(ci)).mul(y)).toVar();
        const Z = sw.mul(si).mul(x).add(cw.mul(si).mul(y)).toVar();
        return vec3(X, Z, Y.negate());
    });

    return {
        populationPosition
    };
}

// Shared marker graph: both marker materials of production
// build the same physical-pixel disc (1.7 px floor, the
// coverage pairing, the 0.62/0.38 disc profile); they
// differ only in the centre source and the alpha factor.
function buildMarkerSlots(center, radiusKm, opts) {
    const km = asFloatNode(opts.km, 1.0);
    const viewH = asFloatNode(opts.viewH, 1080.0);
    const viewport = asVec2Node(opts.viewport, [1.0, 1.0]);
    const tint = asVec3Node(opts.tint, [1.0, 1.0, 1.0]);
    const fade = asFloatNode(opts.fade, 1.0);

    const pos = center.toVar();
    const mv = modelViewMatrix.mul(vec4(pos, 1.0)).toVar();
    const d = max(float(1e-4), mv.z.mul(-1.0)).toVar();
    const radius = max(radiusKm.mul(km), float(0.0)).toVar();
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

    const vCoverage = varying(coverage);
    const vViewZ = varying(mv.z);
    const vCorner = varying(corner);

    const dd = dot(vCorner, vCorner).toVar();
    const shade = float(0.62).add(float(0.38).mul(
        sqrt(max(float(0.0), float(1.0).sub(dd))))).toVar();
    const colorNode = select(
        dd.lessThanEqual(1.0),
        vec4(tint.mul(shade), fade.mul(vCoverage)),
        vec4(0.0, 0.0, 0.0, 0.0));

    const depthNode = opts.logDepth === false
        ? null
        : viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return {
        vertexNode,
        colorNode,
        depthNode
    };
}

function quadCornerAttribute(T) {
    return new T.BufferAttribute(new Float32Array([
        -1, -1, 0,
        1, -1, 0,
        1, 1, 0,
        -1, 1, 0
    ]), 3);
}

// Swarm markers: one instanced quad per synthetic body,
// centred by the swarm solver, radius aExtra.w, alpha the
// coverage times the group fade (production writes 0.55).
// Returns the material slot nodes; the caller owns the
// material (production settings: transparent, no depth
// write, depth test on) and the geometry from
// createResonantSwarmMarkerGeometry. options.swarm is
// forwarded to createResonantSwarmPropagation.
export function createResonantSwarmMarkers(options = {}) {
    const swarm = createResonantSwarmPropagation(options.swarm || {});
    return buildMarkerSlots(
        swarm.populationPosition(),
        attribute("aExtra", "vec4").w,
        { ...options, fade: asFloatNode(options.fade, 0.55) });
}

// Swarm marker geometry: instanced quads carrying the
// swarm orbit/extra arrays under production's attribute
// names.
export function createResonantSwarmMarkerGeometry(T, population) {
    const geometry = new T.InstancedBufferGeometry();
    geometry.setAttribute("position", quadCornerAttribute(T));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("aOrbit", new T.InstancedBufferAttribute(population.orbits, 4));
    geometry.setAttribute("aExtra", new T.InstancedBufferAttribute(population.extra, 4));
    geometry.instanceCount = population.count;
    return geometry;
}

// Catalogue markers: the same disc over propagation-head
// centres, radius aSize, alpha the coverage alone (the
// catalogue material carries no fade). options.propagation
// is forwarded to createSmallBodyPropagation.
export function createResonantCatalogMarkers(options = {}) {
    const prop = createSmallBodyPropagation(options.propagation || {});
    return buildMarkerSlots(
        prop.propagateSmallBody(),
        attribute("aSize", "float"),
        options);
}

// Catalogue marker geometry: instanced quads carrying the
// interleaved propagation attributes (P5e5 layout) plus
// the per-body radius array.
export function createResonantCatalogMarkerGeometry(T, population) {
    const geometry = new T.InstancedBufferGeometry();
    geometry.setAttribute("position", quadCornerAttribute(T));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const attrs = createSmallBodyAttributes(T, population.packed, population.count);
    for (const name of Object.keys(attrs)) geometry.setAttribute(name, attrs[name]);
    geometry.setAttribute("aSize", new T.InstancedBufferAttribute(population.sizes, 1));
    geometry.instanceCount = population.count;
    return geometry;
}

// Shared rock graph: both rock materials place the base
// rock at the centre with a view-space offset and the
// single object-space sun term; they differ in the centre
// source and the axial shape (per-phase for the swarm,
// fixed for the catalogue).
function buildRockSlots(center, radiusKm, shape, opts) {
    const km = asFloatNode(opts.km, 1.0);
    const rockColor = asVec3Node(opts.rockColor, [0.36, 0.32, 0.27]);

    const c = center.toVar();
    const radius = max(radiusKm.mul(km), float(0.0)).toVar();
    const shp = shape.toVar();
    const centreView = modelViewMatrix.mul(vec4(c, 1.0)).toVar();
    const offsetView = modelViewMatrix.mul(vec4(
        positionGeometry.mul(shp).mul(radius), 0.0)).toVar();
    const view = vec4(
        centreView.xyz.add(offsetView.xyz), centreView.w).toVar();
    const vertexNode = cameraProjectionMatrix.mul(view);

    // Production reads the raw geometry normal (no normal
    // matrix anywhere in its lighting), as in the
    // near-earth rocks.
    const aNormal = attribute("normal", "vec3");
    const light = float(0.15).add(float(0.85).mul(max(
        dot(normalize(aNormal.div(shp)), normalize(c.negate())),
        float(0.0)))).toVar();
    const vLight = varying(light);
    const vViewZ = varying(view.z);

    const colorNode = vec4(
        rockColor.mul(mix(vLight, vLight.mul(vLight), float(0.65))),
        1.0);

    const depthNode = opts.logDepth === false
        ? null
        : viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return {
        vertexNode,
        colorNode,
        depthNode
    };
}

// Swarm rocks: base rock at the swarm-solver centre,
// axial shape varied per body by its phase (aExtra.x).
// The caller owns the material (production: opaque, depth
// test on) and the geometry from
// createResonantSwarmRockGeometry.
export function createResonantSwarmRocks(options = {}) {
    const swarm = createResonantSwarmPropagation(options.swarm || {});
    const aExtra = attribute("aExtra", "vec4");
    const s = aExtra.x.toVar();
    const shape = vec3(
        float(0.88).add(sin(s).mul(0.24)),
        float(1.07).add(cos(s.mul(1.7)).mul(0.24)),
        float(1.02).add(sin(s.mul(2.3)).mul(0.24)));
    return buildRockSlots(swarm.populationPosition(), aExtra.w, shape, options);
}

// Swarm rock geometry: the base rock's attributes and
// index on an instanced geometry, plus the swarm
// orbit/extra arrays. Production starts instanceCount at
// 0 and raises it in update(); the count here is the
// caller's to set.
export function createResonantSwarmRockGeometry(T, base, population) {
    const geometry = new T.InstancedBufferGeometry();
    for (const [key, attribute] of Object.entries(base.attributes)) {
        geometry.setAttribute(key, attribute);
    }
    if (base.index) geometry.setIndex(base.index);
    geometry.setAttribute("aOrbit", new T.InstancedBufferAttribute(population.orbits, 4));
    geometry.setAttribute("aExtra", new T.InstancedBufferAttribute(population.extra, 4));
    geometry.instanceCount = population.count;
    return geometry;
}

// Catalogue rocks: base rock at the propagated centre
// with production's fixed axial shape.
export function createResonantCatalogRocks(options = {}) {
    const prop = createSmallBodyPropagation(options.propagation || {});
    return buildRockSlots(
        prop.propagateSmallBody(),
        attribute("aSize", "float"),
        vec3(0.88, 1.07, 1.02),
        options);
}

// Catalogue rock geometry: the base rock plus the
// interleaved propagation attributes and radius array.
//
// Production assembly defect (the P5e6 near-earth one,
// repeated here): buildCatalogLayers() sets the plain
// per-vertex makeAttributes() results onto its
// InstancedBufferGeometry, so on the shipped classic path
// every rock vertex reads a different body's centre. This
// builder (and the P5e7 rig's classic reference, same
// wrapping as P5e6) implements the intended per-instance
// semantics; the production fix is decided at wiring.
export function createResonantCatalogRockGeometry(T, base, population) {
    const geometry = new T.InstancedBufferGeometry();
    for (const [key, attribute] of Object.entries(base.attributes)) {
        geometry.setAttribute(key, attribute);
    }
    if (base.index) geometry.setIndex(base.index);
    const attrs = createSmallBodyAttributes(T, population.packed, population.count);
    for (const name of Object.keys(attrs)) geometry.setAttribute(name, attrs[name]);
    geometry.setAttribute("aSize", new T.InstancedBufferAttribute(population.sizes, 1));
    geometry.instanceCount = population.count;
    return geometry;
}
