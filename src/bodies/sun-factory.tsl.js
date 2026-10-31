import {
    Fn,
    abs,
    cameraFar,
    cameraNear,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    log,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    select,
    smoothstep,
    sqrt,
    struct,
    uniform,
    varying,
    viewZToLogarithmicDepth,
    vec2,
    vec3,
    vec4
} from "three/tsl";
import { singleGlowColumn } from "../shaders/single-glow.tsl.js";

// TSL counterparts for the three ShaderMaterials owned by
// sun-factory.js: the photosphere, the corona shell and the
// screen-space halo. The lens artifacts in the same file are
// built-in SpriteMaterials (they ride the built-in conversion
// measured at P5e1; SpriteMaterial itself is a wiring-phase
// spot-check), and texture loading, mesh assembly and the
// SUN_CORONA_* profile constants stay JavaScript in
// sun-factory.js / app/state.js. The classic file remains the
// production owner until the flip; tools/p5sunfactory.mjs
// renders these factories against the extracted production
// shaders on both node backends.
//
// Log depth: production runs with the logarithmic depth
// buffer. The photosphere and corona use the standard
// vertex transform, so the renderer's own depth path
// applies (the aurora-shell precedent). The halo writes a
// fully custom clip-space vertex, so -- exactly as for the
// aurora sprites -- it returns an explicit depthNode
// (three's viewZToLogarithmicDepth over a varying of the
// true centre view Z, which is what production's LDB tail
// derives from the clip-space w) unless options.logDepth is
// false for a renderer without the buffer. Production's
// clip.z -0.00005*w nudge is inert under log depth (depth
// comes from w, not z) but is kept so the linear-depth
// form matches too; the dead `#if USE_LOGDEPTHBUF_EXT`
// hand adjustment inside SUN_HALO_VERTEX is not reproduced.

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

// Photosphere: SUN_PHOTOSPHERE_VERTEX/FRAGMENT. The vertex is
// the standard transform with the log-depth chunks; the
// fragment is the constant vec4(1,1,1,1) -- the visible sun
// surface shading is entirely downstream (display chain and
// bloom). The caller owns the material (production settings:
// tone mapping off; opaque) and the sphere geometry.
export function createSunPhotosphere() {
    return {
        colorNode: vec4(1.0, 1.0, 1.0, 1.0)
    };
}

// Corona shell: the createSunCorona ShaderMaterial. A back-side
// sphere shell whose fragment evaluates the single-power glow
// column (single-glow.tsl.js, the proved P3 factor) along the
// view ray's chord through the shell, with a limb ramp, a
// phase term, value-noise streamers and a glare alpha.
// Production discards (limb, empty chord, edge fade, base
// floor) become the struct keep flag, the atmosphere-shell
// pattern; the caller owns the material (production settings:
// transparent, no depth write, depth test on, back side,
// renderOrder 3) and geometry. Blending needs care at wiring
// time: production's classic state is NormalBlending with
// premultipliedAlpha:true, i.e. raw shader output with blend
// factors (One, OneMinusSrcAlpha). A node material with the
// same flag instead premultiplies rgb by alpha in its output
// stage (measured at P5e2: radiance*glare, exactly), so the
// node material must use premultipliedAlpha:false with
// CustomBlending and explicit One/OneMinusSrcAlpha factors
// to reproduce production. Note the column is fed ray
// distances measured from the camera, as production writes
// it, so the evaluated glow falls off fast with range. Options mirror the production uniform set;
// pass uniform nodes for the animated ones (sunCenter,
// intensity, shellRadius, streamers, distGain, time --
// frame-loop.js writes them per frame). Production profile
// at r126 (app/state.js owns the constants): shell scale 2.2,
// intensity 0.62, power 4.3, streamers 0.1, streamer scale
// 4.2; both colours are white.
export const SunCoronaOutput = struct({
    color: "vec4",
    keep: "float"
}, "SunCoronaOutput");

