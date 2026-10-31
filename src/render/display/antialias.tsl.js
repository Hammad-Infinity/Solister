import {
    BufferGeometry,
    Float32BufferAttribute,
    Mesh,
    MeshBasicNodeMaterial,
    NoBlending,
    OrthographicCamera,
    Scene,
    Vector2,
    Vector3,
    Vector4
} from "three/webgpu";
import {
    Fn,
    abs,
    dot,
    float,
    max,
    min,
    positionGeometry,
    select,
    uniform,
    uniformTexture,
    vec2,
    vec3,
    vec4
} from "three/tsl";

// TSL counterpart of antialias.js: FXAA 3.11, quality preset 12, after the
// tone curve, with luma computed from RGB because the toned image carries no
// luma in alpha.
//
// The preset is fixed in production, so its five search steps are unrolled
// here (1.0, 1.5, 2.0, 4.0, 12.0). The span search is written with selects
// over the same state the nested classic branches mutate: a side that is
// done keeps its end luma and position, a side that is not done samples and
// advances. That is the same sequence of positions and end tests, in the
// form a node graph can compile to both backends.

export const FXAA_QUALITY = {
    subpix: 0.75,
    edgeThreshold: 0.166,
    edgeThresholdMin: 0.0833
};
const FXAA_STEPS = [1.0, 1.5, 2.0, 4.0, 12.0];
const LUMA_WEIGHTS = [0.299, 0.587, 0.114];

