function installRingShadowReceiver(planetMesh, innerR, outerR, darkness, bands) {
    const MAX_BANDS = 10;
    const bandArray = new Float32Array(MAX_BANDS * 2);
    let bandCount;
    if (bands && bands.length) {
        bandCount = Math.min(bands.length, MAX_BANDS);
        for (let i = 0; i < bandCount; i++) {
            bandArray[i * 2] = bands[i][0];
            bandArray[i * 2 + 1] = bands[i][1];
        }
    } else {
        bandArray[0] = innerR;
        bandArray[1] = outerR;
        bandCount = 1;
    }
    const uniforms = {
        uRingCenter: {
            value: new THREE.Vector3
        },
        uRingNormal: {
            value: new THREE.Vector3(0, 1, 0)
        },
        uRingInner: {
            value: innerR
        },
        uRingOuter: {
            value: outerR
        },
        uRingShadow: {
            value: darkness
        },
        uRingBands: {
            value: bandArray
        },
        uRingBandCount: {
            value: bandCount
        }
    };
    const mat = planetMesh.material;
    mat.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = "varying vec3 vRingShadowWorld;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>\n             vRingShadowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
        shader.fragmentShader = `\n            uniform vec3 uRingCenter;\n            uniform vec3 uRingNormal;\n            uniform float uRingInner;\n            uniform float uRingOuter;\n            uniform float uRingShadow;\n            uniform float uRingBands[${MAX_BANDS * 2}];\n            uniform int uRingBandCount;\n            varying vec3 vRingShadowWorld;\n        ` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n             {\n                 vec3 _F = vRingShadowWorld;\n                 vec3 _P = uRingCenter;\n                 vec3 _N = normalize(uRingNormal);\n                 vec3 _L = normalize(-_F);\n                 float _FdN = dot(_F - _P, _N);\n                 float _LdN = dot(_L, _N);\n                 if (_FdN * _LdN < 0.0) {\n                     float _t = -_FdN / _LdN;\n                     float _r = length(_F + _t * _L - _P);\n                     bool _inBand = false;\n                     for (int _i = 0; _i < ${MAX_BANDS}; _i++) {\n                         if (_i >= uRingBandCount) continue;\n                         float _b0 = uRingBands[_i * 2];\n                         float _b1 = uRingBands[_i * 2 + 1];\n                         if (_r > _b0 && _r < _b1) { _inBand = true; }\n                     }\n                     if (_inBand) {\n                         float _s = 1.0 - uRingShadow;\n                         reflectedLight.directDiffuse  *= _s;\n                         reflectedLight.directSpecular *= _s;\n                     }\n                 }\n             }`);
    };
    mat.customProgramCacheKey = () => "ring-shadow-receiver";
    mat.needsUpdate = true;
    return uniforms;
}
