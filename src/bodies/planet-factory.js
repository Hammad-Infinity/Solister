function julianDateFromDate(date) {
    return date.getTime() / 864e5 + 2440587.5;
}

function solveKepler(M, e) {
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 10; i++) {
        const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        E -= dE;
        if (Math.abs(dE) < 1e-9) break;
    }
    return E;
}

function keplerXYZ(a, e, I, wbar, Omega, M) {
    const omega = wbar - Omega;
    const E = solveKepler(M, e);
    const xp = a * (Math.cos(E) - e);
    const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const cw = Math.cos(omega), sw = Math.sin(omega);
    const cO = Math.cos(Omega), sO = Math.sin(Omega);
    const cI = Math.cos(I), sI = Math.sin(I);
    const X = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
    const Y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
    const Z = sw * sI * xp + cw * sI * yp;
    return {
        X: X,
        Y: Y,
        Z: Z
    };
}

function computePlanetPosition(key, date) {
    const el = J2000_ELEMENTS[key];
    if (!el) return {
        X: 0,
        Y: 0,
        Z: 0
    };
    const jd = julianDateFromDate(date);
    const T = (jd - 2451545) / 36525;
    const a = el.a[0] + el.a[1] * T;
    const e = el.e[0] + el.e[1] * T;
    const I = (el.I[0] + el.I[1] * T) * DEG;
    const L = (el.L[0] + el.L[1] * T) * DEG;
    const wbar = (el.w[0] + el.w[1] * T) * DEG;
    const Omega = (el.O[0] + el.O[1] * T) * DEG;
    let M = L - wbar;
    M = M % (2 * Math.PI);
    if (M > Math.PI) M -= 2 * Math.PI;
    if (M < -Math.PI) M += 2 * Math.PI;
    return keplerXYZ(a, e, I, wbar, Omega, M);
}

function eclipticToScene(X, Y, Z) {
    return {
        x: X * AU_UNITS,
        y: Z * AU_UNITS,
        z: -Y * AU_UNITS
    };
}

const AURORA_PROFILES = {
    earth: {
        mode: 0,
        ovalLat: 1.17,
        ovalWidth: .05,
        height: .085,
        tiltX: .06,
        tiltZ: .19,
        shell: 1.032,
        gain: .6,
        colorA: [ .22, 1, .42 ],
        colorB: [ 1, .3, .25 ],
        colorC: [ .62, .3, 1 ]
    },
    jupiter: {
        mode: 0,
        ovalLat: 1.29,
        ovalWidth: .05,
        height: .07,
        tiltX: .05,
        tiltZ: .17,
        shell: 1.02,
        gain: 1.05,
        colorA: [ .6, .48, 1 ],
        colorB: [ 1, .45, .78 ],
        colorC: [ .4, .8, 1 ]
    },
    saturn: {
        mode: 0,
        ovalLat: 1.31,
        ovalWidth: .05,
        height: .07,
        tiltX: 0,
        tiltZ: .01,
        shell: 1.022,
        gain: .6,
        colorA: [ .52, .5, 1 ],
        colorB: [ .45, .85, 1 ],
        colorC: [ .8, .5, 1 ]
    },
    uranus: {
        mode: 0,
        ovalLat: 1.22,
        ovalWidth: .07,
        height: .08,
        tiltX: .4,
        tiltZ: 1.03,
        shell: 1.03,
        gain: .4,
        colorA: [ .78, 1, .86 ],
        colorB: [ .85, .95, 1 ],
        colorC: [ .6, 1, .8 ]
    },
    neptune: {
        mode: 0,
        ovalLat: 1.2,
        ovalWidth: .07,
        height: .08,
        tiltX: .3,
        tiltZ: .82,
        shell: 1.03,
        gain: .38,
        colorA: [ 1, .45, .38 ],
        colorB: [ 1, .6, .45 ],
        colorC: [ .9, .4, .6 ]
    },
    // Mars and Venus deliberately have no entry: neither has a visible aurora, and on
    // the dark side the old profiles read as glowing green clouds. With no profile,
    // createPlanetAurora() builds nothing for either body.
};

const auroraShells = {};

const AURORA_VERTEX = `
    attribute float aLon;
    attribute float aH;
    varying vec3 vLocalDir;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying vec3 vBodyCenter;
    varying float vLon;
    varying float vH;
    ${LDB_VERTEX_PARS}
    void main() {
        vLon = aLon;
        vH = aH;
        vLocalDir = position;
        vBodyCenter = vec3(modelMatrix * vec4(0.0, 0.0, 0.0, 1.0));
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${LDB_VERTEX_TAIL}
    }
`;

