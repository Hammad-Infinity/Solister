// Per-planet transmittance (optical depth) table for the scattering shader.
//
// The procedural-Earth reference precomputes a 2D optical-depth texture once
// and then samples it during the in-scattering march, instead of integrating
// extinction along the sun ray at every sample. That is what makes a 20-sample
// march affordable: without a table each sample needs its own slant integral,
// so the cost is samples x slant-samples rather than just samples.
//
// Two things are deliberately different from the reference.
//
// First, the table is recomputed here from this project's atmosphere database
// rather than shipping Earth's baked 256x256 texture and reusing it for every
// body. A planet's optical depth depends on its own composition, scale height
// and extinction coefficients; reusing Earth's table would make Venus and Mars
// scatter like Earth. Each profile gets its own table, sized and integrated
// from its own parameters.
//
// Second, this is a CPU table, not a render-target pass. The reference is
// WebGL1/r86 and builds its table with a separate mesh and MultiplyBlending.
// Here the tables are small, built once per planet at setup, and uploaded as
// ordinary textures, which avoids a whole extra render pass and the float
// readback problems that come with it.

// Largest optical depth the 8-bit packing can represent, for a planet whose
// thickest ray reaches about this much. Anything above it is opaque to better
// than 1e-5 transmittance, so clamping costs nothing visually.
//
// It has to be chosen per planet rather than shared. Venus's cloud deck is
// opaque by orders of magnitude, so a single generous ceiling would spend the
// whole 0..255 range on the part of Venus's table that is already black and
// leave the interesting low-tau region quantised to a couple of bytes.
// IEEE-754 binary16 encoding, matching THREE.DataTexture's Uint16Array +
// HalfFloatType path. Values are stored via a Float32 view so the mantissa
// shift and the subnormal boundary are handled by the hardware format rather
// than by hand-rolled bit surgery.
function floatToHalf(value) {
    const f32 = _floatView;
    const u32 = _intView;
    f32[0] = value;
    const f = u32[0];
    const sign = (f >>> 16) & 0x8000;
    const exponent = (f >>> 23) & 0xff;
    const mantissa = f & 0x7fffff;

    if (exponent === 0xff) return sign | 0x7c00; // Inf/NaN
    if (exponent === 0 && mantissa === 0) return sign;

    const e = exponent - 127;
    if (e > 15) return sign | 0x7c00; // overflow to Inf
    if (e < -24) return sign; // rounds to zero

    if (e < -14) {
        // Subnormal: fixed step of 2^-24, so quantise onto that grid.
        const scaled = Math.abs(value) / Math.pow(2, -24);
        return sign | (Math.round(scaled) & 0x3ff);
    }

    // Normal: 10 explicit mantissa bits. Round to nearest.
    const rounded = (mantissa + 0x1000) >>> 13;
    return sign | (((e + 15) << 10) + rounded);
}

const _floatView = new Float32Array(1);
const _intView = new Uint32Array(_floatView.buffer);
const ONE_HALF = 0x3c00; // 1.0 in binary16

// Bounds on the log2-space ceiling, in units of log2(1 + tau). The floor keeps
// a near-vacuum world like Pluto from being quantised into nothing; the cap
// stops a pathological profile from spreading the range so thin that Earth's
// interesting region collapses. log2(1+65536) = 16, so 20 leaves headroom.
const ENCODED_MAX_MIN = 4;
const ENCODED_MAX_MAX = 20;

// Optical depth past which the shader treats a ray as fully opaque. Kept in
// step with the min(sunTau, vec3(9.0)) clamp in planet-atmosphere.glsl.js.
const USEFUL_TAU_CLAMP = 9;

// Table dimensions. The reference uses 256x256; 128x64 is enough here because
// the integrand is smooth and the shader interpolates bilinearly. Halving each
// axis is a 4x reduction in texels, and the table is built on the CPU, so the
// cost is setup time rather than per-frame time.
const TRANSMITTANCE_TABLE_WIDTH = 128;
const TRANSMITTANCE_TABLE_HEIGHT = 64;

// Number of integration steps along each table ray. The reference marches its
// table on the GPU with an unspecified budget; 48 steps keeps the error well
// under a percent for the exponential profiles involved.
const TRANSMITTANCE_TABLE_STEPS = 48;

