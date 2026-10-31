import {
    Fn,
    asin,
    Loop,
    attribute,
    cameraFar,
    cameraNear,
    cameraProjectionMatrix,
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
    modelViewMatrix,
    modelWorldMatrix,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    select,
    sin,
    smoothstep,
    uniform,
    uv,
    varying,
    viewZToLogarithmicDepth,
    vec2,
    vec3,
    vec4
} from "three/tsl";

// TSL counterparts for the shader materials owned by planet-factory.js,
// built one proved piece at a time. Most of that file is plain
// JavaScript (Kepler positions, geometry builders, mesh assembly) and
// stays JavaScript; only the shader arithmetic ports. The classic file
// remains the production owner until the flip.
//
// First piece: the aurora sprite curtains (the mode-0 path every
// current profile selects), which are also the vertex/log-depth probe
// for the whole node-material programme: a custom instanced vertex
// stage (FBM-driven billboarded quads) running under the renderer's
// logarithmic depth buffer.
//
// Log depth needs one deliberate step here, and the probe found
// exactly where. Node materials get log depth from the renderer
// flag, computed in the fragment stage from positionView. For a
// material with a custom vertexNode, three r186 does not build
// fragment positionView from positionLocal/positionNode at all: it
// reconstructs it from the interpolated clip-space position
// (cameraProjectionMatrixInverse * v_clipSpace). That is the only
// generally-correct choice for arbitrary vertex displacement, but
// in fp32 the view distance lives in the last bits of clip z when
// near/far is extreme (production runs near 1 down to 1e-8 against
// far >= 1.2e6), so the reconstructed depth is far too coarse to
// separate sprite bases at 1.008 radii from the surface -- measured
// on the probe rig, where correctly-coloured sprites were
// depth-killed over the disc. The factory therefore returns an
// explicit depthNode: three's own viewZToLogarithmicDepth formula
// (the same one setupDepth injects) fed a varying of the true
// billboarded view Z, which the vertex stage computes exactly.
// The `logDepth` build option mirrors the compile-time role of
// production's #ifdef guard: pass false only for a renderer
// running without the logarithmic depth buffer. Production runs
// with it, so true is the default. tools/p5aurorasprite.mjs renders
// this against the extracted production material on both node
// backends at a near/far ratio where linear depth visibly fails,
// with a log-depth-off control proving the depth stress is real.
//
// Second piece: the Saturn ring-gap alpha factor (the
// onBeforeCompile patch createPlanetMesh installs on the ring
// material), below.
//
// Third piece (P5c21): the mode 1/2 aurora shell and the
// createPlanetAurora install derivation covering both of its
// branches (the sprite branch above and the shell). Every
// current profile selects mode 0, so the shell is unreachable
// in production today -- and frame-loop.js additionally holds
// all aurora intensity at AURORA_NIGHT_LIFT = 0, the
// night-side-darkness rule -- but the branch is one profile
// number away from live, so it is ported, not dropped (the
// P5c19 marker-mode precedent).
//
// Not yet ported (later submodule): the surface BRDF installer.

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? float(value) : value;
}

function asVec3Node(value, fallback) {
    if (value === undefined) return vec3(fallback[0], fallback[1], fallback[2]);
    if (Array.isArray(value)) return vec3(value[0], value[1], value[2]);
    if (value?.isVector3 || value?.isColor) return uniform(value);
    if (value && typeof value.x === "number" && typeof value.y === "number" &&
        typeof value.z === "number" && !value.isNode) {
        return vec3(value.x, value.y, value.z);
    }
    return value;
}

function asVec2Node(value, fallback) {
    if (value === undefined) return vec2(fallback[0], fallback[1]);
    if (Array.isArray(value)) return vec2(value[0], value[1]);
    if (value?.isVector2) return uniform(value);
    if (value && typeof value.x === "number" && typeof value.y === "number" &&
        !value.isNode) {
        return vec2(value.x, value.y);
    }
    return value;
}

