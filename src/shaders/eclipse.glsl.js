function installEarthEclipse(material) {
    if (!material || material.userData.eclipseInstalled) return;
    material.userData.eclipseInstalled = true;
    const isEarthCloudCoverage = material.userData.earthCloudCoverage === true;
    const cloudMaskUsesAlpha = material.userData.uEarthCloudMaskUsesAlpha || {
        value: 0
    };
    if (isEarthCloudCoverage) material.userData.uEarthCloudMaskUsesAlpha = cloudMaskUsesAlpha;
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, eclipseUniforms);
        if (isEarthCloudCoverage) shader.uniforms.uEarthCloudMaskUsesAlpha = cloudMaskUsesAlpha;
        shader.vertexShader = "varying vec3 vEclipseWorld;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>\n             vEclipseWorld =\n                 (modelMatrix * vec4(transformed, 1.0)).xyz;`);
        shader.fragmentShader = (isEarthCloudCoverage ? "uniform float uEarthCloudMaskUsesAlpha;\n" : "") +
            "uniform vec3 uEarthCenter;\nvarying vec3 vEclipseWorld;\n" + ECLIPSE_GLSL + shader.fragmentShader;
        const cloudCoverage = isEarthCloudCoverage ?
            "diffuseColor.rgb = vec3(1.0);\n             diffuseColor.a *= mix(sampledDiffuseColor.r, sampledDiffuseColor.a, uEarthCloudMaskUsesAlpha);\n" : "";
        const dayMask = isEarthCloudCoverage ?
            "diffuseColor.a *= earthDayMapMask;" :
            "diffuseColor.rgb *= earthDayMapMask;\n             diffuseColor.a *= earthDayMapMask;";
        shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>\n             ${cloudCoverage}vec3 earthSurfaceNormal = normalize(vEclipseWorld - uEarthCenter);\n             vec3 earthToSun = normalize(uEclipseSun - uEarthCenter);\n             float earthDayMapMask = smoothstep(-0.04, 0.04, dot(earthSurfaceNormal, earthToSun));\n             ${dayMask}`);
        shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n             float eclipseVisibility = solarVisibility(vEclipseWorld);\n             reflectedLight.directDiffuse *= eclipseVisibility;\n             reflectedLight.directSpecular *= eclipseVisibility;`);
    };
    material.customProgramCacheKey = () => "earth-disc-eclipse-day-mask-v2-" + (isEarthCloudCoverage ? "cloud" : "surface");
    material.needsUpdate = true;
}

function updateEarthEclipse() {
    const moon = objectRegistry.moon;
    const sun = objectRegistry.sun;
    if (!moon || !sun) return;
    sun.getWorldPosition(eclipseUniforms.uEclipseSun.value);
    eclipseUniforms.uEclipseSunRadius.value = sun.geometry.parameters.radius;
    const earth = objectRegistry.earth;
    if (earth) earth.getWorldPosition(eclipseUniforms.uEarthCenter.value);
    if (earth && !bodyOnScreen(earth, earth.geometry.parameters.radius * 1.1)) return;
    moon.getWorldPosition(eclipseUniforms.uEclipseMoon.value);
    eclipseUniforms.uEclipseMoonRadius.value = moon.geometry.parameters.radius;
    const clouds = cloudMeshes.earth;
    if (clouds) installEarthEclipse(clouds.material);
}
