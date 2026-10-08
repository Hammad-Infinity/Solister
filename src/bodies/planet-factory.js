function julianDateFromDate(date) {
    return date.getTime() / 86400000 + 2440587.5;
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
    const Z = (sw * sI) * xp + (cw * sI) * yp;
    return { X, Y, Z };
}
function computePlanetPosition(key, date) {
    const el = J2000_ELEMENTS[key];
    if (!el) return { X: 0, Y: 0, Z: 0 };
    const jd = julianDateFromDate(date);
    const T = (jd - 2451545.0) / 36525;
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
    return { x: X * AU_UNITS, y: Z * AU_UNITS, z: -Y * AU_UNITS };
}
function createRealisticOrbitLine(data) {
    if (!J2000_ELEMENTS[data.key]) return null;
    const segments = 65536;
    const geometry = OrbitGeometry.createAnchoredOrbitGeometry(THREE, segments);
    const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
        depthWrite: false
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
    const T = (jd - 2451545.0) / 36525;
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
    const U = [u.x, u.y, u.z], V = [v.x*minorScale, v.y*minorScale, v.z*minorScale];
    const position = new THREE.Vector3(
        U[0]*(cE-e)+V[0]*sE, U[1]*(cE-e)+V[1]*sE, U[2]*(cE-e)+V[2]*sE);
    OrbitGeometry.setAnchoredOrbitMatrix(line,U,V,cE,sE,position);
}
function createRingGeometry(innerRadius,outerRadius,segments=128,thickness=0){
    const geometry=new THREE.BufferGeometry(),vertices=[],normals=[],uvs=[],indices=[];
    const half=Math.max(0,thickness)*0.5;
    const surface=(kind)=>{
        const start=vertices.length/3;
        for(let i=0;i<=segments;i++){
            const u=i/segments,angle=u*Math.PI*2,c=Math.cos(angle),sn=Math.sin(angle);
            for(let edge=0;edge<2;edge++){
                const flat=kind<2,r=flat?(edge?outerRadius:innerRadius):(kind===2?innerRadius:outerRadius);
                const z=flat?(kind===0?half:-half):(edge?half:-half);
                const normal=flat?[0,0,kind===0?1:-1]:[c*(kind===2?-1:1),sn*(kind===2?-1:1),0];
                vertices.push(r*c,r*sn,z);normals.push(...normal);uvs.push(u,flat?edge:kind===2?0:1);
            }
        }
        for(let i=0;i<segments;i++){
            const a=start+i*2,b=a+1,c=a+2,d=a+3;
            if(kind===1||kind===3)indices.push(a,c,b,b,c,d);
            else indices.push(a,b,c,b,d,c);
        }
    };
    surface(0);
    if(half>0){surface(1);surface(2);surface(3);}
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);
    geometry.parameters={innerRadius,outerRadius,thetaSegments:segments,thickness};
    geometry.userData.ringThickness=thickness;
    geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}
