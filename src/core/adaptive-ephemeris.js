import { SolarEphemerisLayer } from "./solar-ephemeris.js";

import { ALL_MOONS, PLANETS, SYSTEM_GM } from "../bodies/catalog.js";

import { utcToTDBSeconds, UTC_START, UTC_END_EXCLUSIVE } from "../bodies/small-bodies/neptune-core.js";

import { readCurve, readCurveDerivative } from "../sim/cache-curves.js";

const MOON_KEYS = Object.keys(ALL_MOONS);

const MOON_LIST = Object.values(ALL_MOONS);

const CASTERS = Object.fromEntries(PLANETS.map(key => [ key, MOON_LIST.filter(m => m.parent === key) ]));

function renderFrame() {
    const relative = {}, velocities = {}, positions = {}, orbits = {};
    for (const key of MOON_KEYS) {
        relative[key] = [ 0, 0, 0 ];
        velocities[key] = [ 0, 0, 0 ];
    }
    for (const key of PLANETS) {
        positions[key] = [ 0, 0, 0 ];
        orbits[key] = {
            U: [ 0, 0, 0 ],
            V: [ 0, 0, 0 ],
            e: 0,
            E: 0,
            position: [ 0, 0, 0 ],
            correction: [ 0, 0, 0 ]
        };
    }
    return {
        ms: NaN,
        et: NaN,
        relative: relative,
        velocities: velocities,
        positions: positions,
        orbits: orbits
    };
}

