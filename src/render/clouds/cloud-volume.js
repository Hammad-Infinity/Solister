// The cloud volume: the three cloud layers of the real atmosphere, as a 3D field.
//
// A deck is one sheet of paint. The atmosphere has layers, and they are not
// decoration -- each is a different cloud genus with its own altitude, its own
// optical depth and its own reason to exist:
//
//   low    0.5-3 km    stratocumulus and cumulus. Dense (tau 5-50), flat-based,
//                      the layer you fly through. Forms where the boundary
//                      layer is moist and capped.
//   mid    3-6.5 km    altocumulus and altostratus. Thin, patchy, made of
//                      supercooled water (tau 3-15).
//   high   7.5-12 km   cirrus. Ice, made of crystals 30-100 microns across, so
//                      it is optically thin (tau 0.1-3) and you can see the sun
//                      and stars through it.
//
// The whole thing is baked once into a 3D texture of *optical extinction*, the
// quantity that actually attenuates light: the shader integrates it along the
// view ray and gets optical depth in SI units. Resolution is macro -- about 27
// km horizontally and 175 m vertically -- because that is all a 1 MB volume
// can hold, and because the detail that makes a cloud look like a cloud is
// added at march time from a small tiling noise, which is the standard split
// (a weather field for shape, a detail field for texture).
//
// Two physics notes that the numbers below rest on:
//
//   * Extinction follows from liquid water content and droplet size:
//     sigma = 3 w / (2 rho_w r_e). For stratocumulus, w = 0.45 g/m^3 and
//     r_e = 10 um give 67 per km; an entraining cloud holds a third of the
//     adiabatic value, so about 40 per km, and a 700 m thick sheet comes out at
//     tau = 28 -- squarely inside the measured 5-50.
//   * Convection sets the low layer's top per column: where there is a storm
//     the deck grows into a 10-12 km column with an ice anvil, and where there
//     is none it stays a thin sheet. That is why a cumulonimbus and a fair
//     weather cumulus can exist in the same sky.

const CLOUD_VOLUME = {
    // 160 x 80 x 80 voxels over 360 x 180 degrees and 0-14 km.
    width: 160,
    height: 80,
    depth: 80,
    topKm: 14,

    // The extinction a voxel of 255 in the water channel means, per metre.
    // 0.07 = 70 per km, which is a dense cumulus core; everything else is a
    // fraction of it.
    maxExtinctionPerM: 0.07,
    // The same for the ice channel. Cirrus and anvils are one to two orders of
    // magnitude thinner than water cloud, so they get their own scale: a shared
    // one would spend 8-bit precision on values that never occur.
    iceExtinctionPerM: 0.0175,

    layers: [
        {
            name: "low",
            baseKm: 0.4,
            topKm: 3.0,
            // Peak extinction of the layer, per metre, at full density.
            // Peak extinction at full density, per metre. Checked against the
            // measurement rather than chosen: a full stratocumulus column
            // integrates to tau = 22 here, and the measured range is 5-50 with
            // 15-30 implied by a liquid water path of 100-150 g/m2 at a 10 um
            // effective radius. At 0.055 the same column came out at tau = 70 --
            // between two and four times too opaque, which is why the deck
            // internal lighting read as navy rather than as the inside of a
            // cloud. tools/bakecheck.mjs prints the integral.
            extinctionPerM: 0.022,
            // How much of the total cloud amount this layer carries.
            share: 0.62,
            // Vertical profile: flat base, rounded top.
            shape: "flatBase"
        },
        {
            name: "mid",
            baseKm: 3.0,
            topKm: 6.5,
            extinctionPerM: 0.010,
            share: 0.28,
            shape: "gaussian"
        },
        {
            name: "high",
            baseKm: 7.5,
            topKm: 12.0,
            // Cirrus: measured optical depth is 0.1-3 across a 2-4 km sheet, so
            // the extinction is 0.0001-0.0015 per metre. 0.0035 was three times
            // the top of that range and, with the carving below, gave a veil
            // that covered the whole sky at half opacity -- a fog, not cirrus.
            extinctionPerM: 0.0009,
            share: 0.24,
            shape: "streak"
        }
    ],

    // Convective column: where a storm stands, the low layer does not stop at
    // 3 km. It rises to the storm's cloud top (from the weather field), and the
    // top two kilometres become the anvil, which is ice and therefore thin.
    convectiveTopFraction: 0.82,
    // The incus: the fraction of a convective column's own extinction that the
    // ice anvil above 0.42 of the tropopause keeps. Measured anvil optical depth
    // is 5-20, against 30-100 for the water column beneath it.
    anvilFraction: 0.12,

    // Detail noise that the shader multiplies into the macro density. Tiled, so
    // it can be repeated at any scale without a seam.
    detailSize: 64,
    detailOctaves: 4,
    seed: 4711
};

