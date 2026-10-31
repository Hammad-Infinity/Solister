import {
    all,
    attribute,
    cameraFar,
    cameraNear,
    cameraProjectionMatrix,
    cos,
    dot,
    equal,
    float,
    Fn,
    Loop,
    max,
    min,
    mix,
    mod,
    modelViewMatrix,
    normalize,
    positionGeometry,
    select,
    sin,
    smoothstep,
    sqrt,
    uniform,
    varying,
    viewZToLogarithmicDepth,
    vec2,
    vec3,
    vec4
} from "three/tsl";

// TSL counterparts for the three ShaderMaterials owned by
// belt-factory.js: the instanced rock mesh, the rock
// points and the focus markers, all over the belt's own
// Kepler propagation (direct aOrbit/bOrbit/aRock
// attributes, 5-iteration Newton solve -- not the packed
// smallbody-gpu head the catalogue families share).
// Catalogue seeding, the procedural rock geometry, the
// close-up standard-material rock and all CPU update/LOD
// switching stay JavaScript in belt-factory.js; the
// classic file remains the production owner until the
// flip. tools/p5beltfactory.mjs renders these factories
// against production's real createAsteroidBelt assembly
// on both node backends.
//
// The two points materials become instanced quads
// (WebGPU has no programmable point size), sized by the
// rock's physical pixel diameter with production's
// 1.7 px floor and coverage alpha, fragment-local
// coordinates replacing gl_PointCoord exactly as in the
// near-earth markers (P5e6).
//
// All three production materials depth-test in log
// depth (live LDB chunks), so all three return the
// explicit log-depth depthNode of the final view
// position unless options.logDepth is false. The caller
// owns the materials and must keep premultipliedAlpha
// false (the factory outputs production's raw shader
// convention; production's ShaderMaterials do not
// premultiply -- measured again at P5e22):
//   rocks:   transparent false, depthTest true,
//            depthWrite true;
//   points:  transparent true, depthTest true,
//            depthWrite false, normal blending;
//   markers: transparent true, depthTest true,
//            depthWrite false, normal blending.

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? float(value) : value;
}

function asVec3Node(value, fallback) {
    if (value === undefined) return vec3(fallback[0], fallback[1], fallback[2]);
    if (Array.isArray(value)) return vec3(value[0], value[1], value[2]);
    if (value?.isVector3 || value?.isColor) return uniform(value);
    return value;
}

function asVec4Node(value, fallback) {
    if (value === undefined) return vec4(fallback[0], fallback[1], fallback[2], fallback[3]);
    if (Array.isArray(value)) return vec4(value[0], value[1], value[2], value[3]);
    if (value?.isVector4) return uniform(value);
    return value;
}

function asVec2Node(value, fallback) {
    if (value === undefined) return vec2(fallback[0], fallback[1]);
    if (Array.isArray(value)) return vec2(value[0], value[1]);
    if (value?.isVector2) return uniform(value);
    return value;
}

// The belt Kepler head shared by all three materials:
// mean anomaly at uDays, the 5-iteration Newton solve,
// the perifocal rotation and production's vec3(X, Z, -Y)
// scene mapping, plus the reference-rock skip test the
// rock and rock-point vertices open with (the marker
// vertex has it stripped by production's own string
// surgery; createBeltMarkers does not apply it).
// options.days / au / skipReference / referenceOrbit
// accept numbers, arrays, THREE vectors or ready nodes
// (pass uniform nodes for the animated ones -- production
// writes uDays and uSkipReference per frame).
export function createBeltPropagation(options = {}) {
    const days = asFloatNode(options.days, 0.0);
    const au = asFloatNode(options.au, 1200.0);
    const skipReference = asFloatNode(options.skipReference, 0.0);
    const referenceOrbit = asVec4Node(options.referenceOrbit, [0.0, 0.0, 0.0, 0.0]);

    const propagateBeltBody = Fn(() => {
        const aOrbit = attribute("aOrbit", "vec4");
        const bOrbit = attribute("bOrbit", "vec4");
        const a = aOrbit.x.toVar();
        const e = aOrbit.y.toVar();
        const inc = aOrbit.z.toVar();
        const node = aOrbit.w.toVar();
        const peri = bOrbit.x.toVar();
        const M = mod(bOrbit.y.add(bOrbit.z.mul(days)), 6.28318530718).toVar();
        const E = M.toVar();
        Loop(5, () => {
            const num = E.sub(e.mul(sin(E))).sub(M).toVar();
            const den = float(1.0).sub(e.mul(cos(E))).toVar();
            E.assign(E.sub(num.div(den)));
        });
        const displayA = a.mul(au).toVar();
        const x = displayA.mul(cos(E).sub(e)).toVar();
        const y = displayA.mul(sqrt(float(1.0).sub(e.mul(e)))).mul(sin(E)).toVar();
        const cw = cos(peri).toVar();
        const sw = sin(peri).toVar();
        const co = cos(node).toVar();
        const so = sin(node).toVar();
        const ci = cos(inc).toVar();
        const si = sin(inc).toVar();
        const X = cw.mul(co).sub(sw.mul(so).mul(ci)).mul(x)
            .add(sw.mul(co).negate().sub(cw.mul(so).mul(ci)).mul(y)).toVar();
        const Y = cw.mul(so).add(sw.mul(co).mul(ci)).mul(x)
            .add(sw.mul(so).negate().add(cw.mul(co).mul(ci)).mul(y)).toVar();
        const Z = sw.mul(si).mul(x).add(cw.mul(si).mul(y)).toVar();
        return vec3(X, Z, Y.negate());
    });

    const beltSkipReference = Fn(() => {
        const aOrbit = attribute("aOrbit", "vec4");
        return skipReference.greaterThan(0.5).and(all(equal(aOrbit, referenceOrbit)));
    });

    return { propagateBeltBody, beltSkipReference, days, au, skipReference, referenceOrbit };
}

