import {
    Fn,
    acos,
    atan,
    clamp,
    dFdx,
    dFdy,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    mat3,
    max,
    min,
    mix,
    normalize,
    pow,
    select,
    sin,
    smoothstep,
    sqrt,
    struct,
    texture,
    uniform,
    vec2,
    vec3,
    vec4
} from "three/tsl";

// TSL counterparts for the shader arithmetic owned by planet-detail.js,
// added one effect at a time. Production still installs the classic
// onBeforeCompile patches; nothing here is imported by production yet.
//
// P5c2: the ground-atmosphere haze. Production integrates an exponential
// density at five fixed samples along the surface-to-camera segment in
// metric (ellipsoid-corrected), radius-normalised local coordinates, then
// attenuates every reflected/emissive component by one factor and adds a
// sun-lit haze colour to indirect diffuse. This module returns exactly
// those two quantities — the scalar attenuation and the already-scaled
// haze colour — so a later node lighting binding can apply them component
// by component just as the classic patch does. The five production samples
// are a fixed count, so the accumulation is unrolled while building the
// graph (the same select-accumulation pattern proved for the satellite
// Eclipse caster product); the sample positions and weights are unchanged.

export const GROUND_ATMOSPHERE_SAMPLES = 5;

export const GroundAtmosphereTerms = struct({
    attenuation: "float",
    haze: "vec3"
}, "GroundAtmosphereTerms");

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? float(value) : value;
}

function asVec3Node(value, fallback) {
    if (value === undefined) return vec3(fallback[0], fallback[1], fallback[2]);
    if (Array.isArray(value)) return vec3(value[0], value[1], value[2]);
    if (value?.isVector3 || value?.isColor) return uniform(value);
    if (value && typeof value.x === "number" && typeof value.y === "number" &&
        typeof value.z === "number" && !value.isNode) {
        return vec3(value.x, value.y, value.z);
    }
    if (value && typeof value.r === "number" && typeof value.g === "number" &&
        typeof value.b === "number" && !value.isNode) {
        return vec3(value.r, value.g, value.b);
    }
    return value;
}

function asVec4Node(value, fallback) {
    if (value === undefined) return vec4(fallback[0], fallback[1], fallback[2], fallback[3]);
    if (Array.isArray(value)) return vec4(value[0], value[1], value[2], value[3]);
    if (value?.isVector4) return uniform(value);
    if (value && typeof value.x === "number" && typeof value.y === "number" &&
        typeof value.z === "number" && typeof value.w === "number" && !value.isNode) {
        return vec4(value.x, value.y, value.z, value.w);
    }
    return value;
}

function asMat3Node(value, fallbackElements) {
    // Elements are column-major, matching Matrix3.elements and the GLSL
    // mat3 constructor order.
    if (value === undefined) return mat3(...fallbackElements);
    if (Array.isArray(value)) return mat3(...value);
    if (value?.isMatrix3) return uniform(value);
    return value;
}

function member(node, name) {
    return typeof node.get === "function" ? node.get(name) : node[name];
}

