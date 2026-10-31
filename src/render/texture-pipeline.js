const SOLISTER_BUILD = "r150";
    globalThis.__SOLISTER_BUILD_TAG = SOLISTER_BUILD;

globalThis.__solisterBuild = SOLISTER_BUILD;

const TEXTURE_PROBES = globalThis.__solisterTextureProbes || (globalThis.__solisterTextureProbes = new Map);

const KTX2_MAGIC = Object.freeze([ 0xAB, 0x4B, 0x54, 0x58, 0x32, 0x20, 0xBB, 0x0A, 0x1A, 0x0A ]);

function describeTextureBytes(bytes) {
    const head = Array.from(bytes.subarray(0, 16));
    const hex = head.map(c => c.toString(16).padStart(2, "0")).join(" ");
    if (head.length >= 10 && KTX2_MAGIC.every((m, i) => head[i] === m)) return "ktx2 header ok";
    const text = String.fromCharCode(...head).replace(/[^\x20-\x7e]/g, ".");
    if (text.startsWith("version https://git-lfs")) return "GIT-LFS POINTER FILE, not the texture";
    if (text.startsWith("version ")) return "GIT-LFS POINTER FILE, not the texture";
    if (head[0] === 0x89 && text.slice(1, 4) === "PNG") return "PNG file named .ktx2";
    if (head[0] === 0xFF && head[1] === 0xD8) return "JPEG file named .ktx2";
    if (text.startsWith("<!") || text.startsWith("<html")) return "HTML page (server error), not a texture";
    return "unrecognised: \"" + text.slice(0, 12) + "\" / " + hex;
}

function probeTextureUrl(url) {
    if (!url || TEXTURE_PROBES.has(url) || typeof fetch !== "function") return;
    TEXTURE_PROBES.set(url, { status: "probing" });
    fetch(url, { cache: "no-store" }).then(response => response.arrayBuffer().then(buffer => {
        const bytes = new Uint8Array(buffer);
        const magic = bytes.byteLength ? describeTextureBytes(bytes) : "EMPTY FILE (0 bytes)";
        const verdict = {
            status: response.status,
            bytes: bytes.byteLength,
            magic: magic,
            ok: response.ok && bytes.byteLength >= 1024 && magic === "ktx2 header ok"
        };
        TEXTURE_PROBES.set(url, verdict);
        if (!verdict.ok) {
            console.warn("[Solister textures] " + url + " \u2192 HTTP " + verdict.status + ", " + verdict.bytes + " bytes: " + magic);
            recordTextureRuntimeIssue("texture-file-probe", {
                url: url,
                httpStatus: verdict.status,
                bytes: verdict.bytes,
                verdict: magic
            });
        }
    })).catch(error => {
        TEXTURE_PROBES.set(url, {
            status: "fetch-error",
            bytes: 0,
            magic: String(error?.message || error),
            ok: false
        });
    });
}

function recordTextureRuntimeIssue(type, detail = {}) {
    try {
        const item = {
            time: Date.now(),
            type: type,
            ...detail,
            message: String(detail.message || detail.error?.message || detail.error || "")
        };
        const list = globalThis.__solisterTextureErrors || (globalThis.__solisterTextureErrors = []);
        list.push(item);
        if (list.length > 120) list.splice(0, list.length - 120);
        if (globalThis.dispatchEvent && globalThis.CustomEvent) globalThis.dispatchEvent(new globalThis.CustomEvent("solister-texture-error", {
            detail: item
        }));
        if (typeof type === "string" && type !== "texture-file-probe" && /unavailable|load-failed|loader-unavailable|request-failed/.test(type)) {
            try {
                if (detail.url) {
                    for (const part of String(detail.url).split(/,\s*/)) probeTextureUrl(part.trim());
                } else if (detail.file) {
                    const res = detail.resolution || detail.preferredResolution || (Array.isArray(detail.candidates) ? detail.candidates[0] : null);
                    if (res) probeTextureUrl(textureAssetUrl(res, detail.file));
                    if (Array.isArray(detail.candidates)) for (const candidate of detail.candidates.slice(0, 3)) probeTextureUrl(textureAssetUrl(candidate, detail.file));
                }
            } catch (e) {}
        }
        scheduleTextureIssueSummary();
    } catch (e) {}
}

let _textureIssueSummaryTimer = 0;

function scheduleTextureIssueSummary() {
    if (_textureIssueSummaryTimer) return;
    _textureIssueSummaryTimer = setTimeout(() => {
        _textureIssueSummaryTimer = 0;
        try {
            const list = globalThis.__solisterTextureErrors || [];
            if (!list.length) return;
            const bodies = new Map;
            const urls = new Set;
            const manifestMisses = new Map;
            for (const item of list) {
                if (item.type === "texture-color-unavailable") {
                    const set = bodies.get(item.key) || new Set;
                    set.add(item.resolution);
                    bodies.set(item.key, set);
                } else if (item.type === "texture-color-not-in-manifest") {
                    const id = item.key + "@" + item.resolution;
                    if (!manifestMisses.has(id)) manifestMisses.set(id, item);
                } else if (item.url) urls.add(item.url);
            }
            if (bodies.size) {
                console.warn("[Solister textures] No supplied map could be loaded for " + bodies.size + " bod" + (bodies.size === 1 ? "y" : "ies") + ": " + [ ...bodies ].map(([key, set]) => key + " (" + [ ...set ].join(", ") + ")").join("; ") + ". " + "These keep their procedural fallback texture. The loader requests ./assets/textures/<res>/<file>.ktx2 and only falls back after that request fails, so a body listed here means the file is missing from that folder (or failed to decode). Full list: window.__solisterTextureErrors");
            }
            if (manifestMisses.size) {
                for (const item of manifestMisses.values()) {
                    console.warn("[Solister textures] " + item.key + ": no colour map for it in assets/textures/" + item.resolution + "/maps.json. " + item.message);
                }
            }
            if (urls.size) console.warn("[Solister textures] " + urls.size + " asset request(s) failed: " + [ ...urls ].slice(0, 12).join(", ") + (urls.size > 12 ? ", …" : ""));
        } catch (e) {}
    }, 4e3);
}

const TEXTURE_LOD_ORDER = [ "2k", "4k", "8k" ];

const TEXTURE_LOD_RANK = {
    "2k": 0,
    "4k": 1,
    "8k": 2
};

const TEXTURE_COLOR_FILES = {
    earth: "earth_day"
};

