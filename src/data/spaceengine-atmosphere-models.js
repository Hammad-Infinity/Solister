const createSpaceEngineModel = (sourceFiles, binaryHeaderVerified, groundRadiusKm, topKm, rayleighScaleHeightKm, mieScaleHeightKm, rayleighBeta, rayleighScale, mieScatteringBeta, mieScatteringScale, mieExtinctionBeta, mieExtinctionScale, mieG, mieFade) => Object.freeze({
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

globalThis.SPACEENGINE_ATMOSPHERE_MODELS = Object.freeze({
    earth: createSpaceEngineModel([ "atmospheres.cfg.txt", "Earth.atm.txt" ], true, 6371, 60, 8, 2, [ .0058, .0135, .0331 ], 1, [ .004, .004, .004 ], 1, [ .004, .004, .004 ], 1.11111, .8, .02),
    venus: createSpaceEngineModel([ "atmospheres.cfg.txt", "Venus.atm.txt" ], true, 6052, 80, 12, 8, [ .01, .008, .004 ], 2, [ .005, .004, .002 ], .6, [ .005, .004, .002 ], .66666, .6, .1),
    mars: createSpaceEngineModel([ "atmospheres.cfg.txt", "Mars.atm.txt" ], true, 3387.792, 100, 8, 2, [ .0213, .0168, .0113 ], 2, [ .0085, .0067, .0045 ], .1, [ .004, .004, .004 ], .11111, .4, .3),
    jupiter: createSpaceEngineModel([ "atmospheres.cfg.txt" ], false, 7149.2, 60, 12, 2, [ .0117, .0135, .018 ], 1, [ .004, .004, .004 ], .5, [ .004, .004, .004 ], .55555, .8, .02),
    titan: createSpaceEngineModel([ "atmospheres.cfg.txt" ], false, 2574.91, 60, 10, 8, [ .004, .004, .01 ], 1, [ .001, .01, .06 ], .7, [ .001, .01, .06 ], 1.4, 0, .1),
    neptune: createSpaceEngineModel([ "atmospheres.cfg.txt" ], false, 6371, 60, 8, 4.5, [ .0058, .0135, .0331 ], 1, [ .00058, .0027, .1 ], .5, [ .00058, .00027, .005 ], .1, .6, .1),
    pluto: createSpaceEngineModel([ "atmospheres.cfg.txt", "Pluto.atm.txt" ], true, 2400, 60, 12, 8, [ .001, .001, .001 ], .1, [ .004, .0045, .006 ], 1, [ .001, .001, .001 ], 0, .6, 1)
});
