export const DEG = Math.PI / 180;

export const TAU = Math.PI * 2;

export const AU = 149597870.7;

export const J2000 = 2451545;

export const CENTURY = 36525;

export const YEAR = 365.256898;

export const GAUSS_K = .01720209895;

export const GM_SUN = GAUSS_K * GAUSS_K;

export const JUPITER_GM_RATIO = .000954791938;

export const wrap = x => {
    x %= TAU;
    return x < 0 ? x + TAU : x;
};

export const wrapSigned = x => {
    x = (x + Math.PI) % TAU;
    if (x < 0) x += TAU;
    return x - Math.PI;
};

export const angleBetween = (x, y) => Math.abs(wrapSigned(x - y));

export const clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;

export const meanMotion = a => GAUSS_K / (a * Math.sqrt(a));

export const fromMeanMotion = n => Math.cbrt(GM_SUN / (n * n));

export const PLANETS = [ [ "mercury", .38709927, .20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 37e-8, 1906e-8, -.00594749, 149472.67411175, .16047689, -.12534081, 1.6601353e-7 ], [ "venus", .72333566, .00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 39e-7, -4107e-8, -7889e-7, 58517.81538729, .00268329, -.27769418, 244783834e-14 ], [ "earth", 1.00000261, .01671123, -1531e-8, 100.46457166, 102.93768193, 0, 562e-8, -4392e-8, -.01294668, 35999.37244981, .32327364, 0, 30034891e-13 ], [ "mars", 1.52371034, .0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 1847e-8, 7882e-8, -.00813132, 19140.30268499, .44441088, -.29257343, 322715144e-14 ], [ "jupiter", 5.202887, .04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, -11607e-8, -13253e-8, -.00183714, 3034.74612775, .21252668, .20469106, JUPITER_GM_RATIO ], [ "saturn", 9.53667594, .05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, -.0012506, -50991e-8, .00193609, 1222.49362201, -.41897216, -.28867794, .000285885681 ], [ "uranus", 19.18916464, .04725744, .77263783, 313.23810451, 170.9542763, 74.01692503, -.00196176, -4397e-8, -.00242939, 428.48202785, .40805281, .04240589, 436624406e-13 ], [ "neptune", 30.06992276, .00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 26291e-8, 5105e-8, 35372e-8, 218.45945325, -.32241464, -.00508664, 515138908e-13 ] ];

export const PLANET_INDEX = {
    mercury: 0,
    venus: 1,
    earth: 2,
    mars: 3,
    jupiter: 4,
    saturn: 5,
    uranus: 6,
    neptune: 7
};

export function jupiterMean(days, out = {}) {
    const p = PLANETS[PLANET_INDEX.jupiter], cc = days / CENTURY;
    out.a = p[1] + p[7] * cc;
    out.e = p[2] + p[8] * cc;
    out.inclination = (p[3] + p[9] * cc) * DEG;
    out.peri = (p[5] + p[11] * cc) * DEG;
    out.node = (p[6] + p[12] * cc) * DEG;
    out.periDot = p[11] * DEG / CENTURY;
    out.nodeDot = -p[12] * DEG / CENTURY;
    out.n = meanMotion(out.a);
    out.lambda = wrap((p[4] + p[10] * cc) * DEG);
    out.lambdaDot = p[10] * DEG / CENTURY;
    out.mu = p[13];
    return out;
}

export function eccentricAnomaly(M, e) {
    const s = Math.sin(M), c = Math.cos(M);
    let E = M + e * s * (1 + e * (c - 1) * (1 - e * e / 4));
    for (let i = 0; i < 8; i++) {
        const f = E - e * Math.sin(E) - M;
        const d = f / (1 - e * Math.cos(E));
        E -= d;
        if (d * d < 1e-26) break;
    }
    return E;
}

