// The frame's last two steps, and nothing else:
//
//     scene -> (linear, half float) -> tone curve -> 8-bit canvas
//
// Deliberately small. Each step is its own object here so that one of them can
// be replaced or switched off without touching the others:
//
//   * `target`   holds the scene exactly as the shaders computed it. While the
//                chain is on, this is the only place a full linear frame
//                exists -- probes read it to check what the scene really is.
//   * `material` is the display transform (tone-mapping.js owns the arithmetic).
//   * `exposure` multiplies the scene before the curve; the one scalar.
//
// With `enabled = false` the chain renders straight to the canvas the way the
// app did before this file existed: no tone curve, and the canvas gets the
// renderer's own linear-to-sRGB encoding. Probes that measure radiance against
// a table switch it off for that reason -- they must see radiance, not a
// display value -- and the tone probe switches it on to check this file.

function createDisplayChain(THREE, renderer, options = {}) {
    const state = {
        enabled: options.enabled !== false,
        exposure: options.exposure ?? DISPLAY_DEFAULT_EXPOSURE
    };

    // The reference writes its tone curve into a linear, unencoded 8-bit
    // buffer. Three would otherwise sRGB-encode whatever a pass writes to the
    // canvas, which would put a second transfer function after the curve. The
    // render targets are unaffected: three only applies this when the
    // destination is the canvas.
    //
    // The renderer's own setting is restored verbatim while the chain is off,
    // so "off" is exactly the path this app had before the chain existed --
    // radiance straight to the canvas through three's sRGB encode. Probes rely
    // on that: with the chain off they see the pre-S8 picture, not a third
    // thing that is neither.
    const canvasSpace = renderer.outputColorSpace;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    // Bloom is part of the display, not of the scene: it is built from the
    // scene's radiance and finished by the same tone curve. Its own module owns
    // the arithmetic; the chain only decides when it runs.
    const bloom = createBloom(THREE, renderer, options.bloom || {});
    // Dither and antialias are separate stages with separate files, because
    // they do opposite things to a gradient: one adds a sub-quantum of noise so
    // a staircase reads as a slope, the other averages neighbours so an edge
    // reads as a slope. Either can be switched off without touching the other.
    const dither = createDither(THREE, renderer, options.dither || {});
    const antialias = createAntialias(THREE, renderer, options.antialias || {});

    let target = null;
    // Ping-pong between the tone pass and whatever comes after it. Allocated
    // lazily: when neither post stage runs, no second buffer exists at all.
    let post = [null, null];
    let postIndex = 0;
    let width = 0;
    let height = 0;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new THREE.ShaderMaterial({
        name: "solister display",
        uniforms: {
            uScene: { value: null },
            uExposure: { value: state.exposure }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                // The vertex positions are already clip space; the texture
                // coordinate is just where that lands in [0, 1].
                vUv = position.xy * 0.5 + 0.5;
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `,
        fragmentShader: DISPLAY_TONE_GLSL + `
            varying vec2 vUv;
            uniform sampler2D uScene;
            uniform float uExposure;
            void main() {
                vec3 radiance = texture2D(uScene, vUv).rgb;
                vec3 display = displayToneMap(radiance, uExposure);
                gl_FragColor = vec4(display, 1.0);
            }
        `,
        depthTest: false,
        depthWrite: false
    });
    // One triangle covers the viewport with no diagonal seam and one less
    // vertex than a quad; the tone pass is per-pixel work, so it is worth the
    // three lines.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    function allocate(w, h) {
        const previous = target;
        // Same sample count the canvas itself was asked for: the scene is now
        // drawn into an off-screen buffer, and losing MSAA there would put
        // stair-steps on every limb this whole project is about.
        const maxSamples = renderer.capabilities?.maxSamples ?? 0;
        const samples = options.samples ?? Math.min(4, maxSamples);
        target = new THREE.WebGLRenderTarget(w, h, {
            type: THREE.HalfFloatType,
            format: THREE.RGBAFormat,
            // The tone pass reads one texel per pixel, so the sampler must not
            // blend neighbours: filtering here would soften every limb by a
            // texel and pull edge pixels toward their neighbours.
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            depthBuffer: true,
            stencilBuffer: true,
            samples,
            colorSpace: THREE.LinearSRGBColorSpace
        });
        // Half float keeps everything the shaders can produce (sun disc, flares,
        // additive layers) without clamping; it is also what the reference's
        // own HDR buffers hold.
        target.texture.name = "solister hdr scene";
        material.uniforms.uScene.value = target.texture;
        for (let i = 0; i < post.length; i++) {
            if (post[i]) post[i].dispose();
            // 8-bit is correct here and not a compromise: everything after the
            // tone curve is display-referred by definition, and the reference
            // carries the post chain in the same 8-bit buffers.
            post[i] = new THREE.WebGLRenderTarget(w, h, {
                type: THREE.UnsignedByteType,
                format: THREE.RGBAFormat,
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                depthBuffer: false,
                stencilBuffer: false
            });
            post[i].texture.name = "solister post " + i;
        }
        if (previous) previous.dispose();
        width = w;
        height = h;
    }

    function resize() {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const w = Math.max(1, size.x | 0);
        const h = Math.max(1, size.y | 0);
        if (!target || w !== width || h !== height) allocate(w, h);
    }

    function render(world, view) {
        resize();
        if (!state.enabled) {
            renderer.setRenderTarget(null);
            renderer.render(world, view);
            return;
        }

        // 1. The scene, as radiance, into its own buffer.
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(world, view);

        // 2. Tone. With bloom on, the same pass adds the glow to radiance
        // first, so the curve is still applied exactly once.
        material.uniforms.uExposure.value = state.exposure;
        material.uniforms.uScene.value = target.texture;
        const combined = bloom.prepare(target.texture, state.exposure, width, height);
        mesh.material = combined || material;
        renderer.setRenderTarget(post[0]);
        renderer.render(scene, camera);
        mesh.material = material;
        let source = post[0].texture;

        // 3. The post stages, each reading the previous one's output. The last
        // one running writes straight to the canvas; every earlier one writes
        // to the buffer that is not currently being read.
        const stages = [];
        if (dither.enabled) stages.push(dither);
        if (antialias.enabled) stages.push(antialias);
        let free = 1;
        for (let i = 0; i < stages.length; i++) {
            const stage = stages[i];
            const last = i === stages.length - 1;
            const destination = last ? null : post[free];
            if (stage === dither) dither.begin(source, performance.now() / 1000);
            else stage.begin(source, width, height);
            renderer.setRenderTarget(destination);
            renderer.render(stage.scene, stage.camera);
            if (!last) {
                source = post[free].texture;
                free ^= 1;
            }
        }
        if (!stages.length) {
            renderer.setRenderTarget(null);
            renderer.render(scene, camera);
        }
    }

    return {
        render,
        scene,
        camera,
        material,
        get target() { return target; },
        get exposure() { return state.exposure; },
        set exposure(value) {
            // A finite, positive scalar; anything else is a bug upstream, and
            // the curve would go backwards rather than look merely wrong.
            if (Number.isFinite(value) && value > 0) state.exposure = value;
        },
        bloom, dither, antialias,
        get enabled() { return state.enabled; },
        set enabled(value) {
            state.enabled = !!value;
            renderer.outputColorSpace = state.enabled ? THREE.LinearSRGBColorSpace : canvasSpace;
        },
        dispose() {
            bloom.dispose();
            dither.dispose();
            antialias.dispose();
            for (const p of post) if (p) p.dispose();
            if (target) target.dispose();
            geometry.dispose();
            material.dispose();
            target = null;
        }
    };
}

globalThis.createDisplayChain = createDisplayChain;
