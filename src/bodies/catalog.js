export const MOONS = Object.fromEntries([ [ "phobos", "Phobos", "mars", 11.08, .31891, 9376, 8550507, 708754e-9, "MARSSAT" ], [ "deimos", "Deimos", "mars", 6.2, 1.26244, 23463, 9537400, 96155e-9, "MARSSAT" ], [ "io", "Io", "jupiter", 1821.49, 1.76914, 421800, 13219959, 5959.9155, "Astronomy Engine JupiterMoons" ], [ "europa", "Europa", "jupiter", 1560.8, 3.55118, 671100, 11972512, 3202.7121, "Astronomy Engine JupiterMoons" ], [ "ganymede", "Ganymede", "jupiter", 2631.2, 7.15455, 1070400, 9867398, 9887.8328, "Astronomy Engine JupiterMoons" ], [ "callisto", "Callisto", "jupiter", 2410.3, 16.689, 1882700, 7235679, 7179.2834, "Astronomy Engine JupiterMoons" ], [ "mimas", "Mimas", "saturn", 198.2, .94242, 185539, 10921632, 2.5035, "TASS17" ], [ "enceladus", "Enceladus", "saturn", 252.1, 1.37022, 238042, 13948368, 7.2104, "TASS17" ], [ "tethys", "Tethys", "saturn", 531.1, 1.8878, 294672, 12369077, 41.21, "TASS17" ], [ "dione", "Dione", "saturn", 561.4, 2.73692, 377415, 11579560, 73.113, "TASS17" ], [ "rhea", "Rhea", "saturn", 763.8, 4.51821, 527068, 10921632, 153.941, "TASS17" ], [ "titan", "Titan", "saturn", 2574.7, 15.9454, 1221870, 11836003, 8978.1382, "TASS17" ], [ "hyperion", "Hyperion", "saturn", 135, 21.2766, 1500933, 9930098, .3727, "TASS17" ], [ "iapetus", "Iapetus", "saturn", 734.5, 79.3215, 3560820, 9341054, 120.504, "TASS17" ], [ "miranda", "Miranda", "uranus", 235.8, 1.41348, 129390, 10789787, 4.3195, "GUST86" ], [ "ariel", "Ariel", "uranus", 578.9, 2.52038, 191020, 11776682, 83.5, "GUST86" ], [ "umbriel", "Umbriel", "uranus", 584.7, 4.14418, 266300, 7829103, 85.1, "GUST86" ], [ "titania", "Titania", "uranus", 788.9, 8.70587, 435910, 10196364, 226.9, "GUST86" ], [ "oberon", "Oberon", "uranus", 761.4, 13.4632, 583520, 9011318, 205.3, "GUST86" ], [ "triton", "Triton", "neptune", 1353.4, 5.87685, 354759, 13352885, 1427.598, "JPL NEP098" ], [ "nereid", "Nereid", "neptune", 170, 360.1362, 5513818, 9671566, .002, "JPL NEP098" ] ].map(([key, name, parent, radiusKm, periodDays, aKm, color, gm, source]) => [ key, {
    key: key,
    name: name,
    parent: parent,
    radiusKm: radiusKm,
    periodDays: periodDays,
    aKm: aKm,
    color: color,
    gm: gm,
    source: source
} ]));

export const EARTH_MOON = {
    key: "moon",
    name: "Moon",
    parent: "earth",
    radiusKm: 1737.4,
    periodDays: 27.32166,
    aKm: 384400,
    gm: 4902.800066,
    source: "ELPMPP02 LLR"
};

export const ALL_MOONS = {
    moon: EARTH_MOON,
    ...MOONS
};

export const PLANETS = [ "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune" ];

export const SYSTEM_GM = {
    mars: 42828.375816,
    jupiter: 126712764.1,
    saturn: 37940584.8418,
    uranus: 5794556.4
};

export const EXTRA_BODIES = {
    pluto: {
        name: "Pluto",
        parent: "sun",
        parentName: "Sun",
        radiusKm: 1188.3,
        aKm: 5906406380,
        periodDays: 90560,
        color: 11903895,
        source: "JPL PLU060/DE440, body center relative to Sun",
        validationKm: .0207
    },
    charon: {
        name: "Charon",
        parent: "pluto",
        parentName: "Pluto",
        radiusKm: 606,
        aKm: 19600,
        periodDays: 6.387222,
        color: 10065551,
        source: "JPL PLU060/DE440, Pluto-relative",
        validationKm: .0116
    },
    himalia: {
        name: "Himalia",
        parent: "jupiter",
        parentName: "Jupiter",
        radiusKm: 85,
        aKm: 1137e4,
        periodDays: 247.778,
        color: 9142902,
        source: "JPL JUP347/DE442, Jupiter-relative",
        validationKm: .0343
    },
    phoebe: {
        name: "Phoebe",
        parent: "saturn",
        parentName: "Saturn",
        radiusKm: 106.6,
        aKm: 12947780,
        periodDays: 550.31,
        color: 7828334,
        source: "JPL SAT441L, Saturn-relative",
        validationKm: .1784
    }
};