export function positionFromElements(a, e, incl, node, omega, M, out = {}) {
    const E = eccentricAnomaly(M, e);
    const xk = a * (Math.cos(E) - e), yk = a * Math.sqrt(Math.max(1e-12, 1 - e * e)) * Math.sin(E);
    const cw = Math.cos(omega), sw = Math.sin(omega), co = Math.cos(node), so = Math.sin(node);
    const ci = Math.cos(incl), si = Math.sin(incl);
    out.x = (cw * co - sw * so * ci) * xk + (-sw * co - cw * so * ci) * yk;
    out.y = (cw * so + sw * co * ci) * xk + (-sw * so + cw * co * ci) * yk;
    out.z = sw * si * xk + cw * si * yk;
    return out;
}

export function ellipticK(m) {
    if (m >= 1) return Infinity;
    let a = 1, b = Math.sqrt(Math.max(0, 1 - m));
    for (let i = 0; i < 24; i++) {
        const t = (a + b) * .5;
        b = Math.sqrt(a * b);
        a = t;
        if (a - b < 1e-15 * a) break;
    }
    return Math.PI / (2 * a);
}

export function ellipticF(phi, m) {
    if (!Number.isFinite(phi)) return NaN;
    if (!(phi !== 0)) return 0;
    const mm = Math.min(1 - 1e-14, Math.max(0, m));
    const sign = phi < 0 ? -1 : 1;
    let ang = Math.min(Math.abs(phi), Math.PI / 2);
    let a = 1, b = Math.sqrt(1 - mm);
    let n = 0;
    for (;n < 60; n++) {
        let d = Math.atan2(b * Math.sin(ang), a * Math.cos(ang));
        d += Math.PI * Math.round((ang - d) / Math.PI);
        ang += d;
        const next = (a + b) * .5;
        b = Math.sqrt(a * b);
        a = next;
        if (a - b < 1e-13 * a) {
            n++;
            break;
        }
    }
    return sign * ang / 2 ** n / a;
}

function phaseToX(psi, m, K) {
    const sign = psi < 0 ? -1 : 1;
    const a = Math.abs(psi);
    const F = a <= Math.PI / 2 ? ellipticF(a, m) : 2 * K - ellipticF(Math.PI - a, m);
    return sign * F / (2 * K);
}

const AM_M = 48, AM_H = 32, AM_STEPS = 2400, AM_DECADES = 6;

let AM_ROWS = null;

export const AM_HARMONICS = 32;

export const AM_ROWS_OR_BUILD = () => AM_ROWS || (AM_ROWS = buildAmRows());

function buildAmRows() {
    const rows = [];
    for (let r = 0; r < AM_M; r++) {
        const m = 1 - Math.pow(10, -AM_DECADES * r / (AM_M - 1));
        const K = ellipticK(m);
        const psi = new Float64Array(AM_STEPS + 1);
        const deriv = v => 2 * K * Math.sqrt(Math.max(0, 1 - m * Math.sin(v) * Math.sin(v)));
        let p = 0;
        const h = 1 / AM_STEPS;
        for (let i = 1; i <= AM_STEPS; i++) {
            const k1 = deriv(p), k2 = deriv(p + .5 * h * k1), k3 = deriv(p + .5 * h * k2), k4 = deriv(p + h * k3);
            p += h / 6 * (k1 + 2 * k2 + 2 * k3 + k4);
            psi[i] = p;
        }
        const A = new Float64Array(AM_H);
        let harmonics = 1;
        for (let n = AM_H; n >= 1; n--) {
            let acc = 0;
            for (let i = 0; i < AM_STEPS; i++) {
                const x0 = i / AM_STEPS, x1 = (i + 1) / AM_STEPS;
                acc += .5 * ((psi[i] - Math.PI * x0) * Math.sin(TAU * n * x0) + (psi[i + 1] - Math.PI * x1) * Math.sin(TAU * n * x1)) / AM_STEPS;
            }
            A[n - 1] = 2 * acc;
            if (Math.abs(A[n - 1]) > 1e-5) {
                harmonics = Math.max(harmonics, n);
            }
        }
        rows.push({
            m: m,
            K: K,
            A: A,
            harmonics: harmonics
        });
    }
    return rows;
}

