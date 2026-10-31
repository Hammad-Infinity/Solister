const ATMOSPHERE_REFERENCE_MODELS = globalThis.ATMOSPHERE_REFERENCE_MODELS;

const GAS_CONSTANT = 8.314462;

const EARTH_RAYLEIGH_TAU_550 = .098;

const EARTH_SURFACE_PRESSURE = 101325;

const EARTH_GRAVITY = 9.80665;

const CHANNEL_WAVELENGTHS = Object.freeze({
    r: 610,
    g: 545,
    b: 465
});

const ATMOSPHERE_GASES = Object.freeze({
    N2: Object.freeze({
        refractivity: 297,
        king: 1.034,
        molar: 28.0134
    }),
    O2: Object.freeze({
        refractivity: 270,
        king: 1.096,
        molar: 31.9988
    }),
    Ar: Object.freeze({
        refractivity: 279,
        king: 1,
        molar: 39.948
    }),
    CO2: Object.freeze({
        refractivity: 450,
        king: 1.15,
        molar: 44.0095
    }),
    H2: Object.freeze({
        refractivity: 138.6,
        king: 1.021,
        molar: 2.01588
    }),
    He: Object.freeze({
        refractivity: 34.8,
        king: 1,
        molar: 4.002602
    }),
    CH4: Object.freeze({
        refractivity: 440,
        king: 1.02,
        molar: 16.0425
    }),
    NH3: Object.freeze({
        refractivity: 373,
        king: 1,
        molar: 17.0305
    }),
    H2O: Object.freeze({
        refractivity: 261,
        king: 1.001,
        molar: 18.0153
    }),
    H2S: Object.freeze({
        refractivity: 454,
        king: 1.04,
        molar: 34.0809
    }),
    SO2: Object.freeze({
        refractivity: 453,
        king: 1.1,
        molar: 64.066
    }),
    Na: Object.freeze({
        refractivity: 200,
        king: 1,
        molar: 22.9898
    }),
    O: Object.freeze({
        refractivity: 150,
        king: 1,
        molar: 15.999
    })
});

const AIR_COMPOSITION = Object.freeze({
    N2: .78084,
    O2: .20946,
    Ar: .00934
});

const AIR_MOLAR = .78084 * 28.0134 + .20946 * 31.9988 + .00934 * 39.948;

const makeAtmosphereLayer = (name, bottomKm, topKm, temperatureK, composition, properties = {}) => Object.freeze({
    name: name,
    bottomKm: bottomKm,
    topKm: topKm,
    temperatureK: temperatureK,
    composition: composition,
    ...properties
});

const ATMOSPHERE_DATABASE = Object.freeze({
    mercury: Object.freeze({
        surfacePressurePa: 1e-9,
        surfaceTempK: 440,
        gravity: 3.7,
        composition: Object.freeze({
            Na: .5,
            O: .3,
            He: .2
        }),
        visualGain: .02,
        layers: Object.freeze([ makeAtmosphereLayer("exosphere", 0, 1800, 440, Object.freeze({
            Na: .5,
            O: .3,
            He: .2
        }), {
            pressureBottomPa: 1e-9,
            mieTau: 0,
            mieTint: 14272657,
            mieG: 0
        }) ])
    }),
    venus: Object.freeze({
        surfacePressurePa: 9.2e6,
        surfaceTempK: 735,
        gravity: 8.87,
        composition: Object.freeze({
            CO2: .965,
            N2: .035
        }),
        visualGain: .6,
        layers: Object.freeze([ makeAtmosphereLayer("dense lower atmosphere", 0, 48, 560, Object.freeze({
            CO2: .965,
            N2: .035
        }), {
            pressureBottomPa: 9.2e6,
            pressureTopPa: 4e5,
            mieTau: .5,
            mieG: .72,
            mieTint: 16777215
        }), makeAtmosphereLayer("lower cloud deck", 48, 58, 330, Object.freeze({
            CO2: .965,
            N2: .035
        }), {
            pressureBottomPa: 4e5,
            mieTau: .5,
            mieG: .7,
            mieTint: 16777215
        }), makeAtmosphereLayer("upper cloud deck", 58, 70, 250, Object.freeze({
            CO2: .965,
            N2: .035
        }), {
            mieTau: .9,
            mieG: .74,
            mieTint: 16777215
        }), makeAtmosphereLayer("upper haze", 70, 95, 210, Object.freeze({
            CO2: .965,
            N2: .035
        }), {
            mieTau: .3,
            mieG: .68,
            mieTint: 16777215
        }) ])
    }),
    earth: Object.freeze({
        surfacePressurePa: EARTH_SURFACE_PRESSURE,
        surfaceTempK: 288.15,
        gravity: EARTH_GRAVITY,
        composition: AIR_COMPOSITION,
        visualGain: 1,
        layers: Object.freeze([ makeAtmosphereLayer("troposphere", 0, 12, 255, AIR_COMPOSITION, {
            pressureBottomPa: 101325,
            mieTau: .034,
            mieG: .76,
            mieTint: 12901619
        }), makeAtmosphereLayer("stratosphere", 12, 50, 240, AIR_COMPOSITION, {
            mieTau: .01,
            mieG: .68,
            mieTint: 13230325,
            ozoneTau: Object.freeze({
                r: .028,
                g: .085,
                b: .012
            }),
            ozoneCenterKm: 25,
            ozoneWidthKm: 16
        }), makeAtmosphereLayer("mesosphere", 50, 85, 220, AIR_COMPOSITION, {
            mieTau: .002,
            mieG: .6,
            mieTint: 13230325
        }), makeAtmosphereLayer("thermosphere", 85, 420, 600, Object.freeze({
            N2: .7,
            O2: .1,
            O: .2
        }), {
            mieTau: 0,
            mieG: .6,
            mieTint: 13230325,
            edgeFade: true
        }) ])
    }),
    mars: Object.freeze({
        surfacePressurePa: 610,
        surfaceTempK: 210,
        gravity: 3.71,
        composition: Object.freeze({
            CO2: .9532,
            N2: .027,
            Ar: .016
        }),
        visualGain: .16,
        layers: Object.freeze([ makeAtmosphereLayer("dusty lower atmosphere", 0, 25, 210, Object.freeze({
            CO2: .9532,
            N2: .027,
            Ar: .016
        }), {
            pressureBottomPa: 610,
            mieTau: .24,
            mieG: .72,
            mieTint: 14201486
        }), makeAtmosphereLayer("middle atmosphere", 25, 60, 180, Object.freeze({
            CO2: .9532,
            N2: .027,
            Ar: .016
        }), {
            mieTau: .14,
            mieG: .68,
            mieTint: 13740418
        }), makeAtmosphereLayer("upper atmosphere", 60, 110, 180, Object.freeze({
            CO2: .9532,
            N2: .027,
            Ar: .016
        }), {
            mieTau: .035,
            mieG: .62,
            mieTint: 13284506,
            edgeFade: true
        }) ])
    }),
    jupiter: Object.freeze({
        surfacePressurePa: 5e4,
        surfaceTempK: 178,
        gravity: 24.79,
        composition: Object.freeze({
            H2: .898,
            He: .102
        }),
        visualGain: .19,
        layers: Object.freeze([ makeAtmosphereLayer("ammonia cloud region", 0, 25, 175, Object.freeze({
            H2: .898,
            He: .102
        }), {
            pressureBottomPa: 5e4,
            mieTau: .045,
            mieG: .64,
            mieTint: 15852738
        }), makeAtmosphereLayer("ammonium hydrosulfide region", 25, 70, 145, Object.freeze({
            H2: .885,
            He: .1,
            CH4: .015
        }), {
            mieTau: .095,
            mieG: .69,
            mieTint: 15259571
        }), makeAtmosphereLayer("water cloud and upper haze", 70, 135, 130, Object.freeze({
            H2: .88,
            He: .1,
            CH4: .02
        }), {
            mieTau: .07,
            mieG: .62,
            mieTint: 14275266,
            edgeFade: true
        }) ])
    }),
    titan: Object.freeze({
        surfacePressurePa: 146700,
        surfaceTempK: 94,
        gravity: 1.352,
        composition: Object.freeze({
            N2: .985,
            CH4: .015
        }),
        visualGain: .32,
        layers: Object.freeze([ makeAtmosphereLayer("nitrogen-methane atmosphere", 0, 60, 94, Object.freeze({
            N2: .985,
            CH4: .015
        }), {
            pressureBottomPa: 146700,
            mieTau: .08,
            mieG: .55,
            mieTint: 14464188,
            edgeFade: true
        }) ])
    }),
    saturn: Object.freeze({
        surfacePressurePa: 4e4,
        surfaceTempK: 160,
        gravity: 10.44,
        composition: Object.freeze({
            H2: .963,
            He: .0325,
            CH4: .0045
        }),
        visualGain: .115,
        layers: Object.freeze([ makeAtmosphereLayer("ammonia cloud region", 0, 35, 160, Object.freeze({
            H2: .963,
            He: .0325,
            CH4: .0045
        }), {
            pressureBottomPa: 4e4,
            mieTau: .055,
            mieG: .64,
            mieTint: 15327176
        }), makeAtmosphereLayer("ammonium hydrosulfide haze", 35, 100, 140, Object.freeze({
            H2: .96,
            He: .033,
            CH4: .007
        }), {
            mieTau: .11,
            mieG: .68,
            mieTint: 15261640
        }), makeAtmosphereLayer("water cloud and upper haze", 100, 297, 120, Object.freeze({
            H2: .96,
            He: .033,
            CH4: .007
        }), {
            mieTau: .055,
            mieG: .61,
            mieTint: 14735557,
            edgeFade: true
        }) ])
    }),
    uranus: Object.freeze({
        surfacePressurePa: 1e5,
        surfaceTempK: 76,
        gravity: 8.69,
        composition: Object.freeze({
            H2: .825,
            He: .152,
            CH4: .023
        }),
        visualGain: .19,
        layers: Object.freeze([ makeAtmosphereLayer("methane cloud region", 0, 25, 76, Object.freeze({
            H2: .825,
            He: .152,
            CH4: .023
        }), {
            pressureBottomPa: 1e5,
            mieTau: .003,
            mieG: .6,
            mieTint: 12904684,
            methaneTau: Object.freeze({
                r: .24,
                g: .07,
                b: .01
            })
        }), makeAtmosphereLayer("lower haze", 25, 75, 65, Object.freeze({
            H2: .825,
            He: .152,
            CH4: .023
        }), {
            mieTau: .004,
            mieG: .6,
            mieTint: 12904684,
            methaneTau: Object.freeze({
                r: .25,
                g: .07,
                b: .01
            })
        }), makeAtmosphereLayer("upper haze", 75, 138, 60, Object.freeze({
            H2: .825,
            He: .152,
            CH4: .023
        }), {
            mieTau: .003,
            mieG: .58,
            mieTint: 12904684,
            methaneTau: Object.freeze({
                r: .13,
                g: .03,
                b: .005
            }),
            edgeFade: true
        }) ])
    }),
    neptune: Object.freeze({
        surfacePressurePa: 1e5,
        surfaceTempK: 72,
        gravity: 11.15,
        composition: Object.freeze({
            H2: .8,
            He: .19,
            CH4: .015
        }),
        visualGain: .23,
        layers: Object.freeze([ makeAtmosphereLayer("methane cloud region", 0, 25, 72, Object.freeze({
            H2: .8,
            He: .19,
            CH4: .015
        }), {
            pressureBottomPa: 1e5,
            mieTau: .0035,
            mieG: .6,
            mieTint: 12114417,
            methaneTau: Object.freeze({
                r: .2,
                g: .05,
                b: .008
            })
        }), makeAtmosphereLayer("lower haze", 25, 60, 60, Object.freeze({
            H2: .8,
            He: .19,
            CH4: .015
        }), {
            mieTau: .0045,
            mieG: .6,
            mieTint: 12114417,
            methaneTau: Object.freeze({
                r: .2,
                g: .05,
                b: .008
            })
        }), makeAtmosphereLayer("upper haze", 60, 103, 58, Object.freeze({
            H2: .8,
            He: .19,
            CH4: .015
        }), {
            mieTau: .004,
            mieG: .58,
            mieTint: 12114417,
            methaneTau: Object.freeze({
                r: .1,
                g: .02,
                b: .004
            }),
            edgeFade: true
        }) ])
    }),
    pluto: Object.freeze({
        surfacePressurePa: 1,
        surfaceTempK: 45,
        gravity: .62,
        composition: Object.freeze({
            N2: .99,
            CH4: .005
        }),
        visualGain: .176,
        layers: Object.freeze([ makeAtmosphereLayer("nitrogen atmosphere", 0, 15, 45, Object.freeze({
            N2: .99,
            CH4: .01
        }), {
            pressureBottomPa: 1,
            mieTau: .018,
            mieG: .55,
            mieTint: 14149101
        }), makeAtmosphereLayer("photochemical haze", 15, 30, 45, Object.freeze({
            N2: .985,
            CH4: .015
        }), {
            mieTau: .012,
            mieG: .55,
            mieTint: 14149101,
            edgeFade: true
        }) ])
    })
});
// The scattering shell must reach high enough that the density is negligible
// at its top, or the shell silhouette becomes a visible hard edge. The reference
// uses ~6-12 scale heights (Earth 60 km with HR = 8, Mars 100 km with HR = 8);
// 12 covers every body in the database without wasting table resolution.
const SHELL_SCALE_HEIGHTS = 12;

