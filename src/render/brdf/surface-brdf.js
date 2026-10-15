// Physically-based surface response for every body in the system.
//
// three.js r160 already evaluates a full Cook-Torrance microfacet BRDF inside
// its MeshStandardMaterial/MeshPhysicalMaterial path:
//
//     f = F_Schlick(f0, f90, VdotH) * D_GGX(alpha, NdotH)
//                       * V_GGX_SmithCorrelated(alpha, NdotL, NdotV)
//
// where V is the Smith-correlated visibility term, i.e. the geometry term
// folded together with the 1 / (4 * NdotL * NdotV) denominator. That is the
// same Torrance-Sparrow structure the procedural-Earth reference uses, with a
// GGX normal distribution in place of its Blinn-Phong one. GGX has the long
// tails that real regolith and cloud tops show, so it is kept rather than
// back-ported over.
//
// What the reference does contribute is the idea of driving that BRDF from
// real surface data instead of a single global constant. Before this module,
// every body in Solister was built with roughness 1 and metalness 0, which is
// the same as asking for a perfectly matte Lambertian sphere: the specular
// term collapses to nothing and oceans, ice caps and cloud decks all respond
// to the Sun identically. This module gives each body an index of refraction
// and a roughness taken from its actual surface composition, and lets the
// Fresnel term fall out of the IOR the way the dielectric Fresnel equation
// says it should.
//
// Load order: this is a classic bootstrap script that shares one global scope
// with the rest of src/. It declares only functions and frozen data at top
// level and reads nothing from any other script, so it cannot be caught in a
// temporal-dead-zone failure no matter where it sits in the bootstrap order.

// Fresnel reflectance at normal incidence for a dielectric with the given
// index of refraction:
//
//     R0 = ((n1 - n2) / (n1 + n2)) ^ 2
//
// Evaluated from the outside (n1 = 1 for vacuum/air), so R0 = ((1 - n) / (1 + n))^2.
// The result is the f0 that Schlick's approximation is built around; three.js
// multiplies it by the grazing-angle response itself.
function dielectricF0(ior) {
    const n = Number.isFinite(ior) ? ior : 1.5;
    const r = (1 - n) / (1 + n);
    return r * r;
}

// Maps proc_earth's 0..1 "glossiness" onto the perceptually-uniform roughness
// that three.js expects. proc_earth turns glossiness into a Blinn exponent
// with exp2(10 * g + 1); GGX instead wants alpha = roughness^2, so this
// conversion keeps the highlight footprint comparable across the two models:
//
//     roughness = 1 / sqrt(exp2(10 * g + 1))
//
// clamped away from 0 so a mirror-sharp singularity never reaches the GPU.
function glossinessToRoughness(glossiness) {
    const g = Math.max(0, Math.min(1, Number.isFinite(glossiness) ? glossiness : 0));
    const specularPower = Math.pow(2, 10 * g + 1);
    return Math.max(0.02, Math.min(1, 1 / Math.sqrt(specularPower)));
}