const AURORA_FRAGMENT = `
    uniform float uTime;
    uniform float uIntensity;
    uniform vec3 uSunWorldPos;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec3 uColorC;
    uniform float uOvalLat;
    uniform float uOvalWidth;
    uniform float uMode;
    uniform float uSeed;
    varying vec3 vLocalDir;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying vec3 vBodyCenter;
    varying float vLon;
    varying float vH;
    ${LDB_FRAGMENT_PARS}
    float auroraHash(vec3 p) {
        p = fract(p * .3183099 + vec3(.1, .17, .13));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float auroraNoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(auroraHash(i), auroraHash(i + vec3(1, 0, 0)), f.x), mix(auroraHash(i + vec3(0, 1, 0)), auroraHash(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(auroraHash(i + vec3(0, 0, 1)), auroraHash(i + vec3(1, 0, 1)), f.x), mix(auroraHash(i + vec3(0, 1, 1)), auroraHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }
    float auroraFbm(vec3 p) {
        float v = 0.0;
        float a = .5;
        for (int i = 0; i < 4; i++) {
            v += a * auroraNoise(p);
            p = p * 2.03 + vec3(11.3, 7.1, 5.7);
            a *= .5;
        }
        return v;
    }
    void main() {
        ${LDB_FRAGMENT_HEAD}
        vec3 dir = normalize(vLocalDir);
        vec3 bodyC = vBodyCenter;
        vec3 sunDir = normalize(uSunWorldPos - bodyC);
        vec3 outDir = normalize(vWorldPos - bodyC);
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 nrm = normalize(vWorldNormal);
        float night = 1.0 - smoothstep(-.4, .3, dot(outDir, sunDir));
        if (night <= .001) discard;
        float lat = asin(clamp(dir.y, -1.0, 1.0));
        float lon = atan(dir.z, dir.x);
        float t = uTime;
        float shape;
        vec3 col;
        if (uMode > 1.5) {
            float flicker = .8 + .4 * auroraFbm(dir * 3.0 + vec3(uSeed, t * .02, 0.0));
            shape = flicker;
            col = uColorA;
        } else if (uMode > .5) {
            float p = auroraFbm(dir * 4.2 + vec3(uSeed) + vec3(0.0, t * .008, 0.0));
            float hemisphere = exp(-pow((lat - uOvalLat) / uOvalWidth, 2.0));
            shape = smoothstep(.55, .78, p) * hemisphere * (0.7 + 0.6 * auroraNoise(dir * 9.0 + vec3(0.0, 0.0, t * .03)));
            col = mix(uColorA, uColorB, auroraNoise(dir * 6.0 + vec3(uSeed)));
        } else {
            float sway = sin(uTime * .22 + vLon * 3.0 + vH * 4.5) * .035 * vH;
            float strands = auroraFbm(vec3((vLon + sway) * 24.0, uSeed * 3.0, uTime * .045));
            strands = pow(clamp(strands * 1.75 - .30, 0.0, 1.0), 1.9);
            float strandFine = .55 + .8 * auroraNoise(vec3(vLon * 110.0 - uTime * .06, vH * 2.5, uSeed));
            float vert = pow(1.0 - vH, 1.7) * smoothstep(0.0, .05, vH + .05);
            shape = strands * strandFine * vert * 1.5;
            col = mix(uColorA, uColorB, clamp(vH * 1.2, 0.0, 1.0));
            col += uColorC * pow(1.0 - vH, 3.0) * .3;
        }
        float a = shape * night * uIntensity;
        if (a < .0035) discard;
        gl_FragColor = vec4(col * (0.75 + 0.45 * night), a);
    }
`;

// Aurora: a ring of camera-facing sprite curtains, not a surface shell. Each sprite
// is an elongated Gaussian strip standing on the oval, with width, length, colour
// and brightness from an FBM scale-fade sample, the oval wobbled by FBM and the top
// faded with a log(2-t)*2 curve. Noise is hash value noise, lacunarity 2.21828,
// gain 0.67141.
const AURORA_SE_NOISE = `
    float detailHash(float n) { return fract(sin(n) * 43758.5453); }
    float detailNoise(in vec2 x) {
        vec2 p = floor(x);
        vec2 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        float n = p.x + p.y * 57.0;
        return mix(mix(detailHash(n), detailHash(n + 1.0), f.x),
                   mix(detailHash(n + 57.0), detailHash(n + 58.0), f.x), f.y);
    }
    vec4 detailNoise4(in vec2 x) {
        return vec4(detailNoise(x), detailNoise(x + vec2(0.272, -0.375)), detailNoise(x + vec2(-0.464, 0.674)), detailNoise(x + vec2(0.548, -0.145)));
    }
    float detailFbm(in vec2 point, int octaves) {
        float sum = 0.0;
        vec3 pa = vec3(point * 256.0, 1.0);
        for (int i = 0; i < 8; i++) {
            if (i >= octaves) break;
            sum += pa.z * (detailNoise(pa.xy) - 0.5);
            pa *= vec3(2.218281828459, 2.218281828459, 0.671415927);
        }
        return sum;
    }
    vec4 detailFbm4(in vec2 point, int octaves) {
        vec4 sum = vec4(0.0);
        vec3 pa = vec3(point * 256.0, 1.0);
        for (int i = 0; i < 8; i++) {
            if (i >= octaves) break;
            sum += pa.z * (detailNoise4(pa.xy) - 0.5);
            pa *= vec3(2.218281828459, 2.218281828459, 0.671415927);
        }
        return sum;
    }
`;

