import { CometLayer } from "./bodies/small-bodies/comet-layer.js";

import { ApproximateEphemerisLayer } from "./core/approximate-ephemeris.js";

import { TextureRequests } from "./core/texture-requests.js";

import { LabelRenderGate } from "./core/render-gates.js";

import { PerformanceDefaults } from "./config/performance-defaults.js";

import { CameraDistance } from "./core/camera-distance.js";

import { WorldTrails } from "./sim/world-trails.js";

import { PlanetWeather } from "./bodies/planets/planet-weather.js";

import { PlanetDetail, installAnchoredDock, textureZoomFactor } from "./ui/planet-detail.js";

import { SaturnAlignment } from "./bodies/rings/saturn-alignment.js";

import { ExtraBodies } from "./bodies/small-bodies/extra-bodies.js";

import { ResonantPopulations } from "./bodies/small-bodies/resonant-populations.js";

import { NearEarthObjects } from "./bodies/small-bodies/near-earth.js";

import { KuiperBelt } from "./bodies/small-bodies/kuiper-belt.js";

import { RingAsteroids } from "./bodies/rings/ring-asteroids.js";

import { MoonEclipses } from "./bodies/planets/moon-eclipses.js";

import { ConstellationLayer } from "./sky/constellations.js";

import { SkyMaps, SKY_RADIUS } from "./sky/sky-maps.js";

import { startApp } from "./app/bootstrap.js";

import { BodyShapes } from "./bodies/body-shapes.js";

import { BodyOrientation } from "./bodies/body-orientation.js";

import { ElevationCatalog } from "./bodies/elevation-catalog.js";

import { EquatorialGrid } from "./bodies/equatorial-grid.js";

import { HdrPipeline, HDR_TONE_MAPPER, hdrToneMapperLabel, hdrToneMapperOptions } from "./render/hdr/hdr-pipeline.js";

import { OrbitGeometry } from "./core/orbit-geometry.js";

import { BodyGlowMarkers } from "./core/body-glow-markers.js";

const dependencies = {
    CometLayer: CometLayer,
    OrbitGeometry: OrbitGeometry,
    BodyGlowMarkers: BodyGlowMarkers,
    BodyShapes: BodyShapes,
    BodyOrientation: BodyOrientation,
    ElevationCatalog: ElevationCatalog,
    EquatorialGrid: EquatorialGrid,
    HdrPipeline: HdrPipeline,
    HDR_TONE_MAPPER: HDR_TONE_MAPPER,
    hdrToneMapperLabel: hdrToneMapperLabel,
    hdrToneMapperOptions: hdrToneMapperOptions,
    ApproximateEphemerisLayer: ApproximateEphemerisLayer,
    TextureRequests: TextureRequests,
    LabelRenderGate: LabelRenderGate,
    PerformanceDefaults: PerformanceDefaults,
    CameraDistance: CameraDistance,
    WorldTrails: WorldTrails,
    PlanetWeather: PlanetWeather,
    PlanetDetail: PlanetDetail,
    installAnchoredDock: installAnchoredDock,
    textureZoomFactor: textureZoomFactor,
    SaturnAlignment: SaturnAlignment,
    ExtraBodies: ExtraBodies,
    ResonantPopulations: ResonantPopulations,
    NearEarthObjects: NearEarthObjects,
    KuiperBelt: KuiperBelt,
    RingAsteroids: RingAsteroids,
    MoonEclipses: MoonEclipses,
    ConstellationLayer: ConstellationLayer,
    SkyMaps: SkyMaps,
    SKY_RADIUS: SKY_RADIUS
};

startApp({
    dependencies: dependencies
}).catch(error => {
    console.error(error);
    const screen = document.getElementById("loading-screen");
    if (!screen) return;
    screen.classList.add("visible");
    const label = screen.querySelector(".loading-label");
    if (label) label.textContent = "Startup failed: " + String(error && error.message ? error.message : error);
});
