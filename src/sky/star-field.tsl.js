import {
    attribute,
    cameraFar,
    cameraNear,
    cameraProjectionMatrix,
    dot,
    float,
    max,
    modelViewMatrix,
    positionGeometry,
    select,
    smoothstep,
    uniform,
    varying,
    viewZToLogarithmicDepth,
    vec2,
    vec4
} from "three/tsl";

// TSL counterpart for the star catalogue points owned by
// star-field.js. Production draws THREE.Points with a
// ShaderMaterial: the vertex sets the point size from a
// per-star attribute times a pixel-ratio uniform, and the
// fragment applies a radial smoothstep falloff over the
// point coordinate. WebGPU has no programmable point size
// (points rasterise at 1 px), so -- as everywhere in the
// points family -- the node form draws one instanced quad
// per star, sized in clip space to the same device-pixel
// extent (the sun-halo sizing pattern) and evaluating the
// same falloff from the interpolated quad corner. Catalogue
// loading and the position/colour/size array derivation
// stay JavaScript in star-field.js; the classic file
// remains the production owner until the flip.
// tools/p5starfield.mjs renders this against the extracted
// production shaders on both node backends.
//
// Depth: production's shader carries no log-depth chunks,
// so under the app's logarithmic depth buffer its points
// depth-test with plain clip z. Everything that can occlude
// a star writes log depth, and at dome distances both tests
// give the same visible outcome (occluded by nearer opaque
// geometry, drawn over the clear value); the port returns
// the explicit log-depth depthNode of the star centre
// (the aurora-sprite / sun-halo precedent), which is the
// consistent form post-flip, unless options.logDepth is
// false for a renderer without the buffer.
//
// Clipping: production on the ANGLE/SwiftShader stack draws
// points partially at the frame edge (per-fragment clipping,
// measured by the P5e3 rig: a giant star whose centre is
// off-screen still lights the border rows), so the quad is
// collapsed only when the centre is behind the eye
// (clip w <= 0), where GL points are clipped too.

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

// Star points: VERTEX_SHADER/FRAGMENT_SHADER of star-field.js.
// Returns the material slot nodes; the caller owns the
// material (production settings: transparent, no depth
// write, depth test on, additive blending, tone mapping
// off, renderOrder -600, frustumCulled false) and the
// geometry from createStarFieldQuadGeometry below. Options
// mirror the production uniform set -- pixelRatio tracks
// the renderer's device pixel ratio (production writes
// min(2, devicePixelRatio) and refreshes it in update()),
// and viewport is the drawing-buffer size in device
// pixels, which the quad sizing needs and points did not.
export function createStarFieldPoints(options = {}) {
    const pixelRatio = asFloatNode(options.pixelRatio, 1.0);
    const viewport = asVec2Node(options.viewport, [1.0, 1.0]);

    const aStarPos = attribute("aStarPos", "vec3");
    const aColor = attribute("aColor", "vec3");
    const aSize = attribute("aSize", "float");

    // Vertex stage. The star centre goes through the model
    // transform exactly as the production point position
    // does (production scales the unit-directions group to
    // the sky radius); the corner then offsets in clip
    // space by the point size in device pixels. A centre
    // behind the eye collapses the quad (see the clipping
    // note above).
    const mv = modelViewMatrix.mul(vec4(aStarPos, 1.0)).toVar();
    const clip = cameraProjectionMatrix.mul(mv).toVar();
    const sizePx = select(
        clip.w.greaterThan(0.0), aSize.mul(pixelRatio), float(0.0)).toVar();
    const vp = max(viewport, vec2(1.0, 1.0)).toVar();
    const corner = positionGeometry.xy.toVar();
    const vertexNode = vec4(
        clip.x.add(corner.x.mul(sizePx.div(vp.x)).mul(clip.w)),
        clip.y.add(corner.y.mul(sizePx.div(vp.y)).mul(clip.w)),
        clip.z,
        clip.w);

    const vCorner = varying(corner);
    const vColor = varying(aColor);
    const vViewZ = varying(mv.z);

    // Fragment stage. The production falloff reads the
    // point coordinate in [0,1] and centres it; the quad
    // corner in [-1,1] is the same coordinate at twice the
    // scale. The r2 > 0.25 discard becomes a keep select
    // emitting transparent black, equivalent under additive
    // blending with depth write off.
    const r2 = dot(vCorner, vCorner).mul(0.25).toVar();
    const alpha = smoothstep(float(0.25), float(0.02), r2).toVar();
    const colorNode = select(
        r2.lessThanEqual(0.25),
        vec4(vColor.mul(alpha), alpha),
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

// Instanced-quad geometry for createStarFieldPoints from
// the same arrays production builds (unit-direction
// positions, per-star colours, per-star sizes). The
// namespace is injected, exactly as the production
// StarField class receives it, so the same builder serves
// the rig and the future wiring. Bounding sphere mirrors
// production's (the mesh runs frustumCulled false either
// way).
export function createStarFieldQuadGeometry(T, arrays) {
    const geometry = new T.InstancedBufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(new Float32Array([
        -1, -1, 0,
        1, -1, 0,
        1, 1, 0,
        -1, 1, 0
    ]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("aStarPos", new T.InstancedBufferAttribute(arrays.positions, 3));
    geometry.setAttribute("aColor", new T.InstancedBufferAttribute(arrays.colors, 3));
    geometry.setAttribute("aSize", new T.InstancedBufferAttribute(arrays.sizes, 1));
    geometry.instanceCount = arrays.sizes.length;
    geometry.boundingSphere = new T.Sphere(new T.Vector3(), 1.01);
    return geometry;
}
