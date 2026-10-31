import {
    Fn,
    float,
    vec2,
    vec3,
    vec4,
    abs,
    atan,
    clamp,
    cross,
    dot,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    pow,
    select,
    sign,
    smoothstep,
    sqrt,
    step,
    struct,
    texture,
    texture3D
} from "three/tsl";

// TSL counterpart of ATM_SAMPLING_GLSL in atm-sampling.glsl.js.
//
// This is a transcription of the production table reader, not a new
// atmosphere model. The table dimensions, writer-side mu/muS mappings,
// phase functions, packed-Mie unpack, segment-transmittance ratio,
// top-of-shell sky ray and horizon fix are the production formulas term by
// term. A factory is used because the GLSL form closes over one body's
// table textures and header uniforms; the returned functions close over the
// corresponding texture/uniform nodes. tools/p4atmsampling.mjs renders the
// GLSL and TSL libraries against the same Earth table and compares them.

export const AtmRay = struct({
    eyePos: "vec3",
    eyeR: "float",
    eyeMu: "float",
    viewDir: "vec3",
    viewLen: "float",
    fragPos: "vec3",
    fragR: "float",
    fragMu: "float"
}, "AtmRay");

const ATM_RES_R = 32.0;
const ATM_RES_MU = 64.0;
const ATM_RES_MU_S = 32.0;
const ATM_RES_NU = 8.0;
const ATM_PI = float(3.14159265359);
const ATM_TAN_K = 5.3496235;
const ATM_TAN_15 = 14.1014199;

function asVec2(value) {
    if (Array.isArray(value)) return vec2(value[0], value[1]);
    if (value && typeof value.x === "number" && typeof value.y === "number" && !value.isNode) {
        return vec2(value.x, value.y);
    }
    return value;
}

function asVec3(value) {
    if (Array.isArray(value)) return vec3(value[0], value[1], value[2]);
    if (value && typeof value.x === "number" && typeof value.y === "number" &&
        typeof value.z === "number" && !value.isNode) {
        return vec3(value.x, value.y, value.z);
    }
    return value;
}

function asVec4(value) {
    if (Array.isArray(value)) return vec4(value[0], value[1], value[2], value[3]);
    if (value && typeof value.x === "number" && typeof value.y === "number" &&
        typeof value.z === "number" && typeof value.w === "number" && !value.isNode) {
        return vec4(value.x, value.y, value.z, value.w);
    }
    return value;
}

function asFloat(value) {
    return typeof value === "number" ? float(value) : value;
}

function member(ray, name) {
    return typeof ray.get === "function" ? ray.get(name) : ray[name];
}

