import {
    cameraProjectionMatrix,
    float,
    modelViewMatrix,
    positionGeometry,
    uniform,
    vec3,
    vec4
} from "three/tsl";

// TSL counterparts for the two line ShaderMaterials owned
// by constellations.js: the figure lines (_buildFigures)
// and the boundary lines (_buildBoundaries). Catalogue
// loading, figure/boundary geometry generation, proper-
// motion refresh, labels (CSS2D), picking and the point-
// in-constellation index stay JavaScript in
// constellations.js, as do the built-in materials (the
// instanced star discs and the 1px star points convert on
// their own at the flip); the classic file remains the
// production owner until then. tools/p5constellations.mjs
// renders these factories against the extracted production
// shaders on both node backends.
//
// Both materials are 1px line segments whose vertex forces
// the clip z to the far end of the depth range
// (z = w * factor, 0.99997 figures / 0.99996 boundaries),
// so the sky lines depth-test behind everything that
// writes real (log) depth, without writing depth
// themselves. Production carries no log-depth chunks
// here, and neither does this port: depthNode is null and
// the squashed clip z is the depth, exactly as shipped.
// The boundary fragment premultiplies its rgb by the
// opacity in-shader (the additive blend then scales by
// alpha again); the figure fragment does not. Both
// behaviours are reproduced literally.

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

// Shared line graph: the common vertex (standard transform
// with the far-depth squash) and the constant-colour
// fragment, differing only in the squash factor and the
// premultiplication.
function buildSkyLineSlots(options, defaults) {
    const color = asVec3Node(options.color, defaults.color);
    const opacity = asFloatNode(options.opacity, defaults.opacity);
    const depthFactor = asFloatNode(options.depthFactor, defaults.depthFactor);

    const mv = modelViewMatrix.mul(vec4(positionGeometry, 1.0)).toVar();
    const clip = cameraProjectionMatrix.mul(mv).toVar();
    const vertexNode = vec4(clip.x, clip.y, clip.w.mul(depthFactor), clip.w);

    const rgb = defaults.premultiply ? color.mul(opacity) : color;
    const colorNode = vec4(rgb, opacity);

    return {
        vertexNode,
        colorNode,
        depthNode: null
    };
}

// Figure lines: the _buildFigures() ShaderMaterial.
// Returns the material slot nodes; the caller owns the
// line material (production settings: transparent, no
// depth write, depth test on, additive blending, tone
// mapping off) on a LineSegments over production's
// position-only geometry. The default colour is the
// linear form of production's 9417446.
export function createConstellationFigures(options = {}) {
    return buildSkyLineSlots(options, {
        color: [0.274677312, 0.4452011945, 0.7912979403],
        opacity: 0.46,
        depthFactor: 0.99997,
        premultiply: false
    });
}

// Boundary lines: the _buildBoundaries() ShaderMaterial.
// Same contract as createConstellationFigures; the
// default colour is the linear form of production's
// 14478079, and the fragment premultiplies rgb by the
// opacity as production's does.
export function createConstellationBoundaries(options = {}) {
    return buildSkyLineSlots(options, {
        color: [0.7156935005, 0.8227857544, 1.0],
        opacity: 0.58,
        depthFactor: 0.99996,
        premultiply: true
    });
}