export function createAntialias(renderer, options = {}) {
    const state = {
        enabled: options.enabled !== false,
        quality: { ...FXAA_QUALITY, ...(options.quality || {}) }
    };

    const inputTex = uniformTexture();
    const viewport = uniform(new Vector2(1, 1));
    const rcpFrame = uniform(new Vector4(1, 1, 1, 1));
    const qualityParams = uniform(new Vector3(
        state.quality.subpix,
        state.quality.edgeThreshold,
        state.quality.edgeThresholdMin));

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position",
        new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geometry.setAttribute("uv",
        new Float32BufferAttribute([0, -1, 0, 1, 2, 1], 2));

    const material = new MeshBasicNodeMaterial({
        name: "solister antialias TSL",
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        blending: NoBlending
    });
    material.vertexNode = vec4(positionGeometry.xy, float(0.0), float(1.0));
    material.fragmentNode = Fn(() => {
        // FXAA is a level-0 image algorithm and its span search is
        // divergent by design. Sample that level explicitly, as the
        // classic pass does by reading a non-mipmapped target, rather
        // than asking implicit derivatives to choose it mid-search.
        // Run the search in the classic pass's bottom-up pixel coordinates
        // and convert to the node render target's top-down UV only at the
        // sample. FXAA's north/south tie-breaks are part of its output at
        // junctions, so the presented image must use the same handedness.
        const sampleAt = pos => inputTex.sample(vec2(
            pos.x.mul(rcpFrame.z),
            float(1.0).sub(pos.y.mul(rcpFrame.w)))).level(float(0.0));
        const lumaAt = pos => dot(sampleAt(pos).rgb, vec3(...LUMA_WEIGHTS));

        const passUv = vec2(positionGeometry.x.mul(0.5).add(0.5), float(0.5).sub(positionGeometry.y.mul(0.5))).toVar();
        const posM = vec2(
            passUv.x.mul(viewport.x),
            float(1.0).sub(passUv.y).mul(viewport.y)).toVar();
        const rgbyM = sampleAt(posM).toVar();
        const rgbyMlum = dot(rgbyM.rgb, vec3(...LUMA_WEIGHTS)).toVar();
        const lumaS0 = lumaAt(posM.add(vec2(0.0, 1.0))).toVar();
        const lumaE0 = lumaAt(posM.add(vec2(1.0, 0.0))).toVar();
        const lumaN0 = lumaAt(posM.add(vec2(0.0, -1.0))).toVar();
        const lumaW0 = lumaAt(posM.add(vec2(-1.0, 0.0))).toVar();

        const maxSM = max(lumaS0, rgbyMlum);
        const minSM = min(lumaS0, rgbyMlum);
        const maxESM = max(lumaE0, maxSM);
        const minESM = min(lumaE0, minSM);
        const maxWN = max(lumaN0, lumaW0);
        const minWN = min(lumaN0, lumaW0);
        const rangeMax = max(maxWN, maxESM).toVar();
        const rangeMin = min(minWN, minESM).toVar();
        const range = rangeMax.sub(rangeMin).toVar();
        const rangePass = range.greaterThanEqual(max(
            qualityParams.z, rangeMax.mul(qualityParams.y))).toVar();
        // Only a guard for the unselected path: when the range test passes,
        // range is above the edge thresholds and this max is range itself.
        const rangeSafe = max(range, float(1.0e-6));

        const lumaNW = lumaAt(posM.add(vec2(-1.0, -1.0))).toVar();
        const lumaSE = lumaAt(posM.add(vec2(1.0, 1.0))).toVar();
        const lumaNE = lumaAt(posM.add(vec2(1.0, -1.0))).toVar();
        const lumaSW = lumaAt(posM.add(vec2(-1.0, 1.0))).toVar();

        const lumaNS = lumaN0.add(lumaS0);
        const lumaWE = lumaW0.add(lumaE0);
        const subpixRcpRange = float(1.0).div(rangeSafe);
        const subpixNSWE = lumaNS.add(lumaWE);
        const edgeHorz1 = rgbyMlum.mul(-2.0).add(lumaNS);
        const edgeVert1 = rgbyMlum.mul(-2.0).add(lumaWE);

        const lumaNESE = lumaNE.add(lumaSE);
        const lumaNWNE = lumaNW.add(lumaNE);
        const edgeHorz2 = lumaE0.mul(-2.0).add(lumaNESE);
        const edgeVert2 = lumaN0.mul(-2.0).add(lumaNWNE);

        const lumaNWSW = lumaNW.add(lumaSW);
        const lumaSWSE = lumaSW.add(lumaSE);
        const edgeHorz4 = abs(edgeHorz1).mul(2.0).add(abs(edgeHorz2));
        const edgeVert4 = abs(edgeVert1).mul(2.0).add(abs(edgeVert2));
        const edgeHorz3 = lumaW0.mul(-2.0).add(lumaNWSW);
        const edgeVert3 = lumaS0.mul(-2.0).add(lumaSWSE);
        const edgeHorz = abs(edgeHorz3).add(edgeHorz4);
        const edgeVert = abs(edgeVert3).add(edgeVert4);

        const subpixNWSWNESE = lumaNWSW.add(lumaNESE);
        const horzSpan = edgeHorz.greaterThanEqual(edgeVert).toVar();
        const subpixA = subpixNSWE.mul(2.0).add(subpixNWSWNESE);

        const lumaN = select(horzSpan, lumaN0, lumaW0).toVar();
        const lumaS = select(horzSpan, lumaS0, lumaE0).toVar();
        const subpixB = subpixA.mul(float(1.0 / 12.0)).sub(rgbyMlum).toVar();

        const gradientN = lumaN.sub(rgbyMlum).toVar();
        const gradientS = lumaS.sub(rgbyMlum).toVar();
        const lumaNNpaired = lumaN.add(rgbyMlum).toVar();
        const lumaSS = lumaS.add(rgbyMlum).toVar();
        const pairN = abs(gradientN).greaterThanEqual(abs(gradientS)).toVar();
        const gradient = max(abs(gradientN), abs(gradientS)).toVar();
        const lengthSign0 = select(horzSpan, rcpFrame.y, rcpFrame.x);
        const lengthSign = select(
            pairN, lengthSign0.mul(-1.0), lengthSign0).toVar();
        const subpixC = abs(subpixB).mul(subpixRcpRange).toVar();

        const offNP = vec2(
            select(horzSpan, rcpFrame.x, float(0.0)),
            select(horzSpan, float(0.0), rcpFrame.y)).toVar();
        const halfSign = lengthSign.mul(0.5);
        const posB = vec2(
            posM.x.add(select(horzSpan, float(0.0), halfSign)),
            posM.y.add(select(horzSpan, halfSign, float(0.0)))).toVar();

        let posN = posB.sub(offNP.mul(float(FXAA_STEPS[0]))).toVar();
        let posP = posB.add(offNP.mul(float(FXAA_STEPS[0]))).toVar();
        const subpixD = subpixC.mul(-2.0).add(3.0).toVar();
        const subpixE = subpixC.mul(subpixC).toVar();
        const lumaNN = select(pairN, lumaNNpaired, lumaSS).toVar();
        const gradientScaled = gradient.mul(0.25).toVar();
        const lumaMM = rgbyMlum.sub(lumaNN.mul(0.5)).toVar();
        const subpixF = subpixD.mul(subpixE).toVar();
        const lumaMLTZero = lumaMM.lessThan(0.0).toVar();

        let lumaEndN = lumaAt(posN).sub(lumaNN.mul(0.5)).toVar();
        let lumaEndP = lumaAt(posP).sub(lumaNN.mul(0.5)).toVar();
        let doneN = abs(lumaEndN).greaterThanEqual(gradientScaled).toVar();
        let doneP = abs(lumaEndP).greaterThanEqual(gradientScaled).toVar();

        posN = select(doneN, posN,
            posN.sub(offNP.mul(float(FXAA_STEPS[1])))).toVar();
        posP = select(doneP, posP,
            posP.add(offNP.mul(float(FXAA_STEPS[1])))).toVar();
        let doneNP = doneN.not().or(doneP.not()).toVar();

        for (let s = 2; s < FXAA_STEPS.length; s++) {
            const guard = doneNP;
            lumaEndN = select(guard.and(doneN.not()),
                lumaAt(posN).sub(lumaNN.mul(0.5)), lumaEndN).toVar();
            lumaEndP = select(guard.and(doneP.not()),
                lumaAt(posP).sub(lumaNN.mul(0.5)), lumaEndP).toVar();
            doneN = abs(lumaEndN).greaterThanEqual(gradientScaled).toVar();
            doneP = abs(lumaEndP).greaterThanEqual(gradientScaled).toVar();
            const step = offNP.mul(float(FXAA_STEPS[s]));
            posN = select(guard.and(doneN.not()), posN.sub(step), posN).toVar();
            posP = select(guard.and(doneP.not()), posP.add(step), posP).toVar();
            doneNP = doneN.not().or(doneP.not()).toVar();
        }

        const dstN = select(horzSpan,
            posM.x.sub(posN.x), posM.y.sub(posN.y)).toVar();
        const dstP = select(horzSpan,
            posP.x.sub(posM.x), posP.y.sub(posM.y)).toVar();
        const goodSpanN = lumaEndN.lessThan(0.0).xor(lumaMLTZero).toVar();
        const goodSpanP = lumaEndP.lessThan(0.0).xor(lumaMLTZero).toVar();
        const spanLengthRcp = float(1.0).div(dstP.add(dstN));
        const directionN = dstN.lessThan(dstP).toVar();
        const dst = min(dstN, dstP);
        const goodSpan = select(directionN, goodSpanN, goodSpanP).toVar();
        const subpixG = subpixF.mul(subpixF);
        const pixelOffset = dst.mul(spanLengthRcp.mul(-1.0)).add(0.5);
        const subpixH = subpixG.mul(qualityParams.x);
        const pixelOffsetGood = select(goodSpan, pixelOffset, float(0.0));
        const pixelOffsetSubpix = max(pixelOffsetGood, subpixH).toVar();
        const shift = pixelOffsetSubpix.mul(lengthSign);
        const finalPos = vec2(
            posM.x.add(select(horzSpan, float(0.0), shift)),
            posM.y.add(select(horzSpan, shift, float(0.0))));
        const filtered = vec4(sampleAt(finalPos).rgb, float(1.0));
        return select(rangePass, filtered, rgbyM);
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
        get quality() { return state.quality; },
        begin(texture, width, height) {
            inputTex.value = texture;
            viewport.value.set(width, height);
            // Same packing as the classic pass: one unit in the shader's
            // coordinate space is one pixel, and .zw converts back to UV.
            rcpFrame.value.set(1, 1, 1 / width, 1 / height);
            const q = state.quality;
            qualityParams.value.set(q.subpix, q.edgeThreshold, q.edgeThresholdMin);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        }
    };
}
