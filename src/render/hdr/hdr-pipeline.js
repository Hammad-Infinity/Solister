export const HDR_TONE_MAPPER = Object.freeze({
    reinhard: "reinhard",
    uncharted2: "uncharted2",
    aces: "aces"
});

const HDR_TONE_MAPPER_LABEL = Object.freeze({
    reinhard: "Reinhard",
    uncharted2: "Uncharted 2",
    aces: "ACES Filmic"
});

export function hdrToneMapperLabel(value) {
    return HDR_TONE_MAPPER_LABEL[value] || HDR_TONE_MAPPER_LABEL.reinhard;
}

export function hdrToneMapperOptions() {
    return [ HDR_TONE_MAPPER.reinhard, HDR_TONE_MAPPER.uncharted2, HDR_TONE_MAPPER.aces ];
}

const TONEMAP_GLSL = `
vec3 hdrToneMap(vec3 color, int mode) {
    if (mode == 1) {
        const float A = 0.22;
        const float B = 0.30;
        const float C = 0.10;
        const float D = 0.20;
        const float E = 0.02;
        const float F = 0.30;
        const float scale = 1.0 / ((16.0 * (A * 16.0 + C * B) + D * E) / (16.0 * (A * 16.0 + B) + D * F) - E / F);
        vec3 c = ((color * (A * color + C * B) + D * E) / (color * (A * color + B) + D * F)) - E / F;
        return c * scale;
    }
    if (mode == 2) {
        const mat3 ACESInput = mat3(
            0.59719, 0.07600, 0.02840,
            0.35458, 0.90834, 0.13383,
            0.04823, 0.01566, 0.83777
        );
        const mat3 ACESOutput = mat3(
             1.60475, -0.10208, -0.00327,
            -0.53108,  1.10813, -0.07276,
            -0.07367, -0.00605,  1.07602
        );
        vec3 v = ACESInput * color;
        vec3 a = v * (v + 0.0245786) - 0.000090537;
        vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
        return clamp(ACESOutput * (a / b), 0.0, 1.0);
    }
    return color / (color + vec3(1.0));
}

float hdrGrain(vec2 coord) {
    return fract(sin(dot(coord, vec2(12.9898, 78.233))) * 43758.5453);
}
`;

const HDR_VERTEX_GLSL = `
varying vec2 vHdrUv;
void main() {
    vHdrUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HDR_TONEMAP_FRAGMENT_GLSL = `