const TEXTURE_LOD_BODY_KEYS = [ "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "moon", "pluto", "charon", "phobos", "deimos", "io", "europa", "ganymede", "callisto", "himalia", "mimas", "enceladus", "tethys", "dione", "rhea", "titan", "hyperion", "iapetus", "phoebe", "miranda", "ariel", "umbriel", "titania", "oberon", "triton", "nereid", "ceres", "vesta" ];

const TEXTURE_AUX_FILES = [ {
    name: "earth_night",
    target: "earthNight",
    max: "8k"
}, {
    // The ocean mask is a coastline, not a photograph: at 2k it is already
    // 0.18 degrees per texel. Asking for the 8k copy cost another full-size
    // texture on the GPU for no visible gain, and on a card that is also holding
    // earth_day at 8k that is the texture that tips the context over.
    name: "earth_specular",
    target: "earthSpecular",
    max: "2k"
}, {
    name: "saturn_ring",
    target: "saturn-ring",
    max: "4k"
} ];

const TEXTURE_EAGER_BASE_KEYS = new Set([ "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "moon" ]);

const _textureLodWorld = new THREE.Vector3;

function stabilizeVenusMaterial(mat) {
    if (!mat) return;

    const brdfManaged = typeof isSurfaceBrdfManaged === "function" && isSurfaceBrdfManaged(mat);
    const changed = mat.roughnessMap !== null || mat.specularMap !== null
        || mat.metalness !== 0
        || (!brdfManaged && mat.roughness !== 1);
    mat.roughnessMap = null;
    mat.specularMap = null;
    mat.metalness = 0;
    if (!brdfManaged) mat.roughness = 1;
    if (changed) mat.needsUpdate = true;
}

function trackTexture(key, tex) {
    const old = loadedTextures.get(key);
    if (old && old !== tex) old.dispose();
    loadedTextures.set(key, tex);
    return tex;
}

function applyTextureToObject(key, texture) {
    try {
        const obj = objectRegistry[key];
        if (!obj) {
            recordTextureRuntimeIssue("texture-apply-missing-object", {
                key: key
            });
            return false;
        }
        if (!texture) {
            recordTextureRuntimeIssue("texture-apply-missing-texture", {
                key: key
            });
            return false;
        }
        if (key === "venus") stabilizeVenusMaterial(obj.material);
        if (key === "saturn-ring" && obj.ringMesh) {
            if (!obj.ringMesh.material) {
                recordTextureRuntimeIssue("texture-apply-missing-material", {
                    key: key
                });
                return false;
            }
            obj.ringMesh.material.map = texture;
            obj.ringMesh.material.needsUpdate = true;
            return true;
        }
        if (!obj.material) {
            recordTextureRuntimeIssue("texture-apply-missing-material", {
                key: key
            });
            return false;
        }
        const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        if (!mat) {
            recordTextureRuntimeIssue("texture-apply-missing-material", {
                key: key
            });
            return false;
        }
        // Same reason as procedural-textures.js: a body map is seen at grazing
        // angles from the ground, and anisotropy 1 bands it into rings.
        let maxAniso = 1;
        try { maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 1; } catch (e) {}
        texture.anisotropy = Math.max(texture.anisotropy || 1, Math.min(16, maxAniso));
        mat.map = texture;
        mat.needsUpdate = true;
        if (key === "earth") syncEarthSurfaceMaps(mat, texture);
        return true;
    } catch (error) {
        recordTextureRuntimeIssue("texture-apply-failed", {
            key: key,
            error: error
        });
        return false;
    }
}

function textureLodFileFor(key) {
    return TEXTURE_COLOR_FILES[key] || key;
}

function textureLodState(key) {
    let state = focusLod.states.get(key);
    if (!state) {
        state = {
            colorRes: null,
            colorSlot: null,
            loadingColorRes: null,
            colorFailedRes: null,
            colorRetryAt: 0,
            colorRetryMs: 0,
            releaseAt: 0,
            detailActive: false,
            detailReleaseAt: 0,
            detailLoading: false
        };
        focusLod.states.set(key, state);
    }
    return state;
}

const TEXTURE_LOD_RETRY_MIN_MS = 5e3;

const TEXTURE_LOD_RETRY_MAX_MS = 18e5;

function noteBodyColorTextureFailure(state, res) {
    state.colorResIsFallbackUp = false;
    state.colorRetryMs = state.colorFailedRes === res ? Math.min(state.colorRetryMs * 4, TEXTURE_LOD_RETRY_MAX_MS) : TEXTURE_LOD_RETRY_MIN_MS;
    state.colorFailedRes = res;
    state.colorRetryAt = performance.now() + state.colorRetryMs;
}

function clearBodyColorTextureFailure(state) {
    state.colorFailedRes = null;
    state.colorRetryAt = 0;
    state.colorRetryMs = 0;
}

function textureLodMaxRes() {
    return bestSupportedTextureResolution(textureResolution || "2k");
}

function textureLodClamp(res, maxRes) {
    const maxRank = TEXTURE_LOD_RANK[maxRes] ?? 0;
    const wantedRank = TEXTURE_LOD_RANK[res] ?? 0;
    return TEXTURE_LOD_ORDER[Math.min(wantedRank, maxRank)] || "2k";
}

function textureLodFocusedKey() {
    const key = focusedObject?.userData?.planetKey;
    return key && TEXTURE_LOD_BODY_KEYS.includes(key) ? key : null;
}

function textureLodTargetRes(key, obj) {
    const maxRes = textureLodMaxRes();
    if ((TEXTURE_LOD_RANK[maxRes] ?? 0) <= 0) return "2k";
    if (textureLodFocusedKey() === key) return maxRes;
    if (!obj || obj.visible === false) return "2k";
    obj.getWorldPosition(_textureLodWorld);
    const radius = Math.max(obj.userData?.focusRadius || obj.geometry?.parameters?.radius || 1, 1e-6);
    const distance = camera.position.distanceTo(_textureLodWorld);
    const ratio = Math.max(0, distance - radius) / radius;
    // Dead band, not a single threshold. A body sitting at exactly one cutoff
    // asked for 4k on one tick and 2k on the next, so its map was evicted and
    // fetched again on alternate ticks: the texture popped in and out and every
    // swap cost a download plus an upload. A body already carrying more than the
    // base resolution keeps it until it is clearly further away.
    const state = textureLodState(key);
    const holding = (TEXTURE_LOD_RANK[state.colorRes] ?? 0) > (TEXTURE_LOD_RANK["2k"] ?? 0);
    return ratio <= (holding ? 120 : 95) ? textureLodClamp("4k", maxRes) : "2k";
}

function textureLodSlot(key, kind, res) {
    return "lod:" + key + ":" + kind + ":" + res;
}

function textureLodMaterial(key) {
    const obj = objectRegistry[key];
    if (!obj || !obj.material) return null;
    return Array.isArray(obj.material) ? obj.material[0] : obj.material;
}

function releaseTextureLodSlot(slot, key) {
    const texture = loadedTextures.get(slot);
    if (!texture) return;
    const mat = textureLodMaterial(key);
    if (mat) {
        for (const field of [ "map" ]) {
            if (mat[field] === texture) return;
        }
    }
    loadedTextures.delete(slot);
    texture.dispose();
}

function configureEarthKtx2Texture(texture) {
    if (!texture) return;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, -1);
    texture.offset.set(.25, 1);
    texture.matrixAutoUpdate = true;
    texture.updateMatrix();
    texture.needsUpdate = true;
}

// The ocean mask is the one texture that must share the day map's frame. The
// day map is rotated a quarter turn and mirrored to line up with the body's own
// UVs; a mask left at its default transform therefore glints a quarter turn and
// a hemisphere away from the sea it is meant to describe. Every mask, procedural
// or supplied, is stamped with the day map's transform here.
function syncEarthSurfaceMaps(mat, dayTexture) {
    if (!mat || !dayTexture) return;
    const mask = mat.userData?.earthSpecularMap || mat.userData?.earthWaterMask;
    if (!mask || mask === dayTexture) return;
    mask.wrapS = dayTexture.wrapS;
    mask.wrapT = dayTexture.wrapT;
    mask.repeat.copy(dayTexture.repeat);
    mask.offset.copy(dayTexture.offset);
    mask.rotation = dayTexture.rotation;
    mask.matrixAutoUpdate = true;
    mask.updateMatrix();
    mask.needsUpdate = true;
}

// White water, black land, fed in on the channel this build already uses: the
// roughness map. three multiplies the roughness factor by the map, so a water
// texel of 0.08 gives a mirror and a land texel of 1.0 gives nothing. The
// supplied map is inverted once, at 2k, rather than trusted to be already
// inverted: earth_specular.ktx2 is white where there is water.
function earthSpecularToRoughness(texture) {
    const src = texture?.image;
    if (!src) return null;
    const width = 2048, height = 1024;
    const cv = document.createElement("canvas");
    cv.width = width; cv.height = height;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    try { ctx.drawImage(src, 0, 0, width, height); } catch (e) { return null; }
    const img = ctx.getImageData(0, 0, width, height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        // Specular strength to roughness, linear and matched to the procedural
        // mask: water 0.13, land 1.0.
        const water = d[i] / 255;
        const v = Math.round(33 + 222 * (1 - water));
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const out = new THREE.CanvasTexture(cv);
    out.colorSpace = THREE.NoColorSpace;
    out.wrapS = THREE.RepeatWrapping;
    out.wrapT = THREE.ClampToEdgeWrapping;
    out.needsUpdate = true;
    return out;
}

function applyEarthSpecularTexture(texture) {
    const mat = objectRegistry.earth?.material;
    if (!texture || !mat || Array.isArray(mat)) return false;
    const rough = earthSpecularToRoughness(texture);
    if (!rough) return false;
    if (mat.map) syncEarthSurfaceMaps({ userData: { earthSpecularMap: rough } }, mat.map);
    else configureEarthKtx2Texture(rough);
    try { rough.anisotropy = Math.max(rough.anisotropy || 1, Math.min(16, renderer.capabilities.getMaxAnisotropy())); } catch (e) {}
    mat.userData = mat.userData || {};
    mat.userData.earthSpecularMap = rough;
    mat.roughnessMap = rough;
    mat.roughness = 1;
    mat.needsUpdate = true;
    return true;
}

function configureEarthNightKtx2Texture(texture) {
    if (!texture) return;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1);
    texture.offset.set(.25, 0);
    texture.matrixAutoUpdate = true;
    texture.updateMatrix();
    texture.needsUpdate = true;
}

function applyBodyColorTexture(key, res, texture) {
    try {
        if (key === "earth") configureEarthKtx2Texture(texture);
        const mat = textureLodMaterial(key);
        if (!mat) {
            if (typeof recordTextureRuntimeIssue === "function") recordTextureRuntimeIssue("texture-lod-apply-missing-material", {
                key: key,
                resolution: res
            });
            return false;
        }
        if (!texture) {
            if (typeof recordTextureRuntimeIssue === "function") recordTextureRuntimeIssue("texture-lod-apply-missing-texture", {
                key: key,
                resolution: res
            });
            return false;
        }
        if (key === "venus") stabilizeVenusMaterial(mat);
        if (mat.map !== texture) {
            mat.map = texture;
            mat.needsUpdate = true;
        }
        if (key === "earth") {
            syncEarthSurfaceMaps(mat, texture);
            // A day map from disk draws continents the procedural mask has never
            // seen. Without a supplied specular map the honest answer is no glint,
            // not glint on the wrong ocean.
            if (texture.userData?.surfaceResolution && mat.roughnessMap === mat.userData?.earthWaterMask && !mat.userData?.earthSpecularMap) {
                mat.roughnessMap = null;
                mat.roughness = .95;
                mat.needsUpdate = true;
            }
        }
        const state = textureLodState(key);
        state.colorRes = res;
        state.colorSlot = textureLodSlot(key, "color", res);
        state.loadingColorRes = null;
        if (state.colorFailedRes === res) clearBodyColorTextureFailure(state);
        return true;
    } catch (error) {
        try {
            if (typeof recordTextureRuntimeIssue === "function") recordTextureRuntimeIssue("texture-lod-apply-failed", {
                key: key,
                resolution: res,
                error: error
            });
        } catch (e) {}
        const state = textureLodState(key);
        state.loadingColorRes = null;
        return false;
    }
}

function bodyColorFallbackChain(key, res) {
    const rank = TEXTURE_LOD_ORDER.indexOf(res);
    if (rank < 0) return [ "8k", "4k", "2k" ];

    const chain = [];
    for (let i = rank; i >= 0; i--) chain.push(TEXTURE_LOD_ORDER[i]);
    if (rank + 1 < TEXTURE_LOD_ORDER.length) chain.push(TEXTURE_LOD_ORDER[rank + 1]);
    return chain;
}

function textureManifestHas(set, file) {
    if (!set) return false;
    let found = false;
    set.forEach(entry => {
        if (found) return;
        const name = String(entry).split("/").pop();
        const stem = name.replace(/\.[^.]*$/, "");
        if (stem === file) found = true;
    });
    return found;
}

function ensureBodyColorTexture(key, res) {
    const obj = objectRegistry[key];
    if (!obj) return;
    const file = textureLodFileFor(key);
    const state = textureLodState(key);
    const exactSlot = textureLodSlot(key, "color", res);
    const exactCached = loadedTextures.get(exactSlot);
    if (exactCached?.image) {
        state.loadingColorVersion = (state.loadingColorVersion || 0) + 1;
        applyBodyColorTexture(key, res, exactCached);
        return;
    }
    if (state.loadingColorRes === res) return;
    if (state.colorFailedRes === res && performance.now() < state.colorRetryAt) return;
    const avail = mapManifests.has("8k") || mapManifests.has("4k");
    if (avail) {
        let capped = res;
        for (let r = TEXTURE_LOD_ORDER.indexOf(res); r > 0; r--) {
            const setR = mapManifests.get(TEXTURE_LOD_ORDER[r]);
            if (setR && textureManifestHas(setR, file)) {
                capped = TEXTURE_LOD_ORDER[r];
                break;
            }
            if (r === 1) capped = "2k";
        }
        res = capped;
        if (state.loadingColorRes === res) return;
    }
    state.loadingColorRes = res;
    const generation = focusLod.generation, requestVersion = state.loadingColorVersion = (state.loadingColorVersion || 0) + 1;
    const isCurrent = () => focusLod.generation === generation && state.loadingColorVersion === requestVersion;
    const chain = bodyColorFallbackChain(key, res);
    let index = 0;
    const tryNext = () => {
        if (!isCurrent() || state.loadingColorRes !== res) return;
        if (index >= chain.length) {
            if (state.loadingColorRes === res) state.loadingColorRes = null;
            noteBodyColorTextureFailure(state, res);
            try {
                if (typeof recordTextureRuntimeIssue === "function") recordTextureRuntimeIssue("texture-color-unavailable", {
                    key: key,
                    resolution: res,
                    file: file
                });
            } catch (e) {}
            return;
        }
        const loadRes = chain[index++];
        const slot = textureLodSlot(key, "color", loadRes);
        const cached = loadedTextures.get(slot);
        if (cached?.image) {
            if (!state.colorRes || (TEXTURE_LOD_RANK[loadRes] ?? 0) >= (TEXTURE_LOD_RANK[state.colorRes] ?? 0)) {
                applyBodyColorTexture(key, loadRes, cached);
                state.colorResIsFallbackUp = (TEXTURE_LOD_RANK[loadRes] ?? 0) > (TEXTURE_LOD_RANK[res] ?? 0);
            }
            if (loadRes === res) {
                state.loadingColorRes = null;
                return;
            }
            tryNext();
            return;
        }
        mapManifest(loadRes, set => {
            if (!isCurrent() || state.loadingColorRes !== res) return;
            const resolvedFile = resolveMapFileName(set, file);
            if (set && !resolvedFile) {
                const listed = [];
                set.forEach(entry => {
                    if (listed.length < 40) listed.push(String(entry));
                });
                recordTextureRuntimeIssue("texture-color-not-in-manifest", {
                    key: key,
                    resolution: loadRes,
                    file: file,
                    message: "maps.json for " + loadRes + " does not list it (lists: " + (listed.join(", ") || "(empty)") + "); requesting " + file + " anyway"
                });
            }
            const loader = textureRequests.batch("lod-color-" + key + "-" + res + "-" + loadRes);
            const url = textureAssetUrl(loadRes, resolvedFile || file);
            trackLoadStart();
            loader.load(url, texture => {
                try {
                    if (!isCurrent()) {
                        texture.dispose();
                        return;
                    }
                    texture.wrapS = THREE.RepeatWrapping;
                    texture.wrapT = THREE.ClampToEdgeWrapping;
                    texture.colorSpace = THREE.SRGBColorSpace;
                    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
                    texture.needsUpdate = true;
                    texture.userData.surfaceResolution = loadRes;
                    trackTexture(slot, texture);
                    applyBodyColorTexture(key, loadRes, texture);
                    state.colorResIsFallbackUp = (TEXTURE_LOD_RANK[loadRes] ?? 0) > (TEXTURE_LOD_RANK[res] ?? 0);
                    if (loadRes !== res) tryNext();
                } catch (error) {
                    try {
                        if (typeof recordTextureRuntimeIssue === "function") recordTextureRuntimeIssue("texture-color-apply-failed", {
                            key: key,
                            resolution: loadRes,
                            url: url,
                            error: error
                        });
                    } catch (e) {}
                    try {
                        texture.dispose();
                    } catch (e) {}
                    tryNext();
                } finally {
                    if (state.loadingColorRes === res && (loadRes === res || index >= chain.length || !isCurrent())) state.loadingColorRes = null;
                    trackLoadEnd();
                }
            }, undefined, () => {
                trackLoadEnd();
                tryNext();
            }, () => {
                trackLoadEnd();
                if (isCurrent() && state.loadingColorRes === res) state.loadingColorRes = null;
            });
        });
    };
    tryNext();
}

const IMAGE_FILE_EXTENSION = /\.(ktx2|png|jpe?g|webp|basis)$/i;

function textureAssetUrl(res, file) {
    const name = String(file);
    return "./assets/textures/" + res + "/" + name + (IMAGE_FILE_EXTENSION.test(name) ? "" : ".ktx2");
}

const MAP_FILE_SUFFIXES = Object.freeze([ "", "_day", "_color", "_colour", "_map", "_albedo", "_diffuse", "_basecolor", "_base_color", "_rgb", "_surface" ]);

const NON_COLOR_SUFFIXES = Object.freeze([ "normal", "norm", "bump", "height", "displacement", "displace", "rough", "roughness", "metal", "metalness", "spec", "specular", "ao", "occlusion", "alpha", "mask", "cloud", "clouds", "night", "lights", "ring", "rings", "emissive", "water", "ice", "topo", "relief" ]);

function resolveMapFileName(manifest, baseName) {
    const wanted = String(baseName ?? "");
    if (!manifest || typeof manifest.forEach !== "function") return wanted;
    const entries = [];
    manifest.forEach(entry => {
        const name = String(entry ?? "").trim();
        if (name) entries.push(name);
    });
    if (!entries.length) return wanted;
    const stemOf = entry => entry.replace(IMAGE_FILE_EXTENSION, "").toLowerCase();
    const byStem = new Map;
    for (const entry of entries) {
        const stem = stemOf(entry);
        if (!byStem.has(stem)) byStem.set(stem, entry);
    }
    const lower = wanted.toLowerCase();

    const aliases = [ lower ];
    for (const suffix of MAP_FILE_SUFFIXES) {
        if (suffix) aliases.push(lower + suffix);
    }
    for (const alias of aliases) {
        const hit = byStem.get(alias);
        if (hit) return hit;
    }
    for (const alias of aliases) {
        for (const [stem, entry] of byStem) {
            if (stem === alias) return entry;
            if (stem.endsWith("_" + alias) || stem.endsWith("-" + alias)) return entry;
        }
    }

    const prefix = lower + "_";
    for (const [stem, entry] of byStem) {
        if (!stem.startsWith(prefix)) continue;
        const tail = stem.slice(prefix.length);
        if (NON_COLOR_SUFFIXES.includes(tail)) continue;
        if (tail.split(/[_-]/).some(part => NON_COLOR_SUFFIXES.includes(part))) continue;
        return entry;
    }
    return null;
}

function cleanupBodyColorTextures(key, targetRes, now) {
    const state = textureLodState(key);
    if (!state.releaseAt || now < state.releaseAt) return;
    const targetRank = TEXTURE_LOD_RANK[targetRes] ?? 0;
    for (const res of TEXTURE_LOD_ORDER) {
        if ((TEXTURE_LOD_RANK[res] ?? 0) <= targetRank) continue;
        releaseTextureLodSlot(textureLodSlot(key, "color", res), key);
    }
    state.releaseAt = 0;
}

function textureLodReset() {
    focusLod.generation++;
    textureResetGeneration++;
    textureResetLoader = textureRequests.batch("lod-reset-" + textureResetGeneration);
    focusLod.tickAt = 0;
    for (const res of TEXTURE_LOD_ORDER) mapManifest(res, () => {});
    for (const key of TEXTURE_LOD_BODY_KEYS) {
        const state = textureLodState(key);
        state.loadingColorRes = null;
        clearBodyColorTextureFailure(state);
        state.releaseAt = performance.now() + 10;
    }
}

function textureLodShouldRequest(key, obj, targetRes) {
    if (textureLodFocusedKey() === key) return true;
    if (TEXTURE_EAGER_BASE_KEYS.has(key)) return true;
    if ((TEXTURE_LOD_RANK[targetRes] ?? 0) > 0) return true;
    if (!obj || obj.visible === false) return false;
    obj.getWorldPosition(_textureLodWorld);
    const radius = Math.max(obj.userData?.focusRadius || obj.geometry?.parameters?.radius || 1, 1e-6);
    const distance = Math.max(radius, camera.position.distanceTo(_textureLodWorld));
    const viewport = Math.max(1, window.innerHeight || renderer.domElement?.height || 900);
    const pixels = radius * camera.projectionMatrix.elements[5] * viewport / (2 * distance);
    return pixels >= 10;
}

function focusLodTick() {
    const now = performance.now();
    if (now < focusLod.tickAt) return;
    focusLod.tickAt = now + focusLod.tickMs;
    for (const res of TEXTURE_LOD_ORDER) mapManifest(res, () => {});
    for (const key of TEXTURE_LOD_BODY_KEYS) {
        const obj = objectRegistry[key];
        if (!obj) continue;
        const targetRes = textureLodTargetRes(key, obj);
        const state = textureLodState(key);
        if (textureLodShouldRequest(key, obj, targetRes)) ensureBodyColorTexture(key, targetRes);
        if (state.colorRes && !state.colorResIsFallbackUp && (TEXTURE_LOD_RANK[state.colorRes] ?? 0) > (TEXTURE_LOD_RANK[targetRes] ?? 0)) {
            state.releaseAt = now + focusLod.releaseMs;
        }
        cleanupBodyColorTextures(key, targetRes, now);
    }
}

const EARTH_CLOUD_FLASH_SLOTS = 12;

function createEarthCloudNightGlowMaterial(map) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uCloudTexture: {
                value: map
            },
            uCloudTextureMatrix: {
                value: map?.matrix?.clone?.() || new THREE.Matrix3
            },
            uSunDirection: {
                value: new THREE.Vector3(1, 0, 0)
            },
            uOpacity: {
                value: 1
            },
            uCloudUseAlpha: {
                value: map?.userData?.cloudMaskChannel === "alpha" ? 1 : 0
            },
            uInsideShell: {
                value: 0
            },
            uNightTexture: {
                value: null
            },
            uNightTextureMatrix: {
                value: new THREE.Matrix3
            },
            uHasNightTexture: {
                value: 0
            },
            uLightningFlash: {
                value: new Float32Array(EARTH_CLOUD_FLASH_SLOTS * 4)
            },
            uLightningFlashCount: {
                value: 0
            },
            uFlashSigma: {
                value: 1.6e-3
            }
        },
        vertexShader: `\n            ${globalThis.LDB_VERTEX_PARS || ""}\n            varying vec2 vUv;\n            varying vec3 vNormal;\n            varying vec3 vLocalNormal;\n            void main() {\n                vUv = uv;\n                vNormal = normalize(mat3(modelMatrix) * normal);\n                // Object-space normal: the strike directions PlanetWeather packs are
                // in Earth object space, so the pool test has to be done there, not
                // against the rotating world normal.\n                vLocalNormal = normalize(normal);\n                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n                ${globalThis.LDB_VERTEX_TAIL || ""}\n            }\n        `,
        fragmentShader: `\n            uniform sampler2D uCloudTexture;\n            uniform mat3 uCloudTextureMatrix;\n            uniform vec3 uSunDirection;\n            uniform float uOpacity;\n            uniform float uCloudUseAlpha;\n            uniform float uInsideShell;\n            uniform sampler2D uNightTexture;\n            uniform mat3 uNightTextureMatrix;\n            uniform float uHasNightTexture;\n            uniform vec4 uLightningFlash[${EARTH_CLOUD_FLASH_SLOTS}];\n            uniform int uLightningFlashCount;\n            uniform float uFlashSigma;\n            varying vec2 vUv;\n            varying vec3 vNormal;\n            varying vec3 vLocalNormal;\n            ${globalThis.LDB_FRAGMENT_PARS || ""}\n            void main() {\n                ${globalThis.LDB_FRAGMENT_HEAD || ""}\n                if ((uInsideShell < 0.5 && !gl_FrontFacing) || (uInsideShell >= 0.5 && gl_FrontFacing)) discard;\n                float sunMu = dot(normalize(vNormal), normalize(uSunDirection));\n                float night = 1.0 - smoothstep(-0.08, 0.16, sunMu);\n                vec2 cloudUv = (uCloudTextureMatrix * vec3(vUv, 1.0)).xy;\n                vec4 cloudSample = texture2D(uCloudTexture, cloudUv);\n                float rgbDensity = max(cloudSample.r, max(cloudSample.g, cloudSample.b));\n                float density = mix(rgbDensity, cloudSample.a, uCloudUseAlpha);\n                float cloudMask = smoothstep(0.38, 0.60, density);\n\n                // --- lightning: compact cloud-top pool, centre-to-edge falloff ---\n                // atan(|cross|, dot) rather than acos(dot): the pool is ~10 km wide,\n                // i.e. an angular radius of 1.6e-3 rad, and (1 - dot) only has about a\n                // dozen representable float32 steps at that scale, which would quantise\n                // the pool into a hard disc.\n                float flash = 0.0;\n                float flashHalo = 0.0;\n                vec3 localNormal = normalize(vLocalNormal);\n                float inverseSigmaSq = 1.0 / max(uFlashSigma * uFlashSigma, 1e-12);\n                // Bloom halo: a second Gaussian twelve times wider around every\n                // strike (~120 km on Earth). A real deck diffuses a flash over a\n                // few times the bolt footprint; the extra width stands in for\n                // the photographic bloom that made strikes read as glowing\n                // patches in the clouds instead of pinpoints from orbit.\n                float inverseHaloSigmaSq = 1.0 / max(uFlashSigma * uFlashSigma * 144.0, 1e-12);\n                // No break/continue: GLSL ES 1.00 appendix A restricts loop\n                // bodies, and a plain guarded block compiles everywhere.\n                for (int i = 0; i < ${EARTH_CLOUD_FLASH_SLOTS}; i++) {\n                    if (i < uLightningFlashCount) {\n                        vec4 packedFlash = uLightningFlash[i];\n                        if (packedFlash.w > 0.0) {\n                            vec3 flashDir = normalize(packedFlash.xyz);\n                            float angle = atan(length(cross(localNormal, flashDir)), dot(localNormal, flashDir));\n                            flash += packedFlash.w * exp(-angle * angle * inverseSigmaSq);\n                            flashHalo += packedFlash.w * exp(-angle * angle * inverseHaloSigmaSq);\n                        }\n                    }\n                }\n                // Strikes live in cloud decks, so the pool is gated by the same cloud\n                // mask the bolt ribbons use. Daylight attenuation is already folded\n                // into packedFlash.w on the CPU (event.visibility), which is why this\n                // is deliberately NOT gated on night.\n                flash = min(flash, 2.5) * cloudMask;\n                // The halo survives thin cloud: a flash diffusing through a deck\n                // lights it from inside, so the surround is gated more loosely\n                // than the pool itself.\n                flashHalo = min(flashHalo, 2.5) * mix(0.30, 1.0, cloudMask);\n\n                // --- night side of the cloud deck ---\n                float frostCoverage = 0.0;\n                float cityCoverage = 0.0;\n                if (uHasNightTexture > 0.5) {\n                    vec2 nightUv = (uNightTextureMatrix * vec3(vUv, 1.0)).xy;\n                    vec3 citySample = texture2D(uNightTexture, nightUv).rgb;\n                    float cityLevel = max(max(citySample.r, citySample.g), citySample.b);\n                    cityCoverage = smoothstep(0.02, 0.22, cityLevel) * cloudMask * night * uOpacity * 0.30;\n                }\n\n                // Contributions are accumulated premultiplied and then divided back\n                // out by the total coverage, so NormalBlending composites exactly\n                // contribution + background * (1 - coverage).\n                vec3 contribution =\n                    vec3(0.016, 0.020, 0.030) * frostCoverage\n                    + vec3(1.00, 0.72, 0.40) * cityCoverage\n                    + mix(vec3(0.95, 0.96, 1.00), vec3(0.74, 0.66, 1.00), 0.40) * (flash * 2.10 + flashHalo * 0.50);\n                float alpha = clamp(frostCoverage + cityCoverage + flash * 1.0 + flashHalo * 0.30, 0.0, 0.95);\n                if (alpha < 0.003) discard;\n                gl_FragColor = vec4(contribution / alpha, alpha);\n                #include <colorspace_fragment>\n            }\n        `,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        blending: THREE.NormalBlending,
        premultipliedAlpha: false,
        toneMapped: false,
        fog: false
    });
}