// A tiling 3D value noise, built once. White noise would look like static; a
// few octaves of interpolated random values looks like the billows and wisps a
// cloud is made of, provided the highest octave is not so fine that it aliases.
function createDetailNoise(size, octaves, seedInit) {
    let seed = seedInit >>> 0;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const out = new Float32Array(size * size * size);
    for (let o = 0; o < octaves; o++) {
        const cells = 4 << o;                       // 4, 8, 16, 32
        const lattice = new Float32Array(cells * cells * cells);
        for (let i = 0; i < lattice.length; i++) lattice[i] = random();
        const amp = Math.pow(0.55, o);
        const at = (x, y, z) => {
            const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
            const fx = x - xi, fy = y - yi, fz = z - zi;
            const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
            const x0 = ((xi % cells) + cells) % cells, x1 = (x0 + 1) % cells;
            const y0 = ((yi % cells) + cells) % cells, y1 = (y0 + 1) % cells;
            const z0 = ((zi % cells) + cells) % cells, z1 = (z0 + 1) % cells;
            const I = (a, b, c) => lattice[(c * cells + b) * cells + a];
            const l00 = I(x0, y0, z0) + (I(x1, y0, z0) - I(x0, y0, z0)) * sx;
            const l10 = I(x0, y1, z0) + (I(x1, y1, z0) - I(x0, y1, z0)) * sx;
            const l01 = I(x0, y0, z1) + (I(x1, y0, z1) - I(x0, y0, z1)) * sx;
            const l11 = I(x0, y1, z1) + (I(x1, y1, z1) - I(x0, y1, z1)) * sx;
            const m0 = l00 + (l10 - l00) * sy;
            const m1 = l01 + (l11 - l01) * sy;
            return m0 + (m1 - m0) * sz;
        };
        const s = size / cells;
        for (let z = 0; z < size; z++) {
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    out[(z * size + y) * size + x] += amp * at(x / s, y / s, z / s);
                }
            }
        }
    }
    // Normalise to 0..1.
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < out.length; i++) { if (out[i] < lo) lo = out[i]; if (out[i] > hi) hi = out[i]; }
    const span = Math.max(1e-6, hi - lo);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / span;
    return out;
}

// The same 3t^2-2t^3 ramp the shaders use, clamped to [0,1].
function smoothstep01(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
}

/**
 * Bake the volume texture.
 *
 * @param {THREE} THREE
 * @param {object} opts
 *   coverage2D   Uint8Array of the deck's density, 2048 x 1024, RGBA
 *   coverageW/H  its dimensions
 *   topKm2D      Uint8Array, cloud top in km/20 per texel (weather field channel R)
 *   topW/topH    its dimensions
 * @returns {{texture, extinctionMaxPerM, layerProfiles, stats}}
 */
