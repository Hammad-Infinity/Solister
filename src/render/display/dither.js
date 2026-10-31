// The last step before the framebuffer: dithering.
//
// A smooth gradient written into 8 bits is a staircase, and the atmosphere is
// nothing but smooth gradients -- a limb fading over a hundred kilometres, a
// terminator crossing a whole hemisphere. The reference breaks the staircase
// with noise on the final write, and so does this:
//
//     n = noise(uv) * 4 - 2                       in [-2, 2]
//     out = floor(256 * c + n * amplitude) / 256
//
// That is the reference's expression, character for character. With an
// amplitude near 1 it moves each channel by up to one quantum, randomly, so a
// step between two levels becomes a stipple of the two -- and because the noise
// is symmetric its average is zero, which is what makes the step disappear
// without the picture moving: the mean of a region is preserved exactly.
//
// The one thing the shader we hold cannot tell us is how its noise coordinate
// is derived (`TexCoord * (1/ViewPortW, 1/ViewPortH)` reads as a sliver of a
// cube, which would make the noise nearly constant across the frame). We sample
// it per pixel, animated in time, because per-pixel noise is the only thing
// that actually breaks a staircase; the gain and the floor operation are the
// reference's.
//
// It lives in its own file because it is the one stage whose job is invisible:
// it must change no average and no colour, only the distribution. The probe
// checks exactly that.

function createDither(THREE, renderer, options = {}) {
    const state = {
        enabled: options.enabled !== false,
        // The reference's own noise is in [-2, 2]; half an amplitude of that
        // moves each channel by at most one quantum, which is exactly enough
        // to tip a pixel between neighbouring levels and no further. More
        // starts to read as grain.
        amplitude: options.amplitude ?? 0.5,
        size: options.size ?? 64
    };

    // A tileable noise cube. Deterministic, generated in the browser: the
    // project ships no texture files, and a hash is all this needs.
    function buildNoise(size) {
        const data = new Uint8Array(size * size * size * 4);
        let seed = 0x9e3779b9;
        const rand = () => {
            // xorshift32: cheap, uniform enough for a dither pattern, and the
            // same sequence every run so the picture is reproducible.
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
        const tex = new THREE.Data3DTexture(data, size, size, size);
        tex.format = THREE.RGBAFormat;
        tex.type = THREE.UnsignedByteType;
        // Repeat, so the pattern tiles without a seam at the screen edge, and
        // nearest sampling: this is noise, not an image, and filtering it would
        // pull every pixel toward the mean -- the opposite of the point.
        tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
        tex.minFilter = tex.magFilter = THREE.NearestFilter;
        tex.needsUpdate = true;
        return tex;
    }

    const noise = buildNoise(state.size);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));

    const material = new THREE.ShaderMaterial({
        name: "solister dither",
        uniforms: {
            uTex: { value: null },
            uNoise: { value: noise },
            uNoiseSize: { value: state.size },
            uAmplitude: { value: state.amplitude },
            uTime: { value: 0 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = position.xy * 0.5 + 0.5;
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `,
        fragmentShader: `
            precision highp sampler3D;
            varying vec2 vUv;
            uniform sampler2D uTex;
            uniform sampler3D uNoise;
            uniform float uNoiseSize;
            uniform float uAmplitude;
            uniform float uTime;
            void main() {
                vec4 c = texture2D(uTex, vUv);
                // The reference's expression. The coordinate is this pixel's
                // own, one noise texel per pixel, walked forward one slice per
                // frame so the pattern never sits still long enough to be seen
                // as a fixed texture.
                vec3 at = vec3(gl_FragCoord.xy / uNoiseSize, uTime / uNoiseSize);
                vec3 n = texture(uNoise, at).rgb * 4.0 - vec3(2.0);
                const float N = 256.0;
                gl_FragColor = vec4(floor(N * c.rgb + n * uAmplitude) / N, c.a);
            }
        `,
        depthTest: false,
        depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    return {
        scene,
        camera,
        material,
        get enabled() { return state.enabled; },
        set enabled(v) { state.enabled = !!v; },
        get amplitude() { return state.amplitude; },
        set amplitude(v) { if (Number.isFinite(v)) state.amplitude = v; },
        begin(texture, timeSeconds) {
            material.uniforms.uTex.value = texture;
            material.uniforms.uTime.value = timeSeconds % (state.size * 64);
        },
        dispose() {
            noise.dispose();
            geometry.dispose();
            material.dispose();
        }
    };
}

globalThis.createDither = createDither;