const AURORA_SPRITE_VERTEX = `
    attribute vec3 aDir;
    attribute float aSeed;
    uniform float uTime;
    uniform float uSeed;
    uniform float uBaseR;
    uniform float uHeight;
    uniform float uWidth;
    uniform vec3 uAxes;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec3 uColorC;
    varying float vU;
    varying float vT;
    varying float vZ;
    varying float vBright;
    varying float vSeed;
    varying vec3 vColor;
    varying vec3 vWorldPos;
    varying vec3 vBodyCenter;
    ${LDB_VERTEX_PARS}
    ${AURORA_SE_NOISE}
    void main() {
        vU = position.x * 2.0;
        vT = position.y;
        vSeed = aSeed;
        vec2 np = aDir.xz * 1.7 + vec2(aSeed * .618, uSeed);
        vec4 wob = detailFbm4(np * .5, 4);
        vec3 dir = aDir;
        dir.xz *= 1.0 + .16 * wob.a;
        dir = normalize(dir);
        vec4 scaleFade = clamp(detailFbm4(np * 2.6, 4) * .7 + .7, vec4(.35, .05, 0.0, 0.0), vec4(2.0, 2.0, 1.0, 1.0));
        float spriteWidth = uWidth / scaleFade.x * 1.5;
        float spriteLength = uHeight * scaleFade.y;
        float bright = clamp(detailFbm(np * .9 + vec2(.75, uTime * .01), 4) + .5, 0.0, 1.6);
        vec3 pB = dir * uBaseR * uAxes;
        vec3 pT = dir * (uBaseR + spriteLength) * uAxes;
        vec3 local = mix(pB, pT, position.y);
        vec4 wp = modelMatrix * vec4(local, 1.0);
        vWorldPos = wp.xyz;
        vBodyCenter = vec3(modelMatrix * vec4(0.0, 0.0, 0.0, 1.0));
        vec3 topCol = mix(uColorB, uColorC, clamp(.5 + .8 * detailFbm(np * 4.1 + vec2(0.0, uTime * .02), 3), 0.0, 1.0));
        topCol *= .35 + .65 * clamp(detailFbm(np * 1.3, 3) + .5, 0.0, 1.0);
        vColor = mix(uColorA, topCol, pow(position.y, 1.15) * clamp(scaleFade.z * 2.2, 0.0, 1.0));
        vBright = bright * clamp(scaleFade.a + .25, 0.0, 1.15);
        vec4 vB = modelViewMatrix * vec4(pB, 1.0);
        vec4 vT4 = modelViewMatrix * vec4(pT, 1.0);
        vec4 viewPos = mix(vB, vT4, position.y);
        vec2 axis = vT4.xy - vB.xy;
        float alen = length(axis);
        vec2 tang = alen > 1e-6 ? vec2(-axis.y, axis.x) / alen : vec2(1.0, 0.0);
        viewPos.xy += tang * (position.x * spriteWidth * (1.0 - .22 * position.y));
        float viewScale = max(length(vec3(modelViewMatrix[0])), 1e-9);
        vZ = alen / (alen + 2.0 * spriteWidth * viewScale);
        gl_Position = projectionMatrix * viewPos;
        ${LDB_VERTEX_TAIL}
    }
`;

const AURORA_SPRITE_FRAGMENT = `
    uniform float uTime;
    uniform float uIntensity;
    uniform vec3 uSunWorldPos;
    varying float vU;
    varying float vT;
    varying float vZ;
    varying float vBright;
    varying float vSeed;
    varying vec3 vColor;
    varying vec3 vWorldPos;
    varying vec3 vBodyCenter;
    ${LDB_FRAGMENT_PARS}
    ${AURORA_SE_NOISE}
    void main() {
        ${LDB_FRAGMENT_HEAD}
        vec3 sunDir = normalize(uSunWorldPos - vBodyCenter);
        vec3 outDir = normalize(vWorldPos - vBodyCenter);
        float night = 1.0 - smoothstep(-.4, .3, dot(outDir, sunDir));
        if (night <= .001) discard;
        float ta = vT * 2.0 - 1.0;
        if (ta < 0.0) ta = max((ta + vZ) / (vZ - 1.0), 0.0); else ta = min((ta - vZ) / (vZ - 1.0), 0.0);
        float bright = exp(-5.55 * (ta * ta + vU * vU));
        bright *= log(max(2.0 - vT, 1.0)) * 2.0;
        bright *= smoothstep(0.0, .05, vT);
        bright *= .72 + .55 * detailNoise(vec2(vSeed * 39.7 + vU * .03, vT * 2.6 - uTime * .045) * 8.0);
        float a = bright * vBright * night * uIntensity;
        if (a < .0035) discard;
        gl_FragColor = vec4(vColor * (0.75 + 0.45 * night), a);
    }
`;