uniform sampler2D uHdrColor;
uniform float uHdrExposure;
uniform int uHdrToneMapper;
uniform float uHdrGrainStrength;
uniform vec2 uHdrRandom;
varying vec2 vHdrUv;
${TONEMAP_GLSL}
void main() {
    vec3 hdr = max(texture2D(uHdrColor, vHdrUv).rgb, vec3(0.0)) * uHdrExposure;
    // Tone-map in linear space ourselves (the renderer's builtin toneMapping
    // is pinned to NoToneMapping while this pipeline owns the frame).
    gl_FragColor = vec4(hdrToneMap(hdr, uHdrToneMapper), 1.0);
    // This pass draws straight to the default framebuffer, so three.js
    // resolves linearToOutputTexel from renderer.outputColorSpace and this
    // single include performs the one and only linear -> display encode.
    // The earlier passes target render targets, which resolve to
    // LinearSRGBColorSpace, so they stay in linear space untouched.
    #include <colorspace_fragment>
    // Filmic grain belongs after the display transform; adding it in linear
    // space lets the tone curve swallow it and the banding comes back.
    gl_FragColor.rgb += (hdrGrain(gl_FragCoord.xy + uHdrRandom) - 0.5) * uHdrGrainStrength;
}
`;

const HDR_DOWNSCALE_FRAGMENT_GLSL = `
uniform sampler2D uHdrSource;
uniform vec2 uHdrTexel;
varying vec2 vHdrUv;
void main() {
    vec3 sum = vec3(0.0);
    sum += texture2D(uHdrSource, vHdrUv + uHdrTexel * vec2(-1.0, -1.0)).rgb;
    sum += texture2D(uHdrSource, vHdrUv + uHdrTexel * vec2( 1.0, -1.0)).rgb;
    sum += texture2D(uHdrSource, vHdrUv + uHdrTexel * vec2(-1.0,  1.0)).rgb;
    sum += texture2D(uHdrSource, vHdrUv + uHdrTexel * vec2( 1.0,  1.0)).rgb;
    gl_FragColor = vec4(sum * 0.25, 1.0);
}
`;

const HDR_HISTOGRAM_VERTEX_GLSL = `
uniform sampler2D uHdrSource;
uniform vec2 uHdrSourceTexel;
uniform float uHdrLogScale;
uniform float uHdrBucketOffset;
void main() {
    vec2 sourceUv = position.xy * uHdrSourceTexel + 0.5;
    if (sourceUv.x < 0.0 || sourceUv.x > 1.0 || sourceUv.y < 0.0 || sourceUv.y > 1.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 1.0;
        return;
    }
    vec3 color = texture2D(uHdrSource, sourceUv).rgb;
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float bucket = clamp(log2(max(luminance, 1e-7)) * uHdrLogScale, -128.0, 127.0) + uHdrBucketOffset;
    gl_Position = vec4(0.0, 0.0, 1.0, 1.0);
    gl_PointSize = 1.0;
    gl_Position = vec4(
        (mod(bucket, 16.0) + 0.5) / 8.0 - 1.0,
        (floor(bucket / 16.0) + 0.5) / 8.0 - 1.0,
        1.0,
        1.0
    );
}
`;

const HDR_HISTOGRAM_FRAGMENT_GLSL = `
void main() {
    gl_FragColor = vec4(1.0);
}
`;

const HDR_PACK_VERTEX_GLSL = `
varying vec2 vHdrUv;
void main() {
    vHdrUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HDR_PACK_FRAGMENT_GLSL = `
uniform sampler2D uHdrSource;
varying vec2 vHdrUv;
void main() {
    float value = floor(texture2D(uHdrSource, vHdrUv).r * 16777215.0 + 0.5);
    vec3 packed;
    packed.r = mod(value, 256.0);
    value = floor(value / 256.0);
    packed.g = mod(value, 256.0);
    value = floor(value / 256.0);
    packed.b = mod(value, 256.0);
    gl_FragColor = vec4(packed / 255.0, 1.0);
}
`;

const HDR_HISTOGRAM_TEXEL = 16;

const HDR_HISTOGRAM_BUCKETS = HDR_HISTOGRAM_TEXEL * HDR_HISTOGRAM_TEXEL;

const HDR_HISTOGRAM_SAMPLE_WINDOW = 64;

const HDR_LUMINANCE_FLOOR = 1e-5;

const HDR_LUMINANCE_CEILING = 1e4;

const HDR_EV_MIN = -10;

const HDR_EV_MAX = 12;

function readStoredFloat(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        const parsed = Number.parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
    } catch (error) {
        return fallback;
    }
}

function writeStored(key, value) {
    try {
        localStorage.setItem(key, String(value));
    } catch (error) {}
}

function readStoredString(key, fallback) {
    try {
        return localStorage.getItem(key) || fallback;
    } catch (error) {
        return fallback;
    }
}

function luminanceToEv(luminance) {
    return Math.log2(Math.max(luminance, HDR_LUMINANCE_FLOOR));
}

function evToExposure(ev) {
    return Math.pow(2, ev);
}

function bucketIndexToEv(index) {
    return (index - 128) / 8;
}

export class HdrPipeline {
    constructor({THREE: THREE, renderer: renderer, options: options = {}} = {}) {
        this.THREE = THREE;
        this.renderer = renderer;
        this.enabled = options.enabled !== false;
        this.toneMapper = HDR_TONE_MAPPER_LABEL[options.toneMapper] ? options.toneMapper : HDR_TONE_MAPPER.reinhard;
        this.exposure = Number.isFinite(options.exposure) ? options.exposure : 1.0;
        this.autoExposure = options.autoExposure !== false;
        this.keyValue = Number.isFinite(options.keyValue) ? options.keyValue : 0.18;
        this.adaptSpeed = Number.isFinite(options.adaptSpeed) ? options.adaptSpeed : 1.6;
        this.bloom = Number.isFinite(options.bloom) ? options.bloom : 0;
        this.grain = Number.isFinite(options.grain) ? options.grain : 1 / 256;
        this.histogramEveryNFrames = 6;
        this.frameCount = 0;
        this.currentEv = 0;
        this.targetEv = 0;
        this.measuredKey = 0;
        this.width = 1;
        this.height = 1;
        this.scene = new THREE.Scene;
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.quad = new THREE.PlaneGeometry(2, 2);
        this.disposables = [];
        this.randomSeed = new THREE.Vector2(Math.random() * 5, Math.random() * 5);
        this._packPixels = new Uint8Array(HDR_HISTOGRAM_BUCKETS * 4);
        this._packView = new DataView(this._packPixels.buffer);
        this._histogramPoints = this._buildHistogramPoints();
        this._buildTargets();
        this._buildMaterials();
        this._restoreSettings();
        this._applyBuiltinToneMapping();
    }

