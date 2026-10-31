// What kind of cloud, and therefore what shape.
//
// Every cloud in this app used to be one shape: three slabs with a fixed
// thickness. Real skies are not like that. A trade-wind sky is fields of small
// cumulus with flat bases and domed tops; a subtropical sheet is a continuous
// stratocumulus with soft rolls; a front brings altostratus that thickens into
// nimbostratus; a jet stream lays cirrus out in filaments fifteen kilometres up.
// They differ in base height, in thickness, in how hard their edges are, and in
// the size of their internal structure -- and that difference is most of what
// makes a sky read as real.
//
// This file is the table of genera, taken from the WMO International Cloud
// Atlas, plus the rule that decides which genus a column gets from the physical
// state the weather model already computes.
//
// ---- the measurements --------------------------------------------------
//
// Etage boundaries, WMO International Cloud Atlas, "Definitions of clouds":
//
//   high      polar 3-8 km   temperate 5-13 km   tropical 6-18 km
//   middle    polar 2-4 km   temperate 2-7 km    tropical 2-8 km
//   low       surface to 2 km, everywhere
//
// Genus thicknesses from the Atlas's aircraft-observation sections:
//
//   stratocumulus   below 2 km, 500-1 000 m thick
//   stratus         surface-2 km, tens to several hundred metres thick
//   altocumulus     base 2-7 km, 300-2 000 m thick (mean ~1 960 m, mixed phase)
//   altostratus     2-7 km, often extends higher, 1-4 km thick
//
// and from the Atlas's cumulus section: humilis has a vertical extent of "some
// tens to hundreds of metres", mediocris "a few hundred metres to about 2 km",
// congestus "sometimes exceeds 5 km".
//
// The etages move with the tropopause, which is why the table above has three
// latitude columns. Rather than storing three tables, the etage boundaries are
// expressed as fractions of the local tropopause height, which climate.js
// already carries per latitude (16-17 km in the tropics, 8-10 at the poles).
// tools/typecheck.mjs checks that this reproduces the WMO's three columns.

