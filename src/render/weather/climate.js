// Zonal climatology of the Earth's lower atmosphere.
//
// This file owns the *average state* of the air: how warm the surface is at a
// given latitude, how high and how cold the tropopause is, how moist the
// boundary layer is, and which way and how fast the wind blows. Everything the
// weather system does downstream -- where a cloud forms, how high it grows,
// whether it can make lightning, which way a storm moves -- is derived from
// these numbers, so they are the part that has to be right.
//
// The tables are annual-mean zonal means; the values are the standard
// climatology of the troposphere (as in Peixoto & Oort, "Physics of Climate",
// and the CIRA-86 reference atmosphere): surface air reaches 27 C just north of
// the equator, is below freezing poleward of about 60 degrees, and the
// pole-to-equator difference is about 40 K. The tropopause is 16-17 km over the
// equator and 8-9 km over the poles. The wind belts are the textbook three per
// hemisphere: easterly trades, westerlies, polar easterlies, with the
// subtropical jet at 10-12 km near 30 degrees.
//
// Two things are applied on top of the annual mean:
//
//   * Season. The whole pattern follows the sun. The circulation shifts toward
//     the summer hemisphere, and the surface warms there: the ITCZ sits about
//     five degrees north in July and five south in January, which is why the
//     northern tropics are the wettest place on the planet in boreal summer.
//   * Time of day. The land heats and cools far more than the ocean, so the
//     diurnal swing in surface temperature is a property of the surface below.

const EARTH_CLIMATE = {
    // Reference epoch: 1 July, 12:00 UTC -- boreal summer, the season the
    // reference composite was taken in, so the two can be compared directly.
    epochDayOfYear: 182,

    // Surface air temperature, degrees C, against latitude.
    surfaceTemperatureC: [
        [-90, -31], [-80, -26], [-70, -16], [-60, -6], [-50, 4], [-40, 11],
        [-30, 18], [-20, 23], [-10, 26], [0, 27], [10, 26.6], [20, 24],
        [30, 19.5], [40, 12], [50, 6], [60, -2], [70, -14], [80, -25], [90, -31]
    ],

    // Height of the lapse-rate tropopause, km. Highest over the equator (the
    // deep tropics reach 16.5-17 km), lowest over the poles.
    tropopauseKm: [
        [-90, 8.2], [-80, 8.4], [-70, 8.8], [-60, 9.6], [-50, 10.6], [-40, 11.6],
        [-30, 13.2], [-20, 15.0], [-10, 16.2], [0, 16.8], [10, 16.5], [20, 15.4],
        [30, 13.8], [40, 12.0], [50, 10.6], [60, 9.6], [70, 8.8], [80, 8.4], [90, 8.2]
    ],

    // Departure of the July surface temperature from the annual mean, K. The
    // annual table above is a mean over the year; a simulation at a fixed epoch
    // has to say which season it is in, and the seasons are not symmetric --
    // the north pole gains about 20 K in July while the tropics gain nothing.
    // The sign flips with the solar declination, so one table serves both.
    julyAnomalyK: [
        [-90, -20], [-75, -18], [-60, -12], [-45, -7], [-30, -4], [-15, -1],
        [0, 0], [15, 1], [30, 4], [45, 7], [60, 12], [75, 18], [90, 20]
    ],

    // Tropopause temperature, degrees C: near 190 K (-83 C) in the tropics, and
    // warmer where the tropopause is lower (about 215-220 K).
    tropopauseC: [
        [-90, -60], [-70, -58], [-50, -55], [-30, -58], [-10, -80], [0, -83],
        [10, -80], [30, -58], [50, -55], [70, -58], [90, -60]
    ],

    // Relative humidity of the boundary layer, per cent. Highest in the rising
    // branches (the ITCZ and the storm tracks), lowest under the subtropical
    // highs, where the descending branch of the Hadley cell dries the air.
    relativeHumidity: [
        [-90, 78], [-75, 78], [-60, 76], [-50, 74], [-40, 70], [-30, 68],
        [-20, 66], [-10, 72], [0, 80], [10, 78], [20, 68], [30, 66],
        [40, 70], [50, 74], [60, 76], [75, 78], [90, 78]
    ],

    // Zonal wind at 10 m, m/s, positive eastward. Trades are easterly (about
    // -6 m/s), the westerlies are about +9, and the southern westerlies are the
    // stronger of the two ("the roaring forties").
    zonalWindMs: [
        [-90, -2], [-80, -3], [-70, -3], [-60, 4], [-55, 9], [-50, 11], [-45, 10],
        [-40, 8], [-35, 4], [-30, -2], [-25, -5], [-20, -7], [-15, -7], [-10, -6],
        [-5, -4], [0, -1], [5, -3], [10, -6], [15, -7], [20, -7], [25, -6],
        [30, -3], [35, 1], [40, 5], [45, 9], [50, 10], [55, 9], [60, 6],
        [65, 3], [70, 0], [80, -3], [90, -2]
    ],

    // Meridional wind at 10 m, m/s, positive northward: the equatorward return
    // flow of the Hadley cell, a few metres per second at most.
    meridionalWindMs: [
        [-90, 0], [-60, 1.0], [-45, 1.2], [-30, 1.0], [-15, 1.4], [0, 0.4],
        [15, -1.4], [30, -1.0], [45, -1.2], [60, -1.0], [90, 0]
    ],

    // Subtropical jet core, m/s: ~30-40 in the summer hemisphere and 45-55 in
    // the winter one, near 30-35 degrees latitude at 200 hPa.
    jetMs: { north: 38, south: 48 },

    // Sea-surface temperature threshold for tropical cyclones (Gray): deep
    // convection organises into a cyclone only where the water is warmer than
    // about 26.5 C, which caps the bands at roughly 5-30 degrees from the
    // equator and, with the seasonal shift, is why no two basins peak at once.
    tropicalCycloneSstThresholdC: 26.5,

    // Surface pressure at sea level, hPa.
    seaLevelPressureHpa: 1013.25
};

