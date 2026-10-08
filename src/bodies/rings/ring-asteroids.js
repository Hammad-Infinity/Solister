const TAU = Math.PI * 2;
const QUALITY = { low: 0.25, medium: 0.55, high: 1 };
const FADE_START = 8;
const FADE_END = 16;
const FADE_SECONDS = 0.22;
const POPULATION_SECONDS = 0.3;
const POPULATION_FEATHER = 0.025;
const REBASE_DAYS = 128;
const SATURN_BANDS = [
    [0, 0.103, 0.05], [0.106, 0.342, 0.3], [0.342, 0.689, 1],
    [0.689, 0.752, 0.04], [0.752, 0.906, 0.62], [0.911, 0.95, 0.66],
    [0.95, 0.985, 0.03], [0.993, 0.999, 0.9],
];
const URANUS_BANDS = [
    [0.016, 0.024, 0.06], [0.05, 0.066, 0.1], [0.086, 0.104, 0.14],
    [0.308, 0.324, 0.55], [0.4, 0.421, 0.5], [0.553, 0.574, 0.22],
    [0.603, 0.624, 0.3], [0.674, 0.695, 0.35], [0.85, 0.871, 0.45],
    [0.966, 0.987, 1],
];
const NEPTUNE_BANDS = [
    [1.66, 1.74, 0.14], [2.05, 2.11, 0.1], [2.16, 2.17, 0.55],
    [2.17, 2.32, 0.18], [2.32, 2.33, 0.48], [2.51, 2.52, 0.12],
    [2.55, 2.57, 0.8],
];
const ADAMS_ARCS = [
    [0.470, 0.045], [0.505, 0.030], [0.545, 0.036], [0.590, 0.026], [0.632, 0.040],
];
const SYSTEMS = [
    {
        planetKey: 'saturn', ringKey: 'saturn-ring', seed: 0x5EED0001,
        innerR: 1.11, outerR: 2.33, radiusKm: 60268, gm: 3.793118e7,
        count: 160000, tint: 0xa39c8d,
        minDiameter: 0.02, maxDiameter: 10, thickness: 4.25,
    },
    {
        planetKey: 'uranus', ringKey: 'uranus-ring', seed: 0x5EED0002,
        innerR: 1.63, outerR: 2.01, radiusKm: 25559, gm: 5.793939e6,
        count: 60000, tint: 0x777b80,
        minDiameter: 0.03, maxDiameter: 5, thickness: 20,
    },
    {
        planetKey: 'neptune', ringKey: 'neptune-ring', seed: 0x5EED0003,
        innerR: 1.6, outerR: 2.65, radiusKm: 24764, gm: 6.836529e6,
        count: 60000, tint: 0x968b80,
        minDiameter: 0.0001, maxDiameter: 2, thickness: 35,
    },
];
function smoothstep(start, end, value) {
    const t = Math.max(0, Math.min(1, (value - start) / Math.max(1e-12, end - start)));
    return t * t * (3 - 2 * t);
}
function wrapAngle(value) {
    return value - TAU * Math.floor(value / TAU);
}
function randomGenerator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}
function gaussian(random) {
    return Math.sqrt(-2 * Math.log(Math.max(1e-7, random()))) * Math.cos(TAU * random());
}
function particleDiameter(random, minimum, maximum) {
    const power = -1.15;
    const low = Math.pow(minimum, power);
    const high = Math.pow(maximum, power);
    return Math.pow(low + (high - low) * random(), 1 / power);
}
function triangularBand(value, start, end) {
    return Math.max(0, 1 - Math.abs(value - (start + end) * 0.5) / ((end - start) * 0.5));
}
function softBand(value, start, end, softness) {
    return smoothstep(start - softness, start + softness, value) *
        (1 - smoothstep(end - softness, end + softness, value));
}
function ringBounds(ring, radius, system) {
    const position = ring.geometry?.getAttribute('position');
    let inner = Infinity;
    let outer = 0;
    if (position) {
        for (let i = 0; i < position.count; i++) {
            const distance = Math.hypot(position.getX(i), position.getY(i));
            inner = Math.min(inner, distance);
            outer = Math.max(outer, distance);
        }
    }
    if (!(inner > 0 && outer > inner && Number.isFinite(inner))) {
        inner = radius * system.innerR;
        outer = radius * system.outerR;
    }
    return { inner, outer };
}
function ringDensity(system, ring, innerRatio, outerRatio) {
    if (system.planetKey === 'saturn') {
        const gaps = ring.material?.userData?.ringGaps;
        const cassini = gaps?.cassini || [0.6893, 0.7516];
        const encke = gaps?.encke || [0.9066, 0.911];
        return value => {
            let density = 0.015;
            for (const [start, end, weight] of SATURN_BANDS) {
                if (value >= start && value <= end) {
                    density = weight;
                    break;
                }
            }
            const gap = Math.max(
                softBand(value, cassini[0], cassini[1], 0.004),
                softBand(value, encke[0], encke[1], 0.001)
            );
            return density * (1 - 0.98 * gap);
        };
    }
    if (system.planetKey === 'uranus') {
        return value => {
            let density = 0.004;
            for (const [start, end, weight] of URANUS_BANDS) {
                density += weight * triangularBand(value, start, end);
            }
            return density;
        };
    }
    return value => {
        const radius = innerRatio + (outerRatio - innerRatio) * value;
        let density = 0.003;
        for (const [start, end, weight] of NEPTUNE_BANDS) {
            density += weight * triangularBand(radius, start, end);
        }
        return density;
    };
}
function radialSampler(density, innerRatio, outerRatio) {
    const segments = 4096;
    const cumulative = new Float64Array(segments + 1);
    for (let i = 0; i < segments; i++) {
        const value = (i + 0.5) / segments;
        const radius = innerRatio + (outerRatio - innerRatio) * value;
        cumulative[i + 1] = cumulative[i] + Math.max(0, density(value)) * radius;
    }
    const total = cumulative[segments] || 1;
    return random => {
        const target = random * total;
        let low = 0;
        let high = segments - 1;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (cumulative[middle + 1] < target) low = middle + 1;
            else high = middle;
        }
        const fraction = (target - cumulative[low]) /
            Math.max(1e-12, cumulative[low + 1] - cumulative[low]);
        return (low + Math.max(0, Math.min(1, fraction))) / segments;
    };
}
const MARKER_VERTEX_PARAMETERS = `
attribute vec4 aOrbit;
attribute vec4 aMisc;
attribute vec4 aStyle;
uniform float uDays;
uniform float uSpin;
uniform float uFade;
uniform float uPopulation;
uniform float uPopulationFeather;
uniform float uViewHeight;
uniform float uViewWidth;
uniform float uUnitsPerMeter;
uniform vec2 uRingBounds;
varying float vMarkerAlpha;
varying float vMarkerShade;
varying vec2 vMarkerShape;
`;
const MARKER_FRAGMENT_PARAMETERS = `
varying float vMarkerAlpha;
varying float vMarkerShade;
varying vec2 vMarkerShape;
`;
const MARKER_FRAGMENT_SHAPE = `
    vec2 markerPoint = gl_PointCoord * 2.0 - 1.0;
    float markerCos = cos(vMarkerShape.y);
    float markerSin = sin(vMarkerShape.y);
    markerPoint = vec2(markerCos * markerPoint.x - markerSin * markerPoint.y,
        markerSin * markerPoint.x + markerCos * markerPoint.y);
    markerPoint.y /= vMarkerShape.x;
    float markerAngle = atan(markerPoint.y, markerPoint.x);
    float markerOutline = 0.91 + 0.045 * sin(3.0 * markerAngle + vMarkerShape.y) +
        0.025 * sin(5.0 * markerAngle - vMarkerShape.y);
    float markerEdge = 1.0 - smoothstep(0.58, 1.0, length(markerPoint) / markerOutline);
    float markerSurfaceAlpha = diffuseColor.a;
    diffuseColor.a *= markerEdge * vMarkerAlpha;
    if (diffuseColor.a < 0.001) discard;
`;
const MAP_CHANNELS = [
    ['MAP', 'Map', 'mapTransform'],
    ['ALPHAMAP', 'AlphaMap', 'alphaMapTransform'],
    ['EMISSIVEMAP', 'EmissiveMap', 'emissiveMapTransform'],
    ['ROUGHNESSMAP', 'RoughnessMap', 'roughnessMapTransform'],
    ['METALNESSMAP', 'MetalnessMap', 'metalnessMapTransform'],
    ['NORMALMAP', 'NormalMap', 'normalMapTransform'],
    ['BUMPMAP', 'BumpMap', 'bumpMapTransform'],
    ['LIGHTMAP', 'LightMap', 'lightMapTransform'],
    ['AOMAP', 'AoMap', 'aoMapTransform'],
];
const MATCHED_TEXTURES = [
    ['MAP', 'Map', 'map', 'map_fragment'],
    ['EMISSIVEMAP', 'EmissiveMap', 'emissiveMap', 'emissivemap_fragment'],
    ['ALPHAMAP', 'AlphaMap', 'alphaMap', 'alphamap_fragment'],
    ['ROUGHNESSMAP', 'RoughnessMap', 'roughnessMap', 'roughnessmap_fragment'],
    ['METALNESSMAP', 'MetalnessMap', 'metalnessMap', 'metalnessmap_fragment'],
];
const MATCHED_GRADIENTS = MATCHED_TEXTURES.map(([flag, name]) =>
    `#ifdef USE_${flag}\nvarying vec2 vMarker${name}Dx;\nvarying vec2 vMarker${name}Dy;\n#endif`).join('\n');
