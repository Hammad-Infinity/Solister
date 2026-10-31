import {
    BufferGeometry,
    DataTexture,
    Float32BufferAttribute,
    HalfFloatType,
    LinearFilter,
    Mesh,
    MeshBasicNodeMaterial,
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
    clamp,
    float,
    max,
    positionGeometry,
    select,
    uniform,
    uniformTexture,
    vec2,
    vec3,
    vec4
} from "three/tsl";
import { displayToneMap } from "./tone-mapping.tsl.js";

// TSL counterpart of bloom.js.
//
// This is the same chain in node form: floor at the source, sixteen-tap
// downsample with the reference alpha guard, seven-tap separable blur at
// each level, then one combine pass that adds the glow to radiance before
// the single tone curve. Keeping the passes as separate materials matters
// as much here as in the classic file: a change to the glow is one number
// in one pass, never a second display transform.

const BLOOM_KERNEL = [0.2820950, 0.2650040, 0.2196960, 0.1607330,
                      0.1037770, 0.0591303, 0.0297326, 0.0131937];
const BLOOM_KERNEL_SUM = BLOOM_KERNEL[0] +
    2 * BLOOM_KERNEL.slice(1).reduce((a, b) => a + b, 0);
const BLOOM_WEIGHTS = BLOOM_KERNEL.map(w => w / BLOOM_KERNEL_SUM);
// The classic blur writes its weights into shader text with seven decimal
// places. Use those same rounded constants so the proof is comparing the
// shipped arithmetic, not a slightly more precise neighbour of it.
const BLOOM_SHADER_WEIGHTS = BLOOM_WEIGHTS.map(w => Number(w.toFixed(7)));
const MAX_LEVELS = 4;