function beltPropagation(options) {
    return options.propagation?.propagateBeltBody
        ? options.propagation
        : createBeltPropagation(options.propagation || options);
}

// Instanced rocks: production's asteroidBelt
// ShaderMaterial. Each instance is the shared procedural
// rock geometry scaled by radius and the per-rock axial
// shape, rotated about Y by the (static) epoch mean
// anomaly exactly as production writes it, placed at the
// propagated centre and lit by the single sun term; the
// fragment applies production's light/light-squared mix
// to the brightness-mixed rock colour.
export function createBeltRocks(options = {}) {
    const prop = beltPropagation(options);

    const bOrbit = attribute("bOrbit", "vec4");
    const aRock = attribute("aRock", "vec4");
    const aNormal = attribute("normal", "vec3");

    const scenePosition = prop.propagateBeltBody().toVar();
    const rockRadius = max(aRock.x, float(0.0)).toVar();
    const angle = bOrbit.y.toVar();
    const ca = cos(angle).toVar();
    const sa = sin(angle).toVar();
    // Production's Y-rotation mat3 written out per
    // component (verified interchangeable with the
    // mat3 constructor form on both node backends).
    const scaledPosition = positionGeometry.mul(aRock.yzw).mul(rockRadius).toVar();
    const localVertex = vec3(
        ca.mul(scaledPosition.x).sub(sa.mul(scaledPosition.z)),
        scaledPosition.y,
        sa.mul(scaledPosition.x).add(ca.mul(scaledPosition.z))).toVar();
    const scaledNormal = aNormal.div(aRock.yzw).toVar();
    const rockNormal = normalize(vec3(
        ca.mul(scaledNormal.x).sub(sa.mul(scaledNormal.z)),
        scaledNormal.y,
        sa.mul(scaledNormal.x).add(ca.mul(scaledNormal.z)))).toVar();
    const light = float(0.025).add(float(0.975).mul(max(
        dot(rockNormal, normalize(scenePosition.negate())), float(0.0)))).toVar();

    const view = modelViewMatrix.mul(
        vec4(scenePosition.add(localVertex), 1.0)).toVar();
    // Production's mesh vertex writes the fused product
    // projectionMatrix * modelViewMatrix * vec4(...):
    // GLSL's left-associative * forms the matrix product
    // first. At belt heliocentric magnitudes (~3200
    // units) with rock-local offsets of ~2e-4, the two
    // associations round differently through the
    // cancellation-heavy transform -- whole pixels at
    // close range (measured). Mirror the association;
    // the separate view product above only feeds the
    // log-depth varying, where production reads the
    // w of this same product (ulp-level difference).
    const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(
        vec4(scenePosition.add(localVertex), 1.0)).toVar();
    const vertexNode = select(
        prop.beltSkipReference(), vec4(2.0, 2.0, 2.0, 1.0), clip);

    const vLight = varying(light);
    const vBrightness = varying(bOrbit.w);
    const vViewZ = varying(view.z);

    const rockColor = mix(
        vec3(0.16, 0.145, 0.13), vec3(0.38, 0.35, 0.31), vBrightness).toVar();
    const colorNode = vec4(
        rockColor.mul(mix(vLight, vLight.mul(vLight), float(0.65))), 1.0);

    const depthNode = options.logDepth === false
        ? null
        : viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return { vertexNode, colorNode, depthNode };
}

