function installEarthEclipse(material) {
    if (!material || material.userData.eclipseInstalled) return;
    material.userData.eclipseInstalled = true;
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, eclipseUniforms);
        shader.vertexShader =
            'varying vec3 vEclipseWorld;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `#include <project_vertex>
             vEclipseWorld =
                 (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );
        shader.fragmentShader =
            'varying vec3 vEclipseWorld;\n' +
            ECLIPSE_GLSL +
            shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <lights_fragment_end>',
            `#include <lights_fragment_end>
             float eclipseVisibility = solarVisibility(vEclipseWorld);
             reflectedLight.directDiffuse *= eclipseVisibility;
             reflectedLight.directSpecular *= eclipseVisibility;`
        );
    };
    material.customProgramCacheKey = () => 'earth-disc-eclipse';
    material.needsUpdate = true;
}
function updateEarthEclipse() {
    const moon = objectRegistry.moon;
    const sun = objectRegistry.sun;
    if (!moon || !sun) return;
    sun.getWorldPosition(eclipseUniforms.uEclipseSun.value);
    eclipseUniforms.uEclipseSunRadius.value = sun.geometry.parameters.radius;
    const earth = objectRegistry.earth;
    if (earth && !bodyOnScreen(earth, earth.geometry.parameters.radius * 1.1)) return;
    moon.getWorldPosition(eclipseUniforms.uEclipseMoon.value);
    eclipseUniforms.uEclipseMoonRadius.value = moon.geometry.parameters.radius;
    const clouds = cloudMeshes.earth;
    if (clouds) installEarthEclipse(clouds.material);
}