function createAuroraSpriteGeometry(key, radius, profile) {
    const perPole = 260;
    const geometry = new THREE.InstancedBufferGeometry;
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([ -.5, 0, 0, .5, 0, 0, -.5, 1, 0, .5, 1, 0 ], 3));
    geometry.setIndex([ 0, 2, 1, 1, 2, 3 ]);
    const dirs = [], seeds = [];
    for (const pole of [ 1, -1 ]) {
        for (let i = 0; i < perPole; i++) {
            const lon = i / perPole * Math.PI * 2;
            const lat = pole * profile.ovalLat * (1 + .05 * Math.sin(lon * 3 + pole * 1.7));
            const c = Math.cos(lat);
            dirs.push(Math.cos(lon) * c, Math.sin(lat), Math.sin(lon) * c);
            seeds.push(lon + (pole < 0 ? 31.7 : 0));
        }
    }
    geometry.setAttribute("aDir", new THREE.InstancedBufferAttribute(new Float32Array(dirs), 3));
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
    geometry.instanceCount = perPole * 2;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3, radius * 2);
    return geometry;
}

function createPlanetAurora(key, mesh) {
    const profile = AURORA_PROFILES[key];
    if (!profile || !mesh || auroraShells[key]) return null;
    const radius = mesh.geometry?.parameters?.radius;
    if (!(radius > 0)) return null;
    if (profile.mode === 0) {
        const axes = BodyShapes.axesKm[key];
        const am = axes ? Math.max(...axes) : 1;
        const spriteMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0 },
                uSunWorldPos: { value: new THREE.Vector3 },
                uColorA: { value: new THREE.Color(...profile.colorA) },
                uColorB: { value: new THREE.Color(...profile.colorB) },
                uColorC: { value: new THREE.Color(...profile.colorC) },
                uSeed: { value: (key.length * 7.13) % 10 },
                uBaseR: { value: radius * 1.008 },
                uHeight: { value: radius * (profile.height || .08) * 2.1 },
                uWidth: { value: 2 * Math.PI * radius * Math.cos(profile.ovalLat) / 260 * 2.3 },
                uAxes: { value: axes ? new THREE.Vector3(axes[0] / am, axes[2] / am, axes[1] / am) : new THREE.Vector3(1, 1, 1) }
            },
            vertexShader: AURORA_SPRITE_VERTEX,
            fragmentShader: AURORA_SPRITE_FRAGMENT,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        const spriteAurora = new THREE.Mesh(createAuroraSpriteGeometry(key, radius, profile), spriteMaterial);
        spriteAurora.rotation.set(profile.tiltX, 0, profile.tiltZ);
        spriteAurora.renderOrder = 7;
        spriteAurora.frustumCulled = false;
        spriteAurora.userData.isAurora = true;
        spriteAurora.userData.auroraGain = profile.gain;
        mesh.add(spriteAurora);
        auroraShells[key] = spriteAurora;
        return spriteAurora;
    }
    const geometry = BodyShapes.createGeometry(THREE, key, radius * profile.shell, 160, 112);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uIntensity: { value: 0 },
            uSunWorldPos: { value: new THREE.Vector3 },
            uColorA: { value: new THREE.Color(...profile.colorA) },
            uColorB: { value: new THREE.Color(...profile.colorB) },
            uColorC: { value: new THREE.Color(...profile.colorC) },
            uOvalLat: { value: profile.ovalLat },
            uOvalWidth: { value: profile.ovalWidth },
            uMode: { value: profile.mode },
            uSeed: { value: (key.length * 7.13) % 10 }
        },
        vertexShader: AURORA_VERTEX,
        fragmentShader: AURORA_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false
    });
    const aurora = new THREE.Mesh(geometry, material);
    aurora.rotation.set(profile.tiltX, 0, profile.tiltZ);
    aurora.renderOrder = 7;
    aurora.frustumCulled = false;
    aurora.userData.isAurora = true;
    aurora.userData.auroraGain = profile.gain;
    mesh.add(aurora);
    auroraShells[key] = aurora;
    return aurora;
}

function createRealisticOrbitLine(data) {
    if (!J2000_ELEMENTS[data.key]) return null;
    const geometry = OrbitGeometry.createAnchoredOrbitGeometry(THREE, OrbitGeometry.ORBIT_LINE_SEGMENTS);
    const material = new THREE.LineBasicMaterial({

        color: 11393279,
        transparent: true,
        opacity: .55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
    });
    const line = new THREE.LineLoop(geometry, material);
    line.userData.realisticOrbitKey = data.key;
    line.matrixAutoUpdate = false;
    line.frustumCulled = false;
    line.visible = showOrbits;
    line.raycast = () => {};
    solarSystem.add(line);
    orbitLines.push(line);
    updateRealisticOrbitMatrix(line, new Date(simTimeMs));
    return line;
}

