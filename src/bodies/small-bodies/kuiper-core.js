export const J2000 = 2451545;
export const AU_KM = 149597870.7;
export const DAY = 86400;
const TAU = Math.PI * 2;
export class KuiperTable {
    constructor(buffer, meta) {
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 40) throw Error('Truncated Kuiper ephemeris');
        const view = new DataView(buffer);
        const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 8));
        if (magic !== 'KBOHERM1' || view.getUint32(8, true) !== 1) throw Error('Unsupported Kuiper ephemeris');
        this.count = view.getUint32(12, true);
        this.samples = view.getUint32(16, true);
        this.startJD = view.getFloat64(24, true);
        this.stepDays = view.getFloat64(32, true);
        if (!meta || meta.format !== 'kuiper-hermite-v1' || this.count !== meta.count
            || this.samples !== meta.samplesPerBody || this.startJD !== meta.startJD
            || this.stepDays !== meta.stepDays || meta.objects?.length !== this.count
            || this.samples < 2 || this.count < 1 || !(this.stepDays > 0)
            || buffer.byteLength !== 40 + this.count * this.samples * 6 * 8)
            throw Error('Kuiper metadata/data mismatch');
        this.meta = meta;
        this.startEt = (meta.coverageStartJD - J2000) * DAY;
        this.endEt = (meta.coverageEndJD - J2000) * DAY;
        if (!Number.isFinite(this.startEt) || !Number.isFinite(this.endEt) || this.endEt <= this.startEt
            || meta.coverageStartJD < this.startJD
            || meta.coverageEndJD > this.startJD + (this.samples - 1) * this.stepDays)
            throw Error('Invalid Kuiper coverage');
        const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
        if (littleEndian) this.values = new Float64Array(buffer, 40);
        else {
            this.values = new Float64Array(this.count * this.samples * 6);
            for (let i = 0; i < this.values.length; i++) this.values[i] = view.getFloat64(40 + i * 8, true);
        }
        if (!this.values.every(Number.isFinite)) throw Error('Non-finite Kuiper trajectory');
    }
    inCoverage(et) { return Number.isFinite(et) && et >= this.startEt && et <= this.endEt; }
    sampleAll(et, out) {
        if (!this.inCoverage(et) || out.length < this.count * 3) return false;
        const x = ((et / DAY) - (this.startJD - J2000)) / this.stepDays;
        const interval = Math.min(this.samples - 2, Math.max(0, Math.floor(x)));
        const u = x - interval, u2 = u * u, u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1, h10 = (u3 - 2 * u2 + u) * this.stepDays;
        const h01 = -2 * u3 + 3 * u2, h11 = (u3 - u2) * this.stepDays;
        const v = this.values;
        for (let j = 0; j < this.count; j++) {
            const a = (j * this.samples + interval) * 6, b = a + 6;
            for (let k = 0; k < 3; k++) out[j * 3 + k] = h00 * v[a + k] + h10 * v[a + k + 3]
                + h01 * v[b + k] + h11 * v[b + k + 3];
        }
        return true;
    }
}
export function toScene(ecliptic, out, auUnits) {
    for (let j = 0; j < ecliptic.length; j += 3) {
        out[j] = ecliptic[j] * auUnits;
        out[j + 1] = ecliptic[j + 2] * auUnits;
        out[j + 2] = -ecliptic[j + 1] * auUnits;
    }
    return out;
}
export function makeBackground(count = 10000, seed = 0x4b554950) {
    const orbit = new Float32Array(count * 4), phase = new Float32Array(count * 4);
    let state = seed >>> 0;
    const rand = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let j = 0; j < count; j++) {
        const cold = rand() < 0.70;
        const a = cold ? 42 + 5 * rand() : 36 + 14 * rand();
        const e = cold ? .02 + .06 * rand() : .06 + rand() * Math.max(0, Math.min(.30, 1 - 30 / a) - .06);
        const inclination = cold ? Math.min(4, 1.2 * Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))))
            : 4 + 26 * Math.pow(rand(), .8);
        orbit.set([a, e, inclination * Math.PI / 180, rand() * TAU], j * 4);
        phase.set([rand() * TAU, rand() * TAU, .01720209895 / Math.pow(a, 1.5), .55 + .45 * rand()], j * 4);
    }
    return { orbit, phase, count };
}