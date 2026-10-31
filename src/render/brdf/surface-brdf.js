

function dielectricF0(ior) {
    const n = Number.isFinite(ior) ? ior : 1.5;
    const r = (1 - n) / (1 + n);
    return r * r;
}

function glossinessToRoughness(glossiness) {
    const g = Math.max(0, Math.min(1, Number.isFinite(glossiness) ? glossiness : 0));
    const specularPower = Math.pow(2, 10 * g + 1);
    return Math.max(0.02, Math.min(1, 1 / Math.sqrt(specularPower)));
}

const SURFACE_BRDF = Object.freeze({

    mercury: Object.freeze({ ior: 1.62, roughness: 0.95, note: "space-weathered silicate regolith" }),

    venus: Object.freeze({ ior: 1.43, roughness: 0.93, note: "sulfuric acid cloud deck, disc-integrated" }),

    earth: Object.freeze({ ior: 1.34, roughness: 0.5, note: "ocean-weighted water/land blend" }),

    mars: Object.freeze({ ior: 1.58, roughness: 0.88, note: "iron-oxide dust and seasonal frost" }),

    jupiter: Object.freeze({ ior: 1.45, roughness: 0.84, note: "ammonia / NH4SH cloud decks, disc-integrated" }),

    saturn: Object.freeze({ ior: 1.45, roughness: 0.86, note: "ammonia cloud deck under haze, disc-integrated" }),

    uranus: Object.freeze({ ior: 1.31, roughness: 0.9, note: "methane haze layer, disc-integrated" }),

    neptune: Object.freeze({ ior: 1.31, roughness: 0.88, note: "methane haze, active convection, disc-integrated" }),

    "saturn-ring": Object.freeze({ ior: 1.31, roughness: 0.78, note: "water-ice ring particles" }),

    moon: Object.freeze({ ior: 1.55, roughness: 0.97, note: "porous silicate regolith" }),

    phobos: Object.freeze({ ior: 1.6, roughness: 0.97, note: "dark carbonaceous regolith" }),
    deimos: Object.freeze({ ior: 1.6, roughness: 0.97, note: "dark carbonaceous regolith" }),

    io: Object.freeze({ ior: 1.5, roughness: 0.8, note: "sulfur/SO2 frost, volcanic plains" }),

    europa: Object.freeze({ ior: 1.31, roughness: 0.72, note: "water-ice shell" }),

    ganymede: Object.freeze({ ior: 1.35, roughness: 0.86, note: "dirty water ice over rock" }),

    callisto: Object.freeze({ ior: 1.4, roughness: 0.95, note: "dust-covered ancient ice/rock" }),

    mimas: Object.freeze({ ior: 1.31, roughness: 0.88, note: "cratered water ice" }),

    enceladus: Object.freeze({ ior: 1.31, roughness: 0.62, note: "fresh water-ice deposits" }),

    tethys: Object.freeze({ ior: 1.31, roughness: 0.85, note: "bright cratered water ice" }),

    dione: Object.freeze({ ior: 1.31, roughness: 0.84, note: "water ice, hemispheric contrast" }),

    rhea: Object.freeze({ ior: 1.31, roughness: 0.87, note: "water ice, cratered plains" }),

    titan: Object.freeze({ ior: 1.4, roughness: 0.7, note: "organic tholin haze" }),

    hyperion: Object.freeze({ ior: 1.5, roughness: 1, note: "dark porous rubble" }),

    iapetus: Object.freeze({ ior: 1.45, roughness: 0.92, note: "albedo dichotomy, dark leading side" }),

    miranda: Object.freeze({ ior: 1.35, roughness: 0.9, note: "dark water ice, coronae" }),
    ariel: Object.freeze({ ior: 1.35, roughness: 0.85, note: "brightest Uranian moon, resurfaced ice" }),
    umbriel: Object.freeze({ ior: 1.35, roughness: 0.95, note: "dark, uniformly cratered ice" }),
    titania: Object.freeze({ ior: 1.35, roughness: 0.9, note: "ice with large canyons" }),
    oberon: Object.freeze({ ior: 1.35, roughness: 0.92, note: "old cratered ice" }),

    triton: Object.freeze({ ior: 1.31, roughness: 0.7, note: "nitrogen/water ice, young surface" }),

    nereid: Object.freeze({ ior: 1.5, roughness: 0.97, note: "dark irregular body" }),

    pluto: Object.freeze({ ior: 1.31, roughness: 0.78, note: "nitrogen/methane ice over tholins" }),

    charon: Object.freeze({ ior: 1.31, roughness: 0.9, note: "water ice and tholins" }),

    phoebe: Object.freeze({ ior: 1.6, roughness: 0.96, note: "dark cratered silicate regolith" }),
    himalia: Object.freeze({ ior: 1.6, roughness: 0.96, note: "low-albedo rocky regolith" }),

    comet: Object.freeze({ ior: 1.65, roughness: 1, note: "dark organic-rich nucleus" }),

    asteroid: Object.freeze({ ior: 1.6, roughness: 0.98, note: "silicate/carbonaceous rock" })
});

const DEFAULT_SURFACE = Object.freeze({ ior: 1.5, roughness: 1, note: "unmodelled surface" });

const THREE_SPECULAR_DEFAULT_F0 = 0.04;

function applySurfaceBrdf(material, key, THREE) {
    if (!material || !key) return false;

    const surface = SURFACE_BRDF[key] || DEFAULT_SURFACE;

    const f0 = dielectricF0(surface.ior);

    const roughness = Number.isFinite(surface.roughness)
        ? surface.roughness
        : glossinessToRoughness(surface.glossiness);

    material.roughness = Math.max(0.02, Math.min(1, roughness));
    material.metalness = 0;

    // Three computes the physical material's F0 as
    //   pow2((ior-1)/(ior+1)) * specularColor * specularIntensity,
    // so writing all three from f0 multiplies the Fresnel twice: for Earth's
    // water that is 0.021 * 0.021 * 0.53 = 2.4e-4 instead of 0.021, a glint
    // ninety times too dim. Set the index of refraction and let three do the
    // arithmetic; only materials without one are scaled by hand.
    if ("ior" in material) {
        material.ior = surface.ior;
        if ("specularIntensity" in material) material.specularIntensity = 1;
        if (THREE && THREE.Color && "specularColor" in material) {
            material.specularColor = new THREE.Color(1, 1, 1);
        }
    } else if ("specularIntensity" in material) {
        material.specularIntensity = Math.max(0, f0 / THREE_SPECULAR_DEFAULT_F0);
        if (THREE && THREE.Color && "specularColor" in material) {
            material.specularColor = new THREE.Color(f0, f0, f0);
        }
    }

    material.userData.surfaceBrdf = {
        key: key,
        ior: surface.ior,
        f0: f0,
        roughness: material.roughness,
        note: surface.note
    };

    return true;
}

function isSurfaceBrdfManaged(material) {
    return !!(material && material.userData && material.userData.surfaceBrdf);
}

globalThis.SURFACE_BRDF = SURFACE_BRDF;
globalThis.applySurfaceBrdf = applySurfaceBrdf;
globalThis.isSurfaceBrdfManaged = isSurfaceBrdfManaged;
globalThis.dielectricF0 = dielectricF0;
globalThis.glossinessToRoughness = glossinessToRoughness;
