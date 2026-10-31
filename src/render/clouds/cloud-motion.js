// How the cloud field moves.
//
// The weather is baked from climatology (temperature, humidity, the storm
// population) and that bake is a snapshot. What a snapshot lacks is *motion*,
// and motion is the part of the sky a person actually sees: clouds drift, and
// layers drift at different speeds and even in opposite directions, so cirrus
// races east over a stratus sheet sliding west beneath it.
//
// This file is the one place the wind lives. Everything that moves a cloud --
// the deck's texture offset, the volume's sample displacement, every probe --
// reads its numbers from here.
//
// ---- the wind ----------------------------------------------------------
//
// render/weather/climate.js already carries the measured zonal wind by
// latitude: trades -5 to -7 m/s between 10 and 25 degrees, westerlies +8 to +11
// between 45 and 55, and jet cores of 38 (north) and 48 (south) m/s near 40
// degrees at 11 km. cloudWindEast() turns those into a continuous profile with
// altitude:
//
//   * a boundary-layer shape that grows from the 10 m wind to 1.2x by 1.5 km;
//   * the subtropical jet, centred on 11 km, 38 m/s north and 48 m/s south;
//   * the tropical easterly jet, -22 m/s at 14.5 km within 18 degrees of the
//     equator;
//   * and the trade/westerly belts themselves.
//
// ---- how the displacement reaches the shader ---------------------------
//
// The shader evaluates the same profile from the same numbers and multiplies by
// one scalar: the cloud clock, in seconds. A displacement in turns is
// u * t / circumference, and that product is safe in float32 for as long as the
// clock is bounded. It is bounded: the bake is a snapshot, and a snapshot
// advected for a year is a different sky from the one that was baked, so the
// clock stops at maxAdvectedSeconds. At 50 m/s and 100 days the largest
// displacement is 4.3e8 m, where float32 still resolves 26 m -- finer than any
// cloud feature the march draws.
//
// The alternative -- accumulating displacement per texel and wrapping it --
// tears the field wherever neighbouring latitudes wrap differently, because a
// whole turn is the identity only when it is applied to the final coordinate.
// One clock, wrapped once, cannot tear.
//
// tools/windcheck.mjs checks the GLSL profile against cloudWindEast() over a
// grid, so the two cannot drift apart unnoticed.

const CLOUD_MOTION = {
    // The layer the flat deck stands for: the thickness-weighted centre of the
    // 0.4-3 km low cloud layer.
    deckAltitudeKm: 2.0,

    // The altitude each of the deck's three channels stands for, low/mid/high.
    // They are not decoration: the deck paints one coverage map per etage, and
    // each is drawn with the wind at *its own* altitude, so the cirrus races
    // east over a stratus sheet crawling west. The numbers are the middle of
    // each etage for a temperate tropopause, where most of the sky is.
    layerAltitudesKm: [2.0, 5.5, 10.0],

    // How long the snapshot may be advected before the clock holds. See the
    // note on float32 at the top of this file.
    maxAdvectedSeconds: 100 * 86400,

    // Cloud clock: simulation seconds, but never slower than this multiple of
    // real time, so the sky visibly moves at 1x. A presentation constant.
    minTimeFactor: 120,

    // Seasonal migration is NOT applied here. The bake already takes the day of
    // year and shifts the storm belts and the climate tables with it
    // (weather-field.js applies climate.js's declination), so applying it again
    // would be a double application and would move every cloud twice.
    beltMigrationOfDeclination: 0,

    // Convective diurnal cycle, read by the shader: deep convection over land
    // peaks between 14:00 and 17:00 local.
    diurnalPeakHour: 15.0,
    diurnalAmplitude: 0.22,

    // Earth's circumference at the equator, km.
    circumferenceKm: 40030,

    // Earth's radius, km, for the longitude-per-metre conversion.
    radiusKm: 6371
};

function cloudSmoothstep(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / Math.max(e1 - e0, 1e-9)));
    return t * t * (3 - 2 * t);
}