export function createGroundAtmosphere(options = {}) {
    const Camera = asVec3Node(options.Camera, [0.0, 0.0, 0.0]);
    const sun = asVec3Node(options.sun, [1.0, 0.0, 0.0]);
    const metricScaleIn = asVec3Node(options.metricScale, [1.0, 1.0, 1.0]);
    const color = asVec3Node(options.color, [0.447, 0.663, 0.922]);
    const radius = asFloatNode(options.radius, 0.0);
    const scaleHeight = asFloatNode(options.scaleHeight, 0.001);
    const top = asFloatNode(options.top, 0.01);
    const opticalScale = asFloatNode(options.opticalScale, 0.08);
    const scatterGain = asFloatNode(options.scatterGain, 0.5);
    const strength = asFloatNode(options.strength, 0.0);

    const groundAtmosphereTerms = Fn(([localPos]) => {
        const metricScale = max(
            metricScaleIn,
            vec3(float(1e-6), float(1e-6), float(1e-6))).toVar();
        const radiusPositive = radius.greaterThan(0.0);
        // The classic effect only evaluates inside radius > 0. The safe
        // divisor below only feeds the branch the final select discards.
        const safeRadius = select(radiusPositive, radius, float(1.0));
        const cameraPoint = Camera.mul(metricScale).div(safeRadius).toVar();
        const surfacePoint = localPos.mul(metricScale).div(safeRadius).toVar();
        const cameraRay = cameraPoint.sub(surfacePoint).toVar();
        const rayLength = length(cameraRay).toVar();
        const rayUsable = rayLength.greaterThan(float(1e-6));
        const safeRayLength = select(rayUsable, rayLength, float(1.0));
        const rayDirection = cameraRay.div(safeRayLength).toVar();
        const sunDirection = normalize(sun.mul(metricScale)).toVar();
        const safeScaleHeight = max(scaleHeight, float(1e-6)).toVar();

        let column = float(0.0);
        let litColumn = float(0.0);
        for (let sampleIndex = 0; sampleIndex < GROUND_ATMOSPHERE_SAMPLES; sampleIndex++) {
            const f = float((sampleIndex + 0.5) / GROUND_ATMOSPHERE_SAMPLES);
            const samplePoint = mix(surfacePoint, cameraPoint, f);
            const altitude = length(samplePoint).sub(1.0);
            const density = exp(max(altitude, float(0.0)).div(safeScaleHeight).mul(-1.0));
            const edge = float(1.0).sub(
                smoothstep(top.mul(0.72), top, altitude));
            const columnStep = density.mul(edge)
                .mul(rayLength.div(float(GROUND_ATMOSPHERE_SAMPLES)))
                .div(safeScaleHeight);
            const sunMu = dot(normalize(samplePoint), sunDirection);
            const sunLit = smoothstep(float(-0.08), float(0.18), sunMu);
            const included = altitude.lessThanEqual(top);
            column = column.add(select(included, columnStep, float(0.0)));
            litColumn = litColumn.add(
                select(included, columnStep.mul(sunLit), float(0.0)));
        }

        const opticalDepth = min(column.mul(opticalScale), float(8.0));
        const transmittance = exp(opticalDepth.mul(-1.0));
        const daylight = litColumn.div(max(column, float(1e-6)));
        const phase = float(0.65).add(float(0.35).mul(
            pow(max(dot(rayDirection, sunDirection), float(0.0)), float(2.0))));
        const hazeAmount = clamp(
            float(1.0).sub(transmittance).mul(daylight).mul(phase).mul(scatterGain),
            float(0.0), float(0.72));
        const active = strength.greaterThan(float(0.001))
            .and(radiusPositive)
            .and(rayUsable);

        return GroundAtmosphereTerms({
            attenuation: select(
                active,
                mix(float(1.0), transmittance, strength),
                float(1.0)),
            haze: select(
                active,
                color.mul(hazeAmount).mul(strength),
                vec3(0.0, 0.0, 0.0))
        });
    });

    // The classic patch multiplies direct/indirect diffuse and specular
    // plus emissive by the one attenuation and adds the haze once, so on a
    // summed lit colour it is exactly lit * attenuation + haze.
    const groundAtmosphereApply = Fn(([localPos, lit]) => {
        const terms = groundAtmosphereTerms(localPos);
        return lit.mul(member(terms, "attenuation"))
            .add(member(terms, "haze"));
    });

    return { groundAtmosphereTerms, groundAtmosphereApply, GroundAtmosphereTerms };
}

// P5c3: the regional storm glow. Production keeps four flash slots for a
// gas giant: each slot is a unit local centre direction with a small
// angular scale in w, and a JS-side power envelope. The shader adds an
// emissive term per active slot — a tight exponential core whose falloff is
// wobbled by a high-frequency sine product, plus a wider diffusion halo —
// gated to the night side. The slot count is fixed, so the accumulation is
// unrolled with the production `power > 0.001` guard as a select (the
// pattern proved at P5c1/P5c2). Region placement, event timing and the
// power envelopes stay in the classic PlanetDetail JS; this module returns
// only the emissive colour the classic patch adds.

export const REGIONAL_STORM_MAX_EVENTS = 4;