    _restoreSettings() {
        const storedMapper = readStoredString("solarHdrToneMapper", this.toneMapper);
        if (HDR_TONE_MAPPER_LABEL[storedMapper]) this.toneMapper = storedMapper;
        this.exposure = readStoredFloat("solarHdrExposure", this.exposure);
        this.autoExposure = readStoredString("solarHdrAutoExposure", this.autoExposure ? "1" : "0") === "1";
        this.keyValue = readStoredFloat("solarHdrKey", this.keyValue);
        this.adaptSpeed = readStoredFloat("solarHdrAdapt", this.adaptSpeed);
        this.enabled = readStoredString("solarHdrEnabled", this.enabled ? "1" : "0") === "1";
    }

    _buildTargets() {
        const THREE = this.THREE;
        const floatType = this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
        const hdrOptions = {
            format: THREE.RGBAFormat,
            type: floatType,
            stencilBuffer: false,
            depthBuffer: true,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            magFilter: THREE.LinearFilter,
            minFilter: THREE.LinearFilter
        };
        this.colorTarget = new THREE.WebGLRenderTarget(1, 1, hdrOptions);
        this.disposables.push(this.colorTarget);
        const smallOptions = Object.assign({}, hdrOptions, {
            depthBuffer: false,
            magFilter: THREE.LinearFilter,
            minFilter: THREE.LinearFilter
        });
        this.quarterTarget = new THREE.WebGLRenderTarget(1, 1, smallOptions);
        this.disposables.push(this.quarterTarget);
        const histogramOptions = {
            format: THREE.RGBAFormat,
            type: floatType,
            stencilBuffer: false,
            depthBuffer: false,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            magFilter: THREE.NearestFilter,
            minFilter: THREE.NearestFilter
        };
        this.histogramTarget = new THREE.WebGLRenderTarget(HDR_HISTOGRAM_TEXEL, HDR_HISTOGRAM_TEXEL, histogramOptions);
        this.disposables.push(this.histogramTarget);
        const uintOptions = Object.assign({}, histogramOptions, { type: THREE.UnsignedByteType });
        this.uintTarget = new THREE.WebGLRenderTarget(HDR_HISTOGRAM_TEXEL, HDR_HISTOGRAM_TEXEL, uintOptions);
        this.disposables.push(this.uintTarget);
    }