const ATMOSPHERE_VIEW_SAMPLES = 16;

// Shell tessellation follows the graphics preset. The shell is a smooth sphere
// and its shading comes entirely from the fragment program, so the mesh only
// has to describe the silhouette: 256x128 is 65k triangles per body and there are
// seven shells, which is a lot of transparent geometry for no visible gain on a
// weak GPU. Low settings get a quarter of the triangles.
function atmosphereShellSegments() {
    const tier = globalThis.__solisterGraphicsTier;
    if (tier === "low") return [ 96, 48 ];
    if (tier === "medium") return [ 160, 80 ];
    return [ 256, 128 ];
}

const MIN_RENDER_OPTICAL_DEPTH = 1e-4;

function wavelengthRatio(nm) {
    return Math.pow(550 / nm, 4);
}

function meanMolarMass(composition) {
    let mass = 0;
    let share = 0;
    for (const [gas, fraction] of Object.entries(composition || {})) {
        const properties = ATMOSPHERE_GASES[gas];
        if (!properties || !(fraction > 0)) continue;
        mass += fraction * properties.molar;
        share += fraction;
    }
    return share > 0 ? mass / share : 28.97;
}

function rayleighRelativeStrength(composition) {
    let mixture = 0;
    for (const [gas, fraction] of Object.entries(composition || {})) {
        const properties = ATMOSPHERE_GASES[gas];
        if (!properties || !(fraction > 0)) continue;
        mixture += fraction * properties.refractivity * properties.refractivity * properties.king;
    }
    const reference = .78084 * 297 * 297 * 1.034 + .20946 * 270 * 270 * 1.096 + .00934 * 279 * 279;
    return mixture / Math.max(reference, 1e-9);
}

function spectrumLuminance(values) {
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}

function sumAbsorber(layers, field) {
    const total = [ 0, 0, 0 ];
    let found = false;
    for (const layer of layers) {
        const value = layer[field];
        if (!value) continue;
        found = true;
        total[0] += value.r || 0;
        total[1] += value.g || 0;
        total[2] += value.b || 0;
    }
    return found ? total : null;
}

function findAbsorberBand(layers) {
    for (const layer of layers) {
        if (layer.ozoneTau) {
            return {
                tau: layer.ozoneTau,
                centerKm: layer.ozoneCenterKm,
                widthKm: Math.max(1, layer.ozoneWidthKm)
            };
        }
    }
    return null;
}

function intensityFromOpticalDepth(opticalDepth, visualGain) {
    const root = Math.sqrt(Math.min(Math.max(opticalDepth, 0), 30));
    return Math.max(.05, Math.min(1.15, visualGain * 2.9 * root / Math.max(1 + .6 * root, 1e-6)));
}

function deriveAtmosphereLayer(layer, facts, pressureBottomPa) {
    const molarMass = meanMolarMass(layer.composition || facts.composition);
    const gravity = facts.gravity;
    const temperatureK = layer.temperatureK || facts.surfaceTempK;
    const scaleHeightKm = GAS_CONSTANT * temperatureK / (molarMass / 1e3 * gravity) / 1e3;
    const thicknessKm = Math.max(.001, layer.topKm - layer.bottomKm);
    const pressureBottom = Math.max(0, layer.pressureBottomPa ?? pressureBottomPa ?? facts.surfacePressurePa ?? 0);
    const pressureTop = Math.max(0, layer.pressureTopPa ?? pressureBottom * Math.exp(-thicknessKm / Math.max(scaleHeightKm, 1e-6)));
    const columnPressure = Math.max(0, pressureBottom - pressureTop);
    const composition = layer.composition || facts.composition;
    const tauR550 = EARTH_RAYLEIGH_TAU_550 * rayleighRelativeStrength(composition) * (AIR_MOLAR / molarMass) * (EARTH_GRAVITY / gravity) * (columnPressure / EARTH_SURFACE_PRESSURE);
    const tauR = {
        r: tauR550 * wavelengthRatio(CHANNEL_WAVELENGTHS.r),
        g: tauR550 * wavelengthRatio(CHANNEL_WAVELENGTHS.g),
        b: tauR550 * wavelengthRatio(CHANNEL_WAVELENGTHS.b)
    };
    return {
        name: layer.name,
        bottomKm: layer.bottomKm,
        topKm: layer.topKm,
        temperatureK: temperatureK,
        pressureBottomPa: pressureBottom,
        pressureTopPa: pressureTop,
        composition: composition,
        meanMolarMass: molarMass,
        scaleHeightKm: scaleHeightKm,
        tauR550: tauR550,
        tauR: tauR,
        tauM: Math.max(0, layer.mieTau || 0),
        mieExtTau: layer.mieExtTau || {
            r: Math.max(0, layer.mieTau || 0),
            g: Math.max(0, layer.mieTau || 0),
            b: Math.max(0, layer.mieTau || 0)
        },
        mieG: layer.mieG ?? .65,
        mieTint: layer.mieTint ?? 16777215,
        ozoneTau: layer.ozoneTau || null,
        ozoneCenterKm: layer.ozoneCenterKm ?? (layer.bottomKm + layer.topKm) * .5,
        ozoneWidthKm: layer.ozoneWidthKm ?? Math.max(1, thicknessKm * .35),
        methaneTau: layer.methaneTau || null,
        edgeFade: !!layer.edgeFade
    };
}

function deriveAtmosphere(key, facts = ATMOSPHERE_DATABASE[key]) {
    if (!facts) return null;
    const rawLayers = facts.layers?.length ? facts.layers : [ {
        name: "bulk atmosphere",
        bottomKm: facts.referenceKm || 0,
        topKm: facts.topKm || 0,
        temperatureK: facts.surfaceTempK,
        pressureBottomPa: facts.surfacePressurePa,
        composition: facts.composition,
        mieTau: facts.mieTau,
        mieG: facts.mieG,
        mieTint: facts.mieTint,
        ozoneTau: facts.ozoneTau,
        ozoneCenterKm: facts.ozoneHeightKm,
        ozoneWidthKm: facts.ozoneWidthKm,
        methaneTau: facts.methaneTau
    } ];
    let runningPressure = facts.surfacePressurePa || 0;
    const layers = rawLayers.map(layer => {
        const derived = deriveAtmosphereLayer(layer, facts, runningPressure);
        runningPressure = derived.pressureTopPa;
        return Object.freeze(derived);
    });
    const totalTauR = layers.reduce((sum, layer) => ({
        r: sum.r + layer.tauR.r,
        g: sum.g + layer.tauR.g,
        b: sum.b + layer.tauR.b
    }), {
        r: 0,
        g: 0,
        b: 0
    });
    const totalTauR550 = layers.reduce((sum, layer) => sum + layer.tauR550, 0);
    const totalTauM = layers.reduce((sum, layer) => sum + layer.tauM, 0);
    const opticalDepth = totalTauR550 + totalTauM;
    const totalMass = layers.reduce((sum, layer) => sum + layer.tauR550 + layer.tauM, 0);
    const scaleHeightKm = layers.reduce((sum, layer) => sum + layer.scaleHeightKm * (layer.tauR550 + layer.tauM), 0) / Math.max(totalMass, 1e-9);
    const mieTint = new THREE.Color(0, 0, 0);
    let mieWeight = 0;
    let mieG = 0;
    for (const layer of layers) {
        if (layer.tauM <= 0) continue;
        mieTint.add(new THREE.Color(layer.mieTint).multiplyScalar(layer.tauM));
        mieG += layer.mieG * layer.tauM;
        mieWeight += layer.tauM;
    }
    if (mieWeight > 0) {
        mieTint.multiplyScalar(1 / mieWeight);
        mieG /= mieWeight;
    } else {
        mieTint.set(16777215);
        mieG = .65;
    }
    const maxR = Math.max(totalTauR.r, totalTauR.g, totalTauR.b, 1e-9);
    const totalTauMExt = layers.reduce((sum, layer) => ({
        r: sum.r + layer.mieExtTau.r,
        g: sum.g + layer.mieExtTau.g,
        b: sum.b + layer.mieExtTau.b
    }), {
        r: 0,
        g: 0,
        b: 0
    });
    const methaneTau = sumAbsorber(layers, "methaneTau");
    const band = findAbsorberBand(layers);
    const topKm = Math.max(...layers.map(layer => layer.topKm));
    const shellScaleHeightKm = scaleHeightKm;
    return {
        key: key,
        layers: Object.freeze(layers),
        scaleHeightKm: scaleHeightKm,
        rayleighScaleHeightKm: shellScaleHeightKm,
        mieScaleHeightKm: shellScaleHeightKm,
        tauR: totalTauR,
        tauM: totalTauM,
        tauMExt: totalTauMExt,
        mieG: mieG,
        mieTint: mieTint.getHex(),
        methaneTau: methaneTau,
        band: band,
        spectra: {
            rayleighBeta: [ totalTauR.r / shellScaleHeightKm, totalTauR.g / shellScaleHeightKm, totalTauR.b / shellScaleHeightKm ],
            mieScatteringBeta: [ totalTauM * mieTint.r / shellScaleHeightKm, totalTauM * mieTint.g / shellScaleHeightKm, totalTauM * mieTint.b / shellScaleHeightKm ],
            mieExtinctionBeta: [ totalTauMExt.r / shellScaleHeightKm, totalTauMExt.g / shellScaleHeightKm, totalTauMExt.b / shellScaleHeightKm ]
        },
        mieFade: .1,
        intensity: intensityFromOpticalDepth(opticalDepth, facts.visualGain ?? 1),
        opticalDepth: opticalDepth,
        topKm: topKm,
        // The shell has to end where the gas has already vanished, not where the
        // profile happens to stop. A shell that tops out at five scale heights
        // (density 0.7% of the ground) ends while it is still scattering, and its
        // silhouette is a drawn circle. Twelve scale heights is e-12 of the ground
        // density: nothing left to cut.
        renderTopKm: Math.max(topKm, SHELL_SCALE_HEIGHTS * shellScaleHeightKm),
        rayleighColor: new THREE.Color(totalTauR.r / maxR, totalTauR.g / maxR, totalTauR.b / maxR).getHex(),
        referenceModel: null
    };
}

