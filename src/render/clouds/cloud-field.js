// The Earth cloud coverage field: the pattern the deck is made of.
//
// This file owns exactly one thing -- where clouds are, and how dense. It knows
// nothing about the shell, the medium, the lighting or the screen; it returns a
// texture whose RGB is cloud density (0 = clear sky, 1 = overcast) on an
// equirectangular map, which the deck's material and the shadow path both read.
//
// Every number below was measured from an authentic composite rather than
// chosen: NASA's Blue Marble 2002 "land, ocean, ice and clouds" (2048x1024,
// equirectangular -- the same projection this map uses). The measurements live
// in tools/cloud-reference.json and tools/cloudprobe.mjs re-measures them
// against whatever this file produces.
//
// The pattern has five parts, in the order they are applied:
//
//   1. Turbulence -- gradient noise summed over octaves and displaced by a wind
//      field of its own. The displacement is what turns isotropic blobs into
//      the stretched filaments and swirls the composite is made of; without it
//      the field reads as static, with it as weather.
//   2. Two bands -- the coarse octaves, which gather into sheets where air
//      rises, and the fine octaves, which break into cells where air sinks.
//      The composite is both at once (63 % of its cloud area in twenty great
//      systems, 9 % in eight thousand cells under 10 000 km^2), so the mix is
//      set by the local climatological coverage: dry -> cells, wet -> sheets.
//   3. Climatology -- coverage against latitude, from the composite's own
//      10-degree bands, kept per hemisphere because the ITCZ sits north and the
//      southern storm track is the cloudier one.
//   4. Rank transform -- each latitude row is mapped onto a uniform
//      distribution through its own histogram, so "coverage c" is exactly the
//      threshold 1 - c at every latitude and the curve lands to the digit.
//   5. Density -- a sharp ramp at the threshold (the cloud edge), relief inside
//      it (dense cores, thin skirts), and a faint high veil of cirrus over the
//      clear sky, which is what stops the map reading as stencilled paper.

