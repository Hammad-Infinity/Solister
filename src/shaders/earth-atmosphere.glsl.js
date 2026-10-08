// ============================================================================
// earth-atmosphere.glsl.js — physical single-scattering atmospheres
// ----------------------------------------------------------------------------
// Planets no longer wear a "corona" glow shell. Bodies that possess a real
// atmosphere get a radiative-transfer shell instead: Rayleigh + Mie single
// scattering with Beer-Lambert extinction along both the view ray and the
// sun ray, Rayleigh/Henyey-Greenstein phase functions, an isotropic multiple
// scattering approximation, ozone (Earth) and methane (Uranus/Neptune)
// absorption bands, and lunar-eclipse shadowing for Earth.
//
// Everything optical is DERIVED at build time from the physical database
// below (composition, surface pressure, temperature, gravity):
//   * scale height            H = R_gas·T / (M̄·g)
//   * molecular Rayleigh      σ ∝ Σ fᵢ (nᵢ−1)² F_King,ᵢ  (per molecule,
//     scattering strength     relative to dry air, λ⁻⁴ across RGB)
//   * vertical optical depth  τ_R = τ_R⊕ · S_rel · (P/P⊕) · (M_air/M̄) · (g⊕/g)
//     (column N = P/(m·g); temperature cancels in the vertical column)
//
// Performance: one shell mesh per body, fixed 8-sample view march, NO nested
// sun march (a closed-form grazing-corrected slant factor is used instead),
// no per-frame CPU work beyond two vector uniforms per visible shell.
// ============================================================================

// --- Gas optical constants -------------------------------------------------
// refractivity: (n−1)·1e6 at ~589 nm, STP; king: depolarisation (King) factor;
// molar: g/mol.
const ATMOSPHERE_GASES = Object.freeze({
    N2:  Object.freeze({ refractivity: 297.0, king: 1.034, molar: 28.0134 }),
    O2:  Object.freeze({ refractivity: 270.0, king: 1.096, molar: 31.9988 }),
    Ar:  Object.freeze({ refractivity: 279.0, king: 1.000, molar: 39.9480 }),
    CO2: Object.freeze({ refractivity: 450.0, king: 1.150, molar: 44.0095 }),
    H2:  Object.freeze({ refractivity: 138.6, king: 1.021, molar: 2.01588 }),
    He:  Object.freeze({ refractivity: 34.8,  king: 1.000, molar: 4.002602 }),
    CH4: Object.freeze({ refractivity: 440.0, king: 1.020, molar: 16.0425 }),
});
const AIR_KING = 1.048;
// Dry-air reference refractivity from the same table (Σ f·δ).
const AIR_REFRACTIVITY = 0.78084 * 297.0 + 0.20946 * 270.0 + 0.00934 * 279.0;
const AIR_MOLAR = 0.78084 * 28.0134 + 0.20946 * 31.9988 + 0.00934 * 39.9480;
// Earth's vertical Rayleigh optical depth at 550 nm (sea level).
const EARTH_RAYLEIGH_TAU_550 = 0.098;
const EARTH_SURFACE_PRESSURE = 101325;   // Pa
const EARTH_GRAVITY = 9.80665;           // m/s²
const GAS_CONSTANT = 8.314462;           // J/(mol·K)
// RGB channel wavelengths (nm) used for the λ⁻⁴ Rayleigh split, anchored 550.
const CHANNEL_WAVELENGTHS = Object.freeze({ r: 610, g: 545, b: 465 });