function setEarthCloudGlowNightTexture(texture) {
    const glow = objectRegistry.earth?.userData?.cloudGlowMesh;
    const uniforms = glow?.material?.uniforms;
    if (!uniforms?.uNightTexture) return;
    uniforms.uNightTexture.value = texture || null;
    uniforms.uNightTextureMatrix.value = texture?.matrix?.clone?.() || new THREE.Matrix3;
    uniforms.uHasNightTexture.value = texture ? 1 : 0;
}

// The deck is generated, never loaded. A supplied cloud map is a picture of one
// afternoon in 2004 with the terminator painted on it; the deck here has to obey
// the medium's own physics, so there is nothing to swap in at runtime.
// A land mask for the weather system, read from the map the planet is actually
// drawn with: storms are far more common over land (it heats faster and holds
// no reservoir of cold water) and tropical cyclones need open ocean. Reading the
// drawn surface rather than a separate dataset keeps the two in step -- a storm
// cannot come ashore on a continent that is not there.
function createLandSampler() {
    const image = objectRegistry.earth?.material?.map?.image;
    if (!image || !image.width) return () => 0;
    const MW = 256, MH = 128;
    const canvas = document.createElement("canvas");
    canvas.width = MW;
    canvas.height = MH;
    const context = canvas.getContext("2d");
    // The surface map is drawn with repeat.y = -1, offset.y = 1, so its rows run
    // the other way; flipping here puts the sampler in the same frame as the
    // geometry the storms are drawn into.
    context.translate(0, MH);
    context.scale(1, -1);
    context.drawImage(image, 0, 0, MW, MH);
    let pixels;
    try {
        pixels = context.getImageData(0, 0, MW, MH).data;
    } catch (e) {
        return () => 0;                      // a tainted canvas is not worth a crash
    }
    return (latDeg, lonDeg) => {
        let u = (lonDeg + 180) / 360 + 0.25;
        u = ((u % 1) + 1) % 1;
        const v = (90 - latDeg) / 180;
        const x = Math.min(MW - 1, Math.floor(u * MW));
        const y = Math.min(MH - 1, Math.max(0, Math.floor(v * MH)));
        const i = (y * MW + x) * 4;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        // Ocean is drawn blue: blue above both other channels. Ice is white and
        // counts as land; it is neither a source of storms nor open water.
        return (b > r * 1.12 && b > g * 1.05) ? 0 : 1;
    };
}