// Boundary-layer profile: 0.75 of the 10 m wind at the surface, 1.2 by 1.5 km,
// then handing over to the free atmosphere whose base wind is a little below
// the 10 m value.
function cloudBoundaryLayer(altKm) {
    return (0.75 + 0.45 * cloudSmoothstep(0, 1.5, altKm)) * (1 - 0.4 * cloudSmoothstep(2, 6, altKm));
}

// Jet vertical profile: centred on 11 km, absent below 5.
function cloudJetShape(altKm) {
    return Math.exp(-Math.pow((altKm - 11) / 3.4, 2)) * cloudSmoothstep(1, 5, altKm);
}

// Tropical easterly jet profile: centred on 14.5 km.
function cloudTropicalShape(altKm) {
    return Math.exp(-Math.pow((altKm - 14.5) / 3.0, 2));
}

// The wind itself, m/s, positive eastward. Single source of truth.
function cloudWindEast(latDeg, altKm) {
    const alat = Math.abs(latDeg);
    const trade = 1 - cloudSmoothstep(24, 34, alat);
    const west = cloudSmoothstep(30, 42, alat) * (1 - cloudSmoothstep(66, 80, alat));
    const bl = cloudBoundaryLayer(altKm);
    const jetLat = Math.exp(-Math.pow((alat - 40) / 14, 2));
    const jetSpeed = latDeg >= 0 ? 38 : 48;
    const tropLat = Math.exp(-Math.pow(latDeg / 18, 2));
    return -6.5 * trade * bl
        + 9.5 * west * bl
        + jetSpeed * jetLat * cloudJetShape(altKm)
        - 22 * tropLat * cloudTropicalShape(altKm);
}

/**
 * The moving field.
 *
 * @param {THREE} THREE
 * @param {object} opts
 *   deckMesh   the flat deck, whose texture offset is driven here
 *   weightOf   optional (latDeg) => coverage, the weight used to average the
 *              deck's single wind over the places that carry cloud
 */