// The sprite shaders' shared value-noise block (AURORA_SE_NOISE):
// sin-hash value noise, lacunarity 2.218281828459, gain 0.671415927.
// Octave counts are literals at every production call site, so they
// are build-time constants here as well.
const DETAIL_LACUNARITY = 2.218281828459;
const DETAIL_GAIN = 0.671415927;

export const auroraDetailHash = Fn(([n]) => {
    return fract(sin(n).mul(43758.5453));
});

export const auroraDetailNoise = Fn(([x]) => {
    const p = floor(x).toVar();
    const f0 = fract(x).toVar();
    const f = f0.mul(f0).mul(f0.mul(-2.0).add(3.0)).toVar();
    const n = p.x.add(p.y.mul(57.0)).toVar();
    return mix(
        mix(auroraDetailHash(n), auroraDetailHash(n.add(1.0)), f.x),
        mix(auroraDetailHash(n.add(57.0)), auroraDetailHash(n.add(58.0)), f.x),
        f.y);
});

export const auroraDetailNoise4 = Fn(([x]) => {
    return vec4(
        auroraDetailNoise(x),
        auroraDetailNoise(x.add(vec2(0.272, -0.375))),
        auroraDetailNoise(x.add(vec2(-0.464, 0.674))),
        auroraDetailNoise(x.add(vec2(0.548, -0.145))));
});

function auroraDetailFbm(point, octaves) {
    return Fn(([p]) => {
        const sum = float(0.0).toVar();
        const pa = vec3(p.mul(256.0), 1.0).toVar();
        Loop(octaves, () => {
            sum.addAssign(pa.z.mul(auroraDetailNoise(pa.xy).sub(0.5)));
            pa.mulAssign(vec3(DETAIL_LACUNARITY, DETAIL_LACUNARITY, DETAIL_GAIN));
        });
        return sum;
    })(point);
}

function auroraDetailFbm4(point, octaves) {
    return Fn(([p]) => {
        const sum = vec4(0.0, 0.0, 0.0, 0.0).toVar();
        const pa = vec3(p.mul(256.0), 1.0).toVar();
        Loop(octaves, () => {
            sum.addAssign(auroraDetailNoise4(pa.xy).sub(0.5).mul(pa.z));
            pa.mulAssign(vec3(DETAIL_LACUNARITY, DETAIL_LACUNARITY, DETAIL_GAIN));
        });
        return sum;
    })(point);
}

