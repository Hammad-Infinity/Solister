import { Fn, float, abs, atan, clamp, exp, floor, log, max, mod, select, sign, smoothstep, sqrt } from "three/tsl";

// TSL counterpart of single-glow.glsl.js.
//
// These are the analytic column integrals behind the single-power glow used
// by the Sun corona. Keep the branch structure and log-space interpolation
// identical to SINGLE_GLOW_COLUMN_GLSL; tools/p3singleglow.mjs renders both
// forms and compares the frames.

const sgEven = Fn(([b, t, n]) => {
    const r2 = b.mul(b).add(t.mul(t));
    const atanTB = atan(t.div(b));
    const i1 = atanTB.div(b);
    const i2 = t.div(b.mul(b).mul(r2).mul(2.0))
        .add(atanTB.div(b.mul(b).mul(b).mul(2.0)));
    const i3 = t.div(b.mul(b).mul(r2).mul(r2).mul(4.0))
        .add(i2.mul(0.75).div(b.mul(b)));
    return select(n.lessThan(1.5), i1, select(n.lessThan(2.5), i2, i3));
});

const sgOdd = Fn(([b, t, n]) => {
    const r2 = b.mul(b).add(t.mul(t));
    const root = sqrt(max(r2, float(1e-12)));
    const j1 = t.div(b.mul(b).mul(root));
    const j2 = t.div(b.mul(b).mul(r2).mul(root).mul(3.0))
        .add(j1.mul(2.0 / 3.0).div(b.mul(b)));
    return select(n.lessThan(1.5), j1, j2);
});

const sgAntiderivAt = Fn(([b, t, pi]) => {
    const odd = mod(pi, float(2.0));
    const isOdd = odd.greaterThan(0.5);
    const n = select(isOdd, pi.sub(1.0).mul(0.5), pi.mul(0.5));
    return select(isOdd, sgOdd(b, t, n), sgEven(b, t, n));
});

const sgIndefinite = Fn(([b, t, p]) => {
    const k = clamp(floor(p.add(0.5)), float(3.0), float(6.0));
    const low = k.lessThan(3.5);
    const high = k.greaterThan(5.5);
    const p0 = select(low, float(3.0), select(high, float(6.0), k.sub(1.0)));
    const p1 = select(low, float(4.0), select(high, float(5.0), k));
    const p2 = select(low, float(5.0), select(high, float(4.0), k.add(1.0)));
    const a0 = sgAntiderivAt(b, t, p0);
    const a1 = sgAntiderivAt(b, t, p1);
    const a2 = sgAntiderivAt(b, t, p2);
    const l0 = log(max(abs(a0), float(1e-9)));
    const l1 = log(max(abs(a1), float(1e-9)));
    const l2 = log(max(abs(a2), float(1e-9)));
    const lp = l0.mul(p.sub(p1)).mul(p.sub(p2)).div(p0.sub(p1).mul(p0.sub(p2)))
        .add(l1.mul(p.sub(p0)).mul(p.sub(p2)).div(p1.sub(p0).mul(p1.sub(p2))))
        .add(l2.mul(p.sub(p0)).mul(p.sub(p1)).div(p2.sub(p0).mul(p2.sub(p1))));
    return sign(a0.add(a1).add(a2)).mul(exp(lp));
});

export const singleGlowColumn = Fn(([b, t0, t1, p]) => {
    const bb = max(b, float(0.03));
    const q = clamp(p, float(3.0), float(6.0));
    return max(sgIndefinite(bb, t1, q).sub(sgIndefinite(bb, t0, q)), float(0.0));
});

export const singleGlow = Fn(([b, t0, t1, p, edgeRatio, knee]) => {
    const col = singleGlowColumn(b, t0, t1, p);
    const glow = col.div(col.mul(knee).add(1.0));
    const transmittance = exp(col.mul(-0.035));
    const cut = float(1.0).sub(smoothstep(edgeRatio.mul(0.70), edgeRatio, b));
    return glow.mul(transmittance).mul(cut);
});

export function singleGlowClampPower(power) {
    return Math.max(3, Math.min(6, Number.isFinite(power) ? power : 4));
}
