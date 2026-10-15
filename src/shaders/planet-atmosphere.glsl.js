const SPACEENGINE_ATMOSPHERE_MODELS = globalThis.SPACEENGINE_ATMOSPHERE_MODELS;

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
        visualGain: .15,
        layers: Object.freeze([ makeAtmosphereLayer("dense lower atmosphere", 0, 48, 560, Object.freeze({
            CO2: .965,
            N2: .035
        }), {
            pressureBottomPa: 9.2e6,
            pressureTopPa: 4e5,
            mieTau: .18,
            mieG: .64,
            mieTint: 14997949
        }), makeAtmosphereLayer("lower cloud deck", 48, 58, 330, Object.freeze({
            CO2: .965,
            N2: .035
        }), {
            pressureBottomPa: 4e5,
            mieTau: .18,
            mieG: .62,
            mieTint: 14997949
        }), makeAtmosphereLayer("upper cloud deck", 58, 70, 250, Object.freeze({
            CO2: .965,
            N2: .035
        }), {
            mieTau: .42,
            mieG: .68,
            mieTint: 15918533
        }), makeAtmosphereLayer("upper haze", 70, 95, 210, Object.freeze({
            CO2: .965,
            N2: .035
        }), {
            mieTau: .13,
            mieG: .58,
            mieTint: 14206882
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
const SHELL_SCALE_HEIGHTS = 6;

const ATMOSPHERE_VIEW_SAMPLES = 8;

// The table ceiling is per planet now, so it travels as a uniform rather than
// being baked into the shader source. Baking it would force a shader recompile
// for every body and would desync the moment a planet's table changed.

const ATMOSPHERE_SHELL_SEGMENTS = [ 128, 64 ];

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
        intensity: intensityFromOpticalDepth(opticalDepth, facts.visualGain ?? 1),
        opticalDepth: opticalDepth,
        topKm: topKm,
        renderTopKm: Math.min(topKm, SHELL_SCALE_HEIGHTS * shellScaleHeightKm),
        rayleighColor: new THREE.Color(totalTauR.r / maxR, totalTauR.g / maxR, totalTauR.b / maxR).getHex(),
        sourceModel: null
    };
}

function applySpaceEngineModel(key, derived, model) {
    if (!model || !derived) return derived;
    const rayleighScaleHeightKm = Math.max(model.rayleighScaleHeightKm, 1e-6);
    const mieScaleHeightKm = Math.max(model.mieScaleHeightKm, 1e-6);
    const tauR = model.rayleighBeta.map(beta => beta * model.rayleighScale * rayleighScaleHeightKm);
    const tauMScatter = model.mieScatteringBeta.map(beta => beta * model.mieScatteringScale * mieScaleHeightKm);
    const tauMExt = model.mieExtinctionBeta.map(beta => beta * model.mieExtinctionScale * mieScaleHeightKm);
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
        mieTint: new THREE.Color(tint(0), tint(1), tint(2)).getHex(),
        methaneTau: derived.methaneTau,
        band: derived.band,
        intensity: Math.max(.05, Math.min(1.15, 2.9 * root / Math.max(1 + .6 * root, 1e-6))),
        opticalDepth: opticalDepth,
        renderTopKm: Math.min(model.topKm, SHELL_SCALE_HEIGHTS * shellScaleHeightKm),
        rayleighColor: new THREE.Color(tauR[0] / maxR, tauR[1] / maxR, tauR[2] / maxR).getHex(),
        sourceModel: model
    });
}

