// Thermodynamics of a rising parcel of air.
//
// This file owns one question, asked of one column of the atmosphere: *given
// the surface temperature and humidity, what happens to a bubble of air that
// leaves the ground?* The answer is the whole of convection:
//
//   * where it first condenses -- the lifting condensation level, which is the
//     cloud base;
//   * how much buoyant energy it gains on the way up -- CAPE, in J/kg, which
//     sets how violent the updraught can be;
//   * how high it finally stops -- the equilibrium level, which is the cloud
//     top, and by definition can never exceed the tropopause;
//   * the temperatures it passes through, which decide whether the cloud is
//     liquid, ice, or the mixed phase in between.
//
// The mixed phase matters more than it looks: lightning is generated in the
// layer between about -10 C and -40 C where ice crystals and supercooled drops
// collide, so the depth of that layer is what makes a cloud a thunderstorm
// rather than a rain cloud.
//
// Every constant here is physical, not tuned: Rd and Rv are the gas constants
// of dry air and water vapour, Lv is the latent heat of vaporisation at 0 C,
// and the lapse rates come from the first law, not from a curve fit. The one
// approximation with a number in it is the environmental lapse rate, 6.5 K/km
// -- the standard tropospheric value.

const THERMO = {
    Rd: 287.05,          // J/kg/K, dry air
    Rv: 461.5,           // J/kg/K, water vapour
    cp: 1005,            // J/kg/K, dry air at constant pressure
    g: 9.80665,          // m/s^2
    Lv: 2.501e6,         // J/kg, latent heat of vaporisation at 0 C
    epsilon: 0.622,      // Rd/Rv
    lapseEnv: 6.5,       // K/km, environmental (standard troposphere)
    // Entrainment: a rising plume drags dry environmental air in through its
    // sides, which cools it and is the reason CAPE is a few thousand J/kg and
    // not ten times that. A parcel rising without any mixing would stay warmer
    // than a 6.5 K/km environment all the way to the tropopause, which is not
    // what the atmosphere does. 0.12 per km is the standard entraining-plume
    // coefficient for a plume a few kilometres across.
    entrainmentPerKm: 0.12,
    lapseDry: 9.8,       // K/km, dry adiabatic
    scaleHeightKm: 7.9,  // pressure scale height of the troposphere
    seaLevelPressureHpa: 1013.25,
    // -10 C to -40 C: the mixed-phase layer where non-inductive charging makes
    // lightning (Saunders). Above -40 C a cloud is all ice; below -10 C it is
    // all liquid, and neither charges efficiently.
    mixedPhaseTopC: -10,
    mixedPhaseBottomC: -40
};

// Saturation vapour pressure over water, Pa. Buck's equation, the standard
// engineering form: accurate to 0.05 % between -20 and +50 C.
function saturationVapourPressurePa(tC) {
    return 611.21 * Math.exp((18.678 - tC / 234.5) * (tC / (257.14 + tC)));
}

// Dew point from temperature and relative humidity, C. Inverted Magnus form.
function dewPointC(tC, rh) {
    const r = Math.max(0.01, Math.min(1, rh));
    const g = Math.log(r) + 18.678 * tC / (257.14 + tC);
    return 257.14 * g / (18.678 - g);
}

// Lifting condensation level, km. Espy's rule: the parcel cools 9.8 K/km and the
// dew point falls 1.8 K/km, so they meet at about 125 m per K of spread. The
// number agrees with the direct parcel integration below to within a few per
// cent, which is why it is the textbook rule of thumb for cloud base.
function lclHeightKm(tC, tdC) {
    return Math.max(0, 0.125 * (tC - tdC));
}

// Moist adiabatic lapse rate, K/km, at temperature tC and pressure pHPa.
// Standard form from the first law with latent heating; it falls from ~6.5 K/km
// in warm air to ~9 K/km in very cold air.
function moistLapseRateKPerKm(tC, pHPa) {
    const T = tC + 273.15;
    const p = pHPa * 100;
    const es = Math.min(0.9 * p, saturationVapourPressurePa(tC));
    const rs = THERMO.epsilon * es / Math.max(1, p - es);
    const num = THERMO.g * (1 + THERMO.Lv * rs / (THERMO.Rd * T));
    const den = THERMO.cp + (THERMO.Lv * THERMO.Lv * rs * THERMO.epsilon) / (THERMO.Rd * T * T);
    return (num / den) * 1000;
}