function amRow(m) {
    if (!AM_ROWS) AM_ROWS = buildAmRows();
    const f = clamp(Math.log10(1 / Math.max(1e-14, 1 - m)) / AM_DECADES * (AM_M - 1), 0, AM_M - 1);
    const i = Math.min(AM_M - 2, Math.floor(f));
    return {
        i: i,
        w: f - i
    };
}

export function ellipticKTable(m) {
    if (m >= 1 - Math.pow(10, -AM_DECADES)) return ellipticK(Math.min(m, .99999999));
    const {i: i, w: w} = amRow(m), R = AM_ROWS || (AM_ROWS = buildAmRows());
    return (1 - w) * R[i].K + w * R[i + 1].K;
}

export function jacobiAmplitude(x, m, harm = 8) {
    const R = AM_ROWS || (AM_ROWS = buildAmRows());
    const {i: i, w: w} = amRow(m);
    const frac = x - Math.floor(x), cycles = Math.floor(x);
    let s0 = 0, s1 = 0, ang = TAU * frac;
    const n = Math.min(harm, AM_H);
    for (let k = 0; k < n; k++) {
        const t = Math.sin(ang);
        s0 += R[i].A[k] * t;
        s1 += R[i + 1].A[k] * t;
        ang += TAU * frac;
    }
    const psi = Math.PI * frac + (1 - w) * s0 + w * s1;
    return psi + Math.PI * cycles;
}

export const SECULAR_FIT = {
    logDomain: [ -.79850769621777, 1.7227665977411 ],
    ratioG: [ 1.181454, .647573 ],
    ratioS: [ 2.346899, .285663 ],
    degreeG: 1,
    degreeS: 1,
    samplesG: 12,
    samplesS: 17,
    rmsArcsecPerYear: 4.35,
    heldOutArcsecPerYear: 5.447,
    rmsSArcsecPerYear: 28.92,
    heldOutSArcsecPerYear: 32.103,
    resonant: {
        trojan: {
            periDot: 2700722886e-15,
            nodeDot: -1.6553524019e-7,
            bodies: 34,
            arcsecPerYear: [ 203.47, 12.47 ],
            scatterArcsecPerYear: [ 200.26, 11.48 ]
        },
        hilda: {
            periDot: -13111410894e-16,
            nodeDot: -9.9807317708e-7,
            bodies: 24,
            arcsecPerYear: [ -98.78, 75.19 ],
            scatterArcsecPerYear: [ 251.62, 92.98 ]
        }
    },
    units: "dimensionless multipliers on quadrupoleRates(a, e, i); Chebyshev in x = 2(log a - logDomain[0])/(logDomain[1]-logDomain[0]) - 1",
    source: "measured by tools/fit-secular.mjs from Horizons DE441 element series 1850-2140; per-object data in tools/report/secular.json"
};

function chebyshev(coeffs, x) {
    let b1 = 0, b2 = 0;
    for (let i = coeffs.length - 1; i > 0; i--) {
        const t = b1;
        b1 = 2 * x * b1 - b2 + coeffs[i];
        b2 = t;
    }
    return .5 * coeffs[0] + b1 * x - b2;
}

export function secularRates(a, e = .15, incl = 10 * DEG, out = {}, group = null) {
    quadrupoleRates(a, e, incl, out);
    const fit = SECULAR_FIT;
    if (!fit) return out;
    if (group && group.resonant && fit.resonant) {
        const r = fit.resonant[/^hilda/.test(group.key || "") ? "hilda" : "trojan"];
        if (r) {
            out.g = r.periDot;
            out.s = -r.nodeDot;
            out.periDot = r.periDot;
            out.nodeDot = r.nodeDot;
            out.corrected = true;
            out.groupRates = true;
            return out;
        }
    }
    if (Array.isArray(fit.ratioG) && Array.isArray(fit.ratioS)) {
        const [lo, hi] = fit.logDomain;
        const x = clamp(2 * (Math.log(a) - lo) / (hi - lo) - 1, -1, 1);
        out.g *= clamp(chebyshev(fit.ratioG, x), .2, 3);
        out.s *= clamp(chebyshev(fit.ratioS, x), .2, 3);
        out.periDot = out.g;
        out.nodeDot = -out.s;
        out.corrected = true;
    }
    return out;
}

