function installRingParticleShadow(material, planet, isMarker = false) {
    const uniforms = {
        uEclipseMoon: { value: new THREE.Vector3() },
        uEclipseSun: eclipseUniforms.uEclipseSun,
        uEclipseSunRadius: eclipseUniforms.uEclipseSunRadius,
        uEclipseMoonRadius: { value: planet.geometry.parameters.radius }
    };
    planet.getWorldPosition(uniforms.uEclipseMoon.value);
    ringShadowBindings.push({ planet, uniforms });
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = shader => {
        if (previous) previous.call(material, shader);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = 'varying vec3 vRingParticleWorld;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `
            #include <project_vertex>
            vec4 ringParticlePosition = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
                ringParticlePosition =
                    instanceMatrix * ringParticlePosition;
            #endif
            vRingParticleWorld =
                (modelMatrix * ringParticlePosition).xyz;
            `
        );
        shader.fragmentShader =
            'varying vec3 vRingParticleWorld;\n' +
            ECLIPSE_GLSL +
            shader.fragmentShader;
        if (isMarker) {
            shader.fragmentShader = shader.fragmentShader.replace(
                /#include <(opaque_fragment|output_fragment)>/,
                `
                float ringSunVisibility =
                    solarVisibility(vRingParticleWorld);
                outgoingLight *= ringSunVisibility;
                diffuseColor.a *= ringSunVisibility;
                $&
                `
            );
        } else {
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <lights_fragment_end>',
                `
                #include <lights_fragment_end>
                float ringSunVisibility =
                    solarVisibility(vRingParticleWorld);
                reflectedLight.directDiffuse *= ringSunVisibility;
                reflectedLight.directSpecular *= ringSunVisibility;
                `
            );
        }
    };
    material.customProgramCacheKey = () =>
        isMarker ? 'ring-marker-eclipse' : 'ring-mesh-eclipse';
    material.needsUpdate = true;
}
function updateRingParticleShadows() {
    for (const binding of ringShadowBindings) {
        binding.planet.getWorldPosition(binding.uniforms.uEclipseMoon.value);
    }
}