function createCloudMotion(THREE, opts = {}) {
    const P = { ...CLOUD_MOTION, ...opts };

    // The deck's velocity.
    //
    // A texture offset is one number, so the flat deck can only move with one
    // wind -- and a global average of this wind is close to zero, because the
    // trades pull west and the westerlies pull east with comparable weight. A
    // deck that stands still while the volume beside it drifts would be a lie.
    //
    // The deck is visible only from 6000 km up, and from there the visible disc
    // spans a limited range of latitude. So it moves with the wind at the
    // latitude being looked at. Within the disc the error is the latitude
    // gradient of the wind over a few degrees; across the level-of-detail
    // switch the two representations then agree to the sub-pixel.
    let viewLatitudeDeg = 0;
    let viewLatitudeTarget = 0;
    let deckWindMs = cloudWindEast(0, P.deckAltitudeKm);

    // The deck was built with a quarter-turn offset that aligns its canvas with
    // the volume's longitude. Advection is added to that, never instead of it.
    const deckBase = {
        x: opts.deckMesh?.material?.map?.offset?.x ?? 0,
        y: opts.deckMesh?.material?.map?.offset?.y ?? 0
    };

    let clockSeconds = 0;
    let beltShiftDeg = 0;

    const uniforms = {
        uCloudTime: { value: 0 },
        uBeltShiftDeg: { value: 0 },
        uDeckAltitudeKm: { value: P.deckAltitudeKm },
        // Where the middle and high coverage maps are read from. The march
        // samples each layer's map at its own altitude and so at its own wind.
        uMidAltitudeKm: { value: P.layerAltitudesKm[1] },
        uHighAltitudeKm: { value: P.layerAltitudesKm[2] },
        uDiurnalAmp: { value: P.diurnalAmplitude },
        uDiurnalPeakHour: { value: P.diurnalPeakHour }
    };

    const wrap = v => v - Math.floor(v);

    // Displacement in turns of longitude, per layer, at the latitude being
    // looked at.
    //
    // Metres to turns of longitude at this latitude: a wind of 11 m/s at 50 N
    // crosses a parallel whose circumference is 40 030 cos(50) km, so it covers
    // a larger fraction of a turn than the same wind at the equator. Dropping
    // this factor made the deck crawl at 0.64x speed.
    function layerTurns() {
        const cosLat = Math.max(Math.cos(viewLatitudeDeg * Math.PI / 180), 0.15);
        return P.layerAltitudesKm.map(alt =>
            cloudWindEast(viewLatitudeDeg, alt) * clockSeconds / (P.circumferenceKm * 1000) / cosLat);
    }

    // The low layer's displacement. The texture offset, the probe and the
    // report all read this one, because the deck's map is the low layer.
    function deckTurns() {
        return layerTurns()[0];
    }

    function applyDeckOffset() {
        const map = opts.deckMesh?.material?.map;
        if (!map) return;
        // The *unwrapped* displacement. The deck's texture repeats in longitude,
        // so a whole turn is the same field -- but wrapping the offset here made
        // it jump by a turn whenever the drift crossed zero, and the value is a
        // double that three keeps in its matrix, so there is nothing to gain.
        const turns = deckTurns();
        // three samples at uv * repeat + offset, so a *negative* offset moves
        // the field in the positive direction. Longitude is periodic, so the
        // wrap is exact. Latitude is not: the deck's uv.v runs 0 at the south
        // pole to 1 at the north, so a belt shift north by d degrees samples
        // d/180 lower.
        map.offset.x = deckBase.x - turns;
        map.offset.y = deckBase.y - beltShiftDeg / 180;
    }

    /**
     * Advance the field by a slice of simulation time.
     * @param {number} seconds          simulated seconds elapsed
     * @param {number} declinationDeg   solar declination now
     */
    // The target latitude, smoothed in advance(): a camera crossing latitudes
    // must not snap the deck to a new phase in one frame. The offset is computed
    // from the wind times the clock rather than accumulated, so it always agrees
    // with the per-latitude displacement the volume uses.
    function setViewLatitude(latDeg) {
        if (!Number.isFinite(latDeg)) return;
        viewLatitudeTarget = Math.max(-89, Math.min(89, latDeg));
    }

    function advance(seconds, declinationDeg, realSeconds) {
        if (Number.isFinite(seconds) && seconds > 0) {
            // A clock jump (the user picked a new date) must not fling the sky.
            clockSeconds = Math.min(clockSeconds + Math.min(seconds, 86400 * 3), P.maxAdvectedSeconds);
        }
        // Two-second real-time constant: the deck slides to its new phase
        // instead of jumping when the camera changes hemisphere. The smoothing
        // runs on real seconds, because cloud time is 120x faster at its floor.
        const follow = 1 - Math.exp(-Math.max(Number.isFinite(realSeconds) ? realSeconds : 1, 0) / 2);
        viewLatitudeDeg += (viewLatitudeTarget - viewLatitudeDeg) * follow;
        deckWindMs = cloudWindEast(viewLatitudeDeg, P.deckAltitudeKm);
        beltShiftDeg = (Number.isFinite(declinationDeg) ? declinationDeg : 0) * P.beltMigrationOfDeclination;
        uniforms.uCloudTime.value = clockSeconds;
        uniforms.uBeltShiftDeg.value = beltShiftDeg;
        applyDeckOffset();

        // The upper two layers' displacement *relative to the low one*, which
        // is the frame the deck material samples in: its map offset already
        // carries the low layer. One number each, in turns of longitude --
        // latitude drift is zero, because the seasonal migration is already in
        // the bake and applying it again would move every cloud twice.
        const turns = layerTurns();
        const deck = P.deckUniforms;
        if (deck) {
            if (deck.uDeckShiftMid) deck.uDeckShiftMid.value.set(turns[1] - turns[0], 0);
            if (deck.uDeckShiftHigh) deck.uDeckShiftHigh.value.set(turns[2] - turns[0], 0);
        }
    }

    // The same expression the shader evaluates, for probes and for the deck.
    function offsetAt(latDegIn, altKm) {
        const metres = cloudWindEast(latDegIn, altKm) * clockSeconds;
        const turns = metres / (P.circumferenceKm * 1000) / Math.max(Math.cos(latDegIn * Math.PI / 180), 0.15);
        return { lonTurns: wrap(turns), latDeg: beltShiftDeg };
    }

    advance(0, 0);

    return {
        uniforms,
        advance,
        offsetAt,
        layerTurns,
        layerAltitudesKm: P.layerAltitudesKm,
        deckOffset: () => ({ lonTurns: wrap(deckTurns()), latDeg: beltShiftDeg }),
        setViewLatitude,
        get deckWindMs() { return deckWindMs; },
        state: () => ({ clockSeconds, beltShiftDeg, deckWindMs, viewLatitudeDeg })
    };
}