// --- Body database ----------------------------------------------------------
// topKm keeps the shell extents (constraints) used so far. mieTau/mieG/mieTint
// describe the aerosol layer (acid haze on Venus, dust on Mars, faint photo-
// chemical hazes on the giants and Pluto). visualGain is a presentation-scale
// calibration that keeps each body at its established brightness while all
// *relative* behaviour stays physically derived.
const ATMOSPHERE_DATABASE = Object.freeze({
    venus: Object.freeze({
        // Reference state at the CLOUD TOPS (~70 km): the surface state
        // (92 bar, 737 K) is invisible below the opaque cloud deck and would
        // make the observable shell optically saturated with a hard edge.
        // Above the clouds: ~0.05 bar, ~235 K -> H ≈ 5.1 km, 85 km shell top
        // spans ~17 scale heights, so density dies away smoothly (no lining).
        surfacePressurePa: 5.0e3, surfaceTempK: 235, gravity: 8.87,
        composition: Object.freeze({ CO2: 0.965, N2: 0.035 }),
        topKm: 95, referenceKm: 70,
        mieTau: 0.75, mieG: 0.65, mieTint: 0xe8e2d4,
        visualGain: 0.23,
    }),
    earth: Object.freeze({
        surfacePressurePa: 101325, surfaceTempK: 288.15, gravity: 9.80665,
        composition: Object.freeze({ N2: 0.78084, O2: 0.20946, Ar: 0.00934 }),
        topKm: 420, mieTau: 0.05, mieG: 0.76, mieTint: 0xc4dcf3,
        ozoneTau: Object.freeze({ r: 0.028, g: 0.085, b: 0.012 }),
        ozoneHeightKm: 25, ozoneWidthKm: 16,
        visualGain: 1.0,
    }),
    mars: Object.freeze({
        surfacePressurePa: 610, surfaceTempK: 210, gravity: 3.71,
        composition: Object.freeze({ CO2: 0.9532, N2: 0.027, Ar: 0.016 }),
        topKm: 110, mieTau: 0.42, mieG: 0.72, mieTint: 0xd8b28e,
        visualGain: 0.16,
    }),
    jupiter: Object.freeze({
        // Anchored at the AMMONIA CLOUD TOPS (~0.5 bar, ~178 K), not 1 bar:
        // the scattering column visible above the clouds is what matters.
        // NASA fact sheet: scale height 27 km, M 2.22 g/mol, H2 89.8 %.
        // SHELL TOP = 5 SCALE HEIGHTS (~135 km) above the cloud deck.
        // Jupiter's optically active limb haze is confined to roughly 100-150
        // km above the 0.5-bar clouds (tropopause ~50 km above the visible
        // deck, thin 0.1-0.5 bar haze above it); density at 5H is e^-5 =
        // 0.7 % of the cloud-top value, below the visible threshold even
        // with the ~x128 tangent-column limb enhancement. The previous
        // 840 km shell (31 scale heights) rendered as an inflated halo
        // detached from the planet; the real atmosphere hugs the surface.
        surfacePressurePa: 5.0e4, surfaceTempK: 178, gravity: 24.79,
        composition: Object.freeze({ H2: 0.898, He: 0.102 }),
        topKm: 135, mieTau: 0.18, mieG: 0.65, mieTint: 0xf3e6c8,
        visualGain: 0.19,
    }),
    saturn: Object.freeze({
        // Anchored above the haze deck (~0.4 bar, ~160 K). Cassini limb
        // imaging: stacked hydrocarbon-ice hazes 0.5 bar -> 0.4 mbar (~340
        // km), published scale height ~59.5 km. Haze is pale cream, not blue.
        // SHELL TOP = 5 SCALE HEIGHTS (~297 km): density there is 0.7 % of
        // the reference and optically negligible — the extra 340 km seen by
        // Cassini is trace aerosol, far too tenuous to scatter visible
        // light. 5H keeps the limb haze tight against the cloud tops
        // instead of a puffed-up shell.
        surfacePressurePa: 4.0e4, surfaceTempK: 160, gravity: 10.44,
        composition: Object.freeze({ H2: 0.963, He: 0.0325, CH4: 0.0045 }),
        topKm: 297, mieTau: 0.22, mieG: 0.65, mieTint: 0xe8dfc8,
        visualGain: 0.115,
    }),
    uranus: Object.freeze({
        // SHELL TOP = 5 SCALE HEIGHTS (~138 km, H = 27.5 km). Above the
        // methane cloud deck Uranus' atmosphere is essentially clear and
        // transparent (Voyager/Keck: high clouds sit only ~75 km above the
        // main deck), so the scattering veneer is a few scale heights at
        // most — a thin limb haze on the surface, not an extended bubble.
        surfacePressurePa: 1.0e5, surfaceTempK: 76, gravity: 8.69,
        composition: Object.freeze({ H2: 0.825, He: 0.152, CH4: 0.023 }),
        topKm: 138, mieTau: 0.01, mieG: 0.60, mieTint: 0xc4e8ec,
        methaneTau: Object.freeze({ r: 0.62, g: 0.16, b: 0.02 }),
        visualGain: 0.19,
    }),
    neptune: Object.freeze({
        // SHELL TOP = 5 SCALE HEIGHTS (~103 km, H = 20.6 km). Like Uranus:
        // the region above the 1.5-bar methane cloud level is clear, with
        // bright cirrus only ~75 km higher (Voyager shadow measurements).
        surfacePressurePa: 1.0e5, surfaceTempK: 72, gravity: 11.15,
        composition: Object.freeze({ H2: 0.80, He: 0.19, CH4: 0.015 }),
        topKm: 103, mieTau: 0.012, mieG: 0.60, mieTint: 0xb8d9f1,
        methaneTau: Object.freeze({ r: 0.5, g: 0.13, b: 0.018 }),
        visualGain: 0.23,
    }),
    pluto: Object.freeze({
        surfacePressurePa: 1.0, surfaceTempK: 45, gravity: 0.62,
        composition: Object.freeze({ N2: 0.99, CH4: 0.005 }),
        topKm: 30,
        // Pluto's real atmosphere is nearly invisible; this stylised haze
        // layer (photochemical tholins) keeps the established presentation.
        mieTau: 0.03, mieG: 0.55, mieTint: 0xd7e5ed,
        visualGain: 0.176,
    }),
});

