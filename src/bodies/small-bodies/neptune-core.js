export const UTC_START = Date.UTC(1800, 0, 3);

export const UTC_END_EXCLUSIVE = Date.UTC(2199, 11, 29);

const J2000_UTC_MS = Date.UTC(2e3, 0, 1, 12);

const LEAPS = [ [ Date.UTC(1972, 0, 1), 10 ], [ Date.UTC(1972, 6, 1), 11 ], [ Date.UTC(1973, 0, 1), 12 ], [ Date.UTC(1974, 0, 1), 13 ], [ Date.UTC(1975, 0, 1), 14 ], [ Date.UTC(1976, 0, 1), 15 ], [ Date.UTC(1977, 0, 1), 16 ], [ Date.UTC(1978, 0, 1), 17 ], [ Date.UTC(1979, 0, 1), 18 ], [ Date.UTC(1980, 0, 1), 19 ], [ Date.UTC(1981, 6, 1), 20 ], [ Date.UTC(1982, 6, 1), 21 ], [ Date.UTC(1983, 6, 1), 22 ], [ Date.UTC(1985, 6, 1), 23 ], [ Date.UTC(1988, 0, 1), 24 ], [ Date.UTC(1990, 0, 1), 25 ], [ Date.UTC(1991, 0, 1), 26 ], [ Date.UTC(1992, 6, 1), 27 ], [ Date.UTC(1993, 6, 1), 28 ], [ Date.UTC(1994, 6, 1), 29 ], [ Date.UTC(1996, 0, 1), 30 ], [ Date.UTC(1997, 6, 1), 31 ], [ Date.UTC(1999, 0, 1), 32 ], [ Date.UTC(2006, 0, 1), 33 ], [ Date.UTC(2009, 0, 1), 34 ], [ Date.UTC(2012, 6, 1), 35 ], [ Date.UTC(2015, 6, 1), 36 ], [ Date.UTC(2017, 0, 1), 37 ] ];

export function ttSecondsToTDB(ttSeconds) {
    if (!Number.isFinite(ttSeconds)) throw new TypeError("TT must be finite seconds");
    let et = ttSeconds;
    for (let i = 0; i < 3; i++) {
        const mean = 6.239996 + 1.99096871e-7 * et;
        et = ttSeconds + .001657 * Math.sin(mean + .01671 * Math.sin(mean));
    }
    return et;
}

export function utcToTDBSeconds(dateOrMs, ttMinusUtcSeconds) {
    const ms = dateOrMs instanceof Date ? dateOrMs.getTime() : dateOrMs;
    if (!Number.isFinite(ms) || ms < UTC_START || ms >= UTC_END_EXCLUSIVE) {
        throw new RangeError("Local coverage: 1800-01-03 through 2199-12-28");
    }
    if (ttMinusUtcSeconds === undefined) {
        if (ms < LEAPS[0][0]) {
            if (!globalThis.Astronomy) throw new Error("Pre-1972 dates require the local Astronomy Engine time model");
            return ttSecondsToTDB(globalThis.Astronomy.MakeTime(new Date(ms)).tt * 86400);
        }
        let taiMinusUtc = 10;
        for (let i = 0; i < LEAPS.length; i++) {
            if (ms < LEAPS[i][0]) break;
            taiMinusUtc = LEAPS[i][1];
        }
        ttMinusUtcSeconds = taiMinusUtc + 32.184;
    }
    if (!Number.isFinite(ttMinusUtcSeconds)) throw new TypeError("Invalid TT-UTC offset");
    return ttSecondsToTDB((ms - J2000_UTC_MS) / 1e3 + ttMinusUtcSeconds);
}

