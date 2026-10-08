export const ALBEDO = {
    nea: 0.140,
    'trojan-l4': 0.052,
    'trojan-l5': 0.052,
    hilda: 0.044,
    belt: 0.055,
};
const SFD = {
    nea: [[1, 830], [0.3, 7330], [0.14, 20000], [0.1, 30200], [0.03, 368000], [0.01, 6.5e6]],
    'trojan-l4': [[1.0, 151000], [0.3, 1.3838e+06], [0.14, 5.88791e+06], [0.1, 1.13478e+07], [0.03, 1.3391e+08]],
    'trojan-l5': [[1.0, 109000], [0.3, 998903], [0.14, 4.25021e+06], [0.1, 8.19144e+06], [0.03, 9.66633e+07]],
    hilda: [[2.0, 10000], [1.0, 37321], [0.3, 390455], [0.14, 1.7929e+06], [0.1, 3.51409e+06], [0.03, 4.14681e+07]],
    belt: [[1.0, 1.5e+06], [0.3, 1.47761e+07], [0.14, 6.78496e+07], [0.1, 1.35241e+08], [0.03, 1.80011e+09]],
};
export function cumulativeCount(groupKey, dKm) {
    const raw = SFD[groupKey] || SFD.belt;
    const t = raw.map(pair => [Math.log(pair[0]), Math.log(Math.max(1e-9, pair[1]))]);
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
    "nea": [[300, 1], [100, 1], [30, 1], [10, 1], [3, 1], [1, 1], [0.5, 1], [0.3, 0.817], [0.14, 0.59], [0.1, 0.484], [0.03, 0.0793], [0.01, 0.00525]],
    "trojan-l4": [[300, 1], [100, 1], [30, 1], [10, 1], [3, 0.507], [1, 0.0689], [0.5, 0.0193], [0.3, 0.00752], [0.14, 0.00177], [0.1, 0.000917], [0.03, 0.0000777], [0.01, 0.00000818]],
    "trojan-l5": [[300, 0.971], [100, 0.971], [30, 0.971], [10, 0.971], [3, 0.404], [1, 0.0548], [0.5, 0.0153], [0.3, 0.00598], [0.14, 0.00141], [0.1, 0.00073], [0.03, 0.0000618], [0.01, 0.0000065]],
    "hilda": [[300, 1], [100, 1], [30, 1], [10, 1], [3, 1], [1, 0.209], [0.5, 0.0543], [0.3, 0.02], [0.14, 0.00437], [0.1, 0.00223], [0.03, 0.000189], [0.01, 0.0000199]],
    "belt": [[10000, 1]],
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
    const p = pV > 0 ? pV : 0.055;
    return 1329 / Math.sqrt(p) * Math.pow(10, -h / 5);
}