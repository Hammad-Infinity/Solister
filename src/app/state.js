const THREE = window.THREE;
const { OrbitControls } = window;
const { CSS2DRenderer, CSS2DObject } = window;
const DEG = Math.PI / 180;
const AU_UNITS = 1200;
const KM_PER_AU = 149597870.7;
function clampSimulationDate(ms){return Number.isFinite(ms)&&Math.abs(ms)<=8640000000000000?ms:Date.now();}
const SECONDS_PER_YEAR = 31557600;
const orbitScaleFor = (aAU) => aAU * AU_UNITS;
const km2u = (km) => km / KM_PER_AU * AU_UNITS;
const ASTEROIDS_STORAGE_KEY = 'solarAllAsteroidsEnabled';
const FPS_OPTIONS = [30, 48, 60];
const TRACK_COUNT = 6;
const TRACK_FADE_SECONDS = 3;
const MAX_TIME_RATE = 2160000;
const DEFAULT_SPEED_SLIDER = 0;
const IDLE_TIMEOUT_MS = 3000;
const LABEL_UPDATE_INTERVAL = 1 / 30;
const LOADING_MIN_MS = 650;
const LOADING_HARD_MS = 20000;
const RES_PICKER_DELAY_MS = 500;
const ZOOM_SENSITIVITY = 0.0010;
const ZOOM_EASE_RATE = 7.5;
const CAMERA_MOVE_MAX_SPEED = 0.2;
const CAMERA_WALK_SPEED_MPS = 1.4;
const CAMERA_NEAR_BODY_SPEED_MPS = 1.4;
const CAMERA_ARC_BOW = 0.16;
const CAMERA_FOV_BREATH = 0.025;
const CLOUD_FADE_SPEED = 5.0;
const GRAPHICS_STREAMERS      = { low: 0.0,  medium: 0.35, high: 0.55 };
const GRAPHICS_PIXEL_RATIO    = { low: 1.0,  medium: 1.25, high: 1.5 };
const GRAPHICS_ASTEROID_COUNT = { low: 2000, medium: 4000, high: 6000 };
const GRAPHICS_LABEL_INTERVAL = { low: 1/12, medium: 1/20, high: 1/30 };
const ASTEROID_RENDER = { count: 6000, detail: 2 };
const TEXTURE_QUALITY_POLICY = {
    low:    { base: '2k', color: '2k' },
    medium: { base: '4k', color: '4k' },
    high:   { base: '8k', color: '8k' },
};
const TEXTURE_RESOLUTION_VALUES = ['2k', '4k', '8k'];
const TEXTURE_RESOLUTION_SIZE = { '2k': 2048, '4k': 4096, '8k': 8192 };
function normalizeTextureResolution(value, fallback = '2k') {
    return TEXTURE_RESOLUTION_VALUES.includes(value) ? value : fallback;
}
function textureResolutionSupported(value) {
    const maxSize = renderer?.capabilities?.maxTextureSize || Infinity;
    return maxSize >= (TEXTURE_RESOLUTION_SIZE[value] || 0);
}
function bestSupportedTextureResolution(value, fallback = '2k') {
    const normalized = normalizeTextureResolution(value, fallback);
    if (textureResolutionSupported(normalized)) return normalized;
    for (let i = TEXTURE_RESOLUTION_VALUES.length - 1; i >= 0; i--) {
        const candidate = TEXTURE_RESOLUTION_VALUES[i];
        if ((TEXTURE_RESOLUTION_SIZE[candidate] || 0) <= (TEXTURE_RESOLUTION_SIZE[normalized] || 0) && textureResolutionSupported(candidate)) return candidate;
    }
    return fallback;
}
const SKY_TEXTURE_RESOLUTION_VALUES = ['2k', '4k', '8k', '16k'];
const SKY_TEXTURE_RESOLUTION_SIZE = { '2k': 2048, '4k': 4096, '8k': 8192, '16k': 16384 };
function normalizeSkyTextureResolution(value, fallback = '4k') {
    return SKY_TEXTURE_RESOLUTION_VALUES.includes(value) ? value : fallback;
}
function skyTextureResolutionSupported(value) {
    const maxSize = renderer?.capabilities?.maxTextureSize || Infinity;
    return maxSize >= (SKY_TEXTURE_RESOLUTION_SIZE[value] || 0);
}
function bestSupportedSkyTextureResolution(value, fallback = '4k') {
    const normalized = normalizeSkyTextureResolution(value, fallback);
    if (skyTextureResolutionSupported(normalized)) return normalized;
    for (let i = SKY_TEXTURE_RESOLUTION_VALUES.length - 1; i >= 0; i--) {
        const candidate = SKY_TEXTURE_RESOLUTION_VALUES[i];
        if ((SKY_TEXTURE_RESOLUTION_SIZE[candidate] || 0) <= (SKY_TEXTURE_RESOLUTION_SIZE[normalized] || 0) && skyTextureResolutionSupported(candidate)) return candidate;
    }
    return fallback;
}
const SUN_CORONA_ENABLED        = true;
// Corona tuning is anchored to eclipse/coronagraph measurements:
//  * the K-corona (electron-scattered light, all of the visible corona
//    within ~2 solar radii) falls off as r^-4.3..-4.5 (Koutchmy & Lamy;
//    A&A 2022 F/K-corona profile fits),
//  * its brightness drops >x100 within one solar radius above the limb
//    (American Scientist / eclipse photometry),
//  * the eye only sees the corona out to ~2 R_sun during totality.
// So the inner glow uses a steep power law, and the shell is sized to let
// faint streamers finish fading smoothly (18 % edge ramp) instead of a
// 9-radius bubble that reads as an inflated halo.
const SUN_CORONA_SHELL_SCALE    = 6.0;
const SUN_CORONA_INTENSITY      = 1.10;
const SUN_CORONA_POWER          = 4.3;
const SUN_CORONA_STREAMERS      = 0.10;
const SUN_CORONA_STREAMER_SCALE = 4.2;
const SUN_DIM_MAX    = 0.90;
const SUN_DIM_FAR_R  = 330.0;
const SUN_DIM_NEAR_R = 3.0;
const SUN_DIM_CLEAR_R = 1.30;
const SUN_DIM_OUTER_R = 2.35;
const ENABLE_NEW_MOON_SHADOWS = true;
const MODULE_BUILD = 'r27';
const CATALOG_UPDATE_HZ = 8;
const CATALOG_UPDATE_MS = 1000 / CATALOG_UPDATE_HZ;
let asteroidsEnabled = false;
let textureResolution = '2k';
let skyResolution = '4k';
let textureQuality = 'medium';
let simTimeMs = Date.now();
let timeScale = 1;
let isPaused = false;
let showOrbits = true;
let showLabels = true;
let beltGuideEnabled = true;
let trackIndex = 1;
let failedTracks = 0;
let volume = 0.35;
let lastNonZeroVol = 0.35;
let muted = false;
let audioEnabled = true;
let fadeRaf = null;
let musicContext;
let trackGain;
let earthCloudsEnabled = true;
let earthCloudsOpacity = 1.0;
let venusAtmoEnabled = true;
let venusAtmoOpacity = 1.0;
let sunCoronaEnabled = true;
let sunCoronaFade = 1.0;
let milkyWayTexture = null;
let themeGradientTexture = null;
let skyMaps = null;
let constellationLayer = null;
let earthNightTexture = null;
let sunCoronaMesh = null;
let sunHaloMesh = null;
let sunSurfaceSpriteMesh = null;
let sunLensArtifacts = null;
let sunDimAmt = 0;
let saturnMat = null;
let saturnRingMat = null;
let moonMat = null;
let earthMat = null;
let asteroidBelt = null;
let moonOrbitLine = null;
let moonOrbitLastUpdate = -Infinity;
let focusedObject = null;
let lastFocusedObject = null;
let landingState = null;
let rightOrbitObject = null;
let rightOrbitActive = false;
let freeAimDistance = 36;
const cameraKeys = new Set();
const sceneOriginOffset = new THREE.Vector3();
let distanceReadout = null;
let camTransition = null;
let _camFovBase = 0;
let zoomDistTarget = null;
let _focusBounds = null;
let _focusAnchorEl = null;
let targetFps = 48;
let _fpsLastFrame = 0;
let isWallpaperEngine = false;
let inputModeReady = false;
let _contextLost = false;
let _pointerDownPos = null;
let _uiAccum = 0;
let _labelAccum = 0;
let lastActivity = performance.now();
let hoveringDockBody = false;
let draggingDock = false;
let _uiIdle = false;
let _lastCatalogWall = 0;
let _lastCatalogSimMs = 0;
let textureResetLoader = null;
let textureResetGeneration = 0;
let mapManifestNotice = false;
const loadedTextures = new Map();
const textureRequests = new TextureRequests(THREE, 2);
const skyTextureRequests = new TextureRequests(THREE, 2);
const objectRegistry = {};
const bodyOrientation = new BodyOrientation({ THREE });
const elevationCatalog = new ElevationCatalog({
    THREE, objectRegistry,
    baseUrl: new URL('./data/elevation/', document.baseURI).href,
    onStatus(code, message) {
        if (code === 'error' || code === 'map-error') console.warn('[Elevation catalog]', message);
    }
});
const equatorialGrid = new EquatorialGrid({ THREE, objectRegistry, bodyShapes: BodyShapes, elevationCatalog });
const planets = [];
const labelObjects = [];
const orbitLines = [];
const cloudMeshes = {};
const proceduralTextures = {};
const mapManifests = new Map();
const mapManifestPending = new Map();
const ringShadowBindings = [];
const pathSettings = { style: 'orbits', enabled: true, length: .65, width: 1, glow: 1 };
const focusLod = {
    generation: 0,
    states: new Map(),
    tickAt: 0,
    releaseMs: 5000,
    tickMs: 650,
};
const skyToggles = {
    milkyway: true, figures: false, boundaries: false,
    grid: false, eclipticGrid: false, galacticGrid: false,
    conLabels: false, starLabels: false,
};
let speedSliderValue = DEFAULT_SPEED_SLIDER;
const _lineEase = { ax: 0, ay: 0, at: 0, on: false, o: 0 };
const _labelItems = [];
const _labelItemPool = [];
const _labelPlaced = [];
const _labelPlacedPool = [];
const eclipseUniforms = {
    uEclipseMoon: { value: new THREE.Vector3() },
    uEclipseSun: { value: new THREE.Vector3() },
    uEclipseMoonRadius: { value: 0 },
    uEclipseSunRadius: { value: 0 }
};
const ECLIPSE_GLSL = `
    uniform vec3 uEclipseMoon;
    uniform vec3 uEclipseSun;
    uniform float uEclipseMoonRadius;
    uniform float uEclipseSunRadius;
    float solarVisibility(vec3 p) {
        vec3 toSun = uEclipseSun - p;
        vec3 toMoon = uEclipseMoon - p;
        float ds = length(toSun);
        float dm = length(toMoon);
        if (dm >= ds || dm <= uEclipseMoonRadius ||
            uEclipseSunRadius <= 0.0 ||
            uEclipseMoonRadius <= 0.0) {
            return 1.0;
        }
        vec3 s = toSun / ds;
        vec3 m = toMoon / dm;
        float separation = atan(length(cross(s, m)), dot(s, m));
        float rs = asin(clamp(uEclipseSunRadius / ds, 0.0, 1.0));
        float rm = asin(clamp(uEclipseMoonRadius / dm, 0.0, 1.0));
        float d = separation / max(rs, 1e-8);
        float r = rm / max(rs, 1e-8);
        if (d >= 1.0 + r) return 1.0;
        if (d <= abs(1.0 - r)) {
            return 1.0 - min(1.0, r * r);
        }
        float d2 = d * d;
        float r2 = r * r;
        float a = acos(clamp(
            (d2 + 1.0 - r2) / (2.0 * d), -1.0, 1.0
        ));
        float b = acos(clamp(
            (d2 + r2 - 1.0) / (2.0 * d * r), -1.0, 1.0
        ));
        float product =
            (-d + 1.0 + r) *
            ( d + 1.0 - r) *
            ( d - 1.0 + r) *
            ( d + 1.0 + r);
        float overlap =
            a + r2 * b - 0.5 * sqrt(max(0.0, product));
        return clamp(1.0 - overlap / 3.14159265359, 0.0, 1.0);
    }
`;
const J2000_ELEMENTS = {
    mercury: {
        a: [0.38709927, 0.00000037],   e: [0.20563593, 0.00001906],
        I: [7.00497902, -0.00594749],   L: [252.25032350, 149472.67411175],
        w: [77.45779628, 0.16047689],   O: [48.33076593, -0.12534081],
    },
    venus: {
        a: [0.72333566, 0.00000390],   e: [0.00677672, -0.00004107],
        I: [3.39467605, -0.00078890],   L: [181.97909950, 58517.81538729],
        w: [131.60246718, 0.00268329],  O: [76.67984255, -0.27769418],
    },
    earth: {
        a: [1.00000261, 0.00000562],   e: [0.01671123, -0.00004392],
        I: [-0.00001531, -0.01294668],  L: [100.46457166, 35999.37244981],
        w: [102.93768193, 0.32327364],  O: [0.0, 0.0],
    },
    mars: {
        a: [1.52371034, 0.00001847],   e: [0.09339410, 0.00007882],
        I: [1.84969142, -0.00813131],   L: [-4.55343205, 19140.30268499],
        w: [-23.94362959, 0.44441088],  O: [49.55953891, -0.29257343],
    },
    jupiter: {
        a: [5.20288700, -0.00011607],  e: [0.04838624, -0.00013253],
        I: [1.30439695, -0.00183714],   L: [34.39644051, 3034.74612775],
        w: [14.72847983, 0.21252668],   O: [100.47390909, 0.20469106],
    },
    saturn: {
        a: [9.53667594, -0.00125060],  e: [0.05386179, -0.00050991],
        I: [2.48599187, 0.00193609],    L: [49.95424423, 1222.49362201],
        w: [92.59887831, -0.41897216],  O: [113.66242448, -0.28867794],
    },
    uranus: {
        a: [19.18916464, -0.00196176], e: [0.04725744, -0.00004397],
        I: [0.77263783, -0.00242939],   L: [313.23810451, 428.48202785],
        w: [170.95427630, 0.40805281],  O: [74.01692503, 0.04240589],
    },
    neptune: {
        a: [30.06992276, 0.00026291],  e: [0.00859048, 0.00005105],
        I: [1.77004347, 0.00035372],    L: [-55.12002969, 218.45945325],
        w: [44.96476227, -0.32241464],  O: [131.78422574, -0.00508664],
    },
};
const MOON_ORBIT_KM = 384400;
const moonData = { key: 'moon', minZoomDistance: 1.0, maxZoomDistance: 30 };
const planetData = [
    { name: 'Mercury', key: 'mercury', radius: km2u(2439.7), orbitRadius: 0.38709927 * AU_UNITS,
      eccentricity: 0.20563593, inclination: 7.00497902 * DEG },
    { name: 'Venus', key: 'venus', radius: km2u(6051.8), orbitRadius: 0.72333566 * AU_UNITS,
      eccentricity: 0.00677672, inclination: 3.39467605 * DEG },
    { name: 'Earth', key: 'earth', radius: km2u(6371.0), orbitRadius: 1.00000261 * AU_UNITS,
      eccentricity: 0.01671123, inclination: -0.00001531 * DEG, hasMoon: true },
    { name: 'Mars', key: 'mars', radius: km2u(3389.5), orbitRadius: 1.52371034 * AU_UNITS,
      eccentricity: 0.09339410, inclination: 1.84969142 * DEG },
    { name: 'Jupiter', key: 'jupiter', radius: km2u(69911), orbitRadius: 5.20288700 * AU_UNITS,
      eccentricity: 0.04838624, inclination: 1.30439695 * DEG },
    { name: 'Saturn', key: 'saturn', radius: km2u(58232), orbitRadius: 9.53667594 * AU_UNITS,
      eccentricity: 0.05386179, inclination: 2.48599187 * DEG, hasRings: true },
    { name: 'Uranus', key: 'uranus', radius: km2u(25362), orbitRadius: 19.18916464 * AU_UNITS,
      eccentricity: 0.04725744, inclination: 0.77263783 * DEG, hasFaintRings: true },
    { name: 'Neptune', key: 'neptune', radius: km2u(24622), orbitRadius: 30.06992276 * AU_UNITS,
      eccentricity: 0.00859048, inclination: 1.77004347 * DEG, hasNeptuneRings: true },
];
for (const data of planetData) data.radius = km2u(BodyShapes.maxRadiusKm(data.key));
const bodyFacts = {
    solarsystem: {
        kind: 'Star System',
        name: 'Solar System',
        tagline: 'The Sun and everything gravitationally bound to it — eight planets, dwarf planets, moons, asteroids, and comets.',
        stats: [
            ['Age', '4.6 billion years'],
            ['Location', 'Orion Arm, Milky Way'],
            ['Central star', 'Sun (G2V)'],
            ['Planets', '8'],
            ['Dwarf planets', '5 known'],
            ['Known moons', '290+'],
            ['Diameter', '~2 light-years (Oort Cloud)'],
            ['Galactic orbit', '~230 million years'],
        ]
    },
    asteroidbelt: {
        kind: 'Small-body Population',
        name: 'Asteroid Belt',
        tagline:
            'A sparse population of rocky bodies between Mars and Jupiter—not a solid ring.',
        stats: [
            ['Main region', '~2.1–3.3 AU from the Sun'],
            ['Orbital periods', '~3–6 years'],
            ['Orbital plane', 'Near the ecliptic, with inclined orbits'],
            ['Distribution', 'Includes resonance-depleted regions'],
        ]
    },
    sun: {
        kind: 'Star',
        name: 'Sun',
        tagline: 'The star that anchors the entire system — 99.86% of all mass in the solar system.',
        stats: [
            ['Type', 'G2V main-sequence'],
            ['Radius', '696,340 km'],
            ['Mass', '333,000× Earth'],
            ['Surface temp', '5,505 °C'],
            ['Core temp', '15.7 million °C'],
            ['Luminosity', '3.83×10²⁶ W'],
            ['Rotation', '24.5 days (equator)'],
            ['Composition', '73% H · 25% He'],
            ['Age', '4.6 billion years'],
        ]
    },
    mercury: {
        kind: 'Terrestrial Planet',
        name: 'Mercury',
        tagline: 'Smallest planet, closest to the Sun, and the fastest — one lap every 88 days.',
        stats: [
            ['Radius', '2,440 km'],
            ['Mass', '0.055× Earth'],
            ['Distance', '0.39 AU'],
            ['Orbital period', '88 days'],
            ['Rotation', '59 Earth days'],
            ['Surface temp', '−180 to 430 °C'],
            ['Atmosphere', 'negligible'],
            ['Moons', '0'],
        ]
    },
    venus: {
        kind: 'Terrestrial Planet',
        name: 'Venus',
        tagline: 'Earth-sized but wrapped in a crushing CO₂ atmosphere. Hotter than Mercury.',
        stats: [
            ['Radius', '6,052 km'],
            ['Mass', '0.815× Earth'],
            ['Distance', '0.72 AU'],
            ['Orbital period', '225 days'],
            ['Rotation', '243 days (retrograde)'],
            ['Surface temp', '465 °C'],
            ['Pressure', '92× Earth'],
            ['Atmosphere', '96% CO₂'],
            ['Moons', '0'],
        ]
    },
    earth: {
        kind: 'Terrestrial Planet',
        name: 'Earth',
        tagline: 'The only known world with liquid surface water and life.',
        stats: [
            ['Radius', '6,371 km'],
            ['Mass', '5.97×10²⁴ kg'],
            ['Distance', '1.00 AU'],
            ['Orbital period', '365.25 days'],
            ['Rotation', '23h 56m'],
            ['Axial tilt', '23.4°'],
            ['Surface temp', '−89 to 58 °C'],
            ['Atmosphere', '78% N₂ · 21% O₂'],
            ['Moons', '1'],
        ]
    },
    mars: {
        kind: 'Terrestrial Planet',
        name: 'Mars',
        tagline: 'The red planet — home to Olympus Mons, the tallest volcano in the solar system.',
        stats: [
            ['Radius', '3,390 km'],
            ['Mass', '0.107× Earth'],
            ['Distance', '1.52 AU'],
            ['Orbital period', '687 days'],
            ['Rotation', '24h 37m'],
            ['Surface temp', '−125 to 20 °C'],
            ['Atmosphere', '95% CO₂ · 0.6% Earth pressure'],
            ['Moons', '2 (Phobos, Deimos)'],
        ]
    },
    jupiter: {
        kind: 'Gas Giant',
        name: 'Jupiter',
        tagline: 'The largest planet — a storm called the Great Red Spot has raged for centuries.',
        stats: [
            ['Radius', '69,911 km (11× Earth)'],
            ['Mass', '318× Earth'],
            ['Distance', '5.20 AU'],
            ['Orbital period', '11.86 years'],
            ['Rotation', '9h 56m'],
            ['Atmosphere', '90% H · 10% He'],
            ['Great Red Spot', '~1.3× Earth wide'],
            ['Ring system', 'faint, dusty'],
        ]
    },
    saturn: {
        kind: 'Gas Giant',
        name: 'Saturn',
        tagline: 'Famous for its rings of ice and rock. Less dense than water.',
        stats: [
            ['Radius', '58,232 km (9.1× Earth)'],
            ['Mass', '95× Earth'],
            ['Distance', '9.58 AU'],
            ['Orbital period', '29.4 years'],
            ['Rotation', '10h 42m'],
            ['Density', '0.687 g/cm³'],
            ['Ring span', '~280,000 km'],
            ['Atmosphere', '96% H · 3% He'],
            ['Ring composition', 'Mostly water ice'],
        ]
    },
    uranus: {
        kind: 'Ice Giant',
        name: 'Uranus',
        tagline: 'Rotates on its side — probably knocked over by a massive collision long ago.',
        stats: [
            ['Radius', '25,362 km'],
            ['Mass', '14.5× Earth'],
            ['Distance', '19.2 AU'],
            ['Orbital period', '84 years'],
            ['Rotation', '17h 14m (retrograde)'],
            ['Axial tilt', '97.8°'],
            ['Atmosphere', 'H, He, CH₄'],
            ['Discovery', 'Herschel, 1781'],
        ]
    },
    neptune: {
        kind: 'Ice Giant',
        name: 'Neptune',
        tagline: 'Farthest planet. Fastest winds in the solar system — up to 2,100 km/h.',
        stats: [
            ['Radius', '24,622 km'],
            ['Mass', '17.1× Earth'],
            ['Distance', '30.1 AU'],
            ['Orbital period', '165 years'],
            ['Rotation', '16h 6m'],
            ['Atmosphere', 'H, He, CH₄'],
            ['Winds', 'up to 2,100 km/h'],
            ['Discovery', 'Le Verrier, 1846'],
        ]
    },
    moon: {
        kind: 'Natural Satellite',
        name: 'Moon',
        tagline: 'Earth\'s only natural satellite. Tidally locked, so one face always faces Earth.',
        stats: [
            ['Radius', '1,737 km'],
            ['Mass', '0.0123× Earth'],
            ['Distance', '384,400 km'],
            ['Orbital period', '27.3 days'],
            ['Rotation', '27.3 days (locked)'],
            ['Surface temp', '−173 to 127 °C'],
            ['Gravity', '0.166 g'],
            ['Formation', 'giant-impact, ~4.5 Bya'],
        ]
    },
};
const wantBodyPin2K = () => false;
const skyTexRes = () => skyResolution;
const weatherEnabled = () => !lightningReducedMotion.matches;
const lightningReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const _beltSunPosition = new THREE.Vector3();
const beltProximity = () => {
    const sun = objectRegistry.sun;
    const d = sun ? camera.position.distanceTo(sun.getWorldPosition(_beltSunPosition)) : camera.position.length();
    const radiusAu = d / AU_UNITS;
    return Math.max(0, Math.min(1, (3.6 - radiusAu) / 1.5));
};
try {
    const saved = localStorage.getItem(ASTEROIDS_STORAGE_KEY);
    if (saved === '0' || saved === '1') {
        asteroidsEnabled = saved === '1';
    } else {
        asteroidsEnabled = false;
    }
} catch (e) {}
try {
    const savedSky = localStorage.getItem('solarSkyTexRes');
    skyResolution = normalizeSkyTextureResolution(savedSky, skyResolution);
} catch (e) {}
try {
    const saved = localStorage.getItem('solarTexRes');
    textureResolution = normalizeTextureResolution(saved, textureResolution);
} catch (e) {}
try {
    const savedQuality = localStorage.getItem('solarTextureQuality');
    if (savedQuality === 'ultra') textureQuality = 'high';
    else if (Object.prototype.hasOwnProperty.call(TEXTURE_QUALITY_POLICY, savedQuality)) {
        textureQuality = savedQuality;
    }
} catch (e) {}
try {
    const _st = JSON.parse(localStorage.getItem('solarSkyToggles') || 'null');
    if (_st && typeof _st === 'object') {
        for (const key of Object.keys(skyToggles)) if (typeof _st[key] === 'boolean') skyToggles[key] = _st[key];
    }
} catch (e) {}
try {
    const savedFps = parseInt(localStorage.getItem('solarTargetFps'), 10);
    if (FPS_OPTIONS.includes(savedFps)) targetFps = savedFps;
} catch (_) {}
try {
    const sc = localStorage.getItem('solarEarthClouds');
    if (sc !== null) {
        earthCloudsEnabled = sc === '1';
        earthCloudsOpacity = earthCloudsEnabled ? 1.0 : 0.0;
    }
    const sv = localStorage.getItem('solarVenusAtmo');
    if (sv !== null) {
        venusAtmoEnabled = sv === '1';
        venusAtmoOpacity = venusAtmoEnabled ? 1.0 : 0.0;
    }
} catch (e) {}
try {
    const _params = new URLSearchParams(location.search);
    if (_params.get('we') === '1' || _params.get('wallpaper') === '1') {
        isWallpaperEngine = true;
    }
} catch (e) {}
try {
    const currentSpeed = localStorage.getItem('solarSpeed');
    const legacySpeed = localStorage.getItem('solarSpeedRealism');
    const savedSpeed = parseInt(currentSpeed ?? legacySpeed, 10);
    if (Number.isFinite(savedSpeed) && savedSpeed >= -100 && savedSpeed <= 100) {
        speedSliderValue = savedSpeed;
        if (currentSpeed === null) localStorage.setItem('solarSpeed', String(savedSpeed));
    }
    if (legacySpeed !== null) localStorage.removeItem('solarSpeedRealism');
} catch (e) {}
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
const solarSystem = new THREE.Group();
solarSystem.userData = { planetKey: 'solarsystem', planetName: 'Solar System', isSystem: true };
scene.add(solarSystem);
const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.5, 20000);
const DEFAULT_CAM_POS = new THREE.Vector3(900, 600, 1300);
camera.position.copy(DEFAULT_CAM_POS);
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: true,
    // PERMANENT depth fix: with the real-scale camera the near plane dives to
    // ~1e-8 while far stays ~1.2e6 (ratio ~1e14), which exhausts a 24-bit
    // linear depth buffer — every distant surface collapses onto the same
    // depth value and rings/planets/moons fight for position. Logarithmic
    // depth gives ~8e-7 RELATIVE precision everywhere, so co-planar rings,
    // limbs and transits stay cleanly separated at any camera distance.
    logarithmicDepthBuffer: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, GRAPHICS_PIXEL_RATIO[textureQuality] ?? 1.5));
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;
container.appendChild(renderer.domElement);
textureRequests.attachRenderer(renderer);
skyTextureRequests.attachRenderer(renderer);
textureResolution = bestSupportedTextureResolution(textureResolution);
skyResolution = bestSupportedSkyTextureResolution(skyResolution, skyResolution);
textureResolution = bestSupportedTextureResolution(textureResolution);
skyResolution = bestSupportedSkyTextureResolution(skyResolution, skyResolution);
const clock = new THREE.Clock();
const performanceDefaults = new PerformanceDefaults();
const contextOverlay = document.createElement('div');
contextOverlay.id = 'context-loss-overlay';
contextOverlay.style.cssText =
    'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
    'background:rgba(10,10,12,0.82);color:#e6e6e6;font-size:0.9rem;letter-spacing:2px;' +
    'text-transform:uppercase;z-index:700;text-align:center;padding:24px;' +
    'backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);';