export function quadrupoleRates(a, e = .15, incl = 10 * DEG, out = {}) {
    const n = meanMotion(a);
    const root = Math.sqrt(Math.max(1e-6, 1 - e * e));
    const fperi = root * (2 - 3 * Math.sin(incl) ** 2);
    const fnode = root * (2 + 3 * e * e) * Math.cos(incl);
    let g = 0, s = 0;
    for (const p of PLANETS) {
        if (a <= p[1] * .998) {
            const f = .75 * n * p[13] * (a / p[1]) ** 3 / Math.pow(1 - p[2] * p[2], 1.5);
            g += f * fperi;
            s += f * fnode;
        } else if (a < p[1] * 1.12) {
            const f = .75 * n * p[13] * .998 ** 3 / Math.pow(1 - p[2] * p[2], 1.5);
            g += f * fperi;
            s += f * fnode;
        }
    }
    out.g = g;
    out.s = s;
    out.periDot = g;
    out.nodeDot = -s;
    out.corrected = false;
    return out;
}

export const GROUPS = {
    "nea-amor": {
        key: "nea-amor",
        name: "Amor asteroids",
        p: 1,
        q: 1,
        resonant: false,
        albedo: .14,
        code: 0
    },
    "nea-aten": {
        key: "nea-aten",
        name: "Aten asteroids",
        p: 1,
        q: 1,
        resonant: false,
        albedo: .14,
        code: 1
    },
    "nea-apollo": {
        key: "nea-apollo",
        name: "Apollo asteroids",
        p: 1,
        q: 1,
        resonant: false,
        albedo: .14,
        code: 2
    },
    "nea-atira": {
        key: "nea-atira",
        name: "Atira asteroids",
        p: 1,
        q: 1,
        resonant: false,
        albedo: .16,
        code: 3
    },
    "trojan-l4": {
        key: "trojan-l4",
        name: "Jupiter Trojans - L4 camp",
        p: 1,
        q: 1,
        resonant: true,
        centers: [ DEG * 60 ],
        albedo: .052,
        code: 4
    },
    "trojan-l5": {
        key: "trojan-l5",
        name: "Jupiter Trojans - L5 camp",
        p: 1,
        q: 1,
        resonant: true,
        centers: [ -DEG * 60 ],
        albedo: .052,
        code: 5
    },
    hilda: {
        key: "hilda",
        name: "Hilda asteroids",
        p: 3,
        q: 2,
        resonant: true,
        centers: [ 0, TAU / 3, -TAU / 3 ],
        albedo: .044,
        code: 6
    },
    belt: {
        key: "belt",
        name: "outer-belt background",
        p: 1,
        q: 1,
        resonant: false,
        albedo: .055,
        code: 7
    }
};

export const GROUP_BY_CODE = Object.fromEntries(Object.values(GROUPS).map(g => [ g.code, g.key ]));

export const RESONANCE_TUNING = {
    trojan: {
        C: 2.5,
        ePower: 0,
        eRef: 1,
        bodies: 38,
        curveRmsDeg: 3.32,
        medianAU: .2832
    },
    hilda: {
        C: 1.2,
        ePower: .4,
        eRef: .3,
        bodies: 28,
        curveRmsDeg: 9.57,
        medianAU: 1.0024
    },
    source: "C fitted by tools/fit-resonance.mjs against Horizons DE441 sigma(t) and re-tuned by tools/tune-resonance.mjs against positions; per-body residuals in tools/report/resonance.json and tools/report/tuning.json"
};

