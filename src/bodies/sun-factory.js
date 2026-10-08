// LDB_* log-depth shader snippets come from src/render/log-depth-glsl.js
// (published on globalThis for classic-script loading — see that file).
// Physically based photosphere: the Sun is not a flat white disc.
//
//   * NEUTRAL-WHITE PHOTOSPHERE — a restrained limb roll-off preserves a
//     bright white centre while leaving headroom for surface spark detail.
//   * GRANULATION — two slow octaves of direction-space value noise at a
//     few percent amplitude: the mottled photosphere reads up close without
//     flickering at distance.
//   * Surface sparks are a separate sphere-attached instanced layer; their
//     physical dimensions stay fixed while their emission responds to range.
//     Depth is written with the shared log-depth snippets.
const SUN_PHOTOSPHERE_VERTEX = `
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec3 vObjDir;${LDB_VERTEX_PARS}
    void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vObjDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * wp;${LDB_VERTEX_TAIL}
    }
`;
const SUN_PHOTOSPHERE_FRAGMENT = `
    uniform float uTime;
    uniform float uFocusGlow;
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec3 vObjDir;${LDB_FRAGMENT_PARS}
    float hash31(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float vnoise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(mix(hash31(i + vec3(0.0, 0.0, 0.0)), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
                mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
            mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
                mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
            f.z);
    }
    void main() {${LDB_FRAGMENT_HEAD}
        vec3 n = normalize(vNormalW);
        vec3 viewDir = normalize(cameraPosition - vPosW);
        float mu = clamp(dot(n, viewDir), 0.0, 1.0);
        // Keep the disc neutral white and bright, while leaving display
        // headroom for spike cores to read as distinct white surface features.
        float dark = 0.84 + 0.16 * mu;
        // Granulation stays monochrome so it cannot shift the Sun's colour.
        vec3 surfaceDir = normalize(vObjDir);
        float g1 = vnoise(surfaceDir * 34.0);
        float g2 = vnoise(surfaceDir * 11.0);
        float gran = 1.0 + 0.09 * (g1 - 0.5) + 0.05 * (g2 - 0.5);
        float glow = clamp(uFocusGlow, 0.0, 1.0) * 0.28;
        // Retain a little linear-light headroom so pure-white surface sparks
        // remain distinguishable against the bright photosphere.
        float radiance = clamp(dark * gran * (1.0 + glow * 0.3), 0.82, 0.93);
        gl_FragColor = vec4(vec3(radiance), 1.0);
    }
`;
// Dense, deterministic, sphere-attached white surface sparks.  Their lengths
// and widths are fixed in solar-radius units; perspective alone changes their
// apparent size.  Only their emission/opacity responds to camera distance.
const SUN_SURFACE_SPRITE_COUNT = 1600;
const SUN_SURFACE_SPRITE_VERTEX = `
    attribute vec3 iCenterDir;
    attribute vec3 iTangent;
    attribute vec2 iSize;
    attribute float iOpacity;
    attribute float iBrightness;
    attribute float iShape;
    uniform float uRadius;
    uniform float uLift;
    varying vec2 vUv;
    varying float vOpacity;
    varying float vBrightness;
    varying float vShape;${LDB_VERTEX_PARS}
    void main() {
        vec3 n = normalize(iCenterDir);
        vec3 t = normalize(iTangent - n * dot(iTangent, n));
        vec3 b = normalize(cross(n, t));
        vec3 tangentOffset = t * (position.x * iSize.x) + b * (position.y * iSize.y);
        vec3 surfaceDir = normalize(n + tangentOffset);
        vec3 localPos = surfaceDir * (uRadius + uLift);
        vUv = uv;
        vOpacity = iOpacity;
        vBrightness = iBrightness;
        vShape = iShape;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(localPos, 1.0);${LDB_VERTEX_TAIL}
    }
`;
const SUN_SURFACE_SPRITE_FRAGMENT = `
    uniform float uGlowGain;
    varying vec2 vUv;
    varying float vOpacity;
    varying float vBrightness;
    varying float vShape;${LDB_FRAGMENT_PARS}
    void main() {${LDB_FRAGMENT_HEAD}
        vec2 p = vUv * 2.0 - 1.0;
        float len = length(p);
        float roundFade = exp(-4.2 * dot(p, p)) * (1.0 - smoothstep(0.76, 1.0, len));
        float along = abs(p.x);
        float taper = 1.0 - smoothstep(0.78, 1.0, along);
        float halfWidth = mix(0.20, 0.78, sqrt(max(0.0, 1.0 - p.x * p.x)));
        float across = 1.0 - smoothstep(halfWidth * 0.48, halfWidth, abs(p.y));
        float streakFade = taper * across * exp(-2.8 * p.y * p.y / max(halfWidth * halfWidth, 0.035));
        float spikeWidth = 0.035 + 0.70 * sqrt(max(0.0, 1.0 - along));
        float spikeFade = taper * (1.0 - smoothstep(spikeWidth * 0.72, spikeWidth, abs(p.y)));
        float shape = roundFade;
        if (vShape > 0.5 && vShape < 1.5) shape = streakFade;
        else if (vShape >= 1.5) shape = spikeFade;
        float gain = clamp(vOpacity * vBrightness * uGlowGain, 0.0, 0.96);
        float core = smoothstep(0.34, 0.76, shape);
        float edge = smoothstep(0.012, 0.30, shape) * (1.0 - smoothstep(0.38, 0.80, shape));
        float alpha = min(0.97, gain * (shape + 0.42 * edge));
        if (alpha < 0.002) discard;
        // A narrow cool-grey shoulder outlines each neutral-white core so the
        // surface features remain visible against a nearly-white solar disc.
        vec3 spriteColor = mix(vec3(0.36, 0.40, 0.48), vec3(1.0), core);
        gl_FragColor = vec4(spriteColor, alpha);
    }
`;
function makeSunRandom(seed) {
    let state = seed >>> 0;
    return function () {
        state = (state + 0x6D2B79F5) | 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function createSunSurfaceSprites(sun) {
    if (!sun) return null;
    const count = SUN_SURFACE_SPRITE_COUNT;
    const plane = new THREE.PlaneGeometry(1, 1, 8, 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(plane.index);
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.setAttribute('uv', plane.getAttribute('uv'));
    plane.dispose();

    const centers = new Float32Array(count * 3);
    const tangents = new Float32Array(count * 3);
    const sizes = new Float32Array(count * 2);
    const opacities = new Float32Array(count);
    const brightnesses = new Float32Array(count);
    const shapes = new Float32Array(count);
    const rand = makeSunRandom(0x51A7B00B);
    for (let i = 0; i < count; i++) {
        const y = 1.0 - 2.0 * rand();
        const phi = Math.PI * 2.0 * rand();
        const radial = Math.sqrt(Math.max(0.0, 1.0 - y * y));
        const nx = Math.cos(phi) * radial;
        const ny = y;
        const nz = Math.sin(phi) * radial;
        centers.set([nx, ny, nz], i * 3);

        const refX = Math.abs(ny) > 0.93 ? 1.0 : 0.0;
        const refY = Math.abs(ny) > 0.93 ? 0.0 : 1.0;
        let tx = ny * 0.0 - nz * refY;
        let ty = nz * refX - nx * 0.0;
        let tz = nx * refY - ny * refX;
        const tLen = Math.hypot(tx, ty, tz) || 1.0;
        tx /= tLen; ty /= tLen; tz /= tLen;
        const bx = ny * tz - nz * ty;
        const by = nz * tx - nx * tz;
        const bz = nx * ty - ny * tx;
        const angle = rand() * Math.PI * 2.0;
        const ca = Math.cos(angle), sa = Math.sin(angle);
        tangents.set([tx * ca + bx * sa, ty * ca + by * sa, tz * ca + bz * sa], i * 3);

        const category = rand();
        let lengthR;
        if (category < 0.14) lengthR = 0.004 + rand() * 0.012;
        else if (category < 0.70) lengthR = 0.012 + Math.pow(rand(), 1.55) * 0.070;
        else lengthR = 0.060 + rand() * 0.140;
        const shapeRoll = rand();
        const shape = shapeRoll < 0.12 ? 0.0 : shapeRoll < 0.52 ? 1.0 : 2.0;
        const widthR = shape < 0.5
            ? lengthR * (0.62 + rand() * 0.34)
            : Math.max(0.00038, lengthR * (shape > 1.5 ? 0.024 + rand() * 0.15 : 0.045 + rand() * 0.38));
        sizes.set([lengthR, widthR], i * 2);
        opacities[i] = 0.45 + rand() * 0.50;
        brightnesses[i] = 0.80 + rand() * 1.50;
        shapes[i] = shape;
    }
    geometry.setAttribute('iCenterDir', new THREE.InstancedBufferAttribute(centers, 3));
    geometry.setAttribute('iTangent', new THREE.InstancedBufferAttribute(tangents, 3));
    geometry.setAttribute('iSize', new THREE.InstancedBufferAttribute(sizes, 2));
    geometry.setAttribute('iOpacity', new THREE.InstancedBufferAttribute(opacities, 1));
    geometry.setAttribute('iBrightness', new THREE.InstancedBufferAttribute(brightnesses, 1));
    geometry.setAttribute('iShape', new THREE.InstancedBufferAttribute(shapes, 1));
    geometry.instanceCount = count;

    const radius = sun.geometry?.parameters?.radius || 1.0;
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uRadius: { value: radius },
            uLift: { value: radius * 0.001 },
            uGlowGain: { value: 0.9 },
        },
        vertexShader: SUN_SURFACE_SPRITE_VERTEX,
        fragmentShader: SUN_SURFACE_SPRITE_FRAGMENT,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
        toneMapped: false,
    });
    sunSurfaceSpriteMesh = new THREE.Mesh(geometry, material);
    sunSurfaceSpriteMesh.name = 'SunSurfaceSprites';
    sunSurfaceSpriteMesh.renderOrder = 2;
    sunSurfaceSpriteMesh.frustumCulled = false;
    sunSurfaceSpriteMesh.userData.isSunSurfaceSprites = true;
    sun.add(sunSurfaceSpriteMesh);
    return sunSurfaceSpriteMesh;
}

