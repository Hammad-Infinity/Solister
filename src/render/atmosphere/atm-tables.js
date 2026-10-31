// Precomputed single-scattering atmosphere tables.
//
// File assets/atmosphere/<body>.atm.gz holds one body's baked scattering
// model, gzipped. Raw layout, little endian, 8 597 564 bytes:
//   0          60 B   15 x float32 header (Rg, Rt, HR, HM, betaR[3],
//                     betaMieSca[3], betaMieExt[3], mieG, mieFade)
//   60         8 MB   S inscatter, RGBA32F, [r 32][mu 64][muS*nu 256]
//   8388716    192 KB T transmittance, RGB32F, [h 64][mu 256]
//   8585324    12 KB  E irradiance, RGB32F, [h 16][muS 64]
//
// Uploaded as half float on purpose: RGBA16F is texture-filterable in WebGL2
// core, RGBA32F needs OES_texture_float_linear, and the user's driver has
// already lost one context over float formats. Nothing here blends, so the
// r69/r70 failure cannot occur: the tables are only uploaded and sampled.
const ATM_TABLE_BYTES = 8597564;
const ATM_HEADER_FLOATS = 15;
const ATM_HEADER_BYTES = ATM_HEADER_FLOATS * 4;
const ATM_S_COUNT = 32 * 64 * 256 * 4;
const ATM_T_COUNT = 64 * 256 * 3;
const ATM_E_COUNT = 16 * 64 * 3;

// Texture dimensions. The file stores S as [r][mu][muS*nu], which is exactly the
// x = muS*nu, y = mu, z = r order a 3D texture wants: a reshape, no transpose.
const ATM_LAYOUT = Object.freeze({
    s: Object.freeze({ width: 256, height: 64, depth: 32 }),
    t: Object.freeze({ width: 256, height: 64 }),
    e: Object.freeze({ width: 64, height: 16 })
});

// Every body that ships a table. A name here without a file is skipped with one
// warning at startup; a table on disk without a name here is dead weight, so
// this list and assets/atmosphere/ are checked against each other by
// tools/atm-audit.mjs.
const ATM_TABLE_BODIES = Object.freeze([ "earth", "venus", "mars", "jupiter", "saturn", "uranus", "neptune" ]);

const atmTableCache = new Map();

function parseAtmTable(buffer) {
    const bytes = buffer instanceof ArrayBuffer ? buffer
        : buffer && buffer.buffer instanceof ArrayBuffer ? buffer.buffer : null;
    if (!bytes) throw new Error("atmosphere table: expected an ArrayBuffer");
    if (bytes.byteLength !== ATM_TABLE_BYTES) {
        throw new Error(`atmosphere table: ${bytes.byteLength} bytes, expected ${ATM_TABLE_BYTES}`);
    }
    const view = new DataView(bytes);
    const raw = new Float32Array(ATM_HEADER_FLOATS);
    for (let i = 0; i < ATM_HEADER_FLOATS; i++) raw[i] = view.getFloat32(i * 4, true);
    if (!raw.every(Number.isFinite)) throw new Error("atmosphere table: header is not finite");
    const header = {
        groundRadiusKm: raw[0],
        topRadiusKm: raw[1],
        rayleighScaleHeightKm: raw[2],
        mieScaleHeightKm: raw[3],
        rayleighBeta: [raw[4], raw[5], raw[6]],
        mieScatterBeta: [raw[7], raw[8], raw[9]],
        mieExtinctionBeta: [raw[10], raw[11], raw[12]],
        mieG: raw[13],
        mieFade: raw[14]
    };
    if (!(header.groundRadiusKm > 0) || !(header.topRadiusKm > header.groundRadiusKm)) {
        throw new Error("atmosphere table: bad radii");
    }
    if (!(header.rayleighScaleHeightKm > 0) || !(header.mieScaleHeightKm > 0)) {
        throw new Error("atmosphere table: bad scale heights");
    }
    if (!(header.mieG >= 0 && header.mieG < 1)) throw new Error("atmosphere table: bad mieG");

    const sOffset = ATM_HEADER_BYTES;
    const tOffset = sOffset + ATM_S_COUNT * 4;
    const eOffset = tOffset + ATM_T_COUNT * 4;
    return {
        header: Object.freeze(header),
        // Views, not copies: the file is float32 little endian, which is what a
        // Float32Array reads on every platform this runs on.
        s: new Float32Array(bytes, sOffset, ATM_S_COUNT),
        t: new Float32Array(bytes, tOffset, ATM_T_COUNT),
        e: new Float32Array(bytes, eOffset, ATM_E_COUNT)
    };
}

// float32 -> float16, round to nearest even. Written here rather than taken from
// three so the test can run it in plain node without a browser or a GPU.
const _halfFloatIn = new Float32Array(1);
const _halfIntIn = new Int32Array(_halfFloatIn.buffer);
const ONE_AS_HALF = 0x3c00;