function harmonicsFor(m) {
    const R = AM_ROWS || (AM_ROWS = buildAmRows());
    const {i: i, w: w} = amRow(m);
    return Math.max(1, Math.round((1 - w) * R[i].harmonics + w * R[i + 1].harmonics));
}

export function librationFrequency(group, a, e, options = {}) {
    if (!group || !group.resonant) return 0;
    const tuning = group.p === group.q ? RESONANCE_TUNING.trojan : RESONANCE_TUNING.hilda;
    const nJ = options.jupiter ? options.jupiter.n : jupiterMean(options.days ?? 0).n;
    const n = group.p === group.q ? nJ : meanMotion(a);
    let nu = tuning.C * n * Math.sqrt(JUPITER_GM_RATIO);
    if (tuning.ePower) nu *= Math.pow(clamp(e / tuning.eRef, .02, 8), tuning.ePower);
    return nu;
}

export function resonanceState(record, group, jupiter, out = {}) {
    const state = out.state || (out.state = {});
    const a = record.a, e = record.e;
    const rates = out.rates || (out.rates = secularRates(a, e, record.inclination ?? 10 * DEG, {}, group));
    const n = meanMotion(a);
    const lam = wrap(record.meanAnomaly + record.peri);
    const p = group.resonant ? group.p : 1, q = group.resonant ? group.q : 1;
    state.group = group;
    state.epochDays = record.epochDays ?? 0;
    state.rates = rates;
    state.n0 = n;
    state.a0 = a;
    state.e0 = e;
    state.harmonics = 2;
    state.sigma0 = 0;
    state.sigmaDot0 = 0;
    state.center = 0;
    state.nu = 0;
    state.type = "free";
    state.libration = false;
    state.modulus = 0;
    state.k = 0;
    state.lam0 = lam;
    state.peri0 = record.peri;
    state.lambdaJ0 = jupiter.lambda;
    state.jupRate = jupiter.lambdaDot;
    state.amplitude = 0;
    state.periodDays = Infinity;
    state.rateX = 0;
    state.halfX0 = 0;
    state.energy = 0;
    state.separatrix = 0;
    state.energyRatio = 0;
    state.detuneAU = 0;
    if (!group.resonant) return out;
    const sigmaRaw = q * lam - p * jupiter.lambda + (p - q) * record.peri;
    const sigmaDotRaw = q * n + p * (rates.periDot - jupiter.lambdaDot);
    const centers = group.centers && group.centers.length ? group.centers : [ 0 ];
    let center = centers[0], bestDist = Infinity;
    for (const c of centers) {
        const d = angleBetween(sigmaRaw, c);
        if (d < bestDist) {
            bestDist = d;
            center = c;
        }
    }
    const sigma = wrapSigned(sigmaRaw - center);
    const nu = librationFrequency(group, a, e, {
        jupiter: jupiter
    });
    state.center = center;
    state.nu = nu;
    state.sigma0 = sigma;
    state.sigmaDot0 = sigmaDotRaw;
    state.lam0 = lam;
    state.peri0 = record.peri;
    state.lambdaJ0 = jupiter.lambda;
    state.jupRate = jupiter.lambdaDot;
    state.aRes = fromMeanMotion(p * (jupiter.lambdaDot - rates.periDot) / q);
    state.detuneAU = a - state.aRes;
    const energy = .5 * sigmaDotRaw * sigmaDotRaw + 2 * nu * nu * Math.sin(.5 * sigma) ** 2;
    const separatrix = 2 * nu * nu;
    state.energy = energy;
    state.separatrix = separatrix;
    const ratio = separatrix > 0 ? energy / separatrix : Infinity;
    state.energyRatio = ratio;
    if (ratio < 1) {
        const k2 = clamp(ratio, 1e-18, .99998);
        const K = ellipticKTable(k2);
        state.libration = true;
        state.type = "tadpole";
        state.modulus = k2;
        state.k = Math.sqrt(k2);
        state.amplitude = 2 * Math.asin(Math.min(1, Math.sqrt(k2)));
        state.periodDays = 4 * K / nu;
        const sinPsi = clamp(Math.sin(.5 * sigma) / state.k, -1, 1);
        let psi0 = Math.asin(sinPsi);
        if (sigmaDotRaw < 0) psi0 = Math.PI - psi0;
        state.halfX0 = phaseToX(psi0, k2, K);
        state.rateX = nu / (2 * K);
        state.harmonics = harmonicsFor(k2);
    } else {
        const kBig = Math.sqrt(ratio);
        const kappa2 = 1 / (kBig * kBig);
        const omega0 = nu * kBig;
        const K = ellipticKTable(kappa2);
        state.libration = false;
        state.modulus = kappa2;
        state.k = kBig;
        state.omega0 = omega0;
        state.amplitude = Math.PI;
        state.periodDays = 2 * K / omega0;
        state.sign = sigmaDotRaw >= 0 ? 1 : -1;
        state.halfX0 = phaseToX(.5 * sigma * state.sign, kappa2, K);
        state.rateX = omega0 / (2 * K);
        state.harmonics = harmonicsFor(kappa2);
        state.type = Math.abs(state.detuneAU) < .3 && p === q ? "horseshoe" : "circulator";
    }
    return out;
}

