import { DEG, TAU, J2000, YEAR, AU, GROUPS, GROUP_BY_CODE, jupiterMean, meanMotion, resonanceState, propagate, positionFromElements, secularRates, wrap } from "./asteroid-theory.js";

import { ALBEDO, diameterFromH, representativeWeight } from "./asteroid-populations.js";

import { packElements, makeAttributes, repackPendulum } from "./smallbody-gpu.js";

function recordOf(a, e, incRad, nodeRad, varpiRad, mRad, epochDays) {
    return {
        a: a,
        e: e,
        inclination: incRad,
        node: nodeRad,
        peri: varpiRad,
        meanAnomaly: mRad,
        epochDays: epochDays
    };
}

export const RECORD_BYTES = 56;

export const LAYOUT = {
    a: 0,
    e: 4,
    i: 8,
    node: 12,
    peri: 16,
    M: 20,
    epochDays: 24,
    diameterKm: 28,
    weight: 32,
    moidAU: 36,
    H: 40,
    nameLen: 42,
    groupCode: 44,
    flags: 45,
    conditionCode: 46,
    nameOffset: 48
};

export const FLAG = {
    pha: 1,
    horseshoe: 2,
    tadpole: 4,
    sized: 8,
    nearEarth: 16
};

const UNKNOWN_H = 65535;