export function createSunCorona(options = {}) {
    const glowColor = asVec3Node(options.glowColor, [1.0, 1.0, 1.0]);
    const limbColor = asVec3Node(options.limbColor, [1.0, 1.0, 1.0]);
    const intensity = asFloatNode(options.intensity, 1.0);
    const sunCenter = asVec3Node(options.sunCenter, [0.0, 0.0, 0.0]);
    const sunRadius = asFloatNode(options.sunRadius, 1.0);
    const shellRadius = asFloatNode(options.shellRadius, 1.0);
    const power = asFloatNode(options.power, 4.3);
    const distGain = asFloatNode(options.distGain, 1.0);
    const streamers = asFloatNode(options.streamers, 0.0);
    const streamScale = asFloatNode(options.streamScale, 4.2);
    const time = asFloatNode(options.time, 0.0);

    // Streamer value noise, ported as written (hash31/vnoise/
    // fbm3 in the classic fragment). The floor() cell selection
    // makes this a bounded-discontinuity compare across
    // implementations, the P5c21 class.
    const hash31 = (p) => {
        const h = fract(p.mul(0.3183099).add(vec3(0.1, 0.2, 0.3))).mul(17.0).toVar();
        return fract(h.x.mul(h.y).mul(h.z).mul(h.x.add(h.y).add(h.z)));
    };
    const vnoise = (x) => {
        const i = floor(x).toVar();
        const f0 = fract(x).toVar();
        const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0))).toVar();
        const c000 = hash31(i);
        const c100 = hash31(i.add(vec3(1.0, 0.0, 0.0)));
        const c010 = hash31(i.add(vec3(0.0, 1.0, 0.0)));
        const c110 = hash31(i.add(vec3(1.0, 1.0, 0.0)));
        const c001 = hash31(i.add(vec3(0.0, 0.0, 1.0)));
        const c101 = hash31(i.add(vec3(1.0, 0.0, 1.0)));
        const c011 = hash31(i.add(vec3(0.0, 1.0, 1.0)));
        const c111 = hash31(i.add(vec3(1.0, 1.0, 1.0)));
        return mix(
            mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
            mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y),
            f.z);
    };
    const fbm3 = (p) => {
        const p2 = p.mul(2.03).toVar();
        const p3 = p2.mul(2.03).toVar();
        return vnoise(p).mul(0.5).add(vnoise(p2).mul(0.25)).add(vnoise(p3).mul(0.125));
    };

    // Vertex stage: production passes world position and
    // normalize(position). positionWorld is the same built-in;
    // the direction varying interpolates the geometry position
    // (points on a sphere, so interpolating positions and then
    // normalizing in the fragment -- as production does --
    // gives the identical direction).
    const localDir = varying(positionGeometry);

    const sunCoronaColor = Fn(([worldPos]) => {
        const rayDir = normalize(worldPos.sub(cameraPosition)).toVar();
        const toCenter = sunCenter.sub(cameraPosition).toVar();
        const t = dot(toCenter, rayDir).toVar();
        const closest = cameraPosition.add(rayDir.mul(t)).toVar();
        const impact = length(sunCenter.sub(closest)).toVar();
        const ratio = impact.div(sunRadius).toVar();
        const shellRatio = shellRadius.div(sunRadius).toVar();

        const limb = smoothstep(float(0.90), float(1.00), ratio).toVar();

        const outerChord = sqrt(max(
            shellRadius.mul(shellRadius).sub(impact.mul(impact)),
            float(0.0))).toVar();
        const rayStart = max(float(0.0), t.sub(outerChord)).toVar();
        const innerChord = sqrt(max(
            sunRadius.mul(sunRadius).sub(impact.mul(impact)),
            float(0.0))).toVar();
        const rayFinish = select(
            impact.lessThan(sunRadius),
            min(t.add(outerChord), max(rayStart, t.sub(innerChord))),
            t.add(outerChord)).toVar();

        const outer = length(worldPos.sub(sunCenter)).toVar();
        const edgeFade = float(1.0).sub(smoothstep(
            shellRadius.mul(0.82), shellRadius, outer)).toVar();

        const effPower = max(power,
            float(5.99).div(log(max(shellRatio, float(1.05))))).toVar();
        const bNorm = max(impact, sunRadius.mul(0.03)).div(sunRadius).toVar();
        const column = singleGlowColumn(
            bNorm, rayStart.div(sunRadius), rayFinish.div(sunRadius), effPower).toVar();
        const closestRel = closest.sub(sunCenter).toVar();
        const phase = float(0.35).add(float(0.65).mul(pow(
            float(1.0).sub(abs(dot(normalize(closestRel), rayDir))),
            float(2.0)))).toVar();
        const glow = column.div(float(1.0).add(column)).toVar();
        const base = limb.mul(glow).mul(phase)
            .mul(exp(column.mul(-0.035))).toVar();

        const sd = normalize(localDir).toVar();
        const n = fbm3(sd.mul(streamScale).add(vec3(
            time.mul(0.03), time.mul(0.03), time.mul(0.03)))).toVar();
        const rays = select(
            streamers.greaterThan(0.001),
            float(1.0).sub(streamers).add(streamers.mul(2.0).mul(n)),
            float(1.0)).toVar();

        const fade = base.mul(edgeFade).mul(max(rays, float(0.0))).toVar();
        const col = mix(limbColor, glowColor, clamp(
            ratio.sub(1.0).div(shellRatio.sub(1.0)),
            float(0.0), float(1.0))).toVar();
        const radiance = col.mul(fade).mul(intensity).mul(distGain).toVar();
        const glare = smoothstep(float(0.02), float(0.35),
            max(radiance.r, max(radiance.g, radiance.b))).toVar();

        const keep = limb.greaterThan(0.001)
            .and(rayFinish.greaterThan(rayStart))
            .and(edgeFade.greaterThan(0.001))
            .and(base.greaterThan(0.002));

        return SunCoronaOutput({
            color: vec4(radiance, glare),
            keep: select(keep, float(1.0), float(0.0))
        });
    });

    const sunCoronaColorNode = (worldPos = positionWorld) => {
        return sunCoronaColor(worldPos);
    };

    return {
        sunCoronaColor,
        sunCoronaColorNode,
        SunCoronaOutput
    };
}

