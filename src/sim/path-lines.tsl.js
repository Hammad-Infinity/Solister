import {
    Fn,
    If,
    abs,
    attribute,
    cameraFar,
    cameraNear,
    cameraProjectionMatrix,
    clamp,
    exp,
    float,
    length,
    max,
    min,
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

// TSL counterpart for the orbit ribbon-line ShaderMaterial
// owned by path-lines.js (PathLines.create), with the
// WorldTrails.create fragment swap carried as the
// variant: "trail" build option. Trail history (the
// worker), the ribbon emission in draw(), the LOD ladder
// and the per-frame uniform writes stay JavaScript in
// path-lines.js / world-trails.js; the classic files remain
// the production owners until the flip.
// tools/p5pathlines.mjs renders these factories against
// the extracted production shaders on both node backends.
//
// The ribbon is expanded in clip space exactly as
// production does it: both segment ends are clamped to the
// near-plane cut in view space (a segment with both ends
// behind the cut is parked at clip (2, 2, 2, 1) with fade
// zeroed), projected, and offset along the screen-space
// normal by halfWidth pixels. The material depth-tests in
// log depth (production carries the real LDB chunks, fed
// from the final clip w), so the port returns the explicit
// log-depth depthNode of the mixed endpoint's view z
// (clip w is its negation) unless options.logDepth is
// false. Both fragments' alpha discard becomes a keep
// select emitting transparent black, equivalent under
// additive blending with depth write off.

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

// Ribbon line: the create() ShaderMaterial of
// path-lines.js. Returns the material slot nodes; the
// caller owns the material (production settings:
// transparent, no depth write, depth test on, additive
// blending, double side, tone mapping off) and the
// geometry from createPathLineGeometry. tint is the
// per-body line colour (production: new Color(COLORS[key]
// || COLORS[parent] || 12574183); the fallback below is
// that constant's linear components). viewport is the
// drawing-buffer size (production shares one Vector2
// across entries); halfWidth, nearPlane and strength are
// production's per-frame writes (nearPlane is camera.near).
// variant: "trail" selects the WorldTrails fragment (a
// hard core sized by halfWidth in device pixels plus a
// hover glow that also whitens the tint) and reads the
// extra options hover (0/1), dpr and width; the default
// "glow" variant is the base PathLines fragment. In the
// trail variant production's update() overwrites
// halfWidth with (hover ? 4.5 : 1.15) * dpr * width -- that
// write stays with the caller, as in production.
export function createPathLines(options = {}) {
    const tint = asVec3Node(options.tint,
        [0.5209955732, 0.7230551289, 0.799102738]);
    const viewport = asVec2Node(options.viewport, [1.0, 1.0]);
    const halfWidth = asFloatNode(options.halfWidth, 4.0);
    const nearPlane = asFloatNode(options.nearPlane, 0.1);
    const strength = asFloatNode(options.strength, 1.0);

    const aEnd = attribute("aEnd", "vec3");
    const aCorner = attribute("aCorner", "vec2");
    const aFade = attribute("aFade", "float");

    // Vertex: production's, operation for operation, as a
    // statement-ordered Fn (the P5e5 pattern). It cannot
    // be nested selects: measured at P5e8, a var whose
    // first use sits inside a select branch gets its
    // initialiser emitted inside that branch, so b's cut
    // test would read b0 uninitialised (z reads 0, and
    // 0 > cut takes the clamp branch with the clamp factor
    // saturating to 1 -- every segment's far end collapsed
    // onto its near end). Inside the Fn the assignments
    // run in production's order (a clamped first, then b
    // against the possibly-moved a); production's early
    // return for a fully-behind segment becomes the final
    // If overwriting the clip position, with the fade
    // zeroing outside.
    const computeRibbonClip = Fn(() => {
        const a = modelViewMatrix.mul(vec4(positionGeometry, 1.0)).toVar();
        const b = modelViewMatrix.mul(vec4(aEnd, 1.0)).toVar();
        const cut = nearPlane.mul(-1.01).toVar();
        const bothBehind = a.z.greaterThan(cut).and(b.z.greaterThan(cut)).toVar();
        If(a.z.greaterThan(cut), () => {
            a.assign(mix(a, b, clamp(
                cut.sub(a.z).div(b.z.sub(a.z)), float(0.0), float(1.0))));
        });
        If(b.z.greaterThan(cut), () => {
            b.assign(mix(b, a, clamp(
                cut.sub(b.z).div(a.z.sub(b.z)), float(0.0), float(1.0))));
        });
        const aClip = cameraProjectionMatrix.mul(a).toVar();
        const bClip = cameraProjectionMatrix.mul(b).toVar();
        const delta = bClip.xy.div(bClip.w)
            .sub(aClip.xy.div(aClip.w)).mul(viewport).toVar();
        const normal = vec2(delta.y.negate(), delta.x)
            .div(max(length(delta), float(0.0001))).toVar();
        const p = mix(aClip, bClip, aCorner.x).toVar();
        const offset = normal.mul(aCorner.y).mul(halfWidth).mul(2.0)
            .div(max(viewport, vec2(1.0, 1.0))).mul(p.w).toVar();
        const clip = vec4(
            p.x.add(offset.x), p.y.add(offset.y), p.z, p.w).toVar();
        If(bothBehind, () => {
            clip.assign(vec4(2.0, 2.0, 2.0, 1.0));
        });
        return clip;
    });
    const ribbonClip = computeRibbonClip();
    const vertexNode = ribbonClip;

    const vSide = varying(aCorner.y);
    // The fade zeroing of production's early return. The
    // cut test here is plain expressions (no vars take
    // part in a select), so it cannot hit the ordering
    // trap above.
    const a0 = modelViewMatrix.mul(vec4(positionGeometry, 1.0));
    const b0 = modelViewMatrix.mul(vec4(aEnd, 1.0));
    const cut0 = nearPlane.mul(-1.01);
    const vFade = varying(select(
        a0.z.greaterThan(cut0).and(b0.z.greaterThan(cut0)),
        float(0.0), aFade));
    // Log depth from the final clip w, exactly what
    // production's LDB tail consumes (1.0 + clip w); the
    // mixed endpoint's view z is its negation.
    const vViewZ = varying(ribbonClip.w.negate());

    let colorNode;
    if (options.variant === "trail") {
        // Fragment: WorldTrails.create's swap. d is the
        // cross-line distance in device pixels, recovered
        // from vSide through the same halfWidth the vertex
        // widened by, normalised by the settings width.
        const hover = asFloatNode(options.hover, 0.0);
        const dpr = asFloatNode(options.dpr, 1.0);
        const width = asFloatNode(options.width, 1.0);
        const d = abs(vSide).mul(halfWidth)
            .div(max(dpr, float(1.0)).mul(width)).toVar();
        const core = float(1.0).sub(
            smoothstep(float(0.45), float(1.05), d)).toVar();
        const glow = exp(d.mul(d).negate().div(5.0))
            .mul(0.3).mul(hover).toVar();
        const alpha = core.mul(0.75).add(glow)
            .mul(clamp(vFade, float(0.0), float(1.0)))
            .mul(strength).toVar();
        colorNode = select(
            alpha.lessThan(0.002),
            vec4(0.0, 0.0, 0.0, 0.0),
            vec4(
                mix(tint, vec3(1.0, 1.0, 1.0), float(0.3).mul(hover)),
                min(alpha, float(0.95))));
    } else {
        // Fragment: the base PathLines profile -- a broad
        // halo plus a tight core over the squared
        // cross-line coordinate.
        const x = vSide.mul(vSide).toVar();
        const glow = float(0.38).mul(exp(x.mul(-3.2)))
            .add(float(0.62).mul(exp(x.mul(-80.0)))).toVar();
        const alpha = glow
            .mul(clamp(vFade, float(0.0), float(1.0)))
            .mul(strength).toVar();
        colorNode = select(
            alpha.lessThan(0.002),
            vec4(0.0, 0.0, 0.0, 0.0),
            vec4(tint, min(alpha, float(0.95))));
    }

    const depthNode = options.logDepth === false
        ? null
        : viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return {
        vertexNode,
        colorNode,
        depthNode
    };
}

// Ribbon geometry: production's create() assembly -- a
// non-indexed buffer with six vertices per segment
// (position/aEnd carry the segment ends per vertex,
// aFade the end fades; all three are dynamic because
// draw() rewrites them), the static aCorner pattern, and
// draw range 0 until draw() emits. The namespace is
// injected, as the production class receives it. The
// capacity is production's MAX_SEGMENTS.
export function createPathLineGeometry(T, segmentCapacity = 4400) {
    const vertices = segmentCapacity * 6;
    const geometry = new T.BufferGeometry();
    for (const [name, size] of [["position", 3], ["aEnd", 3], ["aCorner", 2], ["aFade", 1]]) {
        const attribute = new T.BufferAttribute(new Float32Array(vertices * size), size);
        if (name !== "aCorner") attribute.setUsage(T.DynamicDrawUsage);
        geometry.setAttribute(name, attribute);
    }
    const pattern = [0, -1, 0, 1, 1, -1, 1, -1, 0, 1, 1, 1];
    for (let step = 0; step < segmentCapacity; step++) {
        geometry.attributes.aCorner.array.set(pattern, step * 12);
    }
    geometry.setDrawRange(0, 0);
    return geometry;
}