const CLOUD_FIELD = {
    // 2048 x 1024 is the resolution of the composite the numbers came from:
    // 0.176 degrees per texel, about 20 km at the equator. At 512 the deck was
    // 78 km per texel and could not represent the finer half of the spectrum.
    width: 2048,
    height: 1024,

    // Turbulence. The coarse band is 4 to 64 cycles across the map (the systems),
    // the fine band 128 to 256 (the cells). Nothing finer: 512 cycles is a
    // four-texel cell that thresholds into single-texel flecks, and the map then
    // reads as salt and pepper rather than as cloud.
    coarseOctaves: [4, 8, 16, 32, 64],
    fineOctaves: [64, 128, 256],
    // Amplitude ratio per octave, and it differs by band on purpose. The
    // composite is bimodal -- 63 % of its cloud area in twenty great systems
    // and 9 % in eight thousand cells under 10 000 km^2, with comparatively
    // little in between. A single ratio cannot be that: the coarse band has to
    // fall away steeply so the sheets stay large and connected, and the fine
    // band has to stay close to white so the cells stay small and discrete.
    persistence: 0.78,
    finePersistence: 0.90,
    // Where the two bands meet: at or above this coverage the sky is sheets,
    // below it the mix turns to cells, reaching pure cells at zero.
    cellRegimeCoverage: 0.40,

    // Wind. `swirl` composes the displacement through a second turbulence field
    // (one field bends, two curl). `selfWarp` is how far each octave is pushed
    // *in units of its own wavelength*: at 0.55 every scale is displaced by
    // about half its cell size, which is what advection does -- it moves the
    // big systems bodily while their edges curl, instead of smearing every
    // scale by the same absolute distance (which marbles the whole map).
    warp: { swirl: 0.55, selfWarp: 0.55 },

    // Shear: the number of lattice cells a feature is pushed sideways per map
    // height, at the tint of the shear field. Wind shear tilts what it carries,
    // and it tilts by a different angle in different places -- which is why the
    // composite's streaks cross and curve instead of lying in one direction.
    // Kept low: much above this the globe reads as a combed surface, because at
    // globe scale a streak is sub-pixel and only its angle survives.
    shear: 0.22,


    // Polar cap value; the composite cannot speak for the caps (its mask counts
    // sea ice and the ice sheets as cloud), so they continue to a climate value.
    polarCoverage: 0.64,

    // Latitude climatology: coverage fraction against *signed* latitude, from
    // the composite's 10-degree bands read at the middle of each band (-55, -45
    // ... 55). Read at the band edges the curve shifts and stretches and the
    // storm tracks land 0.13 too wet. The two hemispheres are kept apart on
    // purpose: 5 N reads 0.228 where 5 S reads 0.135, 55 S reads 0.505 where
    // 55 N reads 0.374. That is the ITCZ sitting north of the equator and the
    // southern storm track being the cloudier one; averaging the hemispheres
    // would put the wet band in the wrong place.
    latitudeCoverage: [
        [-90, 0.64], [-75, 0.62], [-55, 0.505], [-45, 0.339], [-35, 0.189],
        [-25, 0.175], [-15, 0.108], [-5, 0.135], [5, 0.228], [15, 0.149],
        [25, 0.135], [35, 0.186], [45, 0.248], [55, 0.374], [65, 0.585],
        [75, 0.62], [90, 0.64]
    ],

    // ---- the middle and high etages ------------------------------------------
    // Three layers, not one. A cirrus shield streams over the low deck; it does
    // not thicken the same blobs. So the upper etages are separate fields with
    // their own climatology, their own noise and their own motion -- which is
    // what lets one layer drift at the jet's 40 m/s while the deck it covers
    // crawls west at 6.
    //
    // Shares are the ISCCP-era picture: low cloud is the most extensive at
    // about 0.35 of the sky, high cloud next at the storm tracks and the ITCZ,
    // and middle cloud the least extensive of the three. Read at 10-degree
    // bands like the low curve, so each lands through its own rank transform.
    latitudeCoverageMid: [
        [-90, 0.26], [-75, 0.28], [-55, 0.30], [-45, 0.34], [-35, 0.24],
        [-25, 0.16], [-15, 0.12], [-5, 0.14], [5, 0.16], [15, 0.14],
        [25, 0.15], [35, 0.22], [45, 0.30], [55, 0.34], [65, 0.30],
        [75, 0.28], [90, 0.26]
    ],
    latitudeCoverageHigh: [
        [-90, 0.30], [-75, 0.34], [-55, 0.42], [-45, 0.40], [-35, 0.28],
        [-25, 0.20], [-15, 0.22], [-5, 0.30], [5, 0.34], [15, 0.28],
        [25, 0.22], [35, 0.26], [45, 0.34], [55, 0.40], [65, 0.40],
        [75, 0.34], [90, 0.30]
    ],

    // Relief inside a cloud: how far the density of a thin skirt falls below a
    // dense core. Real optical depth varies severalfold within one system.
    coreContrast: 0.55,

    // Cloud-top roughness: an octave pair at the very top of the resolution,
    // mixed in everywhere at low weight. It is too small to carry structure of
    // its own, but it is the right size to fray a boundary -- every pixel it
    // flips sits within a texel or two of the coverage threshold, so it turns
    // a cut silhouette into the torn edge the composite shows, without filling
    // the sky with flecks.
    fray: { octaves: [512, 1024], weight: 0.12 },

    // How strongly the cells of the fine band clump into patches. Cumulus does
    // not fall evenly over a subtropical belt: it organises in mesoscale fields
    // a few hundred kilometres across with clear air between them, and a fine
    // band spread uniformly reads as confetti instead of as weather.
    patchiness: 0.85,

    // How strongly a weather system imposes itself on the pattern. The storm
    // signal is added before the rank transform, so it cannot change the
    // planet's coverage -- the rank fixes that to the measured climatology --
    // but it decides *where* the cloud is: overcast inside a system, and less
    // cover in the quiet air it takes the place of.
    stormWeight: 0.9,

    seed: 19472831
};