const SUN_LENS_VERTEX = `
    attribute float aSize;
    attribute float aAspect;
    attribute float aAngle;
    attribute float aOpacity;
    attribute float aType;
    attribute vec3 aTint;
    uniform float uPixelRatio;
    varying float vAspect;
    varying float vAngle;
    varying float vOpacity;
    varying float vType;
    varying vec3 vTint;
    void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(1.0, aSize * uPixelRatio);
        vAspect = aAspect;
        vAngle = aAngle;
        vOpacity = aOpacity;
        vType = aType;
        vTint = aTint;
    }
`;
const SUN_LENS_FRAGMENT = `
    uniform float uGain;
    varying float vAspect;
    varying float vAngle;
    varying float vOpacity;
    varying float vType;
    varying vec3 vTint;
    void main() {
        vec2 p = (gl_PointCoord - 0.5) * 2.0;
        p.y *= max(vAspect, 0.25);
        float ca = cos(vAngle), sa = sin(vAngle);
        p = mat2(ca, -sa, sa, ca) * p;
        float r = length(p);
        float circle = exp(-3.6 * r * r) * (1.0 - smoothstep(0.78, 1.0, r));
        float ring = exp(-pow((r - 0.58) / 0.15, 2.0)) * 0.48;
        float streak = exp(-1.8 * p.x * p.x - 30.0 * p.y * p.y) * (1.0 - smoothstep(0.78, 1.0, abs(p.x)));
        float crossA = exp(-1.7 * p.x * p.x - 28.0 * p.y * p.y);
        float crossB = exp(-1.7 * p.y * p.y - 28.0 * p.x * p.x);
        float crossShape = max(crossA, crossB) * (1.0 - smoothstep(0.78, 1.0, r));
        float shape = circle;
        if (vType > 0.5 && vType < 1.5) shape = ring;
        else if (vType > 1.5 && vType < 2.5) shape = streak;
        else if (vType >= 2.5) shape = crossShape;
        float strength = vOpacity * uGain * shape;
        if (strength < 0.001) discard;
        gl_FragColor = vec4(vTint, strength);
    }
`;
function destroySunLensArtifacts() {
    if (!sunLensArtifacts) return;
    if (sunLensArtifacts.parent) sunLensArtifacts.parent.remove(sunLensArtifacts);
    sunLensArtifacts.geometry?.dispose();
    sunLensArtifacts.material?.dispose();
    sunLensArtifacts = null;
}
function createSunLensArtifacts() {
    destroySunLensArtifacts();
    if (!camera) return null;
    const factors = new Float32Array([1.0, 0.57, 0.28, -0.18, -0.43, -0.78, -1.18, -0.34]);
    const offsets = new Float32Array([
        0.00, 0.00, 0.00, 0.00,  0.00, 0.00,  0.00, 0.00,
        0.00, 0.00, 0.01, 0.00, -0.01, 0.01,  0.00, -0.01,
    ]);
    const count = factors.length;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) positions[i * 3 + 2] = -2.0;
    const sizes = new Float32Array([22, 12, 8, 6, 16, 10, 6, 24]);
    const aspects = new Float32Array([7.0, 1.0, 1.0, 1.0, 1.0, 5.0, 1.0, 12.0]);
    const angles = new Float32Array([0.0, 0.0, 0.0, 0.0, 0.0, 0.55, 0.0, 0.0]);
    const opacities = new Float32Array([0.018, 0.030, 0.022, 0.017, 0.016, 0.020, 0.014, 0.012]);
    const types = new Float32Array([2, 0, 1, 0, 0, 2, 3, 2]);
    const tints = new Float32Array([
        1.0, 0.99, 0.96,  1.0, 0.98, 0.94,  0.94, 0.97, 1.0,  1.0, 1.0, 1.0,
        0.98, 0.99, 1.0,  1.0, 0.98, 0.95,  0.96, 0.98, 1.0,  1.0, 0.99, 0.97,
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAspect', new THREE.BufferAttribute(aspects, 1));
    geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
    geometry.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));
    geometry.setAttribute('aType', new THREE.BufferAttribute(types, 1));
    geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uGain: { value: 0.0 },
            uPixelRatio: { value: renderer?.getPixelRatio?.() || 1.0 },
        },
        vertexShader: SUN_LENS_VERTEX,
        fragmentShader: SUN_LENS_FRAGMENT,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
    });
    sunLensArtifacts = new THREE.Points(geometry, material);
    sunLensArtifacts.name = 'SunLensArtifacts';
    sunLensArtifacts.frustumCulled = false;
    sunLensArtifacts.renderOrder = 100;
    sunLensArtifacts.userData.flareFactors = factors;
    sunLensArtifacts.userData.flareOffsets = offsets;
    camera.add(sunLensArtifacts);
    return sunLensArtifacts;
}

