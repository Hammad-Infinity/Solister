function installEarthEclipse(material) {
    if (!material || material.userData.eclipseInstalled) return;
    material.userData.eclipseInstalled = true;
    const isEarthCloudCoverage = material.userData.earthCloudCoverage === true;
    const cloudMaskUsesAlpha = material.userData.uEarthCloudMaskUsesAlpha || {
        value: 0
    };
    if (isEarthCloudCoverage) material.userData.uEarthCloudMaskUsesAlpha = cloudMaskUsesAlpha;
    const cloudInsideShell = isEarthCloudCoverage ? material.userData.uEarthCloudInsideShell || (material.userData.uEarthCloudInsideShell = {
        value: 0
    }) : null;
    const cloudShell = isEarthCloudCoverage ? material.userData.uCloudShell || (material.userData.uCloudShell = {
        value: new THREE.Vector2(6387, 6382)
    }) : null;
    const cloudExtinction = isEarthCloudCoverage ? material.userData.uCloudExtinction || (material.userData.uCloudExtinction = {
        value: CLOUD_EXTINCTION_PER_KM
    }) : null;
    // Per-layer displacement of the deck's upper two channels, in turns of
    // longitude relative to the low layer (whose drift is the map's own offset).
    const deckShiftMid = isEarthCloudCoverage ? material.userData.uDeckShiftMid || (material.userData.uDeckShiftMid = {
        value: new THREE.Vector2(0, 0)
    }) : null;
    const deckShiftHigh = isEarthCloudCoverage ? material.userData.uDeckShiftHigh || (material.userData.uDeckShiftHigh = {
        value: new THREE.Vector2(0, 0)
    }) : null;
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, eclipseUniforms);
        if (isEarthCloudCoverage) {
            shader.uniforms.uEarthCloudMaskUsesAlpha = cloudMaskUsesAlpha;
            shader.uniforms.uEarthCloudInsideShell = cloudInsideShell;
            shader.uniforms.uCloudShell = cloudShell;
            shader.uniforms.uCloudExtinction = cloudExtinction;
        }
        shader.vertexShader = (isEarthCloudCoverage ? "varying vec3 vCloudWorldNormal;\n" : "varying vec3 vEarthLocalPos;\n") + "varying vec3 vEclipseWorld;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>\n             vEclipseWorld =\n                 (modelMatrix * vec4(transformed, 1.0)).xyz;` + (isEarthCloudCoverage ? `\n             vCloudWorldNormal = normalize(mat3(modelMatrix) * normal);` : `\n             vEarthLocalPos = position;`));
        if (isEarthCloudCoverage) {
            shader.uniforms.uDeckShiftMid = deckShiftMid;
            shader.uniforms.uDeckShiftHigh = deckShiftHigh;
        }
        shader.fragmentShader = (isEarthCloudCoverage ? "uniform float uEarthCloudMaskUsesAlpha;\nuniform float uEarthCloudInsideShell;\nuniform vec2 uCloudShell;\nuniform float uCloudExtinction;\nuniform vec2 uDeckShiftMid;\nuniform vec2 uDeckShiftHigh;\nvarying vec3 vCloudWorldNormal;\n" + CLOUD_MEDIUM_GLSL : "") +
            "uniform vec3 uEarthCenter;\nvarying vec3 vEclipseWorld;\n" +
            (isEarthCloudCoverage ? "" : "uniform sampler2D uCloudShadowMap;\nuniform vec3 uCloudShadowSunLocal;\nuniform vec2 uCloudShadowUvOffset;\nuniform float uCloudShadowUseAlpha;\nuniform float uCloudShadowStrength;\nvarying vec3 vEarthLocalPos;\n") +
            ECLIPSE_GLSL + shader.fragmentShader;
        const cloudCoverage = isEarthCloudCoverage ?
            `if ((uEarthCloudInsideShell < 0.5 && !gl_FrontFacing) || (uEarthCloudInsideShell >= 0.5 && gl_FrontFacing)) discard;
             diffuseColor.rgb = vec3(1.0);
             // Static deck: one sample of the cloud map in the planet's frame, so the
             // clouds move with the body. Material opacity still multiplies the result,
             // so the layer can be faded out from the UI in one place.
             // Three layers, three channels, three offsets. The low layer is the
             // one the map's own offset carries; the middle and high etages are
             // sampled shifted by however far their wind has taken them from it.
             vec4 tapLow = texture2D(map, vMapUv);
             vec4 tapMid = texture2D(map, vMapUv + uDeckShiftMid);
             vec4 tapHigh = texture2D(map, vMapUv + uDeckShiftHigh);
             float aLow = mix(tapLow.r, tapLow.a, uEarthCloudMaskUsesAlpha);
             float aMid = tapMid.g;
             float aHigh = tapHigh.b;
             // Coverage is a share of the sky, so the layers combine as a union:
             // one minus the chance that all three are clear along this ray.
             float cloudMask = 1.0 - (1.0 - aLow) * (1.0 - aMid) * (1.0 - aHigh);
             // Optical depth is not the union, though -- cirrus is a tenth the
             // thickness of the deck it crosses. These weights are the ratio of
             // the layers' extinction, so an overcast cirrus sheet attenuates a
             // tenth as much as an overcast stratus at the same coverage.
             float cloudWeight = clamp(aLow + 0.35 * aMid + 0.08 * aHigh, 0.0, 1.6);
             // The chord through the shell, at this view angle, times the
             // extinction, is the optical depth; the transmittance is what is left.
             vec3 cloudViewDir = normalize(cameraPosition - vEclipseWorld);
             float cloudViewMu = clamp(abs(dot(normalize(vCloudWorldNormal), cloudViewDir)), 0.0, 1.0);
             float cloudChordView = cloudChord(cloudViewMu, uCloudShell, uEarthCloudInsideShell);
             diffuseColor.a *= 1.0 - cloudTransmittance(cloudWeight, cloudChordView, uCloudExtinction);
` : "";

        const dayMask = isEarthCloudCoverage ?
            "" :
            "diffuseColor.rgb *= earthDayMapMask;\n             diffuseColor.a *= earthDayMapMask;";

        const surfaceCloudShadow = isEarthCloudCoverage ? "" : `
             if (uCloudShadowStrength > 0.001) {
                 vec3 csN = normalize(vEarthLocalPos);
                 float csSinAlt = dot(csN, uCloudShadowSunLocal);
                 vec3 csTangent = uCloudShadowSunLocal - csN * csSinAlt;
                 float csTanLen = length(csTangent);
                 if (csSinAlt > 0.02 && csTanLen > 1e-5) {
                     vec3 csProj = csTangent / csTanLen;
                     float csTheta = acos(clamp(csN.y, -1.0, 1.0));
                     float csPhi = atan(vEarthLocalPos.z, -vEarthLocalPos.x);
                     float csU = csPhi / 6.2831853;
                     if (csU < 0.0) csU += 1.0;
                     float csV = csTheta / 3.14159265;
                     float csSinTheta = clamp(sin(csTheta), 0.12, 1.0);
                     vec3 csEu = vec3(sin(csPhi), 0.0, cos(csPhi));
                     vec3 csEv = vec3(-cos(csPhi) * csN.y, -csSinTheta, sin(csPhi) * csN.y);
                     float csOffsetKm = 16.0 * csSinAlt / max(csTanLen, 0.15);
                     vec2 csShift = vec2(dot(csProj, csEu) * csOffsetKm / (6.2831853 * 6371.0 * csSinTheta),
                                         dot(csProj, csEv) * csOffsetKm / (3.14159265 * 6371.0));
                     vec2 csUv = vec2(csU, csV) + uCloudShadowUvOffset;
                     // Round-13: the deck is static again, so the shadow is a
                     // single sample of the same fixed mask, sun-shifted.
                     vec4 csTap = texture2D(uCloudShadowMap, csUv + csShift);
                     float csMask = mix(csTap.r, csTap.a, uCloudShadowUseAlpha);
                     diffuseColor.rgb *= 1.0 - uCloudShadowStrength * smoothstep(0.30, 0.62, csMask);
                 }
             }`;
        shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>\n             ${cloudCoverage}vec3 earthSurfaceNormal = normalize(vEclipseWorld - uEarthCenter);\n             vec3 earthToSun = normalize(uEclipseSun - uEarthCenter);\n             float earthDayMapMask = smoothstep(-0.04, 0.04, dot(earthSurfaceNormal, earthToSun));\n             ${dayMask}${surfaceCloudShadow}`);
        shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n             float eclipseVisibility = solarVisibility(vEclipseWorld);\n             reflectedLight.directDiffuse *= eclipseVisibility;\n             reflectedLight.directSpecular *= eclipseVisibility;` + (isEarthCloudCoverage ? "\n             reflectedLight.directSpecular = vec3(0.0);\n             reflectedLight.indirectSpecular = vec3(0.0);\n             // Sunlight reaching the deck from below the horizon has crossed the\n             // shell sideways, and that path is long. This is what darkens the\n             // cloud before the surface does: the terminator gets a soft edge\n             // from the medium instead of a hard one from the light.\n             vec3 cloudSunDir = normalize(uEclipseSun - vEclipseWorld);\n             float cloudSunMu = dot(normalize(vCloudWorldNormal), cloudSunDir);\n             float cloudSunChord = cloudSunMu < 0.0 ? cloudChord(-cloudSunMu, uCloudShell, 0.0) : 0.0;\n             reflectedLight.directDiffuse *= cloudTransmittance(cloudWeight, cloudSunChord, uCloudExtinction);" : ""));
    };
    material.customProgramCacheKey = () => "earth-disc-eclipse-day-mask-v6-" + (isEarthCloudCoverage ? "cloud" : "surface");
    material.needsUpdate = true;
}

function updateEarthEclipse() {
    const moon = objectRegistry.moon;
    const sun = objectRegistry.sun;
    if (!moon || !sun) return;
    sun.getWorldPosition(eclipseUniforms.uEclipseSun.value);
    eclipseUniforms.uEclipseSunRadius.value = sun.userData?.radius || sun.geometry?.parameters?.radius || 0;
    const earth = objectRegistry.earth;
    if (earth) earth.getWorldPosition(eclipseUniforms.uEarthCenter.value);
    if (earth && !bodyOnScreen(earth, earth.geometry.parameters.radius * 1.1)) return;
    moon.getWorldPosition(eclipseUniforms.uEclipseMoon.value);
    eclipseUniforms.uEclipseMoonRadius.value = moon.geometry.parameters.radius;
    const clouds = cloudMeshes.earth;
    if (clouds) installEarthEclipse(clouds.material);
}