function createCloudFieldTexture(THREE, options = {}) {
    const P = { ...CLOUD_FIELD, ...options };
    const { width: W, height: H } = P;

    // ---- gradient noise ---------------------------------------------------
    // Perlin's noise: a random gradient at each lattice point, interpolated with
    // a quintic fade. Unlike interpolated random *values* it has no flats and no
    // axis-aligned blocks -- the difference is the difference between marble and
    // a tiled floor, and it is the first thing the eye catches.
    //
    // The table is 1024 entries so that every octave frequency (4 ... 512) is a
    // divisor of it: the lattice then wraps exactly at the map's seam and the
    // texture has no join in longitude.
    let seed = P.seed >>> 0;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const TABLE = 1024;
    const perm = new Uint16Array(TABLE * 2);
    {
        const order = new Uint16Array(TABLE);
        for (let i = 0; i < TABLE; i++) order[i] = i;
        for (let i = TABLE - 1; i > 0; i--) {
            const j = (random() * (i + 1)) | 0;
            const t = order[i]; order[i] = order[j]; order[j] = t;
        }
        for (let i = 0; i < TABLE * 2; i++) perm[i] = order[i % TABLE];
    }
    // Eight directions, unit length: (1,0), (-1,0), (0,1), (0,-1), four diagonals.
    const GX = [1, -1, 0, 0, 0.70710678, -0.70710678, 0.70710678, -0.70710678];
    const GY = [0, 0, 1, -1, 0.70710678, 0.70710678, -0.70710678, -0.70710678];
    const halo = (ix, iy) => perm[(perm[ix % TABLE] + (iy & (TABLE - 1))) % TABLE] & 7;
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

    // Gradient noise on a lattice that wraps in x every `period` cells.
    function noise2(x, y, period) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const x0 = ((xi % period) + period) % period, x1 = (x0 + 1) % period;
        const u = fade(xf), v = fade(yf);
        const g00 = halo(x0, yi), g10 = halo(x1, yi);
        const g01 = halo(x0, yi + 1), g11 = halo(x1, yi + 1);
        const n00 = GX[g00] * xf + GY[g00] * yf;
        const n10 = GX[g10] * (xf - 1) + GY[g10] * yf;
        const n01 = GX[g01] * xf + GY[g01] * (yf - 1);
        const n11 = GX[g11] * (xf - 1) + GY[g11] * (yf - 1);
        const a = n00 + (n10 - n00) * u;
        const b = n01 + (n11 - n01) * u;
        return a + (b - a) * v;
    }

    // Sum of octaves at frequencies `list`, normalised to roughly [-1, 1].
    const fbm = (u, v, list, offsetX, offsetY, persistence = P.persistence, wx = 0, wy = 0, shear = 0) => {
        let sum = 0, amp = 1, norm = 0;
        for (let i = 0; i < list.length; i++) {
            const f = list[i];
            const k = P.warp.selfWarp / f;      // displacement in map units
            // The shear is applied in lattice units and grows with v, so it is a
            // constant *angle* at every octave: a streak at 4 cycles and a
            // streak at 256 cycles lean the same way, which is what makes a
            // filament read as one filament across scales.
            sum += amp * noise2((u + wx * k) * f + offsetX + shear * v * f,
                                (v + wy * k) * f + offsetY, f);
            norm += amp;
            amp *= persistence;
        }
        return (sum / norm) * 1.6;
    };

    // ---- latitude climatology ---------------------------------------------
    const coverageFrom = (curve, latDeg) => {
        if (latDeg <= curve[0][0]) return curve[0][1];
        for (let i = 1; i < curve.length; i++) {
            if (latDeg <= curve[i][0]) {
                const [l0, c0] = curve[i - 1];
                const [l1, c1] = curve[i];
                let t = (latDeg - l0) / Math.max(l1 - l0, 1e-9);
                t = t * t * (3 - 2 * t);
                return c0 + (c1 - c0) * t;
            }
        }
        return curve[curve.length - 1][1];
    };
    const coverageAt = (latDeg) => coverageFrom(P.latitudeCoverage, latDeg);

    // ---- 1. turbulence, displaced by its own wind field --------------------
    const storms = P.stormSignal || null;      // where weather systems are, 0-1
    const surface = new Float32Array(W * H);   // the coverage field before ranking
    const relief = new Float32Array(W * H);    // density variation inside a cloud

    // The wind and the cirrus are low-frequency by construction (2 to 16 cycles
    // across the map), so they are evaluated on a quarter-resolution grid and
    // read back with interpolation. A per-texel evaluation costs sixteen times
    // as much and cannot show anything the grid does not already hold: a
    // displacement field that turns over every 100 texels is still the same
    // displacement field when it is sampled every fourth one.
    const GW = W >> 2, GH = H >> 2;
    const warpGrid = new Float32Array(GW * GH * 2);
    const midGrid = new Float32Array(GW * GH);
    const highGrid = new Float32Array(GW * GH);
    const patchGrid = new Float32Array(GW * GH);
    const shearGrid = new Float32Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) {
        const v = (gy + 0.5) / GH;
        for (let gx = 0; gx < GW; gx++) {
            const u = (gx + 0.5) / GW;
            // Two stages. The first is a turbulence field; the second reads
            // *through* the first, displaced by it. Composing a displacement
            // through a displacement is what makes whorls instead of waves --
            // one field bends, two fields curl.
            const qx = fbm(u, v, [2, 4, 8], 11.3, 4.7);
            const qy = fbm(u, v, [2, 4, 8], -6.4, 12.9);
            const rx = fbm(u + P.warp.swirl * qx, v + P.warp.swirl * qy, [4, 8, 16], -3.1, 8.2);
            const ry = fbm(u + P.warp.swirl * qx, v + P.warp.swirl * qy, [4, 8, 16], 7.7, -1.8);
            const g = gy * GW + gx;
            warpGrid[g * 2] = rx + 0.4 * qx;
            warpGrid[g * 2 + 1] = ry + 0.4 * qy;
            shearGrid[g] = P.shear * fbm(u, v, [2, 4, 8], -18.4, 5.9);
            const patch = fbm(u + 0.10 * qx, v + 0.10 * qy, [2, 4, 8], 31.4, 17.2);
            patchGrid[g] = Math.max(0, Math.min(1, 0.5 + patch * 0.7));
            // The middle etage: a decorrelated field at the same synoptic scales.
            // Offset in both axes so it does not share the low deck's blobs --
            // altostratus is not the low cloud made taller.
            midGrid[g] = fbm(u + 0.27, v - 0.13, [4, 8, 16], 41.2, -7.6);
            // The high etage: cirrus, stretched along the shear it is carried on.
            // The same field as the old veil, promoted to a layer of its own.
            const cirrus = fbm(u + 0.06 * qx, v + 0.06 * qy, [4, 8, 16], 21.7, -9.4);
            highGrid[g] = cirrus;
        }
    }
    // Bilinear read of a quarter-resolution grid, wrapping in longitude and
    // clamping in latitude (there is no row above the pole).
    const gridAt = (grid, stride, channel, u, v) => {
        const gx = u * GW - 0.5, gy = Math.max(0, Math.min(GH - 1, v * GH - 0.5));
        const ix = Math.floor(gx), iy = Math.floor(gy);
        const fx = gx - ix, fy = gy - iy;
        const x0 = ((ix % GW) + GW) % GW, x1 = (x0 + 1) % GW;
        const y0 = iy, y1 = Math.min(GH - 1, iy + 1);
        const a = grid[(y0 * GW + x0) * stride + channel], b = grid[(y0 * GW + x1) * stride + channel];
        const c = grid[(y1 * GW + x0) * stride + channel], d = grid[(y1 * GW + x1) * stride + channel];
        const t = a + (b - a) * fx, w = c + (d - c) * fx;
        return t + (w - t) * fy;
    };

    const fineList = P.fineOctaves;
    for (let y = 0; y < H; y++) {
        const v = (y + 0.5) / H;
        const lat = 90 - (y + 0.5) * 180 / H;
        const coverage = coverageAt(lat);
        const dry = Math.max(0, Math.min(1, 1 - coverage / P.cellRegimeCoverage));
        const fineWeight = dry * dry * (3 - 2 * dry);
        const rowBase = y * W;
        for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W;
            // The wind displaces the sampled coordinate; both the coarse and the
            // fine band then read through it, which is what stretches them into
            // filaments.
            const wu = gridAt(warpGrid, 2, 0, u, v);
            const wv = gridAt(warpGrid, 2, 1, u, v);
            const shear = gridAt(shearGrid, 1, 0, u, v);
            const coarse = fbm(u, v, P.coarseOctaves, 2.9, 6.1, P.persistence, wu, wv, shear);
            const fine = fbm(u, v, fineList, -5.3, 3.4, P.finePersistence, wu, wv, shear);
            // Cells arrive in patches: the fine band's share is modulated by a
            // mesoscale field of its own, so dry latitudes show fields of
            // cumulus separated by clear air rather than a uniform speckle.
            const patch = gridAt(patchGrid, 1, 0, u, v);
            const cells = fineWeight * (1 - P.patchiness + P.patchiness * patch);
            const fray = fbm(u, v, P.fray.octaves, 44.1, -13.6, P.finePersistence, wu, wv);
            let value = (1 - cells) * coarse + cells * fine + P.fray.weight * fray;
            if (storms) value += P.stormWeight * storms[rowBase + x];
            surface[rowBase + x] = value;
            relief[rowBase + x] = fbm(u, v, [96, 192], 14.2, 7.6, P.persistence, wu, wv);
        }
    }

    // ---- 4. rank transform, row by row ------------------------------------
    // Map each latitude row onto a uniform [0, 1] distribution through its own
    // histogram. A single global rank would leave every row with whatever share
    // of the population the noise happened to give it; per row, "coverage c" is
    // exactly the threshold 1 - c, so the curve above lands to the digit with no
    // tuning by eye.
    const BINS = 512;
    const hist = new Uint32Array(BINS);
    const cdf = new Float32Array(BINS);
    const rankRows = (field) => {
        for (let y = 0; y < H; y++) {
            const base = y * W;
            let lo = Infinity, hi = -Infinity;
            for (let x = 0; x < W; x++) {
                const f = field[base + x];
                if (f < lo) lo = f;
                if (f > hi) hi = f;
            }
            const scale = (BINS - 1) / Math.max(hi - lo, 1e-9);
            hist.fill(0);
            for (let x = 0; x < W; x++) hist[((field[base + x] - lo) * scale) | 0]++;
            let acc = 0;
            for (let b = 0; b < BINS; b++) { acc += hist[b]; cdf[b] = acc / W; }
            for (let x = 0; x < W; x++) {
                const t = (field[base + x] - lo) * scale;
                const b = Math.max(0, Math.min(BINS - 1, t | 0));
                const frac = Math.max(0, Math.min(1, t - b));
                const c0 = cdf[b], c1 = b + 1 < BINS ? cdf[b + 1] : 1;
                field[base + x] = c0 + (c1 - c0) * frac;
            }
        }
    };
    rankRows(surface);

    // ---- 4b. the upper two layers -----------------------------------------
    // Built from their quarter-resolution grids and normalised the same way, so
    // each keeps its own share of the sky to the digit. The middle etage gets a
    // fine octave pair so altocumulus has elements; cirrus does not -- its
    // structure is a streak, and its texture is the shear already baked into
    // the grid.
    const midSurface = new Float32Array(W * H);
    const highSurface = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
        const v = (y + 0.5) / H;
        const rowBase = y * W;
        for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W;
            const storm = storms ? storms[rowBase + x] : 0;
            const elements = fbm(u, v, [64, 128], 12.3, 4.9, P.finePersistence);
            midSurface[rowBase + x] = gridAt(midGrid, 1, 0, u, v) + 0.30 * elements + P.stormWeight * storm;
            highSurface[rowBase + x] = gridAt(highGrid, 1, 0, u, v) + 0.6 * P.stormWeight * storm;
        }
    }
    rankRows(midSurface);
    rankRows(highSurface);

    // ---- 5. the edge, in texels -------------------------------------------
    // The coverage threshold gives an exact binary mask; a small symmetric blur
    // turns it into the ramp a real cloud edge has. Doing it here rather than
    // inside the rank-space ramp is the difference between a measured edge and
    // a guessed one: the blur's width is in texels, so it is the same at every
    // latitude and in every regime, while a ramp on the rank value is only as
    // wide as the local gradient happens to be (and that gradient varies by an
    // order of magnitude across the map).
    const KERNEL = [0.10, 0.80, 0.10];   // a ~1.5-texel edge, as the composite shows
    const mask = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
        const lat = 90 - (y + 0.5) * 180 / H;
        const threshold = 1 - coverageAt(lat);
        const rowBase = y * W;
        for (let x = 0; x < W; x++) mask[rowBase + x] = surface[rowBase + x] >= threshold ? 1 : 0;
    }
    const blurred = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {           // horizontal, wrapping in longitude
        const rowBase = y * W;
        for (let x = 0; x < W; x++) {
            const xm = (x + W - 1) % W, xp = (x + 1) % W;
            blurred[rowBase + x] = KERNEL[0] * mask[rowBase + xm] + KERNEL[1] * mask[rowBase + x]
                                 + KERNEL[2] * mask[rowBase + xp];
        }
    }
    for (let y = 0; y < H; y++) {           // vertical, clamped at the poles
        const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
        const rowBase = y * W, rowm = ym * W, rowp = yp * W;
        for (let x = 0; x < W; x++) {
            mask[rowBase + x] = KERNEL[0] * blurred[rowm + x] + KERNEL[1] * blurred[rowBase + x]
                              + KERNEL[2] * blurred[rowp + x];
        }
    }

    // ---- 6. density --------------------------------------------------------
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const context = canvas.getContext("2d");
    const image = context.createImageData(W, H);
    const pixels = image.data;
    // The upper two layers are ranked but not thresholded: their edge is the
    // band around the same 1 - coverage contour, soft across a measured width
    // rather than the two-texel ramp the low deck uses. They are thin, they
    // overlap, and a hard edge on a cirrus shield reads as cut paper.
    const softMask = (field, curve, width) => {
        const out = new Float32Array(W * H);
        for (let y = 0; y < H; y++) {
            const lat = 90 - (y + 0.5) * 180 / H;
            const threshold = 1 - coverageFrom(curve, lat);
            const rowBase = y * W;
            for (let x = 0; x < W; x++) {
                const t = (field[rowBase + x] - (threshold - width)) / (2 * width);
                const c = Math.max(0, Math.min(1, t));
                out[rowBase + x] = c * c * (3 - 2 * c);
            }
        }
        return out;
    };
    const midMask = softMask(midSurface, P.latitudeCoverageMid, 0.055);
    const highMask = softMask(highSurface, P.latitudeCoverageHigh, 0.070);

    for (let y = 0; y < H; y++) {
        const rowBase = y * W;
        for (let x = 0; x < W; x++) {
            const i = rowBase + x;
            let density = mask[i];
            if (density > 0.5) {
                // Inside a cloud, relief: dense cores, thin skirts. Tied to how
                // far inside we are *and* multiplied by that distance, so it
                // vanishes at the half-cover contour and cannot move it.
                const inside = (density - 0.5) * 2;
                const core = 0.5 + 0.5 * relief[i];
                density *= 1 - P.coreContrast * (1 - core) * inside;
                density = Math.max(0, Math.min(1, density));
            }
            const p = i * 4;
            // Three layers, three channels: R low, G middle, B high. The alpha
            // channel stays opaque so the texture can still be read back as an
            // image by anything that samples .a.
            pixels[p] = (density * 255) | 0;
            pixels[p + 1] = (midMask[i] * 255) | 0;
            pixels[p + 2] = (highMask[i] * 255) | 0;
            pixels[p + 3] = 255;
        }
    }
    context.putImageData(image, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.name = "Procedural cloud coverage field";
    texture.userData.cloudMaskChannel = "rgb";
    texture.userData.cloudField = { width: W, height: H, params: P };
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

globalThis.CLOUD_FIELD = CLOUD_FIELD;
globalThis.createCloudFieldTexture = createCloudFieldTexture;