// Aurora sprite curtains: AURORA_SPRITE_VERTEX + AURORA_SPRITE_FRAGMENT
// from planet-factory.js. Options mirror the production uniform set;
// pass uniform nodes for the animated ones (time, intensity,
// sunWorldPos). Returns the material slot nodes (vertexNode,
// colorNode, and depthNode unless logDepth is false); the caller owns
// the material (production settings: transparent, no depth write,
// depth test on, additive blending, double side, tone mapping off)
// and the instanced geometry, which is renderer-agnostic and stays in
// createAuroraSpriteGeometry.
export function createAuroraSprite(options = {}) {
    const time = asFloatNode(options.time, 0.0);
    const intensity = asFloatNode(options.intensity, 0.0);
    const sunWorldPos = asVec3Node(options.sunWorldPos, [0.0, 0.0, 0.0]);
    const seed = asFloatNode(options.seed, 0.0);
    const baseR = asFloatNode(options.baseR, 1.0);
    const height = asFloatNode(options.height, 0.0);
    const width = asFloatNode(options.width, 0.0);
    const axes = asVec3Node(options.axes, [1.0, 1.0, 1.0]);
    const colorA = asVec3Node(options.colorA, [0.0, 0.0, 0.0]);
    const colorB = asVec3Node(options.colorB, [0.0, 0.0, 0.0]);
    const colorC = asVec3Node(options.colorC, [0.0, 0.0, 0.0]);

    const position = positionGeometry;
    const aDir = attribute("aDir", "vec3");
    const aSeed = attribute("aSeed", "float");

    // Vertex stage (production main, in order).
    const np = aDir.xz.mul(1.7).add(vec2(aSeed.mul(0.618), seed));
    const wob = auroraDetailFbm4(np.mul(0.5), 4);
    const wobScale = wob.a.mul(0.16).add(1.0);
    const dir = normalize(vec3(
        aDir.x.mul(wobScale), aDir.y, aDir.z.mul(wobScale)));
    const scaleFade = clamp(
        auroraDetailFbm4(np.mul(2.6), 4).mul(0.7).add(0.7),
        vec4(0.35, 0.05, 0.0, 0.0), vec4(2.0, 2.0, 1.0, 1.0));
    const spriteWidth = width.div(scaleFade.x).mul(1.5);
    const spriteLength = height.mul(scaleFade.y);
    const brightBase = clamp(
        auroraDetailFbm(np.mul(0.9).add(vec2(0.75, time.mul(0.01))), 4).add(0.5),
        float(0.0), float(1.6));
    const pB = dir.mul(baseR).mul(axes);
    const pT = dir.mul(baseR.add(spriteLength)).mul(axes);
    const local = mix(pB, pT, position.y);
    const worldPos = modelWorldMatrix.mul(vec4(local, 1.0)).xyz;
    const bodyCenter = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    const topMix = clamp(
        auroraDetailFbm(np.mul(4.1).add(vec2(0.0, time.mul(0.02))), 3).mul(0.8).add(0.5),
        float(0.0), float(1.0));
    const topCol = mix(colorB, colorC, topMix).mul(
        clamp(auroraDetailFbm(np.mul(1.3), 3).add(0.5),
            float(0.0), float(1.0)).mul(0.65).add(0.35));
    const color = mix(colorA, topCol,
        pow(position.y, float(1.15)).mul(
            clamp(scaleFade.z.mul(2.2), float(0.0), float(1.0))));
    const brightOut = brightBase.mul(
        clamp(scaleFade.a.add(0.25), float(0.0), float(1.15)));
    const vB = modelViewMatrix.mul(vec4(pB, 1.0));
    const vT4 = modelViewMatrix.mul(vec4(pT, 1.0));
    const viewMix = mix(vB, vT4, position.y);
    const axis = vT4.xy.sub(vB.xy);
    const axisLength = length(axis);
    const tangent = select(
        axisLength.greaterThan(1e-6),
        vec2(axis.y.mul(-1.0), axis.x).div(axisLength),
        vec2(1.0, 0.0));
    const viewOffset = tangent.mul(
        position.x.mul(spriteWidth).mul(
            float(1.0).sub(position.y.mul(0.22))));
    const viewPos = vec4(viewMix.xy.add(viewOffset), viewMix.z, viewMix.w);
    // length(vec3(modelViewMatrix[0])): the first column's xyz, taken
    // by transforming the unit X direction (same value, no indexing).
    const viewScale = max(
        length(modelViewMatrix.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz),
        float(1e-9));
    const zOut = axisLength.div(
        axisLength.add(spriteWidth.mul(viewScale).mul(2.0)));
    const clipPos = cameraProjectionMatrix.mul(viewPos);

    const vU = varying(position.x.mul(2.0));
    const vT = varying(position.y);
    const vZ = varying(zOut);
    const vBright = varying(brightOut);
    const vSeed = varying(aSeed);
    const vColor = varying(color);
    const vWorldPos = varying(worldPos);
    const vBodyCenter = varying(bodyCenter);

    // Fragment stage. Production discards (night <= .001, then
    // a < .0035) become a keep select emitting transparent black,
    // which under the material's additive blending and disabled depth
    // write is the same result as discarding.
    const sunDir = normalize(sunWorldPos.sub(vBodyCenter));
    const outDir = normalize(vWorldPos.sub(vBodyCenter));
    const night = float(1.0).sub(
        smoothstep(float(-0.4), float(0.3), dot(outDir, sunDir)));
    const taIn = vT.mul(2.0).sub(1.0);
    const ta = select(
        taIn.lessThan(0.0),
        max(taIn.add(vZ).div(vZ.sub(1.0)), float(0.0)),
        min(taIn.sub(vZ).div(vZ.sub(1.0)), float(0.0)));
    const bright = exp(ta.mul(ta).add(vU.mul(vU)).mul(-5.55))
        .mul(log(max(float(2.0).sub(vT), float(1.0))).mul(2.0))
        .mul(smoothstep(float(0.0), float(0.05), vT))
        .mul(auroraDetailNoise(vec2(
            vSeed.mul(39.7).add(vU.mul(0.03)),
            vT.mul(2.6).sub(time.mul(0.045))).mul(8.0)).mul(0.55).add(0.72));
    const alpha = bright.mul(vBright).mul(night).mul(intensity);
    const keep = night.greaterThan(0.001).and(alpha.greaterThanEqual(0.0035));
    const colorNode = select(
        keep,
        vec4(vColor.mul(night.mul(0.45).add(0.75)), alpha),
        vec4(0.0, 0.0, 0.0, 0.0));

    // Explicit log depth from the true billboarded view Z (see the
    // module header): three's own formula, exact input. The
    // billboard offset is view-XY only, so viewPos.z is the view Z
    // of every fragment on the sprite.
    const vViewZ = varying(viewPos.z);
    const depthNode = options.logDepth === false
        ? null
        : viewZToLogarithmicDepth(vViewZ, cameraNear, cameraFar);

    return {
        vertexNode: clipPos,
        colorNode,
        depthNode
    };
}

