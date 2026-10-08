function setupMaterialEffects() {
    const saturnMesh     = objectRegistry['saturn'];
    const saturnRingMesh = objectRegistry['saturn-ring'];
    const earthMesh      = objectRegistry['earth'];
    const moonMesh       = objectRegistry['moon'];
    if (!saturnMesh || !saturnRingMesh || !earthMesh || !moonMesh) return;
    const SATURN_RADIUS = saturnMesh.geometry.parameters.radius;
    const RING_INNER = SATURN_RADIUS * 1.35;
    const RING_OUTER = SATURN_RADIUS * 2.4;
    const EARTH_RADIUS = earthMesh.geometry.parameters.radius;
    const MOON_RADIUS  = moonMesh.geometry.parameters.radius;
    saturnRingMat = saturnRingMesh.material;
    saturnRingMat.userData.uSaturnPos      = { value: new THREE.Vector3(0, 0, 0) };
    saturnRingMat.userData.uSaturnRadius   = { value: SATURN_RADIUS };
    saturnRingMat.userData.uShadowDarkness = { value: 0.15 };
    saturnRingMat.needsUpdate = true;
    saturnMat = saturnMesh.material;
    saturnMat.userData.uSaturnCenter    = { value: new THREE.Vector3() };
    saturnMat.userData.uRingNormal      = { value: new THREE.Vector3(0, 1, 0) };
    saturnMat.userData.uRingInner       = { value: RING_INNER };
    saturnMat.userData.uRingOuter       = { value: RING_OUTER };
    saturnMat.userData.uRingTex         = { value: null };
    saturnMat.userData.uRingShadowDark  = { value: 0.1 };
    saturnMat.needsUpdate = true;
    moonMat = moonMesh.material;
    moonMat.userData.uEarthPos    = { value: new THREE.Vector3() };
    moonMat.userData.uEarthRadius = { value: EARTH_RADIUS };
    moonMat.onBeforeCompile = (shader) => {
        shader.uniforms.uEarthPos    = moonMat.userData.uEarthPos;
        shader.uniforms.uEarthRadius = moonMat.userData.uEarthRadius;
        shader.vertexShader = 'varying vec3 vMoonWorldPos;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            'void main() {',
            `void main() {
                vMoonWorldPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;`
        );
        shader.fragmentShader =
            'uniform vec3 uEarthPos;\nuniform float uEarthRadius;\nvarying vec3 vMoonWorldPos;\n' +
            shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <lights_fragment_end>',
            `#include <lights_fragment_end>
            vec3 _fragFromEarth = vMoonWorldPos - uEarthPos;
            vec3 _earthToSun    = normalize( -uEarthPos );
            float _alongSun     = dot( _fragFromEarth, _earthToSun );
            float _earthShadow  = 0.0;
            if ( _alongSun < 0.0 ) {
                vec3 _perp = _fragFromEarth - _alongSun * _earthToSun;
                if ( length( _perp ) < uEarthRadius ) {
                    _earthShadow = 1.0;
                }
            }
            reflectedLight.directDiffuse *= mix( 1.0, 0.08, _earthShadow );`
        );
    };
    moonMat.needsUpdate = true;
    earthMat = earthMesh.material;
    earthMat.userData.uMoonPos    = { value: new THREE.Vector3() };
    earthMat.userData.uMoonRadius = { value: MOON_RADIUS };
    installEarthEclipse(earthMat);
    earthMat.needsUpdate = true;
}