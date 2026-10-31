// The glows around things that are genuinely bright: the sun's disc, flares,
// the hottest stars. Copy of the reference's chain, arithmetic and all:
//
//   * a downsample, sixteen taps of the *previous* level, each tap
//        clamp(tap * clamp(1 + tap.a, 0, 1), 0, 10) / 16
//     (the alpha term is the reference's own protection against a fireball
//      bleeding into the buffer);
//   * a separable Gaussian at each level, with the reference's seven-tap
//     weights 0.282095, 0.265004, 0.219696, 0.160733, 0.103777, 0.05913030,
//     0.0297326 0.0131937 -- one pixel further out per tap;
//   * a combine pass that adds the levels back with the reference's floor:
//        out = base + max(bloom - 0.3, 0) * strength
//     and only then applies the tone curve, once.
//
// That floor is what makes this stage safe for the atmosphere: nothing the air
// draws in a planet frame reaches 0.3 (toneprobe measures the frame's maximum),
// so on those frames `max(bloom - 0.3, 0)` is exactly zero and the atmospheric
// picture is bit-identical with bloom on or off. The stage exists for the
// bodies that really are that bright, and it is verified inert on the ones
// this project is about.
//
// Each level is its own target and each pass its own material: to change how a
// glow looks, change one number here and nothing else moves.

// The reference's seven-tap kernel, normalised to sum exactly 1 per axis. As
// written it sums to 1.9848 -- it is a sparse sampling of a wider Gaussian, and
// the reference recovers the missing energy with an app-level gain we do not
// have. Normalising keeps the *shape* bit-for-bit and makes the stage
// energy-neutral, which is what lets the floor below mean "this pixel is not
// glowing" instead of "this pixel is glowing a little less".
const BLOOM_KERNEL = [0.2820950, 0.2650040, 0.2196960, 0.1607330,
                      0.1037770, 0.0591303, 0.0297326, 0.0131937];
const BLOOM_KERNEL_SUM = BLOOM_KERNEL[0] + 2 * BLOOM_KERNEL.slice(1).reduce((a, b) => a + b, 0);
const BLOOM_WEIGHTS = BLOOM_KERNEL.map(w => w / BLOOM_KERNEL_SUM);

