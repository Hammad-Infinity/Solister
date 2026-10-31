import {
    Fn,
    If,
    Loop,
    asin,
    attribute,
    clamp,
    cos,
    float,
    floor,
    log,
    max,
    min,
    pow,
    select,
    sin,
    sqrt,
    int,
    ivec2,
    textureLoad,
    uniform,
    vec2,
    vec3
} from "three/tsl";

// TSL counterpart for PROPAGATION_HEAD, the GPU analytic
// propagation library in smallbody-gpu.js. Ordinarily-free
// bodies advance node/perihelion by their secular rates;
// resonant bodies carry pendulum state (tadpole libration or
// horseshoe circulation) whose phase comes from a Jacobi
// amplitude evaluated through a harmonic-coefficient texture
// (Jacobi-elliptic theory, asteroid-theory.js). The packed
// attribute layout (ATTR), the packing functions and the
// harmonic texture itself stay JavaScript in
// smallbody-gpu.js -- consumers build them once and pass the
// texture in here. The classic file remains the production
// owner until the flip; tools/p5propagation.mjs renders this
// against the extracted production assembly (near-earth.js
// markers: PROPAGATION_HEAD + its real main) on both node
// backends. Consumers today: near-earth.js and
// resonant-populations.js.
//
// Vertex-buffer note (measured at P5e5): WebGPU guarantees
// only 8 vertex buffers, and production's deinterleaved
// attribute set (makeAttributes: six vec4 buffers) plus a
// quad corner buffer and a consumer's colour/size buffers
// exceeds it -- pipeline creation fails outright. Production's
// own packed layout is already a single interleaved buffer
// (packElements, 24 floats per body), so the node form
// consumes that buffer interleaved:
// createSmallBodyAttributes below builds the six attributes
// as views into it.
//
// Fetch form (settled at P5e6): production reads the
// harmonic table with a normalized-coordinate texture read
// at exact texel centres through a NearestFilter texture --
// exactly a texel fetch. The node form fetches directly
// (textureLoad, integer coordinates). The sampled form is
// numerically the same read, but on the unfilterable float
// table three r186 lowers vertex-stage samples to a manual
// load sequence keyed on a shared texture-size variable,
// and for mesh consumers (near-earth rocks) its fragment
// module then references that variable's texture binding
// without declaring it -- invalid WGSL, measured at P5e6.
// The fetch form avoids the size variable entirely.
//
// Two transcription notes. The Kepler Newton loop runs its
// fixed 8 iterations without production's early break: the
// break fires below |d| = 1e-13, under one fp32 ulp of the
// eccentric anomaly at these magnitudes, so the remaining
// iterations cannot change the value. And wrapSignedPi uses
// the floor form of the modulus, which is what the GLSL mod
// computes, rather than depending on target mod semantics.

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