function updateRealisticOrbitMatrix(line, date) {
    const key = line.userData.realisticOrbitKey;
    const el = J2000_ELEMENTS[key];
    if (!el) return;
    const jd = julianDateFromDate(date);
    const T = (jd - 2451545) / 36525;
    const a = el.a[0] + el.a[1] * T;
    const e = el.e[0] + el.e[1] * T;
    const I = (el.I[0] + el.I[1] * T) * DEG;
    const wbar = (el.w[0] + el.w[1] * T) * DEG;
    const Omega = (el.O[0] + el.O[1] * T) * DEG;
    const axisX = keplerXYZ(a, 0, I, wbar, Omega, 0);
    const axisY = keplerXYZ(a, 0, I, wbar, Omega, Math.PI / 2);
    const u = eclipticToScene(axisX.X, axisX.Y, axisX.Z);
    const v = eclipticToScene(axisY.X, axisY.Y, axisY.Z);
    const minorScale = Math.sqrt(1 - e * e);
    const L = (el.L[0] + el.L[1] * T) * DEG;
    const E = solveKepler(L - wbar, e), cE = Math.cos(E), sE = Math.sin(E);
    const U = [ u.x, u.y, u.z ], V = [ v.x * minorScale, v.y * minorScale, v.z * minorScale ];
    const position = new THREE.Vector3(U[0] * (cE - e) + V[0] * sE, U[1] * (cE - e) + V[1] * sE, U[2] * (cE - e) + V[2] * sE);
    OrbitGeometry.setAnchoredOrbitMatrix(line, U, V, cE, sE, position);
}

function createRingGeometry(innerRadius, outerRadius, segments = 128, thickness = 0) {
    const geometry = new THREE.BufferGeometry, vertices = [], normals = [], uvs = [], indices = [];
    const half = Math.max(0, thickness) * .5;
    const surface = kind => {
        const start = vertices.length / 3;
        for (let i = 0; i <= segments; i++) {
            const u = i / segments, angle = u * Math.PI * 2, c = Math.cos(angle), sn = Math.sin(angle);
            for (let edge = 0; edge < 2; edge++) {
                const flat = kind < 2, r = flat ? edge ? outerRadius : innerRadius : kind === 2 ? innerRadius : outerRadius;
                const z = flat ? kind === 0 ? half : -half : edge ? half : -half;
                const normal = flat ? [ 0, 0, kind === 0 ? 1 : -1 ] : [ c * (kind === 2 ? -1 : 1), sn * (kind === 2 ? -1 : 1), 0 ];
                vertices.push(r * c, r * sn, z);
                normals.push(...normal);
                uvs.push(u, flat ? edge : kind === 2 ? 0 : 1);
            }
        }
        for (let i = 0; i < segments; i++) {
            const a = start + i * 2, b = a + 1, c = a + 2, d = a + 3;
            if (kind === 1 || kind === 3) indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c);
        }
    };
    surface(0);
    if (half > 0) {
        surface(1);
        surface(2);
        surface(3);
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.parameters = {
        innerRadius: innerRadius,
        outerRadius: outerRadius,
        thetaSegments: segments,
        thickness: thickness
    };
    geometry.userData.ringThickness = thickness;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}


