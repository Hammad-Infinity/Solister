// ============================================================================
// ring-planet-occlusion.glsl.js — analytic ring/planet occlusion
// ----------------------------------------------------------------------------
// When the camera focuses a small body (e.g. a comet nucleus) the dynamic
// near plane collapses to a tiny value and the far/near ratio destroys the
// 24-bit depth precision at planetary distances. Saturn's rings then
// Z-fight their own planet and appear on BOTH sides of the disc.
//
// Fix: the ring shader discards fragments hidden behind the parent planet
// with an exact ray–sphere test, independent of the depth buffer. The ring
// keeps its normal depth test for everything else, plus a small polygon
// offset so the front half wins tie situations deterministically.
// ============================================================================
function installRingPlanetOcclusion(material, planetRadius, cacheKey) {
    if (!material || material.userData.ringOcclusionInstalled) return material?.userData.ringOcclusionUniforms || null;
    material.userData.ringOcclusionInstalled = true;
    const uniforms = {
        uOccCenter: { value: new THREE.Vector3() },
        uOccRadius: { value: planetRadius },
    };
    material.userData.ringOcclusionUniforms = uniforms;
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = shader => {
        if (previous) previous.call(material, shader);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = 'varying vec3 vRingOccWorld;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `#include <project_vertex>
             vRingOccWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );
        shader.fragmentShader =
            'varying vec3 vRingOccWorld;\nuniform vec3 uOccCenter;\nuniform float uOccRadius;\n' +
            shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <clipping_planes_fragment>',
            `#include <clipping_planes_fragment>
            {
                // Exact occlusion by the parent planet sphere.
                vec3 occOrigin = cameraPosition - uOccCenter;
                vec3 occToFrag = vRingOccWorld - cameraPosition;
                float occDist = length(occToFrag);
                vec3 occDir = occToFrag / max(occDist, 1e-12);
                float occB = dot(occOrigin, occDir);
                float occC = dot(occOrigin, occOrigin) - uOccRadius * uOccRadius;
                float occDiscriminant = occB * occB - occC;
                if (occDiscriminant > 0.0) {
                    float occT = -occB - sqrt(occDiscriminant);
                    if (occT > 0.0 && occT < occDist * 0.9995) discard;
                }
            }`
        );
    };
    const previousKey = material.customProgramCacheKey;
    material.customProgramCacheKey = () =>
        cacheKey + '|' + (previousKey ? previousKey.call(material) : '');
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
    material.needsUpdate = true;
    return uniforms;
}

// ============================================================================
// Universal body occlusion — the permanent fix for depth-precision glitches
// ----------------------------------------------------------------------------
// When the camera focuses a tiny body the near plane collapses (~1e-8) while
// far stays at 1.2e6: the 24-bit depth buffer degenerates and ANY two distant
// bodies Z-fight (moons through planets, planets through the sun, rings
// through discs). Depth can never resolve that ratio, so every solid body is
// occluded ANALYTICALLY by its parent instead — exact at every zoom level:
//   * moons / dwarf planets  -> occluded by their parent planet
//   * planets                -> occluded by the sun
// ============================================================================
const planetOccBindings = [];
function ensurePlanetOccluders(registry) {
    for (const [key, mesh] of Object.entries(registry)) {
        if (!mesh || !mesh.isMesh || !mesh.userData) continue;
        if (mesh.userData.ringOcclusionInstalled) continue;
        if (mesh.userData.isAtmosphere || mesh.userData.isPopulationAnchor ||
            mesh.userData.isComet || mesh.userData.isSunCorona) continue;
        let parentKey = mesh.userData.parentKey;
        if (!parentKey && mesh.userData.isMoon && key === 'moon') parentKey = 'earth';
        if (!parentKey || parentKey === key) continue;
        const parent = registry[parentKey];
        const radius = parent?.geometry?.parameters?.radius;
        if (!parent?.isMesh || !(radius > 0)) continue;
        if (!mesh.geometry?.parameters?.radius) continue;
        if (Array.isArray(mesh.material)) continue;
        installRingPlanetOcclusion(mesh.material, radius, 'body-occ-' + key);
        planetOccBindings.push({ mesh, parent });
    }
}
function updatePlanetOccluders() {
    for (const b of planetOccBindings) {
        const u = b.mesh.userData.ringOcclusionUniforms;
        if (u) b.parent.getWorldPosition(u.uOccCenter.value);
    }
}