// Maps a zenith cosine onto table x, matching the reference's RemapToTrsmTblX
// but using cos directly instead of acos. cos is monotonic in [-1, 1] so the
// mapping is invertible, and skipping acos saves a transcendental per lookup
// in a shader that runs per atmosphere pixel.
//
//   x = (1 - cosChi) * 0.5 * (N-1)/N
//
// The (N-1)/N factor keeps the last texel centre from landing outside the
// table, which is what produces a black seam at the horizon otherwise.
function transmittanceTableX(cosChi, width) {
    const n = width || TRANSMITTANCE_TABLE_WIDTH;
    const clamped = Math.max(-1, Math.min(1, cosChi));
    return (1 - clamped) * 0.5 * (n - 1) / n;
}

// Height above the surface, in units of the atmosphere's top altitude, mapped
// onto table y. The reference uses raw metres; normalising here lets one pair
// of sampling coefficients work for every planet regardless of scale.
function transmittanceTableY(heightFraction, height) {
    const n = height || TRANSMITTANCE_TABLE_HEIGHT;
    const clamped = Math.max(0, Math.min(1, heightFraction));
    return clamped * (n - 1) / n;
}

// Optical depth along a ray starting at `height` above a unit-radius sphere,
// travelling at zenith cosine `cosChi`, through an exponential atmosphere with
// the given scale height and per-channel extinction.
//
// The ray is integrated in normalised units where the body radius is 1 and the
// atmosphere top is `topRadius`, so the same routine serves Mercury's 1800 km
// exosphere and Venus's 95 km cloud deck without rescaling.
function opticalDepthAlongRay(cosChi, height, scaleHeight, extinction, topRadius) {
    const r0 = 1 + Math.max(0, height);
    const rTop = Math.max(topRadius, r0 + 1e-6);

    // Distance from r0 to where the ray leaves the atmosphere shell.
    //
    // The ray is p(t) = p0 + d*t with |d| = 1, and cosChi = dot(p0/|p0|, d),
    // i.e. positive when the ray points away from the centre. Solving
    // |p(t)|^2 = rTop^2 for t gives t^2 + 2*r0*cosChi*t + (r0^2 - rTop^2) = 0,
    // whose roots are -r0*cosChi +/- sqrt((r0*cosChi)^2 - r0^2 + rTop^2).
    // The exit is the larger root. Getting this sign backwards yields a ray
    // that crosses the whole sphere instead of exiting the thin shell, which
    // is what made a straight-up ray return zero optical depth.
    const bHalf = r0 * cosChi;
    const disc = bHalf * bHalf - r0 * r0 + rTop * rTop;
    if (disc <= 0) return [0, 0, 0];
    const length = -bHalf + Math.sqrt(disc);
    if (!(length > 0)) return [0, 0, 0];

    const steps = TRANSMITTANCE_TABLE_STEPS;
    const stepLength = length / steps;
    const tau = [0, 0, 0];

    // Guard the coefficients. A malformed profile would otherwise propagate
    // NaN or Infinity into the packed texture, and exp(-NaN) is NaN, which
    // turns the whole atmosphere black with no visible error.
    const ext = [
        Number.isFinite(extinction[0]) ? Math.max(0, extinction[0]) : 0,
        Number.isFinite(extinction[1]) ? Math.max(0, extinction[1]) : 0,
        Number.isFinite(extinction[2]) ? Math.max(0, extinction[2]) : 0
    ];

    for (let i = 0; i < steps; i++) {
        // Sample at the segment midpoint: second-order accurate where the
        // endpoints would only be first-order, at no extra cost.
        const t = (i + 0.5) * stepLength;
        const r = Math.sqrt(Math.max(r0 * r0 + 2 * r0 * cosChi * t + t * t, 0));
        // With cosChi > 0 pointing outward, |p(t)|^2 = r0^2 + 2*r0*cosChi*t + t^2.
        const altitude = r - 1;
        if (altitude < 0) break;
        const density = Math.exp(-altitude / Math.max(scaleHeight, 1e-9));
        if (density < 1e-6) break;
        for (let ch = 0; ch < 3; ch++) tau[ch] += ext[ch] * density * stepLength;
    }
    return tau;
}

