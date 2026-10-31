

const createAtmosphereReferenceModel = (sourceFiles, binaryHeaderVerified, groundRadiusKm, topKm, rayleighScaleHeightKm, mieScaleHeightKm, rayleighBeta, rayleighScale, mieScatteringBeta, mieScatteringScale, mieExtinctionBeta, mieExtinctionScale, mieG, mieFade) => Object.freeze({
    sourceFiles: Object.freeze(sourceFiles),
    binaryHeaderVerified: binaryHeaderVerified,
    groundRadiusKm: groundRadiusKm,
    topKm: topKm,
    rayleighScaleHeightKm: rayleighScaleHeightKm,
    mieScaleHeightKm: mieScaleHeightKm,
    rayleighBeta: Object.freeze(rayleighBeta),
    rayleighScale: rayleighScale,
    mieScatteringBeta: Object.freeze(mieScatteringBeta),
    mieScatteringScale: mieScatteringScale,
    mieExtinctionBeta: Object.freeze(mieExtinctionBeta),
    mieExtinctionScale: mieExtinctionScale,
    mieG: mieG,
    mieFade: mieFade
});

globalThis.ATMOSPHERE_REFERENCE_MODELS = Object.freeze({
    earth: createAtmosphereReferenceModel([ "compiled reference profile" ], true, 6371, 60, 8, 2, [ .0058, .0135, .0331 ], 1, [ .004, .004, .004 ], 1, [ .004, .004, .004 ], 1.11111, .8, .02),

    venus: createAtmosphereReferenceModel([ "compiled reference profile" ], true, 6052, 90, 12, 10, [ .0103, .0103, .0103 ], 2.6, [ .012, .012, .012 ], 5.2, [ .013, .013, .013 ], 5.2, .74, .1),
    mars: createAtmosphereReferenceModel([ "compiled reference profile" ], true, 3387.792, 100, 8, 2, [ .0213, .0168, .0113 ], 2, [ .0085, .0067, .0045 ], .1, [ .004, .004, .004 ], .11111, .4, .3),
    jupiter: createAtmosphereReferenceModel([ "compiled reference profile" ], false, 7149.2, 60, 12, 2, [ .0117, .0135, .018 ], 1, [ .004, .004, .004 ], .5, [ .004, .004, .004 ], .55555, .8, .02),
    titan: createAtmosphereReferenceModel([ "compiled reference profile" ], false, 2574.91, 60, 10, 8, [ .004, .004, .01 ], 1, [ .001, .01, .06 ], .7, [ .001, .01, .06 ], 1.4, 0, .1),
    neptune: createAtmosphereReferenceModel([ "compiled reference profile" ], false, 6371, 60, 8, 4.5, [ .0058, .0135, .0331 ], 1, [ .00058, .0027, .1 ], .5, [ .00058, .00027, .005 ], .1, .6, .1),
    pluto: createAtmosphereReferenceModel([ "compiled reference profile" ], true, 2400, 60, 12, 8, [ .001, .001, .001 ], .1, [ .004, .0045, .006 ], 1, [ .001, .001, .001 ], 0, .6, 1)
});
