// One source of truth for the Moon's Earth-shadow factor. The production
// material patch below and tools/p3moonshadow.mjs both read this. The Sun is
// at the world origin in this production patch, hence earthToSun below.
const MOON_EARTH_SHADOW_GLSL = `
float moonEarthShadowFactor(vec3 fragWorld, vec3 earthPos, float earthRadius) {
    vec3 fragFromEarth = fragWorld - earthPos;
    vec3 earthToSun = normalize(-earthPos);
    float alongSun = dot(fragFromEarth, earthToSun);
    float earthShadow = 0.0;
    if (alongSun < 0.0) {
        vec3 perp = fragFromEarth - alongSun * earthToSun;
        if (length(perp) < earthRadius) earthShadow = 1.0;
    }
    return mix(1.0, 0.08, earthShadow);
}
`;

function setupMaterialEffects() {
    const saturnMesh = objectRegistry["saturn"];
    const saturnRingMesh = objectRegistry["saturn-ring"];
    const earthMesh = objectRegistry["earth"];
    const moonMesh = objectRegistry["moon"];
    if (!saturnMesh || !saturnRingMesh || !earthMesh || !moonMesh) return;
    const SATURN_RADIUS = saturnMesh.geometry.parameters.radius;
    const RING_INNER = SATURN_RADIUS * 1.35;
    const RING_OUTER = SATURN_RADIUS * 2.4;
    const EARTH_RADIUS = earthMesh.geometry.parameters.radius;
    const MOON_RADIUS = moonMesh.geometry.parameters.radius;
    saturnRingMat = saturnRingMesh.material;
    saturnRingMat.userData.uSaturnPos = {
        value: new THREE.Vector3(0, 0, 0)
    };
    saturnRingMat.userData.uSaturnRadius = {
        value: SATURN_RADIUS
    };
    saturnRingMat.userData.uShadowDarkness = {
        value: .15
    };
    saturnRingMat.needsUpdate = true;
    saturnMat = saturnMesh.material;
    saturnMat.userData.uSaturnCenter = {
        value: new THREE.Vector3
    };
    saturnMat.userData.uRingNormal = {
        value: new THREE.Vector3(0, 1, 0)
    };
    saturnMat.userData.uRingInner = {
        value: RING_INNER
    };
    saturnMat.userData.uRingOuter = {
        value: RING_OUTER
    };
    saturnMat.userData.uRingTex = {
        value: null
    };
    saturnMat.userData.uRingShadowDark = {
        value: .1
    };
    saturnMat.needsUpdate = true;
    moonMat = moonMesh.material;
    moonMat.userData.uEarthPos = {
        value: new THREE.Vector3
    };
    moonMat.userData.uEarthRadius = {
        value: EARTH_RADIUS
    };
    moonMat.onBeforeCompile = shader => {
        shader.uniforms.uEarthPos = moonMat.userData.uEarthPos;
        shader.uniforms.uEarthRadius = moonMat.userData.uEarthRadius;
        shader.vertexShader = "varying vec3 vMoonWorldPos;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("void main() {", `void main() {\n                vMoonWorldPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;`);
        shader.fragmentShader = "uniform vec3 uEarthPos;\nuniform float uEarthRadius;\nvarying vec3 vMoonWorldPos;\n" + MOON_EARTH_SHADOW_GLSL + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n            reflectedLight.directDiffuse *= moonEarthShadowFactor(vMoonWorldPos, uEarthPos, uEarthRadius);`);
    };
    moonMat.needsUpdate = true;
    earthMat = earthMesh.material;
    earthMat.userData.uMoonPos = {
        value: new THREE.Vector3
    };
    earthMat.userData.uMoonRadius = {
        value: MOON_RADIUS
    };
    installEarthEclipse(earthMat);
    earthMat.needsUpdate = true;
}