// The volumetric cloud shell: the three-layer atmosphere volume, marched through
// in the shader. Built from the same two inputs the flat deck uses (the coverage
// field and the weather system), so the two cannot disagree about where cloud is.
function ensureEarthCloudVolume() {
    const earth = objectRegistry.earth;
    if (!earth?.geometry?.parameters) return null;
    if (cloudVolumeMeshes.earth) return cloudVolumeMeshes.earth;
    const weather = worldWeatherField;
    const deck = cloudMeshes.earth?.material?.map;
    if (!weather || !deck?.image) return null;
    if (typeof createCloudVolume !== "function" || typeof createCloudShell !== "function") return null;

    let coverage = null;
    try {
        const image = deck.image;
        const context = document.createElement("canvas").getContext("2d");
        context.canvas.width = image.width;
        context.canvas.height = image.height;
        context.drawImage(image, 0, 0);
        coverage = context.getImageData(0, 0, image.width, image.height).data;
    } catch (e) {
        console.warn("[Solister clouds] the coverage field could not be read back; the volume will use a uniform sky", e);
    }

    const started = performance.now();
    const volume = createCloudVolume(THREE, {
        coverage2D: coverage,
        coverageW: deck.image.width,
        coverageH: deck.image.height,
        // Which genus each column carries, and its tropopause. Without this the
        // volume would be the same three slabs everywhere on the planet.
        typeMap2D: weather.typeData || null,
        typeW: weather.texture.image.width,
        typeH: weather.texture.image.height,
        // The weather field's red channel is cloud top in km/20.
        topKm2D: weather.texture.image.data,
        topW: weather.texture.image.width,
        topH: weather.texture.image.height
    });
    const radiusKm = BodyShapes.maxRadiusKm("earth") || 6371;

    // The wind: one object owns the motion of the deck and the volume, so they
    // cannot drift apart. Its uniforms are merged into the shell's below.
    const deckMaterial = cloudMeshes.earth?.material;
    const motion = typeof createCloudMotion === "function"
        ? createCloudMotion(THREE, {
            deckMesh: cloudMeshes.earth,
            deckUniforms: {
                uDeckShiftMid: deckMaterial?.userData?.uDeckShiftMid,
                uDeckShiftHigh: deckMaterial?.userData?.uDeckShiftHigh
            }
        })
        : null;
    const motionUniforms = motion ? motion.uniforms : {};

    const shell = createCloudShell(THREE, {
        motionUniforms,
        volume,
        // The deck's own field. The march samples it for the water layers'
        // horizontal coverage, so the volume keeps the 2048 x 1024 detail the
        // deck was built with instead of the volume grid's 250 km cells.
        coverageTexture: deck,
        radiusKm,
        maxRadiusKm: radiusKm,
        planetRadius: earth.geometry.parameters.radius
    });
    if (!shell) return null;
    shell.userData.bakeMs = performance.now() - started;
    shell.userData.volume = volume;
    // Behind the planet when the camera is on the far side, in front of it when
    // it is not: the shader intersects the body's own sphere analytically, so
    // the shell only has to be drawn with the body.
    earth.add(shell);
    cloudVolumeMeshes.earth = shell;
    // Hidden until the level-of-detail switch decides otherwise. The app boots
    // at orbital distance, where the deck is the correct representation, and a
    // visible volume at that distance is a full march per pixel for nothing.
    shell.visible = false;

    // The deck and the volume are the same weather at two levels of detail;
    // this owns which one is drawn. See src/render/clouds/cloud-lod.js.
    if (typeof createCloudLod === "function") {
        shell.userData.lod = createCloudLod(THREE, {
            deck: cloudMeshes.earth,
            shell,
            body: earth,
            radiusKm
        });
    }
    // The motion is advanced by the frame loop; the shell carries it so the
    // loop can find it without knowing this file's locals.
    shell.userData.motion = motion;
    if (motion) {
        globalThis.cloudMotion = motion;
        // The deck's texture matrix uniform (if the deck ever moves to a
        // custom shader) is kept in step here; the standard material updates
        // its own matrix from map.offset each frame.
        motion.advance(0, 0);
    }
    return shell;
}