// Surface response per body, keyed the same way as objectRegistry.
//
//   ior        index of refraction of whatever the visible surface is made of.
//              Drives f0, so it is the number that actually decides how much
//              sunlight a surface throws back as a highlight.
//   roughness  used directly when present.
//   glossiness 0..1 gloss in the reference's own units, converted above. Only
//              used when roughness is absent, so a body never carries both.
//   note       what the surface is, and where the numbers come from.
//
// Coverage is every key that reaches a MeshStandardMaterial: the eight planets
// and the Moon via createPlanetMesh, the 21 catalogue moons plus Pluto, Charon,
// Himalia and Phoebe via solar-ephemeris and extra-bodies, the near-focus
// asteroid rock, the comet nucleus, and Saturn's rings. Belt particle clouds
// are intentionally absent: they render through hand-written ShaderMaterials
// that do their own lighting, so there is no BRDF here for this module to set.
const SURFACE_BRDF = Object.freeze({
    // --- Rocky planets ---

    // Anhydrous silicate regolith, space-weathered. Very dark and almost
    // perfectly diffuse; Mercury's geometric albedo is around 0.14 and it
    // shows essentially no specular return. Silicate n ~ 1.5-1.7.
    mercury: Object.freeze({ ior: 1.62, roughness: 0.95, note: "space-weathered silicate regolith" }),

    // The visible surface is a global H2SO4 cloud deck, not rock. Droplet
    // surfaces are liquid, so they are markedly smoother than regolith and
    // carry a real specular sheen. Sulfuric acid solution n ~ 1.43.
    venus: Object.freeze({ ior: 1.43, glossiness: 0.35, note: "sulfuric acid cloud deck" }),

    // Earth is the one body with genuinely mixed surfaces. The map carries
    // ocean and land together, so this is a blend weighted toward water:
    // liquid water n ~ 1.333, and the oceans cover roughly 71% of the disc.
    // Water is smooth, land is rough, hence the middling roughness and the
    // low but nonzero f0 that produces the familiar sun glint.
    earth: Object.freeze({ ior: 1.34, roughness: 0.42, note: "ocean-weighted water/land blend" }),

    // Iron-oxide dust over basalt, plus seasonal CO2 and water ice. Dry and
    // diffuse, but brighter than the Moon and with a faint sheen where frost
    // sits. n ~ 1.55 for the dust, higher where frozen.
    mars: Object.freeze({ ior: 1.58, roughness: 0.88, note: "iron-oxide dust and seasonal frost" }),

    // --- Gas and ice giants. The visible surface is always cloud tops. ---

    // Ammonia and ammonium hydrosulfide decks. Droplet-scattering decks are
    // smoother than any solid surface here, and Jupiter's are the most
    // turbulent, which roughens them again. Ammonia ice n ~ 1.45.
    jupiter: Object.freeze({ ior: 1.45, roughness: 0.5, note: "ammonia / NH4SH cloud decks" }),

    // Same composition family as Jupiter but calmer and hazier, so a smoother
    // effective surface. Ammonia ice n ~ 1.45.
    saturn: Object.freeze({ ior: 1.45, roughness: 0.55, note: "ammonia cloud deck under haze" }),

    // Methane-dominated atmosphere with a deep, featureless haze layer.
    // Methane ice n ~ 1.31, and the haze scatters broadly, which flattens the
    // highlight almost completely.
    uranus: Object.freeze({ ior: 1.31, roughness: 0.62, note: "methane haze layer" }),

    // Like Uranus but with more active convection breaking the haze up, so
    // slightly rougher. Methane ice n ~ 1.31.
    neptune: Object.freeze({ ior: 1.31, roughness: 0.6, note: "methane haze, active convection" }),

    // --- Saturn's rings ---

    // Water-ice particles, and fresh ice is the smoothest bright material in
    // the system, so the rings show a real forward-scatter brightening toward
    // the Sun. Water ice n ~ 1.31.
    "saturn-ring": Object.freeze({ ior: 1.31, roughness: 0.55, note: "water-ice ring particles" }),

    // --- Earth's Moon ---

    // Lunar regolith: porous, glass-rich, extremely backscattering, and about
    // as matte as a surface gets. n ~ 1.5-1.6 for the silicate glass fraction.
    moon: Object.freeze({ ior: 1.55, roughness: 0.97, note: "porous silicate regolith" }),

    // --- Martian moons: captured, dark, carbonaceous. ---

    phobos: Object.freeze({ ior: 1.6, roughness: 0.97, note: "dark carbonaceous regolith" }),
    deimos: Object.freeze({ ior: 1.6, roughness: 0.97, note: "dark carbonaceous regolith" }),

    // --- Galilean moons ---

    // Sulfur and sulfur dioxide frost over active volcanism. The frost is
    // bright and comparatively smooth, so Io is the most specular of the
    // rocky moons. SO2 frost n ~ 1.5.
    io: Object.freeze({ ior: 1.5, roughness: 0.8, note: "sulfur/SO2 frost, volcanic plains" }),

    // Water-ice shell, young and comparatively clean in places. Ice is bright
    // and smoother than regolith, so Europa picks up more specular return than
    // the other icy moons. Water ice n ~ 1.31.
    europa: Object.freeze({ ior: 1.31, roughness: 0.72, note: "water-ice shell" }),

    // Mixed rock and ice, heavily cratered, with a bright equatorial belt.
    // Dirtier ice than Europa, so rougher and less reflective.
    ganymede: Object.freeze({ ior: 1.35, roughness: 0.86, note: "dirty water ice over rock" }),

    // The darkest Galilean moon: ancient, heavily cratered, dust-covered ice
    // and rock. Very close to Lambertian.
    callisto: Object.freeze({ ior: 1.4, roughness: 0.95, note: "dust-covered ancient ice/rock" }),

    // --- Saturn's moons ---

    // Small, heavily cratered water-ice moon. Bright ice but rough terrain.
    mimas: Object.freeze({ ior: 1.31, roughness: 0.88, note: "cratered water ice" }),

    // Geologically active with fresh water-ice deposits around its south
    // polar terrain. The freshest ice in the Saturn system, hence the lowest
    // roughness of the icy moons here.
    enceladus: Object.freeze({ ior: 1.31, roughness: 0.62, note: "fresh water-ice deposits" }),

    // Bright, icy, heavily cratered. Similar to Mimas.
    tethys: Object.freeze({ ior: 1.31, roughness: 0.85, note: "bright cratered water ice" }),

    // Icy with a bright leading hemisphere and darker trailing side.
    dione: Object.freeze({ ior: 1.31, roughness: 0.84, note: "water ice, hemispheric contrast" }),

    // Icy, moderately cratered, some resurfacing. Slightly rougher than Dione.
    rhea: Object.freeze({ ior: 1.31, roughness: 0.87, note: "water ice, cratered plains" }),

    // The one moon with a substantial atmosphere. Its visible "surface" is an
    // organic photochemical haze, not the ground; tholin aerosols scatter
    // strongly and give the disc a soft, low-contrast sheen.
    titan: Object.freeze({ ior: 1.4, roughness: 0.7, note: "organic tholin haze" }),

    // Very dark, low density, chaotic rotation, extremely low albedo.
    hyperion: Object.freeze({ ior: 1.5, roughness: 1, note: "dark porous rubble" }),

    // Extreme albedo dichotomy: bright trailing side, dark leading side.
    // Averaged toward the darker, more widespread terrain.
    iapetus: Object.freeze({ ior: 1.45, roughness: 0.92, note: "albedo dichotomy, dark leading side" }),

    // --- Uranus's moons: dark, ice-rich, low albedo. ---

    miranda: Object.freeze({ ior: 1.35, roughness: 0.9, note: "dark water ice, coronae" }),
    ariel: Object.freeze({ ior: 1.35, roughness: 0.85, note: "brightest Uranian moon, resurfaced ice" }),
    umbriel: Object.freeze({ ior: 1.35, roughness: 0.95, note: "dark, uniformly cratered ice" }),
    titania: Object.freeze({ ior: 1.35, roughness: 0.9, note: "ice with large canyons" }),
    oberon: Object.freeze({ ior: 1.35, roughness: 0.92, note: "old cratered ice" }),

    // --- Neptune's moons ---

    // Nitrogen and water ice, geologically young, the most reflective surface
    // in the Neptune system. Comparable to fresh ice.
    triton: Object.freeze({ ior: 1.31, roughness: 0.7, note: "nitrogen/water ice, young surface" }),

    // Small, dark, irregular. Close to Lambertian.
    nereid: Object.freeze({ ior: 1.5, roughness: 0.97, note: "dark irregular body" }),

    // --- Plutonian system ---

    // Nitrogen and methane ices over darker tholin-rich terrain. Fresh N2 ice
    // is bright and comparatively smooth; the tholins are dark and matte.
    // N2 ice n ~ 1.29, tholins higher and absorbing.
    pluto: Object.freeze({ ior: 1.31, roughness: 0.78, note: "nitrogen/methane ice over tholins" }),

    // Water-ice bedrock with dark tholin staining. Water ice n ~ 1.31, but the
    // rough, blocky terrain keeps the highlight weak.
    charon: Object.freeze({ ior: 1.31, roughness: 0.9, note: "water ice and tholins" }),

    // --- Jupiter's outer irregular moons ---

    // Small, dark, heavily cratered. Silicate regolith.
    phoebe: Object.freeze({ ior: 1.6, roughness: 0.96, note: "dark cratered silicate regolith" }),
    himalia: Object.freeze({ ior: 1.6, roughness: 0.96, note: "low-albedo rocky regolith" }),

    // --- Small bodies ---

    // Cometary nucleus: among the darkest surfaces known, geometric albedo
    // near 0.04, and completely matte. Treated as near-Lambertian.
    comet: Object.freeze({ ior: 1.65, roughness: 1, note: "dark organic-rich nucleus" }),

    // The near-focus asteroid rock shown when you fly into the main belt.
    // Silicate/carbonaceous, low albedo, matte.
    asteroid: Object.freeze({ ior: 1.6, roughness: 0.98, note: "silicate/carbonaceous rock" })
});