// Saturn's rings cast broad dark bands across the disc. MeshStandardMaterial has
// no way to receive a shadow from a transparent, alpha-tested ring, so the band
// is computed analytically: intersect the view ray with the ring plane, take that
// point's radius in ring radii, and darken by the ring's own optical depth there.
// It answers the observer's question "is the ring in front of the sunlight here",
// which is why the bands land on the lit hemisphere and nowhere else.
function createPlanetMesh(data, index) {
    const key = data.key;
    const texture = getProceduralTexture(key);
    const isEarth = key === "earth";
    // Earth is the only body that ships an ocean mask, and the mask is a specular
    // intensity, not a roughness: white water, black land. MeshPhysicalMaterial
    // carries specularIntensityMap, so the map is used as authored instead of
    // being inverted into a roughness channel first.
    const SurfaceMaterial = isEarth && THREE.MeshPhysicalMaterial ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const material = new SurfaceMaterial({
        map: texture,
        roughness: isEarth ? .9 : 1,
        metalness: 0
    });
    material.name = key + "-surface";

    applySurfaceBrdf(material, key, THREE);
    if (isEarth) {
        material.color.setRGB(1.05, 1.05, 1.05);
        material.side = THREE.FrontSide;
        material.transparent = false;
        material.depthWrite = true;
        // One roughness for the whole globe made land glint like water and water
        // glow like wet paint. The mask keeps land matte and lets only the ocean
        // carry the sun glint.
        material.roughness = 1;
        const waterMask = typeof createEarthWaterMask === "function" ? createEarthWaterMask() : null;
        if (waterMask) {
            material.roughnessMap = waterMask;
            material.userData.earthWaterMask = waterMask;
        }
    }
    // Surface tessellation from the graphics preset. Coarse values leave a visible
    // facet step on the gas giants and put the mesh chord below the analytic sphere
    // the atmosphere intersects; sagitta falls with the square of the segment count.
    // Tiered because these nine spheres are allocated up front and the top tier is
    // ~16 MB of vertices for Earth alone.
    const TIERS = {
        low:    { named: [ 512, 256 ], fallback: [ 384, 192 ] },
        medium: { named: [ 768, 384 ], fallback: [ 512, 256 ] },
        high:   { named: [ 1024, 512 ], fallback: [ 768, 384 ] }
    };
    const tier = TIERS[globalThis.__solisterGraphicsTier] || TIERS.high;
    const NAMED_SURFACE_SEGMENTS = {
        mercury: tier.named, venus: tier.named, earth: tier.named,
        mars: tier.named, moon: tier.named
    };

    const [segmentsX, segmentsY] = NAMED_SURFACE_SEGMENTS[key] || tier.fallback;
    const geometry = BodyShapes.createGeometry(THREE, key, data.radius, segmentsX, segmentsY);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = key === "saturn";
    mesh.userData = {
        planetKey: key,
        planetName: data.name,
        index: index
    };
    solarSystem.add(mesh);
    objectRegistry[key] = mesh;
    bodyOrientation.apply(mesh, key, simTimeMs);
    elevationCatalog.applyBody(mesh, key);
    // No emissive night glow: standing rule is that a night side is genuinely dark on
    // every planet, and emissive is added whatever the lighting does, so it lifted the
    // day side too. There is no correct non-zero value without a real light source.
    createRealisticOrbitLine(data);
    const atmosphereProfile = PLANET_ATMOSPHERE_PROFILES[key];
    if (key !== "earth" && atmosphereProfile) createPlanetAtmosphere(key, mesh, atmosphereProfile);
    createPlanetAurora(key, mesh);
    planets.push({
        data: data,
        mesh: mesh
    });
    if (data.hasMoon) {
        const moonTexture = getProceduralTexture("moon");
        const moonMat = new THREE.MeshStandardMaterial({
            map: moonTexture,
            roughness: 1,
            metalness: 0
        });
        applySurfaceBrdf(moonMat, "moon", THREE);
        const moonRadiusKm = BodyShapes.maxRadiusKm("moon");
        const moonRadius = km2u(moonRadiusKm);
        const moonGeo = BodyShapes.createGeometry(THREE, "moon", moonRadius, segmentsX, segmentsY);
        const moonMesh = new THREE.Mesh(moonGeo, moonMat);
        moonMesh.castShadow = false;
        moonMesh.receiveShadow = false;
        moonMesh.userData = {
            isMoon: true,
            planetKey: "moon",
            planetName: "Moon"
        };
        solarSystem.add(moonMesh);
        objectRegistry["moon"] = moonMesh;
        bodyOrientation.apply(moonMesh, "moon", simTimeMs);
        elevationCatalog.applyBody(moonMesh, "moon");
    }
    if (data.hasRings) {
        const RING_GAP_CASSINI = [ .6893, .7516 ];
        const RING_GAP_ENCKE = [ .9066, .911 ];
        const RING_GAP_DEPTH = .92;
        const RING_GAP_SOFT = .012;
        const ringTexture = getProceduralTexture("saturn-ring");
        const ringGeo = createRingGeometry(data.radius * 1.11, data.radius * 2.33, 384, data.radius * .01 / BodyShapes.maxRadiusKm("saturn"));
        const ringMat = new THREE.MeshStandardMaterial({
            map: ringTexture,
            color: new THREE.Color(12170150),
            emissive: new THREE.Color(5591369),
            emissiveMap: ringTexture,
            emissiveIntensity: .25,
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: true,
            alphaTest: .1,
            opacity: 1,
            roughness: .9,
            metalness: 0,
            shadowSide: THREE.DoubleSide
        });
        applySurfaceBrdf(ringMat, "saturn-ring", THREE);
        ringMat.onBeforeCompile = shader => {
            shader.uniforms.uCassini = {
                value: new THREE.Vector2(...RING_GAP_CASSINI)
            };
            shader.uniforms.uEncke = {
                value: new THREE.Vector2(...RING_GAP_ENCKE)
            };
            shader.uniforms.uGapDepth = {
                value: RING_GAP_DEPTH
            };
            shader.uniforms.uGapSoft = {
                value: RING_GAP_SOFT
            };
            shader.fragmentShader = `\n                uniform vec2  uCassini;\n                uniform vec2  uEncke;\n                uniform float uGapDepth;\n                uniform float uGapSoft;\n            ` + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace("#include <alphamap_fragment>", `#include <alphamap_fragment>\n                {\n                    float ringV  = vMapUv.y;\n                    float cassini = smoothstep(uCassini.x - uGapSoft, uCassini.x + uGapSoft, ringV)\n                                  * (1.0 - smoothstep(uCassini.y - uGapSoft, uCassini.y + uGapSoft, ringV));\n                    float encke   = smoothstep(uEncke.x - uGapSoft, uEncke.x + uGapSoft, ringV)\n                                  * (1.0 - smoothstep(uEncke.y - uGapSoft, uEncke.y + uGapSoft, ringV));\n                    float gap = max(cassini, encke);\n                    diffuseColor.a *= 1.0 - uGapDepth * gap;\n                }`);
        };
        ringMat.customProgramCacheKey = () => "saturn-ring-gaps";
        ringMat.userData.ringGaps = {
            cassini: RING_GAP_CASSINI,
            encke: RING_GAP_ENCKE,
            depth: RING_GAP_DEPTH,
            soft: RING_GAP_SOFT
        };
        ringMat.side = THREE.FrontSide;
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.rotation.z = THREE.MathUtils.degToRad(15);
        mesh.add(ringMesh);
        ringMesh.renderOrder = 3;
        objectRegistry["saturn-ring"] = ringMesh;
        mesh.userData.ringMesh = ringMesh;
        installRingParticleShadow(ringMat, mesh, false);
        installRingSunShading(ringMat, {
            density: 1.5,
            glow: .32,
            glowColor: 7037522,
            body: mesh,
            shineRadius: mesh.geometry.parameters.radius,
            shine: .08,
            shineColor: 14209732
        });
        installRingPlanetOcclusion(ringMat, mesh.geometry.parameters.radius, "saturn-ring-occ", mesh);
        // Same world-space receiver Uranus and Neptune already use: the bands are
        // the real ring gaps, so the shadow breaks where the Cassini division does.
        const ringInner = data.radius * 1.11, ringOuter = data.radius * 2.33;
        const at = f => data.radius * (1.11 + f * 1.22);
        const bandWorld = [ [ ringInner, at(.6893) ], [ at(.7516), at(.9066) ], [ at(.911), ringOuter ] ];
        mesh.userData.ringShadowUniforms = installRingShadowReceiver(mesh, ringInner, ringOuter, .5, bandWorld);
    }
    if (data.hasFaintRings) {
        const ringInner = data.radius * 1.63;
        const ringOuter = data.radius * 2.01;
        const ringTex = createCanvasTexture(8, 256, drawUranusRingTexture);
        ringTex.userData.systemOwned = true;
        ringTex.wrapS = THREE.ClampToEdgeWrapping;
        ringTex.wrapT = THREE.ClampToEdgeWrapping;
        const ringGeo = createRingGeometry(ringInner, ringOuter, 256, data.radius * .1 / BodyShapes.maxRadiusKm("uranus"));
        const ringMat = new THREE.MeshStandardMaterial({
            map: ringTex,
            color: new THREE.Color(7172213),
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            opacity: .55,
            roughness: 1,
            metalness: 0
        });
        applySurfaceBrdf(ringMat, "saturn-ring", THREE);
        ringMat.side = THREE.FrontSide;
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.renderOrder = 3;
        mesh.add(ringMesh);
        objectRegistry["uranus-ring"] = ringMesh;
        mesh.userData.ringMesh = ringMesh;
        installRingParticleShadow(ringMat, mesh, false);
        installRingSunShading(ringMat, {
            density: 1.1,
            glow: 4,
            glowColor: 10466252,
            body: mesh,
            shineRadius: mesh.geometry.parameters.radius,
            shine: .25,
            shineColor: 12372184
        });
        installRingPlanetOcclusion(ringMat, mesh.geometry.parameters.radius, "uranus-ring-occ", mesh);
        const bandsV = [ [ .016, .024 ], [ .05, .066 ], [ .086, .104 ], [ .308, .324 ], [ .4, .421 ], [ .553, .574 ], [ .603, .624 ], [ .674, .695 ], [ .85, .871 ], [ .966, .987 ] ];
        const span = ringOuter - ringInner;
        const bandWorld = bandsV.map(([v0, v1]) => [ ringInner + v0 * span, ringInner + v1 * span ]);
        mesh.userData.ringShadowUniforms = installRingShadowReceiver(mesh, ringInner, ringOuter, .18, bandWorld);
    }
    if (data.hasNeptuneRings) {
        const RING_INNER_R = 1.6, RING_OUTER_R = 2.65;
        const ringInner = data.radius * RING_INNER_R;
        const ringOuter = data.radius * RING_OUTER_R;
        const bandPairs = [ [ 1.66, 1.74 ], [ 2.05, 2.11 ], [ 2.16, 2.17 ], [ 2.17, 2.32 ], [ 2.32, 2.33 ], [ 2.51, 2.52 ], [ 2.55, 2.57 ] ];
        const bandWorld = bandPairs.map(([r0, r1]) => [ data.radius * r0, data.radius * r1 ]);
        const ringTex = createCanvasTexture(256, 256, drawNeptuneRingTexture);
        ringTex.userData.systemOwned = true;
        ringTex.wrapS = THREE.ClampToEdgeWrapping;
        ringTex.wrapT = THREE.ClampToEdgeWrapping;
        const ringGeo = createRingGeometry(ringInner, ringOuter, 256, data.radius * .28 / BodyShapes.maxRadiusKm("neptune"));
        const ringMat = new THREE.MeshStandardMaterial({
            map: ringTex,
            color: new THREE.Color(16777215),
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            opacity: .45,
            roughness: 1,
            metalness: 0
        });
        applySurfaceBrdf(ringMat, "saturn-ring", THREE);
        ringMat.side = THREE.FrontSide;
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.renderOrder = 3;
        mesh.add(ringMesh);
        objectRegistry["neptune-ring"] = ringMesh;
        mesh.userData.ringMesh = ringMesh;
        installRingParticleShadow(ringMat, mesh, false);
        installRingSunShading(ringMat, {
            density: .45,
            glow: 1.6,
            glowColor: 11578532,
            body: mesh,
            shineRadius: mesh.geometry.parameters.radius,
            shine: .12,
            shineColor: 12894390
        });
        installRingPlanetOcclusion(ringMat, mesh.geometry.parameters.radius, "neptune-ring-occ", mesh);
        mesh.userData.ringShadowUniforms = installRingShadowReceiver(mesh, ringInner, ringOuter, .12, bandWorld);
    }
}