function ensureEarthCloudLayer() {
    const earth = objectRegistry.earth;
    if (!earth?.geometry?.parameters) return null;
    const existing = cloudMeshes["earth"];
    if (existing) return existing;
    // The weather field is built first: the storm pattern is an input to the
    // coverage field, and the physical state it carries (cloud top, ice,
    // lightning) rides along on the deck's material.
    let weather = null;
    if (typeof createWeatherField === "function") {
        try {
            weather = createWeatherField(THREE, {
                width: (CLOUD_FIELD && CLOUD_FIELD.width) || 2048,
                height: (CLOUD_FIELD && CLOUD_FIELD.height) || 1024,
                landAt: createLandSampler()
            });
        } catch (e) {
            console.warn("[Solister weather] the storm field could not be built; the deck keeps its measured pattern", e);
            weather = null;
        }
    }
    const map = createEarthCloudTexture({ stormSignal: weather ? weather.stormSignal : null });
    if (!map) return null;
    map.userData = map.userData || {};
    if (!map.userData.cloudMaskChannel) map.userData.cloudMaskChannel = "rgb";
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    // At the limb the deck is seen at a grazing angle, where the field's texels
    // are stretched along the view. Without anisotropic filtering the cloud
    // edge there dissolves into a mip level two or three steps too coarse --
    // the one place a cloud looks least like a cloud.
    map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    map.offset.x = .25;
    map.updateMatrix();
    const cloudGeo = BodyShapes.createGeometry(THREE, "earth", earth.geometry.parameters.radius * (1 + 16 / BodyShapes.maxRadiusKm("earth")), 512, 256);
    const cloudMat = new THREE.MeshStandardMaterial({
        map: map,
        transparent: true,
        opacity: .95,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
        forceSinglePass: true
    });
    cloudMat.userData.earthCloudCoverage = true;
    if (weather) {
        cloudMat.userData.weatherMap = { value: weather.texture };
        cloudMat.userData.weatherStats = weather.stats;
        // The whole field, so a probe can reach the population and the flash
        // map without a global that only the boot script can see.
        cloudMat.userData.weatherField = weather;
        worldWeatherField = weather;
    }
    // The deck is a shell: 16 km up, 5 km thick, so the medium has somewhere
    // to be thick. Extinction is a property of the cloud, not of the body.
    const deckKm = (BodyShapes.maxRadiusKm("earth") || 6371) + 16;
    cloudMat.userData.uCloudShell = {
        value: new THREE.Vector2(deckKm, deckKm - CLOUD_DECK_THICKNESS_KM)
    };
    cloudMat.userData.uCloudExtinction = {
        value: CLOUD_EXTINCTION_PER_KM
    };
    // The deck's upper two layers drift at their own winds, so the shader needs
    // their displacement relative to the low layer. Created here rather than in
    // the eclipse patch because the motion is built before the first compile
    // and has to write into objects that already exist.
    cloudMat.userData.uDeckShiftMid = {
        value: new THREE.Vector2(0, 0)
    };
    cloudMat.userData.uDeckShiftHigh = {
        value: new THREE.Vector2(0, 0)
    };
    cloudMat.userData.uEarthCloudMaskUsesAlpha = {
        value: map.userData.cloudMaskChannel === "alpha" ? 1 : 0
    };
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    cloudMesh.userData.isCloud = true;
    cloudMesh.userData.proceduralTexture = map;
    earth.add(cloudMesh);
    cloudMeshes["earth"] = cloudMesh;
    const cloudGlow = new THREE.Mesh(cloudGeo, createEarthCloudNightGlowMaterial(map));
    cloudGlow.name = "Earth night-side cloud visibility";
    cloudGlow.userData.isCloudGlow = true;
    cloudGlow.renderOrder = 1;
    cloudGlow.raycast = () => {};
    earth.add(cloudGlow);
    earth.userData.cloudGlowMesh = cloudGlow;

    if (earthNightTexture) setEarthCloudGlowNightTexture(earthNightTexture);
    return cloudMesh;
}