// The GLSL both cloud shaders share: the wind profile, the field displacement
// and the diurnal convective factor. It is the same model as cloudWindEast()
// above; tools/windcheck.mjs checks the two against each other.
const CLOUD_WIND_GLSL = `
uniform float uCloudTime;         // seconds of cloud clock, bounded
uniform float uBeltShiftDeg;      // seasonal migration of the belts
uniform float uDeckAltitudeKm;    // what the flat deck stands for
uniform float uMidAltitudeKm;     // where the middle layer's map is read
uniform float uHighAltitudeKm;    // and the high layer's
uniform float uDiurnalAmp;
uniform float uDiurnalPeakHour;

#define CLOUD_CIRCUMFERENCE_M 40030000.0

float cloudBoundaryLayer(float altKm) {
    return (0.75 + 0.45 * smoothstep(0.0, 1.5, altKm)) * (1.0 - 0.4 * smoothstep(2.0, 6.0, altKm));
}

float cloudEastWind(float latDeg, float altKm) {
    float alat = abs(latDeg);
    float trade = 1.0 - smoothstep(24.0, 34.0, alat);
    float west = smoothstep(30.0, 42.0, alat) * (1.0 - smoothstep(66.0, 80.0, alat));
    float bl = cloudBoundaryLayer(altKm);
    float jetLat = exp(-pow((alat - 40.0) / 14.0, 2.0));
    float jetSpeed = latDeg >= 0.0 ? 38.0 : 48.0;
    float jetShape = exp(-pow((altKm - 11.0) / 3.4, 2.0)) * smoothstep(1.0, 5.0, altKm);
    float tropLat = exp(-pow(latDeg / 18.0, 2.0));
    float tropShape = exp(-pow((altKm - 14.5) / 3.0, 2.0));
    return -6.5 * trade * bl
         + 9.5 * west * bl
         + jetSpeed * jetLat * jetShape
         - 22.0 * tropLat * tropShape;
}

// Displacement of the field where the air came from: (turns of longitude,
// degrees of latitude). Applied by subtracting it from the sample coordinate.
vec2 cloudFieldOffset(float latDeg, float altKm) {
    float metres = cloudEastWind(latDeg, altKm) * uCloudTime;
    float cosLat = max(cos(radians(latDeg)), 0.15);
    float turns = metres / CLOUD_CIRCUMFERENCE_M / cosLat;
    return vec2(turns - floor(turns), uBeltShiftDeg);
}

// Convective vigour at a longitude, as a function of local solar time. One is
// the annual mean; the factor swings by uDiurnalAmp about it.
float cloudConvectiveDiurnal(float lonTurns, float sunLonTurns) {
    float hour = fract(lonTurns - sunLonTurns + 1.0) * 24.0;
    return 1.0 + uDiurnalAmp * cos((hour - uDiurnalPeakHour) * 0.26179939);
}
`;

globalThis.CLOUD_MOTION = CLOUD_MOTION;
globalThis.CLOUD_WIND_GLSL = CLOUD_WIND_GLSL;
globalThis.cloudWindEast = cloudWindEast;
globalThis.createCloudMotion = createCloudMotion;