function clearSystem() {
    cometLayer.clearRender();
    if (planetVisuals) {
        planetVisuals.dispose();
        planetVisuals = null;
    }
    labelObjects.forEach(label => {
        const el = label.element;
        if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    labelObjects.length = 0;
    _labelItems.length = _labelItemPool.length = _labelPlaced.length = _labelPlacedPool.length = 0;
    for (const key in cloudMeshes) {
        const m = cloudMeshes[key];
        if (!m) continue;
        if (m.parent) m.parent.remove(m);
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
        delete cloudMeshes[key];
    }
    const disposedOwnedTextures = new Set;
    while (solarSystem.children.length > 0) {
        const c = solarSystem.children[0];
        solarSystem.remove(c);
        c.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                for (const material of Array.isArray(o.material) ? o.material : [ o.material ]) {
                    const texture = material.map;
                    if (texture?.userData.systemOwned && !disposedOwnedTextures.has(texture)) {
                        disposedOwnedTextures.add(texture);
                        texture.dispose();
                    }
                }
                if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose();
            }
        });
    }
    planets.length = 0;
    orbitLines.length = 0;
    for (const k in objectRegistry) delete objectRegistry[k];
    resetPlanetOccluders();
    if (typeof destroySunLensArtifacts === "function") destroySunLensArtifacts();
    sunCoronaMesh = null;
    sunHaloMesh = null;
    earthNightTexture = null;
    saturnMat = null;
    saturnRingMat = null;
    moonMat = null;
    earthMat = null;
}