function ensureVenusCloudLayer() {
    return null;
}

function loadTexturesFromFolder() {
    const baseRes = "2k";
    const maxRes = textureLodMaxRes();
    const auxRes = textureLodClamp("8k", maxRes);
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    function tryLoadTexture(baseName, onSuccess, dataMap = false, resOverride = null, cacheName = baseName) {
        const preferredRes = resOverride || baseRes;
        const chain = bodyColorFallbackChain(baseName, preferredRes);
        let index = 0;
        const tryNext = () => {
            if (index >= chain.length) {
                recordTextureRuntimeIssue("texture-aux-unavailable", {
                    file: baseName,
                    preferredResolution: preferredRes,
                    candidates: chain
                });
                return;
            }
            const res = chain[index++];
            const cached = loadedTextures.get(cacheName);
            if (cached?.image && cached.userData.surfaceResolution === res) {
                onSuccess(cached);
                return;
            }
            mapManifest(res, set => {
                const resolvedName = resolveMapFileName(set, baseName);
                const loader = textureRequests.batch("surface-" + cacheName + "-" + res);
                const url = textureAssetUrl(res, resolvedName || baseName);
                trackLoadStart();
                loader.load(url, texture => {
                    try {
                        texture.wrapS = THREE.RepeatWrapping;
                        texture.wrapT = THREE.RepeatWrapping;
                        texture.colorSpace = dataMap || baseName === "earth_specular" ? THREE.NoColorSpace : THREE.SRGBColorSpace;
                        if (baseName === "earth_night") configureEarthNightKtx2Texture(texture);
                        texture.anisotropy = maxAnisotropy;
                        texture.needsUpdate = true;
                        texture.userData.surfaceResolution = res;
                        trackTexture(cacheName, texture);
                        onSuccess(texture);
                    } catch (error) {
                        recordTextureRuntimeIssue("texture-aux-apply-failed", {
                            file: baseName,
                            resolution: res,
                            url: url,
                            error: error
                        });
                        texture.dispose();
                        tryNext();
                    } finally {
                        trackLoadEnd();
                    }
                }, undefined, error => {
                    trackLoadEnd();
                    if (index < chain.length) tryNext();
                    else recordTextureRuntimeIssue("texture-aux-load-failed", {
                        file: baseName,
                        resolution: res,
                        url: url,
                        error: error
                    });
                }, () => {
                    trackLoadEnd();
                });
            });
        };
        tryNext();
    }
    for (const key of TEXTURE_LOD_BODY_KEYS) {
        if (!objectRegistry[key]) continue;
        if (TEXTURE_EAGER_BASE_KEYS.has(key) || textureLodFocusedKey() === key) ensureBodyColorTexture(key, baseRes);
    }
    ensureEarthCloudLayer();
    ensureEarthCloudVolume();
    TEXTURE_AUX_FILES.forEach(({name: name, target: target, max: max}) => {
        const res = textureLodClamp(max || auxRes, auxRes);
        if ((target === "earthSpecular" || target === "earthNight") && !objectRegistry.earth) return;
        if (target === "venusAtmosphere" && !objectRegistry.venus) return;
        if (target === "saturn-ring" && !objectRegistry["saturn-ring"]) return;
        tryLoadTexture(name, texture => {
            switch (target) {
              case "earthNight":
                earthNightTexture = texture;
                createEarthNightLights();
                setEarthCloudGlowNightTexture(texture);
                break;
              case "earthSpecular":
                applyEarthSpecularTexture(texture);
                break;
              case "saturn-ring":
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.ClampToEdgeWrapping;
                texture.repeat.x = 50;
                applyTextureToObject("saturn-ring", texture);
                trackTexture("saturn_rings", texture);
                break;
            }
        }, name === "earth_specular", res, name);
    });
    scheduleAssetReport();
}

