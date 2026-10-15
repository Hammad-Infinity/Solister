let _beltLastDays = NaN;

function createProceduralRockGeometry(detail = 0) {
    const geometry = new THREE.IcosahedronGeometry(1, detail);
    const positions = geometry.getAttribute("position");
    for (let j = 0; j < positions.count; j++) {
        const x = positions.getX(j);
        const y = positions.getY(j);
        const z = positions.getZ(j);
        const deformation = 1 + .075 * Math.sin(x * 5.3 + y * 2.7 + z * 3.1) + .045 * Math.cos(x * 3.8 - y * 4.1 + z * 2.3);
        positions.setXYZ(j, x * deformation, y * deformation, z * deformation);
    }
    positions.needsUpdate = true;
    geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3);
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.computeBoundingSphere();
    const radius = geometry.boundingSphere.radius;
    geometry.scale(1 / radius, 1 / radius, 1 / radius);
    geometry.computeVertexNormals();
    const normals = geometry.getAttribute("normal"), bins = new Map;
    for (let i = 0; i < positions.count; i++) {
        const key = [ positions.getX(i), positions.getY(i), positions.getZ(i) ].map(x => Math.round(x * 1e6)).join(",");
        let b = bins.get(key);
        if (!b) {
            b = {
                indices: [],
                sum: new THREE.Vector3
            };
            bins.set(key, b);
        }
        b.indices.push(i);
        b.sum.add(new THREE.Vector3(normals.getX(i), normals.getY(i), normals.getZ(i)));
    }
    for (const b of bins.values()) {
        b.sum.normalize();
        for (const i of b.indices) normals.setXYZ(i, b.sum.x, b.sum.y, b.sum.z);
    }
    normals.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.deleteAttribute("uv");
    return geometry;
}

function addAsteroidMarkers(belt) {
    const source = belt.geometry;
    const count = source.getAttribute("aOrbit").count;
    const geometry = new THREE.BufferGeometry;
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) normals[i * 3 + 1] = 1;
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    for (const name of [ "aOrbit", "bOrbit", "aRock" ]) {
        const attribute = source.getAttribute(name);
        geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array, 4));
    }
    geometry.setAttribute("aMarkerIndex", new THREE.BufferAttribute(Float32Array.from({
        length: count
    }, (_, i) => i), 1));
    let vertexShader = belt.material.vertexShader.replace("if (uSkipReference > 0.5 && all(equal(aOrbit, uReferenceOrbit))) { gl_Position=vec4(2.0,2.0,2.0,1.0);return; }", "").replace("vec4(scenePosition + localVertex, 1.0)", "vec4(abs(aMarkerIndex-uFocusMarker)<0.5 ? uFocusPosition : scenePosition, 1.0)");
    const closingBrace = vertexShader.lastIndexOf("}");
    vertexShader = "uniform float uFocusMarker;\nuniform vec3 uFocusPosition;\nattribute float aMarkerIndex;\nvarying float vMarkerCoverage;\n" + vertexShader.slice(0, closingBrace) + "\nvec3 markerPosition = abs(aMarkerIndex-uFocusMarker)<0.5 ? uFocusPosition : scenePosition;\n" + "vec4 markerView = modelViewMatrix * vec4(markerPosition, 1.0);\n" + "float markerDepth = max(1e-4, -markerView.z);\n" + "float markerPixels = max(0.0, 2.0 * aRock.x * (0.5 * projectionMatrix[1][1] * uViewH) / markerDepth);\n" + "gl_PointSize = max(markerPixels, 1.0);\n" + "vMarkerCoverage = min(1.0, markerPixels * markerPixels / (gl_PointSize * gl_PointSize));\n" + vertexShader.slice(closingBrace);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            ...belt.material.uniforms,
            uFocusMarker: {
                value: -1
            },
            uFocusPosition: {
                value: objectRegistry.asteroidbelt.position
            }
        },
        vertexShader: vertexShader,
        fragmentShader: `${LDB_FRAGMENT_PARS}\n            varying float vBrightness;\n            varying float vMarkerCoverage;\n            void main() {${LDB_FRAGMENT_HEAD}\n                float r = length(gl_PointCoord - vec2(0.5));\n                if (r > 0.5) discard;\n                float alpha = (1.0 - smoothstep(0.12, 0.5, r)) * 0.90 * vMarkerCoverage;\n                vec3 rockColor = mix(vec3(0.16, 0.145, 0.13), vec3(0.38, 0.35, 0.31), vBrightness);\n                vec3 markerColor = mix(rockColor, vec3(0.64, 0.76, 0.96), 0.82);\n                gl_FragColor = vec4(markerColor, alpha);\n            }\n        `,
        transparent: true,
        depthTest: true,
        depthWrite: false
    });
    const markers = new THREE.Points(geometry, material);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3, 4.1 * AU_UNITS);
    markers.frustumCulled = true;
    markers.raycast = () => {};
    markers.visible = true;
    solarSystem.add(markers);
    belt.userData.markers = markers;
}