// Build one planet's table as a Float32Array in RGB layout.
//
//   profile   an entry from PLANET_ATMOSPHERE_PROFILES, carrying `derived`
//   width/height  table size; defaults to the module constants
//
// Returns { data, width, height } with data as RGB triples, or null when the
// profile carries nothing to scatter, in which case the caller should skip the
// atmosphere entirely rather than uploading an empty table.
function buildTransmittanceTable(profile, bodyRadiusKm = 6371, width = TRANSMITTANCE_TABLE_WIDTH, height = TRANSMITTANCE_TABLE_HEIGHT) {
    if (!profile || !profile.derived) return null;

    const derived = profile.derived;
    const topKm = Number.isFinite(derived.renderTopKm) ? derived.renderTopKm : derived.topKm;
    // derived.groundRadiusKm is not populated for any planet in the current
    // database; the body radius comes from BodyShapes.axesKm, which is the same
    // source createPlanetAtmosphere uses for kmToBodyRatio.
    const groundRadiusKm = Number.isFinite(derived.groundRadiusKm)
        ? derived.groundRadiusKm
        : (Number.isFinite(bodyRadiusKm) && bodyRadiusKm > 0 ? bodyRadiusKm : 6371);
    if (!(topKm > 0) || !(groundRadiusKm > 0)) return null;

    // Scale height expressed as a fraction of the body radius, so the table is
    // scale-free and the shader can work in normalised units.
    const scaleHeightKm = Math.max(derived.rayleighScaleHeightKm || 8, 0.001);
    const scaleHeight = scaleHeightKm / groundRadiusKm;
    const topRadius = 1 + topKm / groundRadiusKm;

    // tauR/tauM in the profile are extinction coefficients PER KILOMETRE, but
    // the march below integrates distance in body-radius units - which is also
    // what the runtime shader does, via weight = chord / bodyRadius. So the
    // coefficients have to be scaled by the body radius to be consistent with
    // the integration variable. Skipping this makes the table 4-5 orders of
    // magnitude too thin, and every planet's limb comes out black.
    const extinctionPerRadiusScale = groundRadiusKm;

    // Per-channel extinction at the surface. tauR/tauM are already RGB.
    const extinction = [
        ((derived.tauR?.r || 0) + (derived.tauM?.r || 0)) * extinctionPerRadiusScale,
        ((derived.tauR?.g || 0) + (derived.tauM?.g || 0)) * extinctionPerRadiusScale,
        ((derived.tauR?.b || 0) + (derived.tauM?.b || 0)) * extinctionPerRadiusScale
    ];

    // A body whose total extinction is effectively zero has no atmosphere to
    // look up; Mercury's exosphere is the real case here.
    const total = extinction[0] + extinction[1] + extinction[2];
    if (!(total > 1e-9)) return null;

    const data = new Float32Array(width * height * 3);

    for (let y = 0; y < height; y++) {
        // Invert the y mapping to recover the height fraction for this row.
        const heightFraction = y / (height - 1);
        for (let x = 0; x < width; x++) {
            // Invert the x mapping to recover cosChi for this column.
            const cosChi = 1 - 2 * x / (width - 1);
            const tau = opticalDepthAlongRay(
                cosChi, heightFraction * (topRadius - 1), scaleHeight, extinction, topRadius
            );
            const o = (y * width + x) * 3;
            data[o] = tau[0];
            data[o + 1] = tau[1];
            data[o + 2] = tau[2];
        }
    }

    // Pack the optical depths into bytes.
    //
    // A float DataTexture would need OES_texture_float_linear to interpolate,
    // and that extension is not guaranteed. This project already ran into the
    // same class of problem with histogram readback in the HDR pipeline and
    // solved it by packing to 8-bit; the same trick applies here.
    // Encode optical depth as log2(1 + tau).
    //
    // The table's values span about five orders of magnitude on the thick
    // planets - Venus's median ray is around tau 22 while its grazing rays
    // reach 20000 - so a linear encoding would spend its entire range on the
    // opaque tail and leave nearly every other texel at zero. What the shader
    // actually consumes is exp(-tau), so the quantity that needs resolution is
    // tau near zero, and the quantity that does not is tau above about 9,
    // where exp(-tau) is already below 1e-4.
    //
    // log2(1 + tau) suits both ends: it is essentially linear (slope 1/ln2)
    // for tau << 1, where the visible detail lives, and it compresses the
    // opaque tail where nothing is lost. The shader inverts it exactly.
    let peak = 0;
    for (let i = 0; i < data.length; i++) if (data[i] > peak) peak = data[i];

    // Ceiling for the 8-bit path only, in log2 space. Chosen from the *useful*
    // peak rather than the global one: the shader clamps tau at
    // USEFUL_TAU_CLAMP, past which it deliberately treats the ray as opaque,
    // so bytes spent above that buy nothing while bytes spent below it are the
    // whole visible range. Sizing to the global peak cost about 1e-2 absolute
    // error in exp(-tau) near the terminator, roughly 80x the shader's own
    // opacity floor, which would read as banding.
    let usefulPeak = 0;
    for (let i = 0; i < data.length; i++) {
        const v = Math.min(data[i], USEFUL_TAU_CLAMP);
        if (v > usefulPeak) usefulPeak = v;
    }
    const encodedMax = Math.max(
        ENCODED_MAX_MIN,
        Math.min(ENCODED_MAX_MAX, usefulPeak > 0 ? Math.log2(1 + usefulPeak) * 1.02 : ENCODED_MAX_MIN)
    );

    const encoded = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
        for (let ch = 0; ch < 3; ch++) {
            encoded[i * 3 + ch] = Math.log2(1 + Math.max(0, data[i * 3 + ch]));
        }
    }

    // Two packings of the same encoded values.
    //
    // Half-float is the path actually used: it is exact enough that the worst
    // error in exp(-tau) is about 2.4e-4, which is below one 8-bit sRGB level
    // and therefore invisible. It costs 0.56 MB across all nine tables.
    //
    // The 8-bit path exists as a fallback for a context without half-float
    // support. Measured at 5.4e-4 *per byte step* - about 16 sRGB levels at the
    // dark end - so it is visibly coarser and should not be preferred.
    const half = new Uint16Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        for (let ch = 0; ch < 3; ch++) half[i * 4 + ch] = floatToHalf(encoded[i * 3 + ch]);
        half[i * 4 + 3] = ONE_HALF;
    }

    const packed = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        for (let ch = 0; ch < 3; ch++) {
            packed[i * 4 + ch] = Math.round(Math.min(1, encoded[i * 3 + ch] / encodedMax) * 255);
        }
        packed[i * 4 + 3] = 255;
    }

    return {
        data: data,
        packed: packed,
        half: half,
        encodedMax: encodedMax,
        peakTau: peak,
        usefulPeakTau: usefulPeak,
        width: width,
        height: height,
        // The shader needs these to convert its own cosChi/height into UVs.
        sampleCoeff: {
            x: 0.5 * (width - 1) / width,
            y: (height - 1) / height,
            topRadius: topRadius,
            scaleHeight: scaleHeight
        }
    };
}