function buildSystem() {
    ringAsteroids.dispose();
    ringShadowBindings.length = 0;
    ringSunShadingBindings.length = 0;
    clearSystem();
    createSun();
    planetData.forEach((data, index) => createPlanetMesh(data, index));
    setupMaterialEffects();
    createEarthAtmosphere();
    // On by default since S5: the composite carries the disc and the sky mesh
    // carries the air beside it, so a body with a table no longer loses its
    // limb. __solisterAtmosphere = 0 is the override that takes it back out.
    if (globalThis.__solisterAtmosphere !== 0 && typeof startAtmAtmospheres === "function") {
        startAtmAtmospheres(THREE).catch(error =>
            console.warn("[Solister] atmosphere composite failed:", error && error.message));
    }
    applyStarVisibility();
    createAsteroidBelt();
    solarAccuracy.rebuild();
    solarAccuracy.update(simTimeMs, {
        camera: camera,
        showOrbits: showOrbits && pathSettings.style === "orbits"
    });
    moonEclipses.rebuild();
    extraBodies.rebuild();
    cometLayer.rebuild(cometsVisible());
    textureLodReset();
    loadTexturesFromFolder();
    resonantPopulations.rebuild({
        useCatalog: true
    });
    nearEarth.rebuild({
        useCatalog: true
    });
    kuiperBelt.rebuild(asteroidTypeEnabled("kuiperbelt"));
    ringAsteroids.rebuild();
    enforceAsteroidVisibility();
    applySkyLayers();
    // Procedural surface maps (terra-bake.js): one body per idle callback, so
    // the fallback canvas maps are on screen immediately and the baked ones
    // replace them when they are ready. A body that already loaded a supplied ktx2 map is skipped by the queue.
    if (typeof queueTerraBakes === "function") {
        try {
            queueTerraBakes(renderer, [ "mars", "venus", "mercury", "moon" ], { registry: objectRegistry, width: 1024 });
        } catch (error) {
            if (typeof console !== "undefined" && console.warn) {
                console.warn("[Solister] procedural map bake queue unavailable:", error && error.message);
            }
        }
    }
}