// Build the propagation Fn. Options mirror the production
// uniform set (propagationUniforms in smallbody-gpu.js):
// days is the simulation epoch in days (per-frame write),
// au the scene units per AU, resP/resQ the resonance
// integers of the population, jupLambda/jupRate Jupiter's
// mean longitude and rate, harmSize the harmonic texture
// dimensions, and harmTexture the harmonic DataTexture
// (required: production always binds it). The returned
// propagateSmallBody Fn reads the six ATTR vec4 attributes
// and returns the scene position, exactly as
// propagateSmallBodyG does; the caller composes it into a
// vertex stage.
export function createSmallBodyPropagation(options = {}) {
    if (!options.harmTexture) {
        throw new Error("createSmallBodyPropagation needs options.harmTexture (production always binds it)");
    }
    const days = asFloatNode(options.days, 0.0);
    const au = asFloatNode(options.au, 1200.0);
    const resP = asFloatNode(options.resP, 1.0);
    const resQ = asFloatNode(options.resQ, 1.0);
    const jupLambda = asFloatNode(options.jupLambda, 0.0);
    const jupRate = asFloatNode(options.jupRate, 0.0014507);
    const harmSize = asVec2Node(options.harmSize, [32.0, 1.0]);
    const harmTex = options.harmTexture.isTexture ? options.harmTexture : options.harmTexture.value;

    const aEl1 = attribute("aEl1", "vec4");
    const aEl2 = attribute("aEl2", "vec4");
    const aEl3 = attribute("aEl3", "vec4");
    const aPend1 = attribute("aPend1", "vec4");
    const aPend2 = attribute("aPend2", "vec4");
    const aPend3 = attribute("aPend3", "vec4");

    const PI = float(3.14159265358979323846);
    const TAU = float(6.28318530717958647692);

    const wrapPi = (x) => x.sub(TAU.mul(floor(x.div(TAU))));

    const wrapSignedPi = (x) => {
        const shifted = x.add(PI).toVar();
        const wrapped = shifted.sub(TAU.mul(floor(shifted.div(TAU)))).toVar();
        return wrapped.sub(PI);
    };

    const fromMeanMotion = (n) => {
        const g2 = float(0.00029591220828559110);
        return pow(g2.div(max(float(1e-30), n.mul(n))), float(1.0).div(3.0));
    };

    const eccentricAnomaly = (M, e) => {
        const s = sin(M).toVar();
        const c = cos(M).toVar();
        const E = M.add(e.mul(s).mul(
            float(1.0).add(e.mul(c.sub(1.0)).mul(
                float(1.0).sub(e.mul(e).mul(0.25)))))).toVar();
        Loop(8, () => {
            const f = E.sub(e.mul(sin(E))).sub(M).toVar();
            const d = f.div(float(1.0).sub(e.mul(cos(E)))).toVar();
            E.assign(E.sub(d));
        });
        return E;
    };

    const positionFromElements = (a, e, incl, node, omega, M) => {
        const E = eccentricAnomaly(M, e).toVar();
        const xk = a.mul(cos(E).sub(e)).toVar();
        const yk = a.mul(sqrt(max(float(1e-12), float(1.0).sub(e.mul(e))))).mul(sin(E)).toVar();
        const cw = cos(omega).toVar(), sw = sin(omega).toVar();
        const co = cos(node).toVar(), so = sin(node).toVar();
        const ci = cos(incl).toVar(), si = sin(incl).toVar();
        const x = cw.mul(co).sub(sw.mul(so).mul(ci)).mul(xk)
            .add(sw.negate().mul(co).sub(cw.mul(so).mul(ci)).mul(yk)).toVar();
        const y = cw.mul(so).add(sw.mul(co).mul(ci)).mul(xk)
            .add(sw.negate().mul(so).add(cw.mul(co).mul(ci)).mul(yk)).toVar();
        const z = sw.mul(si).mul(xk).add(cw.mul(si).mul(yk)).toVar();
        return vec3(x, y, z);
    };

    const texelA = (row, k) =>
        textureLoad(harmTex, ivec2(int(k), int(row))).r;

    const jacobiAmp = (x, m) => {
        const rowsMinus1 = harmSize.y.sub(1.0).toVar();
        const f = clamp(
            log(float(1.0).div(max(float(1e-14), float(1.0).sub(m))))
                .div(log(10.0)).mul(rowsMinus1).div(6.0),
            float(0.0), rowsMinus1).toVar();
        const row = min(harmSize.y.sub(2.0), floor(f)).toVar();
        const w = f.sub(floor(f)).toVar();
        const frac = x.sub(floor(x)).toVar();
        const cycles = floor(x).toVar();
        const s0 = float(0.0).toVar();
        const s1 = float(0.0).toVar();
        Loop(32, ({ i }) => {
            const kf = float(i);
            const t = sin(TAU.mul(kf.add(1.0)).mul(frac)).toVar();
            s0.assign(s0.add(texelA(row, kf).mul(t)));
            s1.assign(s1.add(texelA(row.add(1.0), kf).mul(t)));
        });
        return PI.mul(frac)
            .add(float(1.0).sub(w).mul(s0))
            .add(w.mul(s1))
            .add(PI.mul(cycles));
    };

    const propagateSmallBody = Fn(() => {
        const a = aEl1.x.toVar();
        const e = aEl1.y.toVar();
        const incl = aEl1.z.toVar();
        const node0 = aEl1.w.toVar();
        const omega0 = aEl2.x.toVar();
        const M0 = aEl2.y.toVar();
        const nMean = aEl2.z.toVar();
        const nodeDot = aEl2.w.toVar();
        const omegaDot = aEl3.x.toVar();
        const epoch = aEl3.y.toVar();
        const kind = aEl3.z.toVar();
        const dt = days.sub(epoch).toVar();

        const node = node0.add(nodeDot.mul(dt)).toVar();
        const aOut = float(0.0).toVar();
        const omega = float(0.0).toVar();
        const M = float(0.0).toVar();

        If(kind.lessThan(0.5), () => {
            omega.assign(omega0.add(omegaDot.mul(dt)));
            M.assign(M0.add(nMean.mul(dt)));
            aOut.assign(a);
        }).Else(() => {
            const modulus = aPend1.x.toVar();
            const halfX0 = aPend1.y.toVar();
            const rateX = aPend1.z.toVar();
            const kOrOmega = aPend1.w.toVar();
            const sigma0 = aPend2.y.toVar();
            const peri0 = aPend2.z.toVar();
            const lambdaJ0 = aPend2.w.toVar();
            const sign = aPend3.x.toVar();
            const nu = aPend3.y.toVar();
            const periDot = aPend3.z.toVar();

            const halfX = halfX0.add(rateX.mul(dt)).toVar();
            const psi = jacobiAmp(halfX, modulus).toVar();
            const s = clamp(kOrOmega.mul(sin(psi)), float(-1.0), float(1.0)).toVar();
            const sn = sin(psi).toVar();
            const sigmaRaw = select(
                kind.lessThan(1.5),
                float(2.0).mul(asin(s)),
                float(2.0).mul(sign).mul(psi)).toVar();
            const sigmaDot = select(
                kind.lessThan(1.5),
                float(2.0).mul(nu).mul(kOrOmega).mul(cos(psi)),
                float(2.0).mul(kOrOmega)
                    .mul(sqrt(max(float(0.0), float(1.0).sub(modulus.mul(sn).mul(sn)))))
                    .mul(sign)).toVar();

            const nRes = resP.mul(jupRate.sub(periDot)).add(sigmaDot).div(resQ).toVar();
            aOut.assign(fromMeanMotion(clamp(nRes, float(1e-8), float(1.0))));
            const peri = peri0.add(periDot.mul(dt)).toVar();
            const dLamJ = jupRate.mul(dt)
                .add(wrapSignedPi(jupLambda.sub(wrapPi(lambdaJ0.add(jupRate.mul(dt)))))).toVar();
            const lam = wrapPi(M0.add(peri0).add(
                resP.mul(dLamJ)
                    .sub(resP.sub(resQ).mul(peri.sub(peri0)))
                    .add(sigmaRaw.sub(sigma0))
                    .div(resQ))).toVar();
            omega.assign(peri.sub(node));
            M.assign(wrapPi(lam.sub(peri)));
        });

        const ecl = positionFromElements(aOut, e, incl, node, omega, M).toVar();
        return vec3(ecl.x, ecl.z, ecl.y.mul(-1.0)).mul(au);
    });

    return {
        propagateSmallBody
    };
}

// The six propagation attributes as interleaved views over
// production's packed buffer (packElements in
// smallbody-gpu.js: 24 floats per body, ATTR order el1, el2,
// el3, pend1, pend2, pend3). One vertex buffer instead of
// six -- see the vertex-buffer note above. The namespace is
// injected, as the production helpers receive it. Set the
// returned attributes on an InstancedBufferGeometry under
// their aEl/aPend names.
export function createSmallBodyAttributes(T, packed, count) {
    const stride = 24;
    const buffer = new T.InstancedInterleavedBuffer(packed, stride);
    const names = ["aEl1", "aEl2", "aEl3", "aPend1", "aPend2", "aPend3"];
    const attrs = {};
    for (let i = 0; i < names.length; i++) {
        attrs[names[i]] = new T.InterleavedBufferAttribute(buffer, 4, i * 4);
    }
    buffer.instanceCount = count;
    return attrs;
}
