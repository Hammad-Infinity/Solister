export const COMET_KM_PER_AU = 149597870.7;

export const COMET_VISUAL_PROFILES = Object.freeze({
    comet67p: Object.freeze({
        perihelionAU: 1.24,
        comaRamp: Object.freeze({ startAU: 3.9, fullAU: 3.4 }),
        tailRamp: Object.freeze({ startAU: 3.0, fullAU: 2.5 }),
        appearance: 'Steady dust production with a standard curving dust tail',
        dustRadiusKm: 35000, gasRadiusKm: 60000, gasFraction: 0.12,
        dustGain: 1.15, ionGain: 0.10, ionLengthKm: 6000000,
        dustAgeDays: 24, dustWidthKm: 65000, dustTint: 0xf5eee3,
        gasTint: 0x9dd3c0, comaGain: 1.0, comaRadiusGain: 1.0,
        ionWidthScale: 1.0, jetCount: 0, jetGain: 0,
    }),
    comet46p: Object.freeze({
        perihelionAU: 1.05,
        comaRamp: Object.freeze({ startAU: 3.0, fullAU: 2.5 }),
        tailRamp: Object.freeze({ startAU: 1.5, fullAU: 1.1 }),
        appearance: 'Hyperactive gas emitter with a large green coma and very faint dust tail',
        dustRadiusKm: 45000, gasRadiusKm: 180000, gasFraction: 0.98,
        dustGain: 0.018, ionGain: 0.035, ionLengthKm: 5000000,
        dustAgeDays: 12, dustWidthKm: 45000, dustTint: 0xe8fff3,
        gasTint: 0x52f6a1, comaGain: 2.4, comaRadiusGain: 1.25,
        ionWidthScale: 0.8, jetCount: 0, jetGain: 0,
    }),
    comet9p: Object.freeze({
        perihelionAU: 1.54,
        comaRamp: Object.freeze({ startAU: 2.5, fullAU: 2.0 }),
        tailRamp: Object.freeze({ startAU: 1.8, fullAU: 1.5 }),
        appearance: 'Subdued, vent-limited activity with a short, low-contrast tail',
        dustRadiusKm: 26000, gasRadiusKm: 42000, gasFraction: 0.20,
        dustGain: 0.24, ionGain: 0.08, ionLengthKm: 1800000,
        dustAgeDays: 7, dustWidthKm: 42000, dustTint: 0xf1ece2,
        gasTint: 0xa8d6c3, comaGain: 0.38, comaRadiusGain: 0.82,
        ionWidthScale: 0.8, jetCount: 3, jetGain: 0.14,
    }),
    comet2p: Object.freeze({
        perihelionAU: 0.34,
        comaRamp: Object.freeze({ startAU: 1.7, fullAU: 1.2 }),
        tailRamp: Object.freeze({ startAU: 0.5, fullAU: 0.34 }),
        appearance: 'Nearly hidden coma; narrow plasma-beam tail close to the Sun',
        dustRadiusKm: 12000, gasRadiusKm: 35000, gasFraction: 0.35,
        dustGain: 0.012, ionGain: 0.22, ionLengthKm: 22000000,
        dustAgeDays: 4, dustWidthKm: 28000, dustTint: 0xece8e2,
        gasTint: 0xc4ddf4, comaGain: 0.08, comaRadiusGain: 0.62,
        ionWidthScale: 0.16, jetCount: 0, jetGain: 0,
    }),
});

export function cometVisualProfile(key) {
    return COMET_VISUAL_PROFILES[key] || COMET_VISUAL_PROFILES.comet67p;
}

function rampAt(distanceAU, ramp) {
    if (!(distanceAU > 0) || !ramp || !(ramp.startAU > ramp.fullAU)) return 0;
    const t = Math.max(0, Math.min(1,
        (ramp.startAU - distanceAU) / (ramp.startAU - ramp.fullAU)));
    return t * t * (3 - 2 * t);
}

function solarHeating(distanceAU, perihelionAU) {
    if (!(distanceAU > 0) || !(perihelionAU > 0)) return 0;
    const relativeDistance = Math.max(1, distanceAU / perihelionAU);
    return 1 / (relativeDistance * relativeDistance);
}

export function cometActivityAtDistance(distanceAU, key = '', component = 'coma') {
    const profile = cometVisualProfile(key);
    const ramp = component === 'tail' ? profile.tailRamp : profile.comaRamp;
    return rampAt(distanceAU, ramp) * solarHeating(distanceAU, profile.perihelionAU);
}

export function describeCometAppearance(distanceAU, key, output = {}) {
    const profile = cometVisualProfile(key);
    const distance = Math.max(0.05, Number.isFinite(distanceAU) ? distanceAU : 3.5);
    const comaRamp = rampAt(distance, profile.comaRamp);
    const tailRamp = rampAt(distance, profile.tailRamp);
    const heating = solarHeating(distance, profile.perihelionAU);
    const comaActivity = Math.max(0, Math.min(1, comaRamp * heating));
    const tailActivity = Math.max(0, Math.min(1, tailRamp * heating));
    const comaVisibility = Math.sqrt(comaActivity);
    const tailVisibility = Math.sqrt(tailActivity);
    const gasSpeed = 0.8 / Math.sqrt(distance);
    const gasLifetime = 86400 * distance * distance;
    const gasLength = gasSpeed * gasLifetime;
    const solarFlux = 1 / Math.max(0.05, distance * distance);

    output.activity = comaActivity;
    output.comaActivity = comaActivity;
    output.tailActivity = tailActivity;
    output.comaRamp = comaRamp;
    output.tailRamp = tailRamp;
    output.heating = heating;
    output.perihelionAU = profile.perihelionAU;
    output.appearance = profile.appearance;
    output.stage = comaRamp === 0 ? 'inactive' : distance > profile.comaRamp.fullAU ? 'onset' : 'active';
    output.nucleusVisibility = 1;
    output.dustRadiusKm = profile.dustRadiusKm * comaVisibility;
    output.gasRadiusKm = Math.min(
        profile.gasRadiusKm * profile.comaRadiusGain,
        gasLength * 3,
    ) * Math.pow(comaActivity, 0.42);
    output.comaRadiusKm = Math.max(output.dustRadiusKm, output.gasRadiusKm);
    output.gasLengthKm = gasLength;
    output.gasFraction = profile.gasFraction;
    output.dustTint = profile.dustTint;
    output.gasTint = profile.gasTint;
    output.opticalDepth = 0.032 * profile.comaGain *
        Math.pow(comaActivity, 0.7) * solarFlux;
    output.ionLengthKm = profile.ionLengthKm * Math.pow(tailActivity, 0.7);
    output.ionLengthAU = output.ionLengthKm / COMET_KM_PER_AU;
    output.ionRadiusKm = (3500 + 9500 * tailVisibility) * tailVisibility * profile.ionWidthScale;
    output.dustWidthKm = profile.dustWidthKm * tailVisibility;
    output.dustAgeDays = profile.dustAgeDays * tailVisibility;
    output.dustBrightness = 1.2 * profile.dustGain *
        Math.pow(tailActivity, 0.65) * solarFlux;
    output.ionBrightness = 1.45 * profile.ionGain *
        Math.pow(tailActivity, 0.7) * solarFlux;
    output.jetActivity = comaActivity * profile.jetGain;
    output.jetCount = profile.jetCount;
    return output;
}