export function createRegionalStormGlow(options = {}) {
    const centersIn = options.centers || [];
    const powersIn = options.powers || [];
    if (centersIn.length > REGIONAL_STORM_MAX_EVENTS || powersIn.length > REGIONAL_STORM_MAX_EVENTS) {
        throw new Error("Increase the regional storm event limit before expanding this catalogue.");
    }
    // Inactive slots carry production's own defaults: centre +Y, scale
    // 0.007, power 0.
    const centers = [];
    const powers = [];
    for (let i = 0; i < REGIONAL_STORM_MAX_EVENTS; i++) {
        centers.push(asVec4Node(centersIn[i], [0.0, 1.0, 0.0, 0.007]));
        powers.push(asFloatNode(powersIn[i], 0.0));
    }
    const sun = asVec3Node(options.sun, [1.0, 0.0, 0.0]);
    const tint = asVec3Node(options.tint, [0.83, 0.87, 1.0]);
    const diffusion = asFloatNode(options.diffusion, 0.34);

    const regionalStormGlow = Fn(([localPos]) => {
        const n = normalize(localPos).toVar();
        let illumination = float(0.0);
        for (let i = 0; i < REGIONAL_STORM_MAX_EVENTS; i++) {
            const center = centers[i];
            const delta = n.sub(center.xyz);
            const d = dot(delta, delta).div(center.w.mul(center.w));
            const irregular = float(0.78).add(
                float(0.24)
                    .mul(sin(n.x.mul(1800.0).add(n.y.mul(970.0))))
                    .mul(sin(n.z.mul(1400.0))));
            const contribution = powers[i].mul(
                exp(d.mul(irregular).mul(-2.5)).mul(3.5)
                    .add(diffusion.mul(exp(d.mul(-0.48)))));
            illumination = illumination.add(
                select(powers[i].greaterThan(float(0.001)), contribution, float(0.0)));
        }
        const night = float(1.0).sub(
            smoothstep(float(-0.15), float(0.06), dot(n, sun)));
        return tint.mul(illumination).mul(night);
    });

    return { regionalStormGlow };
}

// P5c4: the shared Earth-detail sampling helpers. Both remaining classic
// Earth hooks (cloud shadow and cloud volume) address the cloud map from a
// body-local direction with the same two helpers: detailUV maps a direction
// to the equirectangular UV the classic patch uses, and detailCloudUV
// samples through the cloud map's own texture matrix with explicit
// screen-space gradients whose x components are wrapped by whole turns, so
// the fract() seam in detailUV does not produce a full-width derivative.
// The arithmetic below is the production helper text (shaderUV and
// cloudSampling in planet-detail.js) restated in TSL, constants included;
// the textureGrad form is the WebGL2 path production takes. The hooks that
// consume these samples are later submodules.

export function createDetailCloudSampler(options = {}) {
    const cloudTex = options.cloudMap?.isTexture
        ? texture(options.cloudMap) : options.cloudMap;
    const mapTransform = asMat3Node(options.mapTransform,
        [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]);

    const detailUV = Fn(([direction]) => {
        const n = normalize(direction).toVar();
        return vec2(
            fract(atan(n.z, n.x.negate()).div(6.28318530718)),
            float(1.0).sub(
                acos(clamp(n.y, float(-1.0), float(1.0))).div(3.14159265359)));
    });

    const detailCloudSample = Fn(([uvIn]) => {
        const detailUv = uvIn.toVar();
        const dxScreen = dFdx(detailUv).toVar();
        const dyScreen = dFdy(detailUv).toVar();
        // Production wraps only the x derivative components, by whole
        // turns, before the map transform is applied to point or gradient.
        const dx = vec2(
            dxScreen.x.sub(floor(dxScreen.x.add(0.5))), dxScreen.y).toVar();
        const dy = vec2(
            dyScreen.x.sub(floor(dyScreen.x.add(0.5))), dyScreen.y).toVar();
        const p = mapTransform.mul(vec3(detailUv, float(1.0))).xy;
        const gradX = mapTransform.mul(vec3(dx, float(0.0))).xy;
        const gradY = mapTransform.mul(vec3(dy, float(0.0))).xy;
        return cloudTex.sample(p).grad(gradX, gradY);
    });

    return { detailUV, detailCloudSample };
}

// P5c5: the Earth cloud-shadow hook. Production traces the sun ray from the
// surface point to the cloud shell (radius dCloudRatio in Earth radii),
// rotates the hit into cloud-map space, averages three sampler taps (the
// hit and two small longitude offsets), and scales the direct diffuse and
// specular terms by one factor
//   1 - (1 - exp(-density * 3.4)) * strength * smoothstep(0, 0.045, sunHeight)
// active only for strength > 0.001 and sunHeight > 0. This module returns
// exactly that factor, so a later node lighting binding can multiply the
// same two terms the classic patch multiplies. Sun, rotation, ratio and
// strength derivation remain the classic PlanetDetail JS.

