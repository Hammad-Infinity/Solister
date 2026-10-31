// ring-asteroids.tsl.js — TSL port of the ring-surface
// point patch in src/bodies/rings/ring-asteroids.js
// (port step P5e19).
//
// Classic counterpart: matchingRingMaterial() clones the
// ring's lit material and rewrites it by string surgery
// (cache-key suffix |ring-surface-points-5) so the
// clone draws THREE.Points that shade exactly like the
// ring surface below them: the vertex splice propagates
// each marker's keplerian orbit (aOrbit/aMisc/aStyle
// attributes), overrides every map channel's uv with
// the marker's annulus uv, and carries the ring
// SURFACE's uv Jacobian (per screen pixel) as varyings;
// the fragment rewrites the five matched chunk samples
// (map/emissiveMap/alphaMap/roughnessMap/metalnessMap)
// to textureGrad with those derivatives, cuts the
// irregular point-sprite rock shape from gl_PointCoord,
// floors the surface alpha at 0.28 (Round-12), discards
// under 0.001, and after colourspace conversion scales
// rgb by vMarkerShade * mix(0.55, 1, surfaceAlpha). The
// marker normal is never touched (Round-14: markers
// keep the ring-plane normal, so both shadow systems
// agree on markers and ring). WebGPU has no programmable
// point size, so — as everywhere in the points family —
// the node form draws one instanced quad per marker,
// sized in clip space to the same device-pixel extent
// (the star-field pattern), and the shape is evaluated
// from the quad corner instead of gl_PointCoord. The
// factory below returns the slot nodes for the node
// standard material the caller configures like the ring
// material (the clone slot); the RingAsteroids class's
// seeded geometry build, fade/population/spin update()
// and material sync are plain JavaScript and stay
// JavaScript — deriveRingAsteroidMaterial mirrors the
// material-state overrides and initial uniform decisions
// rebuild() makes. tools/p5ringasteroids.mjs renders
// this against the production class's real patched
// material on both node backends.
//
// Composition points: any alpha modifier the ring
// material itself splices in front of opaque_fragment
// (the planet-factory ring gaps multiply diffuseColor.a
// there) folds into options.surfaceAlphaScale, which
// multiplies the pre-floor surface alpha exactly where
// the classic splice reads it. The marker uv and its
// uv-space derivatives are returned as varyings so the
// wiring can route channels this factory does not
// compose (classic overrides their uv the same way).

