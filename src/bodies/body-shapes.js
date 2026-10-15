const axesKm = Object.freeze({
    mercury: Object.freeze([ 2440.53, 2440.53, 2438.26 ]),
    venus: Object.freeze([ 6051.8, 6051.8, 6051.8 ]),
    earth: Object.freeze([ 6378.1366, 6378.1366, 6356.7519 ]),
    mars: Object.freeze([ 3396.19, 3396.19, 3376.2 ]),
    jupiter: Object.freeze([ 71492, 71492, 66854 ]),
    saturn: Object.freeze([ 60268, 60268, 54364 ]),
    uranus: Object.freeze([ 25559, 25559, 24973 ]),
    neptune: Object.freeze([ 24764, 24764, 24341 ]),
    moon: Object.freeze([ 1737.4, 1737.4, 1737.4 ]),
    phobos: Object.freeze([ 13, 11.4, 9.1 ]),
    deimos: Object.freeze([ 7.8, 6, 5.1 ]),
    io: Object.freeze([ 1829.4, 1819.4, 1815.7 ]),
    europa: Object.freeze([ 1562.6, 1560.3, 1559.5 ]),
    ganymede: Object.freeze([ 2631.2, 2631.2, 2631.2 ]),
    callisto: Object.freeze([ 2410.3, 2410.3, 2410.3 ]),
    himalia: Object.freeze([ 85, 85, 85 ]),
    mimas: Object.freeze([ 207.8, 196.7, 190.6 ]),
    enceladus: Object.freeze([ 256.6, 251.4, 248.3 ]),
    tethys: Object.freeze([ 538.4, 528.3, 526.3 ]),
    dione: Object.freeze([ 563.4, 561.3, 559.6 ]),
    rhea: Object.freeze([ 765, 763.1, 762.4 ]),
    titan: Object.freeze([ 2575.15, 2574.78, 2574.47 ]),
    hyperion: Object.freeze([ 180.1, 133, 102.7 ]),
    iapetus: Object.freeze([ 745.7, 745.7, 712.1 ]),
    phoebe: Object.freeze([ 109.4, 108.5, 101.8 ]),
    ariel: Object.freeze([ 581.1, 577.9, 577.7 ]),
    umbriel: Object.freeze([ 584.7, 584.7, 584.7 ]),
    titania: Object.freeze([ 788.9, 788.9, 788.9 ]),
    oberon: Object.freeze([ 761.4, 761.4, 761.4 ]),
    miranda: Object.freeze([ 240.4, 234.2, 232.9 ]),
    triton: Object.freeze([ 1352.6, 1352.6, 1352.6 ]),
    nereid: Object.freeze([ 170, 170, 170 ]),
    pluto: Object.freeze([ 1188.3, 1188.3, 1188.3 ]),
    charon: Object.freeze([ 606, 606, 606 ])
});

function maxRadiusKm(key, fallback) {
    const axes = axesKm[key];
    return axes ? Math.max(...axes) : fallback;
}

function createGeometry(THREE, key, radius, width = 64, height = 32) {
    const geometry = new THREE.SphereGeometry(radius, width, height);
    const axes = axesKm[key];
    if (axes) {
        const max = Math.max(...axes);
        geometry.scale(axes[0] / max, axes[2] / max, axes[1] / max);
        geometry.userData.referenceAxesKm = [ ...axes ];
        geometry.userData.shapeModel = "NAIF PCK reference ellipsoid; no terrain";
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

export const BodyShapes = Object.freeze({
    axesKm: axesKm,
    maxRadiusKm: maxRadiusKm,
    createGeometry: createGeometry
});
