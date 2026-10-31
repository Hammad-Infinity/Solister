import {
    cameraFar,
    cameraNear,
    cameraProjectionMatrix,
    clamp,
    exp,
    float,
    length,
    max,
    mix,
    modelViewMatrix,
    positionGeometry,
    select,
    smoothstep,
    uniform,
    varying,
    viewZToLogarithmicDepth,
    vec2,
    vec3,
    vec4
} from "three/tsl";

// TSL counterpart for the per-body glow marker material
// owned by body-glow-markers.js. Production creates one
// single-vertex Points object per body: the vertex sets
// the point size from a pixel uniform, and the fragment
// draws a core/halo/colour-glow radial profile over the
// point coordinate. All placement logic -- surface point
// toward the camera, pixel diameter, opacity easing,
// ellipsoid occlusion between bodies, parent-marker
// overlap and edge/focused fades -- is plain JavaScript
// in BodyGlowMarkers.update() and stays JavaScript; it
// writes the mesh position and the opacity/pixel uniforms
// per frame, and after wiring will write the uniform
// nodes instead. The classic file remains the production
// owner until the flip. tools/p5bodymarkers.mjs renders
// this against the extracted production shaders on both
// node backends.
//
// Form: WebGPU has no programmable point size, so each
// marker becomes a single quad sized in clip space to
// the same device-pixel extent (the P5e2/P5e3 pattern),
// collapsed when its centre is behind the eye. Depth:
// production's shaders carry the real log-depth chunks,
// whose fragment depth derives from the clip w of the
// point centre; the port returns the explicit log-depth
// depthNode of the marker centre, the same value, unless
// options.logDepth is false for a renderer without the
// buffer.

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

// One body's glow marker: the create() ShaderMaterial of
// body-glow-markers.js. Returns the material slot nodes;
// the caller owns the material (production settings:
// transparent, no depth write, depth test on, normal
// blending, tone mapping off, renderOrder 5, frustumCulled
// false) and the shared quad geometry from
// createBodyGlowMarkerQuadGeometry below. Options mirror
// the production uniforms -- opacity and pixels are the
// per-frame writes of BodyGlowMarkers.update() (pixels is
// already in device pixels, max(1, cssPixels * dpr));
// tint is the per-body colour (pass the same THREE.Color
// production builds from its hex table -- both sides feed
// the colour-managed linear components); viewport is the
// drawing-buffer size the quad sizing needs.
export function createBodyGlowMarker(options = {}) {
    const opacity = asFloatNode(options.opacity, 0.0);
    const pixels = asFloatNode(options.pixels, 1.0);
    const tint = asVec3Node(options.tint, [1.0, 1.0, 1.0]);
    const viewport = asVec2Node(options.viewport, [1.0, 1.0]);

    // Vertex stage: the quad is centred on the mesh origin,
    // which production places at the body's camera-facing
    // surface point.
    const mv = modelViewMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).toVar();
    const clip = cameraProjectionMatrix.mul(mv).toVar();
    const sizePx = select(clip.w.greaterThan(0.0), pixels, float(0.0)).toVar();
    const vp = max(viewport, vec2(1.0, 1.0)).toVar();
    const corner = positionGeometry.xy.toVar();
    const vertexNode = vec4(
        clip.x.add(corner.x.mul(sizePx.div(vp.x)).mul(clip.w)),
        clip.y.add(corner.y.mul(sizePx.div(vp.y)).mul(clip.w)),
        clip.z,
        clip.w);

    const vCorner = varying(corner);
    const vViewZ = varying(mv.z);

    // Fragment stage: production's profile over the point
    // coordinate, the quad corner being the same
    // coordinate at twice the scale. Both discards
    // (outside the disc, alpha floor) become a keep select
    // emitting transparent black, equivalent under normal
    // blending with depth write off.
    const r = length(vCorner).mul(0.5).toVar();
    const core = float(1.0).sub(smoothstep(float(0.07), float(0.17), r)).toVar();
    const halo = float(0.22).mul(exp(r.mul(r).mul(-16.0)))
        .mul(float(1.0).sub(smoothstep(float(0.35), float(0.5), r))).toVar();
    const colorGlow = float(0.14).mul(exp(r.mul(r).mul(-8.0)))
        .mul(float(1.0).sub(smoothstep(float(0.38), float(0.5), r))).toVar();
    const alpha = clamp(core.add(halo).add(colorGlow), float(0.0), float(1.0))
        .mul(opacity).toVar();
    const starColor = mix(tint, vec3(1.0, 1.0, 1.0), core.mul(0.45))
        .add(tint.mul(colorGlow).mul(0.6)).toVar();
    const keep = r.lessThanEqual(0.5).and(alpha.greaterThanEqual(0.001));
    const colorNode = select(
        keep,
        vec4(starColor, alpha),
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

// Shared unit quad for createBodyGlowMarker (corners at
// +/-1 in the position attribute). One geometry serves
// every marker; the namespace is injected, as the
// production class receives it.
export function createBodyGlowMarkerQuadGeometry(T) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(new Float32Array([
        -1, -1, 0,
        1, -1, 0,
        1, 1, 0,
        -1, 1, 0
    ]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    return geometry;
}