export class SmallBodyCatalog {
    static async load(options = {}) {
        const base = options.url ?? "data/asteroids/";
        const get = async (file, json) => {
            const response = await fetch(base + file);
            if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
            return json ? response.json() : new Uint8Array(await response.arrayBuffer());
        };
        const [records, names, meta] = await Promise.all([ get("smallbodies.bin"), get("smallbodies-names.bin"), get("smallbodies-meta.json", true) ]);
        const catalog = new SmallBodyCatalog({
            records: records,
            names: names,
            meta: meta,
            ...options
        });
        catalog.source = `files:${base}`;
        return catalog;
    }
    static fromSample(sampleModule, options = {}) {
        if (!sampleModule || !sampleModule.SAMPLE_RECORDS_B64) throw new Error("expected smallbodies-sample.js");
        const catalog = new SmallBodyCatalog({
            records: decodeBase64(sampleModule.SAMPLE_RECORDS_B64),
            names: decodeBase64(sampleModule.SAMPLE_NAMES_B64),
            meta: sampleModule.SAMPLE_META ?? null,
            ...options
        });
        catalog.source = "baked sample";
        return catalog;
    }
    constructor({records: records, names: names, meta: meta = null, bodiesPerFrame: bodiesPerFrame = 2e3, reanchorDays: reanchorDays = 400, groups: groups = null}) {
        if (!(records instanceof Uint8Array) || records.byteLength % RECORD_BYTES) {
            throw new Error("the record buffer must be a whole number of 56-byte records");
        }
        const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
        const count = this.count = records.byteLength / RECORD_BYTES;
        this.meta = meta;
        this.names = names;
        this.source = "inline";
        this.bodiesPerFrame = Math.max(200, bodiesPerFrame | 0);
        this.reanchorDays = Math.max(20, reanchorDays);
        const typed = (Ctor, n) => new Ctor(n);
        const F = n => typed(Float32Array, n);
        this.a = F(count);
        this.e = F(count);
        this.incRad = F(count);
        this.nodeRad = F(count);
        this.varpiRad = F(count);
        this.mRad = F(count);
        this.epochDays = F(count);
        this.diameterKm = F(count);
        this.weight = F(count);
        this.moidAU = F(count);
        this.H = F(count);
        this.periDot = F(count);
        this.nodeDot = F(count);
        this.meanMotionDay = F(count);
        this.groupCode = typed(Uint8Array, count);
        this.flags = typed(Uint8Array, count);
        this.conditionCode = typed(Uint8Array, count);
        this.nameOffset = typed(Int32Array, count);
        this.nameLength = typed(Uint16Array, count);
        this.xyz = F(count * 3);
        this.radiusKm = F(count);
        this.rSun = F(count);
        this.groupKey = new Array(count);
        this.censusKey = new Array(count);
        this.visible = typed(Uint8Array, count);
        this.groupOn = typed(Uint8Array, count);
        this.subsetOn = typed(Uint8Array, count);
        this.subsetOn.fill(1);
        this.stored = typed(Uint8Array, count);
        this.holder = new Array(count);
        this.complete = false;
        this.pass = 0;
        this.pending = 0;
        this.days = null;
        this.epochJd = 0;
        this.shownCount = count;
        const byGroup = this.byGroup = new Map;
        const rates = {};
        for (let j = 0; j < count; j++) {
            const o = j * RECORD_BYTES;
            const a = this.a[j] = view.getFloat32(o + LAYOUT.a, true);
            const e = this.e[j] = view.getFloat32(o + LAYOUT.e, true);
            const inc = this.incRad[j] = view.getFloat32(o + LAYOUT.i, true) * DEG;
            const node = this.nodeRad[j] = view.getFloat32(o + LAYOUT.node, true) * DEG;
            this.varpiRad[j] = view.getFloat32(o + LAYOUT.peri, true) * DEG + node;
            this.mRad[j] = view.getFloat32(o + LAYOUT.M, true) * DEG;
            this.epochDays[j] = view.getFloat32(o + LAYOUT.epochDays, true);
            this.diameterKm[j] = view.getFloat32(o + LAYOUT.diameterKm, true);
            this.weight[j] = view.getFloat32(o + LAYOUT.weight, true);
            this.moidAU[j] = view.getFloat32(o + LAYOUT.moidAU, true);
            const rawH = view.getUint16(o + LAYOUT.H, true);
            this.H[j] = rawH === UNKNOWN_H ? 0 : rawH / 100;
            const code = this.groupCode[j] = view.getUint8(o + LAYOUT.groupCode);
            const flags = this.flags[j] = view.getUint8(o + LAYOUT.flags);
            this.conditionCode[j] = view.getUint8(o + LAYOUT.conditionCode);
            this.nameOffset[j] = view.getUint32(o + LAYOUT.nameOffset, true);
            this.nameLength[j] = view.getUint16(o + LAYOUT.nameLen, true);
            const group = GROUPS[GROUP_BY_CODE[code]] || GROUPS.belt;
            const censusKey = group.key.startsWith("nea-") ? "nea" : group.key;
            this.groupKey[j] = group.key;
            this.censusKey[j] = censusKey;
            if (!byGroup.has(censusKey)) byGroup.set(censusKey, []);
            byGroup.get(censusKey).push(j);
            this.meanMotionDay[j] = meanMotion(a);
            if (group.resonant) {
                this.periDot[j] = 0;
                this.nodeDot[j] = 0;
            } else {
                secularAt(a, e, inc, rates);
                this.periDot[j] = rates.periDot;
                this.nodeDot[j] = rates.nodeDot;
            }
            const d = this.diameterKm[j] > .02 ? this.diameterKm[j] : this.H[j] > 0 ? diameterFromH(this.H[j], ALBEDO[censusKeyOf(group)] ?? ALBEDO.belt) : 1.4;
            this.radiusKm[j] = Math.max(.08, d / 2);
        }
        for (const [key, list] of byGroup) byGroup.set(key, Int32Array.from(list));
        this.show(groups ?? [ ...byGroup.keys() ]);
        this._el = {
            a: 0,
            e: 0,
            i: 0,
            node: 0,
            peri: 0,
            M: 0,
            epoch: 0
        };
        this._rec = {
            a: 0,
            e: 0,
            inclination: 0,
            node: 0,
            peri: 0,
            meanAnomaly: 0,
            epochDays: 0
        };
        this._ctx = {
            jupiter: null,
            days: 0,
            state: null
        };
        this._out = {};
        this._pos = {};
        this._jup = null;
    }
    requestGroups(keys) {
        if (!this._requested) this._requested = new Set(this.byGroup.keys());
        this._requested = new Set([ ...this._requested, ...keys ]);
        return this.show([ ...this._requested ]);
    }
    requestSubset(counts = {}, options = {}) {
        this._requestedSubset = {
            ...this._requestedSubset || {},
            ...counts
        };
        return this.drawSubset(this._requestedSubset, options);
    }
    show(keys) {
        const wanted = new Set((Array.isArray(keys) ? keys : [ keys ]).flatMap(k => k === "nea" ? [ "nea", "nea-amor", "nea-aten", "nea-apollo", "nea-atira" ] : [ k, `trojan-${k}` ]));
        this.wantedGroups = wanted;
        for (let j = 0; j < this.count; j++) this.groupOn[j] = wanted.has(this.censusKey[j]) || wanted.has(this.groupKey[j]) ? 1 : 0;
        return this.syncVisible();
    }
    drawSubset(counts = {}, options = {}) {
        const minD = options.minDiameterKm ?? 40;
        const dflt = options.default ?? 1200;
        for (const [key, list] of this.byGroup) {
            const want = Math.max(0, counts[key] ?? dflt);
            for (let k = 0; k < list.length; k++) this.subsetOn[list[k]] = 0;
            if (want >= list.length) {
                for (const j of list) this.subsetOn[j] = 1;
                continue;
            }
            const order = Array.from(list).sort((x, y) => (this.diameterKm[y] || 0) - (this.diameterKm[x] || 0));
            let taken = 0;
            for (const j of order) {
                if (taken >= want || (this.diameterKm[j] || 0) < minD) break;
                this.subsetOn[j] = 1;
                taken++;
            }
            const stride = Math.max(1, Math.round(list.length / Math.max(1, want - taken)));
            for (let k = 0; k < list.length && taken < want; k += stride) {
                const j = list[k];
                if (!this.subsetOn[j]) {
                    this.subsetOn[j] = 1;
                    taken++;
                }
            }
        }
        this.subset = {
            ...counts
        };
        return this.syncVisible();
    }
    invalidate() {
        this._requestDays = null;
        return this;
    }
    syncVisible() {
        this._requestDays = null;
        const ccMax = this.ccMax ?? 9;
        let shown = 0;
        for (let j = 0; j < this.count; j++) {
            const on = this.groupOn[j] && this.subsetOn[j] && this.conditionCode[j] <= ccMax ? 1 : 0;
            this.visible[j] = on;
            shown += on;
        }
        this.shownCount = shown;
        return this;
    }
    fillPositions(key, xyz, radius = null, scale = 1) {
        const list = this.indicesOf(key);
        let n = 0;
        const radial = typeof scale === "function" ? scale : null;
        for (let k = 0; k < list.length; k++) {
            const j = list[k];
            if (!this.visible[j]) continue;
            const o = j * 3, t = n * 3;
            const s = radial ? radial(this.a[j]) : scale;
            xyz[t] = this.xyz[o] * s;
            xyz[t + 1] = this.xyz[o + 1] * s;
            xyz[t + 2] = this.xyz[o + 2] * s;
            if (radius) radius[n] = this.radiusKm[j];
            n++;
        }
        return n;
    }
    visibleIndices() {
        const out = [];
        for (let j = 0; j < this.count; j++) if (this.visible[j]) out.push(j);
        return Int32Array.from(out);
    }
    gpuPack(key, THREE, holders = this.holder) {
        const list = this.indicesOf(key);
        const visible = [];
        for (let k = 0; k < list.length; k++) if (this.visible[list[k]]) visible.push(list[k]);
        const packed = packElements(this, visible, holders);
        return {
            indices: Int32Array.from(visible),
            attrs: makeAttributes(THREE, packed, visible.length),
            count: visible.length
        };
    }
    gpuRepackPendulum(attrs, key, count, holders = this.holder) {
        const list = this.indicesOf(key);
        const visible = [];
        for (let k = 0; k < list.length && visible.length < count; k++) if (this.visible[list[k]]) visible.push(list[k]);
        repackPendulum(this, visible, holders, attrs, count);
    }
    filterCondition(ccMax = 9) {
        this.ccMax = ccMax;
        let shown = 0;
        for (let j = 0; j < this.count; j++) this.visible[j] = 0;
        for (let j = 0; j < this.count; j++) {
            if (this.groupOn[j] && this.subsetOn[j] && this.conditionCode[j] <= ccMax) this.visible[j] = 1;
            shown += this.visible[j];
        }
        this.shownCount = shown;
        return this;
    }
    filterDiameter(minKm = 0) {
        let shown = 0;
        for (let j = 0; j < this.count; j++) {
            if (this.visible[j] && this.diameterKm[j] > 0 && this.diameterKm[j] < minKm) this.visible[j] = 0;
            shown += this.visible[j];
        }
        this.shownCount = shown;
        return this;
    }
    indicesOf(key) {
        return this.byGroup.get(key) ?? Int32Array.of();
    }
    jupiterAt(days) {
        return jupiterMean(days);
    }
    update(days, options = {}) {
        if (!Number.isFinite(days)) return this;
        if (days === this._requestDays && this.complete) return this;
        this._requestDays = days;
        if (days !== this.days) {
            this.days = days;
            this.epochJd = days + J2000;
            this.pending = 0;
            this.stored.fill(0);
        }
        this._jup = options.jupiter ?? this.jupiterAt(days);
        const jupiter = this._jup;
        const jump = Math.abs(days - (this._lastDays ?? days));
        this._lastDays = days;
        const budget = jump > 20 ? Math.min(this.count, Math.max(this.shownCount, this.bodiesPerFrame)) : this.bodiesPerFrame;
        const end = Math.min(this.count, this.pending + budget);
        for (let j = this.pending; j < end; j++) {
            if (this.visible[j]) this.step(j, days, jupiter);
        }
        this.pending = end;
        this.complete = end >= this.count;
        if (this.complete) {
            this.pass++;
            this.pending = 0;
        }
        return this;
    }
    updateAll(days, options = {}) {
        const saved = this.bodiesPerFrame;
        this.bodiesPerFrame = this.count + 1;
        this.invalidate();
        this.update(days, options);
        this.bodiesPerFrame = saved;
        return this;
    }
    step(j, days, jupiter = this._jup ?? this.jupiterAt(days)) {
        const dt = days - this.epochDays[j];
        const group = GROUPS[GROUP_BY_CODE[this.groupCode[j]]] || GROUPS.belt;
        const res = group.resonant && this.flags[j] & (FLAG.tadpole | FLAG.horseshoe);
        if (!res) {
            const a = this.a[j], e = this.e[j];
            const g = this.periDot[j], sDot = this.nodeDot[j];
            const varpi = this.varpiRad[j] + g * dt;
            const node = this.nodeRad[j] + sDot * dt;
            const lam = wrap(this.mRad[j] + this.varpiRad[j] + (this.meanMotionDay[j] + g) * dt);
            const M = wrap(lam - varpi);
            const omega = varpi - node;
            const p = this._pos;
            positionFromElements(a, e, this.incRad[j], node, omega, M, p);
            const o = j * 3;
            this.xyz[o] = p.x;
            this.xyz[o + 1] = p.y;
            this.xyz[o + 2] = p.z;
            this.rSun[j] = Math.hypot(p.x, p.y, p.z);
            this.stored[j] = 1;
            return this;
        }
        const el = this._el;
        el.a = this.a[j];
        el.e = this.e[j];
        el.i = this.incRad[j] / DEG;
        el.node = this.nodeRad[j] / DEG;
        el.peri = (this.varpiRad[j] - this.nodeRad[j]) / DEG;
        el.M = this.mRad[j] / DEG;
        el.epoch = this.epochDays[j] + J2000;
        let holder = this.holder[j];
        if (!holder || Math.abs(days - holder.anchorDays) > this.reanchorDays) {
            const record = recordOf(el.a, el.e, this.incRad[j], this.nodeRad[j], this.varpiRad[j], this.mRad[j], this.epochDays[j]);
            holder = this.holder[j] = resonanceState(record, group, jupiterMean(this.epochDays[j]), {
                state: holder?.state
            });
            holder.record = record;
            holder.anchorDays = days;
        }
        const ctx = this._ctx;
        ctx.jupiter = jupiter;
        ctx.days = days;
        ctx.state = holder.state;
        const out = propagate(holder.record, group, ctx, this._out);
        const o = j * 3;
        this.xyz[o] = out.x;
        this.xyz[o + 1] = out.y;
        this.xyz[o + 2] = out.z;
        this.rSun[j] = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z);
        this.stored[j] = 1;
        return this;
    }
    name(j) {
        const start = this.nameOffset[j];
        return this.decoder().decode(this.names.subarray(start, start + this.nameLength[j]));
    }
    position(j, out = [ 0, 0, 0 ]) {
        const o = j * 3;
        out[0] = this.xyz[o];
        out[1] = this.xyz[o + 1];
        out[2] = this.xyz[o + 2];
        return out;
    }
    pick(origin, direction, maxDeg = .25) {
        const limit = Math.cos(maxDeg * DEG);
        let best = null;
        for (let j = 0; j < this.count; j++) {
            if (!this.visible[j] || !this.stored[j]) continue;
            const o = j * 3;
            const dx = this.xyz[o] - origin[0], dy = this.xyz[o + 1] - origin[1], dz = this.xyz[o + 2] - origin[2];
            const d = Math.hypot(dx, dy, dz);
            if (!(d > 1e-9)) continue;
            const cos = (dx * direction[0] + dy * direction[1] + dz * direction[2]) / d;
            if (cos < limit) continue;
            if (!best || cos > best.cos) best = {
                index: j,
                name: this.name(j),
                group: this.groupKey[j],
                diameterKm: this.diameterKm[j],
                rangeAu: d,
                cos: cos,
                angleDeg: Math.acos(Math.min(1, cos)) / DEG
            };
        }
        if (!best) return null;
        delete best.cos;
        return best;
    }
    census() {
        const out = new Map;
        for (const [key, list] of this.byGroup) {
            let shown = 0, weighted = 0, sized = 0, diaSum = 0, reliable = 0, ccBad = 0;
            for (let k = 0; k < list.length; k++) {
                const j = list[k];
                if (this.visible[j]) shown++;
                weighted += this.weight[j];
                const d = this.diameterKm[j];
                if (d > .02) {
                    sized++;
                    diaSum += d;
                }
                if (this.conditionCode[j] <= 4) reliable++; else ccBad++;
            }
            out.set(key, {
                catalogued: list.length,
                shown: shown,
                represented: Math.round(weighted),
                meanWeight: +(weighted / Math.max(1, list.length)).toFixed(2),
                withSize: sized,
                meanDiameterKm: +(diaSum / Math.max(1, sized)).toFixed(2),
                orbitReliable: reliable,
                orbitPoor: ccBad
            });
        }
        return out;
    }
    representedShown() {
        let sum = 0;
        for (let j = 0; j < this.count; j++) if (this.visible[j]) sum += this.weight[j];
        return Math.round(sum);
    }
    decoder() {
        if (!this._decoder) this._decoder = new TextDecoder;
        return this._decoder;
    }
}