function createBloom(THREE, renderer, options = {}) {
    const state = {
        enabled: options.enabled !== false,
        // The reference's floor. Below this, a value is not a glow.
        threshold: options.threshold ?? 0.3,
        strength: options.strength ?? 1.0,
        levels: Math.min(options.levels ?? 3, 4)
    };

    const quad = new THREE.BufferGeometry();
    quad.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(quad, null);
    mesh.frustumCulled = false;
    scene.add(mesh);

    const VERT = `
        varying vec2 vUv;
        void main() {
            vUv = position.xy * 0.5 + 0.5;
            gl_Position = vec4(position.xy, 0.0, 1.0);
        }
    `;

    const down = new THREE.ShaderMaterial({
        uniforms: {
            uTex: { value: null },
            uTexel: { value: new THREE.Vector2() },
            // The floor is applied once, to the scene, on the way in: a pixel
            // that is not glowing must contribute exactly nothing to the glow,
            // or a crowded neighbourhood below the floor would glow as if it
            // were one bright thing. Deeper levels pass 0 and re-floor at zero.
            uFloor: { value: 0 }
        },
        vertexShader: VERT,
        fragmentShader: `
            varying vec2 vUv;
            uniform sampler2D uTex;
            uniform vec2 uTexel;
            uniform float uFloor;
            void main() {
                // Sixteen taps: the four corners of the 2x2 block this texel
                // covers, each sampled at the four sub-texel offsets -- the
                // reference's own pattern, and the reason it needs no mipmaps.
                vec4 color = vec4(0.0);
                for (int y = -1; y <= 1; y += 2) {
                    for (int x = -1; x <= 1; x += 2) {
                        for (int j = -1; j <= 1; j += 2) {
                            for (int i = -1; i <= 1; i += 2) {
                                vec2 o = vec2(float(x) * uTexel.x + float(i) * uTexel.x * 0.25,
                                              float(y) * uTexel.y + float(j) * uTexel.y * 0.25);
                                vec4 t = texture2D(uTex, vUv + o);
                                t.rgb = max(t.rgb - vec3(uFloor), vec3(0.0));
                                color += clamp(t * clamp(1.0 + t.a, 0.0, 1.0), 0.0, 10.0);
                            }
                        }
                    }
                }
                gl_FragColor = color * 0.0625;
            }
        `,
        depthTest: false,
        depthWrite: false
    });

    const blur = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: null }, uStep: { value: new THREE.Vector2() } },
        vertexShader: VERT,
        fragmentShader: `
            varying vec2 vUv;
            uniform sampler2D uTex;
            uniform vec2 uStep;
            void main() {
                vec4 o = texture2D(uTex, vUv) * ${BLOOM_WEIGHTS[0].toFixed(7)};
                vec2 offs = uStep;
                ${BLOOM_WEIGHTS.slice(1).map((w, i) =>
                    `o += (texture2D(uTex, vUv + offs) + texture2D(uTex, vUv - offs)) * ${w.toFixed(7)};` +
                    (i < BLOOM_WEIGHTS.length - 2 ? `\n                offs += uStep;` : "")).join("\n                ")}
                gl_FragColor = o;
            }
        `,
        depthTest: false,
        depthWrite: false
    });

    // Combine and tone in one pass, exactly as the reference's hdr_add_bloom
    // does: the curve is applied to the sum, once, after the glow is in.
    const MAX_LEVELS = 4;
    const combine = new THREE.ShaderMaterial({
        uniforms: {
            uBase: { value: null },
            uBloom0: { value: null },
            uBloom1: { value: null },
            uBloom2: { value: null },
            uBloom3: { value: null },
            uLevels: { value: 0 },
            uThreshold: { value: state.threshold },
            uStrength: { value: state.strength },
            uExposure: { value: 1.0 }
        },
        vertexShader: VERT,
        fragmentShader: DISPLAY_TONE_GLSL + `
            varying vec2 vUv;
            uniform sampler2D uBase;
            uniform sampler2D uBloom0;
            uniform sampler2D uBloom1;
            uniform sampler2D uBloom2;
            uniform sampler2D uBloom3;
            uniform int uLevels;
            uniform float uThreshold;
            uniform float uStrength;
            uniform float uExposure;
            void main() {
                vec3 base = texture2D(uBase, vUv).rgb;
                // The levels are added, not chosen between: each is a wider and
                // softer halo than the last, and the sum is what makes a bright
                // body glow outward rather than sit under a disc of light.
                vec3 glow = vec3(0.0);
                if (uLevels > 0) glow += texture2D(uBloom0, vUv).rgb;
                if (uLevels > 1) glow += texture2D(uBloom1, vUv).rgb;
                if (uLevels > 2) glow += texture2D(uBloom2, vUv).rgb;
                if (uLevels > 3) glow += texture2D(uBloom3, vUv).rgb;
                // No second floor here: the glow was floored at its source, so
                // whatever arrives is glow by construction. Flooring the sum as
                // well would let a below-floor neighbourhood glow as one.
                vec3 radiance = base + glow * uStrength;
                gl_FragColor = vec4(displayToneMap(radiance, uExposure), 1.0);
            }
        `,
        depthTest: false,
        depthWrite: false
    });

    let levels = [];   // [{ down, blurA, blurB }]
    let width = 0;
    let height = 0;

    function allocate(w, h) {
        for (const level of levels) {
            level.down.dispose();
            level.blurA.dispose();
            level.blurB.dispose();
        }
        levels = [];
        let lw = w, lh = h;
        for (let i = 0; i < state.levels; i++) {
            lw = Math.max(1, lw >> 1);
            lh = Math.max(1, lh >> 1);
            const make = () => new THREE.WebGLRenderTarget(lw, lh, {
                type: THREE.HalfFloatType,
                format: THREE.RGBAFormat,
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                depthBuffer: false,
                stencilBuffer: false
            });
            levels.push({ down: make(), blurA: make(), blurB: make(), w: lw, h: lh });
        }
        width = w;
        height = h;
    }

    function pass(material, target) {
        mesh.material = material;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
    }

    // `sourceTexture` is the full-resolution HDR scene; returns the material
    // that combines it with the glow, ready for the caller to render and tone.
    function prepare(sourceTexture, exposure, w, h) {
        if (!state.enabled) return null;
        if (w !== width || h !== height) allocate(w, h);
        let previous = sourceTexture;
        let previousW = w, previousH = h;
        for (const level of levels) {
            down.uniforms.uTex.value = previous;
            down.uniforms.uTexel.value.set(0.5 / previousW, 0.5 / previousH);
            down.uniforms.uFloor.value = previous === sourceTexture ? state.threshold : 0;
            pass(down, level.down);

            // Horizontal at this level's own size, then vertical: the reference
            // blurs each level in place before handing it to the next.
            blur.uniforms.uTex.value = level.down.texture;
            blur.uniforms.uStep.value.set(1 / level.w, 0);
            pass(blur, level.blurA);
            blur.uniforms.uTex.value = level.blurA.texture;
            blur.uniforms.uStep.value.set(0, 1 / level.h);
            pass(blur, level.blurB);

            previous = level.blurB.texture;
            previousW = level.w;
            previousH = level.h;
        }
        combine.uniforms.uBase.value = sourceTexture;
        // Each level is read at the output size; the sampler's bilinear filter
        // is what turns a coarser level into a wider, softer halo.
        for (let i = 0; i < MAX_LEVELS; i++) {
            const slot = combine.uniforms["uBloom" + i];
            slot.value = i < levels.length ? levels[i].blurB.texture : null;
        }
        combine.uniforms.uLevels.value = Math.min(levels.length, MAX_LEVELS);
        combine.uniforms.uThreshold.value = state.threshold;
        combine.uniforms.uStrength.value = state.strength;
        combine.uniforms.uExposure.value = exposure;
        return combine;
    }

    return {
        prepare,
        scene,
        camera,
        combine,
        get enabled() { return state.enabled; },
        set enabled(v) { state.enabled = !!v; },
        get threshold() { return state.threshold; },
        set threshold(v) { if (Number.isFinite(v)) state.threshold = v; },
        get strength() { return state.strength; },
        set strength(v) { if (Number.isFinite(v)) state.strength = v; },
        dispose() {
            for (const level of levels) {
                level.down.dispose();
                level.blurA.dispose();
                level.blurB.dispose();
            }
            levels = [];
            quad.dispose();
            down.dispose();
            blur.dispose();
            combine.dispose();
        }
    };
}

globalThis.createBloom = createBloom;
