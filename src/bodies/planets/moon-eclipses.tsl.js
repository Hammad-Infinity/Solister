import {
    Fn,
    abs,
    acos,
    asin,
    atan,
    clamp,
    cross,
    dot,
    float,
    length,
    max,
    min,
    positionView,
    select,
    sqrt,
    struct,
    uniform,
    vec4
} from "three/tsl";

// TSL counterpart of the satellite-Eclipse visibility arithmetic in
// moon-eclipses.js.
//
// Production evaluates this in view space: the shaded point, Sun centre and
// up to eight Moon caster centres are all view positions, with radii carried
// in the w component beside the Sun and caster positions. Keep those exact
// semantics here, including the production early-outs (invalid radii, caster
// not between the point and the Sun, and the finite-Sun cone test) before the
// disc-overlap area. This module is the shader arithmetic only; the
// production MoonEclipses class still owns catalogue grouping, per-frame
// view-space uniform updates and the classic material patch until the body
// materials themselves are node materials.

export const SATELLITE_ECLIPSE_MAX_CASTERS = 8;

export const satelliteDiscVisibility = Fn(([p, sunView, caster]) => {
    const sunRadius = sunView.w;
    const moonRadius = caster.w;
    const toSun = sunView.xyz.sub(p);
    const toMoon = caster.xyz.sub(p);
    const ds = length(toSun);
    const dm = length(toMoon);

    const invalid = sunRadius.lessThanEqual(0.0)
        .or(moonRadius.lessThanEqual(0.0))
        .or(ds.lessThanEqual(sunRadius))
        .or(dm.lessThanEqual(moonRadius))
        .or(dm.greaterThanEqual(ds));

    const s = toSun.div(ds);
    const behind = dot(toMoon, s).lessThanEqual(0.0);
    const coneRadius = moonRadius.add(
        dm.mul(sunRadius).div(max(ds.sub(sunRadius), float(1e-8))));
    const outsideCone = length(cross(toMoon, s)).greaterThan(coneRadius);

    const m = toMoon.div(dm);
    const separation = atan(length(cross(s, m)), dot(s, m));
    const rs = asin(clamp(sunRadius.div(ds), float(0.0), float(1.0)));
    const rm = asin(clamp(moonRadius.div(dm), float(0.0), float(1.0)));
    const rsSafe = max(rs, float(1e-8));
    const d = separation.div(rsSafe);
    const r = rm.div(rsSafe);

    const noOverlap = d.greaterThanEqual(r.add(1.0));
    const contained = d.lessThanEqual(abs(float(1.0).sub(r)));
    const containedValue = float(1.0).sub(min(float(1.0), r.mul(r)));

    const d2 = d.mul(d);
    const r2 = r.mul(r);
    const a = acos(clamp(
        d2.add(1.0).sub(r2).div(d.mul(2.0)), float(-1.0), float(1.0)));
    const b = acos(clamp(
        d2.add(r2).sub(1.0).div(d.mul(r).mul(2.0)), float(-1.0), float(1.0)));
    const product = float(1.0).add(r).sub(d)
        .mul(d.add(1.0).sub(r))
        .mul(d.add(r).sub(1.0))
        .mul(d.add(r).add(1.0));
    const overlap = a.add(r2.mul(b))
        .sub(sqrt(max(product, float(0.0))).mul(0.5));
    const partial = clamp(
        float(1.0).sub(overlap.div(float(3.141592653589793))),
        float(0.0), float(1.0));

    return select(
        invalid.or(behind).or(outsideCone),
        float(1.0),
        select(noOverlap, float(1.0),
            select(contained, containedValue, partial)));
});

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? float(value) : value;
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

// Multiply the active casters' visibilities, mirroring the production loop:
// casters at or beyond casterCount contribute exactly 1, and an enabled value
// below 0.5 disables the whole effect. casterCount is a float node here; the
// production counts are small integers, which a float carries exactly.
export function satelliteSunVisibility(
    p,
    sunView,
    casters = [],
    casterCount = float(0.0),
    enabled = float(1.0)
) {
    if (casters.length > SATELLITE_ECLIPSE_MAX_CASTERS) {
        throw new Error("Increase the satellite Eclipse caster limit before expanding this catalogue.");
    }
    let visibility = float(1.0);
    for (let i = 0; i < SATELLITE_ECLIPSE_MAX_CASTERS; i++) {
        const caster = casters[i] || vec4(0.0, 0.0, 0.0, 0.0);
        const factor = satelliteDiscVisibility(p, sunView, caster);
        visibility = visibility.mul(
            select(float(i).lessThan(casterCount), factor, float(1.0)));
    }
    return select(enabled.lessThan(float(0.5)), float(1.0), visibility);
}

// P5c8: the installer's shader-side application. Production's classic patch
// (a) carries the receiver's view position from the vertex stage as
// (modelViewMatrix * vec4(transformed, 1.0)).xyz — in node materials that is
// the built-in positionView varying — and (b) after the lighting
// accumulation multiplies direct diffuse and direct specular by the
// visibility, plus total emissive radiance when installed on Saturn's ring
// (a compile-time choice baked into the patched string). This factory
// returns exactly those scaled terms; the ring choice is the same kind of
// build-time choice here (affectEmissive). Catalogue grouping and the
// per-frame view-space uniform updates remain the classic MoonEclipses JS.

export const SatelliteEclipseLight = struct({
    directDiffuse: "vec3",
    directSpecular: "vec3",
    emissive: "vec3"
}, "SatelliteEclipseLight");

export function createSatelliteEclipse(options = {}) {
    const sunView = asVec4Node(options.sunView, [0.0, 0.0, 0.0, 0.0]);
    const castersIn = options.casters || [];
    if (castersIn.length > SATELLITE_ECLIPSE_MAX_CASTERS) {
        throw new Error("Increase the satellite Eclipse caster limit before expanding this catalogue.");
    }
    const casters = castersIn.map(
        caster => asVec4Node(caster, [0.0, 0.0, 0.0, 0.0]));
    const casterCount = asFloatNode(options.casterCount, casters.length);
    const enabled = asFloatNode(options.enabled, 1.0);
    const affectEmissive = options.affectEmissive === true;

    const satelliteEclipseVisibility = Fn(([viewPosition]) => {
        return satelliteSunVisibility(
            viewPosition, sunView, casters, casterCount, enabled);
    });

    const satelliteEclipseApply = Fn(
        ([viewPosition, directDiffuse, directSpecular, emissive]) => {
            const visibility = satelliteEclipseVisibility(
                viewPosition).toVar();
            return SatelliteEclipseLight({
                directDiffuse: directDiffuse.mul(visibility),
                directSpecular: directSpecular.mul(visibility),
                emissive: affectEmissive
                    ? emissive.mul(visibility) : emissive
            });
        });

    // The production-shaped entry: the receiver is the fragment's own view
    // position, as the classic patch's vertex varying carries it.
    const satelliteEclipseApplyAtPositionView = Fn(
        ([directDiffuse, directSpecular, emissive]) => {
            return satelliteEclipseApply(
                positionView, directDiffuse, directSpecular, emissive);
        });

    return {
        satelliteEclipseVisibility,
        satelliteEclipseApply,
        satelliteEclipseApplyAtPositionView,
        SatelliteEclipseLight
    };
}
