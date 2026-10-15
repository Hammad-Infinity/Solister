import { createCometOcclusion, COMET_OCCLUSION_SHADER } from "./comet-occlusion.js";

const VERTEX_SHADER = `\nvarying vec3 vLocal;\nvoid main() {\n    vLocal = position;\n    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}`;

const FRAGMENT_SHADER = `\n#include <common>\n${COMET_OCCLUSION_SHADER}\nvarying vec3 vLocal;\nuniform vec3 eye;\nuniform vec3 sunDirection;\nuniform vec3 flow;\nuniform vec3 dustTint;\nuniform vec3 gasTint;\nuniform float opticalDepth;\nuniform float activity;\nuniform float dustRadius;\nuniform float gasLength;\nuniform float gasFraction;\nuniform float coreRadius;\nfloat comaNoise(vec3 point) {\n    return 0.5 + 0.25 * sin(point.x * 3.1 + flow.x) * sin(point.y * 4.3 - flow.y) +\n        0.25 * sin(point.z * 5.2 + point.x * 1.7 + flow.z);\n}\nfloat radialColumn(vec3 origin, vec3 direction, float start, float finish,\n    float core, float extent, float lengthScale) {\n    float along = -dot(origin, direction);\n    vec3 nearest = cross(origin, direction);\n    float impact = length(nearest);\n    float softened = sqrt(dot(nearest, nearest) + core * core);\n    vec2 extentHit = cometSphereHit(origin, direction, extent);\n    float clippedStart = max(start, extentHit.x);\n    float clippedFinish = min(finish, extentHit.y);\n    if (clippedFinish <= clippedStart) return 0.0;\n    float integral = (atan((clippedFinish - along) / softened) - atan((clippedStart - along) / softened)) / softened;\n    float boundary = 1.0 - smoothstep(extent * 0.65, extent, impact);\n    return max(0.0, integral) * exp(-impact / max(0.005, lengthScale)) * boundary;\n}\nvoid main() {\n    if (cometNucleusPixel()) discard;\n    if (activity <= 0.0 || opticalDepth <= 0.0) discard;\n    vec3 direction = normalize(vLocal - eye);\n    vec2 hit = cometSphereHit(eye, direction, 1.0);\n    float start = max(0.0, hit.x);\n    float finish = cometRayLimit(eye, direction, hit.y);\n    if (finish <= start) discard;\n    cometWriteDepth(eye,direction,start);\n    vec3 nearest = eye - direction * dot(eye, direction);\n    float pixelRadius = max(length(dFdx(nearest)), length(dFdy(nearest))) * 0.45;\n    float core = max(coreRadius, max(pixelRadius, max(0.07 * dustRadius, 0.000001)));\n    float dust = radialColumn(eye, direction, start, finish, core,\n        dustRadius, max(0.025, dustRadius * 0.65));\n    float gas = radialColumn(eye, direction, start, finish,\n        max(core, 0.065), 1.0, gasLength);\n    float variation = 0.0;\n    float weight = 0.0;\n    for (int i = 0; i < 6; i++) {\n        float t = mix(start, finish, (float(i) + 0.5) / 6.0);\n        vec3 point = eye + direction * t;\n        float sampleWeight = 1.0 / (dot(point, point) + 0.035);\n        float sunward = dot(normalize(point + vec3(0.000001)), sunDirection);\n        variation += sampleWeight * (0.94 + 0.12 * comaNoise(point)) *\n            (1.0 + 0.12 * sunward + 0.08 * max(0.0, -sunward));\n        weight += sampleWeight;\n    }\n    dust *= variation / max(weight, 0.000001);\n    dust *= 1.0 - 0.4 * gasFraction;\n    gas *= 0.24 + 0.85 * gasFraction;\n    float column = dust + gas;\n    float alpha = 1.0 - exp(-column * opticalDepth);\n    if (alpha < 0.00002) discard;\n    vec3 tint = (dust * dustTint + gas * gasTint) / max(column, 0.000001);\n    float scattering = 0.92 + 0.08 * max(0.0, dot(direction, sunDirection));\n    gl_FragColor = vec4(tint * scattering * 1.12, min(alpha, 0.98));\n    #include <tonemapping_fragment>\n    #include <colorspace_fragment>\n}`;

export function createCometVolume(THREE, registry, nucleus) {
    const occlusion = createCometOcclusion(THREE, registry, nucleus);
    const uniforms = {
        ...occlusion.uniforms,
        eye: {
            value: new THREE.Vector3
        },
        sunDirection: {
            value: new THREE.Vector3(1, 0, 0)
        },
        flow: {
            value: new THREE.Vector3
        },
        dustTint: {
            value: new THREE.Color(16117475)
        },
        gasTint: {
            value: new THREE.Color(9689018)
        },
        opticalDepth: {
            value: 0
        },
        activity: {
            value: 0
        },
        dustRadius: {
            value: .5
        },
        gasLength: {
            value: 1
        },
        gasFraction: {
            value: .12
        },
        coreRadius: {
            value: 5e-5
        }
    };
    const material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.BackSide,
        toneMapped: true,
        fog: false,
        extensions: {
            derivatives: true,
            fragDepth: true
        }
    });
    material.addEventListener("dispose", () => occlusion.dispose());
    const volume = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
    volume.name = "Diffuse three-dimensional comet coma";
    volume.raycast = () => {};
    volume.frustumCulled = true;
    volume.renderOrder = 5;
    const eye = new THREE.Vector3;
    const sun = new THREE.Vector3;
    const origin = new THREE.Vector3;
    volume.onBeforeRender = (renderer, scene, camera) => {
        camera.getWorldPosition(eye);
        uniforms.eye.value.copy(eye);
        volume.worldToLocal(uniforms.eye.value);
        const star = registry.sun;
        if (star) star.getWorldPosition(sun); else sun.set(0, 0, 0);
        uniforms.sunDirection.value.copy(sun);
        volume.worldToLocal(uniforms.sunDirection.value);
        uniforms.sunDirection.value.normalize();
        occlusion.update(volume, renderer, camera, origin, 1);
    };
    return volume;
}
