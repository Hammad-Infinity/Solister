const SUN_PHOTOSPHERE_VERTEX = `\n    ${LDB_VERTEX_PARS}\n    void main() {\n        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);${LDB_VERTEX_TAIL}\n    }\n`;

const SUN_PHOTOSPHERE_FRAGMENT = `\n    ${LDB_FRAGMENT_PARS}\n    void main() {${LDB_FRAGMENT_HEAD}\n        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);\n    }\n`;

let sunFlareTextures = null;

function getSunFlareTextures() {
    if (sunFlareTextures) return sunFlareTextures;
    const loader = new THREE.TextureLoader;
    const load = (name, folder = "data/flares/") => {
        const texture = loader.load(new URL("./" + folder + name, document.baseURI).href);
        if ("colorSpace" in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        return texture;
    };
    // Flare kit that ships under assets/textures/flares; the old data/flares paths
    // do not exist in the distribution and logged a 404 on every boot.
    const flare = name => load(name, "assets/textures/flares/");
    sunFlareTextures = {
        source: flare("lensstar.png"),
        ghosts: [ flare("flare3.png"), flare("flare4.png"), flare("flare5.png"), flare("flare6.png") ]
    };
    return sunFlareTextures;
}

function destroySunLensArtifacts() {
    if (!sunLensArtifacts) return;
    if (sunLensArtifacts.parent) sunLensArtifacts.parent.remove(sunLensArtifacts);
    for (const item of sunLensArtifacts.userData.flareItems || []) item.sprite.material.dispose();
    sunLensArtifacts.clear();
    sunLensArtifacts = null;
}

function createSunLensArtifacts() {
    destroySunLensArtifacts();
    if (!camera) return null;
    const textures = getSunFlareTextures();
    const root = new THREE.Group;
    root.name = "SunLensArtifacts";
    root.frustumCulled = false;
    root.visible = false;
    root.renderOrder = 100;
    const definitions = [ {
        map: textures.source,
        factor: 1,
        px: 54,
        distancePx: 94,
        sunScale: 2.8,
        opacity: .028,
        tint: 16777215,
        rotation: 0,
        aspect: 1
    }, {
        map: textures.ghosts[0],
        factor: .56,
        px: 28,
        distancePx: 34,
        sunScale: 0,
        opacity: .038,
        tint: 16768954,
        rotation: 0,
        aspect: 1
    }, {
        map: textures.ghosts[1],
        factor: -.22,
        px: 34,
        distancePx: 42,
        sunScale: 0,
        opacity: .047,
        tint: 13097215,
        rotation: 0,
        aspect: 1
    }, {
        map: textures.ghosts[2],
        factor: -.62,
        px: 25,
        distancePx: 29,
        sunScale: 0,
        opacity: .031,
        tint: 16771016,
        rotation: 0,
        aspect: 1
    }, {
        map: textures.ghosts[3],
        factor: 1.24,
        px: 30,
        distancePx: 38,
        sunScale: 0,
        opacity: .024,
        tint: 13360383,
        rotation: 0,
        aspect: 1
    } ];
    const flareItems = definitions.map(definition => {
        const material = new THREE.SpriteMaterial({
            map: definition.map,
            color: new THREE.Color(definition.tint),
            opacity: 0,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const sprite = new THREE.Sprite(material);
        sprite.center.set(.5, .5);
        sprite.position.set(0, 0, -2);
        sprite.scale.set(1, 1, 1);
        sprite.frustumCulled = false;
        sprite.renderOrder = 100;
        root.add(sprite);
        return {
            ...definition,
            sprite: sprite
        };
    });
    root.userData.flareItems = flareItems;
    root.userData.flareDepth = 2;
    camera.add(root);
    sunLensArtifacts = root;
    return root;
}

function createSunCorona() {
    if (!SUN_CORONA_ENABLED) return;
    const sun = objectRegistry["sun"];
    if (!sun || sunCoronaMesh) return;
    const profile = {
        shellScale: SUN_CORONA_SHELL_SCALE,
        intensity: SUN_CORONA_INTENSITY,
        power: SUN_CORONA_POWER,
        streamers: SUN_CORONA_STREAMERS
    };
    const baseRadius = sun.geometry.parameters.radius;
    const shellRadius = baseRadius * profile.shellScale;
    const coronaGeo = new THREE.SphereGeometry(shellRadius, 128, 128);
    const coronaMat = new THREE.ShaderMaterial({
        uniforms: {
            glowColor: {
                value: new THREE.Color(16777215)
            },
            limbColor: {
                value: new THREE.Color(16777215)
            },
            intensity: {
                value: profile.intensity
            },
            uSunCenter: {
                value: new THREE.Vector3
            },
            uSunRadius: {
                value: baseRadius
            },
            uShellRadius: {
                value: shellRadius
            },
            uPower: {
                value: profile.power
            },
            uDistGain: {
                value: 1
            },
            uStreamers: {
                value: profile.streamers
            },
            uStreamScale: {
                value: SUN_CORONA_STREAMER_SCALE
            },
            uTime: {
                value: 0
            }
        },
        vertexShader: `\n            varying vec3 vWorldPos;\n            varying vec3 vCoronaDir;${LDB_VERTEX_PARS}\n            void main() {\n                vec4 wp = modelMatrix * vec4(position, 1.0);\n                vWorldPos = wp.xyz;\n                vCoronaDir = normalize(position);\n                gl_Position = projectionMatrix * viewMatrix * wp;${LDB_VERTEX_TAIL}\n            }\n        `,
        fragmentShader: `\n            uniform vec3  glowColor;\n            uniform vec3  limbColor;\n            uniform float intensity;\n            uniform vec3  uSunCenter;\n            uniform float uSunRadius;\n            uniform float uShellRadius;\n            uniform float uPower;\n            uniform float uDistGain;\n            uniform float uStreamers;\n            uniform float uStreamScale;\n            uniform float uTime;\n            varying vec3  vWorldPos;\n            varying vec3 vCoronaDir;${LDB_FRAGMENT_PARS}\n            ${SINGLE_GLOW_COLUMN_GLSL}\n            float hash31(vec3 p) {\n                p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));\n                p *= 17.0;\n                return fract(p.x * p.y * p.z * (p.x + p.y + p.z));\n            }\n            float vnoise(vec3 x) {\n                vec3 i = floor(x);\n                vec3 f = fract(x);\n                f = f * f * (3.0 - 2.0 * f);\n                return mix(\n                    mix(mix(hash31(i + vec3(0.0, 0.0, 0.0)), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),\n                        mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),\n                    mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),\n                        mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),\n                    f.z);\n            }\n            float fbm3(vec3 p) {\n                float a = 0.5, s = 0.0;\n                for (int i = 0; i < 3; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }\n                return s;\n            }\n            void main() {${LDB_FRAGMENT_HEAD}\n                 \n                 \n                 \n                 \n                vec3  rayDir   = normalize(vWorldPos - cameraPosition);\n                vec3  toCenter = uSunCenter - cameraPosition;\n                float t        = dot(toCenter, rayDir);\n                vec3  closest  = cameraPosition + t * rayDir;\n                float impact   = length(uSunCenter - closest);\n                float ratio      = impact / uSunRadius;\n                float shellRatio = uShellRadius / uSunRadius;\n                 \n                float limb = smoothstep(0.90, 1.00, ratio);\n                if (limb <= 0.001) discard;\n                 \n                float outerChord = sqrt(max(uShellRadius*uShellRadius - impact*impact, 0.0));\n                float rayStart  = max(0.0, t - outerChord);\n                float rayFinish = t + outerChord;\n                if (impact < uSunRadius) {\n                    float innerChord = sqrt(max(uSunRadius*uSunRadius - impact*impact, 0.0));\n                    rayFinish = min(rayFinish, max(rayStart, t - innerChord));\n                }\n                if (rayFinish <= rayStart) discard;\n                 \n                float outer = length(vWorldPos - uSunCenter);\n                float edgeFade = 1.0 - smoothstep(uShellRadius * 0.82, uShellRadius, outer);\n                if (edgeFade <= 0.001) discard;\n                float effPower = max(uPower, 5.99 / log(max(shellRatio, 1.05)));\n                float bNorm = max(impact, 0.03*uSunRadius) / uSunRadius;\n                float t0 = rayStart / uSunRadius, t1 = rayFinish / uSunRadius;\n                float column = singleGlowColumn(bNorm, t0, t1, effPower);\n                vec3 closestRel = closest - uSunCenter;\n                float phase = 0.35 + 0.65*pow(1.0 - abs(dot(normalize(closestRel), rayDir)), 2.0);\n                float glow = column / (1.0 + column);\n                float base = limb * glow * phase * exp(-0.035 * column);\n                if (base <= 0.002) discard;\n                float rays = 1.0;\n                if (uStreamers > 0.001) {\n                    vec3 sd = normalize(vCoronaDir);\n                    float n = fbm3(sd * uStreamScale + vec3(uTime * 0.03));\n                    rays = 1.0 - uStreamers + uStreamers * 2.0 * n;\n                }\n                float fade = base * edgeFade * max(rays, 0.0);\n                vec3 col = mix(\n                    limbColor,\n                    glowColor,\n                    clamp((ratio - 1.0) / (shellRatio - 1.0), 0.0, 1.0)\n                );\n                vec3 radiance = col * fade * intensity * uDistGain;\n                float glare = smoothstep(0.02, 0.35, max(radiance.r, max(radiance.g, radiance.b)));\n                 \n                 \n                 \n                gl_FragColor = vec4(radiance, glare);\n            }\n        `,
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.NormalBlending,
        premultipliedAlpha: true
    });
    sunCoronaMesh = new THREE.Mesh(coronaGeo, coronaMat);
    sunCoronaMesh.userData.isSunCorona = true;
    sunCoronaMesh.userData.coronaProfile = profile;
    sun.userData.coronaVisualScale = profile.shellScale;
    sunCoronaMesh.renderOrder = 3;
    sun.add(sunCoronaMesh);
}

const SUN_HALO_VERTEX = `\n    uniform vec3 uSunCenter;\n    uniform float uHaloRadius;\n    uniform vec2 uViewport;\n    varying vec2 vCorner;${LDB_VERTEX_PARS}\n    void main() {\n        vCorner = position.xy;\n        vec4 mv = viewMatrix * vec4(uSunCenter, 1.0);\n        vec4 clip = projectionMatrix * mv;\n        vec2 viewport = max(uViewport, vec2(1.0));\n        clip.x += position.x * (2.0 * uHaloRadius / viewport.x) * clip.w;\n        clip.y += position.y * (2.0 * uHaloRadius / viewport.y) * clip.w;\n         \n         \n        clip.z -= clip.w * 0.00005;\n        gl_Position = clip;${LDB_VERTEX_TAIL}\n#if defined(USE_LOGDEPTHBUF) && defined(USE_LOGDEPTHBUF_EXT)\n        vLDBDepth = max(1.0, vLDBDepth - clip.w * 0.00005);\n#endif\n    }\n`;

const SUN_HALO_FRAGMENT = `\n    uniform float uGain;\n    varying vec2 vCorner;${LDB_FRAGMENT_PARS}\n    void main() {${LDB_FRAGMENT_HEAD}\n        float r = length(vCorner);\n        float inner = exp(-16.0 * r * r);\n        float outer = exp(-3.2 * r);\n        float cut = 1.0 - smoothstep(0.80, 1.0, r);\n        float L = (0.70 * inner + 0.30 * outer * outer) * cut * cut;\n        if (L < 0.0005) discard;\n        vec3 col = vec3(1.0);\n        gl_FragColor = vec4(col * L * uGain, 1.0);\n    }\n`;

function createSunHalo() {
    if (!SUN_CORONA_ENABLED) return;
    const sun = objectRegistry["sun"];
    if (!sun || sunHaloMesh) return;
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uSunCenter: {
                value: new THREE.Vector3
            },
            uHaloRadius: {
                value: 18
            },
            uViewport: {
                value: new THREE.Vector2(1, 1)
            },
            uGain: {
                value: 1
            }
        },
        vertexShader: SUN_HALO_VERTEX,
        fragmentShader: SUN_HALO_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        toneMapped: false
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
        vertexShader: SUN_PHOTOSPHERE_VERTEX,
        fragmentShader: SUN_PHOTOSPHERE_FRAGMENT,
        toneMapped: false
    });
    const sunGeo = new THREE.SphereGeometry(sunRadius, 128, 128);
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.userData = {
        planetKey: "sun",
        planetName: "Sun",
        index: -1,
        radius: sunRadius
    };
    solarSystem.add(sunMesh);
    objectRegistry["sun"] = sunMesh;
    sunCoronaMesh = null;
    sunHaloMesh = null;
    destroySunLensArtifacts();
    createSunCorona();
    createSunHalo();
    createSunLensArtifacts();
    return sunMesh;
}
