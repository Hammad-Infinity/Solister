// Baked Bruneton LUT storage.
// The tables depend only on a body's physical parameters, so they are shipped
// as small binaries instead of generated on the GPU at first load.
//   assets/atmosphere/manifest.json  { version, tables: { earth: "earth.bin" } }
//   assets/atmosphere/<body>.bin     header, then transmittance, irradiance,
//                                    inscatter as float32
// Tables are matched by parameter signature, so a stale bake is never used and
// buildBrunetonLuts() falls back to GPU generation for anything missing.
// File layout, little endian: "SLAT", u16 version, u16 reserved, u32 signature
// length, u32 reserved, signature, then three (u32 count, float32[] ) blocks.
const BAKED_ATMOSPHERE_VERSION = 1;
const BAKED_ATMOSPHERE_MAGIC = 0x534c4154; // "SLAT" little endian
const BAKED_ATMOSPHERE_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const bakedAtmosphereTables = new Map();
let bakedAtmospherePromise = null;

function atmosphereSignatureOf(params) {
    if (typeof globalThis.brunetonSignature === "function") {
        return globalThis.brunetonSignature(params);
    }
    return null;
}

function parseBakedTable(buffer, expectedSignature) {
    const view = new DataView(buffer);
    if (view.byteLength < 16) return null;
    if (view.getUint32(0, true) !== BAKED_ATMOSPHERE_MAGIC) return null;
    if (view.getUint16(4, true) !== BAKED_ATMOSPHERE_VERSION) return null;
    const signatureLength = view.getUint32(8, true);
    if (!(signatureLength > 0) || 16 + signatureLength > buffer.byteLength) return null;
    const signature = new TextDecoder().decode(new Uint8Array(buffer, 16, signatureLength));
    if (expectedSignature && signature !== expectedSignature) return null;
    const layout = globalThis.BRUNETON_LAYOUT;
    if (!layout) return null;
    let offset = 16 + signatureLength;
    const readBlock = (expectedCount) => {
        if (offset + 4 > buffer.byteLength) throw new Error("truncated baked table");
        const count = view.getUint32(offset, true);
        offset += 4;
        if (count !== expectedCount) throw new Error(`baked table size mismatch: ${count} != ${expectedCount}`);
        if (offset + count * 4 > buffer.byteLength) throw new Error("truncated baked table payload");
        const byteCount = count * 4;
        const dataOffset = offset;
        offset += byteCount;

        // The signature is variable-length, so block data is not necessarily
        // four-byte aligned. Use a view only when alignment and byte order
        // permit it; otherwise copy the bytes into aligned native-order storage.
        if (BAKED_ATMOSPHERE_LITTLE_ENDIAN && dataOffset % 4 === 0) {
            return new Float32Array(buffer, dataOffset, count);
        }
        const source = new Uint8Array(buffer, dataOffset, byteCount);
        const aligned = new Uint8Array(byteCount);
        if (BAKED_ATMOSPHERE_LITTLE_ENDIAN) {
            aligned.set(source);
        } else {
            for (let i = 0; i < byteCount; i += 4) {
                aligned[i] = source[i + 3];
                aligned[i + 1] = source[i + 2];
                aligned[i + 2] = source[i + 1];
                aligned[i + 3] = source[i];
            }
        }
        return new Float32Array(aligned.buffer);
    };
    const transCount = layout.TRANS_W * layout.TRANS_H * 4;
    const skyCount = layout.SKY_W * layout.SKY_H * 4;
    const atlasCount = layout.ATLAS_W * layout.ATLAS_H * 4;
    return {
        signature: signature,
        transmittance: readBlock(transCount),
        irradiance: readBlock(skyCount),
        inscatter: readBlock(atlasCount)
    };
}

// Store a table set produced by the GPU generator (see tools/bake-atmosphere.mjs).
function putBakedAtmosphereTables(signature, tables) {
    if (!signature || !tables) return;
    bakedAtmosphereTables.set(signature, tables);
}

// Consume-once accessor used by createPlanetAtmosphere.
function takeBakedAtmosphereTables(params) {
    const signature = atmosphereSignatureOf(params);
    if (!signature) return null;
    const tables = bakedAtmosphereTables.get(signature);
    if (!tables) return null;
    bakedAtmosphereTables.delete(signature);
    return tables;
}

async function preloadBakedAtmosphereTables(baseUrl = "assets/atmosphere/") {
    if (bakedAtmospherePromise) return bakedAtmospherePromise;
    bakedAtmospherePromise = (async () => {
        let manifest;
        try {
            const response = await fetch(baseUrl + "manifest.json", { cache: "force-cache" });
            if (!response.ok) return { loaded: 0, total: 0, reason: "no manifest" };
            manifest = await response.json();
        } catch (error) {
            // Offline, file:// or a build without baked tables: the GPU path
            // handles everything, so this is not an error condition.
            return { loaded: 0, total: 0, reason: "manifest unavailable" };
        }
        if (!manifest || manifest.version !== BAKED_ATMOSPHERE_VERSION) {
            return { loaded: 0, total: 0, reason: "version mismatch" };
        }
        const entries = Object.entries(manifest.tables || {});
        let loaded = 0;
        await Promise.all(entries.map(async ([key, file]) => {
            try {
                const response = await fetch(baseUrl + file, { cache: "force-cache" });
                if (!response.ok) return;
                const buffer = await response.arrayBuffer();
                const parsed = parseBakedTable(buffer, null);
                if (!parsed) return;
                bakedAtmosphereTables.set(parsed.signature, parsed);
                loaded++;
            } catch {}
        }));
        return { loaded: loaded, total: entries.length };
    })();
    return bakedAtmospherePromise;
}

function bakedAtmosphereStats() {
    return { count: bakedAtmosphereTables.size, signatures: [ ...bakedAtmosphereTables.keys() ] };
}

globalThis.putBakedAtmosphereTables = putBakedAtmosphereTables;
globalThis.takeBakedAtmosphereTables = takeBakedAtmosphereTables;
globalThis.preloadBakedAtmosphereTables = preloadBakedAtmosphereTables;
globalThis.bakedAtmosphereStats = bakedAtmosphereStats;
globalThis.parseBakedTable = parseBakedTable;
globalThis.BAKED_ATMOSPHERE_MAGIC = BAKED_ATMOSPHERE_MAGIC;
globalThis.BAKED_ATMOSPHERE_VERSION = BAKED_ATMOSPHERE_VERSION;