const PLANET_ATMOSPHERE_PROFILES = (() => {
    const profiles = {};
    for (const key of Object.keys(ATMOSPHERE_DATABASE)) {
        const derived = applySpaceEngineModel(key, deriveAtmosphere(key), SPACEENGINE_ATMOSPHERE_MODELS?.[key]);
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
            spaceEngine: derived.sourceModel
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

const ATMOSPHERE_FRAGMENT_GLSL = `
uniform float intensity;
uniform float uBodyRadius;
uniform float uShellRadius;
uniform float uInsideShell;
uniform mat3 uViewToBodyLocal;
uniform vec3 uBodyAxisScale;
uniform float uScaleHeightR;
uniform float uScaleHeightM;
uniform vec3 uTauRayleigh;
uniform vec3 uTauMieScatter;
uniform vec3 uTauMieExt;
uniform float uMieG;
uniform vec3 uMieTint;
uniform vec3 uAbsorbTau;
uniform vec3 uBandTau;
uniform float uBandCenter;
uniform float uBandWidth;
uniform float uBandNorm;
uniform vec3 uBodyCenterView;
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform sampler2D uOpticalDepth;
uniform vec2 uOpticalDepthCoeff;
uniform float uHasOpticalDepth;
uniform float uOpticalDepthMax;
// The table stores log2(1 + tau) / uOpticalDepthMax, not tau itself, so the
// lookup has to undo that before the value can be exponentiated.
varying vec3 vAtmoView;
varying vec3 vWorldPos;
${"${eclipseSource}"}${LDB_FRAGMENT_PARS}

const float SAMPLES = ${ATMOSPHERE_VIEW_SAMPLES}.0;

// Optical depth looked up from the per-planet table built on the CPU, instead
// of the closed-form slant approximation. The table is indexed by
// (cosChi, height) in normalised units:
//
//   x = (1 - cosChi) * 0.5 * (N-1)/N
//   y = height / atmosphereTop * (M-1)/M
//
// which inverts the mapping used to build it, so a lookup lands on the same
// ray that was integrated. uOpticalDepthCoeff carries (xScale, yScale).
vec3 sampleOpticalDepth(float cosChi, float heightNorm) {
    float u = (1.0 - clamp(cosChi, -1.0, 1.0)) * 0.5 * uOpticalDepthCoeff.x;
    float v = clamp(heightNorm, 0.0, 1.0) * uOpticalDepthCoeff.y;
    // Undo the log2 packing: the texel holds log2(1 + tau) / uOpticalDepthMax,
    // so scaling back and subtracting one recovers tau. The exp2/pow pair here
    // is exact rather than approximate, and the cost is one extra instruction
    // per sample on a lookup that already costs a texture fetch.
    vec3 encoded = texture2D(uOpticalDepth, vec2(u, v)).rgb * uOpticalDepthMax;
    return pow(vec3(2.0), encoded) - vec3(1.0);
}
const vec3 LUMINANCE = vec3(0.3333333);

float rayleighPhase(float mu){ return 0.75 * (1.0 + mu * mu); }

float miePhase(float mu, float g){
    float g2 = g * g;
    return min(2.5, (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 0.035), 1.5));
}

void main(){${LDB_FRAGMENT_HEAD}
    if ((uInsideShell < 0.5 && !gl_FrontFacing) || (uInsideShell >= 0.5 && gl_FrontFacing)) discard;
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
    if (finish <= start) discard;
    float chord = finish - start;
    float bodyRadius = max(uBodyRadius, 1e-8);
    float step = 1.0 / SAMPLES;
    float stepLength = step * chord;
    float weight = step * chord / bodyRadius;
    float inverseHeightR = 1.0 / max(uScaleHeightR, 1e-9);
    float inverseHeightM = 1.0 / max(uScaleHeightM, 1e-9);
    float grazingTerm = 2.0 * max(uScaleHeightR, 1e-9) / bodyRadius;
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
        float altitude = max(0.0, length(pointMetric) - uBodyRadius);
        float densityR = exp(-altitude * inverseHeightR);
        if (densityR < 1e-5) continue;
        float densityM = exp(-altitude * inverseHeightM);
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
            // No table for this body: fall back to the analytic Chapman-style
            // slant. Planets that skip the table are the ones with nothing
            // meaningful to integrate, so the approximation costs little.
            float slant = inversesqrt(max(sunMu * sunMu + grazingTerm, 1e-8));
            sunTau = extinction * slant + bandRate * uBandWidth;
        }
        vec3 sunTransmit = exp(-min(sunTau, vec3(9.0))) * smoothstep(-0.12, 0.22, sunMu);
        vec3 viewTransmit = exp(-min(tauView, vec3(9.0)));
        scatter += (uTauRayleigh * densityR * phaseR + uTauMieScatter * densityM * phaseM * uMieTint) *
            sunTransmit * viewTransmit * weight;
        tauView += extinction * weight;
        sunAccum += dot(sunTransmit, LUMINANCE);
    }
    vec3 transmittance = exp(-min(tauView, vec3(9.0)));
    float avgSun = sunAccum / SAMPLES;
    vec3 rayleighShare = uTauRayleigh / max(uTauRayleigh + uTauMieScatter, vec3(1e-5));
    scatter += rayleighShare * (1.0 - transmittance) * (0.07 + 0.50 * avgSun) * (phaseR * 0.18 + 0.06);
    scatter *= uSunIntensity * intensity;
    float alpha = clamp(1.0 - dot(transmittance, LUMINANCE), 0.0, 0.88) * intensity * (0.04 + 0.96 * avgSun);
    float eclipseVisibility = 1.0;${"${eclipseFactor}"}
    if (alpha < 0.0002) discard;
    gl_FragColor = vec4(scatter * eclipseVisibility, alpha);
}`;

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
    const geometry = BodyShapes.createGeometry(THREE, key, shellRadius, ATMOSPHERE_SHELL_SEGMENTS[0], ATMOSPHERE_SHELL_SEGMENTS[1]);
    const kmToBodyRatio = 1 / radiusKm;
    const scaleHeightR = Math.max(derived.rayleighScaleHeightKm, 1e-6) * radius / radiusKm;
    const scaleHeightM = Math.max(derived.mieScaleHeightKm, 1e-6) * radius / radiusKm;
    const band = derived.band;
    const bandWidth = band ? Math.max(band.widthKm * kmToBodyRatio, 1e-7) : 1;

    // Per-planet optical-depth table. Built on the CPU from this planet's own
    // composition, scale height and extinction, so Venus does not end up
    // scattering through Earth's atmosphere. Null means the body has nothing
    // worth integrating and the shader keeps its analytic slant.
    // No typeof guard here on purpose. transmittance-table.js is registered in
    // bootstrap.js ahead of this file, so a missing function means the load
    // order is broken - and a guard would hide that by quietly degrading every
    // planet to the analytic slant with nothing in the console to explain it.
    const opticalDepthTable = getTransmittanceTable(key, profile, radiusKm);
    // Declared outside the guard because the uniform block below needs to know
    // which encoding was chosen: only the 8-bit path divides by the ceiling.
    const useHalfFloat = Boolean(renderer?.capabilities?.isWebGL2);
    let opticalDepthTexture = null;
    if (opticalDepthTable) {
        // Half-float when the context supports it, 8-bit otherwise.
        //
        // Both hold the same encoded value, log2(1 + tau); the 8-bit one
        // additionally divides by a per-planet ceiling. Half-float is exact
        // enough that the worst error in exp(-tau) is about 2.4e-4, below one
        // 8-bit sRGB level, so it is invisible. Measured for the 8-bit path it
        // is about 5.4e-4 per byte step, roughly 16 sRGB levels at the dark
        // end, which is coarse enough to band near the terminator.
        //
        // Linear filtering of a *half*-float texture is core in WebGL2 -
        // OES_texture_half_float_linear is only needed on WebGL1. Three still
        // gates anisotropy on OES_texture_float_linear, but that does not
        // affect the plain linear filter used here.
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
    const eclipse = key === "earth";
    const material = new THREE.ShaderMaterial({
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
            uScaleHeightR: {
                value: scaleHeightR
            },
            uScaleHeightM: {
                value: scaleHeightM
            },
            uTauRayleigh: {
                value: new THREE.Vector3(derived.tauR.r, derived.tauR.g, derived.tauR.b)
            },
            uTauMieScatter: {
                value: (() => {
                    const tint = new THREE.Color(derived.mieTint);
                    return new THREE.Vector3(derived.tauM * tint.r, derived.tauM * tint.g, derived.tauM * tint.b);
                })()
            },
            uTauMieExt: {
                value: new THREE.Vector3(derived.tauMExt.r, derived.tauMExt.g, derived.tauMExt.b)
            },
            uMieG: {
                value: derived.mieG
            },
            uMieTint: {
                value: new THREE.Color(derived.mieTint)
            },
            uAbsorbTau: {
                value: derived.methaneTau ? new THREE.Vector3(...derived.methaneTau) : new THREE.Vector3
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
                // 1 in the half-float path: the texel already holds
                // log2(1 + tau) unscaled. Only the 8-bit fallback divides by
                // the ceiling, and only it needs undoing.
                value: opticalDepthTable && !useHalfFloat ? opticalDepthTable.encodedMax : 1
            },
            uSunIntensity: {
                value: 1
            },
            uSunDir: {
                value: new THREE.Vector3(1, 0, 0)
            }
        },
        vertexShader: ATMOSPHERE_VERTEX_GLSL,
        fragmentShader: ATMOSPHERE_FRAGMENT_GLSL.replace("${eclipseFactor}", eclipse ? "eclipseVisibility=solarVisibility(vWorldPos);" : "").replace("${eclipseSource}", eclipse ? ECLIPSE_GLSL : ""),
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        blending: THREE.NormalBlending,
        premultipliedAlpha: false,
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
