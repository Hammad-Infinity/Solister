// The storm population: which weather systems exist, where, and how big.
//
// One texture of cloud cannot contain a thunderstorm: at 20 km per texel the
// smallest thing the map can draw is about the size of a city. So the field is
// built from *systems*, at the scales the atmosphere actually uses, and the
// small end is carried by the lightning budget rather than by geometry.
//
// The population follows the standard meteorological scale ladder, and each
// rung's size is the observed one:
//
//   convective cell   5-15 km across, a single cumulonimbus; 2000 exist at any
//                     moment (NOAA), which is below one texel on this map, so
//                     they are counted, not drawn.
//   mesoscale system  100-500 km across, a squall line or a cluster of cells;
//                     a few hundred at any moment, mostly over land in the
//                     tropics.
//   tropical cyclone  200-500 km across typically, up to 1000; eye 30-60 km,
//                     radius of maximum wind 30-60 km; about a dozen at any
//                     moment, only over water warmer than 26.5 C.
//   extratropical     1000-2500 km across with fronts; tens per hemisphere,
//     cyclone         in the storm tracks at 35-65 degrees.
//
// Where each may exist is decided by the climate: cells where CAPE is high,
// tropical cyclones only over warm ocean, extratropical cyclones only in the
// baroclinic zone. How much lightning they make is decided by the depth of
// their mixed-phase layer, which comes from the thermodynamics.

const STORM_SCALE = {
    // NOAA: as many as 2000 thunderstorms are active at any moment, producing
    // the 44 flashes per second the whole planet sees. 44/2000 = 0.022 fl/s per
    // storm, or 1.3 per minute -- the observed average for an ordinary cell.
    // The number of cells is not assumed: it is what the observed 44 flashes a
    // second requires once each cell's rate is known from its CAPE and its
    // mixed-phase depth. NOAA's estimate of about 2000 active thunderstorms is
    // then a *test* of the physics, not an input. `targetFlashRate` is the
    // observed global total (44 +/- 5 per second).
    targetFlashRate: 44,
    cellCount: 2000,          // initial sample; scaled to the target below
    cellDiameterKm: [5, 16],

    // A cell's *active* convection covers only its core, not its anvil or its
    // surrounding cloud: about 30 km^2, a 6 km circle -- the width of the
    // updraught, which is the part that charges. Everything else about a
    // thunderstorm is inert cloud.
    cellActiveAreaKm2: 32,

    // Flash density in active deep convection: one flash every ten seconds over
    // a 300 km^2 core is 3e-4 per km^2 per second. Everything below is sized so
    // that the population's total active area (about 137 000 km^2, a fortieth
    // of one per cent of the planet) times this density gives the observed
    // 44 +/- 5 flashes a second.
    flashDensityActive: 3.2e-4,

    mcsCount: 60,
    mcsDiameterKm: [100, 500],
    // A squall line is long and narrow: its active convection is the line
    // itself, not the stratiform region behind it.
    mcsActiveAreaKm2: 1100,

    tropicalCycloneCount: 12,
    tropicalCycloneDiameterKm: [300, 900],
    tropicalCycloneActiveAreaKm2: 100,

    extratropicalCount: 46,          // per hemisphere
    extratropicalDiameterKm: [1000, 2500],
    extratropicalActiveAreaKm2: 60,
};

