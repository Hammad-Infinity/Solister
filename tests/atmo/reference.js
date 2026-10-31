// Independent (double precision) reference for the precomputed atmosphere.
// Nothing here uses the LUT machinery: optical depths are integrated from
// scratch with a fine trapezoid, and the single-scattering integral is
// evaluated directly along the ray.  This is the yardstick the GPU tables are
// compared against in lab.html.

export function params(rg, topKm, hr, hm, betaR, betaMSca, betaMEx, mieG) {
    return { Rg: rg, Rt: rg + topKm, HR: hr, HM: hm, betaR, betaMSca, betaMEx, mieG };
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a) => Math.sqrt(dot3(a, a));
const mad = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

export function limit(P, r, mu) {
    const dout = -r * mu + Math.sqrt(Math.max(r * r * (mu * mu - 1) + P.Rt * P.Rt, 0));
    const delta2 = r * r * (mu * mu - 1) + P.Rg * P.Rg;
    if (delta2 >= 0) {
        const din = -r * mu - Math.sqrt(delta2);
        if (din >= 0) return Math.min(dout, din);
    }
    return Math.max(dout, 0);
}

// Density-weighted extinction integral along a straight segment, integrated
// with `steps` trapezoid slices (exponential density, earth-like curvature).
export function segmentOpticalDepth(P, o, d, length, steps = 2048) {
    let odR = 0;
    let odM = 0;
    if (!(length > 0)) return [0, 0];
    const dx = length / steps;
    let prevR = Math.max(len3(o), P.Rg);
    let prevRho = Math.exp(-(prevR - P.Rg) / P.HR);
    let prevMie = Math.exp(-(prevR - P.Rg) / P.HM);
    for (let i = 1; i <= steps; i++) {
        const p = mad(o, d, i * dx);
        const ri = Math.max(len3(p), P.Rg);
        const rho = Math.exp(-(ri - P.Rg) / P.HR);
        const mie = Math.exp(-(ri - P.Rg) / P.HM);
        odR += (prevRho + rho) * 0.5 * dx;
        odM += (prevMie + mie) * 0.5 * dx;
        prevRho = rho;
        prevMie = mie;
    }
    return [odR, odM];
}

export function transmittanceExact(P, o, d, length, steps = 2048) {
    const [odR, odM] = segmentOpticalDepth(P, o, d, length, steps);
    return [
        Math.exp(-(P.betaR[0] * odR + P.betaMEx[0] * odM)),
        Math.exp(-(P.betaR[1] * odR + P.betaMEx[1] * odM)),
        Math.exp(-(P.betaR[2] * odR + P.betaMEx[2] * odM))
    ];
}

// Transmittance from a point to the top of the atmosphere along dir, or 0
// when the ground blocks the sun.
export function sunTransmittance(P, p, s, steps = 1024) {
    const r = len3(p);
    const mu = dot3(p, s) / r;
    const horizon = -Math.sqrt(Math.max(1 - (P.Rg / r) * (P.Rg / r), 0));
    if (mu < horizon) return [0, 0, 0];
    const d = -r * mu + Math.sqrt(Math.max(r * r * (mu * mu - 1) + P.Rt * P.Rt, 0));
    return transmittanceExact(P, p, s, d, steps);
}

const phaseR = (mu) => 3 / (16 * Math.PI) * (1 + mu * mu);
const phaseM = (G, mu) => 1.5 / (4 * Math.PI) * (1 - G * G)
    * Math.pow(Math.max(1 + G * G - 2 * G * mu, 1e-9), -1.5) * (1 + mu * mu) / (2 + G * G);

export function phaseFunctions(P, mu) {
    return [phaseR(mu), phaseM(P.mieG, mu)];
}

// Direct evaluation of the phase-free single-scatter integrals that
// ag_inscatter1 stores:
//   ray(r,mu,muS,nu) = int_0^limit T(0->t) * T_sun(t) * rho_R(t) * betaR dt
//   mie(...)          = int_0^limit T(0->t) * T_sun(t) * rho_M(t) * betaMSca dt
export function singleScatterExact(P, r, mu, muS, nu, steps = 1536) {
    const vx = Math.sqrt(Math.max(1 - mu * mu, 0));
    const sx = vx > 1e-9 ? (nu - muS * mu) / vx : 0;
    const sy2 = 1 - sx * sx - muS * muS;
    if (sy2 < -1e-6) return null;
    const v = [vx, 0, mu];
    const s = [sx, Math.sqrt(Math.max(sy2, 0)), muS];
    const o = [0, 0, r];
    const L = limit(P, r, mu);
    if (!(L > 0)) return { ray: [0, 0, 0], mie: [0, 0, 0] };
    const dx = L / steps;
    const ray = [0, 0, 0];
    const mie = [0, 0, 0];
    // Accumulate the view optical depth as we walk the ray.
    let odR = 0;
    let odM = 0;
    let prevP = o;
    let prevRho = Math.exp(-(Math.max(r, P.Rg) - P.Rg) / P.HR);
    let prevDenM = Math.exp(-(Math.max(r, P.Rg) - P.Rg) / P.HM);
    for (let i = 1; i <= steps; i++) {
        const t = i * dx;
        const p = mad(o, v, t);
        const ri = Math.max(len3(p), P.Rg);
        const rho = Math.exp(-(ri - P.Rg) / P.HR);
        const denM = Math.exp(-(ri - P.Rg) / P.HM);
        const odRmid = odR + (prevRho + rho) * 0.5 * dx;
        const odMmid = odM + (prevDenM + denM) * 0.5 * dx;
        const sunT = sunTransmittance(P, p, s);
        for (let c = 0; c < 3; c++) {
            const tView = Math.exp(-(P.betaR[c] * odRmid + P.betaMEx[c] * odMmid));
            ray[c] += tView * sunT[c] * rho * P.betaR[c] * dx;
            mie[c] += tView * sunT[c] * denM * P.betaMSca[c] * dx;
        }
        odR = odRmid;
        odM = odMmid;
        prevP = p;
        prevRho = rho;
        prevDenM = denM;
    }
    return { ray, mie };
}

export function transmittanceExactPath(P, r, mu, steps = 4096) {
    const L = limit(P, r, mu);
    const o = [0, 0, r];
    const v = [Math.sqrt(Math.max(1 - mu * mu, 0)), 0, mu];
    return transmittanceExact(P, o, v, L, steps);
}