const CLOUD_TYPES = {
    // How far above the base of the high etage a column's top may sit and still
    // count as the broken, shallow form (cirrocumulus) rather than cirrus.
    ciroCcBandKm: 1.5,
    // Fractions of the local tropopause height at which the etages begin and
    // end. Chosen to reproduce the WMO's polar / temperate / tropical columns;
    // typecheck.mjs asserts the residual.
    // The WMO's columns are ranges of *base height* for the genera of each
    // etage, not the extent of the etage itself: high cloud has its base at
    // 3-8 km in polar regions, 5-13 temperate, 6-18 tropical. What this model
    // has to reproduce is that the genera of an etage start within those
    // ranges. The low etage is surface to 2 km everywhere.
    etage: {
        // Middle genus bases are at or just above 2 km in every region, which
        // is what makes 2 km the floor.
        midBaseKm: 2.0,
        // The middle etage's top: altocumulus and altostratus layers thin out
        // below the jet, and altostratus at 8 km is unusual.
        midTopFraction: 0.45,
        midTopMaxKm: 8.5,
        // High genus bases: 0.45 of the tropopause reproduces 4.0 km polar,
        // 5.0 temperate (the WMO's "above about 5 000 m"), 7.6 tropical.
        highBaseFraction: 0.45,
        highBaseMinKm: 3.0,
        // And the tops: cirrus overshoots the mean tropopause in the tropics,
        // which is why the WMO's tropical column reaches 18 km.
        highTopFraction: 0.95,
        highTopMinKm: 6.0,
        // The low etage is surface to 2 km; below a shallow tropopause it is
        // thinner than that.
        lowTopKm: 2.0,
        lowTopFraction: 0.18
    },

    // The genera. `id` is the index written into the type map, so it must not
    // be reordered without rebuilding the map.
    //
    // Per genus:
    //   etage        which layer it belongs to
    //   baseFrac     base height as a fraction of its etage's thickness
    //   thicknessFrac thickness as a fraction of its etage's thickness
    //   ice          ice fraction of the condensate, 0-1
    //   extinction   peak extinction per metre at full density
    //   tileKm       base noise feature size: how big the lumps are
    //   detail       0-1, how much fine erosion the edges get
    //   profile      "dome" | "sheet" | "streak"
    //   coverageMin  the 2D coverage at which this genus starts to appear
    types: [
        // --- low etage ---------------------------------------------------
        { id: 0, name: "Stratus", short: "St", etage: "low",
          baseFrac: 0.0, thicknessFrac: 0.22, ice: 0, extinction: 0.020,
          tileKm: 12, detail: 0.2, profile: "sheet", coverageMin: 0.45 },
        { id: 1, name: "Stratocumulus", short: "Sc", etage: "low",
          baseFrac: 0.25, thicknessFrac: 0.45, ice: 0, extinction: 0.022,
          tileKm: 9, detail: 0.45, profile: "sheet", coverageMin: 0.30 },
        // The Atlas gives the cumulus species absolute depths -- "some tens to
        // hundreds of metres", "a few hundred metres to about 2 km", "sometimes
        // exceeds 5 km" -- so those three carry thicknessKm instead of a
        // fraction of a layer that is only 2 km deep.
        { id: 2, name: "Cumulus humilis", short: "Cu hum", etage: "low",
          baseFrac: 0.35, thicknessKm: 0.35, ice: 0, extinction: 0.035,
          tileKm: 3.5, detail: 0.8, profile: "dome", coverageMin: 0.10 },
        { id: 3, name: "Cumulus mediocris", short: "Cu med", etage: "low",
          baseFrac: 0.30, thicknessKm: 2.0, ice: 0, extinction: 0.045,
          tileKm: 3.5, detail: 0.8, profile: "dome", coverageMin: 0.14 },
        { id: 4, name: "Cumulus congestus", short: "Cu con", etage: "low",
          baseFrac: 0.30, thicknessKm: 5.0, ice: 0.15, extinction: 0.050,
          tileKm: 4.5, detail: 0.7, profile: "dome", coverageMin: 0.22 },
        // To the tropopause: the one genus whose depth is set by the atmosphere
        // rather than by the genus itself.
        { id: 5, name: "Cumulonimbus", short: "Cb", etage: "low",
          baseFrac: 0.30, thicknessToTropopause: true, ice: 0.55, extinction: 0.055,
          tileKm: 6, detail: 0.5, profile: "dome", coverageMin: 0.25 },

        // --- middle etage ------------------------------------------------
        { id: 6, name: "Altocumulus", short: "Ac", etage: "mid",
          baseFrac: 0.10, thicknessFrac: 0.30, ice: 0.2, extinction: 0.010,
          tileKm: 2.5, detail: 0.75, profile: "sheet", coverageMin: 0.12 },
        { id: 7, name: "Altostratus", short: "As", etage: "mid",
          baseFrac: 0.05, thicknessFrac: 0.65, ice: 0.35, extinction: 0.008,
          tileKm: 30, detail: 0.25, profile: "sheet", coverageMin: 0.35 },
        { id: 8, name: "Nimbostratus", short: "Ns", etage: "mid",
          baseFrac: 0.0, thicknessFrac: 1.0, ice: 0.3, extinction: 0.012,
          tileKm: 26, detail: 0.2, profile: "sheet", coverageMin: 0.55 },

        // --- high etage --------------------------------------------------
        { id: 9, name: "Cirrus", short: "Ci", etage: "high",
          baseFrac: 0.05, thicknessFrac: 0.30, ice: 1, extinction: 0.0009,
          tileKm: 7, detail: 1.0, profile: "streak", coverageMin: 0.0 },
        { id: 10, name: "Cirrostratus", short: "Cs", etage: "high",
          baseFrac: 0.0, thicknessFrac: 0.45, ice: 1, extinction: 0.0007,
          tileKm: 22, detail: 0.3, profile: "sheet", coverageMin: 0.25 },
        { id: 11, name: "Cirrocumulus", short: "Cc", etage: "high",
          baseFrac: 0.15, thicknessFrac: 0.25, ice: 1, extinction: 0.0012,
          tileKm: 3, detail: 0.9, profile: "sheet", coverageMin: 0.15 }
    ]
};