// The reference profiles are defined against their own radius scale (Jupiter 7149.2 km,
// Neptune against Earth's 6371) and applies them as a fraction of the radius.
// Verbatim on a 10x body, Jupiter's shell collapses to 0.08% and the Mie channel
// goes ten times too transparent. lengthScale restores the proportions: heights
// scale with the radius, spectra inversely, preserving beta*H and Height/Radius.
function atmosphereLengthScale(key, model) {
    if (!model) return 1;
    const reference = Math.max(model.groundRadiusKm, 1e-6);
    const real = Number(globalThis.BodyShapes?.maxRadiusKm?.(key)) || reference;
    return Math.max(real / reference, 1e-6);
}

function applyReferenceModel(key, derived, model) {
    if (!model || !derived) return derived;
    const s = atmosphereLengthScale(key, model);
    const rayleighScaleHeightKm = Math.max(model.rayleighScaleHeightKm * s, 1e-6);
    const mieScaleHeightKm = Math.max(model.mieScaleHeightKm * s, 1e-6);
    // Spectra per kilometre on the *real* planet; beta*H is unchanged.
    const rayleighBetaKm = model.rayleighBeta.map(beta => beta * model.rayleighScale / s);
    const mieScatteringBetaKm = model.mieScatteringBeta.map(beta => beta * model.mieScatteringScale / s);
    const mieExtinctionBetaKm = model.mieExtinctionBeta.map(beta => beta * model.mieExtinctionScale / s);
    const tauR = rayleighBetaKm.map((beta, i) => beta * rayleighScaleHeightKm);
    const tauMScatter = mieScatteringBetaKm.map(beta => beta * mieScaleHeightKm);
    const tauMExt = mieExtinctionBetaKm.map(beta => beta * mieScaleHeightKm);
    const tauMMax = Math.max(...tauMScatter, 1e-9);
    const tint = index => tauMScatter[index] / tauMMax;
    const opticalDepth = spectrumLuminance(tauR) + spectrumLuminance(tauMScatter);
    const root = Math.sqrt(Math.max(opticalDepth, 0));
    const shellScaleHeightKm = Math.max(rayleighScaleHeightKm, mieScaleHeightKm);
    const maxR = Math.max(...tauR, 1e-9);
    return Object.freeze({
        ...derived,
        scaleHeightKm: shellScaleHeightKm,
        rayleighScaleHeightKm: rayleighScaleHeightKm,
        mieScaleHeightKm: mieScaleHeightKm,
        spectra: {
            rayleighBeta: rayleighBetaKm,
            mieScatteringBeta: mieScatteringBetaKm,
            mieExtinctionBeta: mieExtinctionBetaKm
        },
        tauR: {
            r: tauR[0],
            g: tauR[1],
            b: tauR[2]
        },
        tauM: spectrumLuminance(tauMScatter),
        tauMExt: {
            r: Math.max(tauMExt[0], tauMScatter[0]),
            g: Math.max(tauMExt[1], tauMScatter[1]),
            b: Math.max(tauMExt[2], tauMScatter[2])
        },
        mieG: model.mieG,
        mieFade: model.mieFade ?? .1,
        mieTint: new THREE.Color(tint(0), tint(1), tint(2)).getHex(),
        methaneTau: derived.methaneTau,
        band: derived.band,
        intensity: Math.max(.05, Math.min(1.15, 2.9 * root / Math.max(1 + .6 * root, 1e-6))),
        opticalDepth: opticalDepth,
        // Same rule for the reference models: the shell is never allowed to be
        // shorter than where the atmosphere stops scattering.
        renderTopKm: Math.max(Math.max(model.topKm * s, 1), SHELL_SCALE_HEIGHTS * shellScaleHeightKm),
        rayleighColor: new THREE.Color(tauR[0] / maxR, tauR[1] / maxR, tauR[2] / maxR).getHex(),
        referenceModel: model
    });
}

// Inside-sky exposure: one constant for every body, from the physics.
// In-scatter scales with each atmosphere's real scattering coefficient and scale
// height, so this preserves the planets' true relative brightness - Venus a
// blinding haze, Earth blue, Mars dim butterscotch, the ice giants nearly black.
// No per-body gain: normalising would flatten exactly that difference.
const INSIDE_SKY_EXPOSURE = 9.0;

// Real haze tints the reference data does not carry.
const ATMOSPHERE_MIE_TINT_OVERRIDE = Object.freeze({
    venus: [ 1.0, 0.94, 0.74 ]
});

// Tint values come in two forms: a hex number (the reference
// tables; THREE.Color applies the sRGB-to-linear conversion)
// or a float array of linear components, taken verbatim (the
// override above). Passing the array to the single-argument
// Color constructor silently yields white -- the P5d2 defect
// this helper keeps fixed at both uMieTint call sites.
function atmosphereMieTintColor(value) {
    return Array.isArray(value)
        ? new THREE.Color(value[0], value[1], value[2])
        : new THREE.Color(value);
}

const PLANET_ATMOSPHERE_PROFILES = (() => {
    const profiles = {};
    for (const key of Object.keys(ATMOSPHERE_DATABASE)) {
        const derived = applyReferenceModel(key, deriveAtmosphere(key), ATMOSPHERE_REFERENCE_MODELS?.[key]);
        if (!derived) continue;
        profiles[key] = Object.freeze({
            derived: derived,
            intensity: derived.intensity,
            opticalDepth: derived.opticalDepth,
            scaleHeight: derived.scaleHeightKm,
            rayleigh: derived.rayleighColor,
            mie: derived.mieTint,
            rayleighStrength: Math.min(1.5, derived.tauR.g / .1),
            mieStrength: Math.min(1.5, derived.tauM / .1),
            reference: derived.referenceModel
        });
    }
    return Object.freeze(profiles);
})();

const ATMOSPHERE_VERTEX_GLSL = `
varying vec3 vAtmoView;
varying vec3 vWorldPos;${LDB_VERTEX_PARS}
void main(){
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vAtmoView = (viewMatrix * world).xyz;
    gl_Position = projectionMatrix * vec4(vAtmoView, 1.0);${LDB_VERTEX_TAIL}
}`;

// Shared by both atmosphere shaders (see §BE in SOLISTER-DIAGNOSIS.md).
const ATMOSPHERE_SKY_HELPERS = `// ---------------------------------------------------------------------------
// Analytic sky for a camera INSIDE the shell.
// The atlas has 32 layers in r, so at a two-metre eye the slice spacing is ~0.002
// and a grazing ray changes by orders of magnitude within one slice: black band,
// hard white line, staircased horizon. No sample count fixes a resolution limit.
// The inside view therefore integrates directly in ground-radius units, using the
// analytic slant depth for the sun ray, which is the model the tables come from.
float atmSkyOpticalDepth(float H, float r, float mu, float d) {
    float rcpH = 1.0 / max(H, 1e-9);
    float a = sqrt(0.5 * r * rcpH);
    float dr = d / max(r, 1e-9);
    vec2 a01 = a * vec2(mu, dr + mu);
    vec2 a01s = sign(a01);
    vec2 a01sq = a01 * a01;
    float x = (a01s.y > a01s.x) ? exp(a01sq.x) : 0.0;
    vec2 y = a01s / (2.3193 * abs(a01) + sqrt(1.52 * a01sq + 4.0)) * vec2(1.0, exp(-d * rcpH * (0.5 * dr + mu)));
    float od = sqrt(6.2831 * H * r) * exp((1.0 - r) * rcpH) * (x + dot(y, vec2(1.0, -1.0)));
    if (!(od >= 0.0)) od = 0.0;
    return min(od, 4096.0 * H + d);
}

// Distance from r along a ray with cosine c to the top of the shell, shortened
// to the ground intersection when the ray still meets it.
float atmRayLimit(float r, float c, float rTop) {
    float discTop = r * r * (c * c - 1.0) + rTop * rTop;
    float dTop = -r * c + sqrt(max(discTop, 0.0));
    float discGround = r * r * (c * c - 1.0) + 1.0;
    if (discGround > 0.0) {
        float dGround = -r * c - sqrt(discGround);
        if (dGround > 0.0) dTop = min(dTop, dGround);
    }
    return max(dTop, 0.0);
}

`;

