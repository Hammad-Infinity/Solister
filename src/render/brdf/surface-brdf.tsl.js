// Node-side counterpart of surface-brdf.js.
//
// The classic file contains no shader code at all: it is a
// per-body table of measured surface constants (index of
// refraction, roughness) plus applySurfaceBrdf, which writes
// them onto three's physical material properties
// (roughness/metalness, and ior with unit specular intensity
// and white specular colour -- or, for materials without an
// ior, a hand-scaled specular intensity/colour from the
// dielectric F0). Node materials expose the same properties,
// so the counterpart is the decision layer only: the two
// pure helpers, an install derivation mirroring
// applySurfaceBrdf's writes branch for branch, and a small
// applier that performs a derived install on any
// material-like object. The SURFACE_BRDF table itself stays
// plain JavaScript data owned by the classic file until the
// flip (the derivation takes it as an input and performs the
// same `table[key] || defaultSurface` lookup production
// does). The classic file remains the production owner
// until the flip.
// tools/p5surfacebrdf.mjs proves the half (real
// applySurfaceBrdf on stub and real materials; lit-sphere
// frames showing node materials answer the derived
// properties identically).

export function dielectricF0(ior) {
    const n = Number.isFinite(ior) ? ior : 1.5;
    const r = (1 - n) / (1 + n);
    return r * r;
}

export function glossinessToRoughness(glossiness) {
    const g = Math.max(0, Math.min(1, Number.isFinite(glossiness) ? glossiness : 0));
    const specularPower = Math.pow(2, 10 * g + 1);
    return Math.max(0.02, Math.min(1, 1 / Math.sqrt(specularPower)));
}

// three's default dielectric F0 (the divisor of the
// hand-scaled branch in production).
export const THREE_SPECULAR_DEFAULT_F0 = 0.04;

// Installer derivation counterpart: what applySurfaceBrdf
// writes, from plain values -- the table lookup against the
// default surface, the roughness resolution (table value, or
// glossiness conversion when the entry has no finite
// roughness; no current table entry exercises that path) and
// its [0.02, 1] clamp, and the capability branching on the
// target material. `hasSpecularIntensity` without `hasIor`
// selects the hand-scaled branch; no current three material
// takes it (physical materials have both, everything else
// neither), so it is mirrored defensively, as written.
// `colorAvailable` mirrors production's `THREE && THREE.Color`
// guard. Returns { applied: false } exactly where production
// returns false on values (falsy key); a missing material is
// caller state, not a value. Colour writes are recorded as
// [r, g, b] triples (production constructs THREE.Color from
// the same components); fields production does not write are
// absent, not undefined.
export function deriveSurfaceBrdfInstall(options = {}) {
    const key = options.key;
    if (!key) return { applied: false };

    const table = options.table || {};
    const surface = table[key] || options.defaultSurface;
    const f0 = dielectricF0(surface.ior);
    const resolvedRoughness = Number.isFinite(surface.roughness)
        ? surface.roughness
        : glossinessToRoughness(surface.glossiness);
    const roughness = Math.max(0.02, Math.min(1, resolvedRoughness));

    const install = {
        applied: true,
        roughness,
        metalness: 0
    };
    if (options.hasIor) {
        install.ior = surface.ior;
        if (options.hasSpecularIntensity) install.specularIntensity = 1;
        if (options.colorAvailable && options.hasSpecularColor) {
            install.specularColor = [1, 1, 1];
        }
    } else if (options.hasSpecularIntensity) {
        install.specularIntensity = Math.max(0, f0 / THREE_SPECULAR_DEFAULT_F0);
        if (options.colorAvailable && options.hasSpecularColor) {
            install.specularColor = [f0, f0, f0];
        }
    }
    install.userData = {
        key,
        ior: surface.ior,
        f0,
        roughness,
        note: surface.note
    };
    return install;
}

// Performs a derived install on a material-like object,
// writing exactly the fields the derivation recorded (the
// flip-time replacement for applySurfaceBrdf's write half).
// specularColor is replaced with a fresh colour, as
// production does; ColorCtor is the caller's THREE.Color
// (the derivation's colorAvailable flag must have been set
// from the same availability). Returns the applied flag.
export function applyDerivedSurfaceBrdf(material, install, ColorCtor) {
    if (!material || !install || install.applied !== true) return false;
    material.roughness = install.roughness;
    material.metalness = install.metalness;
    if ("ior" in install) material.ior = install.ior;
    if ("specularIntensity" in install) material.specularIntensity = install.specularIntensity;
    if ("specularColor" in install && ColorCtor) {
        material.specularColor = new ColorCtor(...install.specularColor);
    }
    material.userData.surfaceBrdf = { ...install.userData };
    return true;
}

// The isSurfaceBrdfManaged counterpart (pure predicate).
export function isSurfaceBrdfManaged(material) {
    return !!(material && material.userData && material.userData.surfaceBrdf);
}
