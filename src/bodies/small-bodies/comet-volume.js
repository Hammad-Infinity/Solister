import { createCometOcclusion, COMET_OCCLUSION_SHADER } from './comet-occlusion.js';

const VERTEX_SHADER = `
varying vec3 vLocal;
void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT_SHADER = `
#include <common>
${COMET_OCCLUSION_SHADER}
varying vec3 vLocal;
uniform vec3 eye;
uniform vec3 sunDirection;
uniform vec3 flow;
uniform vec3 dustTint;
uniform vec3 gasTint;
uniform float opticalDepth;
uniform float activity;
uniform float dustRadius;
uniform float gasLength;
uniform float gasFraction;
uniform float coreRadius;
float comaNoise(vec3 point) {
    return 0.5 + 0.25 * sin(point.x * 3.1 + flow.x) * sin(point.y * 4.3 - flow.y) +
        0.25 * sin(point.z * 5.2 + point.x * 1.7 + flow.z);
}
float radialColumn(vec3 origin, vec3 direction, float start, float finish,
    float core, float extent, float lengthScale) {
    float along = -dot(origin, direction);
    vec3 nearest = cross(origin, direction);
    float impact = length(nearest);
    float softened = sqrt(dot(nearest, nearest) + core * core);
    vec2 extentHit = cometSphereHit(origin, direction, extent);
    float clippedStart = max(start, extentHit.x);
    float clippedFinish = min(finish, extentHit.y);
    if (clippedFinish <= clippedStart) return 0.0;
    float integral = (atan((clippedFinish - along) / softened) - atan((clippedStart - along) / softened)) / softened;
    float boundary = 1.0 - smoothstep(extent * 0.65, extent, impact);
    return max(0.0, integral) * exp(-impact / max(0.005, lengthScale)) * boundary;
}
void main() {
    if (cometNucleusPixel()) discard;
    if (activity <= 0.0 || opticalDepth <= 0.0) discard;
    vec3 direction = normalize(vLocal - eye);
    vec2 hit = cometSphereHit(eye, direction, 1.0);
    float start = max(0.0, hit.x);
    float finish = cometRayLimit(eye, direction, hit.y);
    if (finish <= start) discard;
    cometWriteDepth(eye,direction,start);
    vec3 nearest = eye - direction * dot(eye, direction);
    float pixelRadius = max(length(dFdx(nearest)), length(dFdy(nearest))) * 0.45;
    float core = max(coreRadius, max(pixelRadius, max(0.07 * dustRadius, 0.000001)));
    float dust = radialColumn(eye, direction, start, finish, core,
        dustRadius, max(0.025, dustRadius * 0.65));
    float gas = radialColumn(eye, direction, start, finish,
        max(core, 0.065), 1.0, gasLength);
    float variation = 0.0;
    float weight = 0.0;
    for (int i = 0; i < 6; i++) {
        float t = mix(start, finish, (float(i) + 0.5) / 6.0);
        vec3 point = eye + direction * t;
        float sampleWeight = 1.0 / (dot(point, point) + 0.035);
        float sunward = dot(normalize(point + vec3(0.000001)), sunDirection);
        variation += sampleWeight * (0.94 + 0.12 * comaNoise(point)) *
            (1.0 + 0.12 * sunward + 0.08 * max(0.0, -sunward));
        weight += sampleWeight;
    }
    dust *= variation / max(weight, 0.000001);
    dust *= 1.0 - 0.4 * gasFraction;
    gas *= 0.24 + 0.85 * gasFraction;
    float column = dust + gas;
    float alpha = 1.0 - exp(-column * opticalDepth);
    if (alpha < 0.00002) discard;
    vec3 tint = (dust * dustTint + gas * gasTint) / max(column, 0.000001);
    float scattering = 0.92 + 0.08 * max(0.0, dot(direction, sunDirection));
    gl_FragColor = vec4(tint * scattering * 1.12, min(alpha, 0.98));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;


export function createCometVolume(THREE, registry, nucleus) {
    const occlusion = createCometOcclusion(THREE, registry, nucleus);
    const uniforms = {
        ...occlusion.uniforms,
        eye: { value: new THREE.Vector3() },
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        flow: { value: new THREE.Vector3() },
        dustTint: { value: new THREE.Color(0xf5eee3) },
        gasTint: { value: new THREE.Color(0x93d7ba) },
        opticalDepth: { value: 0 },
        activity: { value: 0 },
        dustRadius: { value: 0.5 },
        gasLength: { value: 1 },
        gasFraction: { value: 0.12 },
        coreRadius: { value: 0.00005 },
    };
    const material = new THREE.ShaderMaterial({
        uniforms, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER,
        transparent: true, depthWrite: false, depthTest: true,
        side: THREE.BackSide, toneMapped: true, fog: false,
        extensions: { derivatives: true, fragDepth: true },
    });
    material.addEventListener('dispose', () => occlusion.dispose());
    const volume = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
    volume.name = 'Diffuse three-dimensional comet coma';
    volume.raycast = () => {};
    volume.frustumCulled = true;
    volume.renderOrder = 5;
    const eye = new THREE.Vector3();
    const sun = new THREE.Vector3();
    const origin = new THREE.Vector3();
    volume.onBeforeRender = (renderer, scene, camera) => {
        camera.getWorldPosition(eye);
        uniforms.eye.value.copy(eye);
        volume.worldToLocal(uniforms.eye.value);
        const star = registry.sun;
        if (star) star.getWorldPosition(sun);
        else sun.set(0, 0, 0);
        uniforms.sunDirection.value.copy(sun);
        volume.worldToLocal(uniforms.sunDirection.value);
        uniforms.sunDirection.value.normalize();
        occlusion.update(volume, renderer, camera, origin, 1);
    };
    return volume;
}