export function createEarthCloudShadow(options = {}) {
    const sampler = options.sampler || createDetailCloudSampler(options);
    const cloudRotation = asMat3Node(options.cloudRotation,
        [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]);
    const sun = asVec3Node(options.sun, [1.0, 0.0, 0.0]);
    const cloudRatio = asFloatNode(options.cloudRatio, 1.001884);
    const shadowStrength = asFloatNode(options.shadowStrength, 0.0);

    const cloudShadowFactor = Fn(([localPos]) => {
        const sn = normalize(localPos).toVar();
        const sunHeight = dot(sn, sun).toVar();
        const rayDistance = sunHeight.negate().add(sqrt(max(
            sunHeight.mul(sunHeight)
                .add(cloudRatio.mul(cloudRatio))
                .sub(1.0),
            float(0.0)))).toVar();
        const hit = normalize(
            cloudRotation.mul(sn.add(sun.mul(rayDistance)))).toVar();
        const hitUv = sampler.detailUV(hit).toVar();
        const tapA = sampler.detailCloudSample(hitUv).rgb.toVar();
        const tapB = sampler.detailCloudSample(
            hitUv.add(vec2(0.00035, 0.0))).rgb.toVar();
        const tapC = sampler.detailCloudSample(
            hitUv.sub(vec2(0.00035, 0.0))).rgb.toVar();
        const density = dot(
            tapA.add(tapB).add(tapC).div(3.0),
            vec3(0.333333, 0.333333, 0.333333)).toVar();
        const shadow = float(1.0).sub(exp(density.mul(-3.4)))
            .mul(shadowStrength)
            .mul(smoothstep(float(0.0), float(0.045), sunHeight))
            .toVar();
        const active = shadowStrength.greaterThan(float(0.001))
            .and(sunHeight.greaterThan(float(0.0)));
        return select(active, float(1.0).sub(shadow), float(1.0));
    });

    return { cloudShadowFactor, sampler };
}

// P5c6: the Earth cloud-volume march (the map_fragment part of the
// cloud-volume hook; its lights_fragment_end post-effect is P5c7).
// Production marches up to six fixed steps through the cloud shell between
// the surface-scaled outer point and an inner shell at 10% of the shell
// thickness, reconstructing the in-shell path length for cameras outside
// (toward the planet) and inside (toward the eye), clamped to 0.20 radii.
// Each step samples the cloud map, takes the max channel as density under
// an altitude envelope, and accumulates optical depth and a grey
// (density-squared) sum. The diffuse colour becomes a frost mix by
// clamp(grey/optical) and the diffuse alpha is scaled by
// 1 - exp(-depth * 7.2). This module returns exactly those terms; the
// camera/ratio/steps derivation remains the classic PlanetDetail JS.

export const CLOUD_VOLUME_MAX_STEPS = 6;

export const CloudVolumeTerms = struct({
    diffuse: "vec3",
    alphaFactor: "float"
}, "CloudVolumeTerms");

export function createEarthCloudVolume(options = {}) {
    const sampler = options.sampler || createDetailCloudSampler(options);
    const localCamera = asVec3Node(options.localCamera, [0.0, 0.0, 0.0]);
    const cloudRatio = asFloatNode(options.cloudRatio, 1.001884);
    const cloudSteps = asFloatNode(options.cloudSteps, 6.0);

    const earthCloudVolumeTerms = Fn(([localPos]) => {
        const outer = normalize(localPos).mul(cloudRatio).toVar();
        const eyeVector = localCamera.sub(outer).toVar();
        const eyeDistance = length(eyeVector).toVar();
        const towardEye = normalize(eyeVector).toVar();
        const innerR = float(1.0).add(cloudRatio.sub(1.0).mul(0.10)).toVar();
        const b = dot(outer, towardEye).toVar();
        const disc = b.mul(b).sub(dot(outer, outer))
            .add(innerR.mul(innerR)).toVar();
        const root = sqrt(max(disc, float(0.0))).toVar();
        const cameraInside = length(localCamera).lessThan(cloudRatio);
        const discPositive = disc.greaterThan(float(0.0));
        const marchDirection = select(
            cameraInside, towardEye, towardEye.negate()).toVar();
        const insideDistance = select(discPositive,
            min(eyeDistance, max(b.negate().sub(root), float(0.0))),
            eyeDistance);
        const outsideDistance = select(discPositive,
            max(b.sub(root), float(0.0)),
            max(b, float(0.0)).mul(2.0));
        const distanceIn = clamp(
            select(cameraInside, insideDistance, outsideDistance),
            float(0.0), float(0.20)).toVar();
        const stepDivisor = max(cloudSteps, float(1.0)).toVar();
        const shellDenominator = max(
            cloudRatio.sub(innerR), float(0.00001)).toVar();

        let optical = float(0.0);
        let grey = float(0.0);
        for (let stepIndex = 0; stepIndex < CLOUD_VOLUME_MAX_STEPS; stepIndex++) {
            const pos = outer.add(marchDirection.mul(
                float(stepIndex + 0.5).mul(distanceIn).div(stepDivisor)));
            const altitude = length(pos).sub(innerR).div(shellDenominator);
            const envelope = smoothstep(float(0.0), float(0.18), altitude)
                .mul(float(1.0).sub(
                    smoothstep(float(0.80), float(1.0), altitude)));
            const sampleCloud = sampler.detailCloudSample(
                sampler.detailUV(pos)).rgb;
            const density = max(max(sampleCloud.r, sampleCloud.g), sampleCloud.b)
                .mul(envelope);
            const included = float(stepIndex).lessThan(cloudSteps);
            optical = optical.add(select(included, density, float(0.0)));
            grey = grey.add(select(
                included, density.mul(density), float(0.0)));
        }

        const depth = optical.mul(distanceIn)
            .div(stepDivisor.mul(shellDenominator)).toVar();
        const frostDensity = clamp(
            grey.div(max(optical, float(0.00001))),
            float(0.0), float(1.0)).toVar();
        return CloudVolumeTerms({
            diffuse: mix(
                vec3(0.72, 0.79, 0.89),
                vec3(1.0, 1.04, 1.10),
                frostDensity),
            alphaFactor: float(1.0).sub(exp(depth.mul(-7.2)))
        });
    });

    // Production replaces diffuseColor.rgb with the frost mix and scales
    // diffuseColor.a by the alpha factor; on a vec4 that is exactly this.
    const earthCloudVolumeApply = Fn(([localPos, diffuseColor]) => {
        const terms = earthCloudVolumeTerms(localPos);
        return vec4(
            member(terms, "diffuse"),
            diffuseColor.a.mul(member(terms, "alphaFactor")));
    });

    return { earthCloudVolumeTerms, earthCloudVolumeApply, CloudVolumeTerms, sampler };
}