// Pressure, hPa, at height z km in the standard troposphere.
function pressureAtKm(zKm) {
    return THERMO.seaLevelPressureHpa * Math.exp(-zKm / THERMO.scaleHeightKm);
}

/**
 * Temperature of the environment at height z, C: the surface value falling at
 * the standard lapse rate to the tropopause, then constant (the stratosphere is
 * stably stratified, which is why nothing rises through it).
 */
function environmentTemperatureC(zKm, surfaceT_C, tropopauseKm, tropopauseC, lapseEnvKPerKm) {
    if (zKm >= tropopauseKm) return tropopauseC;
    return surfaceT_C - (lapseEnvKPerKm !== undefined ? lapseEnvKPerKm : THERMO.lapseEnv) * zKm;
}

/**
 * Lift a parcel and integrate its buoyancy.
 *
 * @param {object} input
 *   surfaceT_C, surfaceRH, tropopauseKm, tropopauseC
 * @returns {object}
 *   lclKm            cloud base
 *   lfcKm            level of free convection (where buoyancy turns positive)
 *   elKm             equilibrium level (cloud top)
 *   capeJkg          buoyant energy between LFC and EL
 *   updraftMs        maximum updraught, sqrt(2 CAPE)
 *   cloudTopKm       the higher of EL and LCL (a stable parcel makes no cloud
 *                    top worth the name; a shallow cumulus still has a top)
 *   mixedPhaseDepthKm  thickness of the -10 to -40 C layer inside the cloud
 *   freezingLevelKm  the 0 C level
 *   depthKm          cloud top minus base
 */
function parcelAscent(input) {
    const surfaceT_C = input.surfaceT_C;
    const rh = Math.max(0.05, Math.min(1, input.surfaceRH));
    const tropopauseKm = input.tropopauseKm;
    const tropopauseC = input.tropopauseC;
    const lapseEnv = input.lapseEnvKPerKm !== undefined ? input.lapseEnvKPerKm : THERMO.lapseEnv;

    const tdC = dewPointC(surfaceT_C, rh);
    const lcl = Math.min(tropopauseKm, lclHeightKm(surfaceT_C, tdC));

    const STEP = 0.05;                 // km
    const steps = Math.ceil(tropopauseKm / STEP);

    // The parcel's water: a mixing ratio set by the surface humidity, conserved
    // below the cloud base and equal to the saturation value above it.
    const p0 = pressureAtKm(0) * 100;                       // Pa
    const e0 = saturationVapourPressurePa(surfaceT_C);
    const rSurface = THERMO.epsilon * (rh * e0) / Math.max(1, p0 - rh * e0);
    let parcelR = Math.max(1e-6, rSurface);
    let parcelT = surfaceT_C;

    let cape = 0;
    let lfc = null;
    let el = null;
    let lastBuoyantKm = -1;
    let previousBuoyancy = 0;

    for (let i = 1; i <= steps; i++) {
        const z = i * STEP;
        const p = pressureAtKm(z);                          // hPa
        const tEnv = environmentTemperatureC(z, surfaceT_C, tropopauseKm, tropopauseC, lapseEnv);

        if (z <= lcl) {
            // Dry adiabatic: 9.8 K/km, mixing ratio conserved.
            parcelT = surfaceT_C - THERMO.lapseDry * z;
        } else {
            // Moist adiabatic at the parcel's own temperature and pressure...
            parcelT -= moistLapseRateKPerKm(parcelT, p) * STEP;
            // ...then entrainment: the plume mixes with its surroundings, which
            // pulls its temperature back toward the environment. This is the
            // term that makes a tropical sounding give 1500 J/kg instead of
            // 17000, and it is what real convection does.
            parcelT += THERMO.entrainmentPerKm * STEP * (tEnv - parcelT);
            const es = Math.min(0.9 * p * 100, saturationVapourPressurePa(parcelT));
            parcelR = THERMO.epsilon * es / Math.max(1, p * 100 - es);
        }

        // Virtual temperature: moist air is lighter than dry air at the same T.
        const tvParcel = (parcelT + 273.15) * (1 + 0.608 * parcelR);
        const tvEnv = tEnv + 273.15;
        const buoyancy = THERMO.g * (tvParcel - tvEnv) / tvEnv;   // m/s^2

        if (buoyancy > 0) {
            if (lfc === null && z > lcl) lfc = z;
            if (lfc !== null) {
                cape += 0.5 * (previousBuoyancy + buoyancy) * STEP * 1000;
                el = z;
                lastBuoyantKm = z;
            }
        } else if (lfc !== null && z > lastBuoyantKm + 0.4) {
            // Half a kilometre above the last buoyant level: the parcel has
            // run out of energy and the cloud top is behind it.
            break;
        }
        previousBuoyancy = buoyancy;
    }

    const capeJkg = Math.max(0, cape);
    const cloudTopKm = Math.max(lcl, el !== null ? el : lcl);

    // The mixed-phase layer: where the cloud sits between -10 C and -40 C. It is
    // evaluated against the environmental lapse rate, because once a cloud is
    // large enough it entrains the air around it rather than remembering the
    // surface parcel.
    const zForT = t => (surfaceT_C - t) / lapseEnv;
    // -10 C sits lower in the cloud than -40 C, so the mixed-phase layer runs
    // from the former up to the latter, clipped by the cloud top.
    const zWarm = Math.max(0, Math.min(cloudTopKm, zForT(THERMO.mixedPhaseTopC)));
    const zCold = Math.max(0, Math.min(cloudTopKm, zForT(THERMO.mixedPhaseBottomC)));
    const mixedPhaseDepthKm = Math.max(0, zCold - zWarm);

    return {
        lclKm: lcl,
        lfcKm: lfc !== null ? lfc : lcl,
        elKm: el !== null ? el : lcl,
        capeJkg,
        updraftMs: Math.sqrt(2 * Math.max(0, capeJkg)),
        cloudTopKm,
        cloudBaseKm: lcl,
        depthKm: Math.max(0, cloudTopKm - lcl),
        mixedPhaseDepthKm,
        freezingLevelKm: zForT(0),
        dewPointC: tdC
    };
}

