// Naked-eye star catalog.
//
// Directions are rejection-sampled from milkyWayDensityAlong(), the same disc and
// bulge the band shader integrates, so the stars and the band describe one
// Galaxy. Magnitudes follow the observed bright-star count law, N(<m) ~ 10^0.47m;
// colours come from a temperature-magnitude relation. Twenty-one real stars fix
// the bright end, which also gives the render checkpoints it can be measured
// against (Polaris must sit on the celestial pole, Sirius at RA 101.29).
//
// Everything here is deterministic: STAR_SEED is fixed, so the sky is identical
// on every load and no network request is involved.
import { galacticToEqUnit } from "../../src/sky/sky-frame.js";
import { milkyWayDensityAlong } from "../../src/sky/procedural-milkyway.js";

const STAR_SEED = 12648430;

const MAG_LIMIT = 6.5;

// log10 of the count per magnitude: 0.47 fits the Hipparcos bright-star counts.
const MAG_SLOPE = 0.47;

// The band's own density is far too peaked to sample directly: it would put every
// star within ten degrees of the plane. Naked-eye stars are a local sample, and
// the band they see is unresolved light, so the weighting is flattened toward
// isotropic with a floor and a fractional power. Measured result: 1.5x the
// isotropic share of stars in the plane, 1.7x toward the centre.
const SELECT_FLOOR = .02;

const SELECT_POWER = .4;

const TAU = Math.PI * 2;

const DEG = Math.PI / 180;

// name, RA, Dec, V magnitude, effective temperature in kelvin.
const ANCHORS = [
    [ "Sirius", 101.287, -16.716, -1.46, 9940 ],
    [ "Canopus", 95.988, -52.696, -0.74, 7400 ],
    [ "Arcturus", 213.915, 19.182, -0.05, 4290 ],
    [ "Vega", 279.234, 38.784, 0.03, 9600 ],
    [ "Capella", 79.172, 45.998, 0.08, 4970 ],
    [ "Rigel", 78.634, -8.202, 0.13, 12100 ],
    [ "Procyon", 114.825, 5.225, 0.34, 6530 ],
    [ "Achernar", 24.429, -57.237, 0.46, 15000 ],
    [ "Betelgeuse", 88.793, 7.407, 0.50, 3600 ],
    [ "Hadar", 210.956, -60.373, 0.61, 25000 ],
    [ "Acrux", 186.650, -63.099, 0.77, 28700 ],
    [ "Altair", 297.696, 8.868, 0.77, 7550 ],
    [ "Aldebaran", 68.980, 16.509, 0.85, 3910 ],
    [ "Spica", 201.298, -11.161, 0.97, 22400 ],
    [ "Antares", 247.352, -26.432, 1.06, 3400 ],
    [ "Pollux", 116.329, 28.026, 1.14, 4660 ],
    [ "Fomalhaut", 344.413, -29.622, 1.16, 8590 ],
    [ "Deneb", 310.358, 45.280, 1.25, 8525 ],
    [ "Mimosa", 191.930, -59.689, 1.25, 27000 ],
    [ "Regulus", 152.093, 11.967, 1.35, 12460 ],
    [ "Polaris", 37.954, 89.264, 1.98, 6015 ]
];

function mulberry32(a) {
    return function() {
        a |= 0;
        a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Brightest direction in the model: the line of sight through the bulge.
function peakDensity() {
    return Math.max(1e-6, milkyWayDensityAlong(1, 0, 0));
}

function build(count) {
    const rnd = mulberry32(STAR_SEED);
    const wMax = peakDensity();
    const ra = new Float32Array(count);
    const dec = new Float32Array(count);
    const mag = new Float32Array(count);
    const temp = new Float32Array(count);
    const names = new Map;
    const v = { set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
    let n = 0;

    // Anchors first: they keep their published position and brightness.
    for (const [ name, a, d, m, t ] of ANCHORS) {
        if (n >= count) break;
        ra[n] = a;
        dec[n] = d;
        mag[n] = m;
        temp[n] = t;
        names.set(n, name);
        n++;
    }

    // Then the field: isotropic directions thinned by the band's own density.
    while (n < count) {
        const u = rnd() * 2 - 1;
        const phi = rnd() * TAU;
        const s = Math.sqrt(Math.max(0, 1 - u * u));
        const gx = s * Math.cos(phi), gy = s * Math.sin(phi), gz = u;
        const p = Math.pow(SELECT_FLOOR + (1 - SELECT_FLOOR) * milkyWayDensityAlong(gx, gy, gz) / wMax, SELECT_POWER);
        if (rnd() > p) continue;
        // Through the shared basis, never a private copy of the matrices.
        galacticToEqUnit(Math.atan2(gy, gx) / DEG, Math.asin(gz) / DEG, v);
        const rank = (n + 1) / count;
        const m = MAG_LIMIT + Math.log10(rank) / MAG_SLOPE;
        // Most stars follow the temperature-magnitude trend; a minority are hot
        // outliers, which is why the sky is not monotone in colour.
        const hot = rnd() < .12;
        const h = Math.max(0, Math.min(1, (MAG_LIMIT - m) / 8.4));
        const t = hot
            ? 6000 + 9000 * rnd() * rnd()
            : 3000 + 10000 * Math.pow(h, 1.5) + (rnd() - .5) * 900;
        ra[n] = (Math.atan2(v.y, v.x) / DEG + 360) % 360;
        dec[n] = Math.asin(Math.max(-1, Math.min(1, v.z))) / DEG;
        mag[n] = m;
        temp[n] = t;
        n++;
    }
    return { count: count, ra: ra, dec: dec, mag: mag, temp: temp, names: names };
}

export const STAR_CATALOG = build(9000);

export const STAR_CATALOG_NOTE = "9000 stars to magnitude 6.5, seeded directions, 21 real anchors";

export function catalogStarName(index) {
    return STAR_CATALOG.names.get(index) || null;
}