// Aurora shell: AURORA_VERTEX + AURORA_FRAGMENT from
// planet-factory.js (the createPlanetAurora modes 1/2 path).
// Value-noise FBM oval (mode 1) or whole-shell flicker
// (mode 2), night-side masked. The mode is a build-time
// branch here: production's uMode is set once from the
// profile and never changes, and its GLSL strand branch
// (uMode <= 0.5) is unreachable in the shell -- mode 0
// routes to the sprites above, and the shell geometry
// carries no aLon/aH attributes for it to read -- so that
// branch is documented dead code and not ported; passing
// mode <= 0.5 throws. The fragment's vWorldNormal/viewDir
// locals are likewise computed but never used in
// production, and are not reproduced. Production discards
// (night <= .001, then a < .0035) become a keep select
// emitting transparent black, equivalent under the
// material's additive blending and disabled depth write
// (the sprite precedent). Options mirror the production
// uniform set; pass uniform nodes for the animated ones
// (time, intensity, sunWorldPos -- frame-loop.js writes
// now/1000, gain*fade*lift, and the lighting origin). The
// caller owns the material (production settings:
// transparent, no depth write, depth test on, additive
// blending, double side, tone mapping off) and the
// BodyShapes geometry, which stays JavaScript. No
// depthNode is needed: the shell vertex is the standard
// transform, so the renderer's own depth path applies.
// tools/p5aurorashell.mjs proves this factory plus the
// derivation below.

export const auroraHash = Fn(([p]) => {
    const q = fract(p.mul(0.3183099).add(vec3(0.1, 0.17, 0.13))).mul(17.0).toVar();
    return fract(q.x.mul(q.y).mul(q.z).mul(q.x.add(q.y).add(q.z)));
});

export const auroraNoise = Fn(([p]) => {
    const i = floor(p).toVar();
    const f0 = fract(p).toVar();
    const f = f0.mul(f0).mul(f0.mul(-2.0).add(3.0)).toVar();
    const c000 = auroraHash(i);
    const c100 = auroraHash(i.add(vec3(1.0, 0.0, 0.0)));
    const c010 = auroraHash(i.add(vec3(0.0, 1.0, 0.0)));
    const c110 = auroraHash(i.add(vec3(1.0, 1.0, 0.0)));
    const c001 = auroraHash(i.add(vec3(0.0, 0.0, 1.0)));
    const c101 = auroraHash(i.add(vec3(1.0, 0.0, 1.0)));
    const c011 = auroraHash(i.add(vec3(0.0, 1.0, 1.0)));
    const c111 = auroraHash(i.add(vec3(1.0, 1.0, 1.0)));
    return mix(
        mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
        mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y),
        f.z);
});