// Shared quad expansion for the two points slots: centre
// view position, physical pixel diameter, production's
// 1.7 px floor and coverage, clip-space corner spread
// (the P5e6 form). Returns the nodes the two fragments
// each shade differently.
function beltPointQuad(scenePosition, viewH, viewport) {
    const aRock = attribute("aRock", "vec4");
    const mv = modelViewMatrix.mul(vec4(scenePosition, 1.0)).toVar();
    const viewDepth = max(float(1e-4), mv.z.negate()).toVar();
    const rockRadius = max(aRock.x, float(0.0)).toVar();
    const focal = float(0.5).mul(cameraProjectionMatrix[1].y).mul(viewH).toVar();
    const physicalPixels = max(
        float(0.0), rockRadius.mul(2.0).mul(focal).div(viewDepth)).toVar();
    const pointPixels = max(physicalPixels, float(1.7)).toVar();
    const coverage = select(
        physicalPixels.greaterThanEqual(1.0),
        min(float(1.0), physicalPixels.mul(physicalPixels)
            .div(pointPixels.mul(pointPixels))),
        float(0.85)).toVar();

    const clip = cameraProjectionMatrix.mul(mv).toVar();
    const sizePx = select(clip.w.greaterThan(0.0), pointPixels, float(0.0)).toVar();
    const vp = max(viewport, vec2(1.0, 1.0)).toVar();
    const corner = positionGeometry.xy.toVar();
    const spread = vec4(
        clip.x.add(corner.x.mul(sizePx.div(vp.x)).mul(clip.w)),
        clip.y.add(corner.y.mul(sizePx.div(vp.y)).mul(clip.w)),
        clip.z,
        clip.w);
    return { mv, coverage, corner, spread };
}

// Rock points: production's rockPoints ShaderMaterial
// (the path the shipped update() actually displays).
// The vertex light mixes spaces exactly as production
// writes it -- normalize(-mv.xyz) against
// normalize(-scenePosition) -- mirrored, not corrected.
export function createBeltRockPoints(options = {}) {
    const prop = beltPropagation(options);
    const viewH = asFloatNode(options.viewH, 1080.0);
    const viewport = asVec2Node(options.viewport, [1.0, 1.0]);
    const bOrbit = attribute("bOrbit", "vec4");

    const scenePosition = prop.propagateBeltBody().toVar();
    const q = beltPointQuad(scenePosition, viewH, viewport);
    const light = float(0.025).add(float(0.975).mul(max(
        dot(normalize(q.mv.xyz.negate()), normalize(scenePosition.negate())),
        float(0.0)))).toVar();
    const vertexNode = select(
        prop.beltSkipReference(), vec4(2.0, 2.0, 2.0, 1.0), q.spread);

    const vLight = varying(light);
    const vBrightness = varying(bOrbit.w);
    const vCoverage = varying(q.coverage);
    const vViewZ = varying(q.mv.z);
    const vCorner = varying(q.corner);

    const dd = dot(vCorner, vCorner).toVar();
    const rockColor = mix(
        vec3(0.16, 0.145, 0.13), vec3(0.38, 0.35, 0.31), vBrightness).toVar();
    const shaded = rockColor
        .mul(mix(vLight, vLight.mul(vLight), float(0.65)))
        .mul(float(0.62).add(float(0.38).mul(
            sqrt(max(float(0.0), float(1.0).sub(dd)))))).toVar();
    const colorNode = select(
        dd.lessThanEqual(1.0),
        vec4(shaded, vCoverage),
        vec4(0.0, 0.0, 0.0, 0.0));

    const depthNode = options.logDepth === false
        ? null
        : viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return { vertexNode, colorNode, depthNode };
}

// Focus markers: production's addAsteroidMarkers
// material, which production itself derives from the
// rock vertex by string surgery -- the skip clause
// stripped, the focus-index position override in its
// place, the marker point sizing appended. The focused
// body rides uFocusPosition (production binds the belt
// target's live position vector; pass a uniform node
// over the same vector to keep the link). The fragment
// is the cyan-mixed disc with the smoothstep falloff.
export function createBeltMarkers(options = {}) {
    const prop = beltPropagation(options);
    const viewH = asFloatNode(options.viewH, 1080.0);
    const viewport = asVec2Node(options.viewport, [1.0, 1.0]);
    const focusMarker = asFloatNode(options.focusMarker, -1.0);
    const focusPosition = asVec3Node(options.focusPosition, [0.0, 0.0, 0.0]);
    const bOrbit = attribute("bOrbit", "vec4");
    const aMarkerIndex = attribute("aMarkerIndex", "float");

    const propagated = prop.propagateBeltBody().toVar();
    const focused = aMarkerIndex.sub(focusMarker).abs().lessThan(0.5).toVar();
    const markerPosition = select(focused, focusPosition, propagated).toVar();
    const q = beltPointQuad(markerPosition, viewH, viewport);
    const vertexNode = q.spread;

    const vBrightness = varying(bOrbit.w);
    const vCoverage = varying(q.coverage);
    const vViewZ = varying(q.mv.z);
    const vCorner = varying(q.corner);

    // gl_PointCoord - 0.5 is corner * 0.5 under the quad
    // mapping, so production's r is half the corner
    // length and its keep disc is |corner| <= 1.
    const r = sqrt(dot(vCorner, vCorner)).mul(0.5).toVar();
    const alpha = float(1.0).sub(smoothstep(0.12, 0.5, r))
        .mul(0.90).mul(vCoverage).toVar();
    const rockColor = mix(
        vec3(0.16, 0.145, 0.13), vec3(0.38, 0.35, 0.31), vBrightness).toVar();
    const markerColor = mix(rockColor, vec3(0.64, 0.76, 0.96), 0.82).toVar();
    const colorNode = select(
        r.lessThanEqual(0.5),
        vec4(markerColor, alpha),
        vec4(0.0, 0.0, 0.0, 0.0));

    const depthNode = options.logDepth === false
        ? null
        : viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return { vertexNode, colorNode, depthNode };
}