// Smooth interpolation of a [lat, value] table, in degrees of latitude.
function climateTableAt(table, latDeg) {
    const lat = Math.max(table[0][0], Math.min(table[table.length - 1][0], latDeg));
    for (let i = 1; i < table.length; i++) {
        if (lat <= table[i][0]) {
            const [l0, v0] = table[i - 1];
            const [l1, v1] = table[i];
            let t = (lat - l0) / Math.max(l1 - l0, 1e-9);
            t = t * t * (3 - 2 * t);
            return v0 + (v1 - v0) * t;
        }
    }
    return table[table.length - 1][1];
}

// Solar declination, degrees, for a day of the year. Standard low-accuracy
// formula; good to a fraction of a degree, which is all a season needs.
function solarDeclinationDeg(dayOfYear) {
    const n = ((dayOfYear % 365.24) + 365.24) % 365.24;
    // Cooper's approximation: 23.44 deg * sin(360/365 * (284 + n)).
    return 23.44 * Math.sin(2 * Math.PI * (284 + n) / 365.24);
}

// The circulation follows the sun, but only partly: the ITCZ moves about
// two-thirds as far as the subsolar point, and the whole pattern shifts with
// it. Returns the latitude shift in degrees to apply before reading the tables.
function circulationShiftDeg(dayOfYear) {
    return 0.65 * solarDeclinationDeg(dayOfYear);
}

/**
 * Climate at a latitude and moment.
 *
 * @param {number} latDeg   latitude, degrees, north positive
 * @param {object} opts     { dayOfYear, longitudeDeg, surfaceAlbedo, isLand }
 * @returns {{surfaceT_C:number, tropopauseKm:number, tropopauseC:number,
 *            rh:number, windU:number, windV:number, jetMs:number,
 *            freezingLevelKm:number, seaLevelPressureHpa:number}}
 */