export class AdaptiveEphemerisLayer extends SolarEphemerisLayer {
    rebuild(...args) {
        this.blocks = [];
        this.returnedEpoch = null;
        this.lastStepSeconds = 0;
        this.effectiveRate = 0;
        this.cacheRate = Infinity;
        this.buffering = false;
        super.rebuild(...args);
    }
    ensureWorker() {
        if (this.worker) return;
        this.worker = new Worker(new URL("./adaptive-worker.js", import.meta.url));
        this.worker.onmessage = ({data: q}) => {
            const job = this.job;
            this.busy = false;
            if (!job || q.id !== job.id || job.generation !== this.generation) return;
            if (q.error) {
                this.error = q.error;
                console.error("Adaptive cache:", q.error);
                return;
            }
            if (q.type === "trajectory") {
                this.setPath(q.result);
                return;
            }
            const b = q.result, elapsed = Math.max(20, performance.now() - job.started);
            this.cacheRate = (b.endMs - b.startMs) / (elapsed * 4);
            this.blocks.push(b);
            this.blocks.sort((a, b) => a.startMs - b.startMs);
        };
        this.worker.onerror = e => {
            this.busy = false;
            this.error = e.message || "Adaptive worker failed";
        };
    }
    post(type, fields) {
        super.post(type, fields);
        this.job.started = performance.now();
    }
    status(code, message = "") {
        if (code === "ready") message = this.returnedEpoch >= UTC_END_EXCLUSIVE - 1 ? "End of local date range" : this.buffering ? "Buffering motion…" : "";
        if (code === "loading") message = "Preparing motion cache…";
        super.status(code, message);
    }
    blockAt(ms) {
        return this.blocks.find(b => ms >= b.startMs && ms <= b.endMs);
    }
    synthesize(b, ms) {
        if (!this._frames) {
            this._frames = [ renderFrame(), renderFrame() ];
            this._frameIndex = 0;
            this._orbitScratch = new Float64Array(9);
        }
        const s = this._frames[this._frameIndex];
        this._frameIndex = 1 - this._frameIndex;
        const et = utcToTDBSeconds(ms);
        s.ms = ms;
        s.et = et;
        const relative = s.relative, positions = s.positions, orbits = s.orbits;
        for (const key of MOON_KEYS) {
            readCurve(b.curves[key], et, relative[key]);
            readCurveDerivative(b.curves[key], et, s.velocities[key]);
        }
        for (const key of PLANETS) {
            const v = readCurve(b.curves[key], et, this._orbitScratch), o = orbits[key], c = o.correction;
            for (let i = 0; i < 3; i++) {
                o.U[i] = v[i];
                o.V[i] = v[i + 3];
                c[i] = 0;
            }
            o.e = v[6];
            o.E = Math.atan2(v[8], v[7]);
            if (key === "earth") for (let i = 0; i < 3; i++) c[i] = -relative.moon[i] / 82.300569074; else if (key === "neptune") readCurve(b.curves.neptuneCenter, et, c); else if (SYSTEM_GM[key]) for (const m of CASTERS[key]) for (let i = 0; i < 3; i++) c[i] -= relative[m.key][i] * m.gm / SYSTEM_GM[key];
            const x = Math.cos(o.E) - o.e, y = Math.sin(o.E);
            for (let i = 0; i < 3; i++) {
                o.position[i] = o.U[i] * x + o.V[i] * y;
                positions[key][i] = o.position[i] + c[i];
            }
        }
        return s;
    }
    reportReadyStatus() {
        this.status("ready");
    }
    update(ms, options = {}) {
        const b = this.blockAt(ms);
        if (b && this.snapshot?.ms !== ms) this.snapshot = this.synthesize(b, ms);
        const busy = this.busy;
        this.busy = true;
        super.update(ms, options);
        this.busy = busy;
        return this.available;
    }
    requestBlock(start, rate) {
        if (start >= UTC_END_EXCLUSIVE - 1) return;
        const span = Math.min(1728e5, Math.max(36e5, Math.abs(rate) * 6e3));
        this.post("cache", {
            startMs: start,
            endMs: Math.min(UTC_END_EXCLUSIVE - 1, start + span)
        });
    }
    requestBlockBack(endMs, rate) {
        const span = Math.min(1728e5, Math.max(36e5, Math.abs(rate) * 6e3));
        const start = Math.max(UTC_START, endMs - span);
        if (start >= endMs) return;
        this.post("cache", {
            startMs: start,
            endMs: endMs
        });
    }
    tick(ms, delta, requestedRate, paused, options = {}) {
        this.lastStepSeconds = 0;
        if (this.returnedEpoch !== null && Math.abs(ms - this.returnedEpoch) > 1e-4) {
            this.generation++;
            this.blocks = [];
            this.snapshot = null;
            this.applied = null;
            this.available = false;
            this.effectiveRate = 0;
            for (const p of this.paths.values()) {
                this.solarSystem.remove(p.line);
                p.line.geometry.dispose();
                p.line.material.dispose();
            }
            this.paths.clear();
        }
        if (ms < UTC_START || ms >= UTC_END_EXCLUSIVE || !Number.isFinite(ms)) {
            this.update(ms, options);
            this.returnedEpoch = ms;
            return ms;
        }
        const b = this.blockAt(ms);
        let shown = ms;
        let limit = this.cacheRate;
        const parent = ALL_MOONS[options.focusedKey]?.parent || options.focusedKey;
        for (const m of MOON_LIST) if (m.parent === parent) limit = Math.min(limit, m.periodDays * 86400 / (2 * Math.PI) * .04 / Math.max(delta, 1 / 240));
        if (options.focusedKey === "asteroidbelt") limit = Math.min(limit, options.beltCloseUp ? 120 : Math.pow(2.1, 1.5) * 31557600 / (2 * Math.PI) * .04 / Math.max(delta, 1 / 240));
        const dir = requestedRate < 0 ? -1 : 1;
        const target = dir * Math.min(Math.abs(requestedRate), limit);
        this.effectiveRate += (target - this.effectiveRate) * Math.min(1, Math.max(0, delta) * 4);
        this.effectiveRate = dir * Math.min(Math.abs(this.effectiveRate), limit);
        this.buffering = !b;
        if (b && !paused) {
            const proposed = Math.max(UTC_START, Math.min(UTC_END_EXCLUSIVE - 1, ms + Math.max(0, delta) * 1e3 * this.effectiveRate));
            const covering = this.blockAt(proposed);
            shown = covering ? proposed : this.effectiveRate < 0 ? Math.max(proposed, b.startMs) : Math.min(proposed, b.endMs);
            this.buffering = this.effectiveRate < 0 ? proposed < shown : proposed > shown;
        }
        this.lastStepSeconds = (shown - ms) / 1e3;
        this.update(shown, options);
        this.returnedEpoch = shown;
        this.blocks = this.blocks.filter(x => x.endMs >= shown - 1);
        if (!this.busy && !this.error) {
            const current = this.blockAt(shown), last = this.blocks[this.blocks.length - 1];
            if (!current) this.requestBlock(Math.max(UTC_START, shown - Math.min(1728e5, Math.max(36e5, Math.abs(requestedRate) * 6e3))), requestedRate); else if (this.effectiveRate < 0 && (!this.blocks[0] || shown - this.blocks[0].startMs < (this.blocks[0].endMs - this.blocks[0].startMs) * .75) && this.blocks.length < 3) this.requestBlockBack(this.blocks[0] ? this.blocks[0].startMs : shown, requestedRate); else if (!paused && (!last || last.endMs - shown < (last.endMs - last.startMs) * .75) && this.blocks.length < 3) this.requestBlock(last.endMs, requestedRate); else if (this.pendingPaths.length) this.post("trajectory", {
                key: this.pendingPaths[0],
                et: this.snapshot.et
            });
        }
        return shown;
    }
}