export function createAtmSampling(options = {}) {
    const inscatterTex = options.inscatter?.isTexture
        ? texture3D(options.inscatter) : options.inscatter;
    const transmittanceTex = options.transmittance?.isTexture
        ? texture(options.transmittance) : options.transmittance;
    const irradianceTex = options.irradiance?.isTexture
        ? texture(options.irradiance) : options.irradiance;

    const radii = asVec4(options.radii);
    const betaR = asVec3(options.betaR);
    const betaMieExt = asVec3(options.betaMieExt);
    const mie = asVec2(options.mie);
    const axisScale = options.axisScale === undefined ? vec3(1.0, 1.0, 1.0) : asVec3(options.axisScale);
    const colAdjust = options.colAdjust === undefined ? vec2(0.0, 1.0) : asVec2(options.colAdjust);
    const scatterBright = options.scatterBright === undefined ? float(1.0) : asFloat(options.scatterBright);

    const atmToTable = Fn(([v]) => v.mul(axisScale));

    const atmRgb2Hsl = Fn(([rgb]) => {
        const K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        const p = mix(vec4(rgb.bg, K.wz), vec4(rgb.gb, K.xy), step(rgb.b, rgb.g));
        const q = mix(vec4(p.xyw, rgb.r), vec4(rgb.r, p.yzx), step(p.x, rgb.r));
        const d = q.x.sub(min(q.w, q.y));
        const e = float(1.0e-10);
        return vec3(
            abs(q.z.add(q.w.sub(q.y).div(d.mul(6.0).add(e)))),
            d.div(q.x.add(e)),
            q.x
        );
    });

    const atmHsl2Rgb = Fn(([hsl]) => {
        const K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        const p = abs(fract(hsl.xxx.add(K.xyz)).mul(6.0).sub(K.www));
        return hsl.z.mul(mix(K.xxx, clamp(p.sub(K.xxx), float(0.0), float(1.0)), hsl.y));
    });

    const atmColourAdjust = Fn(([inscatter]) => {
        const hsl = atmRgb2Hsl(inscatter);
        return atmHsl2Rgb(vec3(
            hsl.x.add(colAdjust.x),
            clamp(hsl.y.mul(colAdjust.y), float(0.0), float(1.0)),
            hsl.z.mul(scatterBright)
        ));
    });

    const atmShellLength = Fn(() => {
        return sqrt(max(radii.y.mul(radii.y).sub(radii.x.mul(radii.x)), float(1e-6)));
    });

    const atmHeight01 = Fn(([r]) => {
        return clamp(
            r.sub(radii.x).div(max(radii.y.sub(radii.x), float(1e-6))),
            float(0.0),
            float(1.0)
        );
    });

    const atmTransmittance = Fn(([r, mu]) => {
        const uR = sqrt(atmHeight01(r));
        const uMu = atan(mu.add(0.15).mul(ATM_TAN_15 / 1.15)).div(1.5);
        return transmittanceTex.sample(vec2(uMu, uR)).rgb;
    });

    const atmIrradiance = Fn(([h, muS]) => {
        const v = h.mul(15.0).add(0.5).div(16.0);
        const u = muS.add(0.2).div(1.2).mul(63.0).add(0.5).div(64.0);
        return irradianceTex.sample(vec2(
            clamp(u, float(0.0), float(1.0)),
            clamp(v, float(0.0), float(1.0))
        )).rgb;
    });

    const atmTable4D = Fn(([r, mu, muS, nu]) => {
        const H = atmShellLength();
        const ground2 = radii.x.mul(radii.x);
        const rho = sqrt(max(r.mul(r).sub(ground2), float(0.0)));
        const rmu = r.mul(mu);
        const delta = rmu.mul(rmu).sub(r.mul(r)).add(ground2);

        const groundHit = rmu.lessThan(0.0).and(delta.greaterThan(0.0));
        const cst = select(
            groundHit,
            vec4(1.0, 0.0, 0.0, 0.5 - 0.5 / ATM_RES_MU),
            vec4(-1.0, H.mul(H), H, 0.5 + 0.5 / ATM_RES_MU)
        );

        const uR = float(0.5 / ATM_RES_R)
            .add(rho.div(H).mul(1.0 - 1.0 / ATM_RES_R));
        const denominator = rho.add(cst.z);
        const safeDenominator = select(denominator.greaterThan(0.0), denominator, float(1.0));
        const uMuIncrement = rmu.mul(cst.x)
            .add(sqrt(max(delta.add(cst.y), float(0.0))))
            .div(safeDenominator)
            .mul(0.5 - 1.0 / ATM_RES_MU);
        const uMu = cst.w.add(select(denominator.greaterThan(0.0), uMuIncrement, float(0.0)));

        const muSNorm = atan(max(muS, float(-0.1975)).mul(ATM_TAN_K))
            .div(1.1).mul(0.5).add(0.37);
        const uMuS = float(0.5 / ATM_RES_MU_S)
            .add(muSNorm.mul(1.0 - 1.0 / ATM_RES_MU_S));

        const nuLerp = nu.add(1.0).mul(0.5).mul(ATM_RES_NU - 1.0);
        const nuSlice = floor(nuLerp);
        const uvw = vec3(nuSlice.add(uMuS).div(ATM_RES_NU), uMu, uR);
        const sliceA = inscatterTex.sample(uvw);
        const sliceB = inscatterTex.sample(vec3(
            uvw.x.add(1.0 / ATM_RES_NU),
            uvw.y,
            uvw.z
        ));
        return mix(sliceA, sliceB, nuLerp.sub(nuSlice));
    });

    const atmPhaseR = Fn(([mu]) => {
        const ca = float(3.0).div(float(16.0).mul(ATM_PI));
        return ca.add(ca.mul(mu).mul(mu));
    });

    const atmPhaseM = Fn(([mu]) => {
        const ca = float(3.0).div(float(8.0).mul(ATM_PI));
        const g = mie.x;
        const g2 = g.mul(g);
        return ca.sub(ca.mul(g2))
            .mul(pow(float(1.0).add(g2).sub(g.mul(mu).mul(2.0)), float(-1.5)))
            .mul(float(1.0).add(mu.mul(mu)))
            .div(float(2.0).add(g2));
    });

    const atmGetMie = Fn(([rayMie]) => {
        return rayMie.w.mul(betaR.r)
            .div(max(rayMie.x, float(1e-4)))
            .mul(rayMie.rgb.div(betaR));
    });

    const atmTransmittanceSegment = Fn(([eyeR, eyeMu, fragR, fragMu]) => {
        const rLo = min(eyeR, fragR);
        const rHi = max(eyeR, fragR);
        const eyeIsLower = eyeR.lessThan(fragR);
        const muLo = select(eyeIsLower, eyeMu, fragMu);
        const muHi = select(eyeIsLower, fragMu, eyeMu);
        const lower = atmTransmittance(rLo, muLo.mul(-1.0));
        const upper = atmTransmittance(rHi, muHi.mul(-1.0));
        return clamp(
            lower.div(max(upper, vec3(1e-4, 1e-4, 1e-4))),
            float(0.0),
            float(1.0)
        );
    });

    const atmSkyRay = Fn(([eyeKm, dir]) => {
        const eyeR = max(length(eyeKm), float(1e-6));
        const rSample = min(eyeR, radii.y);
        const along = dot(eyeKm, dir);
        const perp = length(cross(eyeKm, dir));
        const sag2 = rSample.sub(perp).mul(rSample.add(perp));
        const mu = sign(along).mul(sqrt(max(sag2, float(0.0)))).div(rSample);
        const eyePos = eyeKm.mul(rSample.div(eyeR));
        return AtmRay({
            eyePos,
            eyeR: rSample,
            eyeMu: mu,
            viewDir: dir,
            viewLen: float(0.0),
            fragPos: eyePos,
            fragR: rSample,
            fragMu: mu
        });
    });

    const atmInscatterSky = Fn(([ray, lightDir]) => {
        const eyePos = member(ray, "eyePos");
        const eyeR = member(ray, "eyeR");
        const eyeMu = member(ray, "eyeMu");
        const viewDir = member(ray, "viewDir");

        const eyeMuS = dot(eyePos, lightDir).div(max(eyeR, float(1e-6)));
        const nu = dot(viewDir, lightDir);
        const sampled = max(atmTable4D(eyeR, eyeMu, eyeMuS, nu), float(0.0));
        const inScatter = vec4(
            sampled.rgb,
            sampled.w.mul(smoothstep(float(0.0), mie.y, eyeMuS))
        );
        return atmColourAdjust(
            inScatter.rgb.mul(atmPhaseR(nu))
                .add(atmGetMie(inScatter).mul(atmPhaseM(nu)))
        );
    });

    const atmInscatterGround = Fn(([ray, lightDir, attenuation]) => {
        const eyePos = member(ray, "eyePos");
        const eyeR = member(ray, "eyeR");
        const eyeMu = member(ray, "eyeMu");
        const viewDir = member(ray, "viewDir");
        const fragPos = member(ray, "fragPos");
        const fragR = member(ray, "fragR");
        const fragMu = member(ray, "fragMu");

        const eyeMuS = dot(eyePos, lightDir).div(max(eyeR, float(1e-6)));
        const fragMuS = dot(fragPos, lightDir).div(max(fragR, float(1e-6)));
        const nu = dot(viewDir, lightDir);
        const eyeScatter = atmTable4D(eyeR, eyeMu, eyeMuS, nu);
        const fragScatter = atmTable4D(fragR, fragMu, fragMuS, nu);
        const sampled = max(
            eyeScatter.sub(vec4(attenuation, attenuation.r).mul(fragScatter)),
            float(0.0)
        );
        const inScatter = vec4(
            sampled.rgb,
            sampled.w.mul(smoothstep(float(0.0), mie.y, eyeMuS))
        );
        return atmColourAdjust(
            inScatter.rgb.mul(atmPhaseR(nu))
                .add(atmGetMie(inScatter).mul(atmPhaseM(nu)))
        );
    });

    const atmInscatterGroundFix = Fn(([ray, lightDir, attenuation, eps]) => {
        const eyePos = member(ray, "eyePos");
        const eyeR = member(ray, "eyeR");
        const eyeMu = member(ray, "eyeMu");
        const viewDir = member(ray, "viewDir");
        const viewLen = member(ray, "viewLen");
        const fragPos = member(ray, "fragPos");
        const fragRGiven = member(ray, "fragR");

        const invR = radii.x.div(max(eyeR, float(1e-6)));
        const horizonMu = sqrt(max(float(1.0).sub(invR.mul(invR)), float(0.0))).mul(-1.0);
        const blend = clamp(
            eyeMu.sub(horizonMu).add(eps).div(eps.mul(2.0)),
            float(0.0),
            float(1.0)
        );
        const eyeMuS = dot(eyePos, lightDir).div(max(eyeR, float(1e-6)));
        const fragMuS = dot(fragPos, lightDir).div(max(fragRGiven, float(1e-6)));
        const nu = dot(viewDir, lightDir);

        const candidate = (mu) => {
            const fragR = sqrt(max(
                eyeR.mul(eyeR)
                    .add(viewLen.mul(viewLen))
                    .add(eyeR.mul(viewLen).mul(mu).mul(2.0)),
                float(0.0)
            ));
            const fragMu = eyeR.mul(mu).add(viewLen)
                .div(max(fragR, float(1e-6)));
            const eyeScatter = atmTable4D(eyeR, mu, eyeMuS, nu);
            const fragScatter = atmTable4D(fragR, fragMu, fragMuS, nu);
            return max(
                eyeScatter.sub(vec4(attenuation, attenuation.r).mul(fragScatter)),
                float(0.0)
            );
        };

        const sampled = mix(
            candidate(horizonMu.sub(eps)),
            candidate(horizonMu.add(eps)),
            blend
        );
        const inScatter = vec4(
            sampled.rgb,
            sampled.w.mul(smoothstep(float(0.0), mie.y, eyeMuS))
        );
        return atmColourAdjust(
            inScatter.rgb.mul(atmPhaseR(nu))
                .add(atmGetMie(inScatter).mul(atmPhaseM(nu)))
        );
    });

    return {
        AtmRay,
        radii,
        betaR,
        betaMieExt,
        mie,
        axisScale,
        colAdjust,
        scatterBright,
        atmToTable,
        atmRgb2Hsl,
        atmHsl2Rgb,
        atmColourAdjust,
        atmShellLength,
        atmHeight01,
        atmTransmittance,
        atmIrradiance,
        atmTable4D,
        atmPhaseR,
        atmPhaseM,
        atmGetMie,
        atmTransmittanceSegment,
        atmSkyRay,
        atmInscatterSky,
        atmInscatterGround,
        atmInscatterGroundFix
    };
}