function createAsteroidBelt() {
    const count = ASTEROID_RENDER.count;
    const TAU = Math.PI * 2;
    let seed = 73129;
    function random() {
        seed = Math.imul(seed, 1664525) + 1013904223 >>> 0;
        return seed / 4294967296;
    }
    const rockShapes = new Float32Array(count * 4);
    const orbitA = new Float32Array(count * 4);
    const orbitB = new Float32Array(count * 4);
    const gaps = [ [ 2.5, .025 ], [ 2.82, .02 ], [ 2.96, .018 ], [ 3.27, .025 ] ];
    for (let j = 0; j < count; j++) {
        let a;
        do {
            a = 2.1 + random() * 1.2;
        } while (gaps.some(([center, width]) => Math.abs(a - center) < width) && random() < .94);
        const e = .025 + Math.pow(random(), 1.8) * .2;
        const inclination = Math.pow(random(), 1.8) * 22 * Math.PI / 180;
        const node = random() * TAU;
        const periapsis = random() * TAU;
        const meanAnomaly = random() * TAU;
        const meanMotion = .01720209895 / Math.pow(a, 1.5);
        orbitA.set([ a, e, inclination, node ], j * 4);
        orbitB.set([ periapsis, meanAnomaly, meanMotion, .55 + random() * .45 ], j * 4);
        const minDiameterKm = .5;
        const maxDiameterKm = 100;
        const exponent = 1.5;
        const sample = random();
        const diameterKm = Math.pow(Math.pow(minDiameterKm, -exponent) - sample * (Math.pow(minDiameterKm, -exponent) - Math.pow(maxDiameterKm, -exponent)), -1 / exponent);
        const axisX = .75 + random() * .5;
        const axisY = .75 + random() * .5;
        const axisZ = 1 / (axisX * axisY);
        rockShapes.set([ km2u(diameterKm * .5), axisX, axisY, axisZ ], j * 4);
    }
    const baseRock = createProceduralRockGeometry(ASTEROID_RENDER.detail);
    const geometry = new THREE.InstancedBufferGeometry;
    geometry.setIndex(baseRock.getIndex());
    for (const name of Object.keys(baseRock.attributes)) {
        geometry.setAttribute(name, baseRock.getAttribute(name));
    }
    baseRock.dispose();
    geometry.instanceCount = 0;
    geometry.setAttribute("aOrbit", new THREE.InstancedBufferAttribute(orbitA, 4));
    geometry.setAttribute("bOrbit", new THREE.InstancedBufferAttribute(orbitB, 4));
    geometry.setAttribute("aRock", new THREE.InstancedBufferAttribute(rockShapes, 4));
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uDays: {
                value: 0
            },
            uViewH: {
                value: 1080
            },
            uAU: {
                value: AU_UNITS
            },
            uSkipReference: {
                value: 0
            },
            uReferenceOrbit: {
                value: new THREE.Vector4
            }
        },
        vertexShader: `${LDB_VERTEX_PARS}\n            attribute vec4 aOrbit;\n            attribute vec4 bOrbit;\n            attribute vec4 aRock;\n            varying float vLight;\n            varying float vBrightness;\n            varying float vMarkerCoverage;\n            uniform float uDays;\n            uniform float uAU;\n            uniform float uViewH;\n            uniform float uSkipReference;uniform vec4 uReferenceOrbit;\n            void main() {\n                if (uSkipReference > 0.5 && all(equal(aOrbit, uReferenceOrbit))) { gl_Position=vec4(2.0,2.0,2.0,1.0);return; }\n                float a = aOrbit.x;\n                float e = aOrbit.y;\n                float inc = aOrbit.z;\n                float node = aOrbit.w;\n                float peri = bOrbit.x;\n                float M = mod(\n                    bOrbit.y + bOrbit.z * uDays,\n                    6.28318530718\n                );\n                float E = M;\n                for (int k = 0; k < 5; k++) {\n                    E -= (E - e * sin(E) - M)\n                       / (1.0 - e * cos(E));\n                }\n                float displayA = a * uAU;\n                float x = displayA * (cos(E) - e);\n                float y = displayA * sqrt(1.0 - e * e) * sin(E);\n                float cw = cos(peri);\n                float sw = sin(peri);\n                float co = cos(node);\n                float so = sin(node);\n                float ci = cos(inc);\n                float si = sin(inc);\n                float X = (cw * co - sw * so * ci) * x\n                        + (-sw * co - cw * so * ci) * y;\n                float Y = (cw * so + sw * co * ci) * x\n                        + (-sw * so + cw * co * ci) * y;\n                float Z = sw * si * x + cw * si * y;\n                vec3 scenePosition = vec3(X, Z, -Y);\n                float rockRadius = max(aRock.x, 0.0);\n                float angle = bOrbit.y;\n                float ca = cos(angle);\n                float sa = sin(angle);\n                mat3 rockRotation = mat3(\n                     ca, 0.0, sa,\n                    0.0, 1.0, 0.0,\n                    -sa, 0.0, ca\n                );\n                vec3 localVertex =\n                    rockRotation * (position * aRock.yzw * rockRadius);\n                vec3 rockNormal = normalize(\n                    rockRotation * (normal / aRock.yzw)\n                );\n                vec3 sunDirection = normalize(-scenePosition);\n                vLight = 0.025 +\n                    0.975 * max(dot(rockNormal, sunDirection), 0.0);\n                vBrightness = bOrbit.w;\n                gl_Position = projectionMatrix * modelViewMatrix *\n                    vec4(scenePosition + localVertex, 1.0);${LDB_VERTEX_TAIL}\n            }\n        `,
        fragmentShader: `${LDB_FRAGMENT_PARS}\n            varying float vBrightness;\n            varying float vLight;\n            void main() {${LDB_FRAGMENT_HEAD}\n                vec3 rockColor = mix(\n                    vec3(0.16, 0.145, 0.13),\n                    vec3(0.38, 0.35, 0.31),\n                    vBrightness\n                );\n                gl_FragColor = vec4(rockColor * mix(vLight, vLight * vLight, 0.65), 1.0);\n            }\n        `,
        transparent: false,
        depthTest: true,
        depthWrite: true
    });
    asteroidBelt = new THREE.Mesh(geometry, material);
    asteroidBelt.visible = asteroidTypeEnabled("asteroidbelt");
    const rockPointGeo = new THREE.BufferGeometry;
    rockPointGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    rockPointGeo.setAttribute("aOrbit", new THREE.BufferAttribute(orbitA, 4));
    rockPointGeo.setAttribute("bOrbit", new THREE.BufferAttribute(orbitB, 4));
    rockPointGeo.setAttribute("aRock", new THREE.BufferAttribute(rockShapes, 4));
    rockPointGeo.setDrawRange(0, count);
    rockPointGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4.1 * AU_UNITS);
    const rockPoints = new THREE.Points(rockPointGeo, new THREE.ShaderMaterial({
        uniforms: material.uniforms,
        vertexShader: `${LDB_VERTEX_PARS}\n            attribute vec4 aOrbit;\n            attribute vec4 bOrbit;\n            attribute vec4 aRock;\n            varying float vLight;\n            varying float vBrightness;\n            varying float vMarkerCoverage;\n            uniform float uDays;\n            uniform float uAU;\n            uniform float uViewH;\n            uniform float uSkipReference;uniform vec4 uReferenceOrbit;\n            void main() {\n                if (uSkipReference > 0.5 && all(equal(aOrbit, uReferenceOrbit))) { gl_Position=vec4(2.0,2.0,2.0,1.0);return; }\n                float a = aOrbit.x;\n                float e = aOrbit.y;\n                float inc = aOrbit.z;\n                float node = aOrbit.w;\n                float peri = bOrbit.x;\n                float M = mod(bOrbit.y + bOrbit.z * uDays, 6.28318530718);\n                float E = M;\n                for (int k = 0; k < 5; k++) { E -= (E - e * sin(E) - M) / (1.0 - e * cos(E)); }\n                float displayA = a * uAU;\n                float x = displayA * (cos(E) - e);\n                float y = displayA * sqrt(1.0 - e * e) * sin(E);\n                float cw = cos(peri), sw = sin(peri), co = cos(node), so = sin(node);\n                float ci = cos(inc), si = sin(inc);\n                float X = (cw * co - sw * so * ci) * x + (-sw * co - cw * so * ci) * y;\n                float Y = (cw * so + sw * co * ci) * x + (-sw * so + cw * co * ci) * y;\n                float Z = sw * si * x + cw * si * y;\n                vec3 scenePosition = vec3(X, Z, -Y);\n                vec4 mv = modelViewMatrix * vec4(scenePosition, 1.0);\n                float viewDepth = max(1e-4, -mv.z);\n                float rockRadius = max(aRock.x, 0.0);\n                float physicalPixels = max(0.0, 2.0 * rockRadius * (0.5 * projectionMatrix[1][1] * uViewH)\n                    / viewDepth);\n                gl_PointSize = max(physicalPixels, 1.0);\n                vMarkerCoverage = min(1.0, physicalPixels * physicalPixels / (gl_PointSize * gl_PointSize));\n                vBrightness = bOrbit.w;\n                vLight = 0.025 + 0.975 * max(dot(normalize(-mv.xyz), normalize(-scenePosition)), 0.0);\n                gl_Position = projectionMatrix * mv;${LDB_VERTEX_TAIL}\n            }\n        `,
        fragmentShader: `${LDB_FRAGMENT_PARS}\n            varying float vLight;\n            varying float vBrightness;\n            varying float vMarkerCoverage;\n            void main() {${LDB_FRAGMENT_HEAD}\n                float d = dot(gl_PointCoord - 0.5, gl_PointCoord - 0.5) * 4.0;\n                if (d > 1.0) discard;\n                vec3 rockColor = mix(vec3(0.16, 0.145, 0.13), vec3(0.38, 0.35, 0.31), vBrightness);\n                gl_FragColor = vec4(rockColor * mix(vLight, vLight * vLight, 0.65)\n                    * (0.62 + 0.38 * sqrt(max(0.0, 1.0 - d))), vMarkerCoverage);\n            }\n        `,
        transparent: true,
        depthTest: true,
        depthWrite: false
    }));
    rockPoints.frustumCulled = true;
    rockPoints.raycast = () => {};
    rockPoints.visible = false;
    solarSystem.add(rockPoints);
    asteroidBelt.userData.rockPoints = rockPoints;
    asteroidBelt.userData.orbitAAll = orbitA;
    asteroidBelt.userData.orbitBAll = orbitB;
    asteroidBelt.userData.rockShapesAll = rockShapes;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4.1 * AU_UNITS);
    asteroidBelt.frustumCulled = true;
    asteroidBelt.raycast = () => {};
    solarSystem.add(asteroidBelt);
    const beltExtent = 4.1 * AU_UNITS;
    const beltTarget = new THREE.Object3D;
    beltTarget.userData = {
        planetKey: "asteroidbelt",
        planetName: "Asteroid Belt",
        focusRadius: beltExtent
    };
    solarSystem.add(beltTarget);
    objectRegistry.asteroidbelt = beltTarget;
    let focusIndex = 0, centralCandidate = false;
    for (let i = 0; i < count; i++) {
        const a = orbitA[i * 4], e = orbitA[i * 4 + 1], inc = orbitA[i * 4 + 2];
        const central = a >= 2.35 && a <= 2.8 && e <= .12 && inc <= 5 * Math.PI / 180;
        if (central) {
            if (!centralCandidate || rockShapes[i * 4] > rockShapes[focusIndex * 4]) focusIndex = i;
            centralCandidate = true;
        } else if (!centralCandidate && rockShapes[i * 4] > rockShapes[focusIndex * 4]) focusIndex = i;
    }
    beltTarget.userData.orbitA = Array.from(orbitA.subarray(focusIndex * 4, focusIndex * 4 + 4));
    beltTarget.userData.orbitB = Array.from(orbitB.subarray(focusIndex * 4, focusIndex * 4 + 4));
    beltTarget.userData.rockRadius = rockShapes[focusIndex * 4];
    beltTarget.userData.focusRadius = beltTarget.userData.rockRadius * Math.max(rockShapes[focusIndex * 4 + 1], rockShapes[focusIndex * 4 + 2], rockShapes[focusIndex * 4 + 3]);
    const closeRockMaterial = new THREE.MeshStandardMaterial({
        color: 9142386,
        roughness: 1,
        metalness: 0
    });
    applySurfaceBrdf(closeRockMaterial, "asteroid", THREE);
    const closeRock = new THREE.Mesh(createProceduralRockGeometry(6), closeRockMaterial);
    const rockRadius = beltTarget.userData.rockRadius;
    closeRock.scale.set(rockRadius * rockShapes[focusIndex * 4 + 1], rockRadius * rockShapes[focusIndex * 4 + 2], rockRadius * rockShapes[focusIndex * 4 + 3]);
    closeRock.rotation.y = -orbitB[focusIndex * 4 + 1];
    closeRock.visible = false;
    beltTarget.add(closeRock);
    beltTarget.userData.closeRock = closeRock;
    asteroidBelt.userData.focusIndex = focusIndex;
    asteroidBelt.material.uniforms.uReferenceOrbit.value.fromArray(orbitA, focusIndex * 4);
    addAsteroidMarkers(asteroidBelt);
}