const ATMOSPHERE_FRAGMENT_GLSL = `
${ATMOSPHERE_SKY_HELPERS}
uniform float intensity;
uniform float uBodyRadius;
uniform float uShellRadius;
uniform float uInsideShell;
uniform float uEyeHeightR;
uniform int uSkySamples;
uniform float uHaloEdgeStart;
uniform mat3 uViewToBodyLocal;
uniform vec3 uBodyAxisScale;
uniform float uScaleHeightR;
uniform float uScaleHeightM;
uniform vec3 uTauRayleigh;
uniform vec3 uTauMieScatter;
uniform vec3 uTauMieExt;
uniform float uMieG;
uniform vec3 uMieTint;
// Shared inside-shell sky integral (same names as the LUT path so the one
// ATMOSPHERE_SKY_INSIDE_GLSL block can be spliced into either shader).
uniform vec3 uBetaR;
uniform vec3 uBetaMS;
uniform vec3 uBetaMX;
uniform float uHR;
uniform float uHM;
uniform float uRtNorm;
uniform float uSkyGain;
uniform vec3 uAbsorbTau;
uniform vec3 uBandTau;
uniform float uBandCenter;
uniform float uBandWidth;
uniform float uBandNorm;
uniform vec3 uBodyCenterView;
uniform float uLimbDarken;
uniform float uBacklightLevel;
uniform float uDarkOcclusion;
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform sampler2D uOpticalDepth;
uniform vec2 uOpticalDepthCoeff;
uniform float uHasOpticalDepth;
uniform float uOpticalDepthMax;
uniform sampler2D uMsTable;
uniform float uHasMs;
uniform float uMsScale;
// The table stores log2(1 + tau) / uOpticalDepthMax, not tau itself, so the
// lookup has to undo that before the value can be exponentiated.
varying vec3 vAtmoView;
varying vec3 vWorldPos;
${"${eclipseSource}"}${LDB_FRAGMENT_PARS}

const float SAMPLES = ${ATMOSPHERE_VIEW_SAMPLES}.0;

// Optical depth from the per-planet CPU table, indexed by (cosChi, height):
// u = (1 - cosChi) * 0.5, v = height / atmosphereTop. The mapping inverts the one
// used to build it, so a lookup lands on the ray that was integrated.
// uOpticalDepthCoeff carries (0.5, 1.0); an extra 0.5 here was a factor-of-two
// error that under-attenuated the limb and the terminator.
vec4 sampleMultipleScatter(float cosChi, float heightNorm) {
    float u = (1.0 - clamp(cosChi, -1.0, 1.0)) * 0.5;
    float v = clamp(heightNorm, 0.0, 1.0);
    return texture2D(uMsTable, vec2(u, v)) * uMsScale;
}
vec3 sampleOpticalDepth(float cosChi, float heightNorm) {
    float u = (1.0 - clamp(cosChi, -1.0, 1.0)) * uOpticalDepthCoeff.x;
    float v = clamp(heightNorm, 0.0, 1.0) * uOpticalDepthCoeff.y;
    // Undo the log2 packing: the texel holds log2(1 + tau) / uOpticalDepthMax,
    // so scaling back and subtracting one recovers tau. The exp2/pow pair here
    // is exact rather than approximate, and the cost is one extra instruction
    // per sample on a lookup that already costs a texture fetch.
    vec3 encoded = texture2D(uOpticalDepth, vec2(u, v)).rgb * uOpticalDepthMax;
    return pow(vec3(2.0), encoded) - vec3(1.0);
}
const vec3 LUMINANCE = vec3(0.3333333);

// Analytic slant optical depth. H is the
// component scale height, r the sample radius, mu the cosine of the sun-ray zenith
// angle, d the distance to the shell top or the surface along that ray. The result
// is a length, so the caller multiplies by the extinction coefficient.
float atmOpticalDepth(float H, float r, float mu, float d) {
    float rcpH = 1.0 / max(H, 1e-9);
    float a = sqrt(0.5 * r * rcpH);
    float dr = d / max(r, 1e-9);
    vec2 a01 = a * vec2(mu, dr + mu);
    vec2 a01s = sign(a01);
    vec2 a01sq = a01 * a01;
    float x = (a01s.y > a01s.x) ? exp(a01sq.x) : 0.0;
    vec2 y = a01s / (2.3193 * abs(a01) + sqrt(1.52 * a01sq + 4.0)) * vec2(1.0, exp(-d * rcpH * (0.5 * dr + mu)));
    float od = sqrt(6.2831 * H * r) * exp((uBodyRadius - r) * rcpH) * (x + dot(y, vec2(1.0, -1.0)));
    if (!(od >= 0.0)) od = 0.0;
    return min(od, 4096.0 * H + d);
}

float rayleighPhase(float mu){ return 0.75 * (1.0 + mu * mu); }

float miePhase(float mu, float g){
    float g2 = g * g;
    return min(2.5, (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 0.035), 1.5));
}

void main(){${LDB_FRAGMENT_HEAD}
    vec3 ray = normalize(vAtmoView);
    vec3 axes = max(uBodyAxisScale, vec3(1e-6));
    vec3 rayMetric = (uViewToBodyLocal * ray) / axes;
    vec3 originMetric = (uViewToBodyLocal * (-uBodyCenterView)) / axes;
    float rayMetricSq = dot(rayMetric, rayMetric);
    if (rayMetricSq <= 1e-12) discard;
    float b = dot(originMetric, rayMetric);
    float originSq = dot(originMetric, originMetric);
    float outerDiscriminant = b * b - rayMetricSq * (originSq - uShellRadius * uShellRadius);
    if (outerDiscriminant <= 0.0) discard;
    float outerRoot = sqrt(outerDiscriminant);
    float start = max(0.0, (-b - outerRoot) / rayMetricSq);
    float finish = (-b + outerRoot) / rayMetricSq;
    float innerDiscriminant = b * b - rayMetricSq * (originSq - uBodyRadius * uBodyRadius);
    if (innerDiscriminant > 0.0) {
        float bodyEntry = (-b - sqrt(innerDiscriminant)) / rayMetricSq;
        if (bodyEntry > start) finish = min(finish, bodyEntry);
    }
    // Whether this view ray still hits the surface behind the atmosphere.
    // Used below to treat the on-disc rim and the off-disc halo differently.
    float bodyHit = innerDiscriminant > 0.0 ? 1.0 : 0.0;
    // Round-11: hit/miss used to be a step exactly at the silhouette, and the
    // on-disc rim dim flipped 1.0 -> 0.35 across that one pixel - the visible
    // "boundary line" where atmosphere met space. Blend on grazing depth
    // instead: perpDist is the ray's closest approach to the body centre in
    // metric space, grazeDepth > 0 means it passes below the tangent, and the
    // band straddles the limb over ~1-3 degrees so the rim treatment eases in.
    float perpDist = length(cross(originMetric, rayMetric)) / max(sqrt(rayMetricSq), 1e-9);
    float grazeDepth = (uBodyRadius - perpDist) / max(uBodyRadius, 1e-8);
    float rimBlend = smoothstep(-0.02, 0.06, grazeDepth);
    if (finish <= start) discard;
    float chord = finish - start;
    float bodyRadius = max(uBodyRadius, 1e-8);
    float step = 1.0 / SAMPLES;
    float stepLength = step * chord;
    float weight = step * chord / bodyRadius;
    float inverseHeightR = 1.0 / max(uScaleHeightR, 1e-9);
    float inverseHeightM = 1.0 / max(uScaleHeightM, 1e-9);
    float grazingTerm = 2.0 * max(uScaleHeightR, 1e-9) / bodyRadius;
    // Round-11: taper the medium to zero across the outer 30% of the shell so
    // the march never ends abruptly at uShellRadius - that hard end drew a
    // faint circular edge against space. With the density fading out, tau,
    // alpha and radiance all approach zero smoothly and the halo blends
    // seamlessly; the alpha discard below then only fires where values are
    // truly nil.
    float shellFadeStart = uShellRadius - max((uShellRadius - uBodyRadius) * 0.30, 1e-6);
    vec3 sun = normalize(uSunDir);
    vec3 sunBodyLocal = normalize(uViewToBodyLocal * sun);
    float mu = dot(-ray, sun);
    float phaseR = rayleighPhase(mu);
    float phaseM = miePhase(mu, uMieG);
    vec3 tauView = vec3(0.0);
    vec3 scatter = vec3(0.0);
    float sunAccum = 0.0;
    for (int i = 0; i < ${ATMOSPHERE_VIEW_SAMPLES}; i++) {
        vec3 pointMetric = originMetric + rayMetric * (start + (float(i) + 0.5) * stepLength);
        float rMetric = length(pointMetric);
        float altitude = max(0.0, rMetric - uBodyRadius);
        float shellFade = 1.0 - smoothstep(shellFadeStart, uShellRadius, rMetric);
        float densityR = exp(-altitude * inverseHeightR) * shellFade;
        if (densityR < 1e-5) continue;
        float densityM = exp(-altitude * inverseHeightM) * shellFade;
        vec3 bandRate = vec3(0.0);
#if ATMOSPHERE_HAS_BAND
        float bandOffset = (altitude / bodyRadius - uBandCenter) / uBandWidth;
        bandRate = uBandTau * (exp(-bandOffset * bandOffset) * uBandNorm);
#endif
        float sunMu = dot(normalize(pointMetric / axes), sunBodyLocal);
        vec3 extinction = uTauRayleigh * densityR + uTauMieExt * densityM + uAbsorbTau * densityR + bandRate;
        vec3 sunTau;
        if (uHasOpticalDepth > 0.5) {
            // Table lookup: the true integral of extinction from this sample
            // out to the top of the atmosphere along the sun ray. This is what
            // the closed-form slant below only approximates, and the
            // difference shows up at the limb, where the slant model
            // systematically under-thickens grazing rays.
            sunTau = sampleOpticalDepth(sunMu, altitude / max(uShellRadius - uBodyRadius, 1e-9))
                + bandRate * uBandWidth;
        } else {
            // No table for this body: analytic transmittance, integrating the
            // exponential density along the real sun ray. dSun shortens to the
            // surface where the body blocks the sun; beta is per body radius,
            // hence the division.
            vec3 sunMetricDir = normalize((uViewToBodyLocal * sun) / axes);
            float pDotS = dot(pointMetric, sunMetricDir);
            float pSq = dot(pointMetric, pointMetric);
            float muSun = clamp(pDotS / max(rMetric, 1e-9), -1.0, 1.0);
            float topDisc = pDotS * pDotS - (pSq - uShellRadius * uShellRadius);
            float dSun = topDisc > 0.0 ? max(-pDotS + sqrt(topDisc), 0.0) : 0.0;
            float sunBodyDisc = pDotS * pDotS - (pSq - uBodyRadius * uBodyRadius);
            if (sunBodyDisc > 0.0) {
                float tBodyEntry = -pDotS - sqrt(sunBodyDisc);
                if (tBodyEntry > 0.0 && tBodyEntry < dSun) dSun = tBodyEntry;
            }
            sunTau = (uTauRayleigh * atmOpticalDepth(uScaleHeightR, rMetric, muSun, dSun)
                + uTauMieExt * atmOpticalDepth(uScaleHeightM, rMetric, muSun, dSun)
                + uAbsorbTau * atmOpticalDepth(uScaleHeightR, rMetric, muSun, dSun)) / bodyRadius
                + bandRate * uBandWidth;
        }
        vec3 sunTransmit = exp(-min(max(sunTau, vec3(0.0)), vec3(9.0))) * smoothstep(-0.12, 0.22, sunMu);
        vec3 viewTransmit = exp(-min(max(tauView, vec3(0.0)), vec3(9.0)));
        scatter += (uTauRayleigh * densityR * phaseR + uTauMieScatter * densityM * phaseM * uMieTint) *
            sunTransmit * viewTransmit * weight;
        if (uHasMs > 0.5) {
            // Higher-order scattering, Bruneton style: the
            // precomputed ambient table gives the sunlight that reaches this
            // sample after earlier scattering orders (phase-averaged around
            // the point), and the sample re-scatters a share of it toward the
            // camera. This is what keeps the terminator and the night limb
            // alive; it replaces the constant lift used before.
            vec4 msAmbient = sampleMultipleScatter(sunMu, altitude / max(uShellRadius - uBodyRadius, 1e-9));
            vec3 msSource = uTauRayleigh * densityR * msAmbient.rgb
                + (uTauMieScatter * densityM * uMieTint) * msAmbient.a;
            scatter += msSource * viewTransmit * weight * 0.6;
        }
        tauView += extinction * weight;
        sunAccum += dot(sunTransmit, LUMINANCE);
    }
    vec3 transmittance = exp(-min(max(tauView, vec3(0.0)), vec3(9.0)));
    float avgSun = sunAccum / SAMPLES;

    // scatter is an optical-depth-weighted SUM, not radiance: a grazing ray through
    // Earth's limb reaches tau ~20 and clips white. Dividing by tauView gives a
    // bounded mean single-scatter, times (1 - transmittance) the share this ray
    // collects, the standard albedo * (1 - T) form. tauView is capped at 9, where
    // transmittance has already saturated; beyond it the division only darkens the
    // horizon into a hard band.
    vec3 meanResponse = max(scatter, vec3(0.0)) / max(min(tauView, vec3(9.0)), vec3(1e-5));
    vec3 radiance = meanResponse * (1.0 - transmittance);

    // Ambient multiple-scatter floor so a thick limb's far side is not perfectly
    // black. Gated on avgSun alone: ungated it lit the unlit hemisphere and gave the
    // night limb a blue halo. Calibrated together with the physical multiple-scatter
    // term, which carries the sun-coupled, height-dependent part.
    vec3 rayleighShare = uTauRayleigh / max(uTauRayleigh + uTauMieScatter, vec3(1e-5));
    radiance += rayleighShare * (1.0 - transmittance) * (0.35 * avgSun) * (phaseR * 0.18 + 0.06);

    radiance *= uSunIntensity * intensity;

    // On-disc rim: rays grazing the silhouette while still hitting the surface stack
    // a long chord of in-scatter over an already lit ground and clip to a colourless
    // band. The cap opens so the surface shows through, and the additive in-scatter
    // is dimmed before the knee so the rolloff keeps its Rayleigh/Mie tint.
    // Outside view only: inside the shell there is no disc, and switching at the
    // base-sphere horizon drew a hard line through the ground view.
    // uLimbDarken is the per-body switch; Venus runs it at 0 because its disc IS
    // atmosphere and a dimmed rim read as a dark ring.
    float rim = rimBlend * (1.0 - uInsideShell) * uLimbDarken;
    float alpha = clamp(1.0 - dot(transmittance, LUMINANCE), 0.0, mix(0.88, 0.66, rim));
    // "No light, no lid." alpha is 1 - T: a pure extinction term, and it does not
    // depend on how much sunlight reaches the body. The giant planets sit at the
    // exposure floor (Uranus 0.0025), so the shell emitted almost nothing while
    // still occluding at full strength, and painted a black ring around a sunlit
    // disc. Occlusion is weighted by the light the shell actually produced.
    alpha *= smoothstep(0.0, 0.02, dot(radiance, LUMINANCE));
    radiance *= mix(1.0, 0.35, rim * alpha);

    // Backlit roll-off. With the Sun behind the body, every limb ray is a
    // forward-scatter ray and the Mie phase peak turns the whole circumference
    // into a saturated white wire - the night-side half of the "metal ring".
    // Real backlit limbs are bright, but an un-tone-mapped pipeline cannot hold
    // that highlight, so ease the backlit case down toward a twilight arc.
    // Gibbous and crescent views (sun toward the camera) are untouched.
    float backlight = smoothstep(-0.15, -0.75, dot(normalize(uSunDir), normalize(-uBodyCenterView)));
    // uBacklightLevel is per-body: 0.45 keeps the twilight arc elsewhere, but
    // Saturn and Jupiter run at 0 - the residual backlit ring around their
    // dark discs was the camera-tracking "circle" the user asked (twice) to
    // have removed. Only the fully backlit view changes; gibbous and lit-side
    // renders are untouched.
    radiance *= mix(1.0, mix(1.0, uBacklightLevel, backlight), uLimbDarken);

    // Filled sky from the ground. Single scatter gives the zenith only (1 - T) of
    // full daylight, ~23% on Earth, which reads as a coronal wash over black. The
    // real sky is light recirculating between scattering events, so sum the series:
    // gain = 1 / (1 - albedo * T). Bounded, exterior views untouched, and it
    // brightens toward the horizon where T falls.
    if (uInsideShell > 0.5) {
        float scatSum = dot(uTauRayleigh + uTauMieScatter, LUMINANCE);
        float extSum = dot(uTauRayleigh + uTauMieExt + uAbsorbTau, LUMINANCE);
        float skyAlbedo = clamp(scatSum / max(extSum, 1e-5), 0.0, 0.94);
        radiance /= max(1.0 - skyAlbedo * dot(transmittance, LUMINANCE), 0.06);
    }

    // Soft knee. This material is toneMapped:false and the renderer runs with no
    // tone mapping, so an unbounded limb would clip to flat white; this rolls the
    // highlight off instead. The gain is deliberately gentle: a hard knee
    // saturates the whole limb to colourless white, which against the dark side
    // reads as a chrome trim ring - the "metallic" look users report. Rolling
    // off later keeps Rayleigh blue / Mie white hue separation in the limb.
    radiance = vec3(1.0) - exp(-radiance * 1.05);

    // Finite-value guard. A single non-finite channel anywhere in the march
    // (driver-dependent half-float texture behaviour on some GPUs, most visible
    // on Saturn's unlit side where every term is near an underflow boundary)
    // paints single-channel streaks across the shell - the red/green lines
    // reported there. step()/lessThanEqual() compare false against NaN, so any
    // channel that is not within a sane bound is zeroed instead of streamed.
    radiance = mix(vec3(0.0), radiance, vec3(lessThanEqual(abs(radiance), vec3(1.0))));
    if (!(alpha >= 0.0)) alpha = 0.0;

    // Horizon melt (round-16): from outside, the shell sphere's silhouette
    // used to end the halo in one pixel step wherever the grazing-ray
    // radiance was still above the discard floor - a visible ring against
    // the galaxy. Fade radiance and alpha out across the outermost band
    // of the disc so the atmosphere dissolves into the dark background
    // with no boundary.
    if (uInsideShell < 0.5) {
        float haloEdge = 1.0 - smoothstep(uHaloEdgeStart, 1.0, perpDist / max(uShellRadius, 1e-8));
        radiance *= haloEdge;
        alpha *= haloEdge;
    }

    // How much background the shell hides. alpha does NOT multiply radiance: the
    // material is premultiplied, so out = inscatter + background * transmittance.
    // With plain alpha blending a daytime zenith came out ~11% opaque and you saw
    // through it into black space.

    // A fully backlit shell must not occlude either, or it draws a camera-tracking
    // disc across the rings and stars behind the dark planet. uDarkOcclusion is 0 for
    // Saturn and Jupiter, 1 elsewhere: their shell fades out completely, radiance and
    // occlusion both, and nothing else changes.
    alpha *= mix(1.0, uDarkOcclusion, backlight);
    float eclipseVisibility = 1.0;${"${eclipseFactor}"}
    radiance *= eclipseVisibility;
    if (alpha < 0.0005 && max(radiance.r, max(radiance.g, radiance.b)) < 0.002) discard;
    gl_FragColor = vec4(radiance, alpha);
    #include <colorspace_fragment>
}`;