// Screen-space halo: SUN_HALO_VERTEX/SUN_HALO_FRAGMENT. A 2x2
// plane whose vertex stage ignores the model transform and
// places the quad around the projected sun centre with a
// pixel-exact radius; the fragment is a two-Gaussian falloff
// with an edge cut. Returns the material slot nodes
// (vertexNode, colorNode, and depthNode unless logDepth is
// false); the caller owns the material (production settings:
// transparent, no depth write, depth test on, additive
// blending, tone mapping off, renderOrder 4, frustumCulled
// false) and the plane geometry. Options mirror the
// production uniforms; frame-loop.js writes sunCenter,
// viewport, haloRadius and gain per frame. The L < 0.0005
// discard becomes a keep select emitting transparent black,
// equivalent under additive blending with depth write off
// (the aurora-sprite precedent).
export function createSunHalo(options = {}) {
    const sunCenter = asVec3Node(options.sunCenter, [0.0, 0.0, 0.0]);
    const haloRadius = asFloatNode(options.haloRadius, 18.0);
    const viewport = asVec2Node(options.viewport, [1.0, 1.0]);
    const gain = asFloatNode(options.gain, 1.0);

    // Vertex stage (production writes its clip position by hand,
    // the varyings are built from nodes valid in that stage).
    const mv = cameraViewMatrix.mul(vec4(sunCenter, 1.0)).toVar();
    const clip = cameraProjectionMatrix.mul(mv).toVar();
    const vp = max(viewport, vec2(1.0, 1.0)).toVar();
    const corner = positionGeometry.xy.toVar();
    const vertexNode = vec4(
        clip.x.add(corner.x.mul(haloRadius.mul(2.0).div(vp.x)).mul(clip.w)),
        clip.y.add(corner.y.mul(haloRadius.mul(2.0).div(vp.y)).mul(clip.w)),
        clip.z.sub(clip.w.mul(0.00005)),
        clip.w);

    const vCorner = varying(corner);
    const vViewZ = varying(mv.z);

    const r = length(vCorner).toVar();
    const inner = exp(r.mul(r).mul(-16.0)).toVar();
    const outer = exp(r.mul(-3.2)).toVar();
    const cut = float(1.0).sub(smoothstep(float(0.80), float(1.0), r)).toVar();
    const haloL = inner.mul(0.70).add(outer.mul(outer).mul(0.30))
        .mul(cut).mul(cut).toVar();
    const colorNode = select(
        haloL.greaterThanEqual(0.0005),
        vec4(vec3(1.0, 1.0, 1.0).mul(haloL).mul(gain), 1.0),
        vec4(0.0, 0.0, 0.0, 0.0));

    // Explicit log depth from the centre view Z: production's
    // LDB tail derives vFragDepth from the clip w, which
    // for this vertex is -mv.z with mv the sun centre in view
    // space.
    const depthNode = options.logDepth === false
        ? null
        : viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return {
        vertexNode,
        colorNode,
        depthNode
    };
}