function updateBeltFocusTarget(days) {
    if (Math.abs(days - _beltLastDays) < .001) return;
    _beltLastDays = days;
    const target = objectRegistry.asteroidbelt;
    if (!target?.userData.orbitA) return;
    const [a, e, inc, node] = target.userData.orbitA;
    const [peri, initialM, meanMotion] = target.userData.orbitB;
    const tau = Math.PI * 2;
    let M = (initialM + meanMotion * days) % tau;
    if (M < 0) M += tau;
    let E = M;
    for (let i = 0; i < 5; i++) {
        E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    }
    const displayA = a * AU_UNITS;
    const x = displayA * (Math.cos(E) - e);
    const y = displayA * Math.sqrt(1 - e * e) * Math.sin(E);
    const cw = Math.cos(peri), sw = Math.sin(peri);
    const co = Math.cos(node), so = Math.sin(node);
    const ci = Math.cos(inc), si = Math.sin(inc);
    const X = (cw * co - sw * so * ci) * x + (-sw * co - cw * so * ci) * y;
    const Y = (cw * so + sw * co * ci) * x + (-sw * so + cw * co * ci) * y;
    const Z = sw * si * x + cw * si * y;
    target.position.set(X, Z, -Y);
}

function updateAsteroidBelt() {
    if (!asteroidBelt) return;
    const uniforms = asteroidBelt.material.uniforms;
    uniforms.uDays.value = simTimeMs / 864e5 + 2440587.5 - 2451545;
    uniforms.uViewH.value = renderer.domElement && renderer.domElement.height || uniforms.uViewH.value;
    uniforms.uSkipReference.value = focusedObject?.userData.planetKey === "asteroidbelt" ? 1 : 0;
    const _graphicsAsteroidCount = GRAPHICS_ASTEROID_COUNT[textureQuality] ?? ASTEROID_RENDER.count;
    asteroidBelt.geometry.instanceCount = 0;
    asteroidBelt.visible = false;
    if (asteroidBelt.userData.rockPoints) {
        asteroidBelt.userData.rockPoints.visible = asteroidTypeEnabled("asteroidbelt");
        asteroidBelt.userData.rockPoints.geometry.setDrawRange(0, _graphicsAsteroidCount);
    }
    const _beltClose = beltProximity() > .3;
    if (asteroidBelt.userData.markers) asteroidBelt.userData.markers.material.uniforms.uFocusMarker.value = !_beltClose && focusedObject?.userData.planetKey === "asteroidbelt" ? asteroidBelt.userData.focusIndex : -1;
    updateBeltFocusTarget(uniforms.uDays.value);
    const markers = asteroidBelt.userData.markers;
    if (markers) {
        markers.visible = asteroidTypeEnabled("asteroidbelt") && !_beltClose && beltGuideEnabled;
    }
}

function updateAsteroidMarkerLOD() {
    const markers = asteroidBelt?.userData.markers;
    if (!markers) return;
    const proximity = asteroidTypeEnabled("asteroidbelt") ? beltProximity() : 0;
    markers.visible = asteroidTypeEnabled("asteroidbelt") && proximity <= .3 && beltGuideEnabled;
    const target = objectRegistry.asteroidbelt;
    if (target) {
        target.visible = asteroidTypeEnabled("asteroidbelt");
        if (target.userData.closeRock) {
            target.userData.closeRock.visible = asteroidTypeEnabled("asteroidbelt") && (focusedObject === target || proximity > .3);
        }
    }
}