function wavelengthRatio(nm) {
    return Math.pow(550 / nm, 4);
}

// Per-molecule Rayleigh scattering of a mixture relative to dry air.
function rayleighRelativeStrength(composition) {
    let sum = 0;
    for (const [gas, fraction] of Object.entries(composition)) {
        const g = ATMOSPHERE_GASES[gas];
        if (!g) continue;
        sum += fraction * g.refractivity * g.refractivity * g.king;
    }
    const air = AIR_REFRACTIVITY * AIR_REFRACTIVITY * AIR_KING;
    return sum / air;
}

function meanMolarMass(composition) {
    let mass = 0, share = 0;
    for (const [gas, fraction] of Object.entries(composition)) {
        const g = ATMOSPHERE_GASES[gas];
        if (!g) continue;
        mass += fraction * g.molar;
        share += fraction;
    }
    return share > 0 ? mass / share : AIR_MOLAR;
}

// Full derivation of one body's optical model. Pure math — unit-testable.
function deriveAtmosphere(key, facts = ATMOSPHERE_DATABASE[key]) {
    if (!facts) return null;
    const molar = meanMolarMass(facts.composition);              // g/mol
    const scaleHeightM =
        GAS_CONSTANT * facts.surfaceTempK /
        ((molar / 1000) * facts.gravity);                        // metres
    const scaleHeightKm = scaleHeightM / 1000;
    const columnFactor =
        (facts.surfacePressurePa / EARTH_SURFACE_PRESSURE) *
        (AIR_MOLAR / molar) *
        (EARTH_GRAVITY / facts.gravity);
    const strength = rayleighRelativeStrength(facts.composition);
    const tauR550 = EARTH_RAYLEIGH_TAU_550 * strength * columnFactor;
    const tauR = {
        r: tauR550 * wavelengthRatio(CHANNEL_WAVELENGTHS.r),
        g: tauR550 * wavelengthRatio(CHANNEL_WAVELENGTHS.g),
        b: tauR550 * wavelengthRatio(CHANNEL_WAVELENGTHS.b),
    };
    const tauM = Math.max(0, facts.mieTau || 0);
    const tauSum = tauR550 + tauM;
    const rolloff = 1 + 0.6 * Math.sqrt(Math.min(tauSum, 30));
    const intensity = Math.max(0.05, Math.min(1.15,
        facts.visualGain * 2.9 * Math.sqrt(tauSum) / rolloff));
    return {
        key,
        scaleHeightKm,
        scaleHeightRatio: null,   // filled in once the body radius is known
        tauR,
        tauM,
        mieG: facts.mieG ?? 0.7,
        mieTint: facts.mieTint ?? 0xffffff,
        ozoneTau: facts.ozoneTau || null,
        ozoneHeightKm: facts.ozoneHeightKm || 0,
        ozoneWidthKm: facts.ozoneWidthKm || 1,
        methaneTau: facts.methaneTau || null,
        referenceKm: facts.referenceKm || 0,
        intensity,
        opticalDepth: tauSum,
        topKm: facts.topKm,
    };
}