export class NeptuneMoonTable {
    constructor(buffer) {
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 40) {
            throw new Error("Invalid/truncated Neptune ephemeris");
        }
        this.view = new DataView(buffer);
        const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 8));
        const v = this.view;
        if (magic !== "NEPMOON1" || v.getUint32(8, true) !== 1) {
            throw new Error("Unsupported Neptune ephemeris format");
        }
        this.degree = v.getUint32(12, true);
        this.count = v.getUint32(16, true);
        this.recordBytes = v.getUint32(20, true);
        this.start = v.getFloat64(24, true);
        this.end = v.getFloat64(32, true);
        if (this.degree !== 16 || !this.count || this.recordBytes !== 40 + 12 * this.degree || buffer.byteLength !== 40 + this.count * this.recordBytes) {
            throw new Error("Invalid Neptune ephemeris layout");
        }
        this.starts = new Float64Array(this.count);
        this.ends = new Float64Array(this.count);
        let previous = this.start;
        for (let i = 0; i < this.count; i++) {
            const offset = 40 + i * this.recordBytes;
            const start = v.getFloat64(offset, true);
            const end = v.getFloat64(offset + 8, true);
            if (start !== previous || !(end > start)) {
                throw new Error("Non-contiguous Neptune ephemeris");
            }
            this.starts[i] = start;
            this.ends[i] = end;
            previous = end;
        }
        if (previous !== this.end) throw new Error("Invalid ephemeris end");
        this.lastIndex = 0;
    }
    positionTDB(seconds, out = new Float64Array(3)) {
        if (!Number.isFinite(seconds) || seconds < this.start || seconds > this.end) {
            throw new RangeError("TDB epoch outside local Neptune ephemeris");
        }
        let index = this.lastIndex;
        if (seconds < this.starts[index] || seconds > this.ends[index]) {
            let low = 0, high = this.count;
            while (low < high) {
                const middle = low + high >>> 1;
                if (this.starts[middle] <= seconds) low = middle + 1; else high = middle;
            }
            index = Math.max(0, low - 1);
            this.lastIndex = index;
        }
        const start = this.starts[index], end = this.ends[index];
        const x = (seconds - (start + end) * .5) / ((end - start) * .5);
        const offset = 40 + index * this.recordBytes;
        const v = this.view, degree = this.degree;
        for (let axis = 0; axis < 3; axis++) {
            const higher = offset + 40 + axis * degree * 4;
            let b1 = 0, b2 = 0;
            for (let k = degree; k >= 1; k--) {
                const b0 = 2 * x * b1 - b2 + v.getFloat32(higher + (k - 1) * 4, true);
                b2 = b1;
                b1 = b0;
            }
            out[axis] = x * b1 - b2 + v.getFloat64(offset + 16 + axis * 8, true);
        }
        return out;
    }
}

export class NeptuneEphemeris {
    constructor(tritonBuffer, nereidBuffer, centerBuffer) {
        this.triton = new NeptuneMoonTable(tritonBuffer);
        this.nereid = new NeptuneMoonTable(nereidBuffer);
        this.center = centerBuffer ? new NeptuneMoonTable(centerBuffer) : null;
    }
    positionTDB(name, seconds, out) {
        if (name !== "triton" && name !== "nereid") throw new Error("Unknown Neptune moon");
        return this[name].positionTDB(seconds, out);
    }
    positionUTC(name, dateOrMs, out, ttMinusUtcSeconds) {
        return this.positionTDB(name, utcToTDBSeconds(dateOrMs, ttMinusUtcSeconds), out);
    }
}

let defaultLoad;

export function loadNeptuneEphemeris() {
    if (!defaultLoad) {
        defaultLoad = Promise.all([ "triton", "nereid", "neptune-center" ].map(async name => {
            const url = new URL(`../../../data/neptune/${name}-1800-2199.bin`, import.meta.url);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Cannot load ${name}: HTTP ${response.status}`);
            return response.arrayBuffer();
        })).then(([triton, nereid, center]) => new NeptuneEphemeris(triton, nereid, center)).catch(error => {
            defaultLoad = undefined;
            throw error;
        });
    }
    return defaultLoad;
}