// Inside the shell the atlas is replaced by the direct integral (see
// atmSkyOpticalDepth above). This is spliced into the shader body just before
// the eclipse term so the outside view keeps the tables byte for byte.
const ATMOSPHERE_SKY_INSIDE_GLSL = `
    if (uInsideShell > 0.5) {
        // originMetric/rayMetric are in model units (Earth's radius is 0.051 here).
        // The inside integral works in GROUND RADII - uHR, uHM, uBetaR, uRtNorm - so
        // the eye position must be converted. Left in model units the origin sits at
        // 0.05, length(p) stays pinned at its 1.0 clamp and the whole path integrates
        // at sea-level density, ~8x too much optical depth, which kills blue first
        // and leaves an orange sky.
        float rgToBody = max(uBodyRadius, 1e-12);
        vec3 originMetricR = originMetric / rgToBody;
        vec3 skyDirKm = rayMetric / max(sqrt(rayMetricSq), 1e-9);
        vec3 skySunKm = normalize((uViewToBodyLocal * sun) / axes);
        // Anchor the shell to the LOCAL surface, not the datum sphere. Terrain in a
        // basin sits below the datum (Hellas reaches 7 km down), so a 1.0 clamp pinned
        // r0 to 1.0, the ground-intersection root degenerated to 0, no ray ever hit
        // the ground, every path became the full chord and the shell painted a dim
        // wash over the whole surface.
        float r0 = max(length(originMetricR), 1.0 + max(uEyeHeightR, 1e-7));
        vec3 up0 = originMetricR / max(length(originMetricR), 1e-9);
        float mu0 = dot(up0, skyDirKm);
        // At the tangent the line of sight stops meeting the ground and starts
        // running out to the far wall of the shell: the path jumps from a few
        // hundred kilometres to the full chord, and the in-scatter with it. That
        // is a real geometric edge, but it lands on one pixel and reads as a
        // drawn line. Ease the segment length across a third of a degree so the
        // two meet through haze instead.
        float discTop0 = r0 * r0 * (mu0 * mu0 - 1.0) + uRtNorm * uRtNorm;
        float segTop = -r0 * mu0 + sqrt(max(discTop0, 0.0));
        float discGround0 = r0 * r0 * (mu0 * mu0 - 1.0) + 1.0;
        float segGround = segTop;
        if (discGround0 > 0.0) {
            float dG = -r0 * mu0 - sqrt(discGround0);
            if (dG > 0.0) segGround = min(segGround, dG);
        }
        float muHorizon = -sqrt(max(1.0 - 1.0 / (r0 * r0), 0.0));
        float horizonBlend = smoothstep(muHorizon - 0.014, muHorizon + 0.014, mu0);
        // Both sides of the geometric edge are integrated exactly, then mixed.
        // Averaging the path lengths instead invents a half-length ray and dips the
        // sky just above the horizon, a dark hairline where the light should be.
        // The reference phase form is computed here because the two shaders normalise
        // phaseR/phaseM differently, which made the fallback ~3x brighter.
        float skyMu = dot(skyDirKm, skySunKm);
        // 0.75 / 4pi is the 3 / 16pi Rayleigh phase. Literal pi, not
        // ATM_PI: that macro lives inside the LUT shader only, so referencing it
        // here fails to compile on the march path.
        float skyPhaseR = 0.75 / (4.0 * 3.141592653589793) * (1.0 + skyMu * skyMu);
        float skyG2 = uMieG * uMieG;
        float skyPhaseM = 1.5 / (4.0 * 3.141592653589793) * (1.0 - skyG2)
                        * pow(max(1.0 + skyG2 - 2.0 * uMieG * skyMu, 1e-6), -1.5)
                        * (1.0 + skyMu * skyMu) / (2.0 + skyG2);
        // The loop bound must be constant in GLSL ES 1.0; the number of samples taken
        // is a uniform. This runs on every pixel of a surface view with ~4
        // transcendental calls per sample, so the graphics tier sets it: 8 low, 16
        // medium, 32 high. Dithering makes 8 indistinguishable at 1x.
        const int SKY_SAMPLES_MAX = 32;
        int skySamples = clamp(uSkySamples, 1, SKY_SAMPLES_MAX);
        // Per-pixel dither for the sample offsets. A fixed sampling pattern has
        // the same quantisation error in neighbouring pixels, so the error is
        // coherent and shows up as rings and moire; offsetting each pixel's
        // samples by a hash turns that into fine noise, which the eye does not
        // pick out and the tonemap averages away. Interleaved gradient noise:
        // cheap, and better distributed than fract(sin(dot(...))).
        float skyDither = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
        // Above the horizon the ray never meets the ground and both distances
        // are the same length: integrate once. Below it they differ and the
        // pixel mixes the two exact integrals.
        bool splitPaths = abs(segTop - segGround) > 1e-6;
        vec3 scatter = vec3(0.0);
        vec3 tauView = vec3(0.0);
        for (int pass = 0; pass < 2; pass++) {
            if (pass == 1 && !splitPaths) break;
            float len = splitPaths ? (pass == 0 ? segGround : segTop) : segTop;
            float w = splitPaths ? (pass == 0 ? 1.0 - horizonBlend : horizonBlend) : 1.0;
            if (w < 1e-4) continue;
            // Geometric spacing, not uniform. The density falls off
            // exponentially, so a grazing ray (len of hundreds of scale
            // heights) spends almost all of a uniform budget in air that is
            // already empty, while the near samples - the ones that matter -
            // are far too coarse. SARM_PUSH clusters samples towards the eye
            // and the last one still lands exactly on the far end.
            const float SARM_PUSH = 6.0;
            float skyLen = max(len, 1e-7);
            vec3 passScatter = vec3(0.0);
            float prevT = 0.0;
            for (int i = 0; i < SKY_SAMPLES_MAX; i++) {
                if (i >= skySamples) break;
                float u = (float(i) + 0.5 + skyDither) / float(skySamples);
                u = clamp(u, 0.0, 1.0);
                float tEnd = skyLen * (exp(SARM_PUSH * u) - 1.0) / (exp(SARM_PUSH) - 1.0);
                float tMid = 0.5 * (prevT + tEnd);
                float dsLen = max(tEnd - prevT, 1e-9);
                prevT = tEnd;
                vec3 p = originMetricR + skyDirKm * tMid;
                float r = max(length(p), 1.0);
                vec3 up = p / r;
                float h = max(r - 1.0, 0.0);
                float densityR = exp(-h / uHR);
                float densityM = exp(-h / uHM);
                float sunMu = dot(up, skySunKm);
                float sunDist = atmRayLimit(r, sunMu, uRtNorm);
                vec3 sunTau = uBetaR * atmSkyOpticalDepth(uHR, r, sunMu, sunDist)
                            + uBetaMX * atmSkyOpticalDepth(uHM, r, sunMu, sunDist);
                vec3 sunT = exp(-min(max(sunTau, vec3(0.0)), vec3(9.0)))
                          * smoothstep(-0.12, 0.22, sunMu);
                // Optical depth from the analytic slant form, not accumulated from the
                // step lengths: a fixed sample count carries an error that grows
                // coherently with path length and rings the ground at grazing angles.
                vec3 tauToSample = uBetaR * atmSkyOpticalDepth(uHR, r0, mu0, tMid)
                                 + uBetaMX * atmSkyOpticalDepth(uHM, r0, mu0, tMid);
                vec3 viewT = exp(-min(tauToSample, vec3(9.0)));
                passScatter += (uBetaR * densityR * skyPhaseR + uBetaMS * uMieTint * densityM * skyPhaseM)
                             * sunT * viewT * dsLen;
            }
            vec3 passTau = uBetaR * atmSkyOpticalDepth(uHR, r0, mu0, skyLen)
                         + uBetaMX * atmSkyOpticalDepth(uHM, r0, mu0, skyLen);
            scatter += passScatter * w;
            tauView += passTau * w;
        }
        // Sky radiance is an absolute integral, not a mean: never divide it by the
        // accumulated optical depth, which turns the horizon black.
        // Hue-preserving knee: compressing per channel desaturates wherever two
        // channels clip (Mars went neutral grey). Compress by luminance and scale the
        // colour by the same factor, so brightness rolls off and hue survives.
        vec3 scatterGain = max(scatter, vec3(0.0)) * uSunIntensity * intensity * uSkyGain;
        float scatterL = dot(scatterGain, LUMINANCE);
        float knee = 1.0 - exp(-max(scatterL, 0.0));
        radiance = scatterGain * (knee / max(scatterL, 1e-6));
        // Gamut fit. A strongly blue sky (Neptune's Rayleigh ratio is 1:2.3:5.7)
        // reaches display white in blue long before its luminance is near the
        // knee, so the channel clipped at 1.0 and the sky lost its hue. Scale
        // the whole colour down by the peak channel instead: hue survives, only
        // the brightest colour gives up a little luminance.
        float scatterPeak = max(radiance.r, max(radiance.g, radiance.b));
        radiance /= max(1.0, scatterPeak);
        vec3 viewTransmit = exp(-min(tauView, vec3(9.0)));
        alpha = clamp(1.0 - dot(viewTransmit, LUMINANCE), 0.0, 1.0);
    }
`;