function createPlanetMesh(data, index) {
    const key = data.key;
    const texture = getProceduralTexture(key);
    const isEarth = (key === 'earth');
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: isEarth ? 0.9 : 1.0,
        metalness: 0.0,
    });
    if (isEarth) {
        material.color.setRGB(1.05, 1.05, 1.05);
    }
    const DEM_SEGMENTS = {
        mercury: [384, 192], venus: [384, 192], earth: [512, 256],
        mars: [384, 192], moon: [512, 256]
    };
    const [segmentsX, segmentsY] = DEM_SEGMENTS[key] || [128, 128];
    const geometry = BodyShapes.createGeometry(THREE, key, data.radius, segmentsX, segmentsY);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = (key === 'saturn');
    mesh.userData = { planetKey: key, planetName: data.name, index: index };
    solarSystem.add(mesh);
    objectRegistry[key] = mesh;
    bodyOrientation.apply(mesh, key, simTimeMs);
    elevationCatalog.applyBody(mesh, key);
    if (key === 'venus') ensureVenusAtmosphere();
    const NIGHT_GLOW = {
        mercury: { color: 0x000000, intensity: 0.00 },
        venus:   { color: 0x000000, intensity: 0.03 },
        mars:    { color: 0x1a3a18, intensity: 0.08 },
        earth:   { color: 0x1C2A44, intensity: 0.05 },
        jupiter: { color: 0x4a2a10, intensity: 0.22 },
        saturn:  { color: 0x5a3a18, intensity: 0.13 },
        uranus:  { color: 0x183038, intensity: 0.05 },
        neptune: { color: 0x101c50, intensity: 0.07 },
    };
    if (NIGHT_GLOW[key]) {
        const g = NIGHT_GLOW[key];
        mesh.material.emissive = new THREE.Color(g.color);
        mesh.material.emissiveIntensity = g.intensity;
        mesh.material.needsUpdate = true;
    }
    createRealisticOrbitLine(data);
    const atmosphereProfile=PLANET_ATMOSPHERE_PROFILES[key];
    if(key!=='earth'&&atmosphereProfile)createPlanetAtmosphere(key,mesh,atmosphereProfile);
    planets.push({ data, mesh });
    if (data.hasMoon) {
        const moonTexture = getProceduralTexture('moon');
        const moonMat = new THREE.MeshStandardMaterial({ map: moonTexture, roughness: 1.0, metalness: 0.0 });
        const moonRadiusKm = BodyShapes.maxRadiusKm('moon');
        const moonRadius = km2u(moonRadiusKm);
        const moonGeo = BodyShapes.createGeometry(THREE, 'moon', moonRadius, 512, 256);
        const moonMesh = new THREE.Mesh(moonGeo, moonMat);
        moonMesh.castShadow = false;
        moonMesh.receiveShadow = false;
        moonMesh.userData = { isMoon: true, planetKey: 'moon', planetName: 'Moon' };
        solarSystem.add(moonMesh);
        objectRegistry['moon'] = moonMesh;
        bodyOrientation.apply(moonMesh, 'moon', simTimeMs);
        elevationCatalog.applyBody(moonMesh, 'moon');
    }
    if (data.hasRings) {
        const RING_GAP_CASSINI = [0.6893, 0.7516];
        const RING_GAP_ENCKE   = [0.9066, 0.9110];
        const RING_GAP_DEPTH   = 0.92;
        const RING_GAP_SOFT    = 0.012;
        const ringTexture = getProceduralTexture('saturn-ring');
        const ringGeo = createRingGeometry(data.radius * 1.11, data.radius * 2.33, 384, data.radius * 0.01 / BodyShapes.maxRadiusKm("saturn"));
        const ringMat = new THREE.MeshStandardMaterial({
            map: ringTexture,
            color: new THREE.Color(0xb9b3a6),
            emissive: new THREE.Color(0x555149),
            emissiveMap: ringTexture,
            emissiveIntensity: 0.25,
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: true,
            alphaTest: 0.1,
            opacity: 1.0,
            roughness: 0.9,
            metalness: 0.0,
            shadowSide: THREE.DoubleSide,
        });
        ringMat.onBeforeCompile = (shader) => {
            shader.uniforms.uCassini = { value: new THREE.Vector2(...RING_GAP_CASSINI) };
            shader.uniforms.uEncke   = { value: new THREE.Vector2(...RING_GAP_ENCKE) };
            shader.uniforms.uGapDepth = { value: RING_GAP_DEPTH };
            shader.uniforms.uGapSoft  = { value: RING_GAP_SOFT };
            shader.fragmentShader = `
                uniform vec2  uCassini;
                uniform vec2  uEncke;
                uniform float uGapDepth;
                uniform float uGapSoft;
            ` + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <alphamap_fragment>',
                `#include <alphamap_fragment>
                {
                    float ringV  = vMapUv.y;
                    float cassini = smoothstep(uCassini.x - uGapSoft, uCassini.x + uGapSoft, ringV)
                                  * (1.0 - smoothstep(uCassini.y - uGapSoft, uCassini.y + uGapSoft, ringV));
                    float encke   = smoothstep(uEncke.x - uGapSoft, uEncke.x + uGapSoft, ringV)
                                  * (1.0 - smoothstep(uEncke.y - uGapSoft, uEncke.y + uGapSoft, ringV));
                    float gap = max(cassini, encke);
                    diffuseColor.a *= 1.0 - uGapDepth * gap;
                }`
            );
        };
        ringMat.customProgramCacheKey = () => 'saturn-ring-gaps';
        ringMat.userData.ringGaps = { cassini: RING_GAP_CASSINI, encke: RING_GAP_ENCKE, depth: RING_GAP_DEPTH, soft: RING_GAP_SOFT };
        ringMat.side=THREE.FrontSide;
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.rotation.z = THREE.MathUtils.degToRad(15);
        mesh.add(ringMesh);
        ringMesh.renderOrder=3;
        objectRegistry['saturn-ring'] = ringMesh;
        mesh.userData.ringMesh = ringMesh;
        installRingParticleShadow(ringMat, mesh, false);
        installRingSunShading(ringMat, { density: 1.5, glow: 0.32, glowColor: 0x6b6252,
            body: mesh, shineRadius: mesh.geometry.parameters.radius, shine: 0.08, shineColor: 0xd8d2c4 });
        installRingPlanetOcclusion(ringMat, mesh.geometry.parameters.radius, 'saturn-ring-occ');
    }
    if (data.hasFaintRings) {
        const ringInner = data.radius * 1.63;
        const ringOuter = data.radius * 2.01;
        const ringTex = createCanvasTexture(8, 256, drawUranusRingTexture);
        ringTex.userData.systemOwned = true;
        ringTex.wrapS = THREE.ClampToEdgeWrapping;
        ringTex.wrapT = THREE.ClampToEdgeWrapping;
        const ringGeo = createRingGeometry(ringInner, ringOuter, 256, data.radius * 0.1 / BodyShapes.maxRadiusKm("uranus"));
        const ringMat = new THREE.MeshStandardMaterial({
            map: ringTex,
            color: new THREE.Color(0x6d7075),
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            opacity: 0.55,
            roughness: 1.0,
            metalness: 0.0,
        });
        ringMat.side=THREE.FrontSide;
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.renderOrder = 3;
        mesh.add(ringMesh);
        objectRegistry['uranus-ring'] = ringMesh;
        mesh.userData.ringMesh = ringMesh;
        installRingParticleShadow(ringMat, mesh, false);
        installRingSunShading(ringMat, { density: 1.1, glow: 4.0, glowColor: 0x9fb3cc,
            body: mesh, shineRadius: mesh.geometry.parameters.radius, shine: 0.25, shineColor: 0xbcc8d8 });
        installRingPlanetOcclusion(ringMat, mesh.geometry.parameters.radius, 'uranus-ring-occ');
        const bandsV = [
            [0.016, 0.024], [0.050, 0.066], [0.086, 0.104],
            [0.308, 0.324], [0.400, 0.421], [0.553, 0.574],
            [0.603, 0.624], [0.674, 0.695], [0.850, 0.871],
            [0.966, 0.987],
        ];
        const span = ringOuter - ringInner;
        const bandWorld = bandsV.map(([v0, v1]) =>
            [ringInner + v0 * span, ringInner + v1 * span]);
        mesh.userData.ringShadowUniforms =
            installRingShadowReceiver(mesh, ringInner, ringOuter, 0.18, bandWorld);
    }
    if (data.hasNeptuneRings) {
        const RING_INNER_R = 1.60, RING_OUTER_R = 2.65;
        const ringInner = data.radius * RING_INNER_R;
        const ringOuter = data.radius * RING_OUTER_R;
        const bandPairs = [
            [1.66, 1.74],
            [2.05, 2.11],
            [2.16, 2.17],
            [2.17, 2.32],
            [2.32, 2.33],
            [2.51, 2.52],
            [2.55, 2.57],
        ];
        const bandWorld = bandPairs.map(([r0, r1]) => [data.radius * r0, data.radius * r1]);
        const ringTex = createCanvasTexture(256, 256, drawNeptuneRingTexture);
        ringTex.userData.systemOwned = true;
        ringTex.wrapS = THREE.ClampToEdgeWrapping;
        ringTex.wrapT = THREE.ClampToEdgeWrapping;
        const ringGeo = createRingGeometry(ringInner, ringOuter, 256, data.radius * 0.28 / BodyShapes.maxRadiusKm("neptune"));
        const ringMat = new THREE.MeshStandardMaterial({
            map: ringTex,
            color: new THREE.Color(0xffffff),
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            opacity: 0.45,
            roughness: 1.0,
            metalness: 0.0,
        });
        ringMat.side=THREE.FrontSide;
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.renderOrder = 3;
        mesh.add(ringMesh);
        objectRegistry['neptune-ring'] = ringMesh;
        mesh.userData.ringMesh = ringMesh;
        installRingParticleShadow(ringMat, mesh, false);
        installRingSunShading(ringMat, { density: 0.45, glow: 1.6, glowColor: 0xb0aca4,
            body: mesh, shineRadius: mesh.geometry.parameters.radius, shine: 0.12, shineColor: 0xc4c0b6 });
        installRingPlanetOcclusion(ringMat, mesh.geometry.parameters.radius, 'neptune-ring-occ');
        mesh.userData.ringShadowUniforms =
            installRingShadowReceiver(mesh, ringInner, ringOuter, 0.12, bandWorld);
    }
}
function clearSystem() {
    cometLayer.clearRender();
    if (planetVisuals) { planetVisuals.dispose(); planetVisuals = null; }
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
    const disposedOwnedTextures = new Set();
    while (solarSystem.children.length > 0) {
        const c = solarSystem.children[0];
        solarSystem.remove(c);
        c.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                for (const material of (Array.isArray(o.material) ? o.material : [o.material])) {
                    const texture = material.map;
                    if (texture?.userData.systemOwned && !disposedOwnedTextures.has(texture)) {
                        disposedOwnedTextures.add(texture);texture.dispose();
                    }
                }
                if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
                else o.material.dispose();
            }
        });
    }
    planets.length = 0;
    orbitLines.length = 0;
    for (const k in objectRegistry) delete objectRegistry[k];
    if (typeof destroySunLensArtifacts === 'function') destroySunLensArtifacts();
    sunCoronaMesh = null;
    sunHaloMesh = null;
    sunSurfaceSpriteMesh = null;
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
    applyStarVisibility();
    createAsteroidBelt();
    solarAccuracy.rebuild();
    solarAccuracy.update(simTimeMs, { camera, showOrbits: showOrbits && pathSettings.style === 'orbits' });
    moonEclipses.rebuild();
    extraBodies.rebuild();
    cometLayer.rebuild(cometsVisible());
    textureLodReset();
    loadTexturesFromFolder();
    resonantPopulations.rebuild({ useCatalog: true });
    nearEarth.rebuild({ useCatalog: true });
    kuiperBelt.rebuild(asteroidTypeEnabled('kuiperbelt'));
    ringAsteroids.rebuild();
    enforceAsteroidVisibility();
    applySkyLayers();
}