contextOverlay.textContent = 'Restoring graphics context…';
document.body.appendChild(contextOverlay);
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
labelRenderer.domElement.style.zIndex = '5';
container.appendChild(labelRenderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.rotateSpeed = 0.72;
controls.panSpeed = 0.75;
controls.minDistance = 25;
controls.maxDistance = 2000;
controls.enableZoom = false;
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI - 0.01;
controls.minPolarAngle = 0.01;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.06;
controls.enablePan = false;
controls.mouseButtons = {
    LEFT:   THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT:  THREE.MOUSE.ROTATE,
};
controls.update();
const ambientLight = new THREE.AmbientLight(0x000000, 0.0);
scene.add(ambientLight);
const sunLight = new THREE.PointLight(0xfff3e0, 500, 2000, 1.5);
sunLight.position.set(0, 0, 0);
scene.add(sunLight);
const loadingScreenEl = document.getElementById('loading-screen');
const loadingLabelEl  = document.getElementById('loading-label');
const focusLineLayer = document.getElementById('focus-line-layer');
const focusNameEl = document.getElementById('focus-name');
const focusKindEl = document.getElementById('focus-kind');
const focusTaglineEl = document.getElementById('focus-tagline');
const focusStatsEl = document.getElementById('focus-stats');
const dockEl = document.getElementById('ui-dock');
const dockBodyEl = document.getElementById('dock-body');
const dockHandleEl = document.getElementById('dock-handle');
const focusSectionEl = document.getElementById('focus-section');
const focusLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
focusLine.setAttribute('stroke', 'rgba(180,180,180,0.45)');
focusLine.setAttribute('stroke-width', '1');
focusLine.setAttribute('stroke-dasharray', '4 5');
focusLine.setAttribute('opacity', '0');
focusLineLayer.appendChild(focusLine);
const focusDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
focusDot.setAttribute('r', '3');
focusDot.setAttribute('fill',   'rgba(180,180,180,0.9)');
focusDot.setAttribute('opacity', '0');
focusLineLayer.appendChild(focusDot);
const sunDimEl = document.createElement('div');
sunDimEl.dataset.sunfx = 'dim';
sunDimEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;opacity:0;';
sunDimEl._lastGx = -1;
sunDimEl._lastGy = -1;
sunDimEl._lastGr = -1;
document.body.appendChild(sunDimEl);
const solarAccuracyStatus = document.createElement('p');
solarAccuracyStatus.id = 'solar-accuracy-status';
solarAccuracyStatus.setAttribute('role', 'status');
solarAccuracyStatus.style.cssText =
    'font-size:11px;line-height:1.45;color:var(--text-secondary);margin:6px 0 12px';
document.getElementById('body-select').parentElement
    .insertAdjacentElement('afterend', solarAccuracyStatus);
const ambientAudio = new Audio();
ambientAudio.loop = false;
ambientAudio.volume = 0.35;
ambientAudio.preload = 'auto';
const proceduralDrawFns = {
    mercury: drawMercuryTexture,
    venus: drawVenusTexture,
    earth: drawEarthTexture,
    mars: drawMarsTexture,
    jupiter: drawJupiterTexture,
    saturn: drawSaturnTexture,
    uranus: drawUranusTexture,
    neptune: drawNeptuneTexture,
    moon: drawMoonTexture,
    'saturn-ring': drawSaturnRingTexture,
};
let _mwLoadKey = null;
const moonOrbitPoint = new THREE.Vector3();
const solarAccuracy = new ApproximateEphemerisLayer({
    THREE, solarSystem, objectRegistry, bodyFacts, km2u,
    CSS2DObject: null, labelObjects: null,
    getOrbitLines: () => pathSettings.style === 'orbits' ? orbitLines : [],
    installShadow: typeof installRingParticleShadow === 'function'
        ? installRingParticleShadow : undefined,
    onStatus(code, message) {
        if (code === 'loading' && !_ephemerisLoading) {
            _ephemerisLoading = true;
            trackLoadStart();
            setLoadingLabel('Calculating planetary orbits…');
        } else if (['ready','error','range'].includes(code) && _ephemerisLoading) {
            _ephemerisLoading = false;
            trackLoadEnd();
        }
        solarAccuracyStatus.textContent = message;
        solarAccuracyStatus.hidden = !message;
        document.querySelectorAll('[data-ephemeris-moon]').forEach(item => {
            item.setAttribute('aria-disabled', code === 'ready' ? 'false' : 'true');
        });
    }
});
const extraBodies = new ExtraBodies({
    THREE, solarSystem, objectRegistry, bodyFacts, km2u,
    CSS2DObject: null, labelObjects: null, getTrailLayer: () => trailLayer
});
const cometLayer = new CometLayer({
    THREE, solarSystem, objectRegistry, bodyFacts, km2u, camera,
    au: AU_UNITS, orbitScale: orbitScaleFor,
    onLoadStart: () => { trackLoadStart(); setLoadingLabel('Loading comet ephemerides'); },
    onLoadEnd: () => trackLoadEnd()
});
constellationLayer = new ConstellationLayer({ THREE, scene, CSS2DObject, radius: SKY_RADIUS });
if (typeof constellationLayer.setOccluderProvider === 'function') {
    constellationLayer.setOccluderProvider(() => [
        ...Object.values(objectRegistry),
        ...Object.values(cloudMeshes)
    ].filter(Boolean));
}
window.__solarSky = {
    get layer() { return constellationLayer; },
    get maps() { return skyMaps; },
    get camera() { return camera; },
    get scene() { return scene; },
    get renderer() { return renderer; }
};
skyMaps = new SkyMaps({
    THREE, scene, renderer,
    basePath: './assets/textures',
    resolution: skyTexRes(),
    radius: SKY_RADIUS,
    milkywayOpacity: 1.0,
    milkywayExposure: 12.5,
    milkywayStretch: 40.0,
    milkywayGamma: 1.15,
    makeLoader:   (layer) => skyTextureRequests.batch('sky-' + (layer || 'maps')),
    onLoadStart:  () => trackLoadStart(),
    onLoadEnd:    () => trackLoadEnd(),
});
skyMaps.onVisibilityApplied = applyStarVisibility;
applySkyToggles(true);
applyStarVisibility();
if (typeof loadMilkywayBackground === 'function') loadMilkywayBackground();
const moduleNeedsInstall = [];
const resonantPopulations = new ResonantPopulations({
    THREE, solarSystem, objectRegistry, bodyFacts, km2u, renderer, camera,
    au: AU_UNITS, orbitScale: orbitScaleFor, accuracy: solarAccuracy,
    makeRock: createProceduralRockGeometry, eager: true
});
const nearEarth = new NearEarthObjects({
    THREE, solarSystem, objectRegistry, bodyFacts, renderer, camera,
    au: AU_UNITS, orbitScale: orbitScaleFor, accuracy: solarAccuracy, km2u,
    makeRock: createProceduralRockGeometry, eager: true
});
const kuiperBelt = new KuiperBelt({
    THREE, solarSystem, objectRegistry, bodyFacts,
    renderer, au: AU_UNITS, CSS2DObject: null, labelObjects: null,
    onFactsChange: () => {
        if (focusedObject?.userData.planetKey === 'kuiperbelt') showFocusCard(bodyFacts.kuiperbelt);
    }
});
const ringAsteroids = new RingAsteroids({
    THREE, camera, renderer, objectRegistry, km2u,
    getQuality: () => textureQuality
});
if (resonantPopulations.moduleBuild !== MODULE_BUILD)
    moduleNeedsInstall.push('src/bodies/small-bodies/resonant-populations.js');
if (nearEarth.moduleBuild !== MODULE_BUILD)
    moduleNeedsInstall.push('src/bodies/small-bodies/near-earth.js');
for (const [key, count] of Object.entries({
    mars: 2, jupiter: 5, saturn: 9, uranus: 5, neptune: 2
})) {
    bodyFacts[key].stats.push(['Moons rendered here', count + '; local ephemeris model']);
}
const moonEclipses = new MoonEclipses({ THREE, objectRegistry, km2u });
let bodyGlowMarkers = null;
let trailLayer = null;
let planetDetail = null;
let earthWeather = null;
let saturnAlignment = null;
let anchoredDock = null;
const pauseBtn = document.getElementById('pause-btn');
const speedSlider = document.getElementById('speed-slider');
const speedDisplay = document.getElementById('speed-display');
const toggleLabelsBtn = document.getElementById('toggle-labels');
const toggleRotateBtn = document.getElementById('toggle-rotate');
const resetViewBtn = document.getElementById('reset-view-btn');
const syncNowBtn = document.getElementById('sync-now-btn');
const unfocusBtn = document.getElementById('unfocus-btn');
const distanceHudEl = document.getElementById('camera-distance');
const surfaceGridBtn = document.getElementById('toggle-surface-grid');
const dateRowEl = document.getElementById('date-row');
const dateInputEl = document.getElementById('date-input');
const shortcutListEl = document.getElementById('shortcut-list');
const shortcutsTitleEl = document.getElementById('shortcuts-title');
const volumeBtn = document.getElementById('volume-btn');
const volumeSlider = document.getElementById('volume-slider');
const volumeDisplayEl = document.getElementById('volume-display');
const visualSelectEl = document.getElementById('visual-select');
const fpsSelectEl = document.getElementById('fps-select');
const bodySelectEl = document.getElementById('body-select');
const skyTextureSelectEl = document.getElementById('sky-texture-select');
const visualTriggerEl = visualSelectEl.querySelector('.tex-select-trigger');
const visualValueEl = visualSelectEl.querySelector('.tex-select-value');
const visualOptionEls = visualSelectEl.querySelectorAll('.tex-select-menu li');
const fpsTriggerEl = fpsSelectEl.querySelector('.tex-select-trigger');
const fpsValueEl = fpsSelectEl.querySelector('.tex-select-value');
const fpsOptionEls = fpsSelectEl.querySelectorAll('.tex-select-menu li');
const bodyTriggerEl = bodySelectEl.querySelector('.tex-select-trigger');
const bodyValueEl = bodySelectEl.querySelector('.tex-select-value');
const bodyOptionEls = bodySelectEl.querySelectorAll('.tex-select-menu li[data-key]');
const skyTextureOptionEls = skyTextureSelectEl
    ? [...skyTextureSelectEl.querySelectorAll('.tex-select-menu li[data-value]')] : [];
const moonGroups = {
    asteroidbelt: ['trojanl4', 'trojanl5', 'hildas', 'nea'],
    earth: ['moon'],
    mars: ['phobos', 'deimos'],
    jupiter: ['io', 'europa', 'ganymede', 'callisto', 'himalia'],
    saturn: ['mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'hyperion', 'iapetus', 'phoebe'],
    pluto: ['charon'],
    uranus: ['miranda', 'ariel', 'umbriel', 'titania', 'oberon'],
    neptune: ['triton', 'nereid']
};
const moonFlyout = document.createElement('div');
moonFlyout.id = 'moon-flyout';
moonFlyout.hidden = true;
document.body.appendChild(moonFlyout);
let flyoutHideTimer = null;
const KEYBOARD_SHORTCUTS = [
    ['Space',  'Pause / play'],
    ['H',      'Hide / show UI'],
    ['W A S D', 'Free camera movement'],
    ['Q / E',   'Roll counter-clockwise / clockwise'],
    ['L',      'Land on focused planet'],
    ['T',      'Toggle asteroid populations'],
    ['C',      'Stop camera motion'],
    ['M',      'Mute / unmute'],
    ['N',      'Sync to real positions'],
    ['O',      'Trails → Orbits → Off'],
    ['R',      'Overview (whole system)'],
    ['- +',     'Zoom out or Zoom in'],
    [', .',     'Simulation Speed'],
    ['Esc',    'Leave planet / reset camera'],
];
const MOUSE_CONTROLS = [
    ['L-click', 'Select body'],
    ['L-drag',  'Aim / look around'],
    ['R-drag',  'Orbit last-focused body'],
    ['scroll',  'Zoom in / out'],
];
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const _focusWorld = new THREE.Vector3();
const _focusScreen = new THREE.Vector3();
const _ctNow = new THREE.Vector3();
const _ctDelta = new THREE.Vector3();
const _ctToTarget = new THREE.Vector3();
const _ctToCam = new THREE.Vector3();
const _ctOffsetFrom = new THREE.Vector3();
const _ctOffsetTo = new THREE.Vector3();
const _ctDirFrom = new THREE.Vector3();
const _ctDirTo = new THREE.Vector3();
const _ctArc = new THREE.Vector3();
const _ctBowAxis = new THREE.Vector3();
const _ctQuatSpin = new THREE.Quaternion();
const _ctQuatStep = new THREE.Quaternion();
const _cullFrustum = new THREE.Frustum();
const _cullMat = new THREE.Matrix4();
const _cullSphere = new THREE.Sphere(new THREE.Vector3(), 1);
const _resolveScratch = new THREE.Vector3();
const _vortexCamPos = new THREE.Vector3();
const _sunLookScr = new THREE.Vector3();
const _sunLookPos = new THREE.Vector3();
const _sunLookDir = new THREE.Vector3();
const _zoomDir = new THREE.Vector3();
const _collisionPos = new THREE.Vector3();
const _collisionOffset = new THREE.Vector3();
const _pushTarget = new THREE.Vector3();
const _moonWorldTmp = new THREE.Vector3();
const _lightingScratchPosition = new THREE.Vector3();
const _lightingScratchDirection = new THREE.Vector3();
const _lightingOrigin = new THREE.Vector3(0, 0, 0);
const _followPosition = new THREE.Vector3();
const _followDelta = new THREE.Vector3();
const _distTmp = new THREE.Vector3();
const labelRenderGate = new LabelRenderGate();
const _lineOpacity = () => {
    _lineEase.o += (1 - _lineEase.o) * 0.5;
    if (_lineEase.o > 0.995) _lineEase.o = 1;
    const s = _lineEase.o.toFixed(3);
    focusLine.setAttribute('opacity', s); focusDot.setAttribute('opacity', s);
};
const _lineFadeOut = () => {
    if (_lineEase.o <= 0.02) {
        _lineEase.o = 0; _lineEase.on = false;
        focusLine.setAttribute('opacity', '0'); focusDot.setAttribute('opacity', '0');
        return;
    }
    _lineEase.o *= 0.6;
    const s = _lineEase.o.toFixed(3);
    focusLine.setAttribute('opacity', s); focusDot.setAttribute('opacity', s);
};
const pathButtons = {
    trails: document.getElementById('path-trails'),
    orbits: document.getElementById('path-orbits'),
    off:    document.getElementById('path-off'),
};
let _lastDistText = '';
let dateRenderedSecond = NaN;
const sq = (x) => x * x;
window.wallpaperPropertyListener = {
    applyUserProperties: function (props) {
        isWallpaperEngine = true;
        applyInputMode();
        if (!props.textureResolution) return;
        const next = props.textureResolution.value;
        if (next === textureResolution) return;
        swapTextureResolution(next);
    }
};
loadMusicTrack();
const trailLayerRef = { current: null };
Object.defineProperty(window, '__trailLayerRef', { value: trailLayerRef, writable: false });
wireUIEvents();
wireSelectMenus();
wireMoonFlyouts();
wireDock();
wireLayerToggles();
wireSkyToggle('toggle-milkyway', 'milkyway');
wireSkyToggle('toggle-figures', 'figures');
wireSkyToggle('toggle-boundaries', 'boundaries');
wireSkyToggle('toggle-grid', 'grid');
wireSkyToggle('toggle-ecliptic-grid', 'eclipticGrid');
wireSkyToggle('toggle-galactic-grid', 'galacticGrid');
wireSkyToggle('toggle-conlabels', 'conLabels');
wireSkyToggle('toggle-starlabels', 'starLabels');
fpsSelectEl.querySelector('.tex-select-trigger').addEventListener('click', () => {});
setFpsSelectValue(targetFps);
speedSlider.value = String(speedSliderValue);
{
    try {
        const v = parseFloat(localStorage.getItem('solarVolume'));
        if (!isNaN(v)) {
            volume = Math.min(1, Math.max(0, v));
            lastNonZeroVol = volume || 0.35;
        }
        const m = localStorage.getItem('solarMuted');
        if (m !== null) muted = (m === '1');
        const ae = localStorage.getItem('solarAudioEnabled');
        audioEnabled = (ae === null) ? true : (ae === '1');
    } catch (e) {}
    updateVolumeUI();
    if (audioEnabled && !muted && volume > 0) {
        const resume = () => {
            document.removeEventListener('pointerdown', resume);
            document.removeEventListener('keydown',  resume);
            applyVolume(true);
        };
        document.addEventListener('pointerdown', resume);
        document.addEventListener('keydown',  resume);
    }
}
(() => {
    let hasSaved = false;
    try { hasSaved = localStorage.getItem('solarTextureQuality') !== null; } catch (e) {}
    const picker = document.getElementById('resolution-picker');
    if (!picker) return;
    picker.querySelectorAll('.res-picker-options button[data-value]').forEach(btn => {
        btn.addEventListener('click', () => closeResolutionPicker(btn.dataset.value));
    });
    if (hasSaved) {
        picker.style.display = 'none';
    } else {
        _showResPickerOnLoad = true;
    }
})();
applyTargetFps(targetFps);
inputModeReady = true;
applyInputMode();
beginLoading('Initialising system');
buildSystem();
applyCameraDefaults();
applyLighting();
updateSpeedFromSlider();
focusedObject = null;
showFocusCard(bodyFacts.solarsystem);
trailLayer = new WorldTrails({
    THREE, scene, solarSystem, objectRegistry, renderer, camera, km2u,
    accuracy: solarAccuracy,
    getSettings: () => pathSettings,
    getFocusedKey: () => focusedObject?.userData.planetKey,
    getOrbitLines: () => orbitLines
});
distanceReadout = new CameraDistance({
    THREE, camera, controls, canvas: renderer.domElement,
    solarSystem, getFocused: () => focusedObject, getSun: () => objectRegistry.sun,
    getName: body => bodyFacts[body.userData?.planetKey]?.name || body.userData?.planetName || body.name,
    au: AU_UNITS
});
distanceReadout.onChange = () => {};
anchoredDock = installAnchoredDock();
saturnAlignment = new SaturnAlignment({ THREE, objectRegistry });
bodyGlowMarkers = new BodyGlowMarkers({ THREE, scene, solarSystem, objectRegistry, camera, renderer });
planetDetail = new PlanetDetail({
    THREE, objectRegistry, cloudMeshes, camera, renderer,
    getEnabled: key => weatherEnabled() && solarAccuracy.available
});
earthWeather = new EarthWeather({
    THREE, objectRegistry, cloudMeshes, camera, renderer,
    getLightningEnabled: () => weatherEnabled() && solarAccuracy.available
});
performanceDefaults.attach({
    renderer, clock,
    getPixelRatio(width,height,dpr) { return Math.min(dpr, GRAPHICS_PIXEL_RATIO[textureQuality] ?? 1.5); },
    onResize() {},
    onTextureDefault() {
        swapTextureResolution('2k');
        try { localStorage.setItem('solarTexRes', '2k'); } catch (e) {}
    }
});
animate();