// Deterministic generator: the same seed gives the same world every load, so a
// probe can compare two runs and the user always sees the same planet.
function stormRandom(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/**
 * Build the storm population for a moment.
 *
 * @param {object} opts
 *   seed          deterministic seed
 *   dayOfYear     season
 *   landAt        (latDeg, lonDeg) => 0..1 land fraction, used to bias storms
 *                 to land (convection) or to warm ocean (tropical cyclones)
 *   climateAt     (latDeg, opts) => climate record (defaults to earthClimateAt)
 * @returns {{storms: Array, cells: Array, flashPerSecond: number}}
 */
function buildStormPopulation(opts = {}) {
    const random = stormRandom(opts.seed !== undefined ? opts.seed : 770312);
    const day = opts.dayOfYear !== undefined ? opts.dayOfYear : 182;
    const climateAt = opts.climateAt || globalThis.earthClimateAt;
    const landAt = opts.landAt || (() => 0);            // unknown: assume ocean
    const decl = globalThis.solarDeclinationDeg ? globalThis.solarDeclinationDeg(day) : 23;
    const shift = 0.4 * decl;

    const storms = [];

    // ---- mesoscale convective systems ------------------------------------
    // Squall lines and clusters: 100-500 km, over land in the tropics and
    // subtropics, where CAPE is high and the boundary layer is deep.
    for (let i = 0; i < STORM_SCALE.mcsCount; i++) {
        let lat = 0, lon = 0, place = null;
        for (let attempt = 0; attempt < 40; attempt++) {
            lat = Math.asin(random() * 2 - 1) * 180 / Math.PI;
            lon = random() * 360 - 180;
            const c = climateAt(lat, { dayOfYear: day, longitudeDeg: lon, isLand: landAt(lat, lon) > 0.5 });
            const parcel = globalThis.parcelAscent({
                surfaceT_C: c.surfaceT_C, surfaceRH: c.rh,
                tropopauseKm: c.tropopauseKm, tropopauseC: c.tropopauseC,
                lapseEnvKPerKm: c.lapseEnvKPerKm
            });
            const land = landAt(lat, lon);
            const weight = Math.min(1, (parcel.capeJkg / 900) * (0.15 + 1.1 * land));
            if (random() < weight) { place = parcel; break; }
        }
        if (!place) continue;
        const diameter = STORM_SCALE.mcsDiameterKm[0]
            + random() * (STORM_SCALE.mcsDiameterKm[1] - STORM_SCALE.mcsDiameterKm[0]);
        storms.push({
            kind: "mcs",
            lat, lon,
            diameterKm: diameter,
            intensity: 0.55 + 0.45 * random(),
            // A squall line puts its convection along one edge; about a fifth of
            // the system's area is active.
            activeAreaKm2: STORM_SCALE.mcsActiveAreaKm2,
            capeJkg: place.capeJkg,
            mixedPhaseDepthKm: place.mixedPhaseDepthKm,
            elongation: 1.5 + random() * 1.6,
            orientationRad: random() * Math.PI,
            driftKmPerHour: 30 + random() * 30
        });
    }

    // ---- tropical cyclones -----------------------------------------------
    // Only over water warmer than 26.5 C -- which, in the annual mean, means
    // between about 8 and 30 degrees latitude, shifted with the season. The
    // eye is 30-60 km across and the eyewall is the only part that makes
    // lightning; a cyclone is an enormous cloud that is electrically quiet
    // compared with a continental squall line.
    for (let i = 0; i < STORM_SCALE.tropicalCycloneCount; i++) {
        let lat = 0, lon = 0, place = null;
        for (let attempt = 0; attempt < 60; attempt++) {
            const hemi = random() < 0.5 ? 1 : -1;
            // No cyclones within about 5 degrees of the equator: without
            // Coriolis force there is nothing to spin a vortex up.
            lat = hemi * (6.5 + random() * 22) + shift * 0.6;
            lon = random() * 360 - 180;
            if (Math.abs(lat) < 5.5 || Math.abs(lat) > 35) continue;
            if (landAt(lat, lon) > 0.15) continue;                // needs open water
            const c = climateAt(lat, { dayOfYear: day, longitudeDeg: lon, isLand: false });
            if (c.surfaceT_C < 26.5) continue;                    // Gray's threshold
            const parcel = globalThis.parcelAscent({
                surfaceT_C: c.surfaceT_C, surfaceRH: c.rh,
                tropopauseKm: c.tropopauseKm, tropopauseC: c.tropopauseC
            });
            place = { parcel, surfaceT: c.surfaceT_C };
            break;
        }
        if (!place) continue;
        const diameter = STORM_SCALE.tropicalCycloneDiameterKm[0]
            + random() * (STORM_SCALE.tropicalCycloneDiameterKm[1] - STORM_SCALE.tropicalCycloneDiameterKm[0]);
        const eyeKm = 15 + random() * 15;                          // 30-60 km across
        storms.push({
            kind: "cyclone",
            lat, lon,
            diameterKm: diameter,
            eyeKm,
            intensity: 0.5 + 0.5 * random(),
            // The eyewall ring is where a cyclone's lightning lives, and even
            // there it is sparse: a cyclone is a huge cloud that is
            // electrically quiet next to a continental squall line.
            activeAreaKm2: STORM_SCALE.tropicalCycloneActiveAreaKm2,
            capeJkg: place.parcel.capeJkg,
            mixedPhaseDepthKm: place.parcel.mixedPhaseDepthKm,
            driftKmPerHour: 15 + random() * 20,
            hemisphere: lat >= 0 ? 1 : -1
        });
    }

    // ---- extratropical cyclones ------------------------------------------
    // The big ones: 1000-2500 km, in the storm tracks, with a warm sector and a
    // cold front. Lightning is sparse and confined to the frontal band.
    for (const hemi of [1, -1]) {
        for (let i = 0; i < STORM_SCALE.extratropicalCount; i++) {
            const lat = hemi * (34 + random() * 30) + shift * 0.5;
            if (Math.abs(lat) > 72) continue;
            const lon = random() * 360 - 180;
            const c = climateAt(lat, { dayOfYear: day, longitudeDeg: lon, isLand: landAt(lat, lon) > 0.5 });
            const parcel = globalThis.parcelAscent({
                surfaceT_C: c.surfaceT_C, surfaceRH: c.rh,
                tropopauseKm: c.tropopauseKm, tropopauseC: c.tropopauseC
            });
            const diameter = STORM_SCALE.extratropicalDiameterKm[0]
                + random() * (STORM_SCALE.extratropicalDiameterKm[1] - STORM_SCALE.extratropicalDiameterKm[0]);
            storms.push({
                kind: "extratropical",
                lat, lon,
                diameterKm: diameter,
                intensity: 0.4 + 0.6 * random(),
                // Frontal bands: narrow, and electrified far more weakly than
                // tropical convection.
                activeAreaKm2: STORM_SCALE.extratropicalActiveAreaKm2,
                capeJkg: parcel.capeJkg,
                mixedPhaseDepthKm: parcel.mixedPhaseDepthKm,
                // The comma: the cold front trails behind the low centre.
                frontAngleRad: random() * Math.PI * 2,
                driftKmPerHour: 35 + random() * 35,
                hemisphere: hemi
            });
        }
    }

    // ---- convective cells ------------------------------------------------
    // Placed with a probability that follows CAPE and the land fraction: over
    // warm tropical land CAPE is 2000-3000 J/kg and much of the map is
    // unstable; over the subtropical ocean it is a few hundred and the air is
    // capped. The *number* of them comes from the closure at the end: given how
    // much lightning one such cell makes, this is how many are needed to
    // account for the planet's observed total.
    function sampleCell(stream) {
        for (let attempt = 0; attempt < 40; attempt++) {
            const lat = Math.asin(stream() * 2 - 1) * 180 / Math.PI;
            const lon = stream() * 360 - 180;
            const land = landAt(lat, lon);
            const c = climateAt(lat, { dayOfYear: day, longitudeDeg: lon, isLand: land > 0.5 });
            const parcel = globalThis.parcelAscent({
                surfaceT_C: c.surfaceT_C, surfaceRH: c.rh,
                tropopauseKm: c.tropopauseKm, tropopauseC: c.tropopauseC,
                lapseEnvKPerKm: c.lapseEnvKPerKm
            });
            const weight = Math.min(1, (parcel.capeJkg / 1200) * (0.35 + 0.9 * land));
            if (stream() < weight) {
                return {
                    lat, lon,
                    diameterKm: STORM_SCALE.cellDiameterKm[0]
                        + stream() * (STORM_SCALE.cellDiameterKm[1] - STORM_SCALE.cellDiameterKm[0]),
                    activeAreaKm2: STORM_SCALE.cellActiveAreaKm2,
                    capeJkg: parcel.capeJkg,
                    mixedPhaseDepthKm: parcel.mixedPhaseDepthKm,
                    land
                };
            }
        }
        return null;
    }

    // ---- the lightning budget --------------------------------------------
    // Rates scale with the energy available (CAPE) and with the depth of the
    // mixed-phase layer, because that layer is where charge separates.
    const flashRateOf = s => {
        const capeFactor = Math.pow(Math.max(0, s.capeJkg) / 1500, 0.7);
        // A storm with no layer between -10 and -40 C makes no lightning at
        // all, whatever its CAPE. The reference depth is 3.5 km.
        const phaseFactor = s.mixedPhaseDepthKm > 0.3
            ? Math.min(3, Math.pow(s.mixedPhaseDepthKm / 3.5, 1.5))
            : 0;
        return STORM_SCALE.flashDensityActive * s.activeAreaKm2 * capeFactor * phaseFactor;
    };

    let stormFlash = 0;
    for (const s of storms) {
        s.flashPerSecond = flashRateOf(s);
        stormFlash += s.flashPerSecond;
    }

    // How many cells does the planet need? Sample a few hundred, average their
    // rate, and close the budget on the observed 44 flashes a second. This is
    // the one place the observed total enters the model -- everywhere else the
    // rates come from the physics of the individual storm.
    const cellStream = stormRandom((opts.seed !== undefined ? opts.seed : 770312) ^ 0x5f3759df);
    const sampleCount = 400;
    let sampled = 0, sampleFlash = 0;
    for (let i = 0; i < sampleCount; i++) {
        const c = sampleCell(cellStream);
        if (!c) continue;
        sampled++;
        sampleFlash += flashRateOf(c);
    }
    const averageCellRate = sampled ? sampleFlash / sampled : 0;
    const cellsNeeded = averageCellRate > 0
        ? Math.max(0, Math.round((STORM_SCALE.targetFlashRate - stormFlash) / averageCellRate))
        : 0;

    const cells = [];
    for (let i = 0; i < cellsNeeded; i++) {
        const c = sampleCell(cellStream);
        if (!c) continue;
        c.flashPerSecond = flashRateOf(c);
        cells.push(c);
    }

    const flashPerSecond = stormFlash + cells.reduce((a, c) => a + c.flashPerSecond, 0);

    return { storms, cells, flashPerSecond, cellsNeeded, averageCellRate, scale: STORM_SCALE };
}

globalThis.STORM_SCALE = STORM_SCALE;
globalThis.buildStormPopulation = buildStormPopulation;