function fullscreenTriangle() {
    const geometry = new BufferGeometry();
    // Three's node fullscreen-quad orientation: render-target textures are
    // sampled with v running down the presented image on both node
    // backends. The pass materials below derive that same coordinate from
    // position (as the classic shaders derive theirs), so the returned
    // combine material does not depend on a caller mesh's UV attribute;
    // using the classic bottom-up coordinate would present every
    // render-target-fed stage upside down.
    geometry.setAttribute("position",
        new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geometry.setAttribute("uv",
        new Float32BufferAttribute([0, -1, 0, 1, 2, 1], 2));
    return geometry;
}

function passMaterial(name, fragment) {
    const material = new MeshBasicNodeMaterial({
        name,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        // Pass outputs are data being handed to the next pass, including
        // HDR values and the downsample alpha guard. A plain store keeps
        // all four channels exactly as the fragment graph produced them.
        blending: NoBlending
    });
    material.vertexNode = vec4(positionGeometry.xy, float(0.0), float(1.0));
    material.fragmentNode = Fn(fragment, "vec4")();
    return material;
}

function blackTexture() {
    const texture = new DataTexture(
        new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    texture.needsUpdate = true;
    return texture;
}

export function createBloom(renderer, options = {}) {
    const state = {
        enabled: options.enabled !== false,
        threshold: options.threshold ?? 0.3,
        strength: options.strength ?? 1.0,
        levels: Math.min(options.levels ?? 3, 4)
    };

    const placeholder = blackTexture();
    const geometry = fullscreenTriangle();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const scene = new Scene();

    const downTex = uniformTexture(placeholder);
    const downTexel = uniform(new Vector2(0, 0));
    const downFloor = uniform(0);
    const down = passMaterial("solister bloom downsample TSL", () => {
        const pUv = vec2(positionGeometry.x.mul(0.5).add(0.5), float(0.5).sub(positionGeometry.y.mul(0.5))).toVar();
        const color = vec4(0.0, 0.0, 0.0, 0.0).toVar();
        for (const y of [-1, 1]) {
            for (const x of [-1, 1]) {
                for (const j of [-1, 1]) {
                    for (const i of [-1, 1]) {
                        const offset = vec2(
                            downTexel.x.mul(float(x))
                                .add(downTexel.x.mul(float(i)).mul(0.25)),
                            downTexel.y.mul(float(y))
                                .add(downTexel.y.mul(float(j)).mul(0.25))
                        );
                        const t = downTex.sample(pUv.add(offset)).toVar();
                        const floored = vec4(
                            max(t.rgb.sub(downFloor), vec3(0.0, 0.0, 0.0)), t.a);
                        const guarded = clamp(
                            floored.mul(clamp(
                                float(1.0).add(t.a), float(0.0), float(1.0))),
                            float(0.0), float(10.0));
                        color.addAssign(guarded);
                    }
                }
            }
        }
        return color.mul(0.0625);
    });

    const blurTex = uniformTexture(placeholder);
    const blurStep = uniform(new Vector2(0, 0));
    const blur = passMaterial("solister bloom blur TSL", () => {
        const pUv = vec2(positionGeometry.x.mul(0.5).add(0.5), float(0.5).sub(positionGeometry.y.mul(0.5))).toVar();
        const out = blurTex.sample(pUv).mul(BLOOM_SHADER_WEIGHTS[0]).toVar();
        for (let i = 1; i < BLOOM_SHADER_WEIGHTS.length; i++) {
            const offset = blurStep.mul(float(i));
            out.addAssign(
                blurTex.sample(pUv.add(offset))
                    .add(blurTex.sample(pUv.sub(offset)))
                    .mul(BLOOM_SHADER_WEIGHTS[i]));
        }
        return out;
    });

    const combineBase = uniformTexture(placeholder);
    const combineBloom = Array.from(
        { length: MAX_LEVELS }, () => uniformTexture(placeholder));
    const combineLevels = uniform(0);
    const combineStrength = uniform(state.strength);
    const combineExposure = uniform(1.0);
    const combine = passMaterial("solister bloom combine TSL", () => {
        const pUv = vec2(positionGeometry.x.mul(0.5).add(0.5), float(0.5).sub(positionGeometry.y.mul(0.5))).toVar();
        const base = combineBase.sample(pUv).rgb.toVar();
        const glow = vec3(0.0, 0.0, 0.0).toVar();
        for (let i = 0; i < MAX_LEVELS; i++) {
            glow.addAssign(select(
                combineLevels.greaterThan(float(i)),
                combineBloom[i].sample(pUv).rgb,
                vec3(0.0, 0.0, 0.0)));
        }
        const radiance = base.add(glow.mul(combineStrength));
        return vec4(displayToneMap(radiance, combineExposure), float(1.0));
    });

    const mesh = new Mesh(geometry, down);
    mesh.frustumCulled = false;
    scene.add(mesh);

    let levels = [];
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
            const make = () => new RenderTarget(lw, lh, {
                type: HalfFloatType,
                format: RGBAFormat,
                minFilter: LinearFilter,
                magFilter: LinearFilter,
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

    function prepare(sourceTexture, exposure, w, h) {
        if (!state.enabled) return null;
        if (w !== width || h !== height) allocate(w, h);
        let previous = sourceTexture;
        let previousW = w, previousH = h;
        for (const level of levels) {
            downTex.value = previous;
            downTexel.value.set(0.5 / previousW, 0.5 / previousH);
            downFloor.value = previous === sourceTexture ? state.threshold : 0;
            pass(down, level.down);

            blurTex.value = level.down.texture;
            blurStep.value.set(1 / level.w, 0);
            pass(blur, level.blurA);
            blurTex.value = level.blurA.texture;
            blurStep.value.set(0, 1 / level.h);
            pass(blur, level.blurB);

            previous = level.blurB.texture;
            previousW = level.w;
            previousH = level.h;
        }
        combineBase.value = sourceTexture;
        for (let i = 0; i < MAX_LEVELS; i++) {
            combineBloom[i].value =
                i < levels.length ? levels[i].blurB.texture : placeholder;
        }
        combineLevels.value = Math.min(levels.length, MAX_LEVELS);
        combineStrength.value = state.strength;
        combineExposure.value = exposure;
        return combine;
    }

    return {
        prepare,
        scene,
        camera,
        combine,
        materials: { down, blur, combine },
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
            placeholder.dispose();
            geometry.dispose();
            down.dispose();
            blur.dispose();
            combine.dispose();
        }
    };
}

export const BLOOM_WEIGHTS_TSL = BLOOM_WEIGHTS;
