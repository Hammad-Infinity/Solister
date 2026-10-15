import { ALL_MOONS, PLANETS, SYSTEM_GM } from "../bodies/catalog.js";

export const PERIOD_DAYS = {
    mercury: 87.969,
    venus: 224.701,
    earth: 365.256,
    mars: 686.98,
    jupiter: 4332.59,
    saturn: 10759.22,
    uranus: 30688.5,
    neptune: 60182
};

export function pointAt(engine, nep, key, et) {
    if (ALL_MOONS[key]) return engine.moon(key, et);
    if (!PLANETS.includes(key)) throw new Error("Unknown trail body");
    const p = engine.planetElements(key, et).position.slice();
    if (key === "earth") {
        const m = engine.moon("moon", et);
        for (let i = 0; i < 3; i++) p[i] -= m[i] / 82.300569074;
    } else if (key === "neptune") {
        const c = nep.center.positionTDB(et);
        for (let i = 0; i < 3; i++) p[i] += c[i];
    } else if (SYSTEM_GM[key]) for (const [id, m] of Object.entries(ALL_MOONS)) if (m.parent === key) {
        const q = engine.moon(id, et);
        for (let i = 0; i < 3; i++) p[i] -= q[i] * m.gm / SYSTEM_GM[key];
    }
    return p;
}

export function history(engine, nep, key, et, minEt, maxEt) {
    const period = (ALL_MOONS[key]?.periodDays || PERIOD_DAYS[key]) * 86400;
    if (!Number.isFinite(et) || et < minEt || et > maxEt) throw new RangeError("Trail epoch outside local coverage");
    const start = Math.max(minEt, et - period * 1.15), end = Math.min(maxEt, et + period * .15);
    const steps = key === "moon" || PLANETS.includes(key) ? 1024 : 2048, refine = steps === 1024 ? 8 : 4;
    const t = [];
    for (let i = 0; i <= steps; i++) t.push(start + (end - start) * i / steps);
    t.push(et);
    t.sort((a, b) => a - b);
    const knots = t.filter((x, i) => i === 0 || x !== t[i - 1]), raw = knots.map(t => pointAt(engine, nep, key, t));
    if (!raw.every(p => p.every(Number.isFinite))) throw new Error("Non-finite trail point");
    const count = (knots.length - 1) * refine + 1, times = new Float64Array(count), points = new Float64Array(count * 3), lengths = new Float64Array(count);
    let index = 0;
    for (let j = 0; j < knots.length - 1; j++) for (let k = 0; k < refine; k++, index++) {
        const u = k / refine, u2 = u * u, u3 = u2 * u, dt = knots[j + 1] - knots[j], lo = Math.max(0, j - 1), hi = Math.min(knots.length - 1, j + 2);
        times[index] = knots[j] + u * dt;
        for (let d = 0; d < 3; d++) {
            const m0 = (raw[j + 1][d] - raw[lo][d]) / (knots[j + 1] - knots[lo]), m1 = (raw[hi][d] - raw[j][d]) / (knots[hi] - knots[j]);
            points[index * 3 + d] = (2 * u3 - 3 * u2 + 1) * raw[j][d] + (u3 - 2 * u2 + u) * dt * m0 + (-2 * u3 + 3 * u2) * raw[j + 1][d] + (u3 - u2) * dt * m1;
        }
    }
    times[index] = knots.at(-1);
    points.set(raw.at(-1), index * 3);
    for (let i = 1; i < count; i++) lengths[i] = lengths[i - 1] + Math.hypot(points[i * 3] - points[(i - 1) * 3], points[i * 3 + 1] - points[(i - 1) * 3 + 1], points[i * 3 + 2] - points[(i - 1) * 3 + 2]);
    let a, b;
    if (ALL_MOONS[key]) a = b = ALL_MOONS[key].aKm; else {
        const e = engine.planetElements(key, et);
        a = Math.hypot(...e.U);
        b = Math.hypot(...e.V);
    }
    const estimate = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    return {
        key: key,
        et: et,
        period: period,
        start: start,
        end: end,
        sourceSamples: knots.length,
        atEnd: end === maxEt,
        times: times,
        points: points,
        lengths: lengths,
        estimate: estimate
    };
}

export function lowerBound(a, x) {
    let lo = 0, hi = a.length;
    while (lo < hi) {
        const mid = lo + hi >>> 1;
        if (a[mid] < x) lo = mid + 1; else hi = mid;
    }
    return lo;
}

export function lengthAt(c, t) {
    const i = Math.max(1, Math.min(c.times.length - 1, lowerBound(c.times, t))), u = Math.max(0, Math.min(1, (t - c.times[i - 1]) / (c.times[i] - c.times[i - 1])));
    return c.lengths[i - 1] + u * (c.lengths[i] - c.lengths[i - 1]);
}