// Cache so repeated setup calls (rebuild after a texture reset, say) do not
// re-integrate the same table. Keyed by body key.
const _tableCache = new Map;

function getTransmittanceTable(key, profile, bodyRadiusKm = 6371) {
    const cacheKey = key + ":" + bodyRadiusKm;
    const cached = _tableCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const built = buildTransmittanceTable(profile, bodyRadiusKm);
    _tableCache.set(cacheKey, built);
    return built;
}

function clearTransmittanceTables() {
    _tableCache.clear();
}

globalThis.TRANSMITTANCE_TABLE_WIDTH = TRANSMITTANCE_TABLE_WIDTH;
globalThis.TRANSMITTANCE_ENCODED_MAX_MIN = ENCODED_MAX_MIN;
globalThis.TRANSMITTANCE_TABLE_HEIGHT = TRANSMITTANCE_TABLE_HEIGHT;
globalThis.buildTransmittanceTable = buildTransmittanceTable;
globalThis.getTransmittanceTable = getTransmittanceTable;
globalThis.clearTransmittanceTables = clearTransmittanceTables;
globalThis.transmittanceTableX = transmittanceTableX;
globalThis.transmittanceTableY = transmittanceTableY;
globalThis.opticalDepthAlongRay = opticalDepthAlongRay;