    _buildMaterials() {
        const THREE = this.THREE;
        this.toneMapMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uHdrColor: { value: null },
                uHdrExposure: { value: 1.0 },
                uHdrToneMapper: { value: 0 },
                uHdrGrainStrength: { value: this.grain },
                uHdrRandom: { value: this.randomSeed }
            },
            vertexShader: HDR_VERTEX_GLSL,
            fragmentShader: HDR_TONEMAP_FRAGMENT_GLSL,
            depthTest: false,
            depthWrite: false
        });
        this.disposables.push(this.toneMapMaterial);
        this.downscaleMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uHdrSource: { value: null },
                uHdrTexel: { value: new THREE.Vector2(1, 1) }
            },
            vertexShader: HDR_VERTEX_GLSL,
            fragmentShader: HDR_DOWNSCALE_FRAGMENT_GLSL,
            depthTest: false,
            depthWrite: false
        });
        this.disposables.push(this.downscaleMaterial);
        this.histogramMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uHdrSource: { value: null },
                uHdrSourceTexel: { value: new THREE.Vector2(1, 1) },
                uHdrLogScale: { value: 8 },
                uHdrBucketOffset: { value: 128 }
            },
            vertexShader: HDR_HISTOGRAM_VERTEX_GLSL,
            fragmentShader: HDR_HISTOGRAM_FRAGMENT_GLSL,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            transparent: false
        });
        this.disposables.push(this.histogramMaterial);
        this.packMaterial = new THREE.ShaderMaterial({
            uniforms: { uHdrSource: { value: null } },
            vertexShader: HDR_PACK_VERTEX_GLSL,
            fragmentShader: HDR_PACK_FRAGMENT_GLSL,
            depthTest: false,
            depthWrite: false
        });
        this.disposables.push(this.packMaterial);
        this.fullscreenMesh = new THREE.Mesh(this.quad, this.toneMapMaterial);
        this.fullscreenMesh.frustumCulled = false;
        this.scene.add(this.fullscreenMesh);
        this.histogramPoints = new THREE.Points(this._histogramPoints, this.histogramMaterial);
        this.histogramPoints.frustumCulled = false;
    }

    _buildHistogramPoints() {
        const THREE = this.THREE;
        const count = HDR_HISTOGRAM_SAMPLE_WINDOW * HDR_HISTOGRAM_SAMPLE_WINDOW;
        const positions = new Float32Array(count * 3);
        const half = HDR_HISTOGRAM_SAMPLE_WINDOW / 2;
        let index = 0;
        for (let row = 0; row < HDR_HISTOGRAM_SAMPLE_WINDOW; row++) {
            for (let col = 0; col < HDR_HISTOGRAM_SAMPLE_WINDOW; col++) {
                positions[index++] = col - half;
                positions[index++] = row - half;
                positions[index++] = 0;
            }
        }
        const geometry = new THREE.BufferGeometry;
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        this.disposables.push(geometry);
        return geometry;
    }

    _applyBuiltinToneMapping() {
        // This pass tone-maps in the shader, so the renderer must not do it
        // again. Record what the app was using first so we can hand the
        // frame back untouched whenever the pipeline is bypassed.
        if (this._savedToneMapping === undefined) {
            this._savedToneMapping = this.renderer.toneMapping;
            this._savedToneMappingExposure = this.renderer.toneMappingExposure;
        }
        this.renderer.toneMapping = this.THREE.NoToneMapping;
        this.renderer.toneMappingExposure = 1;
    }

    _restoreBuiltinToneMapping() {
        // Called when the pipeline is off or torn down: the scene renders
        // straight to the screen again and needs the app's own tone mapping
        // back, otherwise everything loses its filmic curve and looks flat.
        if (this._savedToneMapping === undefined) return;
        this.renderer.toneMapping = this._savedToneMapping;
        this.renderer.toneMappingExposure = this._savedToneMappingExposure;
        this._savedToneMapping = undefined;
        this._savedToneMappingExposure = undefined;
    }

    resize(width, height) {
        this.width = Math.max(1, Math.floor(width));
        this.height = Math.max(1, Math.floor(height));
        this.colorTarget.setSize(this.width, this.height);
        this.quarterTarget.setSize(Math.max(1, this.width >> 2), Math.max(1, this.height >> 2));
    }

    setEnabled(enabled) {
        const next = !!enabled;
        if (next === this.enabled) return;
        this.enabled = next;
        writeStored("solarHdrEnabled", next ? "1" : "0");
        if (!next) this.renderer.setRenderTarget(null);
    }

    setToneMapper(value) {
        if (!HDR_TONE_MAPPER_LABEL[value] || value === this.toneMapper) return;
        this.toneMapper = value;
        writeStored("solarHdrToneMapper", value);
    }

    setExposure(value) {
        const parsed = Number(value);
        const next = Number.isFinite(parsed) ? Math.max(0.01, Math.min(16, parsed)) : this.exposure;
        this.exposure = next;
        writeStored("solarHdrExposure", next);
    }

    setAutoExposure(enabled) {
        const next = !!enabled;
        if (next === this.autoExposure) return;
        this.autoExposure = next;
        writeStored("solarHdrAutoExposure", next ? "1" : "0");
        if (next) {
            this.currentEv = this.targetEv;
        }
    }

    setKeyValue(value) {
        const parsed = Number(value);
        const next = Number.isFinite(parsed) ? Math.max(0.01, Math.min(1, parsed)) : this.keyValue;
        this.keyValue = next;
        writeStored("solarHdrKey", next);
    }

    setAdaptSpeed(value) {
        const parsed = Number(value);
        const next = Number.isFinite(parsed) ? Math.max(0.05, Math.min(10, parsed)) : this.adaptSpeed;
        this.adaptSpeed = next;
        writeStored("solarHdrAdapt", next);
    }

    setGrain(value) {
        const parsed = Number(value);
        const next = Number.isFinite(parsed) ? Math.max(0, Math.min(0.02, parsed)) : this.grain;
        this.grain = next;
        this.toneMapMaterial.uniforms.uHdrGrainStrength.value = next;
    }

    exposureMultiplier() {
        if (!this.enabled) return this.exposure;
        return this.autoExposure ? evToExposure(this.currentEv) * this.exposure : this.exposure;
    }

    _toneMapperIndex() {
        if (this.toneMapper === HDR_TONE_MAPPER.uncharted2) return 1;
        if (this.toneMapper === HDR_TONE_MAPPER.aces) return 2;
        return 0;
    }

    _renderFullscreen(material) {
        this.fullscreenMesh.material = material;
        this.renderer.render(this.scene, this.camera);
    }

    _readHistogram() {
        this.renderer.readRenderTargetPixels(this.uintTarget, 0, 0, HDR_HISTOGRAM_TEXEL, HDR_HISTOGRAM_TEXEL, this._packPixels);
        const counts = new Float64Array(HDR_HISTOGRAM_BUCKETS);
        let total = 0;
        for (let i = 0; i < HDR_HISTOGRAM_BUCKETS; i++) {
            const packed = this._packView.getUint32(i << 2, true) & 0xFFFFFF;
            counts[i] = packed;
            total += packed;
        }
        if (total <= 0) return null;
        const invTotal = 1 / total;
        let weightedSum = 0;
        for (let i = 0; i < HDR_HISTOGRAM_BUCKETS; i++) {
            if (counts[i] <= 0) continue;
            weightedSum += counts[i] * invTotal * luminanceToEv(evToExposure(bucketIndexToEv(i)));
        }
        const logAverage = weightedSum;
        return {
            logAverageLuminance: logAverage,
            key: this.keyValue / Math.max(Math.exp(logAverage), HDR_LUMINANCE_FLOOR)
        };
    }

    _measureExposure() {
        const renderer = this.renderer;
        const previousTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(this.quarterTarget);
        renderer.clear(true, false, false);
        this.downscaleMaterial.uniforms.uHdrSource.value = this.colorTarget.texture;
        this.downscaleMaterial.uniforms.uHdrTexel.value.set(1 / Math.max(1, this.colorTarget.width), 1 / Math.max(1, this.colorTarget.height));
        this._renderFullscreen(this.downscaleMaterial);
        renderer.setRenderTarget(this.histogramTarget);
        renderer.clear(true, true, false);
        this.histogramMaterial.uniforms.uHdrSource.value = this.quarterTarget.texture;
        this.histogramMaterial.uniforms.uHdrSourceTexel.value.set(1 / Math.max(1, this.quarterTarget.width), 1 / Math.max(1, this.quarterTarget.height));
        this.scene.remove(this.fullscreenMesh);
        this.scene.add(this.histogramPoints);
        renderer.render(this.scene, this.camera);
        this.scene.remove(this.histogramPoints);
        this.scene.add(this.fullscreenMesh);
        renderer.setRenderTarget(this.uintTarget);
        renderer.clear(true, false, false);
        this.packMaterial.uniforms.uHdrSource.value = this.histogramTarget.texture;
        this._renderFullscreen(this.packMaterial);
        const measured = this._readHistogram();
        renderer.setRenderTarget(previousTarget);
        if (measured) {
            this.targetEv = Math.max(HDR_EV_MIN, Math.min(HDR_EV_MAX, Math.log2(Math.max(measured.key, HDR_LUMINANCE_FLOOR))));
            this.measuredKey = measured.key;
        }
    }

    render(scene, camera, deltaSeconds) {
        if (!this.enabled) {
            // Hand the frame back to the renderer with the app's tone
            // mapping restored, so disabling HDR looks exactly like the
            // pre-HDR build instead of an un-tonemapped linear dump.
            this._restoreBuiltinToneMapping();
            this.renderer.setRenderTarget(null);
            this.renderer.render(scene, camera);
            return;
        }
        const renderer = this.renderer;
        // The enabled path may be reached after a disable/disable cycle, and
        // the disable path hands the builtin tone mapping back. Re-claim it
        // every frame so the shader tonemap is never stacked on the builtin.
        this._applyBuiltinToneMapping();
        renderer.setRenderTarget(this.colorTarget);
        renderer.clear(true, true, false);
        renderer.render(scene, camera);
        if (this.autoExposure) {
            this.frameCount++;
            if (this.frameCount % this.histogramEveryNFrames === 0) this._measureExposure();
            const dt = Math.max(0, Math.min(0.5, Number(deltaSeconds) || 0));
            const blend = 1 - Math.exp(-this.adaptSpeed * dt);
            this.currentEv += (this.targetEv - this.currentEv) * blend;
        } else {
            this.currentEv = 0;
        }
        renderer.setRenderTarget(null);
        this.randomSeed.set(Math.random() * 5, Math.random() * 5);
        this.toneMapMaterial.uniforms.uHdrColor.value = this.colorTarget.texture;
        this.toneMapMaterial.uniforms.uHdrExposure.value = this.exposureMultiplier();
        this.toneMapMaterial.uniforms.uHdrToneMapper.value = this._toneMapperIndex();
        this._renderFullscreen(this.toneMapMaterial);
    }

    dispose() {
        for (const item of this.disposables) {
            try {
                item.dispose();
            } catch (error) {}
        }
        this.disposables.length = 0;
        this.renderer.setRenderTarget(null);
        this._restoreBuiltinToneMapping();
    }
}
