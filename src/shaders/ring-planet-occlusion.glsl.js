// One source of truth for the ring/planet ellipsoid-occlusion test. The
// production material patch below and tools/p3ringplanetocclusion.mjs
// both use this exact helper.
const RING_PLANET_OCCLUSION_GLSL = `
bool ringPlanetOccluded(vec3 fragWorld, vec3 cameraPos, vec3 occCenter, float occRadius, mat3 occInvRot, vec3 occAxes) {
    vec3 occToFrag = fragWorld - cameraPos;
    float occDist = length(occToFrag);
    vec3 occDir = occToFrag / max(occDist, 1e-12);
    // Ellipsoid test in the body's own frame: rotate the ray into body
    // space, squash by the axis ratios, then it is a sphere test.
    // Rotation preserves the ray parameter, so occT stays a world-space
    // distance along occDir.
    vec3 occO = (occInvRot * (cameraPos - occCenter)) / occAxes;
    vec3 occD = (occInvRot * occDir) / occAxes;
    float occA = dot(occD, occD);
    float occB = dot(occO, occD);
    float occC = dot(occO, occO) - occRadius * occRadius;
    float occDiscriminant = occB * occB - occA * occC;
    if (occDiscriminant > 0.0) {
        float occT = (-occB - sqrt(occDiscriminant)) / occA;
        return occT > 0.0 && occT < occDist * 0.9995;
    }
    return false;
}
`;

function installRingPlanetOcclusion(material, planetRadius, cacheKey, occluderBody = null) {
    if (!material || material.userData.ringOcclusionInstalled) return material?.userData.ringOcclusionUniforms || null;
    material.userData.ringOcclusionInstalled = true;

    const occAxes = new THREE.Vector3(1, 1, 1);
    const occKey = occluderBody?.userData?.planetKey;
    const axesKm = occKey && typeof BodyShapes !== "undefined" ? BodyShapes.axesKm[occKey] : null;
    if (axesKm) {
        const maxAxis = Math.max(...axesKm);
        occAxes.set(axesKm[0] / maxAxis, axesKm[2] / maxAxis, axesKm[1] / maxAxis);
    }
    const uniforms = {
        uOccCenter: {
            value: new THREE.Vector3
        },
        uOccRadius: {
            value: planetRadius
        },
        uOccInvRot: {
            value: new THREE.Matrix3
        },
        uOccAxes: {
            value: occAxes
        }
    };
    material.userData.ringOcclusionUniforms = uniforms;
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = shader => {
        if (previous) previous.call(material, shader);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = "varying vec3 vRingOccWorld;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>\n             vRingOccWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
        shader.fragmentShader = "varying vec3 vRingOccWorld;\nuniform vec3 uOccCenter;\nuniform float uOccRadius;\nuniform mat3 uOccInvRot;\nuniform vec3 uOccAxes;\n" + RING_PLANET_OCCLUSION_GLSL + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n            if (ringPlanetOccluded(vRingOccWorld, cameraPosition, uOccCenter, uOccRadius, uOccInvRot, uOccAxes)) discard;`);
    };
    const previousKey = material.customProgramCacheKey;
    material.customProgramCacheKey = () => cacheKey + "|ellipsoid|" + (previousKey ? previousKey.call(material) : "");
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
        installRingPlanetOcclusion(mesh.material, radius, "body-occ-" + key, parent);
        planetOccBindings.push({
            mesh: mesh,
            parent: parent
        });
    }
}

const _occScratchQuat = new THREE.Quaternion;
const _occScratchMat4 = new THREE.Matrix4;

function updateRingOccluder(uniforms, body) {
    if (!uniforms || !body) return;
    body.getWorldPosition(uniforms.uOccCenter.value);
    if (uniforms.uOccInvRot) {
        body.getWorldQuaternion(_occScratchQuat).invert();
        _occScratchMat4.makeRotationFromQuaternion(_occScratchQuat);
        uniforms.uOccInvRot.value.setFromMatrix4(_occScratchMat4);
    }
}

function updatePlanetOccluders() {
    for (const b of planetOccBindings) {
        const u = b.mesh.material?.userData.ringOcclusionUniforms;
        if (u) updateRingOccluder(u, b.parent);
    }
}
