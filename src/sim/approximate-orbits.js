export const DATA_START = Date.UTC(1800, 0, 3), DATA_END = Date.UTC(2199, 11, 29);

export const outsideData = ms => Number.isFinite(ms) && (ms < DATA_START || ms >= DATA_END);

export const validDate = ms => Number.isFinite(ms) && Math.abs(ms) <= 864e13;

export function makeKepler(state, epoch, mu) {
    const [x, y, z, vx, vy, vz] = state, r = Math.hypot(x, y, z), v2 = vx * vx + vy * vy + vz * vz;
    const hx = y * vz - z * vy, hy = z * vx - x * vz, hz = x * vy - y * vx, h = Math.hypot(hx, hy, hz);
    const a = 1 / (2 / r - v2 / mu);
    if (!(r > 0 && h > 0 && a > 0 && mu > 0)) return null;
    const ex = (vy * hz - vz * hy) / mu - x / r, ey = (vz * hx - vx * hz) / mu - y / r, ez = (vx * hy - vy * hx) / mu - z / r, e = Math.hypot(ex, ey, ez);
    if (!Number.isFinite(a) || !Number.isFinite(e) || e >= 1) return null;
    const P = e > 1e-10 ? [ ex / e, ey / e, ez / e ] : [ x / r, y / r, z / r ], Q = [ (hy * P[2] - hz * P[1]) / h, (hz * P[0] - hx * P[2]) / h, (hx * P[1] - hy * P[0]) / h ];
    const b = a * Math.sqrt(1 - e * e), U = P.map(x => x * a), V = Q.map(x => x * b), E = Math.atan2((x * Q[0] + y * Q[1] + z * Q[2]) / b, (x * P[0] + y * P[1] + z * P[2]) / a + e), n = Math.sqrt(mu / (a * a * a));
    if (![ ...U, ...V, n, E ].every(Number.isFinite) || !(n > 0)) return null;
    return {
        epoch: epoch,
        mu: mu,
        a: a,
        e: e,
        U: U,
        V: V,
        M: E - e * Math.sin(E),
        n: n,
        period: Math.PI * 2 / n
    };
}

export function advanceKepler(o, time, out) {
    if (!o || !Number.isFinite(time)) return false;
    const tau = Math.PI * 2, M = ((o.M + (time - o.epoch) % o.period * o.n + Math.PI) % tau + tau) % tau - Math.PI;
    let E = o.e > .8 ? M < 0 ? -Math.PI : Math.PI : M;
    for (let i = 0; i < 40; i++) {
        const d = (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
        E -= d;
        if (Math.abs(d) < 1e-13) break;
    }
    if (!Number.isFinite(E) || Math.abs(E - o.e * Math.sin(E) - M) > 1e-9) return false;
    const c = Math.cos(E), s = Math.sin(E), rate = o.n / (1 - o.e * c);
    for (let i = 0; i < 3; i++) {
        out[i] = o.U[i] * (c - o.e) + o.V[i] * s;
        if (out.length >= 6) out[i + 3] = rate * (-o.U[i] * s + o.V[i] * c);
    }
    if (!Array.from(out).every(Number.isFinite)) return false;
    o.lastE = E;
    return true;
}

const cache = new WeakMap;

export function extrapolateTable(table, time, start, end, sampler, mu, out) {
    if (!table || !Number.isFinite(time)) return false;
    const side = time < (start + end) / 2 ? "before" : "after", epoch = side === "before" ? start : end;
    let entries = cache.get(table);
    if (!entries) {
        entries = {};
        cache.set(table, entries);
    }
    const key = side + ":" + mu;
    if (!(key in entries)) {
        const state = new Float64Array(6);
        entries[key] = sampler(table, epoch, state) ? makeKepler(state, epoch, mu) : null;
    }
    return advanceKepler(entries[key], time, out);
}