const MATCHED_SAMPLER = `
vec4 markerSurfaceSample(sampler2D source, vec2 uv, vec2 dx, vec2 dy) {
    #if __VERSION__ >= 300
        return textureGrad(source, uv, dx, dy);
    #elif defined(GL_EXT_shader_texture_lod)
        return texture2DGradEXT(source, uv, dx, dy);
    #else
        return texture2D(source, uv);
    #endif
}`;
function matchingRingMaterial(THREE, ring, uniforms) {
    const source = ring.material;
    const material = source.clone();
    material.transparent = true;
    material.forceSinglePass = true;
    material.extensions = { ...material.extensions, shaderTextureLOD: true };
    material.depthWrite = false;
    material.depthTest = true;
    material.onBeforeCompile = (shader, renderer) => {
        source.onBeforeCompile.call(source, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = MARKER_VERTEX_PARAMETERS + MATCHED_GRADIENTS + '\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('void main() {', `void main() {
            float markerOrbitAngle = mod(aOrbit.z + aOrbit.w * uDays - uSpin, PI2);
            vec3 markerPosition = vec3(aOrbit.x * cos(markerOrbitAngle),
                aOrbit.x * sin(markerOrbitAngle), aOrbit.y);
            vec4 markerClip = projectionMatrix * modelViewMatrix * vec4(markerPosition, 1.0);
            vec4 markerClipX = projectionMatrix * modelViewMatrix[0];
            vec4 markerClipY = projectionMatrix * modelViewMatrix[1];
            vec2 markerPixelScale = 0.5 * vec2(uViewWidth, uViewHeight) / max(markerClip.w * markerClip.w, 1e-20);
            vec2 markerScreenX = (markerClipX.xy * markerClip.w - markerClip.xy * markerClipX.w) * markerPixelScale;
            vec2 markerScreenY = (markerClipY.xy * markerClip.w - markerClip.xy * markerClipY.w) * markerPixelScale;
            float markerDeterminant = markerScreenX.x * markerScreenY.y - markerScreenY.x * markerScreenX.y;
            float markerInverse = (markerDeterminant < 0.0 ? -1.0 : 1.0) / max(abs(markerDeterminant), 1e-10);
            vec2 markerLocalX = vec2(markerScreenY.y, -markerScreenX.y) * markerInverse;
            vec2 markerLocalY = vec2(-markerScreenY.x, markerScreenX.x) * markerInverse;
            vec2 markerRadial = vec2(cos(markerOrbitAngle), sin(markerOrbitAngle));
            vec2 markerAngular = vec2(-markerRadial.y, markerRadial.x) / (PI2 * max(aOrbit.x, 1e-12));
            vec2 markerRadialUv = markerRadial / (uRingBounds.y - uRingBounds.x);
            vec2 markerUvDx = vec2(dot(markerAngular, markerLocalX), dot(markerRadialUv, markerLocalX));
            vec2 markerUvDy = vec2(dot(markerAngular, markerLocalY), dot(markerRadialUv, markerLocalY));
            vec2 markerUv = vec2(markerOrbitAngle / PI2,
                clamp((aOrbit.x - uRingBounds.x) / (uRingBounds.y - uRingBounds.x), 0.0, 1.0));`);
        shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>',
            '#include <uv_vertex>\n' + MATCHED_TEXTURES.map(([flag, name, texture]) =>
                `#ifdef USE_${flag}\nvMarker${name}Dx = (${texture}Transform * vec3(markerUvDx, 0.0)).xy;\nvMarker${name}Dy = (${texture}Transform * vec3(markerUvDy, 0.0)).xy;\n#endif`).join('\n') + '\n' + MAP_CHANNELS.map(([flag, name, transform]) =>
                `#ifdef USE_${flag}\nv${name}Uv = (${transform} * vec3(markerUv, 1.0)).xy;\n#endif`).join('\n'));
        shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
            #include <beginnormal_vertex>
            vec3 markerEye = -(modelViewMatrix * vec4(markerPosition, 1.0)).xyz;
            if (dot(normalMatrix * objectNormal, markerEye) < 0.0) objectNormal = -objectNormal;`);
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            transformed = markerPosition;`);
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
            #include <project_vertex>
            float markerPixelsPerUnit = 0.5 * projectionMatrix[1][1] * uViewHeight;
            float markerPhysicalPixels = max(0.0, aMisc.y * uUnitsPerMeter * markerPixelsPerUnit /
                max(0.0000001, -mvPosition.z));
            gl_PointSize = max(1.0, markerPhysicalPixels);
            float markerCoverage = min(1.0, markerPhysicalPixels * markerPhysicalPixels /
                (gl_PointSize * gl_PointSize));
            float markerPopulation = 1.0 - smoothstep(uPopulation,
                uPopulation + uPopulationFeather, aStyle.w);
            vMarkerAlpha = aMisc.x * uFade * markerPopulation * markerCoverage * 0.92;
            vMarkerShade = 0.9 + 0.08 * aMisc.z;
            vMarkerShape = aStyle.yz;`);
        shader.fragmentShader = MARKER_FRAGMENT_PARAMETERS + MATCHED_GRADIENTS + MATCHED_SAMPLER + '\n' + shader.fragmentShader;
        for (const [, name, texture, chunkName] of MATCHED_TEXTURES) {
            const chunk = THREE.ShaderChunk[chunkName];
            const pattern = new RegExp(`texture2D\\(\\s*${texture}\\s*,\\s*v${name}Uv\\s*\\)`, 'g');
            shader.fragmentShader = shader.fragmentShader.replace('#include <' + chunkName + '>',
                chunk.replace(pattern, `markerSurfaceSample(${texture}, v${name}Uv, vMarker${name}Dx, vMarker${name}Dy)`));
        }
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
            MARKER_FRAGMENT_SHAPE + '\n#include <opaque_fragment>');
        shader.fragmentShader = shader.fragmentShader.replace('#include <colorspace_fragment>',
            '#include <colorspace_fragment>\ngl_FragColor.rgb *= vMarkerShade * mix(0.55, 1.0, markerSurfaceAlpha);');
    };
    material.customProgramCacheKey = () => source.customProgramCacheKey() + '|ring-surface-points-3';
    return material;
}
function syncRingMaterial(layer) {
    const source = layer.ring.material;
    const material = layer.points.material;
    material.color?.copy(source.color);
    material.emissive?.copy(source.emissive);
    material.normalScale?.copy(source.normalScale);
    for (const key of ['opacity', 'emissiveIntensity', 'roughness', 'metalness', 'envMapIntensity', 'lightMapIntensity', 'aoMapIntensity', 'toneMapped', 'fog']) {
        if (source[key] !== undefined) material[key] = source[key];
    }
    for (const key of ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'envMap', 'lightMap', 'aoMap']) {
        if (material[key] !== source[key]) {
            material[key] = source[key];
            material.needsUpdate = true;
        }
    }
    if (layer.sourceVersion !== source.version) {
        layer.sourceVersion = source.version;
        material.needsUpdate = true;
    }
    layer.points.receiveShadow = layer.ring.receiveShadow;
}
export class RingAsteroids {
    constructor({ THREE, camera, renderer, objectRegistry, km2u, countScale = 1, getQuality }) {
        Object.assign(this, { THREE, camera, renderer, objectRegistry, km2u });
        this.moduleBuild = 'r28-surface-shading';
        this.countScale = Number.isFinite(countScale) ? Math.max(0.01, countScale) : 1;
        this.getQuality = typeof getQuality === 'function' ? getQuality : () => 'high';
        this.layers = [];
        this.dayBase = null;
        this.population = QUALITY[this.getQuality()] ?? QUALITY.high;
        this.cameraPosition = new THREE.Vector3();
        this.ringPosition = new THREE.Vector3();
        this.worldScale = new THREE.Vector3();
    }
    dispose() {
        for (const layer of this.layers) {
            layer.points.removeFromParent();
            layer.points.geometry.dispose();
            layer.points.material.dispose();
        }
        this.layers = [];
        this.dayBase = null;
    }
    isCurrent() {
        let count = 0;
        for (const system of SYSTEMS) {
            if (this.objectRegistry[system.planetKey] && this.objectRegistry[system.ringKey]) count++;
        }
        if (count !== this.layers.length) return false;
        return this.layers.every(layer =>
            this.objectRegistry[layer.system.planetKey] === layer.planet &&
            this.objectRegistry[layer.system.ringKey] === layer.ring &&
            layer.planet.geometry?.parameters?.radius === layer.radius &&
            layer.ring.geometry === layer.ringGeometry &&
            layer.ring.material === layer.ringMaterial &&
            layer.points.parent === layer.ring
        );
    }
    rebuild() {
        if (this.isCurrent()) return;
        this.dispose();
        const T = this.THREE;
        for (const system of SYSTEMS) {
            const planet = this.objectRegistry[system.planetKey];
            const ring = this.objectRegistry[system.ringKey];
            const radius = planet?.geometry?.parameters?.radius;
            if (!planet || !ring || !(radius > 0)) continue;
            const bounds = ringBounds(ring, radius, system);
            const innerRatio = bounds.inner / radius;
            const outerRatio = bounds.outer / radius;
            const density = ringDensity(system, ring, innerRatio, outerRatio);
            const sample = radialSampler(density, innerRatio, outerRatio);
            const axes = planet.geometry.userData?.referenceAxesKm;
            const radiusKm = axes ? Math.max(...axes) : system.radiusKm;
            const unitsPerMeter = radius / (radiusKm * 1000);
            const count = Math.max(512, Math.round(system.count * this.countScale));
            const random = randomGenerator(system.seed);
            const positions = new Float32Array(count * 3);
            const normals = new Float32Array(count * 3);
            const uvs = new Float32Array(count * 2);
            const orbits = new Float32Array(count * 4);
            const properties = new Float32Array(count * 4);
            const styles = new Float32Array(count * 4);
            let maximumHeight = 0;
            for (let i = 0; i < count; i++) {
                const value = sample(random());
                const ratio = innerRatio + (outerRatio - innerRatio) * value;
                const orbitRadius = ratio * radius;
                const height = Math.max(-4, Math.min(4, gaussian(random))) * system.thickness * unitsPerMeter;
                let phase = random() * TAU;
                if (system.planetKey === 'neptune' && ratio >= 2.546 && ratio <= 2.574 && random() > 0.15) {
                    const [center, width] = ADAMS_ARCS[Math.floor(random() * ADAMS_ARCS.length)];
                    phase = wrapAngle((center + gaussian(random) * width) * TAU);
                }
                const orbitKm = ratio * radiusKm;
                const rate = 86400 * Math.sqrt(system.gm / (orbitKm * orbitKm * orbitKm));
                const diameter = particleDiameter(random, system.minDiameter, system.maxDiameter);
                const sizeVariation = Math.sqrt(Math.max(0, Math.min(1,
                    Math.log(diameter / system.minDiameter) / Math.log(system.maxDiameter / system.minDiameter)
                )));
                const p3=i*3,p2=i*2,p4=i*4;
                positions[p3]=orbitRadius*Math.cos(phase);positions[p3+1]=orbitRadius*Math.sin(phase);positions[p3+2]=height;
                normals[p3+2]=1;
                uvs[p2]=phase/TAU;uvs[p2+1]=value;
                orbits[p4]=orbitRadius;orbits[p4+1]=height;orbits[p4+2]=phase;orbits[p4+3]=rate;
                properties[p4]=.38+.4*random();properties[p4+1]=diameter;properties[p4+2]=random();properties[p4+3]=Math.min(1,density(value));
                styles[p4]=.62+.75*sizeVariation;styles[p4+1]=.76+.23*random();styles[p4+2]=random()*TAU;styles[p4+3]=(i+.5)/count;
                maximumHeight = Math.max(maximumHeight, Math.abs(height));
            }
            const geometry = new T.BufferGeometry();
            geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
            geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
            geometry.setAttribute('uv', new T.BufferAttribute(uvs, 2));
            geometry.setAttribute('aOrbit', new T.BufferAttribute(orbits, 4));
            geometry.setAttribute('aMisc', new T.BufferAttribute(properties, 4));
            geometry.setAttribute('aStyle', new T.BufferAttribute(styles, 4));
            geometry.boundingSphere = new T.Sphere(new T.Vector3(), Math.hypot(bounds.outer, maximumHeight));
            geometry.boundingBox = new T.Box3(
                new T.Vector3(-bounds.outer, -bounds.outer, -maximumHeight),
                new T.Vector3(bounds.outer, bounds.outer, maximumHeight)
            );
            const drawCount = Math.min(count, Math.ceil(count * (this.population + POPULATION_FEATHER)));
            geometry.setDrawRange(0, drawCount);
            const uniforms = {
                uDays: { value: 0 },
                uSpin: { value: 0 },
                uFade: { value: 0 },
                uPopulation: { value: this.population },
                uPopulationFeather: { value: POPULATION_FEATHER },
                uViewHeight: { value: 1080 },
                uViewWidth: { value: 1920 },
                uUnitsPerMeter: { value: unitsPerMeter },
                uRingBounds: { value: new T.Vector2(bounds.inner, bounds.outer) },
            };
            const material = matchingRingMaterial(T, ring, uniforms);
            const points = new T.Points(geometry, material);
            points.name = system.planetKey + '-ring-markers';
            points.renderOrder = ring.renderOrder || 0;
            points.frustumCulled = true;
            points.raycast = () => {};
            points.visible = false;
            ring.add(points);
            this.layers.push({
                system, planet, ring, ringGeometry: ring.geometry, ringMaterial: ring.material,
                sourceVersion: ring.material.version, points, uniforms,
                radius, outer: bounds.outer, count, drawCount, fade: 0,
            });
        }
    }
    rebase(days) {
        if (this.dayBase === null) this.dayBase = days;
        const elapsed = days - this.dayBase;
        if (Math.abs(elapsed) <= REBASE_DAYS) return;
        for (const layer of this.layers) {
            const attribute = layer.points.geometry.getAttribute('aOrbit');
            const orbits = attribute.array;
            for (let i = 0; i < layer.count; i++) {
                const offset = i * 4;
                orbits[offset + 2] = wrapAngle(orbits[offset + 2] + orbits[offset + 3] * elapsed);
            }
            attribute.needsUpdate = true;
        }
        this.dayBase = days;
    }
    update({ days, delta }) {
        if (!this.isCurrent()) this.rebuild();
        const time = Number.isFinite(days) ? days : 0;
        const dt = Math.max(0, Math.min(0.25, Number.isFinite(delta) ? delta : 1 / 60));
        const fadeEase = 1 - Math.exp(-dt / FADE_SECONDS);
        const populationEase = 1 - Math.exp(-dt / POPULATION_SECONDS);
        const targetPopulation = QUALITY[this.getQuality()] ?? QUALITY.high;
        this.population += (targetPopulation - this.population) * populationEase;
        if (Math.abs(targetPopulation - this.population) < 0.0001) this.population = targetPopulation;
        this.rebase(time);
        const viewHeight = this.renderer.domElement?.height || 1080;
        this.camera.updateWorldMatrix(true, false);
        this.camera.getWorldPosition(this.cameraPosition);
        for (const layer of this.layers) {
            layer.ring.getWorldPosition(this.ringPosition);
            layer.ring.getWorldScale(this.worldScale);
            const scale = Math.max(Math.abs(this.worldScale.x), Math.abs(this.worldScale.y), Math.abs(this.worldScale.z));
            const distance = this.cameraPosition.distanceTo(this.ringPosition) / Math.max(1e-12, layer.outer * scale);
            const targetFade = 1 - smoothstep(FADE_START, FADE_END, distance);
            layer.fade += (targetFade - layer.fade) * fadeEase;
            if (Math.abs(targetFade - layer.fade) < 0.0001) layer.fade = targetFade;
            layer.points.visible = layer.fade > 0.001;
            const drawCount = Math.min(layer.count, Math.ceil(layer.count * (this.population + POPULATION_FEATHER)));
            if (drawCount !== layer.drawCount) {
                layer.points.geometry.setDrawRange(0, drawCount);
                layer.drawCount = drawCount;
            }
            const uniforms = layer.uniforms;
            uniforms.uDays.value = time - this.dayBase;
            uniforms.uSpin.value = wrapAngle(layer.planet.rotation.y);
            uniforms.uFade.value = layer.fade;
            uniforms.uPopulation.value = this.population;
            uniforms.uViewHeight.value = viewHeight;
            uniforms.uViewWidth.value = this.renderer.domElement?.width || 1920;
            syncRingMaterial(layer);
        }
    }
}