function createSunCorona() {
    if (!SUN_CORONA_ENABLED) return;
    const sun = objectRegistry['sun'];
    if (!sun || sunCoronaMesh) return;
    const profile = {
        shellScale: SUN_CORONA_SHELL_SCALE,
        intensity: SUN_CORONA_INTENSITY,
        power: SUN_CORONA_POWER,
        streamers: SUN_CORONA_STREAMERS,
    };
    const baseRadius  = sun.geometry.parameters.radius;
    const shellRadius = baseRadius * profile.shellScale;
    const coronaGeo   = new THREE.SphereGeometry(shellRadius, 128, 128);
    const coronaMat = new THREE.ShaderMaterial({
        uniforms: {
            glowColor:    { value: new THREE.Color(0xffffff) },
            limbColor:    { value: new THREE.Color(0xffffff) },
            intensity:    { value: profile.intensity },
            uSunCenter:   { value: new THREE.Vector3() },
            uSunRadius:   { value: baseRadius },
            uShellRadius: { value: shellRadius },
            uPower:       { value: profile.power },
            uDistGain:    { value: 1.0 },
            uStreamers:   { value: profile.streamers },
            uStreamScale: { value: SUN_CORONA_STREAMER_SCALE },
            uTime:        { value: 0 },
        },
        vertexShader: `
            varying vec3 vWorldPos;
            varying vec3 vCoronaDir;${LDB_VERTEX_PARS}
            void main() {
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vWorldPos = wp.xyz;
                vCoronaDir = normalize(position);
                gl_Position = projectionMatrix * viewMatrix * wp;${LDB_VERTEX_TAIL}
            }
        `,
        fragmentShader: `
            uniform vec3  glowColor;
            uniform vec3  limbColor;
            uniform float intensity;
            uniform vec3  uSunCenter;
            uniform float uSunRadius;
            uniform float uShellRadius;
            uniform float uPower;
            uniform float uDistGain;
            uniform float uStreamers;
            uniform float uStreamScale;
            uniform float uTime;
            varying vec3  vWorldPos;
            varying vec3 vCoronaDir;${LDB_FRAGMENT_PARS}
            ${SINGLE_GLOW_COLUMN_GLSL}
            float hash31(vec3 p) {
                p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
                p *= 17.0;
                return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
            }
            float vnoise(vec3 x) {
                vec3 i = floor(x);
                vec3 f = fract(x);
                f = f * f * (3.0 - 2.0 * f);
                return mix(
                    mix(mix(hash31(i + vec3(0.0, 0.0, 0.0)), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
                        mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
                    mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
                        mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
                    f.z);
            }
            float fbm3(vec3 p) {
                float a = 0.5, s = 0.0;
                for (int i = 0; i < 3; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
                return s;
            }
            void main() {${LDB_FRAGMENT_HEAD}
                // TRUE 3D GLOW: a volumetric r^-p light field around the sun.
                // The closed-form column antiderivative integrates it along the
                // whole ray chord, so it surrounds the sun in every direction
                // and still envelops the camera when it dives inside.
                vec3  rayDir   = normalize(vWorldPos - cameraPosition);
                vec3  toCenter = uSunCenter - cameraPosition;
                float t        = dot(toCenter, rayDir);
                vec3  closest  = cameraPosition + t * rayDir;
                float impact   = length(uSunCenter - closest);
                float ratio      = impact / uSunRadius;
                float shellRatio = uShellRadius / uSunRadius;
                // Glow starts just outside the photosphere (keeps disc crisp).
                float limb = smoothstep(0.90, 1.00, ratio);
                if (limb <= 0.001) discard;
                // Ray segment through the glow shell (valid from inside too).
                float outerChord = sqrt(max(uShellRadius*uShellRadius - impact*impact, 0.0));
                float rayStart  = max(0.0, t - outerChord);
                float rayFinish = t + outerChord;
                if (impact < uSunRadius) {
                    float innerChord = sqrt(max(uSunRadius*uSunRadius - impact*impact, 0.0));
                    rayFinish = min(rayFinish, max(rayStart, t - innerChord));
                }
                if (rayFinish <= rayStart) discard;
                // Soft boundary fade over the outer 18% - no visible shell edge.
                float outer = length(vWorldPos - uSunCenter);
                float edgeFade = 1.0 - smoothstep(uShellRadius * 0.82, uShellRadius, outer);
                if (edgeFade <= 0.001) discard;
                float effPower = max(uPower, 5.99 / log(max(shellRatio, 1.05)));
                float bNorm = max(impact, 0.03*uSunRadius) / uSunRadius;
                float t0 = rayStart / uSunRadius, t1 = rayFinish / uSunRadius;
                float column = singleGlowColumn(bNorm, t0, t1, effPower);
                vec3 closestRel = closest - uSunCenter;
                float phase = 0.35 + 0.65*pow(1.0 - abs(dot(normalize(closestRel), rayDir)), 2.0);
                float glow = column / (1.0 + column);
                float base = limb * glow * phase * exp(-0.035 * column);
                if (base <= 0.002) discard;
                float rays = 1.0;
                if (uStreamers > 0.001) {
                    vec3 sd = normalize(vCoronaDir);
                    float n = fbm3(sd * uStreamScale + vec3(uTime * 0.03));
                    rays = 1.0 - uStreamers + uStreamers * 2.0 * n;
                }
                float fade = base * edgeFade * max(rays, 0.0);
                vec3 col = mix(
                    limbColor,
                    glowColor,
                    clamp((ratio - 1.0) / (shellRatio - 1.0), 0.0, 1.0)
                );
                vec3 radiance = col * fade * intensity * uDistGain;
                float glare = smoothstep(0.02, 0.35, max(radiance.r, max(radiance.g, radiance.b)));
                // NOTE: deliberately NO gl_FragDepth write. The glow relies on
                // the depth buffer of opaque bodies, so it can never Z-fight
                // rings or nuclei when the near plane collapses near a comet.
                gl_FragColor = vec4(radiance, glare);
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.NormalBlending,
        premultipliedAlpha: true,
    });
    sunCoronaMesh = new THREE.Mesh(coronaGeo, coronaMat);
    sunCoronaMesh.userData.isSunCorona = true;
    sunCoronaMesh.userData.coronaProfile = profile;
    sun.userData.coronaVisualScale = profile.shellScale;
    sunCoronaMesh.renderOrder = 3;
    sun.add(sunCoronaMesh);
}
// Sun outward halo — the "really good sprite, fading glow" layer.
// A camera-facing quad centred on the sun, offset in clip space so it always
// tracks the disc's apparent size at any distance. The falloff is fully
// analytic (hot gaussian core + soft exponential tail, squared Hermite cut
// at the quad edge): smooth to zero, so there is no visible sprite boundary,
// no banding and no hard rim. Additive blending gives a true bloom-like
// glare; depth is tested (log-depth snippets) so bodies transiting in front
// of the sun occlude the halo correctly, while depthWrite stays false so it
// can never fight or occlude anything.
const SUN_HALO_VERTEX = `
    uniform vec3 uSunCenter;
    uniform float uHaloRadius;
    varying vec2 vCorner;${LDB_VERTEX_PARS}
    void main() {
        vCorner = position.xy;
        vec4 mv = viewMatrix * vec4(uSunCenter, 1.0);
        vec4 clip = projectionMatrix * mv;
        clip.x += position.x * uHaloRadius * projectionMatrix[0][0];
        clip.y += position.y * uHaloRadius * projectionMatrix[1][1];
        // A minute toward-camera bias closes the sub-pixel tangent gap between
        // the white photosphere and the additive halo without hiding transits.
        clip.z -= clip.w * 0.00005;
        gl_Position = clip;${LDB_VERTEX_TAIL}
#if defined(USE_LOGDEPTHBUF) && defined(USE_LOGDEPTHBUF_EXT)
        vLDBDepth = max(1.0, vLDBDepth - clip.w * 0.00005);
#endif
    }
`;
const SUN_HALO_FRAGMENT = `
    uniform float uGain;
    varying vec2 vCorner;${LDB_FRAGMENT_PARS}
    void main() {${LDB_FRAGMENT_HEAD}
        float r = length(vCorner);
        float inner = exp(-16.0 * r * r);
        float outer = exp(-3.2 * r);
        float cut = 1.0 - smoothstep(0.80, 1.0, r);
        float L = (0.70 * inner + 0.30 * outer * outer) * cut * cut;
        if (L < 0.0005) discard;
        vec3 col = vec3(1.0);
        gl_FragColor = vec4(col * L * uGain, 1.0);
    }
`;
function createSunHalo() {
    if (!SUN_CORONA_ENABLED) return;
    const sun = objectRegistry['sun'];
    if (!sun || sunHaloMesh) return;
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uSunCenter:   { value: new THREE.Vector3() },
            uHaloRadius:  { value: 1 },
            uGain:        { value: 1 },
        },
        vertexShader: SUN_HALO_VERTEX,
        fragmentShader: SUN_HALO_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
    });
    sunHaloMesh = new THREE.Mesh(geo, mat);
    sunHaloMesh.frustumCulled = false;
    sunHaloMesh.renderOrder = 4;
    sunHaloMesh.userData.isSunHalo = true;
    solarSystem.add(sunHaloMesh);
}
function createSun() {
    const sunRadius = km2u(695700);
    const sunMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uFocusGlow: { value: 0 },
        },
        vertexShader: SUN_PHOTOSPHERE_VERTEX,
        fragmentShader: SUN_PHOTOSPHERE_FRAGMENT,
        toneMapped: false,
    });
    const sunGeo = new THREE.SphereGeometry(sunRadius, 128, 128);
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.userData = { planetKey: 'sun', planetName: 'Sun', index: -1, radius: sunRadius };
    solarSystem.add(sunMesh);
    objectRegistry['sun'] = sunMesh;
    sunCoronaMesh = null;
    sunHaloMesh = null;
    sunSurfaceSpriteMesh = null;
    destroySunLensArtifacts();
    createSunSurfaceSprites(sunMesh);
    createSunCorona();
    createSunHalo();
    createSunLensArtifacts();
    return sunMesh;
}
