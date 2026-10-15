import { describeCometAppearance, cometActivityAtDistance } from "./comet-appearance.js";

export const COMET_START_MS = Date.UTC(1800, 0, 3);

export const COMET_END_MS = Date.UTC(2199, 11, 29);

export const SOLAR_MU = .0002959122082855911;

export function decodeCometData(meta, buffer) {
    if (meta.format !== "comet-states-v2-adaptive-f64le" || buffer.byteLength !== meta.bytes || buffer.byteLength % 8) throw Error("Invalid comet data size/format");
    const view = new DataView(buffer), values = new Float64Array(buffer.byteLength / 8);
    for (let i = 0; i < values.length; i++) {
        values[i] = view.getFloat64(i * 8, true);
        if (!Number.isFinite(values[i])) throw Error("Non-finite comet data");
    }
    const entries = new Map;
    let end = 0;
    for (const e of meta.entries) {
        if (!/^comet[0-9]+p$/.test(e.key) || entries.has(e.key) || e.offset !== end || !Number.isInteger(e.count) || e.count < 2) throw Error("Invalid comet table");
        end = e.offset + e.count * 7;
        if (end > values.length) throw Error("Truncated comet table");
        const array = values.subarray(e.offset, end);
        if (array[0] !== e.startJD || array[(e.count - 1) * 7] !== e.endJD) throw Error("Invalid comet coverage");
        for (let i = 1; i < e.count; i++) if (array[i * 7] <= array[(i - 1) * 7]) throw Error("Unsorted comet epochs");
        entries.set(e.key, {
            ...e,
            values: array
        });
    }
    if (end !== values.length || entries.size !== 4) throw Error("Unexpected comet dataset");
    return entries;
}

export function sampleComet(e, jd, out) {
    if (!Number.isFinite(jd) || jd < e.startJD || jd > e.endJD) return false;
    const v = e.values;
    let lo = 0, hi = e.count - 1;
    while (hi - lo > 1) {
        const m = lo + hi >> 1;
        if (v[m * 7] <= jd) lo = m; else hi = m;
    }
    const a = lo * 7, b = hi * 7, h = v[b] - v[a], u = (jd - v[a]) / h, u2 = u * u, u3 = u2 * u;
    for (let k = 0; k < 3; k++) {
        out[k] = (2 * u3 - 3 * u2 + 1) * v[a + 1 + k] + (u3 - 2 * u2 + u) * h * v[a + 4 + k] + (-2 * u3 + 3 * u2) * v[b + 1 + k] + (u3 - u2) * h * v[b + 4 + k];
        if (out.length >= 6) out[k + 3] = ((6 * u2 - 6 * u) * v[a + 1 + k] + (-6 * u2 + 6 * u) * v[b + 1 + k]) / h + (3 * u2 - 4 * u + 1) * v[a + 4 + k] + (3 * u2 - 2 * u) * v[b + 4 + k];
    }
    return true;
}

export function cometActivity(r, key = "", component = "coma") {
    return cometActivityAtDistance(r, key, component);
}

export function cometAppearance(r, out = {}, key = "") {
    return describeCometAppearance(r, key, out);
}

export function propagateDust(state, ageDays, beta, out) {
    let x = state[0], y = state[1], z = state[2], vx = state[3], vy = state[4], vz = state[5];
    const r = Math.hypot(x, y, z), speed = 3e-6;
    vx += speed * x / r;
    vy += speed * y / r;
    vz += speed * z / r;
    const n = Math.max(1, Math.ceil(ageDays / .25)), h = ageDays / n, mu = SOLAR_MU * (1 - beta);
    let f = -mu / Math.pow(r, 3), ax = f * x, ay = f * y, az = f * z;
    for (let i = 0; i < n; i++) {
        x += vx * h + .5 * ax * h * h;
        y += vy * h + .5 * ay * h * h;
        z += vz * h + .5 * az * h * h;
        f = -mu / Math.pow(Math.hypot(x, y, z), 3);
        const nx = f * x, ny = f * y, nz = f * z;
        vx += (ax + nx) * h * .5;
        vy += (ay + ny) * h * .5;
        vz += (az + nz) * h * .5;
        ax = nx;
        ay = ny;
        az = nz;
    }
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
}
