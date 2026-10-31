import {
    Fn,
    abs,
    clamp,
    clipSpace,
    cross,
    dot,
    float,
    length,
    mat3,
    max,
    normalize,
    positionGeometry,
    select,
    sqrt,
    struct,
    uniform,
    vec2,
    vec3,
    vec4
} from "three/tsl";
import { AtmRay } from "./atm-sampling.tsl.js";

// TSL counterpart of the shader functions in
// planet-atmosphere-composite.glsl.js.
//
// This is the same composite in node form, not a second atmosphere model:
// the surface point is still solved on the table's ground sphere, the
// ground radiance is still multiplied by the segment transmittance, and
// the air term is still scaled by the same solar irradiance as the ground.
// The sky side still reconstructs the pixel ray from its clip position and
// calls the sampling library's sky ray. A factory closes over the dynamic
// eye, sun, scale and view-frame nodes that are uniforms in the GLSL form.
// tools/p4atmcomposite.mjs renders the GLSL and TSL forms against the same
// Earth table on both node backends.

export const ATM_HORIZON_EPS = 1e-3;

export const AtmCompositeTerms = struct({
    air: "vec3",
    attenuation: "vec3"
}, "AtmCompositeTerms");

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? float(value) : value;
}

function asVec2Node(value, fallback) {
    if (value === undefined) return vec2(fallback[0], fallback[1]);
    if (Array.isArray(value)) return vec2(value[0], value[1]);
    if (value?.isVector2) return uniform(value);
    if (value && typeof value.x === "number" && typeof value.y === "number" && !value.isNode) {
        return vec2(value.x, value.y);
    }
    return value;
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

function asMat3Node(value) {
    if (value === undefined) {
        return mat3(
            vec3(1.0, 0.0, 0.0),
            vec3(0.0, 1.0, 0.0),
            vec3(0.0, 0.0, 1.0)
        );
    }
    if (Array.isArray(value) && value.length === 9) {
        return mat3(
            vec3(value[0], value[1], value[2]),
            vec3(value[3], value[4], value[5]),
            vec3(value[6], value[7], value[8])
        );
    }
    if (value?.isMatrix3) return uniform(value);
    return value;
}

function member(node, name) {
    return typeof node.get === "function" ? node.get(name) : node[name];
}

// Where the eye ray through a raster point meets the table's ground sphere.
// The rationalised root is kept exactly as in the GLSL form: it avoids the
// float32 cancellation in the ordinary sphere quadratic at planetary scales.
export const atmSurfacePoint = Fn(([rasterKm, eyeKm, groundKm]) => {
    const dir = normalize(rasterKm.sub(eyeKm)).toVar();
    const eyeR = max(length(eyeKm), float(1e-6)).toVar();
    const cosA = clamp(
        dot(dir, eyeKm).mul(-1.0).div(eyeR),
        float(-1.0),
        float(1.0)
    ).toVar();
    const perp = sqrt(max(
        groundKm.mul(groundKm)
            .sub(eyeR.mul(eyeR).mul(float(1.0).sub(cosA.mul(cosA)))),
        float(0.0)
    )).toVar();
    const s = eyeR.mul(eyeR)
        .sub(groundKm.mul(groundKm))
        .div(max(eyeR.mul(cosA).add(perp), float(1e-6)))
        .toVar();
    return eyeKm.add(dir.mul(s));
});

export function createAtmComposite(options = {}) {
    const sampling = options.sampling;
    if (!sampling) throw new Error("createAtmComposite requires a sampling factory result");

    const sunIrradiance = asVec3Node(options.sunIrradiance, [1.0, 1.0, 1.0]);
    const eyeLocalKm = asVec3Node(options.eyeLocalKm, [0.0, 0.0, 0.0]);
    const sunDirLocal = asVec3Node(options.sunDirLocal, [1.0, 0.0, 0.0]);
    const kmPerUnit = asFloatNode(options.kmPerUnit, 1.0);
    const rayScale = asVec2Node(options.rayScale, [1.0, 1.0]);
    const viewToLocal = asMat3Node(options.viewToLocal);
    const debugMode = asFloatNode(options.debugMode, 0.0);
    const skyDebug = asFloatNode(options.skyDebug, 0.0);
    const horizonEps = float(ATM_HORIZON_EPS);

    const atmCompositeTerms = Fn(([fragKm, eyeKm, sunDir]) => {
        const toEye = eyeKm.sub(fragKm).toVar();
        const dist = max(length(toEye), float(1e-6)).toVar();
        const view = toEye.mul(-1.0).div(dist).toVar();
        const eyeR = max(length(eyeKm), float(1e-6)).toVar();
        const fragR = max(length(fragKm), float(1e-6)).toVar();
        const eyeMu = dot(eyeKm, view).div(eyeR).toVar();
        const fragMu = dot(fragKm, view).div(fragR).toVar();

        const rgOverR = sampling.radii.x.div(eyeR).toVar();
        const horizonMu = sqrt(max(
            float(1.0).sub(rgOverR.mul(rgOverR)),
            float(0.0)
        )).mul(-1.0).toVar();

        const ray = AtmRay({
            eyePos: eyeKm,
            eyeR,
            eyeMu,
            viewDir: view,
            viewLen: dist,
            fragPos: fragKm,
            fragR,
            fragMu
        });

        const attenuation = sampling
            .atmTransmittanceSegment(eyeR, eyeMu, fragR, fragMu)
            .toVar();
        const air = select(
            abs(eyeMu.sub(horizonMu)).lessThan(horizonEps),
            sampling.atmInscatterGroundFix(ray, sunDir, attenuation, horizonEps),
            sampling.atmInscatterGround(ray, sunDir, attenuation)
        ).toVar();

        return AtmCompositeTerms({ air, attenuation });
    });

    const atmCompositeSurface = Fn(([fragKm, eyeKm, sunDir, ground]) => {
        const terms = atmCompositeTerms(fragKm, eyeKm, sunDir);
        return ground.mul(member(terms, "attenuation"))
            .add(member(terms, "air").mul(sunIrradiance));
    });

    function compositeGeometry(localPos) {
        const eyeKm = sampling.atmToTable(eyeLocalKm)
            .toVar();
        const sunKm = normalize(sampling.atmToTable(sunDirLocal))
            .toVar();
        const rasterKm = sampling.atmToTable(localPos.mul(kmPerUnit))
            .toVar();
        const fragKm = atmSurfacePoint(rasterKm, eyeKm, sampling.radii.x)
            .toVar();
        return { eyeKm, sunKm, rasterKm, fragKm };
    }

    // The production injection path before its debug switch: a body-local
    // raster position and already-lit ground colour go in, composited
    // surface radiance comes out.
    const atmCompositeLocalSurface = Fn(([localPos, ground]) => {
        const geometry = compositeGeometry(localPos);
        return atmCompositeSurface(
            geometry.fragKm,
            geometry.eyeKm,
            geometry.sunKm,
            ground
        );
    });

    // The same path, including the GLSL injection's probe outputs. Mode 0
    // preserves the incoming alpha exactly as the GLSL replacement of
    // gl_FragColor.rgb does.
    const atmCompositeLocalOutput = Fn(([localPos, ground]) => {
        const geometry = compositeGeometry(localPos);
        const terms = atmCompositeTerms(
            geometry.fragKm,
            geometry.eyeKm,
            geometry.sunKm
        );
        const air = member(terms, "air");
        const attenuation = member(terms, "attenuation");

        const composited = vec4(
            ground.rgb.mul(attenuation).add(air.mul(sunIrradiance)),
            ground.a
        );

        let debug = vec4(
            length(localPos),
            kmPerUnit.mul(0.001),
            sampling.radii.x.mul(0.001),
            1.0
        );
        debug = select(
            debugMode.lessThan(5.5),
            vec4(geometry.eyeKm.mul(0.001), 1.0),
            debug
        );
        debug = select(
            debugMode.lessThan(4.5),
            vec4(geometry.rasterKm.mul(0.001), 1.0),
            debug
        );
        debug = select(
            debugMode.lessThan(3.5),
            vec4(geometry.fragKm.mul(0.001), 1.0),
            debug
        );
        debug = select(
            debugMode.lessThan(2.5),
            vec4(attenuation, 1.0),
            debug
        );
        debug = select(
            debugMode.lessThan(1.5),
            vec4(air, attenuation.r),
            debug
        );

        return select(debugMode.lessThan(0.5), composited, debug);
    });

    function skyGeometry(clip) {
        const eyeKm = sampling.atmToTable(eyeLocalKm)
            .toVar();
        const ndc = clip.xy.div(clip.w).toVar();
        const dirView = normalize(vec3(
            ndc.x.mul(rayScale.x),
            ndc.y.mul(rayScale.y),
            -1.0
        )).toVar();
        const dir = normalize(sampling.atmToTable(viewToLocal.mul(dirView)))
            .toVar();
        const ray = sampling.atmSkyRay(eyeKm, dir);
        return { eyeKm, dir, ray };
    }

    const atmSkyRayFromClip = Fn(([clip]) => {
        return skyGeometry(clip).ray;
    });

    const atmSkyColor = Fn(([clip]) => {
        const geometry = skyGeometry(clip);
        const sunKm = normalize(sampling.atmToTable(sunDirLocal));
        return sampling.atmInscatterSky(geometry.ray, sunKm)
            .mul(sunIrradiance);
    });

    const atmSkyOutput = Fn(([clip]) => {
        const geometry = skyGeometry(clip);
        const sunKm = normalize(sampling.atmToTable(sunDirLocal));
        const color = sampling.atmInscatterSky(geometry.ray, sunKm)
            .mul(sunIrradiance);
        const debug = vec4(
            member(geometry.ray, "eyeMu"),
            length(cross(geometry.eyeKm, geometry.dir)).mul(0.001),
            member(geometry.ray, "eyeR").mul(0.001),
            1.0
        );
        return select(
            skyDebug.greaterThan(0.5),
            debug,
            vec4(color, 1.0)
        );
    });

    // Material-ready forms. Callers may supply another local-position or
    // clip node, but the defaults are the nodes corresponding to the GLSL
    // attributes and varyings: position for the surface, clip position for
    // the sky.
    const atmCompositeColorNode = (ground, localPos = positionGeometry) => {
        return atmCompositeLocalSurface(localPos, ground.rgb || ground);
    };
    const atmCompositeOutputNode = (ground, localPos = positionGeometry) => {
        return atmCompositeLocalOutput(localPos, ground);
    };
    const atmSkyColorNode = (clip = clipSpace) => atmSkyColor(clip);
    const atmSkyOutputNode = (clip = clipSpace) => atmSkyOutput(clip);

    return {
        sampling,
        sunIrradiance,
        eyeLocalKm,
        sunDirLocal,
        kmPerUnit,
        rayScale,
        viewToLocal,
        debugMode,
        skyDebug,
        atmSurfacePoint,
        atmCompositeTerms,
        atmCompositeSurface,
        atmCompositeLocalSurface,
        atmCompositeLocalOutput,
        atmSkyRayFromClip,
        atmSkyColor,
        atmSkyOutput,
        atmCompositeColorNode,
        atmCompositeOutputNode,
        atmSkyColorNode,
        atmSkyOutputNode
    };
}

// Installer-side derivation counterpart of installAtmComposite and
// installAtmSky in planet-atmosphere-composite.glsl.js.
//
// Everything shader-shaped in that module already lives above; what the
// classic installers still own is arithmetic over plain values: the
// table-kilometres-per-unit conversion (the scene scale times the ratio
// between the table's ground radius and the drawn one, because the giant
// tables are baked at reduced scale), the polar stretch that turns the
// drawn ellipsoid into the table's sphere, the sky shell radius, the
// per-frame binding defaults, and the sky material/mesh parameters. The
// functions below derive exactly those values with exactly the production
// guards (a null return where production returns null), so the flip can
// build node materials from them without re-deriving anything. Geometry
// and material construction stay with the caller, as does the sequential
// table loading in startAtmAtmospheres, which is app lifecycle, not
// derivation. tools/p5atminstall.mjs runs the production installers and
// these derivations side by side on the same inputs.
export function deriveAtmCompositeInstall(options = {}) {
    const header = options.header;
    if (!header) return null;
    const kmPerUnit = options.kmPerUnit;
    if (!(kmPerUnit > 0)) return null;
    const radiusUnits = options.radiusUnits;
    if (!(radiusUnits > 0)) return null;
    const drawnGroundKm = radiusUnits * kmPerUnit;
    const tableScale = header.groundRadiusKm / drawnGroundKm;
    const axesKm = options.referenceAxesKm;
    const polarStretch = axesKm && axesKm[2] > 0 ? axesKm[0] / axesKm[2] : 1;
    return {
        tableScale,
        polarStretch,
        kmPerUnit: kmPerUnit * tableScale,
        axisScale: [1, polarStretch, 1],
        enabled: options.enabled === false ? 0 : 1
    };
}

export function deriveAtmSkyShellRadius(options = {}) {
    const header = options.header;
    if (!header) return null;
    const radiusUnits = options.radiusUnits;
    const groundKm = header.groundRadiusKm;
    const topKm = header.topRadiusKm;
    if (!(radiusUnits > 0) || !(topKm > groundKm)) return null;
    return radiusUnits * (topKm / groundKm);
}

// The sky material parameters, as plain values: opaque (the ground mesh
// refused these pixels at the silhouette, so nothing blends), depth
// tested and written (the depth buffer, not an analytic test, decides
// which pixels are sky), double-sided (side 2 is THREE.DoubleSide; the
// enum value is data here because this module imports nodes, not the
// renderer build), untonemapped and unfogged like the classic material.
export const ATM_SKY_MATERIAL_PARAMETERS = {
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: 2,
    toneMapped: false,
    fog: false
};

// The sky mesh parameters: drawn after the body, named after it, and
// invisible to picking (the classic mesh stubs raycast out; that stays a
// caller action, recorded here so it is not lost).
export const ATM_SKY_MESH_PARAMETERS = {
    renderOrder: 1,
    nameSuffix: " air",
    isAtmSky: true,
    raycastDisabled: true
};

// One call that assembles everything the two production installers
// derive: the sampling options (axis scale), the composite options
// (converted km-per-unit plus the production binding defaults — eye at
// the origin, sun along +x, unit irradiance, unit ray scale, debug
// modes off — with caller-supplied live values passed through), the
// enable flag, and the sky shell/material/mesh parameters. Returns
// null exactly when the composite installer would.
export function createAtmCompositeInstall(options = {}) {
    const derived = deriveAtmCompositeInstall(options);
    if (!derived) return null;
    return {
        derived,
        shellRadius: deriveAtmSkyShellRadius(options),
        samplingOptions: {
            axisScale: derived.axisScale
        },
        compositeOptions: {
            kmPerUnit: derived.kmPerUnit,
            eyeLocalKm: options.eyeLocalKm !== undefined ? options.eyeLocalKm : [0.0, 0.0, 0.0],
            sunDirLocal: options.sunDirLocal !== undefined ? options.sunDirLocal : [1.0, 0.0, 0.0],
            sunIrradiance: options.sunIrradiance !== undefined ? options.sunIrradiance : [1.0, 1.0, 1.0],
            rayScale: options.rayScale !== undefined ? options.rayScale : [1.0, 1.0],
            viewToLocal: options.viewToLocal,
            debugMode: options.debugMode !== undefined ? options.debugMode : 0.0,
            skyDebug: options.skyDebug !== undefined ? options.skyDebug : 0.0
        },
        enabled: derived.enabled,
        skyMaterialParameters: ATM_SKY_MATERIAL_PARAMETERS,
        skyMeshParameters: ATM_SKY_MESH_PARAMETERS
    };
}
