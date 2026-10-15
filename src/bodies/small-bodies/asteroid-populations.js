export const ALBEDO = {
    nea: .14,
    "trojan-l4": .052,
    "trojan-l5": .052,
    hilda: .044,
    belt: .055
};

const SFD = {
    nea: [ [ 1, 830 ], [ .3, 7330 ], [ .14, 2e4 ], [ .1, 30200 ], [ .03, 368e3 ], [ .01, 65e5 ] ],
    "trojan-l4": [ [ 1, 151e3 ], [ .3, 1383800 ], [ .14, 5887910 ], [ .1, 11347800 ], [ .03, 13391e4 ] ],
    "trojan-l5": [ [ 1, 109e3 ], [ .3, 998903 ], [ .14, 4250210 ], [ .1, 8191440 ], [ .03, 96663300 ] ],
    hilda: [ [ 2, 1e4 ], [ 1, 37321 ], [ .3, 390455 ], [ .14, 1792900 ], [ .1, 3514090 ], [ .03, 41468100 ] ],
    belt: [ [ 1, 15e5 ], [ .3, 14776100 ], [ .14, 67849600 ], [ .1, 135241e3 ], [ .03, 180011e4 ] ]
};

export function cumulativeCount(groupKey, dKm) {
    const raw = SFD[groupKey] || SFD.belt;
    const t = raw.map(pair => [ Math.log(pair[0]), Math.log(Math.max(1e-9, pair[1])) ]);
    const x = Math.log(Math.min(raw[0][0] * 100, Math.max(raw[raw.length - 1][0] / 100, dKm || 1)));
    const seg = i => (t[i][1] - t[i + 1][1]) / (t[i][0] - t[i + 1][0]);
    if (x >= t[0][0]) return Math.exp(t[0][1] + seg(0) * (x - t[0][0]));
    for (let i = 0; i + 1 < t.length; i++) {
        if (x >= t[i + 1][0]) {
            const f = (x - t[i + 1][0]) / (t[i][0] - t[i + 1][0]);
            return Math.exp(t[i + 1][1] + f * (t[i][1] - t[i + 1][1]));
        }
    }
    const last = t.length - 1;
    return Math.exp(t[last][1] + seg(last - 1) * (x - t[last][0]));
}

export function bandCount(groupKey, dBig, dSmall) {
    return Math.max(0, cumulativeCount(groupKey, dBig) - cumulativeCount(groupKey, dSmall));
}

export const COMPLETION_TABLE = {
    nea: [ [ 300, 1 ], [ 100, 1 ], [ 30, 1 ], [ 10, 1 ], [ 3, 1 ], [ 1, 1 ], [ .5, 1 ], [ .3, .817 ], [ .14, .59 ], [ .1, .484 ], [ .03, .0793 ], [ .01, .00525 ] ],
    "trojan-l4": [ [ 300, 1 ], [ 100, 1 ], [ 30, 1 ], [ 10, 1 ], [ 3, .507 ], [ 1, .0689 ], [ .5, .0193 ], [ .3, .00752 ], [ .14, .00177 ], [ .1, 917e-6 ], [ .03, 777e-7 ], [ .01, 818e-8 ] ],
    "trojan-l5": [ [ 300, .971 ], [ 100, .971 ], [ 30, .971 ], [ 10, .971 ], [ 3, .404 ], [ 1, .0548 ], [ .5, .0153 ], [ .3, .00598 ], [ .14, .00141 ], [ .1, 73e-5 ], [ .03, 618e-7 ], [ .01, 65e-7 ] ],
    hilda: [ [ 300, 1 ], [ 100, 1 ], [ 30, 1 ], [ 10, 1 ], [ 3, 1 ], [ 1, .209 ], [ .5, .0543 ], [ .3, .02 ], [ .14, .00437 ], [ .1, .00223 ], [ .03, 189e-6 ], [ .01, 199e-7 ] ],
    belt: [ [ 1e4, 1 ] ]
};

export function completionFraction(groupKey, dKm) {
    const table = COMPLETION_TABLE[groupKey] || COMPLETION_TABLE.belt;
    const D = Math.min(table[0][0], Math.max(table[table.length - 1][0], dKm || 1));
    const logD = Math.log(D);
    for (let i = 0; i + 1 < table.length; i++) {
        const hi = table[i], lo = table[i + 1];
        if (logD <= Math.log(hi[0]) && logD >= Math.log(lo[0])) {
            const f = (logD - Math.log(lo[0])) / (Math.log(hi[0]) - Math.log(lo[0]));
            return Math.exp((1 - f) * Math.log(Math.max(1e-6, lo[1])) + f * Math.log(Math.max(1e-6, hi[1])));
        }
    }
    return table[table.length - 1][1];
}

export const MAX_WEIGHT = 400;

export function representativeWeight(groupKey, dKm) {
    const f = completionFraction(groupKey, dKm);
    return f > 0 ? Math.min(MAX_WEIGHT, 1 / f) : MAX_WEIGHT;
}

export function diameterFromH(H, pV) {
    const h = Number.isFinite(H) ? H : 16;
    const p = pV > 0 ? pV : .055;
    return 1329 / Math.sqrt(p) * Math.pow(10, -h / 5);
}