// Legacy-shaped facade so existing call sites (frame-loop, planet-factory)
// keep working. Values are derived, not hand-tuned.
const PLANET_ATMOSPHERE_PROFILES = (() => {
    const profiles = {};
    for (const key of Object.keys(ATMOSPHERE_DATABASE)) {
        const derived = deriveAtmosphere(key);
        if (!derived) continue;
        const tint = (tau) => {
            const max = Math.max(tau.r, tau.g, tau.b, 1e-9);
            return new THREE.Color(tau.r / max, tau.g / max, tau.b / max);
        };
        profiles[key] = Object.freeze({
            derived,
            intensity: derived.intensity,
            opticalDepth: derived.opticalDepth,
            scaleHeight: derived.scaleHeightKm,
            rayleigh: tint(derived.tauR).getHex(),
            mie: derived.mieTint,
            rayleighStrength: Math.min(1.5, derived.tauR.g / 0.1),
            mieStrength: Math.min(1.5, derived.tauM / 0.1),
        });
    }
    return Object.freeze(profiles);
})();

// LDB_* log-depth shader snippets come from src/render/log-depth-glsl.js
// (published on globalThis for classic-script loading — see that file).
// --- Shader -----------------------------------------------------------------
const ATMOSPHERE_VERTEX_GLSL = `
varying vec3 vAtmoView;
varying vec3 vWorldPos;${LDB_VERTEX_PARS}
void main(){
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vAtmoView = (viewMatrix * world).xyz;
    gl_Position = projectionMatrix * vec4(vAtmoView, 1.0);${LDB_VERTEX_TAIL}
}`;