function createCloudVolume(THREE, opts = {}) {
    const P = { ...CLOUD_VOLUME, ...opts };
    const W = P.width, H = P.height, D = P.depth;
    const detail = createDetailNoise(P.detailSize, P.detailOctaves, P.seed);

    const coverage2D = opts.coverage2D;
    const cw = opts.coverageW || 2048, ch = opts.coverageH || 1024;
    const top2D = opts.topKm2D;
    const tw = opts.topW || cw, th = opts.topH || ch;
    // The type map: which genus each etage carries, and the local tropopause.
    // Without it every column gets the default genus of its etage, which is the
    // old behaviour and is what the headless bake checks use.
    const typeMap = opts.typeMap2D || null;
    const tyW = opts.typeW || cw, tyH = opts.typeH || ch;
    const types = opts.typeTable || globalThis.CLOUD_TYPE_BY_ID || null;
    const vertical = opts.typeVertical || globalThis.cloudTypeVertical || null;
    if (!types || !vertical) {
        // A bake that quietly produced zeros because its type table was missing
        // took an hour to find once. Say so, loudly, and refuse.
        throw new Error("createCloudVolume needs the cloud type table: load src/render/clouds/cloud-types.js first");
    }
    const DEFAULT_IDS = { low: 1, mid: 6, high: 9 };

    // Sample the 2D fields at a normalised (u, v). Bilinear, wrapping in u.
    const sample2D = (data, w, h, u, v, channel) => {
        const x = u * w - 0.5, y = Math.max(0, Math.min(h - 1.001, v * h - 0.5));
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const fx = x - x0, fy = y - y0;
        const xa = ((x0 % w) + w) % w, xb = (xa + 1) % w;
        const ya = Math.max(0, Math.min(h - 1, y0)), yb = Math.max(0, Math.min(h - 1, y0 + 1));
        const at = (xx, yy) => data[(yy * w + xx) * 4 + channel];
        const top = at(xa, ya) * (1 - fx) + at(xb, ya) * fx;
        const bot = at(xa, yb) * (1 - fx) + at(xb, yb) * fx;
        return (top * (1 - fy) + bot * fy) / 255;
    };

    const VOX = W * H * D;
    const data = new Uint8Array(VOX * 4);
    const layerProfiles = P.layers.map(l => ({ ...l }));

    // Per-column precomputation: the storm's cloud top decides how far the low
    // layer grows. Above the top there is only the anvil and the cirrus.
    // Counted once per column, not once per voxel: the stat is "how many
    // columns carry convection", and a voxel count says nothing about that.
    const stormTop = new Float32Array(W * H);
    // Per column: the three genus ids and the tropopause the etages are scaled
    // by. Computed once, not per voxel.
    const columnTypes = new Uint8Array(W * H * 3);
    const columnTropopause = new Float32Array(W * H);
    let convectiveColumns = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const top = top2D ? sample2D(top2D, tw, th, u, v, 0) * 20 : 0;
            stormTop[y * W + x] = top;
            const k = y * W + x;
            if (typeMap) {
                const tx = Math.min(tyW - 1, Math.floor(u * tyW));
                const tyy = Math.min(tyH - 1, Math.floor(v * tyH));
                const i = (tyy * tyW + tx) * 4;
                columnTypes[k * 3] = typeMap[i];
                columnTypes[k * 3 + 1] = typeMap[i + 1];
                columnTypes[k * 3 + 2] = typeMap[i + 2];
                columnTropopause[k] = typeMap[i + 3] / 255 * 20;
            } else {
                columnTypes[k * 3] = DEFAULT_IDS.low;
                columnTypes[k * 3 + 1] = DEFAULT_IDS.mid;
                columnTypes[k * 3 + 2] = DEFAULT_IDS.high;
                columnTropopause[k] = 11;
            }
            // One count per column. This was inside the voxel loop once and
            // reported every column eighty times over, because the statistic is
            // "how many columns carry convection" and a voxel is not a column.
            if (top > P.layers[0].topKm) convectiveColumns++;
        }
    }

    // ---- the voxels --------------------------------------------------------
    //
    // Each column is built from its three genera rather than from three fixed
    // slabs. The genus sets the base, the top and the peak extinction, so a
    // column of fair-weather cumulus is 350 m of small puffs and the column
    // beside it, inside a storm, is a nine-kilometre tower -- which is what the
    // real atmosphere does at the edge of a system.
    //
    // The detail tile is written into the unused blue channel: it is the size
    // of this cloud's internal structure, 64 km full scale, and the march uses
    // it to put cirrus filaments and cumulus lumps at their own scales instead
    // of one scale for the whole planet.
    const TILE_SCALE_KM = 64;
    const extinctScale = 0.07;   // what the water channel's 255 means, per metre

    for (let z = 0; z < D; z++) {
        const altKm = (z + 0.5) / D * P.topKm;
        for (let y = 0; y < H; y++) {
            const v = (y + 0.5) / H;
            for (let x = 0; x < W; x++) {
                const u = (x + 0.5) / W;
                const k = y * W + x;
                // One coverage value per etage: R low, G middle, B high. The
                // deck paints the same three maps into the same three channels,
                // so a layer's footprint in the volume is the footprint the
                // deck draws for it.
                const layerCoverage = coverage2D
                    ? [sample2D(coverage2D, cw, ch, u, v, 0),
                       sample2D(coverage2D, cw, ch, u, v, 1),
                       sample2D(coverage2D, cw, ch, u, v, 2)]
                    : [0.3, 0.3, 0.3];
                const coverage = layerCoverage[0];
                const stormTopKm = stormTop[k];
                const tropopauseKm = columnTropopause[k];

                // One coherent noise field for the whole column, so the layers
                // share it and the carving does not look like three sheets.
                const billow = detail[((z % P.detailSize) * P.detailSize + (y % P.detailSize)) * P.detailSize + (x % P.detailSize)];
                const n = Math.max(0, billow * 1.35 - 0.35);

                let water = 0;
                let ice = 0;
                let bestTileKm = 9;
                let bestExtinction = 0;

                for (let etage = 0; etage < 3; etage++) {
                    const id = columnTypes[k * 3 + etage];
                    const type = types.get(id);
                    if (!type) continue;
                    const ext = vertical(type, tropopauseKm);
                    // A storm's column overrides the genus's own top: the
                    // weather field knows how deep this convection went. That
                    // is a statement about *convection* -- the top field is the
                    // parcel's, and a parcel does not lift a stratus sheet. Only
                    // a dome-shaped genus (cumulus, congestus, cumulonimbus) may
                    // be stretched; applying it to every column turned a 340 m
                    // polar stratus into a 2.5 km slab.
                    let topKm = ext.topKm;
                    if (etage === 0 && type.profile === "dome" && stormTopKm > topKm) {
                        topKm = Math.min(P.topKm - 0.5, stormTopKm);
                    }
                    if (altKm < ext.baseKm || altKm > topKm) continue;

                    const t = (altKm - ext.baseKm) / Math.max(1e-3, topKm - ext.baseKm);

                    // No horizontal amount here. The volume bakes geometry --
                    // where in a *column* the cloud sits and what shape it is --
                    // and the march decides where columns have cloud, because
                    // only the march knows the layer's own wind and can sample
                    // the full-resolution map per layer. Doing it in both places
                    // squares the coverage: a column at 0.5 ends up at 0.25, and
                    // the two representations stop agreeing.
                    const amount = 1;

                    // Vertical profile, by genus shape.
                    let shape;
                    if (type.profile === "dome") shape = Math.min(1, t / 0.10) * (1 - Math.pow(t, 2.4));
                    else if (type.profile === "streak") shape = Math.min(1, t / 0.30) * (1 - Math.pow(t, 1.6));
                    else shape = Math.min(1, t / 0.16) * (1 - Math.pow(t, 3.0));

                    // Carve: a cloud is not a slab with a smooth edge. The carve
                    // acts on the shape, which is 0..1 by construction, and the
                    // amount then scales the result. Scaling first and carving
                    // after meant a thin layer -- whose amount is small -- fell
                    // entirely below the carve floor and vanished from the
                    // volume while the deck still drew it.
                    const carved = Math.max(0, shape - (1 - n) * 0.55) * amount;
                    if (carved <= 0) continue;

                    // Ice: the genus says how much of its condensate is frozen,
                    // and everything above the freezing level is, whatever the
                    // genus. That is why a cumulonimbus has an ice anvil and a
                    // winter stratus does not.
                    const aboveFreezing = altKm > 4.5 ? Math.min(1, (altKm - 4.5) / 3) : 0;
                    const iceFrac = Math.min(1, Math.max(type.ice, aboveFreezing));

                    // Anvil: the part of a convective column above its own low
                    // layer is ice and thinner, which is what the Atlas calls
                    // the incus.
                    let e = carved * type.extinction;
                    const anvil = etage === 0 && altKm > Math.max(3.0, tropopauseKm * 0.42);
                    if (anvil) e *= P.anvilFraction;
                    water += e * (1 - iceFrac);
                    ice += e * iceFrac;

                    if (e > bestExtinction) { bestExtinction = e; bestTileKm = type.tileKm; }
                }

                const o = ((z * H + y) * W + x) * 4;
                data[o] = Math.round(Math.max(0, Math.min(1, water / P.maxExtinctionPerM)) * 255);
                // The ice channel has its own, finer scale: cirrus is a hundred
                // times thinner than cumulus and would lose all its precision
                // sharing the water channel's 8 bits.
                data[o + 1] = Math.round(Math.max(0, Math.min(1, ice / P.iceExtinctionPerM)) * 255);
                data[o + 2] = Math.round(Math.max(0, Math.min(1, bestTileKm / TILE_SCALE_KM)) * 255);
                data[o + 3] = 255;
            }
        }
    }

    const texture = new THREE.Data3DTexture(data, W, H, D);
    texture.format = THREE.RGBAFormat;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;      // longitude wraps
    texture.wrapT = THREE.ClampToEdgeWrapping; // latitude does not
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;

    const detailTexture = new THREE.Data3DTexture(
        Uint8Array.from(detail, v => Math.round(v * 255)), P.detailSize, P.detailSize, P.detailSize);
    detailTexture.format = THREE.RedFormat;
    detailTexture.minFilter = THREE.LinearMipmapLinearFilter;
    detailTexture.magFilter = THREE.LinearFilter;
    detailTexture.generateMipmaps = true;
    detailTexture.wrapS = detailTexture.wrapT = detailTexture.wrapR = THREE.RepeatWrapping;
    detailTexture.needsUpdate = true;

    return {
        texture,
        detailTexture,
        // The raw voxels, for probes: a photograph cannot say whether the field
        // is empty or the shader is sampling the wrong place.
        data,
        extinctionMaxPerM: P.maxExtinctionPerM,
        iceExtinctionPerM: P.iceExtinctionPerM,
        topKm: P.topKm,
        layers: layerProfiles,
        stats: { convectiveColumns, voxels: VOX }
    };
}

globalThis.CLOUD_VOLUME = CLOUD_VOLUME;
globalThis.createCloudVolume = createCloudVolume;