function secularAt(a, e, incRad, out) {
    secularRates(a, e, incRad, out, null);
    out.periDot = out.g;
    out.nodeDot = -out.s;
    return out;
}

function censusKeyOf(group) {
    return group.key.startsWith("nea-") ? "nea" : group.key;
}

function decodeBase64(b64) {
    const clean = b64.replace(/\s+/g, "");
    if (typeof atob === "function") {
        const bin = atob(clean);
        const out = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) out[j] = bin.charCodeAt(j);
        return out;
    }
    return new Uint8Array(Buffer.from(clean, "base64"));
}

export { AU, TAU, YEAR, J2000, representativeWeight };

let _shared = null;

export function sharedCatalog(options = {}) {
    if (_shared) return _shared;
    _shared = (async () => {
        const base = options.url ?? new URL("../../../data/asteroids/", import.meta.url).href;
        try {
            return await SmallBodyCatalog.load({
                url: base,
                ...options
            });
        } catch (err) {
            try {
                const sample = await (import("../../../data/asteroids/smallbodies-sample.js"));
                const catalog = SmallBodyCatalog.fromSample(sample, options);
                catalog.note = `served catalogue unavailable (${err.message})`;
                return catalog;
            } catch (err2) {
                console.warn("small-body catalogue unavailable:", err.message, "/", err2.message);
                return null;
            }
        }
    })();
    _shared.catch(() => {
        _shared = null;
    });
    return _shared;
}