const ATMOSPHERE_FRAGMENT_GLSL = `
uniform float intensity;
uniform float uBodyRadius;
uniform float uShellRadius;
uniform float uScaleHeight;      // H / R
uniform float uDensityOffset;    // reference altitude / H (cloud tops etc.)
uniform float uShellHeight;      // shell top altitude, scene units
uniform float uEdgeTaper;        // 1 when the shell top needs a soft fade
uniform vec3  uTauR;             // vertical Rayleigh optical depth per channel
uniform float uTauM;             // vertical Mie optical depth
uniform float uMieG;
uniform vec3  uMieTint;
uniform vec3  uOzone;            // vertical ozone absorption (0 where absent)
uniform float uOzoneHeight;      // normalised to R
uniform float uOzoneWidth;       // normalised to R
uniform vec3  uMethane;          // vertical methane absorption (0 where absent)
uniform float uSunIntensity;
uniform vec3  uBodyCenterView;
uniform vec3  uSunDir;
varying vec3 vAtmoView;
varying vec3 vWorldPos;
${'${eclipseSource}'}${LDB_FRAGMENT_PARS}
float rayleighPhase(float mu){ return 0.75 * (1.0 + mu * mu); }
float miePhase(float mu, float g){
    float g2 = g * g;
    // The raw Henyey-Greenstein lobe spikes to (1+g)/(1-g)^2 in exact forward
    // scattering (x45 for g=0.8). A real atmosphere does not look like a shiny
    // marble with a specular hotspot when the sun sits behind it, so the lobe
    // is clamped hard: enough forward brightening for a natural aureole, none
    // of the glass-bead glint.
    return min(2.5, (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 0.035), 1.5));
}
// Grazing-corrected slant factor for an exponential atmosphere.
// Plane-parallel 1/mu far from the limb, saturating near the analytic
// horizon limit 1/sqrt(2 pi H/R) — no nested sun march needed.
float sunSlant(float mu){
    float horizonLimit = 1.6 * sqrt(uScaleHeight / 6.2831853);
    return 1.0 / max(mu + 0.008, horizonLimit);
}
void main(){${LDB_FRAGMENT_HEAD}
    vec3 ray = normalize(vAtmoView);
    vec3 center = uBodyCenterView;
    float along = dot(center, ray);
    float impact = length(center - ray * along);
    if(impact >= uShellRadius) discard;
    float outerChord = sqrt(max(uShellRadius * uShellRadius - impact * impact, 0.0));
    float start = max(0.0, along - outerChord);   // camera may be inside
    float finish = along + outerChord;
    if(impact < uBodyRadius){
        float innerChord = sqrt(max(uBodyRadius * uBodyRadius - impact * impact, 0.0));
        finish = min(finish, max(start, along - innerChord)); // clip at ground
    }
    if(finish <= start) discard;

    vec3 sun = normalize(uSunDir);
    float mu = dot(-ray, sun);
    float phaseR = rayleighPhase(mu);
    float phaseM = miePhase(mu, uMieG);

    float H = max(uScaleHeight, 0.0004) * uBodyRadius;
    float stepLength = (finish - start) / 8.0;
    vec3 tauRView = vec3(0.0);
    float tauMView = 0.0;
    vec3 tauO3View = vec3(0.0);
    vec3 tauCH4View = vec3(0.0);
    vec3 scatter = vec3(0.0);
    float sunTransmitAccum = 0.0;

    for(int i = 0; i < 8; i++){
        float distanceAlong = start + (float(i) + 0.5) * stepLength;
        vec3 point = ray * distanceAlong - center;
        float radial = length(point);
        float height = max(0.0, radial - uBodyRadius);
        // Exponential profile anchored at the reference level (surface, or
        // cloud tops for Venus) and clamped; shells whose top still carries
        // meaningful density (uEdgeTaper = 1, e.g. Pluto, Venus) additionally
        // fade smoothly over their outer 15 % so no visible edge remains.
        float density = min(exp(-(height / H - uDensityOffset)), 1.0);
        density *= 1.0 - uEdgeTaper * smoothstep(0.85 * uShellHeight, uShellHeight, height);
        float sunMu = dot(point / max(radial, 1e-6), sun);
        // Day/night terminator with a soft refractive-style tail.
        float daylight = smoothstep(-0.06, 0.04, sunMu);
        float slant = sunSlant(sunMu);
        vec3 sunOptical = (uTauR + vec3(uTauM)) * density * slant;
        vec3 sunTransmit = exp(-min(sunOptical, vec3(9.0))) * daylight;
        float segment = stepLength / H;            // normalised column chunk
        tauRView += uTauR * density * segment;
        tauMView += uTauM * density * segment;
        float ozoneDensity = exp(-pow((height / uBodyRadius - uOzoneHeight) /
            max(uOzoneWidth, 1e-5), 2.0));
        tauO3View += uOzone * ozoneDensity * segment;
        tauCH4View += uMethane * density * segment;
        vec3 inScatter =
            uTauR * (phaseR * sunTransmit) +
            vec3(uTauM * phaseM) * sunTransmit * uMieTint;
        scatter += inScatter * density * segment;
        sunTransmitAccum += dot(sunTransmit, vec3(0.3333333));
    }

    vec3 tauView = tauRView + vec3(tauMView) + tauO3View + tauCH4View;
    vec3 transmittance = exp(-min(tauView, vec3(9.0)));
    // Cheap isotropic second scattering: keeps thick atmospheres luminous
    // just past the terminator and lifts the limb without an extra pass.
    // Kept deliberately subdued: a strong constant limb lift reads as a glossy
    // rim around the whole ball. Real limbs are bright only on the sunlit
    // side, so most of the lift is gated on actual sunlight (avgSun).
    float avgSun = sunTransmitAccum / 8.0;
    vec3 rayleighShare = uTauR / max(uTauR + vec3(uTauM), vec3(1e-5));
    scatter += rayleighShare * (1.0 - transmittance) * (0.07 + 0.50 * avgSun) *
        (phaseR * 0.18 + 0.06);
    scatter *= uSunIntensity * intensity;

    // Cap the grazing-angle alpha below full saturation: a 1.0-alpha rim
    // around the disc is the classic "solid marble" tell. Haze stays haze.
    float alpha = clamp(1.0 - dot(transmittance, vec3(0.3333333)), 0.0, 0.88) * intensity;
    float eclipseVisibility = 1.0;${'${eclipseFactor}'}
    if(alpha < 0.0002) discard;
    // Premultiplied compositing: final = scatter + background * transmittance.
    gl_FragColor = vec4(scatter * eclipseVisibility, alpha);
}`;

