importScripts("../sim/theory-runtime.js");

let engine, nep, fitCurve, catalog;

const ready = (async () => {
    importScripts("../../vendor/astronomy.browser.min.js", "../../vendor/theories/vsop2013.js", "../../vendor/theories/top2013.js", "../../vendor/theories/elpmpp02.js", "../../vendor/theories/martians.sat.js", "../../vendor/theories/saturnians.tass17.js", "../../vendor/theories/uranians.gust86.js");
    const [e, n, c, k] = await Promise.all([ import("./engine.js"), import("../bodies/small-bodies/neptune-core.js"), import("../sim/cache-curves.js"), import("../bodies/catalog.js") ]);
    nep = await n.loadNeptuneEphemeris();
    engine = e.createEngine(globalThis, nep);
    fitCurve = c.fitCurve;
    catalog = k;
})();

ready.catch(() => {});

self.onmessage = async ({data: q}) => {
    try {
        await ready;
        if (q.type === "trajectory") {
            const result = engine.trajectory(q.key, q.et);
            postMessage({
                id: q.id,
                type: q.type,
                result: result
            }, [ result.points.buffer ]);
            return;
        }
        if (q.type !== "cache") throw new Error("Unknown adaptive worker request");
        const begin = performance.now(), t0 = engine.epoch(q.startMs), t1 = engine.epoch(q.endMs), curves = {};
        for (const key of catalog.PLANETS) {
            curves[key] = fitCurve(t => {
                const e = engine.planetElements(key, t);
                return [ ...e.U, ...e.V, e.e, Math.cos(e.E), Math.sin(e.E) ];
            }, t0, t1, 86400, 1, true);
        }
        for (const [key, m] of Object.entries(catalog.ALL_MOONS)) curves[key] = fitCurve(t => engine.moon(key, t), t0, t1, m.periodDays * 86400 / 8, m.parent === "neptune" ? .25 : Math.min(.1, m.radiusKm * .001));
        curves.neptuneCenter = fitCurve(t => Array.from(nep.center.positionTDB(t)), t0, t1, 43200, .1);
        const result = {
            startMs: q.startMs,
            endMs: q.endMs,
            t0: t0,
            t1: t1,
            curves: curves,
            buildMilliseconds: performance.now() - begin
        };
        postMessage({
            id: q.id,
            type: q.type,
            result: result
        }, Object.values(curves).map(c => c.records.buffer));
    } catch (e) {
        postMessage({
            id: q.id,
            type: q.type,
            error: String(e?.stack || e)
        });
    }
};