// Fallback for any body that shows up without an entry. Perfectly matte: this
// is exactly the behaviour Solister had before, so an unknown key is visually
// inert rather than wrong.
const DEFAULT_SURFACE = Object.freeze({ ior: 1.5, roughness: 1, note: "unmodelled surface" });

// three.js hard-codes 0.04 as the dielectric specular default. Expressing our
// computed f0 as a multiple of it is what makes specularIntensity meaningful
// across materials.
const THREE_SPECULAR_DEFAULT_F0 = 0.04;

// Resolve the BRDF parameters for a body key and apply them to a material.
//
// The material must be a MeshStandardMaterial or MeshPhysicalMaterial, because
// the specular response set here is only consumed by three.js' physical
// shading path. Anything else is left untouched and reported as false so the
// caller can log it instead of silently assuming the settings took.
function applySurfaceBrdf(material, key, THREE) {
    if (!material || !key) return false;

    const surface = SURFACE_BRDF[key] || DEFAULT_SURFACE;

    const f0 = dielectricF0(surface.ior);

    const roughness = Number.isFinite(surface.roughness)
        ? surface.roughness
        : glossinessToRoughness(surface.glossiness);

    material.roughness = Math.max(0.02, Math.min(1, roughness));
    material.metalness = 0;

    // specularIntensity/specularColor only exist on MeshPhysicalMaterial. On a
    // plain MeshStandardMaterial the f0 is locked to the 0.04 dielectric
    // default, so set what we can and leave the rest alone.
    if ("specularIntensity" in material) {
        // Water (f0 ~ 0.020) ends up below 1, silicates near it, and the ice
        // moons a little above.
        material.specularIntensity = Math.max(0, f0 / THREE_SPECULAR_DEFAULT_F0);
        if (THREE && THREE.Color && "specularColor" in material) {
            material.specularColor = new THREE.Color(f0, f0, f0);
        }
    }

    // Record what was applied so later stages (clouds, atmosphere) and the
    // texture pipeline can read the intent without re-deriving it.
    material.userData.surfaceBrdf = {
        key: key,
        ior: surface.ior,
        f0: f0,
        roughness: material.roughness,
        note: surface.note
    };

    return true;
}

// Exposed for the texture pipeline: it resets material properties when it
// swaps a texture in, and must not undo the BRDF settings on the way past.
function isSurfaceBrdfManaged(material) {
    return !!(material && material.userData && material.userData.surfaceBrdf);
}

globalThis.SURFACE_BRDF = SURFACE_BRDF;
globalThis.applySurfaceBrdf = applySurfaceBrdf;
globalThis.isSurfaceBrdfManaged = isSurfaceBrdfManaged;
globalThis.dielectricF0 = dielectricF0;
globalThis.glossinessToRoughness = glossinessToRoughness;
