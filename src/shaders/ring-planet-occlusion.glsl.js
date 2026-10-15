function installRingPlanetOcclusion(material, planetRadius, cacheKey) {
    if (!material || material.userData.ringOcclusionInstalled) return material?.userData.ringOcclusionUniforms || null;
    material.userData.ringOcclusionInstalled = true;
    const uniforms = {
        uOccCenter: {
            value: new THREE.Vector3
        },
        uOccRadius: {
            value: planetRadius
        }
    };
    material.userData.ringOcclusionUniforms = uniforms;
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = shader => {
        if (previous) previous.call(material, shader);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = "varying vec3 vRingOccWorld;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>\n             vRingOccWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
        shader.fragmentShader = "varying vec3 vRingOccWorld;\nuniform vec3 uOccCenter;\nuniform float uOccRadius;\n" + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n            {\n                 \n                vec3 occOrigin = cameraPosition - uOccCenter;\n                vec3 occToFrag = vRingOccWorld - cameraPosition;\n                float occDist = length(occToFrag);\n                vec3 occDir = occToFrag / max(occDist, 1e-12);\n                float occB = dot(occOrigin, occDir);\n                float occC = dot(occOrigin, occOrigin) - uOccRadius * uOccRadius;\n                float occDiscriminant = occB * occB - occC;\n                if (occDiscriminant > 0.0) {\n                    float occT = -occB - sqrt(occDiscriminant);\n                    if (occT > 0.0 && occT < occDist * 0.9995) discard;\n                }\n            }`);
    };
    const previousKey = material.customProgramCacheKey;
    material.customProgramCacheKey = () => cacheKey + "|" + (previousKey ? previousKey.call(material) : "");
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
    material.needsUpdate = true;
    return uniforms;
}

const planetOccBindings = [];

function resetPlanetOccluders() {
    planetOccBindings.length = 0;
}

function ensurePlanetOccluders(registry) {
    for (const key in registry) {
        const mesh = registry[key];
        if (!mesh || !mesh.isMesh || !mesh.userData) continue;
        if (mesh.material?.userData.ringOcclusionInstalled) continue;
        if (mesh.userData.isAtmosphere || mesh.userData.isPopulationAnchor || mesh.userData.isComet || mesh.userData.isSunCorona) continue;
        let parentKey = mesh.userData.parentKey;
        if (!parentKey && mesh.userData.isMoon && key === "moon") parentKey = "earth";
        if (!parentKey || parentKey === key) continue;
        const parent = registry[parentKey];
        const radius = parent?.geometry?.parameters?.radius;
        if (!parent?.isMesh || !(radius > 0)) continue;
        if (!mesh.geometry?.parameters?.radius) continue;
        if (Array.isArray(mesh.material)) continue;
        installRingPlanetOcclusion(mesh.material, radius, "body-occ-" + key);
        planetOccBindings.push({
            mesh: mesh,
            parent: parent
        });
    }
}

function updatePlanetOccluders() {
    for (const b of planetOccBindings) {
        const u = b.mesh.material?.userData.ringOcclusionUniforms;
        if (u) b.parent.getWorldPosition(u.uOccCenter.value);
    }
}
