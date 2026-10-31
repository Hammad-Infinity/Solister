import {
    BufferGeometry,
    Data3DTexture,
    Float32BufferAttribute,
    Mesh,
    MeshBasicNodeMaterial,
    NearestFilter,
    NoBlending,
    OrthographicCamera,
    RGBAFormat,
    RepeatWrapping,
    Scene,
    UnsignedByteType
} from "three/webgpu";
import {
    Fn,
    float,
    floor,
    positionGeometry,
    screenSize,
    texture3D,
    uniform,
    uniformTexture,
    vec2,
    vec3,
    vec4
} from "three/tsl";

// TSL counterpart of dither.js.
//
// The seed sequence, cube size, nearest-repeat sampling and final
// floor(256c + nA) / 256 expression are copied as arithmetic. The classic
// shader addresses the cube with the fragment's own pixel coordinate; the
// node form derives that same fullscreen-pass coordinate from the pass UV
// and the current draw size, which keeps it tied to the destination pixels
// on both node backends.

function buildNoise(size) {
    const data = new Uint8Array(size * size * size * 4);
    let seed = 0x9e3779b9;
    const rand = () => {
        seed ^= seed << 13; seed >>>= 0;
        seed ^= seed >>> 17;
        seed ^= seed << 5;  seed >>>= 0;
        return seed / 4294967296;
    };
    for (let i = 0; i < data.length; i += 4) {
        data[i] = (rand() * 256) | 0;
        data[i + 1] = (rand() * 256) | 0;
        data[i + 2] = (rand() * 256) | 0;
        data[i + 3] = 255;
    }
    const tex = new Data3DTexture(data, size, size, size);
    tex.format = RGBAFormat;
    tex.type = UnsignedByteType;
    tex.wrapS = tex.wrapT = tex.wrapR = RepeatWrapping;
    tex.minFilter = tex.magFilter = NearestFilter;
    tex.needsUpdate = true;
    return tex;
}

export function createDither(renderer, options = {}) {
    const state = {
        enabled: options.enabled !== false,
        amplitude: options.amplitude ?? 0.5,
        size: options.size ?? 64
    };

    const noise = buildNoise(state.size);
    const inputTex = uniformTexture();
    const noiseTex = texture3D(noise);
    const noiseSize = uniform(state.size);
    const amplitude = uniform(state.amplitude);
    const time = uniform(0);

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position",
        new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geometry.setAttribute("uv",
        new Float32BufferAttribute([0, -1, 0, 1, 2, 1], 2));

    const material = new MeshBasicNodeMaterial({
        name: "solister dither TSL",
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        blending: NoBlending
    });
    material.vertexNode = vec4(positionGeometry.xy, float(0.0), float(1.0));
    material.fragmentNode = Fn(() => {
        const pUv = vec2(positionGeometry.x.mul(0.5).add(0.5), float(0.5).sub(positionGeometry.y.mul(0.5))).toVar();
        const c = inputTex.sample(pUv).toVar();
        // The pass UV runs down the presented image (three's node
        // render-target convention); the classic shader's fragment
        // coordinate runs up it. Flip only the noise address so the same
        // presented pixel receives the same noise texel.
        const pixel = vec2(
            pUv.x.mul(screenSize.x),
            float(1.0).sub(pUv.y).mul(screenSize.y));
        const at = vec3(pixel.div(noiseSize), time.div(noiseSize));
        const n = noiseTex.sample(at).rgb.mul(4.0).sub(vec3(2.0, 2.0, 2.0));
        return vec4(
            floor(c.rgb.mul(256.0).add(n.mul(amplitude))).div(256.0),
            c.a);
    }, "vec4")();

    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    return {
        scene,
        camera,
        material,
        get enabled() { return state.enabled; },
        set enabled(v) { state.enabled = !!v; },
        get amplitude() { return state.amplitude; },
        set amplitude(v) {
            if (Number.isFinite(v)) {
                state.amplitude = v;
                amplitude.value = v;
            }
        },
        begin(texture, timeSeconds) {
            inputTex.value = texture;
            amplitude.value = state.amplitude;
            time.value = timeSeconds % (state.size * 64);
        },
        dispose() {
            noise.dispose();
            geometry.dispose();
            material.dispose();
        }
    };
}