// Bruneton runtime shell: same geometry, framing and composite as the march
// below, but scattering comes from the tables built by buildBrunetonLuts - single
// and multiple scatter, ground bounce, terminator and night side. The march is the
// fallback for hardware that cannot build the tables.
const ATMOSPHERE_FRAGMENT_SE_GLSL = `
${ATMOSPHERE_SKY_HELPERS}
uniform float intensity;
uniform float uBodyRadius;
uniform float uShellRadius;
uniform float uInsideShell;
uniform float uEyeHeightR;
uniform int uSkySamples;
uniform float uHaloEdgeStart;
uniform mat3 uViewToBodyLocal;
uniform vec3 uBodyAxisScale;
uniform vec3 uBodyCenterView;
uniform float uLimbDarken;
uniform float uBacklightLevel;
uniform float uDarkOcclusion;
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform sampler2D uTransmittanceLut;
uniform sampler2D uInscatterLut;
uniform float uRgKm;
uniform float uRtNorm;
uniform vec3 uBetaR;
uniform vec3 uBetaMS;      // Mie scattering, per ground radius
uniform vec3 uMieTint;     // Mie scattering colour
uniform vec3 uBetaMX;      // Mie extinction, per ground radius
uniform float uHR;         // Rayleigh scale height, ground radii
uniform float uHM;         // Mie scale height, ground radii
uniform float uSkyGain;    // inside-view exposure
uniform float uMieG;
uniform float uMieFade;
uniform float uLutGain;
varying vec3 vAtmoView;
varying vec3 vWorldPos;
${"${eclipseSource}"}${LDB_FRAGMENT_PARS}

const vec3 LUMINANCE = vec3(0.3333333);
#define ATM_PI 3.141592653589793
#define RES_R 32.0
#define RES_MU 64.0
#define RES_MU_S 32.0
#define RES_NU 8.0

vec2 atmTransmittanceUV(float r, float mu) {
    float uR = sqrt(clamp((r - 1.0) / max(uRtNorm - 1.0, 1e-6), 0.0, 1.0));
    float uMu = atan((mu + 0.15) / 1.15 * tan(1.5)) / 1.5;
    return vec2(clamp(uMu, 0.0, 1.0), uR);
}

vec3 atmTransmittance(float r, float mu) {
    return texture2D(uTransmittanceLut, atmTransmittanceUV(clamp(r, 1.0, uRtNorm), clamp(mu, -1.0, 1.0))).rgb;
}

vec3 atmTransmittanceBetween(float r, float mu, float r1, float mu1) {
    vec3 result;
    if (mu > 0.0) {
        result = min(atmTransmittance(r, mu) / max(atmTransmittance(r1, mu1), vec3(1e-6)), vec3(1.0));
    } else {
        result = min(atmTransmittance(r1, -mu1) / max(atmTransmittance(r, -mu), vec3(1e-6)), vec3(1.0));
    }
    return result;
}

float atmPhaseR(float mu) {
    return (3.0 / (16.0 * ATM_PI)) * (1.0 + mu * mu);
}

float atmPhaseM(float mu) {
    float g = uMieG;
    return 1.5 * 1.0 / (4.0 * ATM_PI) * (1.0 - g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-6), -1.5) * (1.0 + mu * mu) / (2.0 + g * g);
}

// The Mie coefficient is w * Rayleigh.r / max(rayMie.x, 1e-4) * (rayMie.rgb / Rayleigh.rgb),
// and in exact arithmetic every channel is the same w. In float the ground
// difference cancels the Rayleigh channels where eye and surface meet, the divide
// hits the 1e-4 floor and the Mie term explodes (a saturated blue Saturn). Returning
// w directly is that same value without the division.
vec3 atmGetMie(vec4 rayMie) {
    return vec3(max(rayMie.w, 0.0));
}

vec4 atmTexture4D(float r, float mu, float muS, float nu) {
    float H = sqrt(max(uRtNorm * uRtNorm - 1.0, 1e-9));
    float rho = sqrt(max(r * r - 1.0, 0.0));
    float rmu = r * mu;
    float delta = rmu * rmu - r * r + 1.0;
    vec4 cst = (rmu < 0.0 && delta > 0.0)
        ? vec4(1.0, 0.0, 0.0, 0.5 - 0.5 / RES_MU)
        : vec4(-1.0, H * H, H, 0.5 + 0.5 / RES_MU);
    float uR = 0.5 / RES_R + rho / H * (1.0 - 1.0 / RES_R);
    // At the ground rho is exactly 0 and the ground branch has cst.z = 0, so
    // the ratio below is 0/0 and the texel coordinate comes out NaN (which
    // samples as garbage, not as zero).  Guard the denominator: the limit is
    // finite and the epsilon only moves the lookup by a fraction of a texel.
    float denom = max(rho + cst.z, 1e-5);
    float uMu = cst.w + (rmu * cst.x + sqrt(max(delta + cst.y, 0.0))) / denom * (0.5 - 1.0 / RES_MU);
    float uMuS = 0.5 / RES_MU_S + (atan(max(muS, -0.1975) * tan(1.26 * 1.1)) / 1.1 + (1.0 - 0.26)) * 0.5 * (1.0 - 1.0 / RES_MU_S);
    uMuS = clamp(uMuS, 0.5 / RES_MU_S, 1.0 - 0.5 / RES_MU_S);
    float lerpNu = (clamp(nu, -1.0, 1.0) + 1.0) / 2.0 * (RES_NU - 1.0);
    float uNu = floor(lerpNu);
    float fNu = lerpNu - uNu;
    float sliceF = clamp(uR, 0.0, 1.0) * RES_R - 0.5;
    float s0 = clamp(floor(sliceF), 0.0, RES_R - 2.0);
    float fR = clamp(sliceF - s0, 0.0, 1.0);
    vec4 lo = texture2D(uInscatterLut, vec2((uNu + uMuS) / RES_NU, (s0 + uMu) / RES_R)) * (1.0 - fNu)
            + texture2D(uInscatterLut, vec2((uNu + 1.0 + uMuS) / RES_NU, (s0 + uMu) / RES_R)) * fNu;
    vec4 hi = texture2D(uInscatterLut, vec2((uNu + uMuS) / RES_NU, (s0 + 1.0 + uMu) / RES_R)) * (1.0 - fNu)
            + texture2D(uInscatterLut, vec2((uNu + 1.0 + uMuS) / RES_NU, (s0 + 1.0 + uMu) / RES_R)) * fNu;
    return lo * (1.0 - fR) + hi * fR;
}

void main(){${LDB_FRAGMENT_HEAD}
    vec3 ray = normalize(vAtmoView);
    vec3 axes = max(uBodyAxisScale, vec3(1e-6));
    vec3 rayMetric = (uViewToBodyLocal * ray) / axes;
    vec3 originMetric = (uViewToBodyLocal * (-uBodyCenterView)) / axes;
    float rayMetricSq = dot(rayMetric, rayMetric);
    if (rayMetricSq <= 1e-12) discard;
    float b = dot(originMetric, rayMetric);
    float originSq = dot(originMetric, originMetric);
    float outerDiscriminant = b * b - rayMetricSq * (originSq - uShellRadius * uShellRadius);
    if (outerDiscriminant <= 0.0) discard;
    float outerRoot = sqrt(outerDiscriminant);
    float start = max(0.0, (-b - outerRoot) / rayMetricSq);
    float finish = (-b + outerRoot) / rayMetricSq;
    float innerDiscriminant = b * b - rayMetricSq * (originSq - uBodyRadius * uBodyRadius);
    if (innerDiscriminant > 0.0) {
        float bodyEntry = (-b - sqrt(innerDiscriminant)) / rayMetricSq;
        if (bodyEntry > start) finish = min(finish, bodyEntry);
    }
    float bodyEntry = innerDiscriminant > 0.0
        ? (-b - sqrt(innerDiscriminant)) / rayMetricSq : -1.0;
    // The ray really reaches the ground only if the ground intersection is
    // ahead of the shell entry (a camera inside the shell looking outward
    // would otherwise be treated as a surface ray).
    float bodyHit = (innerDiscriminant > 0.0 && bodyEntry > start) ? 1.0 : 0.0;
    if (bodyHit > 0.5) finish = min(finish, bodyEntry);
    if (finish <= start) discard;
    // Draw only the shell surface the ray meets first: the near surface seen
    // from outside, the far surface seen from inside.  gl_FrontFacing is not
    // reliable on the degenerate triangles that fan out at a sphere's poles,
    // which left a visible crease there; the distance test against the
    // segment midpoint is exact everywhere and needs no winding.
    float fragDist = length(vAtmoView);
    bool nearSurface = fragDist < 0.5 * (start + finish);
    if (uInsideShell < 0.5 ? !nearSurface : nearSurface) discard;
    float bodyRadius = max(uBodyRadius, 1e-8);
    vec3 sun = normalize(uSunDir);

    // Bruneton core, in kilometres in the (sphericalised) body frame.
    float kmPerUnit = uRgKm / bodyRadius;
    vec3 dirKm = rayMetric / max(sqrt(rayMetricSq), 1e-9);
    vec3 sunKm = normalize((uViewToBodyLocal * sun) / axes);

    // The tables describe a ray from its entry into the atmosphere to its exit, so the
    // eye side of the ground difference is evaluated AT THE ENTRY POINT: outside the
    // shell rE = Rt and muE is the ray's cosine there. Evaluating at the camera and
    // clamping collapses every distant view onto one texel.
    // Lookups stay strictly above the ground radius; layer 0 already is that shell.
    float rGround = 1.0 + 1e-3 * max(uRtNorm - 1.0, 1e-6);
    vec3 eyeKm = (originMetric + rayMetric * start) * kmPerUnit;
    float eyeLen = max(length(eyeKm), 1e-6);
    vec3 upE = eyeKm / eyeLen;
    float rE = clamp(eyeLen / uRgKm, rGround, uRtNorm - 1e-5);
    float muE = dot(upE, dirKm);
    float muSun = dot(upE, sunKm);
    float nu = clamp(dot(dirKm, sunKm), -1.0, 1.0);
    vec3 fragKm = (originMetric + rayMetric * finish) * kmPerUnit;
    float fragLen = max(length(fragKm), 1e-6);
    vec3 upF = fragKm / fragLen;
    float rF = clamp(fragLen / uRgKm, rGround, uRtNorm - 1e-5);
    float muF = dot(upF, dirKm);
    float muSF = dot(upF, sunKm);

    vec3 transmittance = atmTransmittanceBetween(rE, muE, rF, muF);
    float phaseR = atmPhaseR(nu);
    float phaseM = atmPhaseM(nu);

    // S[L]|x - T(x,xs) S[L]|xs  (the in-scatter decomposition).
    // The Mie channel is faded once, after the subtraction, exactly as the
    // reference does; fading the eye and the surface term separately (as the
    // previous revision did) double-damped Mie around the terminator.
    vec4 inScatter = max(atmTexture4D(rE, muE, muSun, nu), vec4(0.0));
    if (bodyHit > 0.5 && uInsideShell < 0.5) {
        vec4 fragS = max(atmTexture4D(rF, muF, muSF, nu), vec4(0.0));
        inScatter = max(inScatter - vec4(transmittance, transmittance.r) * fragS, vec4(0.0));
    }
    inScatter.a *= smoothstep(0.0, max(uMieFade, 1e-3), muSun);
    vec3 radiance = max(inScatter.rgb * phaseR + atmGetMie(inScatter) * phaseM, vec3(0.0));

    // Exposure. The tables are in solar-irradiance-1 units,
    // so the photo-scaled radiance needs the same order of magnitude as the
    // planetary surface; uLutGain carries that, and the soft knee below maps
    // it into display range without clipping the limb.
    radiance *= uSunIntensity * intensity * uLutGain;
    radiance = mix(vec3(0.0), radiance, vec3(greaterThanEqual(radiance, vec3(0.0))));
    radiance = vec3(1.0) - exp(-radiance);

    // The shell has to vanish at its own silhouette. Right at the rim the chord
    // through the atmosphere goes to zero, so there is nothing there to scatter
    // and nothing to occlude -- but the tables and the Mie tail still return a
    // little light, and what that draws is a faint ring with a hard outer edge:
    // a shell, visible as a shell, exactly where the sky should hand over to
    // space. Fading by the chord itself removes it: no path, no light.
    float shellChordKm = max(finish - start, 0.0) * kmPerUnit;
    float shellThicknessKm = max((uRtNorm - 1.0) * uRgKm, 1e-3);
    float shellFade = smoothstep(0.0, 0.35 * shellThicknessKm, shellChordKm);
    radiance *= shellFade;

    // Opacity is the luminance of the *full* transmittance along the drawn
    // segment, so the shell attenuates the surface exactly as much as the
    // tables say it does.  The old clamps (0.88 outside the disc, 0.66 on it)
    // and the halo/rim multipliers capped the limb to a fraction of its
    // physically computed value.
    float alpha = clamp(1.0 - dot(transmittance, LUMINANCE), 0.0, 1.0);
    // Same rule as the analytic path: a shell that scatters nothing must not
    // occlude. Without it the giants draw a black rim over a lit disc.
    alpha *= smoothstep(0.0, 0.02, dot(radiance, LUMINANCE));

    float eclipseVisibility = 1.0;${"${eclipseFactor}"}
    radiance *= eclipseVisibility;
    alpha *= shellFade;
    if (alpha < 0.0005 && max(radiance.r, max(radiance.g, radiance.b)) < 0.002) discard;
    gl_FragColor = vec4(radiance, alpha);
    #include <colorspace_fragment>
}`;

