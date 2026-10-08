import { CometLayer } from './bodies/small-bodies/comet-layer.js';
import { ApproximateEphemerisLayer } from './core/approximate-ephemeris.js';
import { TextureRequests } from './core/texture-requests.js';
import { LabelRenderGate } from './core/render-gates.js';
import { PerformanceDefaults } from './config/performance-defaults.js';
import { CameraDistance } from './core/camera-distance.js';
import { WorldTrails } from './sim/world-trails.js';
import { EarthWeather } from './bodies/planets/earth-weather.js';
import { PlanetDetail, installAnchoredDock, textureZoomFactor } from './ui/planet-detail.js';
import { SaturnAlignment } from './bodies/rings/saturn-alignment.js';
import { ExtraBodies } from './bodies/small-bodies/extra-bodies.js';
import { ResonantPopulations } from './bodies/small-bodies/resonant-populations.js';
import { NearEarthObjects } from './bodies/small-bodies/near-earth.js';
import { KuiperBelt } from './bodies/small-bodies/kuiper-belt.js';
import { RingAsteroids } from './bodies/rings/ring-asteroids.js';
import { MoonEclipses } from './bodies/planets/moon-eclipses.js';
import { ConstellationLayer } from './sky/constellations.js';
import { SkyMaps, SKY_RADIUS } from './sky/sky-maps.js';
import { startApp } from './app/bootstrap.js';
import { BodyShapes } from './bodies/body-shapes.js';
import { BodyOrientation } from './bodies/body-orientation.js';
import { ElevationCatalog } from './bodies/elevation-catalog.js';
import { EquatorialGrid } from './bodies/equatorial-grid.js';
import { OrbitGeometry } from './core/orbit-geometry.js';
import { BodyGlowMarkers } from './core/body-glow-markers.js';
const dependencies = {
    CometLayer,
    OrbitGeometry,
    BodyGlowMarkers,
    BodyShapes,
    BodyOrientation,
    ElevationCatalog,
    EquatorialGrid,
    ApproximateEphemerisLayer,
    TextureRequests,
    LabelRenderGate,
    PerformanceDefaults,
    CameraDistance,
    WorldTrails,
    EarthWeather,
    PlanetDetail,
    installAnchoredDock,
    textureZoomFactor,
    SaturnAlignment,
    ExtraBodies,
    ResonantPopulations,
    NearEarthObjects,
    KuiperBelt,
    RingAsteroids,
    MoonEclipses,
    ConstellationLayer,
    SkyMaps,
    SKY_RADIUS,
};
startApp({ dependencies }).catch(error => {
    console.error(error);
    const screen = document.getElementById('loading-screen');
    if (!screen) return;
    screen.classList.add('visible');
    const label = screen.querySelector('.loading-label');
    if (label) label.textContent = 'Startup failed: ' + String(error && error.message ? error.message : error);
});