import { ALL_MOONS, PLANETS, SYSTEM_GM } from "../bodies/catalog.js";

import { utcToTDBSeconds } from "../bodies/small-bodies/neptune-core.js";

const DAY = 86400, AU = 149597870.7, EPS = 84381.448 * Math.PI / (180 * 3600);

export function tdbToTT(et) {
    const m = 6.239996 + 1.99096871e-7 * et;
    return et - .001657 * Math.sin(m + .01671 * Math.sin(m));
}

export function createEngine(g, neptune) {
    const R = g.TheoryRuntime, A = g.Astronomy;
    const models = {
        mercury: g.vsop2013.mer,
        venus: g.vsop2013.ven,
        earth: g.vsop2013.emb,
        mars: g.vsop2013.mar,
        jupiter: g.top2013.jup,
        saturn: g.top2013.sat,
        uranus: g.top2013.ura,
        neptune: g.top2013.nep
    };
    let jovianEpoch = NaN, jovians;
    function moon(key, et) {
        if (key === "moon") return R.lunarPosition(tdbToTT(et));
        if (key === "triton" || key === "nereid") return Array.from(neptune.positionTDB(key, et));
        const info = ALL_MOONS[key];
        if (!info) throw new Error("Unknown moon: " + key);
        if (info.parent === "jupiter") {
            if (et !== jovianEpoch) {
                jovians = A.JupiterMoons(A.AstroTime.FromTerrestrialTime(tdbToTT(et) / DAY));
                jovianEpoch = et;
            }
            const p = jovians[key];
            return [ p.x * AU, (Math.cos(EPS) * p.y + Math.sin(EPS) * p.z) * AU, (-Math.sin(EPS) * p.y + Math.cos(EPS) * p.z) * AU ];
        }
        const model = g.martian[key] || g.saturnian[key] || g.uranian[key];
        return R.elements(model, et).position;
    }
    function epoch(ms, ttMinusUtcSeconds) {
        if (ttMinusUtcSeconds === undefined && ms < Date.UTC(1972, 0, 1)) ttMinusUtcSeconds = A.MakeTime(new Date(ms)).tt * DAY - (ms - Date.UTC(2e3, 0, 1, 12)) / 1e3;
        return utcToTDBSeconds(ms, ttMinusUtcSeconds);
    }
    function snapshot(ms, ttMinusUtcSeconds) {
        const et = epoch(ms, ttMinusUtcSeconds), relative = {}, positions = {}, orbits = {};
        for (const key of Object.keys(ALL_MOONS)) relative[key] = moon(key, et);
        for (const key of PLANETS) {
            const el = R.elements(models[key], et), correction = [ 0, 0, 0 ];
            if (key === "earth") for (let i = 0; i < 3; i++) correction[i] = -relative.moon[i] / 82.300569074; else if (key === "neptune") correction.splice(0, 3, ...neptune.center.positionTDB(et)); else if (SYSTEM_GM[key]) {
                for (const [id, info] of Object.entries(ALL_MOONS)) if (info.parent === key) for (let i = 0; i < 3; i++) correction[i] -= relative[id][i] * info.gm / SYSTEM_GM[key];
            }
            positions[key] = el.position.map((v, i) => v + correction[i]);
            orbits[key] = {
                U: el.U,
                V: el.V,
                e: el.e,
                E: el.E,
                correction: correction
            };
        }
        return {
            ms: ms,
            et: et,
            positions: positions,
            relative: relative,
            orbits: orbits
        };
    }
    function trajectory(key, et) {
        const info = ALL_MOONS[key], period = info.periodDays * DAY;
        const start = Math.max(neptune.triton.start, et - period / 2), end = Math.min(neptune.triton.end, et + period / 2);
        const tolerance = Math.max(.05, Math.min(info.aKm / 5e3, info.radiusKm * .05)), points = [];
        let limited = false;
        function segment(a, pa, b, pb, depth) {
            const mid = (a + b) / 2, pm = moon(key, mid);
            const error = Math.hypot(...pm.map((x, i) => x - (pa[i] + pb[i]) / 2));
            if (error > tolerance && depth < 10 && points.length < 4090) {
                segment(a, pa, mid, pm, depth + 1);
                segment(mid, pm, b, pb, depth + 1);
            } else {
                if (error > tolerance) limited = true;
                points.push(pb);
            }
        }
        const times = [];
        for (let i = 0; i <= 32; i++) times.push(start + (end - start) * i / 32);
        times.push(et);
        times.sort((a, b) => a - b);
        let a = times[0], pa = moon(key, a);
        points.push(pa);
        for (const b of times.slice(1)) {
            if (b === a) continue;
            const pb = moon(key, b);
            segment(a, pa, b, pb, 0);
            a = b;
            pa = pb;
        }
        const array = new Float64Array(points.length * 3);
        points.forEach((p, i) => array.set(p, i * 3));
        return {
            key: key,
            et: et,
            start: start,
            end: end,
            points: array,
            toleranceKm: tolerance,
            pointLimitReached: limited
        };
    }
    return {
        snapshot: snapshot,
        trajectory: trajectory,
        moon: moon,
        epoch: epoch,
        planetElements: (key, et) => R.elements(models[key], et)
    };
}