// Every body with a derived atmosphere gets scattering tables.  Jupiter and
// Saturn used to be listed in an ATMOSPHERE_REMOVED_KEYS set because their
// reference models, applied verbatim to the real (10x larger) planets,
// produced a 60 km sliver with a nearly transparent Mie channel; the spectra
// scaling in applyReferenceModel fixes that, so the exclusion is gone.

// Multiple-scattering orders.  Order 1 alone gives the blue sky and the
// terminator, orders 2-4 add the soft fill that keeps the shadowed limb from
// going black.  Thick atmospheres need more of them; optically thin ones
// converge after two and skip ~40 % of the generation cost.
function atmosphereOrderBudget(key, profile = PLANET_ATMOSPHERE_PROFILES[key]) {
    const tau = profile?.opticalDepth ?? profile?.derived?.opticalDepth ?? 0;
    let orders = tau > 0.5 ? 4 : tau > 0.12 ? 3 : 2;
    // Every order is another full-screen pass per body, and all nine bodies are
    // built synchronously at startup. On a weak or integrated GPU that burst is
    // enough to trip the driver watchdog, and a lost context is indistinguishable
    // from "the app is broken". Scale the burst to the quality preset the user
    // picked instead: fewer orders on Low, full quality on High.
    const tier = globalThis.__solisterGraphicsTier;
    if (tier === "low") return Math.min(orders, 2);
    if (tier === "medium") return Math.min(orders, 3);
    return orders;
}

function brunetonParamsForBody(key, profile = PLANET_ATMOSPHERE_PROFILES[key]) {
    const derived = profile?.derived;
    if (!derived) return null;
    const radiusKm = Number(globalThis.BodyShapes?.maxRadiusKm?.(key)) || derived.referenceModel?.groundRadiusKm || 6371;
    const HR = Math.max(derived.rayleighScaleHeightKm, 1e-4);
    const HM = Math.max(derived.mieScaleHeightKm, 1e-4);
    const spectra = derived.spectra;
    const mieTint = new THREE.Color(derived.mieTint);
    const betaR = spectra
        ? spectra.rayleighBeta.slice()
        : [ derived.tauR.r / HR, derived.tauR.g / HR, derived.tauR.b / HR ];
    const betaMSca = spectra
        ? spectra.mieScatteringBeta.slice()
        : [ derived.tauM * mieTint.r / HM, derived.tauM * mieTint.g / HM, derived.tauM * mieTint.b / HM ];
    let betaMEx = spectra
        ? spectra.mieExtinctionBeta.slice()
        : [ derived.tauMExt.r / HM, derived.tauMExt.g / HM, derived.tauMExt.b / HM ];
    if (derived.methaneTau) {
        // There is no separate absorption channel; methane absorbs without
        // becoming a scattering source, so it rides on the Mie extinction.
        betaMEx = betaMEx.map((v, i) => v + derived.methaneTau[i] / HR);
    }
    return {
        Rg: radiusKm,
        Rt: radiusKm + Math.max(derived.renderTopKm, 1),
        HR: HR,
        HM: HM,
        betaR: betaR,
        betaMSca: betaMSca,
        betaMEx: betaMEx,
        mieG: Math.max(-.9, Math.min(.95, derived.mieG ?? 0)),
        mieFade: derived.mieFade ?? .1
    };
}