function auroraFbm(point) {
    return Fn(([p]) => {
        const v = float(0.0).toVar();
        const a = float(0.5).toVar();
        const q = p.toVar();
        Loop(4, () => {
            v.addAssign(a.mul(auroraNoise(q)));
            q.assign(q.mul(2.03).add(vec3(11.3, 7.1, 5.7)));
            a.mulAssign(0.5);
        });
        return v;
    })(point);
}

export function createAuroraShell(options = {}) {
    const mode = options.mode === undefined ? 1 : options.mode;
    if (!(mode > 0.5)) {
        throw new Error("createAuroraShell: mode <= 0.5 is the sprite path -- use createAuroraSprite");
    }
    const time = asFloatNode(options.time, 0.0);
    const intensity = asFloatNode(options.intensity, 0.0);
    const sunWorldPos = asVec3Node(options.sunWorldPos, [0.0, 0.0, 0.0]);
    const colorA = asVec3Node(options.colorA, [0.0, 0.0, 0.0]);
    const colorB = asVec3Node(options.colorB, [0.0, 0.0, 0.0]);
    const colorC = asVec3Node(options.colorC, [0.0, 0.0, 0.0]);
    const ovalLat = asFloatNode(options.ovalLat, 0.0);
    const ovalWidth = asFloatNode(options.ovalWidth, 1.0);
    const seed = asFloatNode(options.seed, 0.0);

    // Production varyings: local direction (the raw geometry
    // position) and the body centre; world position is the
    // standard node varying of the same per-vertex value.
    const localDir = varying(positionGeometry);
    const bodyCenter = varying(modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz);

    const dir = normalize(localDir);
    const sunDir = normalize(sunWorldPos.sub(bodyCenter));
    const outDir = normalize(positionWorld.sub(bodyCenter));
    const night = float(1.0).sub(
        smoothstep(float(-0.4), float(0.3), dot(outDir, sunDir)));

    let shape, col;
    if (mode > 1.5) {
        shape = auroraFbm(dir.mul(3.0).add(vec3(seed, time.mul(0.02), 0.0)))
            .mul(0.4).add(0.8);
        col = colorA;
    } else {
        const lat = asin(clamp(dir.y, float(-1.0), float(1.0)));
        const p = auroraFbm(dir.mul(4.2).add(vec3(seed)).add(vec3(0.0, time.mul(0.008), 0.0)));
        const hemisphere = exp(
            pow(lat.sub(ovalLat).div(ovalWidth), float(2.0)).mul(-1.0));
        shape = smoothstep(float(0.55), float(0.78), p)
            .mul(hemisphere)
            .mul(auroraNoise(dir.mul(9.0).add(vec3(0.0, 0.0, time.mul(0.03))))
                .mul(0.6).add(0.7));
        col = mix(colorA, colorB, auroraNoise(dir.mul(6.0).add(vec3(seed))));
    }

    const alpha = shape.mul(night).mul(intensity);
    const keep = night.greaterThan(0.001).and(alpha.greaterThanEqual(0.0035));
    const colorNode = select(
        keep,
        vec4(col.mul(night.mul(0.45).add(0.75)), alpha),
        vec4(0.0, 0.0, 0.0, 0.0));

    return { colorNode };
}

