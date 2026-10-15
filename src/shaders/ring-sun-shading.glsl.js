const ringSunShadingBindings = [];

const _ringSunScratch = new THREE.Vector3;

const RING_SUN_FRAGMENT = `\nuniform vec3 uRingSunPos;\nuniform float uRingSunDensity;\nuniform float uRingSunOpacity;\nuniform float uRingSunGlow;\nuniform vec3 uRingSunGlowColor;\nuniform vec3 uRingShinePos;\nuniform float uRingShineRadius;\nuniform float uRingShineStrength;\nuniform vec3 uRingShineColor;\nvarying vec3 vRingSunWorld;\nvarying vec3 vRingSunNormal;\nfloat ringSunOpticalPath(vec3 axis, vec3 light, vec3 view) {\n    return 1.0 / max(abs(dot(axis, light)), 0.06) + 1.0 / max(abs(dot(axis, view)), 0.06);\n}\n`;

function installRingSunShading(material, options = {}) {
    if (!material || material.userData.ringSunShading) return;
    const previous = material.onBeforeCompile;
    const cacheKey = material.customProgramCacheKey();
    const uniforms = {
        uRingSunPos: {
            value: new THREE.Vector3
        },
        uRingSunDensity: {
            value: options.density ?? 1.2
        },
        uRingSunOpacity: {
            value: Math.max(.001, options.opacity ?? material.opacity ?? 1)
        },
        uRingSunGlow: {
            value: options.glow ?? .4
        },
        uRingSunGlowColor: {
            value: new THREE.Color(options.glowColor ?? 16777215)
        },
        uRingShinePos: {
            value: new THREE.Vector3
        },
        uRingShineRadius: {
            value: options.shineRadius ?? 1
        },
        uRingShineStrength: {
            value: options.shine ?? 0
        },
        uRingShineColor: {
            value: new THREE.Color(options.shineColor ?? 16777215)
        }
    };
    material.onBeforeCompile = function(shader, renderer) {
        if (previous) previous.call(this, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = "varying vec3 vRingSunWorld;\nvarying vec3 vRingSunNormal;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\n             vRingSunWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n             vRingSunNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);`);
        shader.fragmentShader = RING_SUN_FRAGMENT + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n             vec3 ringSunAxis = normalize(vRingSunNormal);\n             vec3 ringSunLight = normalize(uRingSunPos - vRingSunWorld);\n             vec3 ringSunView = normalize(cameraPosition - vRingSunWorld);\n             float ringSunFront = smoothstep(-0.05, 0.05, dot(ringSunAxis, ringSunLight) * dot(ringSunAxis, ringSunView));\n             float ringSunAlpha = clamp(diffuseColor.a / uRingSunOpacity, 0.0, 1.0);\n             float ringSunTransmit = exp(-uRingSunDensity * ringSunAlpha * ringSunOpticalPath(ringSunAxis, ringSunLight, ringSunView));\n             float ringSunFactor = mix(ringSunTransmit, 1.0, ringSunFront);\n             vec3 ringSunSunward = normalize(uRingSunPos - uRingShinePos);\n             vec3 ringSunRel = vRingSunWorld - uRingShinePos;\n             float ringSunAlong = dot(ringSunRel, ringSunSunward);\n             float ringSunPerp = length(ringSunRel - ringSunSunward * ringSunAlong);\n             float ringSunCone = smoothstep(uRingShineRadius * 1.02, uRingShineRadius * 1.25, ringSunPerp);\n             float ringSunUmbra = smoothstep(-uRingShineRadius * 0.5, uRingShineRadius * 0.06, ringSunAlong);\n             float ringSunOpen = min(1.0, max(ringSunCone, ringSunUmbra));\n             vec3 ringSunToPlanet = uRingShinePos - vRingSunWorld;\n             float ringSunPlanetDist = max(length(ringSunToPlanet), uRingShineRadius);\n             float ringSunLitFace = clamp(0.5 - 0.5 * dot(ringSunToPlanet / ringSunPlanetDist, ringSunSunward), 0.0, 1.0);\n             float ringSunFalloff = (uRingShineRadius / ringSunPlanetDist) * (uRingShineRadius / ringSunPlanetDist);\n             float ringSunForward = max(0.0, dot(-ringSunLight, ringSunView));\n             float ringSunScatter = 4.0 * ringSunAlpha * (1.0 - ringSunAlpha);\n             float ringSunGlow = ringSunOpen * clamp((1.0 - ringSunFront) * uRingSunGlow * ringSunScatter * ringSunTransmit * ringSunForward * ringSunForward, 0.0, 1.0);\n             float ringSunShine = ringSunOpen * uRingShineStrength * ringSunFalloff * ringSunLitFace * ringSunAlpha * (1.0 - ringSunFront);\n             totalEmissiveRadiance = totalEmissiveRadiance * ringSunFactor + uRingSunGlowColor * ringSunGlow + uRingShineColor * ringSunShine;`);
        shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n             reflectedLight.directDiffuse *= ringSunFactor;\n             reflectedLight.directSpecular *= ringSunFactor;`);
    };
    material.customProgramCacheKey = () => cacheKey + "|ring-sun-shading";
    material.userData.ringSunShading = uniforms;
    material.needsUpdate = true;
    ringSunShadingBindings.push({
        material: material,
        uniforms: uniforms,
        body: options.body
    });
}

function updateRingSunShading() {
    const sun = objectRegistry && objectRegistry["sun"];
    if (sun) sun.getWorldPosition(_ringSunScratch); else _ringSunScratch.set(0, 0, 0);
    for (const binding of ringSunShadingBindings) {
        binding.uniforms.uRingSunPos.value.copy(_ringSunScratch);
        if (binding.body) binding.body.getWorldPosition(binding.uniforms.uRingShinePos.value);
    }
}