const CLOUD_TYPE_BY_ID = new Map(CLOUD_TYPES.types.map(t => [t.id, t]));



/**
 * The etage boundaries for a place, in km.
 *
 * @param {number} tropopauseKm  the local tropopause height (climate.js)
 */
function cloudEtagesAt(tropopauseKm) {
    const zt = Number.isFinite(tropopauseKm) && tropopauseKm > 4 ? tropopauseKm : 11;
    const E = CLOUD_TYPES.etage;
    return {
        low: { baseKm: 0, topKm: Math.min(E.lowTopKm, zt * E.lowTopFraction) },
        mid: { baseKm: E.midBaseKm, topKm: Math.min(E.midTopMaxKm, zt * E.midTopFraction) },
        high: { baseKm: Math.max(E.highBaseMinKm, zt * E.highBaseFraction),
                topKm: Math.max(E.highTopMinKm, zt * E.highTopFraction) }
    };
}

/**
 * Where a genus sits in the sky, in km, for a place with a given tropopause.
 * The fractions are of the genus's own etage, so a cumulus base is always a
 * third of the way up the low layer whether that layer is 2 km deep or 1.5.
 */
function cloudTypeVertical(type, tropopauseKm) {
    const etages = cloudEtagesAt(tropopauseKm);
    const e = etages[type.etage];
    const thickness = Math.max(0.02, e.topKm - e.baseKm);
    const baseKm = e.baseKm + thickness * type.baseFrac;
    // A convective genus is not confined to its etage. Cumulus congestus has a
    // vertical extent that "sometimes exceeds 5 km" and a cumulonimbus reaches
    // the tropopause, so those run to their own depth -- the Atlas's numbers for
    // the first, the tropopause for the second -- rather than to the top of the
    // 2 km low layer.
    let depth;
    if (type.thicknessToTropopause) depth = Math.max(0.5, (Number.isFinite(tropopauseKm) ? tropopauseKm : 11) - baseKm);
    else if (Number.isFinite(type.thicknessKm)) depth = type.thicknessKm;
    else depth = thickness * type.thicknessFrac;
    const cap = (type.thicknessKm || type.thicknessToTropopause) ? etages.high.topKm : e.topKm;
    const topKm = Math.min(cap, baseKm + depth);
    return { baseKm, topKm: Math.max(baseKm + 0.02, topKm), etageBaseKm: e.baseKm, etageTopKm: e.topKm };
}

/**
 * Which genus a column gets.
 *
 * The inputs are all things the weather model already computes: the local
 * climate (temperature, humidity, stability), the storm field, what the parcel
 * ascent found, and whether the surface is land. The rules are the textbook
 * ones, written as thresholds on those quantities:
 *
 *   low etage
 *     deep convection (CAPE high, storm present)  -> Cumulonimbus
 *     strong but capped convection                -> Cumulus congestus
 *     ordinary convection                         -> Cu mediocris / humilis
 *     stable, moist, cool (marine layer)          -> Stratus
 *     stable and moist (the common case)          -> Stratocumulus
 *   middle etage
 *     storm region                                -> Nimbostratus
 *     near the system                             -> Altostratus
 *     otherwise                                   -> Altocumulus
 *   high etage
 *     over the precipitating core                 -> Cirrus (the anvil)
 *     inside the surrounding veil                 -> Cirrostratus
 *     otherwise (the common case)                 -> Cirrus
 *     tops that only just reach the etage         -> Cirrocumulus
 *
 * What these rules do NOT decide is *presence*. That belongs to the coverage
 * maps: the deck paints one per etage and the volume masks each band with its
 * own, so a column with no cloud in an etage simply has none drawn there,
 * whatever genus was assigned to it. An earlier version had the classifier
 * return "no cloud in this etage" when the column's ascent fell short of it,
 * and that made the deck and the volume two different skies. Coverage says
 * whether, genus says what.
 *
 * @param {object} s  { surfaceT_C, rh, capeJkg, storm, ice, land, cloudTopKm,
 *                      tropopauseKm }
 * @returns {{low:number, mid:number, high:number}}
 */