function createPlanetAtmosphere(key, body, profile = PLANET_ATMOSPHERE_PROFILES[key]) {
    const slot = key + "_atmosphere";
    if (cloudMeshes[slot]) return cloudMeshes[slot];
    const derived = profile?.derived;
    if (!body || !derived) return null;
    const radius = body.geometry?.parameters?.radius;
    if (!(radius > 0)) return null;
    if (!(derived.opticalDepth > MIN_RENDER_OPTICAL_DEPTH)) return null;
    const radiusKm = BodyShapes.maxRadiusKm(key) || 6371;
    const bodyAxesKm = BodyShapes.axesKm[key] || [ radiusKm, radiusKm, radiusKm ];
    const maxAxisKm = Math.max(...bodyAxesKm);
    const axisScale = new THREE.Vector3(bodyAxesKm[0] / maxAxisKm, bodyAxesKm[2] / maxAxisKm, bodyAxesKm[1] / maxAxisKm);
    const shellRadius = radius * (1 + derived.renderTopKm / radiusKm);
    const [ shellSegX, shellSegY ] = atmosphereShellSegments();
    const geometry = BodyShapes.createGeometry(THREE, key, shellRadius, shellSegX, shellSegY);
    const kmToBodyRatio = 1 / radiusKm;
    const scaleHeightR = Math.max(derived.rayleighScaleHeightKm, 1e-6) * radius / radiusKm;
    const scaleHeightM = Math.max(derived.mieScaleHeightKm, 1e-6) * radius / radiusKm;

    const rayleighPerRadius = radiusKm / Math.max(derived.rayleighScaleHeightKm, 1e-6);
    const miePerRadius = radiusKm / Math.max(derived.mieScaleHeightKm, 1e-6);
    const band = derived.band;
    const bandWidth = band ? Math.max(band.widthKm * kmToBodyRatio, 1e-7) : 1;

    // r32: physical parameters for the Bruneton tables. When
    // a reference model exists its stored spectra are already
    // (beta per km times the model scales); otherwise the spectra are
    // recovered from the derived optical depths (beta = tau / H).
    const referenceModel = derived.referenceModel;
    const brunetonParams = brunetonParamsForBody(key, profile);
    const insideSkyGain = INSIDE_SKY_EXPOSURE;
    // A failed or interrupted table build must not reach the shader: binding a
    // null sampler compiles, then fails gl.validateProgram with an empty info
    // log, and every draw that follows reports "useProgram: program not valid"
    // - which is what a dying context looks like from inside the app. Catch it
    // here and fall through to the analytic transmittance table instead.
    let atmLuts = null;
    // Off by default. Building these costs 13.5 s of the load (20.3 s with
    // tables, 6.8 s without, same stills on the gate views) and on some drivers
    // every generator pass is INVALID_OPERATION, which ends the context before
    // the first frame. A shipped baked table is the only way to have them
    // without that cost; until one exists, opt in explicitly.
    // __solisterForceTables = 1 builds them at runtime.
    // __solisterForceMarch  = 1 keeps the analytic path even where tables exist.
    if (typeof buildBrunetonLuts === "function"
        && globalThis.__solisterForceTables === 1
        && globalThis.__solisterForceMarch !== 1) {
        try {
            atmLuts = buildBrunetonLuts(THREE, renderer, key, brunetonParams, {
                orders: atmosphereOrderBudget(key),
                tables: globalThis.takeBakedAtmosphereTables?.(brunetonParams)
            });
        } catch (error) {
            atmLuts = null;
            if (typeof console !== "undefined" && console.warn) {
                console.warn("[Solister] scattering tables unavailable for " + key +
                    "; using the analytic transmittance fallback.", error && error.message);
            }
        }
        if (atmLuts && (!atmLuts.transmittance || !atmLuts.irradiance || !atmLuts.inscatter)) {
            if (typeof console !== "undefined" && console.warn) {
                console.warn("[Solister] incomplete scattering tables for " + key +
                    "; using the analytic transmittance fallback.");
            }
            atmLuts = null;
        }
    }

    // The transmittance table is an optional module; a build that omits it must
    // still boot the fallback instead of throwing ReferenceError here.
    const opticalDepthTable = atmLuts || typeof getTransmittanceTable !== "function"
        ? null : getTransmittanceTable(key, profile, radiusKm);

    const useHalfFloat = Boolean(renderer?.capabilities?.isWebGL2);
    let opticalDepthTexture = null;
    if (opticalDepthTable) {

        opticalDepthTexture = useHalfFloat
            ? new THREE.DataTexture(
                opticalDepthTable.half,
                opticalDepthTable.width,
                opticalDepthTable.height,
                THREE.RGBAFormat,
                THREE.HalfFloatType
            )
            : new THREE.DataTexture(
                opticalDepthTable.packed,
                opticalDepthTable.width,
                opticalDepthTable.height,
                THREE.RGBAFormat,
                THREE.UnsignedByteType
            );
        opticalDepthTexture.minFilter = THREE.LinearFilter;
        opticalDepthTexture.magFilter = THREE.LinearFilter;
        opticalDepthTexture.wrapS = THREE.ClampToEdgeWrapping;
        opticalDepthTexture.wrapT = THREE.ClampToEdgeWrapping;
        opticalDepthTexture.needsUpdate = true;
    }
    const multipleScatterTable = !atmLuts && typeof getMultipleScatterTable === "function"
        ? getMultipleScatterTable(key, profile, radiusKm)
        : null;
    let multipleScatterTexture = null;
    if (multipleScatterTable) {
        multipleScatterTexture = useHalfFloat
            ? new THREE.DataTexture(
                multipleScatterTable.half,
                multipleScatterTable.width,
                multipleScatterTable.height,
                THREE.RGBAFormat,
                THREE.HalfFloatType
            )
            : new THREE.DataTexture(
                multipleScatterTable.packed,
                multipleScatterTable.width,
                multipleScatterTable.height,
                THREE.RGBAFormat,
                THREE.UnsignedByteType
            );
        multipleScatterTexture.minFilter = THREE.LinearFilter;
        multipleScatterTexture.magFilter = THREE.LinearFilter;
        multipleScatterTexture.wrapS = THREE.ClampToEdgeWrapping;
        multipleScatterTexture.wrapT = THREE.ClampToEdgeWrapping;
        multipleScatterTexture.needsUpdate = true;
    }
    const eclipse = key === "earth";
    // r32: when the Bruneton tables exist for this body, the shell runs
    // the table sampling runtime; the march material below
    // is built only as the fallback for hardware without WebGL2/float render targets.
    const atmMaterial = atmLuts ? new THREE.ShaderMaterial({
        uniforms: {
            ...(eclipse ? eclipseUniforms : {}),
            intensity: {
                value: profile.intensity
            },
            uBodyCenterView: {
                value: new THREE.Vector3
            },
            uBodyRadius: {
                value: radius
            },
            uShellRadius: {
                value: shellRadius
            },
            uBodyAxisScale: {
                value: axisScale
            },
            uViewToBodyLocal: {
                value: new THREE.Matrix3
            },
            uInsideShell: {
                value: 0
            },
            uEyeHeightR: {
                value: 1e-6
            },
            uSkySamples: {
                // Tier-scaled: the inside march is the dominant cost in a surface
                // view, so low settings take a quarter of the samples.
                value: globalThis.__solisterGraphicsTier === "low" ? 8
                     : globalThis.__solisterGraphicsTier === "medium" ? 16 : 32
            },
            uLimbDarken: {
                value: key === "venus" ? 0.0 : 1.0
            },
            uHaloEdgeStart: {
                value: 0.965
            },
            uBacklightLevel: {
                value: key === "saturn" || key === "jupiter" ? 0.0 : 0.45
            },
            uDarkOcclusion: {
                value: key === "saturn" || key === "jupiter" ? 0.0 : 1.0
            },
            uSunIntensity: {
                value: 1
            },
            uSunDir: {
                value: new THREE.Vector3(1, 0, 0)
            },
            uTransmittanceLut: {
                value: atmLuts.transmittance
            },
            uInscatterLut: {
                value: atmLuts.inscatter
            },
            uRgKm: {
                value: brunetonParams.Rg
            },
            uRtNorm: {
                // Tables are generated in ground-radius units (see
                // bruneton-luts.js); the shell samples them normalised.
                value: brunetonParams.Rt / brunetonParams.Rg
            },
            uBetaR: {
                // Per ground radius, matching the analytic inside-shell integral
                // (the tables' own normalisation). The 4D lookups are unaffected:
                // they use r in ground radii, not this.
                value: new THREE.Vector3(...brunetonParams.betaR.map(v => v * brunetonParams.Rg))
            },
            uMieTint: {
                // per-body Mie scattering colour. The tables carry
                // it baked in; the analytic sky has to apply it explicitly.
                value: atmosphereMieTintColor(ATMOSPHERE_MIE_TINT_OVERRIDE[key] || derived.mieTint)
            },
            uBetaMS: {
                value: new THREE.Vector3(...brunetonParams.betaMSca.map(v => v * brunetonParams.Rg))
            },
            uBetaMX: {
                value: new THREE.Vector3(...brunetonParams.betaMEx.map(v => v * brunetonParams.Rg))
            },
            uHR: {
                value: Math.max(brunetonParams.HR / brunetonParams.Rg, 1e-7)
            },
            uHM: {
                value: Math.max(brunetonParams.HM / brunetonParams.Rg, 1e-7)
            },
            uSkyGain: {
                value: insideSkyGain
            },
            uMieG: {
                value: atmLuts.params.mieG
            },
            uMieFade: {
                value: brunetonParams.mieFade
            },
            uLutGain: {
                // The tables are normalised to a solar irradiance of 1, so this is the
                // exposure term. 3 keeps the blue cast, terminator and limb halo without
                // flattening the ground albedo; Venus needs more, since its disc is
                // atmosphere all the way down and must read white.
                value: key === "venus" ? 12.0 : 3.0
            }
        },
        vertexShader: ATMOSPHERE_VERTEX_GLSL,
        fragmentShader: ATMOSPHERE_FRAGMENT_SE_GLSL.replace("${eclipseFactor}", eclipse ? "eclipseVisibility=solarVisibility(vWorldPos);" : "").replace("${eclipseSource}", eclipse ? ECLIPSE_GLSL : "").replace("    float eclipseVisibility = 1.0;", ATMOSPHERE_SKY_INSIDE_GLSL + "    float eclipseVisibility = 1.0;"),
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        premultipliedAlpha: true,
        toneMapped: false,
        fog: false
    }) : null;
    const material = atmMaterial || new THREE.ShaderMaterial({
        defines: {
            ATMOSPHERE_HAS_BAND: band ? 1 : 0
        },
        uniforms: {
            ...(eclipse ? eclipseUniforms : {}),
            intensity: {
                value: profile.intensity
            },
            uBodyCenterView: {
                value: new THREE.Vector3
            },
            uBodyRadius: {
                value: radius
            },
            uShellRadius: {
                value: shellRadius
            },
            uBodyAxisScale: {
                value: axisScale
            },
            uViewToBodyLocal: {
                value: new THREE.Matrix3
            },
            uInsideShell: {
                value: 0
            },
            uEyeHeightR: {
                value: 1e-6
            },
            uSkySamples: {
                // Tier-scaled: the inside march is the dominant cost in a surface
                // view, so low settings take a quarter of the samples.
                value: globalThis.__solisterGraphicsTier === "low" ? 8
                     : globalThis.__solisterGraphicsTier === "medium" ? 16 : 32
            },
            uLimbDarken: {
                value: key === "venus" ? 0.0 : 1.0
            },
            uHaloEdgeStart: {
                value: 0.965
            },
            uBacklightLevel: {
                value: key === "saturn" || key === "jupiter" ? 0.0 : 0.45
            },
            uDarkOcclusion: {
                value: key === "saturn" || key === "jupiter" ? 0.0 : 1.0
            },
            uScaleHeightR: {
                value: scaleHeightR
            },
            uScaleHeightM: {
                value: scaleHeightM
            },
            uTauRayleigh: {
                value: new THREE.Vector3(derived.tauR.r * rayleighPerRadius, derived.tauR.g * rayleighPerRadius, derived.tauR.b * rayleighPerRadius)
            },
            uTauMieScatter: {
                value: (() => {
                    const tint = new THREE.Color(derived.mieTint);
                    return new THREE.Vector3(derived.tauM * tint.r * miePerRadius, derived.tauM * tint.g * miePerRadius, derived.tauM * tint.b * miePerRadius);
                })()
            },
            uTauMieExt: {
                value: new THREE.Vector3(derived.tauMExt.r * miePerRadius, derived.tauMExt.g * miePerRadius, derived.tauMExt.b * miePerRadius)
            },
            uMieG: {
                value: derived.mieG
            },
            uMieTint: {
                value: atmosphereMieTintColor(ATMOSPHERE_MIE_TINT_OVERRIDE[key] || derived.mieTint)
            },
            uAbsorbTau: {
                value: derived.methaneTau ? new THREE.Vector3(derived.methaneTau[0] * rayleighPerRadius, derived.methaneTau[1] * rayleighPerRadius, derived.methaneTau[2] * rayleighPerRadius) : new THREE.Vector3
            },
            uBandTau: {
                value: band ? new THREE.Vector3(band.tau.r, band.tau.g, band.tau.b) : new THREE.Vector3
            },
            uBandCenter: {
                value: band ? band.centerKm * kmToBodyRatio : 0
            },
            uBandWidth: {
                value: bandWidth
            },
            uBandNorm: {
                value: band ? 1 / (bandWidth * Math.sqrt(Math.PI)) : 0
            },
            uOpticalDepth: {
                value: opticalDepthTexture
            },
            uOpticalDepthCoeff: {
                value: new THREE.Vector2(
                    opticalDepthTable ? opticalDepthTable.sampleCoeff.x : 0,
                    opticalDepthTable ? opticalDepthTable.sampleCoeff.y : 0
                )
            },
            uHasOpticalDepth: {
                value: opticalDepthTexture ? 1 : 0
            },
            uOpticalDepthMax: {
                value: opticalDepthTable && !useHalfFloat ? opticalDepthTable.encodedMax : 1
            },
            uMsTable: {
                value: multipleScatterTexture
            },
            uHasMs: {
                value: multipleScatterTexture ? 1 : 0
            },
            uMsScale: {
                value: multipleScatterTable && !useHalfFloat ? multipleScatterTable.encodeScale : 1
            },
            uSunIntensity: {
                value: 1
            },
            uSunDir: {
                value: new THREE.Vector3(1, 0, 0)
            },
            // The shared inside-shell sky integral works in ground-radius
            // units, exactly like the tables. These are the same numbers the
            // LUT path uses, so a failed table build falls back to the same
            // model instead of a second, differently-tuned one.
            uBetaR: {
                value: new THREE.Vector3(...brunetonParams.betaR.map(v => v * brunetonParams.Rg))
            },
            uBetaMS: {
                value: new THREE.Vector3(...brunetonParams.betaMSca.map(v => v * brunetonParams.Rg))
            },
            uBetaMX: {
                value: new THREE.Vector3(...brunetonParams.betaMEx.map(v => v * brunetonParams.Rg))
            },
            uHR: {
                value: Math.max(brunetonParams.HR / brunetonParams.Rg, 1e-7)
            },
            uHM: {
                value: Math.max(brunetonParams.HM / brunetonParams.Rg, 1e-7)
            },
            uRtNorm: {
                value: brunetonParams.Rt / brunetonParams.Rg
            },
            uSkyGain: {
                value: insideSkyGain
            }
        },
        vertexShader: ATMOSPHERE_VERTEX_GLSL,
        fragmentShader: ATMOSPHERE_FRAGMENT_GLSL.replace("${eclipseFactor}", eclipse ? "eclipseVisibility=solarVisibility(vWorldPos);" : "").replace("${eclipseSource}", eclipse ? ECLIPSE_GLSL : "").replace("    float eclipseVisibility = 1.0;", ATMOSPHERE_SKY_INSIDE_GLSL + "    float eclipseVisibility = 1.0;"),
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        premultipliedAlpha: true,
        toneMapped: false,
        fog: false
    });
    const shell = new THREE.Mesh(geometry, material);
    shell.userData.isAtmosphere = true;
    shell.userData.atmosphereProfile = profile;
    shell.userData.atmosphereDerived = derived;
    shell.name = key + " scattering atmosphere";
    shell.renderOrder = 2;
    shell.raycast = () => {};
    body.add(shell);
    cloudMeshes[slot] = shell;
    return shell;
}

function createEarthAtmosphere() {
    return createPlanetAtmosphere("earth", objectRegistry.earth, PLANET_ATMOSPHERE_PROFILES.earth);
}

globalThis.PLANET_ATMOSPHERE_PROFILES = PLANET_ATMOSPHERE_PROFILES;
globalThis.createPlanetAtmosphere = createPlanetAtmosphere;
globalThis.brunetonParamsForBody = brunetonParamsForBody;
globalThis.atmosphereOrderBudget = atmosphereOrderBudget;