export function pendulumAt(state, days, out = {}) {
    const halfX = state.halfX0 + state.rateX * (days - state.epochDays);
    const psi = jacobiAmplitude(halfX, state.modulus, state.harmonics);
    let raw;
    if (state.libration) {
        const s = clamp(state.k * Math.sin(psi), -1, 1);
        raw = 2 * Math.asin(s);
        out.sigmaDot = 2 * state.nu * state.k * Math.cos(psi);
    } else {
        const sn = Math.sin(psi);
        raw = 2 * state.sign * psi;
        out.sigmaDot = 2 * state.omega0 * Math.sqrt(Math.max(0, 1 - state.modulus * sn * sn)) * state.sign;
    }
    out.sigma = wrapSigned(raw);
    out.sigmaRaw = raw;
    return out;
}

export function propagate(record, group, ctx, out = {}) {
    const jupiter = ctx.jupiter;
    let state = ctx.state;
    let holder = null;
    if (!state) {
        holder = resonanceState(record, group, jupiter, {});
        state = holder.state;
    }
    const rates = state.rates;
    const dt = ctx.days - state.epochDays;
    const peri = record.peri + rates.periDot * dt;
    const node = record.node + rates.nodeDot * dt;
    let a = record.a, lam, sigma = 0, sigmaDot = 0;
    if (group.resonant && state.type !== "circulator") {
        const ph = pendulumAt(state, ctx.days, scratch);
        const p = group.p, q = group.q;
        sigma = ph.sigma + state.center;
        sigmaDot = ph.sigmaDot;
        const n = (p * (jupiter.lambdaDot - rates.periDot) + sigmaDot) / q;
        a = fromMeanMotion(clamp(n, 1e-8, 1));
        const dLamJ = state.jupRate * dt + wrapSigned(jupiter.lambda - wrap(state.lambdaJ0 + state.jupRate * dt));
        lam = wrap(state.lam0 + (p * dLamJ - (p - q) * (peri - state.peri0) + (ph.sigmaRaw - state.sigma0)) / q);
    } else {
        lam = wrap(record.meanAnomaly + peri + (state.n0 + rates.periDot) * dt);
    }
    const M = wrap(lam - peri);
    positionFromElements(a, record.e, record.inclination, node, peri - node, M, out);
    out.a = a;
    out.lambda = lam;
    out.meanAnomaly = M;
    out.peri = peri;
    out.node = node;
    out.sigma = sigma;
    out.sigmaDot = sigmaDot;
    out.state = state;
    return out;
}

const scratch = {};