function classifyCloudTypes(s) {
    const rh = clamp01(s.rh ?? 0.7);
    const cape = Math.max(0, s.capeJkg ?? 0);
    const storm = clamp01(s.storm ?? 0);
    const land = clamp01(s.land ?? 0);

    // How high this column's cloud reaches, and therefore which etages it
    // occupies. An absent or non-finite top (a caller that does not model
    // ascent) is treated as reaching everything, so the gate is opt-in rather
    // than silently clearing the sky.
    const topKm = Number.isFinite(s.cloudTopKm) ? s.cloudTopKm : Infinity;
    const etages = cloudEtagesAt(s.tropopauseKm);

    // Convective vigour: CAPE above about 800 J/kg supports deep convection;
    // a storm system supplies the trigger. Both are needed -- high CAPE under a
    // strong inversion stays a field of fair-weather cumulus.
    const conv = Math.min(1, cape / 2500) * (0.45 + 0.55 * storm);
    const deep = conv > 0.42 && storm > 0.35;

    let low;
    if (deep) low = 5;                                        // Cumulonimbus
    else if (conv > 0.28) low = 4;                            // Cu congestus
    else if (conv > 0.13) low = 3;                             // Cu mediocris
    else if (conv > 0.04) low = 2;                             // Cu humilis
    else if (rh > 0.86 && !land) low = 0;                      // marine stratus
    else low = 1;                                              // stratocumulus

    // The middle and high etages are not driven by the boundary layer. The
    // humidity this function is handed is the surface's, and using it five
    // kilometres up put altostratus over three quarters of the planet -- every
    // moist surface got a frontal sheet above it. What organises those etages
    // is the weather system: a front brings altostratus that thickens into
    // nimbostratus, and its warm conveyor throws cirrus ahead of it.
    const mid = storm > 0.55 ? 8 : (storm > 0.22 ? 7 : 6);

    // High cloud, in the order the sky makes it. Cirrostratus is the veil the
    // precipitation sheet of a system casts, so it comes with the storm and
    // not with latitude; cirrus is the detached fibre that is the commonest
    // high cloud there is, so it is what a column gets by default; and
    // cirrocumulus is the broken form of a layer whose tops have only just
    // climbed into the etage -- which is the one place the Atlas puts it.
    // The high etage is NOT gated on this column's ascent. Cirrus is detrained
    // from convection and then advected for hundreds of kilometres, so it hangs
    // over columns whose own parcel never leaves the boundary layer -- gating it
    // here deleted the global veil and left the high sky empty except over the
    // tropics. What is gated is the broken form, which only exists where the
    // tops have actually climbed into the etage and no further: that is what
    // keeps cirrocumulus off the polar cap, where the sky is one stratus sheet.
    // ...and within a system, by how deep the tower got. A tower that stops just
    // inside the etage spreads a broken, small-element layer (the mackerel sky
    // the Atlas calls cirrocumulus); one that carries on detrains a sheet.
    //
    // Note what this is NOT: a gate. An earlier version returned "no cloud in
    // this etage" whenever the column's ascent fell short of it, which is a
    // presence decision, and presence is not the type map's job. The deck paints
    // one coverage map per etage and the volume masks each band with it; if the
    // classifier also decided presence, the two would be two different skies --
    // the deck drawing a middle layer over 24 % of the planet while the volume
    // had none under it. Coverage says whether, genus says what.
    const shallowHigh = topKm >= etages.high.baseKm
        && topKm - etages.high.baseKm < CLOUD_TYPES.ciroCcBandKm;
    let high;
    if (storm > 0.22 && shallowHigh) high = 11;                           // Cc
    else if (storm > 0.55) high = 9;                                      // anvil
    else if (storm > 0.22) high = 10;                                     // veil
    else if (shallowHigh) high = 11;                                      // broken
    else high = 9;                                                        // Ci

    return { low, mid, high };
}

function clamp01(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

globalThis.CLOUD_TYPES = CLOUD_TYPES;
globalThis.CLOUD_TYPE_BY_ID = CLOUD_TYPE_BY_ID;
globalThis.cloudEtagesAt = cloudEtagesAt;
globalThis.cloudTypeVertical = cloudTypeVertical;
globalThis.classifyCloudTypes = classifyCloudTypes;