// P5c7: the cloud-volume lighting post-effect (the lights_fragment_end
// part of the cloud-volume hook). Production adds two terms to indirect
// diffuse, both scaled by the diffuse alpha the march (P5c6) produced: a
// frost scatter (constant + rim + back-scatter + sun fill), and — only for
// cameras below the cloud shell — an underside fill gated by a sampler tap
// at the surface direction. This module returns the one additive indirect
// term; it takes the post-march diffuse alpha as an argument, exactly as
// the classic patch reads diffuseColor.a at that point in the shader.

export function createEarthCloudVolumeLighting(options = {}) {
    const sampler = options.sampler || createDetailCloudSampler(options);
    const localCamera = asVec3Node(options.localCamera, [0.0, 0.0, 0.0]);
    const sun = asVec3Node(options.sun, [1.0, 0.0, 0.0]);
    const cloudRatio = asFloatNode(options.cloudRatio, 1.001884);

    const cloudVolumeIndirect = Fn(([localPos, diffuseAlpha]) => {
        const cloudNormal = normalize(localPos).toVar();
        const viewDirection = normalize(localCamera.sub(localPos)).toVar();
        const sunDirection = normalize(sun).toVar();
        const sunMu = dot(cloudNormal, sunDirection).toVar();
        const viewMu = max(dot(cloudNormal, viewDirection), float(0.0)).toVar();
        const rimScatter = pow(float(1.0).sub(viewMu), float(1.6)).toVar();
        const backScatter = pow(
            max(dot(sunDirection.negate(), viewDirection), float(0.0)),
            float(2.0)).toVar();
        const sunFill = smoothstep(float(-0.10), float(0.38), sunMu).toVar();
        const frostScatter = diffuseAlpha.mul(
            float(0.018)
                .add(rimScatter.mul(0.09))
                .add(backScatter.mul(0.09))
                .add(sunFill.mul(0.035))).toVar();

        const cloudSample = sampler.detailCloudSample(
            sampler.detailUV(cloudNormal)).rgb.toVar();
        const cloudDensity = max(
            max(cloudSample.r, cloudSample.g), cloudSample.b).toVar();
        const cloudMask = smoothstep(
            float(0.20), float(0.58), cloudDensity).toVar();
        const undersideFill = mix(
            float(0.08), float(0.52),
            smoothstep(float(-0.06), float(0.24), sunMu))
            .mul(cloudMask).mul(diffuseAlpha).toVar();
        const belowShell = length(localCamera).lessThan(cloudRatio);

        return vec3(0.52, 0.62, 0.78).mul(frostScatter).add(select(
            belowShell,
            vec3(0.50, 0.60, 0.76).mul(undersideFill),
            vec3(0.0, 0.0, 0.0)));
    });

    return { cloudVolumeIndirect, sampler };
}