function toHalf(value) {
    _halfFloatIn[0] = value;
    const bits = _halfIntIn[0];
    const sign = (bits >> 16) & 0x8000;
    const exponent = (bits >> 23) & 0xff;
    let mantissa = bits & 0x7fffff;
    if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0);
    const unbiased = exponent - 127 + 15;
    if (unbiased >= 0x1f) return sign | 0x7c00;
    if (unbiased <= 0) {
        if (unbiased < -10) return sign;
        mantissa |= 0x800000;
        const shift = 14 - unbiased;
        const rounded = (mantissa + (1 << (shift - 1)) - 1 + ((mantissa >> shift) & 1)) >> shift;
        return sign | rounded;
    }
    const rounded = (mantissa + 0x1000 + ((mantissa >> 13) & 1)) >> 13;
    if (rounded === 0x400) return sign | ((unbiased + 1) << 10);
    return sign | (unbiased << 10) | rounded;
}

// RGBA half float. RGB sources are expanded rather than kept as RGB16F so the
// row stride is never a question and all three tables share one format.
function atmToHalfRGBA(source, texels) {
    const out = new Uint16Array(texels * 4);
    const stride = source.length === texels * 4 ? 4 : 3;
    for (let i = 0; i < texels; i++) {
        const si = i * stride;
        const di = i * 4;
        out[di] = toHalf(source[si]);
        out[di + 1] = toHalf(source[si + 1]);
        out[di + 2] = toHalf(source[si + 2]);
        out[di + 3] = stride === 4 ? toHalf(source[si + 3]) : ONE_AS_HALF;
    }
    return out;
}

function createAtmTableTextures(THREE, table) {
    if (!THREE) throw new Error("atmosphere table: THREE is required");
    const layout = ATM_LAYOUT;

    const sData = atmToHalfRGBA(table.s, layout.s.width * layout.s.height * layout.s.depth);
    const s = new THREE.Data3DTexture(sData, layout.s.width, layout.s.height, layout.s.depth);
    s.format = THREE.RGBAFormat;
    s.type = THREE.HalfFloatType;

    const tData = atmToHalfRGBA(table.t, layout.t.width * layout.t.height);
    const t = new THREE.DataTexture(tData, layout.t.width, layout.t.height);
    t.format = THREE.RGBAFormat;
    t.type = THREE.HalfFloatType;

    const eData = atmToHalfRGBA(table.e, layout.e.width * layout.e.height);
    const e = new THREE.DataTexture(eData, layout.e.width, layout.e.height);
    e.format = THREE.RGBAFormat;
    e.type = THREE.HalfFloatType;

    for (const tex of [s, t, e]) {
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
    }
    s.wrapR = THREE.ClampToEdgeWrapping;
    s.unpackAlignment = 1;

    return {
        s, t, e,
        header: table.header,
        layout,
        dispose() {
            s.dispose();
            t.dispose();
            e.dispose();
        }
    };
}

// Fetches assets/atmosphere/<body>.atm.gz, decompresses in the browser and
// uploads. Result is cached per body because a table is ~4.3 MB of VRAM and
// every surface material for that body samples the same one.
async function loadAtmTable(THREE, body, options = {}) {
    if (atmTableCache.has(body)) return atmTableCache.get(body);
    const url = options.url || `./assets/atmosphere/${body}.atm.gz`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`atmosphere table ${body}: HTTP ${response.status}`);
    const blob = await response.blob();
    let source = blob;
    if (typeof DecompressionStream === "function") {
        source = blob.stream().pipeThrough(new DecompressionStream("gzip"));
    }
    const buffer = await new Response(source).arrayBuffer();
    const parsed = parseAtmTable(buffer);
    const textures = createAtmTableTextures(THREE, parsed);
    textures.buildBytes = buffer.byteLength;
    // The parsed float data stays reachable only when asked for: it is 8.4 MB of
    // JS heap per body and nothing in the render path reads it.
    if (options.keepSource) {
        textures.sSource = parsed.s;
        textures.tSource = parsed.t;
        textures.eSource = parsed.e;
    }
    atmTableCache.set(body, textures);
    return textures;
}

function atmTableStats() {
    return Array.from(atmTableCache.keys());
}

globalThis.ATM_LAYOUT = ATM_LAYOUT;
globalThis.ATM_TABLE_BYTES = ATM_TABLE_BYTES;
globalThis.ATM_TABLE_BODIES = ATM_TABLE_BODIES;
globalThis.parseAtmTable = parseAtmTable;
globalThis.createAtmTableTextures = createAtmTableTextures;
globalThis.loadAtmTable = loadAtmTable;
globalThis.atmTableStats = atmTableStats;
globalThis.atmToHalfRGBA = atmToHalfRGBA;
globalThis.toHalf = toHalf;
