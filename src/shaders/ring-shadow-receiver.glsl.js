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
        uRingCenter: { value: new THREE.Vector3() },
        uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
        uRingInner:  { value: innerR },
        uRingOuter:  { value: outerR },
        uRingShadow: { value: darkness },
        uRingBands:  { value: bandArray },
        uRingBandCount: { value: bandCount },
    };
    const mat = planetMesh.material;
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = 'varying vec3 vRingShadowWorld;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `#include <project_vertex>
             vRingShadowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );
        shader.fragmentShader = `
            uniform vec3 uRingCenter;
            uniform vec3 uRingNormal;
            uniform float uRingInner;
            uniform float uRingOuter;
            uniform float uRingShadow;
            uniform float uRingBands[${MAX_BANDS * 2}];
            uniform int uRingBandCount;
            varying vec3 vRingShadowWorld;
        ` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <lights_fragment_end>',
            `#include <lights_fragment_end>
             {
                 vec3 _F = vRingShadowWorld;
                 vec3 _P = uRingCenter;
                 vec3 _N = normalize(uRingNormal);
                 vec3 _L = normalize(-_F);
                 float _FdN = dot(_F - _P, _N);
                 float _LdN = dot(_L, _N);
                 if (_FdN * _LdN < 0.0) {
                     float _t = -_FdN / _LdN;
                     float _r = length(_F + _t * _L - _P);
                     bool _inBand = false;
                     for (int _i = 0; _i < ${MAX_BANDS}; _i++) {
                         if (_i >= uRingBandCount) continue;
                         float _b0 = uRingBands[_i * 2];
                         float _b1 = uRingBands[_i * 2 + 1];
                         if (_r > _b0 && _r < _b1) { _inBand = true; }
                     }
                     if (_inBand) {
                         float _s = 1.0 - uRingShadow;
                         reflectedLight.directDiffuse  *= _s;
                         reflectedLight.directSpecular *= _s;
                     }
                 }
             }`
        );
    };
    mat.customProgramCacheKey = () => 'ring-shadow-receiver';
    mat.needsUpdate = true;
    return uniforms;
}