import "./app/three-runtime.js";

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

import { StarField } from "./sky/star-field.js";

import { startApp } from "./app/bootstrap.js";

import { BodyShapes } from "./bodies/body-shapes.js";

import { BodyOrientation } from "./bodies/body-orientation.js";

import { ElevationCatalog } from "./bodies/elevation-catalog.js";

import { EquatorialGrid } from "./bodies/equatorial-grid.js";

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
    StarField: StarField,
    SKY_RADIUS: SKY_RADIUS
};

startApp({
    dependencies: dependencies
}).catch(error => {
    console.error(error);
    const screen = document.getElementById("loading-screen");
    if (!screen) return;
    screen.classList.add("visible");
    const message = String(error && error.message ? error.message : error);
    const graphicsProblem = /webgl|graphics context/i.test(message);
    // A failed WebGL context is not a crash to hide behind "Startup failed":
    // say what happened and what fixes it.
    const percent = screen.querySelector(".loading-percent");
    if (percent) percent.textContent = graphicsProblem ? "\u2014" : percent.textContent;
    const label = screen.querySelector(".loading-label");
    if (label) {
        label.textContent = graphicsProblem
            ? "Graphics unavailable \u2014 " + message
            : "Startup failed: " + message;
    }
    if (graphicsProblem) {
        // A page whose WebGL has been blocked cannot recover without a reload,
        // so give the one control that actually helps instead of leaving the user staring at a dead card.
        const card = screen.querySelector(".loading-card") || screen;
        let retry = card.querySelector("#solister-graphics-retry");
        if (!retry) {
            retry = document.createElement("button");
            retry.id = "solister-graphics-retry";
            retry.type = "button";
            retry.textContent = "Reload";
            retry.style.cssText = [
                "margin-top:14px", "padding:9px 22px", "border-radius:8px",
                "border:1px solid rgba(255,255,255,.22)",
                "background:rgba(255,255,255,.08)", "color:#e8e8ea",
                "font:500 13px/1 system-ui,-apple-system,Segoe UI,sans-serif",
                "cursor:pointer"
            ].join(";");
            retry.addEventListener("click", () => location.reload());
            card.appendChild(retry);
        }
    }
});