function assetReport() {
    const bodies = {};
    for (const key of TEXTURE_LOD_BODY_KEYS) {
        const st = focusLod.states.get(key);
        const obj = objectRegistry[key];
        const map = obj?.material?.map || null;
        bodies[key] = {
            object: !!obj,
            showing: map ? (map.userData?.surfaceResolution ? "ktx2@" + map.userData.surfaceResolution : (map.name || "procedural-or-other")) : "none",
            installedTier: st?.colorRes || null,
            inFlightTier: st?.loadingColorRes || null,
            failedTier: st?.colorFailedRes || null,
            retryInMs: st?.colorRetryAt ? Math.max(0, Math.round(st.colorRetryAt - performance.now())) : 0
        };
    }
    const aux = {};
    for (const {name: name} of TEXTURE_AUX_FILES) {
        const t = loadedTextures.get(name);
        aux[name] = t ? (t.userData?.surfaceResolution ? "ktx2@" + t.userData.surfaceResolution : "loaded") : "not loaded";
    }
    return {
        build: SOLISTER_BUILD,
        textureQuality: textureQuality,
        textureResolution: textureResolution,
        maxTextureSize: renderer?.capabilities?.maxTextureSize ?? null,
        ktx2LoaderInstalled: !!globalThis.__solisterSharedKtx2Loader,
        manifests: Object.fromEntries([ ...mapManifests ].map(([k, v]) => [ k, v ? [ ...v ] : null ])),
        folderListings: Object.fromEntries([ ...mapManifestListings ].map(([k, v]) => [ k, v.listed === null ? "server returned no directory index" : v.listed.length + " files listed, " + v.addedOverMapsJson.length + " added over maps.json" ])),
        bodies: bodies,
        aux: aux,
        queues: {
            surface: textureRequests?.stats?.() ?? null
        },
        issues: (globalThis.__solisterTextureErrors || []).slice(-30),
        probes: Object.fromEntries([ ...TEXTURE_PROBES ].map(([url, v]) => [ url.replace(/^\.\/assets\/textures\//, ""), v ]))
    };
}

globalThis.__solisterAssetReport = assetReport;

let _assetReportScheduled = false;

function scheduleAssetReport() {
    if (_assetReportScheduled) return;
    _assetReportScheduled = true;
    setTimeout(() => {
        try {
            const r = assetReport();
            const stuck = Object.entries(r.bodies).filter(([, v]) => v.object && v.showing !== "none" && String(v.showing).indexOf("ktx2") !== 0);
            if (!stuck.length) return;
            console.warn("[Solister textures] " + stuck.length + " bod" + (stuck.length === 1 ? "y is" : "ies are") + " still on a fallback map: " + stuck.map(([k, v]) => k + " [showing " + v.showing + (v.inFlightTier ? ", loading " + v.inFlightTier : "") + (v.failedTier ? ", failed " + v.failedTier + ", retry in " + v.retryInMs + "ms" : "") + "]").join(", ") + ". Queues - surface: active " + r.queues.surface.active + ", queued " + r.queues.surface.queued + ", inflight " + JSON.stringify(r.queues.surface.inflight) + "; sky: active " + r.queues.sky.active + ", queued " + r.queues.sky.queued + ". Full picture: copy(JSON.stringify(__solisterAssetReport()))");
        } catch (e) {}
    }, 25000);
}

const mapManifestListings = new Map;

function textureFolderListing(res) {
    if (typeof fetch !== "function") return Promise.resolve(null);
    return fetch(`./assets/textures/${res}/`, {
        cache: "no-store"
    }).then(response => {
        if (!response.ok) return null;
        const type = String(response.headers.get("content-type") || "").toLowerCase();
        const isJson = type.indexOf("json") >= 0;
        if (!isJson && type.indexOf("text/html") < 0) return null;
        return response.text().then(text => {
            const names = new Set;
            if (isJson) {
                try {
                    const walk = value => {
                        if (typeof value === "string") {
                            if (/\.ktx2$/i.test(value)) names.add(value.split("/").pop());
                        } else if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object") Object.values(value).forEach(walk);
                    };
                    walk(JSON.parse(text));
                } catch (e) {}
            } else {
                const re = /href="([^"?#]+)"/gi;
                let match;
                while ((match = re.exec(text))) {
                    let name = match[1];
                    if (name.endsWith("/")) continue;
                    try {
                        name = decodeURIComponent(name);
                    } catch (e) {}
                    name = name.split("/").pop();
                    if (/\.ktx2$/i.test(name)) names.add(name);
                }
            }
            return names.size ? names : null;
        });
    }).catch(() => null);
}

function mapManifest(res, cb) {
    if (mapManifests.has(res)) {
        cb(mapManifests.get(res));
        return;
    }
    let pending = mapManifestPending.get(res);
    if (!pending) {
        trackLoadStart();
        pending = Promise.all([ fetch(`./assets/textures/${res}/maps.json`, {
            cache: "force-cache"
        }).then(response => response.ok ? response.json() : null).then(json => Array.isArray(json) ? new Set(json) : null).catch(() => null), textureFolderListing(res) ]).then(([set, listing]) => {
            let final = set;
            if (listing && listing.size) {
                const merged = new Set(set || []);
                const added = [];
                listing.forEach(name => {
                    if (!merged.has(name)) {
                        merged.add(name);
                        added.push(name);
                    }
                });
                final = merged;
                mapManifestListings.set(res, {
                    listed: [ ...listing ].sort(),
                    addedOverMapsJson: added.sort()
                });
                if (added.length) console.info("[Solister textures] " + res + ": folder listing names " + added.length + " map" + (added.length === 1 ? "" : "s") + " that maps.json omits: " + added.slice(0, 12).join(", ") + (added.length > 12 ? ", \u2026" : ""));
            } else mapManifestListings.set(res, {
                listed: listing ? [ ...listing ].sort() : null,
                addedOverMapsJson: []
            });
            mapManifests.set(res, final);
            if (!final && !mapManifestNotice) {
                mapManifestNotice = true;
            }
            return final;
        }).finally(() => {
            mapManifestPending.delete(res);
            trackLoadEnd();
        });
        mapManifestPending.set(res, pending);
    }
    pending.then(cb).catch(error => console.error("Enhancement manifest callback:", error));
}

function applyGraphicsPixelRatio() {

    if (performanceDefaults.renderer) performanceDefaults.applySize(); else {
        const limit = GRAPHICS_PIXEL_RATIO[textureQuality] ?? 1.5;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, limit));
    }
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function applyTextureQuality(next, force = false) {
    if (!Object.prototype.hasOwnProperty.call(TEXTURE_QUALITY_POLICY, next)) return;
    if (!force && next === textureQuality) return;
    textureQuality = next;
    try {
        localStorage.setItem("solarTextureQuality", next);
    } catch (e) {}
    if (typeof setVisualSelectValue === "function") setVisualSelectValue(next);
    applyGraphicsPixelRatio();
    globalThis.__solisterGraphicsTier = next;
    beginLoading("Loading " + next.charAt(0).toUpperCase() + next.slice(1) + " texture pyramid");
    const base = wantBodyPin2K() ? "2k" : TEXTURE_QUALITY_POLICY[next].base;
    if (!wantBodyPin2K() && base !== textureResolution) swapTextureResolution(base); else {
        textureLodReset();
        loadTexturesFromFolder();
    }
}

function swapTextureResolution(next) {
    if (!TEXTURE_RESOLUTION_VALUES.includes(next)) return;
    next = bestSupportedTextureResolution(next);
    if (next === textureResolution) return;
    textureResolution = next;
    try {
        localStorage.setItem("solarTexRes", next);
    } catch (e) {}
    textureLodReset();
    beginLoading("Loading " + next.toUpperCase() + " texture pyramid");
    loadTexturesFromFolder();
}

function applySkyLayers() {
    if (skyMaps) skyMaps.group.visible = true;
    if (constellationLayer) constellationLayer.group.visible = true;
    applyStarVisibility();
}