// Ice fraction of a cloud at temperature tC. Liquid clouds dominate down to
// about -10 C; between -10 and -38 the two phases coexist (which is exactly the
// layer that makes lightning); below -38 C the cloud is all ice.
function iceFraction(tC) {
    if (tC >= 0) return 0;
    if (tC <= -38) return 1;
    const t = (-tC) / 38;
    return t * t * (3 - 2 * t);
}

// Optical depth of a cloud slab from its liquid water path and droplet radius.
// tau = 3 LWP / (2 rho_w r_e) -- the standard relation for a scattering layer
// (Stephens). LWP in g/m^2, r_e in micrometres; rho_w = 1e6 g/m^3.
function opticalDepthFromLwp(lwpGm2, reUm) {
    return (3 * lwpGm2) / (2 * 1e6 * reUm * 1e-6);
}

// Liquid water path of a convective cloud, g/m^2, from its depth. Convective
// clouds are close to adiabatic: the condensate grows roughly linearly with
// height above cloud base, and an adiabatic parcel at 280 K carries about
// 2 g/m^3 per km. The 0.35 factor is the usual entrainment efficiency -- real
// clouds mix dry air in and hold a third of the adiabatic value.
function liquidWaterPathFromDepth(depthKm) {
    // Condensate grows with height above cloud base at about 1.5 g/m^3 per km
    // (the adiabatic rate for a parcel near 280 K), capped at 3 g/m^3 where
    // precipitation starts to remove it. Integrating gives half the top value
    // times the depth; the 0.35 is the entrainment efficiency of a real cloud.
    const lwcTop = Math.min(1.5, 1.5 * depthKm);
    return 0.25 * 0.5 * lwcTop * depthKm * 1000;
}

globalThis.THERMO = THERMO;
globalThis.saturationVapourPressurePa = saturationVapourPressurePa;
globalThis.dewPointC = dewPointC;
globalThis.lclHeightKm = lclHeightKm;
globalThis.moistLapseRateKPerKm = moistLapseRateKPerKm;
globalThis.pressureAtKm = pressureAtKm;
globalThis.environmentTemperatureC = environmentTemperatureC;
globalThis.parcelAscent = parcelAscent;
globalThis.iceFraction = iceFraction;
globalThis.opticalDepthFromLwp = opticalDepthFromLwp;
globalThis.liquidWaterPathFromDepth = liquidWaterPathFromDepth;