// createPlanetAurora install derivation: what the production
// factory decides from plain values (key, profile, mesh
// geometry radius, BodyShapes axes) -- the branch selection
// (mode 0 sprites, modes 1/2 shell), every install-time
// uniform value, the geometry request, and the shared
// material/mesh settings. Returns null exactly where
// production returns null for value reasons (no profile, or
// radius not > 0); the mesh-null and duplicate-key guards
// are scene state, not values, and stay with the caller.
// The profile table itself (AURORA_PROFILES) stays
// JavaScript data owned by planet-factory.js at the flip.
export function derivePlanetAuroraInstall(options = {}) {
    const profile = options.profile;
    if (!profile) return null;
    const radius = options.radius;
    if (!(radius > 0)) return null;
    const key = options.key;
    const material = {
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: "additive",
        side: "double",
        toneMapped: false
    };
    const seed = (key.length * 7.13) % 10;
    if (profile.mode === 0) {
        const axes = options.axesKm;
        const am = axes ? Math.max(...axes) : 1;
        return {
            branch: "sprites",
            geometry: { kind: "aurora-sprites", perPole: 260, instanceCount: 260 * 2, boundingRadius: radius * 2 },
            uniforms: {
                uTime: 0,
                uIntensity: 0,
                uSunWorldPos: [0.0, 0.0, 0.0],
                uColorA: [...profile.colorA],
                uColorB: [...profile.colorB],
                uColorC: [...profile.colorC],
                uSeed: seed,
                uBaseR: radius * 1.008,
                uHeight: radius * (profile.height || 0.08) * 2.1,
                uWidth: 2 * Math.PI * radius * Math.cos(profile.ovalLat) / 260 * 2.3,
                uAxes: axes ? [axes[0] / am, axes[2] / am, axes[1] / am] : [1.0, 1.0, 1.0]
            },
            material,
            rotation: [profile.tiltX, 0, profile.tiltZ],
            renderOrder: 7,
            frustumCulled: false,
            gain: profile.gain
        };
    }
    return {
        branch: "shell",
        geometry: { kind: "body-shape", radius: radius * profile.shell, widthSegments: 160, heightSegments: 112 },
        uniforms: {
            uTime: 0,
            uIntensity: 0,
            uSunWorldPos: [0.0, 0.0, 0.0],
            uColorA: [...profile.colorA],
            uColorB: [...profile.colorB],
            uColorC: [...profile.colorC],
            uOvalLat: profile.ovalLat,
            uOvalWidth: profile.ovalWidth,
            uMode: profile.mode,
            uSeed: seed
        },
        material,
        rotation: [profile.tiltX, 0, profile.tiltZ],
        renderOrder: 7,
        frustumCulled: false,
        gain: profile.gain
    };
}

// Saturn ring gaps: the alpha arithmetic of the onBeforeCompile
// patch createPlanetMesh installs at #include <alphamap_fragment>
// in planet-factory.js. Production reads vMapUv.y -- the ring's
// radial coordinate (createRingGeometry writes uv.y = 0 at the
// inner edge, 1 at the outer, and the saturn-ring map transform
// is identity) -- and multiplies diffuseColor.a by
// 1 - depth * max(cassini, encke), each band a smoothstep box with
// half-width soft. The node caller multiplies the same factor into
// the ring material's alpha slot; pass ringV explicitly if the
// map transform is ever not identity. Defaults are production's
// Saturn constants (real Cassini division and Encke gap
// positions in ring-UV space). tools/p5ringgaps.mjs renders this
// against the extracted production patch block on both node
// backends.

export const SATURN_RING_GAPS = Object.freeze({
    cassini: [0.6893, 0.7516],
    encke: [0.9066, 0.911],
    depth: 0.92,
    soft: 0.012
});

export const ringGapBand = Fn(([v, band, soft]) => {
    return smoothstep(band.x.sub(soft), band.x.add(soft), v)
        .mul(float(1.0).sub(
            smoothstep(band.y.sub(soft), band.y.add(soft), v)));
});

export function createRingGaps(options = {}) {
    const ringV = options.ringV !== undefined ? options.ringV : uv().y;
    const cassini = asVec2Node(options.cassini, SATURN_RING_GAPS.cassini);
    const encke = asVec2Node(options.encke, SATURN_RING_GAPS.encke);
    const depth = asFloatNode(options.depth, SATURN_RING_GAPS.depth);
    const soft = asFloatNode(options.soft, SATURN_RING_GAPS.soft);

    const gap = max(
        ringGapBand(ringV, cassini, soft),
        ringGapBand(ringV, encke, soft));
    const gapFactor = float(1.0).sub(depth.mul(gap));

    return { gapFactor, gap };
}