function earthClimateAt(latDeg, opts = {}) {
    const day = opts.dayOfYear !== undefined ? opts.dayOfYear : EARTH_CLIMATE.epochDayOfYear;
    const decl = solarDeclinationDeg(day);
    // The circulation belts follow the sun, but only partly: the ITCZ moves
    // about 40 % as far as the subsolar point. Temperature does not use this
    // shift at all -- the surface field already responds through the seasonal
    // anomaly below.
    const beltShift = 0.4 * decl;

    const surfaceT0 = climateTableAt(EARTH_CLIMATE.surfaceTemperatureC, latDeg);
    const tropopauseKm = climateTableAt(EARTH_CLIMATE.tropopauseKm, latDeg - beltShift);
    const tropopauseC = climateTableAt(EARTH_CLIMATE.tropopauseC, latDeg - beltShift);
    const rh = climateTableAt(EARTH_CLIMATE.relativeHumidity, latDeg - beltShift) / 100;
    const windU = climateTableAt(EARTH_CLIMATE.zonalWindMs, latDeg - beltShift);
    const windV = climateTableAt(EARTH_CLIMATE.meridionalWindMs, latDeg - beltShift);

    // Season: the July anomaly table, scaled by how far the sun has swung.
    // sin(23.44) is the scale at the solstice, so midsummer gives exactly the
    // tabulated departure and the equinoxes give none.
    const seasonScale = Math.sin(decl * Math.PI / 180) / Math.sin(23.44 * Math.PI / 180);
    const seasonal = climateTableAt(EARTH_CLIMATE.julyAnomalyK, latDeg) * seasonScale;

    // Land warms and dries relative to the zonal mean at the same latitude,
    // and the difference is a warm-season one: a summer continent is several
    // kelvin above the ocean beside it, which is why continental convection is
    // so much deeper than marine convection. Without this the mid-latitude
    // continents in July read as cool ocean and never make a thunderstorm.
    const landWarming = opts.isLand ? 3.5 * seasonScale * Math.cos(latDeg * Math.PI / 180) : 0;

    // Diurnal: local solar time from longitude. The swing is a departure from
    // the daily mean, peaks mid-afternoon (15:00 local), and is large over land
    // -- which stores almost no heat -- and small over water.
    const lst = ((opts.longitudeDeg !== undefined ? opts.longitudeDeg : 0) / 15 + 12) % 24;
    const swing = opts.isLand ? 4.0 : 0.6;
    const diurnal = swing * Math.cos((lst - 15) / 24 * 2 * Math.PI);

    const surfaceT_C = surfaceT0 + seasonal + landWarming + diurnal;
    const landDrying = opts.isLand ? 0.9 : 1;
    const rhEff = Math.max(0.25, Math.min(1, rh * landDrying));

    const jet = (latDeg >= 0 ? EARTH_CLIMATE.jetMs.north : EARTH_CLIMATE.jetMs.south)
        * (1 + 0.25 * Math.sin(decl * Math.PI / 180) * Math.sign(latDeg || 1));

    // The environmental lapse rate is not 6.5 K/km everywhere: the tropical
    // troposphere is close to moist-adiabatic and stable (about 6 K/km), while
    // a summer continental mid-latitude column is steeper (7-8), which is what
    // makes its thunderstorms violent. A Gaussian bump centred at 45 degrees
    // carries that.
    const midlat = Math.exp(-Math.pow((Math.abs(latDeg) - 45) / 26, 2));
    const lapseEnvKPerKm = 6.15 + 1.25 * midlat;

    const freezingLevelKm = Math.max(0, Math.min(tropopauseKm, surfaceT_C / lapseEnvKPerKm));

    return {
        surfaceT_C, tropopauseKm, tropopauseC, rh: rhEff, windU, windV,
        lapseEnvKPerKm, jetMs: jet, freezingLevelKm,
        seaLevelPressureHpa: EARTH_CLIMATE.seaLevelPressureHpa,
        solarDeclinationDeg: decl,
        latitudeShiftDeg: beltShift
    };
}

globalThis.EARTH_CLIMATE = EARTH_CLIMATE;
globalThis.climateTableAt = climateTableAt;
globalThis.solarDeclinationDeg = solarDeclinationDeg;
globalThis.earthClimateAt = earthClimateAt;
