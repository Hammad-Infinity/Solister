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
    } catch (e) {}
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
    name: "earth_clouds",
    target: "earthClouds",
    max: "4k"
}, {
    name: "saturn_ring",
    target: "saturn-ring",
    max: "4k"
} ];

const TEXTURE_EAGER_BASE_KEYS = new Set([ "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "moon" ]);

const _textureLodWorld = new THREE.Vector3;

function stabilizeVenusMaterial(mat) {
    if (!mat) return;
    // Venus's cloud deck now carries a physical BRDF (sulfuric acid droplets,
    // not matte rock), so leave its roughness alone. What still needs
    // stabilising is a stray texture-driven response: the procedural cloud map
    // must not be reinterpreted as a roughness or specular map.
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
        mat.map = texture;
        mat.needsUpdate = true;
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
            releaseAt: 0,
            detailActive: false,
            detailReleaseAt: 0,
            detailLoading: false
        };
        focusLod.states.set(key, state);
    }
    return state;
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
    if (ratio <= 95) return textureLodClamp("4k", maxRes);
    return "2k";
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
        const state = textureLodState(key);
        state.colorRes = res;
        state.colorSlot = textureLodSlot(key, "color", res);
        state.loadingColorRes = null;
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
    if (res === "8k") return [ "8k", "4k", "2k" ];
    if (res === "4k") return [ "4k", "2k" ];
    return [ "2k" ];
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
    state.loadingColorRes = res;
    const generation = focusLod.generation, requestVersion = state.loadingColorVersion = (state.loadingColorVersion || 0) + 1;
    const isCurrent = () => focusLod.generation === generation && state.loadingColorVersion === requestVersion;
    const chain = bodyColorFallbackChain(key, res);
    let index = 0;
    const tryNext = () => {
        if (!isCurrent() || state.loadingColorRes !== res) return;
        if (index >= chain.length) {
            state.loadingColorRes = null;
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
            if (set && !set.has(file)) {
                tryNext();
                return;
            }
            const loader = textureRequests.batch("lod-color-" + key + "-" + res + "-" + loadRes);
            const url = textureAssetUrl(loadRes, file);
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
                    if (isCurrent() && (loadRes === res || index >= chain.length)) state.loadingColorRes = null;
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

function textureAssetUrl(res, file) {
    return "./assets/textures/" + res + "/" + file + ".ktx2";
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
    for (const key of TEXTURE_LOD_BODY_KEYS) {
        const state = textureLodState(key);
        state.loadingColorRes = null;
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
    for (const key of TEXTURE_LOD_BODY_KEYS) {
        const obj = objectRegistry[key];
        if (!obj) continue;
        const targetRes = textureLodTargetRes(key, obj);
        const state = textureLodState(key);
        if (textureLodShouldRequest(key, obj, targetRes)) ensureBodyColorTexture(key, targetRes);
        if (state.colorRes && (TEXTURE_LOD_RANK[state.colorRes] ?? 0) > (TEXTURE_LOD_RANK[targetRes] ?? 0)) {
            state.releaseAt = now + focusLod.releaseMs;
        }
        cleanupBodyColorTextures(key, targetRes, now);
    }
}

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
            }
        },
        vertexShader: `\n            ${globalThis.LDB_VERTEX_PARS || ""}\n            varying vec2 vUv;\n            varying vec3 vNormal;\n            void main() {\n                vUv = uv;\n                vNormal = normalize(mat3(modelMatrix) * normal);\n                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n                ${globalThis.LDB_VERTEX_TAIL || ""}\n            }\n        `,
        fragmentShader: `\n            uniform sampler2D uCloudTexture;\n            uniform mat3 uCloudTextureMatrix;\n            uniform vec3 uSunDirection;\n            uniform float uOpacity;\n            uniform float uCloudUseAlpha;\n            uniform float uInsideShell;\n            varying vec2 vUv;\n            varying vec3 vNormal;\n            ${globalThis.LDB_FRAGMENT_PARS || ""}\n            void main() {\n                ${globalThis.LDB_FRAGMENT_HEAD || ""}\n                if ((uInsideShell < 0.5 && !gl_FrontFacing) || (uInsideShell >= 0.5 && gl_FrontFacing)) discard;\n                float sunMu = dot(normalize(vNormal), normalize(uSunDirection));\n                float night = 1.0 - smoothstep(-0.08, 0.16, sunMu);\n                if (night < 0.004 || uOpacity < 0.001) discard;\n                vec2 cloudUv = (uCloudTextureMatrix * vec3(vUv, 1.0)).xy;\n                vec4 cloudSample = texture2D(uCloudTexture, cloudUv);\n                float rgbDensity = max(cloudSample.r, max(cloudSample.g, cloudSample.b));\n                float density = mix(rgbDensity, cloudSample.a, uCloudUseAlpha);\n                float cloudMask = smoothstep(0.38, 0.60, density);\n                float alpha = cloudMask * night * uOpacity * 0.32;\n                if (alpha < 0.004) discard;\n                gl_FragColor = vec4(vec3(0.42, 0.46, 0.52), alpha);\n            }\n        `,
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

function ensureEarthCloudLayer(texture = null) {
    const earth = objectRegistry.earth;
    if (!earth?.geometry?.parameters) return null;
    const existing = cloudMeshes["earth"];
    if (existing) {
        if (!texture || existing.material.map === texture) return existing;
        const previous = existing.material.map;
        texture.userData = texture.userData || {};
        if (!texture.userData.cloudMaskChannel) texture.userData.cloudMaskChannel = "rgb";
        existing.material.map = texture;
        if (existing.material.userData?.uEarthCloudMaskUsesAlpha) {
            existing.material.userData.uEarthCloudMaskUsesAlpha.value = texture.userData.cloudMaskChannel === "alpha" ? 1 : 0;
        }
        existing.material.needsUpdate = true;
        const glow = earth.userData.cloudGlowMesh;
        if (glow?.material?.uniforms?.uCloudTexture) {
            glow.material.uniforms.uCloudTexture.value = texture;
            if (glow.material.uniforms.uCloudUseAlpha) glow.material.uniforms.uCloudUseAlpha.value = texture.userData?.cloudMaskChannel === "alpha" ? 1 : 0;
        }
        if (existing.userData.proceduralTexture === previous) delete existing.userData.proceduralTexture;
        return existing;
    }
    const map = texture || createEarthCloudTexture();
    if (!map) return null;
    map.userData = map.userData || {};
    if (!map.userData.cloudMaskChannel) map.userData.cloudMaskChannel = "rgb";
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.offset.x = .25;
    map.updateMatrix();
    const cloudGeo = BodyShapes.createGeometry(THREE, "earth", earth.geometry.parameters.radius * (1 + 12 / BodyShapes.maxRadiusKm("earth")), 256, 128);
    const cloudMat = new THREE.MeshStandardMaterial({
        map: map,
        transparent: true,
        opacity: .58,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
        forceSinglePass: true
    });
    cloudMat.userData.earthCloudCoverage = true;
    cloudMat.userData.uEarthCloudMaskUsesAlpha = {
        value: map.userData.cloudMaskChannel === "alpha" ? 1 : 0
    };
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    cloudMesh.userData.isCloud = true;
    if (!texture) cloudMesh.userData.proceduralTexture = map;
    earth.add(cloudMesh);
    cloudMeshes["earth"] = cloudMesh;
    const cloudGlow = new THREE.Mesh(cloudGeo, createEarthCloudNightGlowMaterial(map));
    cloudGlow.name = "Earth night-side cloud visibility";
    cloudGlow.userData.isCloudGlow = true;
    cloudGlow.renderOrder = 1;
    cloudGlow.raycast = () => {};
    earth.add(cloudGlow);
    earth.userData.cloudGlowMesh = cloudGlow;
    return cloudMesh;
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
                if (set && !set.has(baseName)) {
                    tryNext();
                    return;
                }
                const loader = textureRequests.batch("surface-" + cacheName + "-" + res);
                const url = textureAssetUrl(res, baseName);
                trackLoadStart();
                loader.load(url, texture => {
                    try {
                        texture.wrapS = THREE.RepeatWrapping;
                        texture.wrapT = THREE.RepeatWrapping;
                        texture.colorSpace = dataMap || baseName === "earth_clouds" ? THREE.NoColorSpace : THREE.SRGBColorSpace;
                        if (baseName === "earth_night") configureEarthNightKtx2Texture(texture);
                        else if (baseName === "earth_clouds") configureEarthKtx2Texture(texture);
                        texture.anisotropy = maxAnisotropy;
                        texture.needsUpdate = true;
                        texture.userData.surfaceResolution = res;
                        if (baseName === "earth_clouds") texture.userData.cloudMaskChannel = "rgb";
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
    TEXTURE_AUX_FILES.forEach(({name: name, target: target, max: max}) => {
        const res = textureLodClamp(max || auxRes, auxRes);
        if ((target === "earthClouds" || target === "earthNight") && !objectRegistry.earth) return;
        if (target === "saturn-ring" && !objectRegistry["saturn-ring"]) return;
        tryLoadTexture(name, texture => {
            switch (target) {
              case "earthNight":
                earthNightTexture = texture;
                createEarthNightLights();
                break;

              case "earthClouds":
                ensureEarthCloudLayer(texture);
                break;

              case "saturn-ring":
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.ClampToEdgeWrapping;
                texture.repeat.x = 50;
                applyTextureToObject("saturn-ring", texture);
                trackTexture("saturn_rings", texture);
                break;
            }
        }, name === "earth_night" || name === "earth_clouds", res, name);
    });
}

function mapManifest(res, cb) {
    if (mapManifests.has(res)) {
        cb(mapManifests.get(res));
        return;
    }
    let pending = mapManifestPending.get(res);
    if (!pending) {
        trackLoadStart();
        pending = fetch(`./assets/textures/${res}/maps.json`, {
            cache: "force-cache"
        }).then(response => response.ok ? response.json() : null).then(json => Array.isArray(json) ? new Set(json) : null).catch(() => null).then(set => {
            mapManifests.set(res, set);
            if (!set && !mapManifestNotice) {
                mapManifestNotice = true;
            }
            return set;
        }).finally(() => {
            mapManifestPending.delete(res);
            trackLoadEnd();
        });
        mapManifestPending.set(res, pending);
    }
    pending.then(cb).catch(error => console.error("Enhancement manifest callback:", error));
}

function applyGraphicsPixelRatio() {
    const limit = GRAPHICS_PIXEL_RATIO[textureQuality] ?? 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, limit));
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (typeof hdrPipeline !== "undefined" && hdrPipeline) {
        const ratio = renderer.getPixelRatio();
        hdrPipeline.resize(Math.floor(window.innerWidth * ratio), Math.floor(window.innerHeight * ratio));
    }
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
    beginLoading("Loading " + next.charAt(0).toUpperCase() + next.slice(1) + " texture pyramid");
    const base = wantBodyPin2K() ? "2k" : TEXTURE_QUALITY_POLICY[next].base;
    if (!wantBodyPin2K() && base !== textureResolution) swapTextureResolution(base); else {
        textureLodReset();
        loadTexturesFromFolder();
        loadMilkywayBackground();
        if (skyMaps) skyMaps.setResolution(skyTexRes());
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
    loadMilkywayBackground();
    if (skyMaps) skyMaps.setResolution(skyTexRes());
}

function swapSkyResolution(next) {
    if (!SKY_TEXTURE_RESOLUTION_VALUES.includes(next)) return;
    next = bestSupportedSkyTextureResolution(next, skyResolution);
    if (next === skyResolution) return;
    skyResolution = next;
    try {
        localStorage.setItem("solarSkyTexRes", next);
    } catch (e) {}
    if (typeof setSkyTextureSelectValue === "function") setSkyTextureSelectValue(next);
    _mwLoadKey = null;
    beginLoading("Loading " + next.toUpperCase() + " sky");
    loadMilkywayBackground();
    if (skyMaps) skyMaps.setResolution(next);
}

function applySkyLayers() {
    if (skyMaps) skyMaps.group.visible = true;
    if (constellationLayer) constellationLayer.group.visible = true;
    applyStarVisibility();
}

function milkywayTextureResChain() {
    const want = typeof bestSupportedSkyTextureResolution === "function" ? bestSupportedSkyTextureResolution(skyTexRes(), "4k") : skyTexRes();
    if (want === "16k") return [ "16k", "8k", "4k" ];
    if (want === "8k") return [ "8k", "4k" ];
    return [ "4k", "8k" ];
}

function loadMilkywayBackground() {
    const chain = milkywayTextureResChain();
    const loadKey = chain.join("/");
    if (_mwLoadKey === loadKey) return;
    _mwLoadKey = loadKey;
    const loader = skyTextureRequests.batch("sky-milkyway");
    let index = 0;
    trackLoadStart();
    const fail = () => {
        recordTextureRuntimeIssue("milkyway-load-failed", {
            resolution: skyTexRes(),
            url: chain.map(res => "./assets/textures/" + res + "/milky_way.ktx2").join(", ")
        });
        trackLoadEnd();
    };
    const tryNext = () => {
        if (index >= chain.length) {
            fail();
            return;
        }
        const res = chain[index++];
        const milkyWayUrl = "./assets/textures/" + res + "/milky_way.ktx2";
        loader.load(milkyWayUrl, texture => {
            try {
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.mapping = THREE.EquirectangularReflectionMapping;
                trackTexture("milky_way", texture);
                milkyWayTexture = texture;
                if (skyMaps) {
                    skyMaps.adoptTexture("milkyway", texture, res);
                    skyMaps.setMilkywayExposure(10);
                    if (skyToggles.milkyway) skyMaps.setLayerVisible("milkyway", true);
                }
                applyStarVisibility();
            } catch (error) {
                recordTextureRuntimeIssue("milkyway-apply-failed", {
                    resolution: res,
                    url: milkyWayUrl,
                    error: error
                });
            } finally {
                trackLoadEnd();
            }
        }, undefined, () => tryNext(), () => tryNext());
    };
    tryNext();
}