import {
    Fn,
    PI2,
    abs,
    atan,
    attribute,
    cameraProjectionMatrix,
    clamp,
    dot,
    float,
    length,
    mat3,
    max,
    min,
    mix,
    mod,
    modelViewMatrix,
    output,
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

function asVec2Node(value, fallback) {
    if (value === undefined) return vec2(fallback[0], fallback[1]);
    if (Array.isArray(value) && value.length === 2) return vec2(value[0], value[1]);
    if (value?.isVector2) return uniform(value);
    return value;
}

function asVec3Node(value, fallback) {
    if (value === undefined) return vec3(fallback[0], fallback[1], fallback[2]);
    if (Array.isArray(value) && value.length === 3) return vec3(value[0], value[1], value[2]);
    if (value?.isVector3 || value?.isColor) return uniform(value);
    return value;
}

function asMat3Node(value) {
    if (value === undefined) return mat3(1, 0, 0, 0, 1, 0, 0, 0, 1);
    if (value?.isMatrix3) return uniform(value);
    if (Array.isArray(value)) return mat3(...value);
    return value;
}

function asTextureNode(value) {
    if (value === undefined || value === null) return null;
    return value.isTexture ? texture(value) : value;
}

// The marker orbit angle, as the classic vertex splice
// computes it: initial phase + rate * days - ring spin,
// wrapped into [0, 2π) with GLSL mod. orbit is the
// aOrbit attribute (radius, height, phase, rate rad/day).
export const ringMarkerOrbitAngle = Fn(([orbit, days, spin]) => {
    return mod(orbit.z.add(orbit.w.mul(days)).sub(spin), PI2);
});

// The marker position in ring-local space (the ring
// geometry's xy plane, z the plane normal), exactly the
// classic splice's markerPosition.
export const ringMarkerOrbitPosition = Fn(([orbit, angle]) => {
    return vec3(
        orbit.x.mul(angle.cos()),
        orbit.x.mul(angle.sin()),
        orbit.y
    );
});

// The ring surface's uv Jacobian per screen pixel, as
// the classic splice derives it from the clip-space
// images of the local axes (clipX/clipY are
// projectionMatrix * modelViewMatrix[0/1]): inverting
// the local->pixel map gives the local displacement per
// pixel, and projecting the annulus' angular/radial uv
// axes onto it gives ∂uv/∂pixel. Returns vec4(dx, dy)
// in uv space (∂uv per pixel of screen x and y).
export const ringMarkerUvGradients = Fn(([clip, clipX, clipY, viewSize, angle, orbitRadius, ringBounds]) => {
    const pixelScale = viewSize.mul(0.5)
        .div(max(clip.w.mul(clip.w), float(1e-20))).toVar();
    const screenX = clipX.xy.mul(clip.w)
        .sub(clip.xy.mul(clipX.w)).mul(pixelScale).toVar();
    const screenY = clipY.xy.mul(clip.w)
        .sub(clip.xy.mul(clipY.w)).mul(pixelScale).toVar();
    const determinant = screenX.x.mul(screenY.y)
        .sub(screenY.x.mul(screenX.y)).toVar();
    const inverse = select(determinant.lessThan(0.0), float(-1.0), float(1.0))
        .div(max(abs(determinant), float(1e-10))).toVar();
    const localX = vec2(screenY.y, screenX.y.negate()).mul(inverse).toVar();
    const localY = vec2(screenY.x.negate(), screenX.x).mul(inverse).toVar();
    const radial = vec2(angle.cos(), angle.sin()).toVar();
    const angular = vec2(radial.y.negate(), radial.x)
        .div(PI2.mul(max(orbitRadius, float(1e-12)))).toVar();
    const radialUv = radial.div(ringBounds.y.sub(ringBounds.x)).toVar();
    const uvDx = vec2(dot(angular, localX), dot(radialUv, localX)).toVar();
    const uvDy = vec2(dot(angular, localY), dot(radialUv, localY)).toVar();
    return vec4(uvDx, uvDy);
});

// The marker rock outline: gl_PointCoord-space point in
// [-1, 1] (y down, as the classic forms it), rotated by
// shape.y, squashed in y by shape.x, and cut by the
// 3θ/5θ irregular outline. 1 at the centre falling to 0
// between 0.58 and 1.0 of the local outline radius.
export const ringMarkerShapeEdge = Fn(([markerPoint, shape]) => {
    const c = shape.y.cos().toVar();
    const s = shape.y.sin().toVar();
    const rotated = vec2(
        c.mul(markerPoint.x).sub(s.mul(markerPoint.y)),
        s.mul(markerPoint.x).add(c.mul(markerPoint.y))
    ).toVar();
    const squashed = vec2(rotated.x, rotated.y.div(shape.x)).toVar();
    const pointAngle = atan(squashed.y, squashed.x).toVar();
    const outline = float(0.91)
        .add(float(0.045).mul(pointAngle.mul(3.0).add(shape.y).sin()))
        .add(float(0.025).mul(pointAngle.mul(5.0).sub(shape.y).sin()))
        .toVar();
    return float(1.0).sub(
        smoothstep(float(0.58), float(1.0), length(squashed).div(outline)));
});

// The MATCHED_SAMPLER counterpart: an explicit-gradient
// sample (textureSampleGrad / textureGrad — the classic
// helper's GLSL-300 path, the only one WebGL2 runs).
export function ringMarkerSurfaceSample(textureNode, uvNode, gradXNode, gradYNode) {
    return textureNode.sample(uvNode).grad(gradXNode, gradYNode);
}

// Marker material factory: the node-graph counterpart of
// matchingRingMaterial's patch. Options mirror the
// classic uniform set — days [0], spin [0], fade [0],
// population / populationFeather (the class-level quality
// population when numeric, routed through
// deriveRingAsteroidMaterial with options.quality /
// options.countScale; a node passes through as the raw
// uniform), viewWidth [1920], viewHeight [1080],
// unitsPerMeter [from derive], ringBounds [from derive]
// — plus the cloned material's own parameters the patch
// rewrites samples for: color [white], opacity [1],
// emissive [black], emissiveIntensity [1],
// roughness [1], metalness [0], and per matched channel
// map/emissiveMap/alphaMap/roughnessMap/metalnessMap
// (texture or texture node) with an optional
// *MapTransform mat3 (default identity; numbers and
// vectors become uniforms, so everything update()
// rewrites per frame stays mutable).
// options.surfaceAlphaScale [1] composes ring-material
// alpha modifiers (see header).
//
// Returns the material slot nodes: positionNode and
// vertexNode (assign both), colorNode, opacityNode,
// emissiveNode / roughnessNode / metalnessNode (null
// when the classic chunk would be absent — no such map;
// leave the material's defaults then), outputNode (the
// post-colourspace shade, applied to the linear output
// exactly as production's HDR-chain rendering applies
// it), and the markerSurfaceAlpha / markerUv /
// markerUvDx / markerUvDy fragment varyings for
// channels this factory does not compose. The caller
// owns the material — production state: transparent,
// depthWrite false, depthTest true, forceSinglePass,
// side as the ring material's, and alphaTest
// derive.markerDiscardAlpha (0.001), which realises the
// classic splice's discard (production sets the chunk
// alphaTest 0; the discard is the shape splice's).
export function createRingAsteroidMarkers(options = {}) {
    const install = deriveRingAsteroidMaterial(options);
    const days = asFloatNode(options.days, install.uniforms.days);
    const spin = asFloatNode(options.spin, install.uniforms.spin);
    const fade = asFloatNode(options.fade, install.uniforms.fade);
    // Population goes through the derivation when
    // numeric/omitted so the countScale selection applies;
    // a node passes through as the raw uniform.
    const population = (options.population === undefined || typeof options.population === "number")
        ? float(install.population) : options.population;
    const populationFeather = (options.populationFeather === undefined || typeof options.populationFeather === "number")
        ? float(install.populationFeather) : options.populationFeather;
    const viewWidth = asFloatNode(options.viewWidth, install.uniforms.viewWidth);
    const viewHeight = asFloatNode(options.viewHeight, install.uniforms.viewHeight);
    const unitsPerMeter = asFloatNode(options.unitsPerMeter, install.uniforms.unitsPerMeter);
    const ringBounds = asVec2Node(options.ringBounds, install.uniforms.ringBounds);

    const color = asVec3Node(options.color, [1.0, 1.0, 1.0]);
    const opacity = asFloatNode(options.opacity, 1.0);
    const surfaceAlphaScale = asFloatNode(options.surfaceAlphaScale, 1.0);
    const emissive = asVec3Node(options.emissive, [0.0, 0.0, 0.0]);
    const emissiveIntensity = asFloatNode(options.emissiveIntensity, 1.0);
    const roughnessValue = asFloatNode(options.roughness, 1.0);
    const metalnessValue = asFloatNode(options.metalness, 0.0);

    const aOrbit = attribute("aOrbit", "vec4");
    const aMisc = attribute("aMisc", "vec4");
    const aStyle = attribute("aStyle", "vec4");

    // Vertex stage: the classic splice after void main().
    const orbitAngle = ringMarkerOrbitAngle(aOrbit, days, spin).toVar();
    const markerPosition = ringMarkerOrbitPosition(aOrbit, orbitAngle).toVar();
    const positionNode = markerPosition;

    const mvPosition = modelViewMatrix.mul(vec4(markerPosition, 1.0)).toVar();
    const clip = cameraProjectionMatrix.mul(mvPosition).toVar();
    // projectionMatrix * modelViewMatrix[0|1]: the basis
    // columns, by multiplication with the basis vectors.
    const clipX = cameraProjectionMatrix
        .mul(modelViewMatrix.mul(vec4(1.0, 0.0, 0.0, 0.0))).toVar();
    const clipY = cameraProjectionMatrix
        .mul(modelViewMatrix.mul(vec4(0.0, 1.0, 0.0, 0.0))).toVar();
    const viewSize = vec2(viewWidth, viewHeight).toVar();
    const gradients = ringMarkerUvGradients(
        clip, clipX, clipY, viewSize, orbitAngle, aOrbit.x, ringBounds).toVar();
    const markerUvValue = vec2(
        orbitAngle.div(PI2),
        clamp(aOrbit.x.sub(ringBounds.x).div(ringBounds.y.sub(ringBounds.x)), 0.0, 1.0)
    ).toVar();

    // The project_vertex splice: physical point size,
    // coverage compensation, population cutoff.
    // projectionMatrix[1][1] is column 1's y.
    const projColumnY = cameraProjectionMatrix.mul(vec4(0.0, 1.0, 0.0, 0.0)).toVar();
    const pixelsPerUnit = float(0.5).mul(projColumnY.y).mul(viewHeight).toVar();
    const physicalPixels = max(float(0.0),
        aMisc.y.mul(unitsPerMeter).mul(pixelsPerUnit)
            .div(max(float(0.0000001), mvPosition.z.negate()))).toVar();
    const pointPixels = max(physicalPixels, float(1.7)).toVar();
    const coverage = select(physicalPixels.greaterThanEqual(1.0),
        min(float(1.0), physicalPixels.mul(physicalPixels)
            .div(pointPixels.mul(pointPixels))),
        float(0.85)).toVar();
    const populationFactor = float(1.0).sub(
        smoothstep(population, population.add(populationFeather), aStyle.w)).toVar();
    const markerAlpha = aMisc.x.mul(fade).mul(populationFactor)
        .mul(coverage).mul(0.92).toVar();

    // A centre behind the eye collapses the quad, where
    // GL points are clipped (the star-field precedent).
    const sizePx = select(clip.w.greaterThan(0.0), pointPixels, float(0.0)).toVar();
    const corner = positionGeometry.xy.toVar();
    const viewport = max(viewSize, vec2(1.0, 1.0)).toVar();
    const vertexNode = vec4(
        clip.x.add(corner.x.mul(sizePx.div(viewport.x)).mul(clip.w)),
        clip.y.add(corner.y.mul(sizePx.div(viewport.y)).mul(clip.w)),
        clip.z,
        clip.w);

    const vMarkerAlpha = varying(markerAlpha);
    const vMarkerShade = varying(float(0.9).add(float(0.08).mul(aMisc.z)));
    const vMarkerShape = varying(aStyle.yz);
    const vMarkerUv = varying(markerUvValue);
    const vMarkerUvDx = varying(gradients.xy);
    const vMarkerUvDy = varying(gradients.zw);
    const vCorner = varying(corner);

    // Fragment stage. The classic's per-channel varyings
    // are constant per marker; transforming them here from
    // the shared uv-space varyings is the same arithmetic.
    const matched = (texNode, transformNode) => {
        const uvT = transformNode.mul(vec3(vMarkerUv, 1.0)).xy.toVar();
        const dxT = transformNode.mul(vec3(vMarkerUvDx, 0.0)).xy.toVar();
        const dyT = transformNode.mul(vec3(vMarkerUvDy, 0.0)).xy.toVar();
        return ringMarkerSurfaceSample(texNode, uvT, dxT, dyT);
    };

    const mapTex = asTextureNode(options.map);
    const mapSample = mapTex
        ? matched(mapTex, asMat3Node(options.mapTransform)) : null;
    const alphaMapTex = asTextureNode(options.alphaMap);
    const alphaSample = alphaMapTex
        ? matched(alphaMapTex, asMat3Node(options.alphaMapTransform)) : null;
    const emissiveTex = asTextureNode(options.emissiveMap);
    const emissiveSample = emissiveTex
        ? matched(emissiveTex, asMat3Node(options.emissiveMapTransform)) : null;
    const roughnessTex = asTextureNode(options.roughnessMap);
    const roughnessSample = roughnessTex
        ? matched(roughnessTex, asMat3Node(options.roughnessMapTransform)) : null;
    const metalnessTex = asTextureNode(options.metalnessMap);
    const metalnessSample = metalnessTex
        ? matched(metalnessTex, asMat3Node(options.metalnessMapTransform)) : null;

    // gl_PointCoord * 2 - 1 has y down; the quad corner's
    // y is up.
    const markerPoint = vec2(vCorner.x, vCorner.y.negate());
    const shapeEdge = ringMarkerShapeEdge(markerPoint, vMarkerShape).toVar();

    // diffuseColor.a as the shape splice reads it:
    // opacity * map alpha * alphaMap green * ring-material
    // alpha modifiers, then the Round-12 floor.
    let surfaceAlpha = opacity;
    if (mapSample) surfaceAlpha = surfaceAlpha.mul(mapSample.a);
    if (alphaSample) surfaceAlpha = surfaceAlpha.mul(alphaSample.g);
    surfaceAlpha = surfaceAlpha.mul(surfaceAlphaScale).toVar();
    const markerSurfaceAlpha = max(surfaceAlpha, float(0.28)).toVar();

    const diffuseRgb = mapSample ? color.mul(mapSample.rgb) : color;
    const colorNode = vec4(diffuseRgb, 1.0);
    const opacityNode = markerSurfaceAlpha.mul(shapeEdge).mul(vMarkerAlpha);
    const emissiveNode = emissiveSample
        ? emissive.mul(emissiveIntensity).mul(emissiveSample.rgb) : null;
    const roughnessNode = roughnessSample
        ? roughnessValue.mul(roughnessSample.g) : null;
    const metalnessNode = metalnessSample
        ? metalnessValue.mul(metalnessSample.b) : null;

    const shadeScale = vMarkerShade
        .mul(mix(float(0.55), float(1.0), markerSurfaceAlpha)).toVar();
    const outputNode = vec4(output.rgb.mul(shadeScale), output.a);

    return {
        positionNode,
        vertexNode,
        colorNode,
        opacityNode,
        emissiveNode,
        roughnessNode,
        metalnessNode,
        outputNode,
        markerSurfaceAlpha,
        markerUv: vMarkerUv,
        markerUvDx: vMarkerUvDx,
        markerUvDy: vMarkerUvDy
    };
}

// Instanced-quad geometry for createRingAsteroidMarkers
// from the same arrays production's rebuild() builds
// (orbits/properties/styles Float32Arrays, the measured
// outer radius and maximum |height| for the bounds —
// production's bounding sphere/box formulas). The quad
// corners carry production's point normal (0, 0, 1) —
// the untouched ring-plane normal (Round-14). The
// namespace is injected, exactly as the production
// RingAsteroids class receives it. Draw-count control is
// instanceCount (production: geometry draw range over
// the same prefix of markers).
export function createRingAsteroidQuadGeometry(T, arrays) {
    const geometry = new T.InstancedBufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(new Float32Array([
        -1, -1, 0,
        1, -1, 0,
        1, 1, 0,
        -1, 1, 0
    ]), 3));
    geometry.setAttribute("normal", new T.BufferAttribute(new Float32Array([
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1
    ]), 3));
    geometry.setAttribute("uv", new T.BufferAttribute(new Float32Array([
        0, 0,
        1, 0,
        1, 1,
        0, 1
    ]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("aOrbit", new T.InstancedBufferAttribute(arrays.orbits, 4));
    geometry.setAttribute("aMisc", new T.InstancedBufferAttribute(arrays.properties, 4));
    geometry.setAttribute("aStyle", new T.InstancedBufferAttribute(arrays.styles, 4));
    geometry.instanceCount = arrays.orbits.length / 4;
    const outer = arrays.outer;
    const maximumHeight = arrays.maximumHeight ?? 0;
    geometry.boundingSphere = new T.Sphere(new T.Vector3(), Math.hypot(outer, maximumHeight));
    geometry.boundingBox = new T.Box3(
        new T.Vector3(-outer, -outer, -maximumHeight),
        new T.Vector3(outer, outer, maximumHeight));
    return geometry;
}

const QUALITY_POPULATION = { low: 0.25, medium: 0.55, high: 1 };
const POPULATION_FEATHER = 0.025;

// Installer derivation counterpart: the material-state
// overrides of matchingRingMaterial() and the initial
// uniform values rebuild() computes. Options:
// quality ("low" | "medium" | "high") or the class-level
// population itself, countScale [the class's 0.8
// default], count (built marker count, for drawCount),
// unitsPerMeter, ringBounds [inner, outer]. The classic
// alphaTest override is 0 (chunk off) — the node
// material's alphaTest is markerDiscardAlpha instead
// (see the factory note).
export function deriveRingAsteroidMaterial(options = {}) {
    const rawScale = options.countScale === undefined ? 0.8 : options.countScale;
    const countScale = Number.isFinite(rawScale) ? Math.max(0.01, rawScale) : 1;
    const target = options.population !== undefined
        ? options.population
        : (QUALITY_POPULATION[options.quality] ?? QUALITY_POPULATION.high);
    const population = Math.min(1, target / countScale);
    const populationFeather = Math.min(1 - population, POPULATION_FEATHER / countScale);
    const count = options.count ?? null;
    const drawCount = count === null
        ? null
        : Math.min(count, Math.ceil(count * (population + populationFeather)));
    return {
        alphaTest: 0,
        markerDiscardAlpha: 0.001,
        transparent: true,
        forceSinglePass: true,
        depthWrite: false,
        depthTest: true,
        shaderTextureLOD: true,
        cacheKeySuffix: "|ring-surface-points-5",
        countScale,
        population,
        populationFeather,
        drawCount,
        uniforms: {
            days: 0,
            spin: 0,
            fade: 0,
            population,
            populationFeather,
            viewHeight: 1080,
            viewWidth: 1920,
            unitsPerMeter: options.unitsPerMeter ?? 1,
            ringBounds: options.ringBounds ? [options.ringBounds[0], options.ringBounds[1]] : [1.0, 2.0]
        }
    };
}