// Rock geometry: production's createAsteroidBelt
// assembly -- the base rock's index and attributes
// shared onto an instanced geometry plus the three
// instanced belt attributes. `base` is production's
// createProceduralRockGeometry output (or the built
// belt geometry, whose attributes are the same
// objects); `belt` carries the seeded arrays.
export function createBeltRockGeometry(T, base, belt) {
    const geometry = new T.InstancedBufferGeometry();
    if (base.index) geometry.setIndex(base.index);
    for (const [key, attr] of Object.entries(base.attributes)) {
        geometry.setAttribute(key, attr);
    }
    geometry.setAttribute("aOrbit", new T.InstancedBufferAttribute(belt.orbitA, 4));
    geometry.setAttribute("bOrbit", new T.InstancedBufferAttribute(belt.orbitB, 4));
    geometry.setAttribute("aRock", new T.InstancedBufferAttribute(belt.rockShapes, 4));
    geometry.instanceCount = belt.count;
    return geometry;
}

// Quad geometry for the two points slots: one instanced
// quad per body carrying production's belt attributes
// (rock points share the instanced arrays; markers add
// production's per-body aMarkerIndex).
function beltQuadGeometry(T, belt, withMarkerIndex) {
    const geometry = new T.InstancedBufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(new Float32Array([
        -1, -1, 0,
        1, -1, 0,
        1, 1, 0,
        -1, 1, 0
    ]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("aOrbit", new T.InstancedBufferAttribute(belt.orbitA, 4));
    geometry.setAttribute("bOrbit", new T.InstancedBufferAttribute(belt.orbitB, 4));
    geometry.setAttribute("aRock", new T.InstancedBufferAttribute(belt.rockShapes, 4));
    if (withMarkerIndex) {
        geometry.setAttribute("aMarkerIndex", new T.InstancedBufferAttribute(
            Float32Array.from({ length: belt.count }, (_, i) => i), 1));
    }
    geometry.instanceCount = belt.count;
    return geometry;
}

export function createBeltRockPointGeometry(T, belt) {
    return beltQuadGeometry(T, belt, false);
}

export function createBeltMarkerGeometry(T, belt) {
    return beltQuadGeometry(T, belt, true);
}

// Read a built production belt (the createAsteroidBelt
// mesh with its userData points/markers) into the plain
// values and material states the factories consume.
// Uniform VALUES are read, not nodes: pass uniform
// nodes over the same fields at wiring time for the
// per-frame ones (uDays, uViewH, uSkipReference,
// uFocusMarker, and uFocusPosition over the belt
// target's live position vector).
export function deriveBeltInstall(belt) {
    const uniforms = belt.material.uniforms;
    const stateOf = mesh => mesh ? {
        transparent: mesh.material.transparent,
        depthTest: mesh.material.depthTest,
        depthWrite: mesh.material.depthWrite,
        blending: mesh.material.blending,
        premultipliedAlpha: mesh.material.premultipliedAlpha
    } : null;
    const ref = uniforms.uReferenceOrbit.value;
    const markers = belt.userData.markers || null;
    return {
        belt: {
            orbitA: belt.userData.orbitAAll,
            orbitB: belt.userData.orbitBAll,
            rockShapes: belt.userData.rockShapesAll,
            count: belt.userData.orbitAAll.length / 4
        },
        focusIndex: belt.userData.focusIndex,
        uniforms: {
            days: uniforms.uDays.value,
            au: uniforms.uAU.value,
            viewH: uniforms.uViewH.value,
            skipReference: uniforms.uSkipReference.value,
            referenceOrbit: [ref.x, ref.y, ref.z, ref.w],
            focusMarker: markers ? markers.material.uniforms.uFocusMarker.value : -1
        },
        states: {
            rocks: stateOf(belt),
            points: stateOf(belt.userData.rockPoints || null),
            markers: stateOf(markers)
        }
    };
}