function createPlanetAtmosphere(key, body, profile = PLANET_ATMOSPHERE_PROFILES[key]) {
    if (!body || !profile || cloudMeshes[key + '_atmosphere']) return cloudMeshes[key + '_atmosphere'] || null;
    const derived = profile.derived || deriveAtmosphere(key);
    if (!derived) return null;
    const radius = body.geometry?.parameters?.radius;
    if (!(radius > 0)) return null;
    const outer = 1 + derived.topKm / (BodyShapes.maxRadiusKm(key) || 6371);
    const shellRadius = radius * outer;
    const geometry = BodyShapes.createGeometry(THREE, key, shellRadius, 128, 128);
    const eclipse = key === 'earth';
    const eclipseUniformBlock = eclipse ? eclipseUniforms : {};
    const eclipseSource = eclipse ? ECLIPSE_GLSL : '';
    const eclipseFactor = eclipse ? 'eclipseVisibility=solarVisibility(vWorldPos);' : '';
    // Scene-unit conversions (radius already in scene units).
    const kmToScene = radius / (BodyShapes.maxRadiusKm(key) || 6371);
    const scaleHeightRatio = derived.scaleHeightKm * kmToScene / radius;
    const shellHeightScene = derived.topKm * kmToScene;
    const densityOffset = (derived.referenceKm || 0) / derived.scaleHeightKm;
    // Bodies whose shell top still carries meaningful density (Pluto, Venus)
    // need a soft outer fade; deep shells fade naturally via the exponential.
    const topDensity = Math.exp(-(derived.topKm - (derived.referenceKm || 0)) / derived.scaleHeightKm);
    const edgeTaper = topDensity > 0.02 ? 1 : 0;
    const zero3 = () => new THREE.Vector3(0, 0, 0);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            ...eclipseUniformBlock,
            intensity: { value: profile.intensity },
            uBodyCenterView: { value: new THREE.Vector3() },
            uBodyRadius: { value: radius },
            uShellRadius: { value: shellRadius },
            uScaleHeight: { value: scaleHeightRatio },
            uDensityOffset: { value: densityOffset },
            uShellHeight: { value: shellHeightScene },
            uEdgeTaper: { value: edgeTaper },
            uTauR: { value: new THREE.Vector3(derived.tauR.r, derived.tauR.g, derived.tauR.b) },
            uTauM: { value: derived.tauM },
            uMieG: { value: derived.mieG },
            uMieTint: { value: new THREE.Color(derived.mieTint) },
            uOzone: { value: derived.ozoneTau ? new THREE.Vector3(derived.ozoneTau.r, derived.ozoneTau.g, derived.ozoneTau.b) : zero3() },
            uOzoneHeight: { value: derived.ozoneHeightKm * kmToScene / radius },
            uOzoneWidth: { value: Math.max(derived.ozoneWidthKm * kmToScene / radius, 1e-5) },
            uMethane: { value: derived.methaneTau ? new THREE.Vector3(derived.methaneTau.r, derived.methaneTau.g, derived.methaneTau.b) : zero3() },
            uSunIntensity: { value: 1.0 },
            uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        },
        vertexShader: ATMOSPHERE_VERTEX_GLSL,
        fragmentShader: ATMOSPHERE_FRAGMENT_GLSL
            .replace('${eclipseFactor}', eclipseFactor)
            .replace('${eclipseSource}', eclipseSource),
        transparent: true, depthWrite: false, depthTest: true,
        // FrontSide while the camera is outside (haze composited over the
        // disc), flipped to BackSide by the frame loop once the camera
        // enters the shell so the sky glow surrounds the viewer.
        side: THREE.FrontSide,
        blending: THREE.NormalBlending, premultipliedAlpha: true,
        toneMapped: false, fog: false,
        // The shell sits just above the surface; the negative offset makes it
        // win depth ties against its planet deterministically even when the
        // depth buffer degenerates (small-body focus), so the limb haze never
        // flickers through the disc.
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
    });
    const shell = new THREE.Mesh(geometry, material);
    shell.userData.isAtmosphere = true;
    shell.userData.atmosphereProfile = profile;
    shell.userData.atmosphereDerived = derived;
    shell.name = key + ' physical scattering atmosphere';
    shell.renderOrder = 2;
    shell.raycast = () => {};
    body.add(shell);
    cloudMeshes[key + '_atmosphere'] = shell;
    return shell;
}
function createEarthAtmosphere() {
    const earth = objectRegistry.earth;
    if (!earth) return null;
    return createPlanetAtmosphere('earth', earth, PLANET_ATMOSPHERE_PROFILES.earth);
}
