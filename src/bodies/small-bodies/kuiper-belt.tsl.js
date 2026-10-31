import {
    attribute,
    cameraFar,
    cameraNear,
    cameraProjectionMatrix,
    cos,
    dot,
    float,
    Fn,
    Loop,
    max,
    mix,
    mod,
    modelViewMatrix,
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

// TSL counterparts for the two ShaderMaterials owned by
// kuiper-belt.js: the seeded synthetic background (its
// own direct-attribute Kepler solver, 6-iteration
// Newton, positions formed in AU and scaled by uAU
// after the perifocal rotation) and the catalogue
// known-object points (CPU ephemeris positions passed
// through). The KuiperTable Hermite ephemeris, the
// seeded background catalogue, labels and all CPU
// update/visibility switching stay JavaScript in
// kuiper-belt.js / kuiper-core.js; the classic files
// remain the production owners until the flip.
// tools/p5kuiperbelt.mjs renders these factories
// against production's real KuiperBelt class on both
// node backends.
//
// Both points materials become instanced quads
// (WebGPU has no programmable point size) at
// production's constant device-pixel size, with
// fragment-local coordinates replacing gl_PointCoord
// exactly as in the belt points (P5e23). Both classic
// vertices write the fused product
// projectionMatrix * modelViewMatrix * vec4(...);
// the quad centre clip mirrors that association (at
// Kuiper heliocentric magnitudes the association is
// load-bearing -- measured at P5e23), while a separate
// view product feeds the log-depth varying.
//
// Both production materials depth-test in log depth
// (live LDB chunks), so both return the explicit
// log-depth depthNode of the final view position
// unless options.logDepth is false. The caller owns
// the materials and must keep premultipliedAlpha
// false (the factory outputs production's raw shader
// convention; production's ShaderMaterials do not
// premultiply -- measured at P5e22):
//   background: transparent true, depthTest true,
//               depthWrite false, normal blending;
//   known:      transparent true, depthTest true,
//               depthWrite false, normal blending.

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

// The background Kepler head: mean anomaly at uDays,
// the 6-iteration Newton solve, perifocal coordinates
// in AU, the perifocal rotation and production's
// vec3(X, Z, -Y) scene mapping scaled by uAU.
// options.days / au accept numbers or ready nodes
// (pass a uniform node for days -- production writes
// uDays per frame from the simulation epoch).
export function createKuiperPropagation(options = {}) {
    const days = asFloatNode(options.days, 0.0);
    const au = asFloatNode(options.au, 1200.0);

    const propagateKuiperBody = Fn(() => {
        const aOrbit = attribute("aOrbit", "vec4");
        const aPhase = attribute("aPhase", "vec4");
        const a = aOrbit.x.toVar();
        const e = aOrbit.y.toVar();
        const inc = aOrbit.z.toVar();
        const node = aOrbit.w.toVar();
        const peri = aPhase.x.toVar();
        const M = mod(aPhase.y.add(aPhase.z.mul(days)), 6.28318530718).toVar();
        const E = M.toVar();
        Loop(6, () => {
            const num = E.sub(e.mul(sin(E))).sub(M).toVar();
            const den = float(1.0).sub(e.mul(cos(E))).toVar();
            E.assign(E.sub(num.div(den)));
        });
        const x = a.mul(cos(E).sub(e)).toVar();
        const y = a.mul(sqrt(float(1.0).sub(e.mul(e)))).mul(sin(E)).toVar();
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
        return vec3(X, Z, Y.negate()).mul(au);
    });

    return { propagateKuiperBody, days, au };
}

function kuiperPropagation(options) {
    return options.propagation?.propagateKuiperBody
        ? options.propagation
        : createKuiperPropagation(options.propagation || options);
}

// Shared constant-size quad expansion for both points
// slots: production sizes these sprites in raw device
// pixels (point size = uPixels, no distance term),
// so the quad diameter is uPixels exactly. The centre
// clip mirrors production's fused matrix product (see
// header); corners spread in clip space (P5e6 form).
function kuiperPointQuad(scenePosition, pixels, viewport) {
    const mv = modelViewMatrix.mul(vec4(scenePosition, 1.0)).toVar();
    const clip = cameraProjectionMatrix.mul(modelViewMatrix)
        .mul(vec4(scenePosition, 1.0)).toVar();
    const sizePx = select(clip.w.greaterThan(0.0), pixels, float(0.0)).toVar();
    const vp = max(viewport, vec2(1.0, 1.0)).toVar();
    const corner = positionGeometry.xy.toVar();
    const spread = vec4(
        clip.x.add(corner.x.mul(sizePx.div(vp.x)).mul(clip.w)),
        clip.y.add(corner.y.mul(sizePx.div(vp.y)).mul(clip.w)),
        clip.z,
        clip.w);
    return { mv, corner, spread };
}

// Synthetic background points: production's KuiperBelt
// background ShaderMaterial. The fragment disc is the
// smoothstep falloff over the brightness-mixed rock
// tint at 0.55 peak alpha.
export function createKuiperBackground(options = {}) {
    const prop = kuiperPropagation(options);
    const pixels = asFloatNode(options.pixels, 1.6);
    const viewport = asVec2Node(options.viewport, [1.0, 1.0]);
    const aPhase = attribute("aPhase", "vec4");

    const scenePosition = prop.propagateKuiperBody().toVar();
    const q = kuiperPointQuad(scenePosition, pixels, viewport);
    const vertexNode = q.spread;

    const vBrightness = varying(aPhase.w);
    const vViewZ = varying(q.mv.z);
    const vCorner = varying(q.corner);

    const dd = dot(vCorner, vCorner).toVar();
    const r = sqrt(dd).mul(0.5).toVar();
    const tint = mix(
        vec3(0.16, 0.145, 0.13), vec3(0.38, 0.35, 0.31), vBrightness).toVar();
    const alpha = float(1.0).sub(smoothstep(0.1, 0.5, r)).mul(0.55).toVar();
    const colorNode = select(
        r.lessThanEqual(0.5),
        vec4(tint, alpha),
        vec4(0.0, 0.0, 0.0, 0.0));

    const depthNode = options.logDepth === false
        ? null
        : viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return { vertexNode, colorNode, depthNode };
}

// Catalogue known-object points: production's KuiperBelt
// known ShaderMaterial. Centres are the class's CPU
// ephemeris positions (scene units), carried as the
// instanced aKnownPosition attribute (see the geometry
// factory: it wraps the class's positions array, which
// production rewrites per epoch change -- the wiring
// uploads it the same way the classic attribute is
// flagged needsUpdate).
export function createKuiperKnown(options = {}) {
    const pixels = asFloatNode(options.pixels, 3.0);
    const viewport = asVec2Node(options.viewport, [1.0, 1.0]);
    const aKnownPosition = attribute("aKnownPosition", "vec3");

    const q = kuiperPointQuad(aKnownPosition, pixels, viewport);
    const vertexNode = q.spread;

    const vViewZ = varying(q.mv.z);
    const vCorner = varying(q.corner);

    const dd = dot(vCorner, vCorner).toVar();
    const r = sqrt(dd).mul(0.5).toVar();
    const alpha = float(1.0).sub(smoothstep(0.14, 0.5, r)).mul(0.8).toVar();
    const colorNode = select(
        r.lessThanEqual(0.5),
        vec4(vec3(0.48, 0.53, 0.61), alpha),
        vec4(0.0, 0.0, 0.0, 0.0));

    const depthNode = options.logDepth === false
        ? null
        : viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return { vertexNode, colorNode, depthNode };
}

// Quad geometry for both points slots: one instanced
// quad per body; the background carries production's
// seeded aOrbit/aPhase arrays.
function kuiperQuadGeometry(T) {
    const geometry = new T.InstancedBufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(new Float32Array([
        -1, -1, 0,
        1, -1, 0,
        1, 1, 0,
        -1, 1, 0
    ]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    return geometry;
}

export function createKuiperBackgroundGeometry(T, background) {
    const geometry = kuiperQuadGeometry(T);
    geometry.setAttribute("aOrbit", new T.InstancedBufferAttribute(background.orbit, 4));
    geometry.setAttribute("aPhase", new T.InstancedBufferAttribute(background.phase, 4));
    geometry.instanceCount = background.count;
    return geometry;
}

export function createKuiperKnownGeometry(T, positions, count) {
    const geometry = kuiperQuadGeometry(T);
    const attr = new T.InstancedBufferAttribute(positions, 3);
    attr.setUsage(T.DynamicDrawUsage);
    geometry.setAttribute("aKnownPosition", attr);
    geometry.instanceCount = count;
    return geometry;
}

// Read a built production KuiperBelt (after build() /
// update()) into the plain values and material states
// the factories consume. Uniform VALUES are read, not
// nodes: pass uniform nodes over the same fields at
// wiring time for the per-frame ones (days, both
// pixel sizes). Visibility mirrors the class fields
// production's own update() last computed.
export function deriveKuiperInstall(kuiper) {
    const stateOf = mesh => mesh ? {
        transparent: mesh.material.transparent,
        depthTest: mesh.material.depthTest,
        depthWrite: mesh.material.depthWrite,
        blending: mesh.material.blending,
        premultipliedAlpha: mesh.material.premultipliedAlpha
    } : null;
    const bg = kuiper.background;
    const bgUniforms = bg.material.uniforms;
    const known = kuiper.known || null;
    return {
        background: {
            orbit: bg.geometry.attributes.aOrbit.array,
            phase: bg.geometry.attributes.aPhase.array,
            count: bg.geometry.attributes.aOrbit.count
        },
        known: known ? {
            positions: kuiper.positions,
            count: kuiper.meta.count
        } : null,
        uniforms: {
            days: bgUniforms.uDays.value,
            au: bgUniforms.uAU.value,
            backgroundPixels: bgUniforms.uPixels.value,
            knownPixels: known ? known.material.uniforms.uPixels.value : null
        },
        visible: {
            root: kuiper.root.visible,
            background: bg.visible,
            known: known ? known.visible : false
        },
        states: {
            background: stateOf(bg),
            known: stateOf(known)
        }
    };
}
