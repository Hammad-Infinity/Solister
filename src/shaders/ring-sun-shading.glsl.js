const ringSunShadingBindings = [];

const _ringSunScratch = new THREE.Vector3;

// One source of truth for the ring sun-shading terms. The production
// material patch below and tools/p3ringsunshading.mjs both use this.
// ringSunShadingTerms returns (direct-light factor, glow, planetshine).
const RING_SUN_FRAGMENT = `
uniform vec3 uRingSunPos;
uniform float uRingSunDensity;
uniform float uRingSunOpacity;
uniform float uRingSunGlow;
uniform vec3 uRingSunGlowColor;
uniform vec3 uRingShinePos;
uniform float uRingShineRadius;
uniform float uRingShineStrength;
uniform vec3 uRingShineColor;
varying vec3 vRingSunWorld;
varying vec3 vRingSunNormal;
float ringSunOpticalPath(vec3 axis, vec3 light, vec3 view) {
    return 1.0 / max(abs(dot(axis, light)), 0.06) + 1.0 / max(abs(dot(axis, view)), 0.06);
}
vec3 ringSunShadingTerms(vec3 fragWorld, vec3 fragNormal, float diffuseAlpha) {
    vec3 ringSunAxis = normalize(fragNormal);
    vec3 ringSunLight = normalize(uRingSunPos - fragWorld);
    vec3 ringSunView = normalize(cameraPosition - fragWorld);
    float ringSunFront = smoothstep(-0.05, 0.05, dot(ringSunAxis, ringSunLight) * dot(ringSunAxis, ringSunView));
    float ringSunAlpha = clamp(diffuseAlpha / uRingSunOpacity, 0.0, 1.0);
    float ringSunTransmit = exp(-uRingSunDensity * ringSunAlpha * ringSunOpticalPath(ringSunAxis, ringSunLight, ringSunView));
    float ringSunFactor = mix(ringSunTransmit, 1.0, ringSunFront);
    vec3 ringSunSunward = normalize(uRingSunPos - uRingShinePos);
    vec3 ringSunRel = fragWorld - uRingShinePos;
    float ringSunAlong = dot(ringSunRel, ringSunSunward);
    float ringSunPerp = length(ringSunRel - ringSunSunward * ringSunAlong);
    float ringSunCone = smoothstep(uRingShineRadius * 1.02, uRingShineRadius * 1.25, ringSunPerp);
    float ringSunUmbra = smoothstep(-uRingShineRadius * 0.5, uRingShineRadius * 0.06, ringSunAlong);
    float ringSunOpen = min(1.0, max(ringSunCone, ringSunUmbra));
    vec3 ringSunToPlanet = uRingShinePos - fragWorld;
    float ringSunPlanetDist = max(length(ringSunToPlanet), uRingShineRadius);
    float ringSunLitFace = clamp(0.5 - 0.5 * dot(ringSunToPlanet / ringSunPlanetDist, ringSunSunward), 0.0, 1.0);
    float ringSunFalloff = (uRingShineRadius / ringSunPlanetDist) * (uRingShineRadius / ringSunPlanetDist);
    float ringSunForward = max(0.0, dot(-ringSunLight, ringSunView));
    float ringSunScatter = 4.0 * ringSunAlpha * (1.0 - ringSunAlpha);
    float ringSunGlow = ringSunOpen * clamp((1.0 - ringSunFront) * uRingSunGlow * ringSunScatter * ringSunTransmit * ringSunForward * ringSunForward, 0.0, 1.0);
    float ringSunShine = ringSunOpen * uRingShineStrength * ringSunFalloff * ringSunLitFace * ringSunAlpha * (1.0 - ringSunFront);
    return vec3(ringSunFactor, ringSunGlow, ringSunShine);
}
`;

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
        shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n             vec3 ringSunTerms = ringSunShadingTerms(vRingSunWorld, vRingSunNormal, diffuseColor.a);\n             float ringSunFactor = ringSunTerms.x;\n             totalEmissiveRadiance = totalEmissiveRadiance * ringSunFactor + uRingSunGlowColor * ringSunTerms.y + uRingShineColor * ringSunTerms.z;`);
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
