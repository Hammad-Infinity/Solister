import {
    BufferGeometry,
    Float32BufferAttribute,
    HalfFloatType,
    LinearFilter,
    LinearSRGBColorSpace,
    Mesh,
    MeshBasicNodeMaterial,
    NearestFilter,
    NoBlending,
    OrthographicCamera,
    RGBAFormat,
    RenderTarget,
    Scene,
    UnsignedByteType,
    Vector2
} from "three/webgpu";
import {
    Fn,
    float,
    positionGeometry,
    uniform,
    uniformTexture,
    vec2,
    vec4
} from "three/tsl";
import { createBloom } from "./bloom.tsl.js";
import { createDither } from "./dither.tsl.js";
import { createAntialias } from "./antialias.tsl.js";
import { DISPLAY_DEFAULT_EXPOSURE, displayToneMap } from "./tone-mapping.tsl.js";

// TSL counterpart of display-chain.js.
//
// The pass order and buffer formats are the production ones: HDR scene in a
// half-float target, bloom added to radiance inside the one tone pass when
// it is on, then the 8-bit post stages in dither-then-antialias order. The
// renderer is pinned to a linear output space while the chain is on for the
// same reason as in the classic file: the reference curve is the last
// transfer function, not the first of two.

export function createDisplayChain(renderer, options = {}) {
    const state = {
        enabled: options.enabled !== false,
        exposure: options.exposure ?? DISPLAY_DEFAULT_EXPOSURE
    };

    const canvasSpace = renderer.outputColorSpace;
    renderer.outputColorSpace = LinearSRGBColorSpace;

    const bloom = createBloom(renderer, options.bloom || {});
    const dither = createDither(renderer, options.dither || {});
    const antialias = createAntialias(renderer, options.antialias || {});

    let target = null;
    let post = [null, null];
    let width = 0;
    let height = 0;

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const sceneTex = uniformTexture();
    const exposure = uniform(state.exposure);
    const material = new MeshBasicNodeMaterial({
        name: "solister display TSL",
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        blending: NoBlending
    });
    material.vertexNode = vec4(positionGeometry.xy, float(0.0), float(1.0));
    material.fragmentNode = Fn(() => {
        const radiance = sceneTex.sample(vec2(positionGeometry.x.mul(0.5).add(0.5), float(0.5).sub(positionGeometry.y.mul(0.5)))).rgb;
        return vec4(displayToneMap(radiance, exposure), float(1.0));
    }, "vec4")();

    const geometry = new BufferGeometry();
    geometry.setAttribute("position",
        new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geometry.setAttribute("uv",
        new Float32BufferAttribute([0, -1, 0, 1, 2, 1], 2));
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    function allocate(w, h) {
        const previous = target;
        const samples = options.samples ?? 4;
        target = new RenderTarget(w, h, {
            type: HalfFloatType,
            format: RGBAFormat,
            minFilter: NearestFilter,
            magFilter: NearestFilter,
            depthBuffer: true,
            stencilBuffer: true,
            samples,
            colorSpace: LinearSRGBColorSpace
        });
        target.texture.name = "solister hdr scene";
        sceneTex.value = target.texture;
        for (let i = 0; i < post.length; i++) {
            if (post[i]) post[i].dispose();
            post[i] = new RenderTarget(w, h, {
                type: UnsignedByteType,
                format: RGBAFormat,
                minFilter: LinearFilter,
                magFilter: LinearFilter,
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
        const size = renderer.getDrawingBufferSize(new Vector2());
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

        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(world, view);

        exposure.value = state.exposure;
        sceneTex.value = target.texture;
        const combined = bloom.prepare(target.texture, state.exposure, width, height);
        mesh.material = combined || material;
        renderer.setRenderTarget(post[0]);
        renderer.render(scene, camera);
        mesh.material = material;
        let source = post[0].texture;

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
            if (Number.isFinite(value) && value > 0) state.exposure = value;
        },
        bloom, dither, antialias,
        get enabled() { return state.enabled; },
        set enabled(value) {
            state.enabled = !!value;
            renderer.outputColorSpace =
                state.enabled ? LinearSRGBColorSpace : canvasSpace;
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
