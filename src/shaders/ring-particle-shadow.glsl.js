function installRingParticleShadow(material, planet, isMarker = false) {
    const uniforms = {
        uEclipseMoon: {
            value: new THREE.Vector3
        },
        uEclipseSun: eclipseUniforms.uEclipseSun,
        uEclipseSunRadius: eclipseUniforms.uEclipseSunRadius,
        uEclipseMoonRadius: {
            value: planet.geometry.parameters.radius
        }
    };
    planet.getWorldPosition(uniforms.uEclipseMoon.value);
    ringShadowBindings.push({
        planet: planet,
        uniforms: uniforms
    });
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = shader => {
        if (previous) previous.call(material, shader);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = "varying vec3 vRingParticleWorld;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `\n            #include <project_vertex>\n            vec4 ringParticlePosition = vec4(transformed, 1.0);\n            #ifdef USE_INSTANCING\n                ringParticlePosition =\n                    instanceMatrix * ringParticlePosition;\n            #endif\n            vRingParticleWorld =\n                (modelMatrix * ringParticlePosition).xyz;\n            `);
        shader.fragmentShader = "varying vec3 vRingParticleWorld;\n" + ECLIPSE_GLSL + shader.fragmentShader;
        if (isMarker) {
            shader.fragmentShader = shader.fragmentShader.replace(/#include <(opaque_fragment|output_fragment)>/, `\n                float ringSunVisibility =\n                    solarVisibility(vRingParticleWorld);\n                outgoingLight *= ringSunVisibility;\n                diffuseColor.a *= ringSunVisibility;\n                $&\n                `);
        } else {
            shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>", `\n                #include <lights_fragment_end>\n                float ringSunVisibility =\n                    solarVisibility(vRingParticleWorld);\n                reflectedLight.directDiffuse *= ringSunVisibility;\n                reflectedLight.directSpecular *= ringSunVisibility;\n                `);
        }
    };
    material.customProgramCacheKey = () => isMarker ? "ring-marker-eclipse" : "ring-mesh-eclipse";
    material.needsUpdate = true;
}

function updateRingParticleShadows() {
    for (const binding of ringShadowBindings) {
        binding.planet.getWorldPosition(binding.uniforms.uEclipseMoon.value);
    }
}
