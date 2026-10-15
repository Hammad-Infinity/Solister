# Solister — Interactive 3D Solar System

A browser-based solar-system visualization built on Three.js, combining offline
planetary and satellite ephemerides, geometric eclipse and shadow rendering,
a procedural solar corona, interactive small-body layers, and adjustable
graphics quality.

Solister presents one physically scaled solar-system scene. A shared position,
rendering, and navigation pipeline keeps body placement consistent; scientific
coverage and accuracy still vary by object, dataset, epoch, and visual effect.

The application runs in the browser and is served as static files. It requires
no application backend, live astronomy API, Node.js runtime, or build step for
normal use. Libraries, numerical data, textures, and audio must be included in
the local distribution for offline operation.

> **Date coverage:** the main supported interval is **3 January 1800 through
> 28 December 2199 UTC**. Dates outside it are selectable without that interval
> being imposed as a hard limit. The application then displays a persistent
> warning and uses approximate propagation where available. These are not
> validated long-range predictions. Some datasets have shorter coverage.

This README describes the current interface and behavior.

---

## Contents

- [Overview](#overview)
- [Running](#running)
- [Controls and navigation](#controls-and-navigation)
- [Ephemeris and orbital accuracy](#ephemeris-and-orbital-accuracy)
- [Paths and orbit displays](#paths-and-orbit-displays)
- [Planets and moons](#planets-and-moons)
- [Eclipses and shadows](#eclipses-and-shadows)
- [The Sun and atmospheres](#the-sun-and-atmospheres)
- [Comets](#comets)
- [Asteroids and the Kuiper Belt](#asteroids-and-the-kuiper-belt)
- [Sky](#sky)
- [Textures and visual effects](#textures-and-visual-effects)
- [Interface and shortcuts](#interface-and-shortcuts)
- [Architecture](#architecture)
- [Performance](#performance)
- [Platform integration](#platform-integration)
- [Troubleshooting](#troubleshooting)
- [Scope and limitations](#scope-and-limitations)
- [Contributions](#contributions)
- [Licenses and acknowledgments](#licenses-and-acknowledgments)

---

## Overview

Solister is a solo project exploring a self-contained, interactive solar system
without a server-side simulation. Its emphasis is on combining a coherent scene,
useful orbital data, and responsive navigation rather than claiming observatory-
or mission-planning accuracy.

Highlights include:

- **One physical-scale scene:** dedicated planetary and satellite position models
  with smooth camera navigation and surface-view transitions.
- **Offline numerical data:** local theories, interpolation tables, and
  catalogue-derived small-body models; no live ephemeris service is required.
- **Extended dates:** a native date/time picker, forward and reverse playback,
  and explicitly labelled approximations outside supported data coverage.
- **Geometric shadows:** eclipse visibility, moon shadows, and ring/planet
  shadow effects coupled to the scene's positions.
- **Procedural rendering:** a single-fade analytic solar glow, physically
  derived scattering atmospheres, and comet nuclei, comae, and
  three-dimensional tails.
- **Interactive navigation:** body selection, focus information, distance
  readouts, clickable markers, astronomical symbols, and configurable paths.
- **Scalable presentation:** graphics tiers, separate sky texture settings,
  frame-rate limits, and rendering/caching optimizations.

Graphics settings change rendering cost and visual detail, not the selected
orbital model. Actual performance still depends on the browser, GPU, display
resolution, active populations, and camera position.

## Running

Serve the complete project directory over HTTP. For example:

```bash
cd Solister
python3 -m http.server 8000
```

Open **http://localhost:8000/index.html**.

Python is only the static server in this example; another suitable static server
can be used. No Node.js installation is needed to view the application.

### Requirements

- A modern browser with WebGL 2, JavaScript modules, Web Workers, and the browser
  APIs used by the bundled texture loaders.
- Hardware acceleration enabled and sufficient graphics memory for the chosen
  quality level. Integrated graphics are a design target, not a universal
  frame-rate guarantee.
- The project's local scripts, vendor dependencies, numerical data, textures,
  and other required assets, with their relative paths preserved.

Opening `index.html` via `file://` is not a supported launch method: module,
worker, texture, and data loading can be blocked by browser security rules.

The first-run quality selection and subsequent preferences are stored in
`localStorage`. Storage restrictions can prevent preferences from persisting.
Audio playback may require a click or other user gesture because of browser
autoplay rules.

### Offline use and deployment

Offline use means serving the complete local distribution without an Internet
connection; it does not mean a hosted page is guaranteed to work offline after
one visit. Preserve the directory layout and filename case when deploying.
Serve JavaScript with an appropriate MIME type, and do not replace missing
module or binary requests with an HTML fallback page.

After replacing files, hard-refresh the browser so it does not mix old cached
modules with the new ones.

To apply the bundled source update to an existing project folder, keep
`apply_changes.sh` beside `index.html` and place `solister_project_update.tar.gz`
either in `updates/` or beside the script. Run `./apply_changes.sh` from the
project directory. The script compares files, backs up any versions it replaces
under `.solister-backup/`, and does not depend on Git.

## Controls and navigation

The application uses one physical-scale scene. Supported planetary and satellite
position models, small-body populations, textures, and visual aids are available
through the shared interface. Marker size and color are presentation aids, not
physical dimensions.

Simulation controls are arranged as **Speed → Date/time → Volume**:

- **Speed and pause:** control playback, including reverse motion. Requested
  speed can be moderated by cache availability and close-up motion limits.
- **Date/time:** a native calendar/time picker interpreted as **UTC**, regardless
  of the device's local timezone. Users do not need to type an ISO timestamp.
- **Volume and mute:** below the date/time row.
- **Sync Now:** sets the simulation clock to the current time.

Simulation time, wall time, and camera-to-target distance are distinct readouts.
The date picker has no application-imposed 1800–2199 minimum or maximum, but
browser-native pickers cannot select BCE/year-zero dates and JavaScript dates
have finite limits.

### Camera

- **Left-drag** aims the camera and moves its orbit pivot to the new point in
  front of the view.
- **Right-drag** orbits around the current pivot without repositioning the
  camera when the drag starts. If the pivot is already at a focused planet's
  centre, it follows that planet; after a left-drag, it keeps the moved pivot.
- **W/S** dolly smoothly toward/away from the current camera pivot, matching the
  direction of wheel zoom; **A/D** strafe sideways. WASD or left-drag detaches
  free-flight movement from the focused body's orbital follow; wheel zoom keeps
  the current focus centered. While landed,
  WASD instead walks across the rendered surface, maintaining eye clearance at a
  capped 1.4 m/s.
- **Q/E** roll counter-clockwise/clockwise.
- **Scroll toward a focused landable planet or Moon** to approach it; within
  near-orbit range, the camera smoothly settles into a near-surface tangent view
  without requiring a key press. **L** remains available as an immediate landing
  shortcut. The eye settles about 1.7 m above the rendered surface. While landed,
  WASD walks tangent to the surface, left-drag still aims, and the wheel adjusts
  height.
  Press **Escape** to pull back to orbit; Escape outside landing mode unfocuses
  or returns to the system overview.
- Mouse wheel and `-` / `+` zoom. Selecting a body uses a smooth camera flight.

The floating origin shifts the scene root and camera together during long
navigation so nearby body geometry remains near the numeric origin. It resets
camera-motion history when rebasing to prevent artificial streaks.

## Ephemeris and orbital accuracy

### Position models

The principal in-range planetary chain uses **VSOP2013** for the inner planets
and Earth–Moon barycenter, and **TOP2013** for the outer planets. Body-center
corrections are applied where needed rather than treating every system
barycenter as the visible planet's center.

Satellite models include:

| Bodies | In-range position source/model |
| --- | --- |
| Earth's Moon | ELP/MPP02 lunar theory |
| Phobos and Deimos | Martian satellite theory |
| Io, Europa, Ganymede, Callisto | Astronomy Engine's Galilean moon model |
| Included Saturnian moons | TASS17 |
| Included Uranian moons | GUST86 |
| Triton and Nereid | Local JPL NEP098-derived interpolation tables |
| Pluto | Local JPL-derived body-center states; fine data preferred where available, with daily states and documented boundary padding |
| Charon, Himalia, Phoebe | Per-body local state tables |
| Four bundled comets | Local JPL Horizons-derived state tables |

The engine converts UTC to dynamical time using its supported time-scale model.
Historical offsets, future leap seconds, and long-range time conversion should
not be treated as perfectly known. The rendered geometric states are not a
universal observer-specific apparent-position solution including all light-time,
aberration, atmospheric refraction, and instrument effects.

### Coverage is not an accuracy guarantee

| Layer | Coverage and availability |
| --- | --- |
| Main planetary/regular-moon path | Supported UTC interval: 1800-01-03 through 2199-12-28 |
| Pluto | Same overall interval; source/provenance differs near padded boundaries |
| Charon, Himalia, Phoebe | Original local-table availability: 2020-01-01 through 2040-12-31 within the main interval |
| Comets | Supported UTC interval as above; stored TDB samples include endpoint margins |
| Named Kuiper objects | Available only within their own local table coverage |
| Catalogue-derived and synthetic asteroid populations | Approximate orbital models, not the same accuracy class as the main ephemeris |

Do not interpret the common date interval as a blanket **sub-arcsecond**, **one-
kilometer**, or observational-accuracy guarantee. Accuracy varies by body,
source theory, epoch, interpolation method, and available observations.

A numerical comparison against a source table measures agreement with that
source, not the true uncertainty of the astronomical object. For example, the
bundled four-comet validation contains **536 reference comparisons**. Its
largest recorded differences are approximately:

| Comet | Maximum recorded source-comparison difference |
| --- | ---: |
| 67P/Churyumov–Gerasimenko | 1.363 km |
| 2P/Encke | 0.373 km |
| 46P/Wirtanen | 0.461 km |
| 9P/Tempel 1 | 0.296 km |

These are sampled numerical/source-request differences, **not global error
bounds or absolute orbit uncertainties**. Comet predictions become especially
uncertain away from the observation arc and through poorly constrained
nongravitational activity.

### Outside the supported interval

A persistent on-screen **APPROXIMATE** warning appears independently of the
settings panel. Returning to supported dates restores the normal calculation
path.

- Planets and regular moons use separate fixed, bound two-body conics derived
  from a nearby supported endpoint snapshot. Endpoint center offsets and an
  approximate continuation of the dynamical time scale are retained.
- Comets use their original interpolation wherever their tables provide a
  state, then a separate endpoint conic beyond the tables.
- Pluto and the additional moons can use bound endpoint conics from their local
  tables outside the overall 1800–2199 interval. This does **not** fill their
  existing local-table gaps *inside* that interval.
- Missing, nonfinite, degenerate, or non-bound fallback states are unavailable.
  Objects are not intentionally frozen at an endpoint under a later displayed
  date. The planetary system can remain hidden while its endpoint cache loads.
- Historical trails are suppressed. Usable full osculating orbit lines remain
  available. Named Kuiper objects remain unavailable outside their tables.
- Existing approximate asteroid/background models are retained; sky and
  small-body behavior is not newly validated for remote epochs.

These fallbacks omit long-term perturbations, resonances, orbital evolution,
and comet nongravitational forces. Errors can become very large. The original
interpolation and theory range guards are not removed, and the app does not
silently download or regenerate new ephemerides.

## Paths and orbit displays

**Trails / Orbits / Off** controls optional path overlays.

- **Trails** show sampled history over time, with a fading appearance and
  adaptive detail. History length is limited by data availability.
- **Orbits** are reference curves, including instantaneous osculating ellipses
  derived from the current state. Such an ellipse is a locally matching
  two-body approximation, not the exact past or future many-body trajectory.
- **Off** hides the overlays without stopping the objects or simulation clock.

Orbital paths use line/ribbon rendering, not solid tubes. Comet gas/dust tails
are separate three-dimensional visual effects and are not orbit trails.
Comet full-orbit displays use closed osculating ellipses, including 9P/Tempel 1;
they are not closed by joining the ends of a perturbed trajectory with an
arbitrary straight segment.

## Planets and moons

The scene includes all eight planets, Earth's Moon, supported major satellite
sets, Pluto and Charon, and additional objects such as Himalia and Phoebe where
the appropriate model is available.

- **Earth:** the supplied day and city-light KTX2 maps, sunlit clouds, a subdued,
  density- and view-shaded cloud-only night-side visibility layer, cloud-shadow
  and eclipse effects (cloud shadows are enabled at Medium/High graphics quality
  and disabled at Low), a layered scattering atmosphere, and 3D lightning effects
  randomized within storm-prone regions. Hotspot seeds, strike coordinates,
  patch sizes, and short event cooldowns are varied per session. The denser, icy-white cloud shell
  occludes direct city lights under cloudy pixels, while a soft warm city-light
  bloom is projected onto the softly scattering cloud cover. Lightning is gated
  per fragment against the cloud-mask texture, including GPU-only KTX2 maps, so
  strikes stay with cloud-covered regions; they create a compact white/violet
  cloud-top pool, a thin violet-white channel and faint high-altitude
  pink/magenta sprite streamers. Earth’s widened cloud deck is a 2–16 km
  volumetric layer, ray-marched from above or below so landed cameras can see its
  underside. Full-daylight lightning is strongly attenuated. Earth schedules a
  nominal 40 randomized strikes per simulated second at 1×, scaling with the
  simulation rate. Lightning can be toggled in Earth's focus card; reduced
  motion disables it by default but allows it to be turned back on explicitly.
  Jupiter, Saturn, Uranus, Neptune, Venus, and Mars use sparse planet-specific
  discharge models rather than whole-globe random flashes; evidence confidence
  varies by world.
- **Venus:** pale ivory-white cloud tops are represented by a subtly banded,
  procedural upper-cloud deck at about 70 km, with near-neutral visible-light
  atmospheric scattering. The deck sits above and hides the underlying terrain
  while the Venus **Atmosphere** toggle is on; it is a visual approximation, not
  live cloud/weather data or a measured surface albedo map.
- **Saturn:** textured rings with band/gap structure and mutual ring/planet
  shadows. The rings receive the planet's eclipse shadow, so the section behind
  Saturn reads genuinely black, and the shading follows the ring's own density, so
  only the sparse bands — the C ring and the Cassini Division — let a trace of
  direct sunlight through. Away from the shadow the unlit face is not a void: it
  is lit faintly by **planetshine** from Saturn's sunlit hemisphere, which is why
  it reads as a soft grey ribbon rather than black. The forward-scatter glow
  through the dust is suppressed wherever the planet blocks the Sun.
- **Uranus and Neptune:** ring rendering and associated shadow treatment where
  implemented. On Uranus the dense ribbons become sharp black lines on the unlit
  side while the fine dust sheets between them glow through forward scattering.
  Neptune's low-opacity ring keeps its faint structure instead — the arc clumps
  read as the denser parts. Both receive the same eclipse shadow and a weaker
  planetshine, since a smaller planet reflects less light onto its rings.
- **Moons and small resolved bodies:** physical reference sizes/shapes where
  available; plain-color ellipsoids or procedural geometry where resolved maps
  are not supplied.

Tilts, rotations, materials, and body facts support the visualization. They do
not imply that every surface feature, orientation, weather event, or color is
measured accurately at the selected instant.

### Elevation data and surface grid

The runtime catalog now bundles global elevation grids for **Earth (NOAA
ETOPO5), Mercury (MESSENGER/USGS), Venus (Magellan/USGS), Mars (MOLA/PDS), and
the Moon (LOLA/NASA)**. The source project contained the loader but not the
catalog or raster files, so its DEM path could not load any terrain. The
supplied NASA reference is a compiled web bundle; its near-surface path uses a
spheroid LOD component and streamed terrain tiles. Solister uses an adapted
offline approach: one global DEM per body, a 256 × 128 base sphere, and a
512 × 256 close-approach relief mesh prepared asynchronously and cached before
activation. A staged, body-relative landing holds at an approach waypoint until
terrain preparation is ready, then eases through the final descent. Detail
activation uses camera-distance hysteresis, including prewarming before the
landing stage; this is a single-resolution mesh, not streamed per-tile LOD.

Source grids are bilinearly resampled to 2048 × 1024 little-endian 16-bit
height rasters. The full 16-bit data displaces the CPU mesh and drives the
landing/collision surface sampler; vertex normals are recomputed after
displacement, and a WebGL-safe 8-bit bump texture adds fragment-scale,
height-derived normal detail. The GPU texture uses a sized single-channel format
and one linear-filtered level (no mipmap generation). Relief and bump scale
remain at **1× vertical exaggeration**; there is no synthetic hypsometric color
contrast. The 512 × 256 close-approach mesh and source rasters are still
coarser than native terrain products and do not provide NASA-style per-tile
LOD.

`data/elevation/catalog.json` records source URLs, resolution, encoding range,
vertical datum, and limitations. Earth ETOPO5 is five-arc-minute global relief;
Earth's mean-sea-level values are applied radially without a local geoid-to-
ellipsoid correction. Mars MOLA heights are above the GMM3 areoid and likewise
do not include a local areoid-to-ellipsoid correction. Other bodies retain their
reference shapes; no DEM is fabricated for them.

The reproducible builder is `tools/build_elevation_catalog.py`. To download the
source products and regenerate the bundled runtime grids from the project root,
install NumPy and tifffile and run:

```sh
python3 -m pip install numpy tifffile
python3 tools/build_elevation_catalog.py
```

The builder reuses or downloads its source files in `.cache/elevation-sources/`
(about 650 MB total, including the high-resolution Mercury source) and writes
the five compact `.u16` grids and updated catalog to `data/elevation/`. The app
expects those little-endian 2048 × 1024 runtime grids; raw GeoTIFFs and PDS
`.IMG` files are not loaded directly by the browser.

A **Surface Grid** can be enabled while Mercury, Venus, Earth, Mars, the Moon,
Jupiter, Saturn, Uranus, Neptune, or Pluto is focused. Its toggle is in the
**Constellations** menu and can be switched on and off repeatedly; the grid
follows the focused supported body. Its latitude circles and meridians are
spaced every 15°, with labels attached to fixed, raised tangent planes on the
rendered surface rather than camera-facing sprites. It follows that body's
reference shape and rendered mean IAU orientation. PCK periodic nutation terms
are not included, so the grid follows the same simplified orientation as its
body. The text-PCK Earth rotation is display-grade rather than precision ITRF;
NAIF documents a prime-meridian error of at least 150 arcseconds and recommends
binary Earth PCK data for high-accuracy work ([PCK caveat](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc)).
The Jovian/giant-planet grids are reference cloud-top grids, not solid-surface
topography. Other moons and small bodies use catalogued reference shapes; no
global elevation DEM is bundled for them, so surface detail there remains a
limitation.

## Eclipses and shadows

Eclipse visibility uses analytic circular-disc overlap calculations within the
implemented geometry model. Material/shader integrations include Earth/Moon
shadowing, supported moon/planet and mutual-satellite effects, and ring-related
shadows. Ring bands and gaps are handled through their own geometry/opacity
representation and the ring transform.

“Analytic” describes how a formula is evaluated; it does **not** mean the entire
physical event is approximation-free. Spherical-disc assumptions, source
positions, selected shadow casters, ring opacity, surface geometry, and shader
lighting all affect the result. Ring-particle shadow treatment is not a full
physical simulation of every particle blocking every other particle.

Eclipse brightness is a rendering model, not calibrated photometry. Outside
supported ephemeris coverage, the shadow geometry inherits the approximate
positions. Do not use the scene to plan eclipse observations or infer precise
contact times, ground tracks, or visibility at a real observing site.

## The Sun and atmospheres

### Sun

The photosphere is a featureless, unlit **pure-white sphere**—there are no marks,
spikes, or protrusions on its surface. A separate analytic billboard draws one
intense, smooth glow with a soft exponential falloff. Its radius and gain increase
with camera distance; at close range it stays at least 1.35 times the apparent
solar radius, with the physical corona shell held at 1.14 times photospheric
radius. Depth testing lets foreground bodies occlude the glow; the photosphere
itself remains unchanged.

The analytic corona integrates its power-law radial column in **closed form**
(no march loop), rolls off with a soft knee, self-extinguishes with a
Beer–Lambert term, and fades smoothly at the shell edge. A broader additive halo
joins the photosphere without a visible rim; both corona and halo grow brighter
with distance. Texture-backed lens ghosts and streaks from the supplied flare
pack move along the Sun-to-screen-centre axis as the camera moves, providing
subtle parallax without putting marks or spikes on the photosphere.

The corona and lens artifacts are illustrative effects, not measured
active-region, filament, prominence, or loop reconstructions, and are not an
eye-safe representation of looking at the real Sun.

### Atmospheres and electrical activity

Atmosphere-bearing bodies use a **ray-marched 3D scattering volume**, not a
camera-facing glow. The shader separately evaluates Rayleigh and Mie density,
with independent scale heights, and distinguishes Mie scattering from Mie
extinction. Earth, Venus, and Mars also receive a separate, camera-altitude-
blended ground aerial-perspective hook on their surface materials, using five
density samples along the camera-to-surface path. The shell atmosphere is
attenuated during the close-ground blend so both treatments do not simply stack
at full strength. Supplied SpaceEngine columns are integrated as a single continuous
profile from the reference surface to the supplied top altitude; the shader no
longer introduces arbitrary equal-height internal bands. Project-authored
multi-layer profiles retain their source optical depths and cross-fade adjacent
density fields at layer boundaries. Ray intersections and local altitude use
each body's reference-ellipsoid axes, keeping the scattering volume aligned to
the solid body. Earth additionally receives lunar-eclipse shadowing. Outside the
shell, the volume depth-tests normally; inside it, the shader marches to the
analytic body-surface intersection and the shell pass bypasses opaque-ground
depth testing so the close-approach haze does not vanish at entry.

SpaceEngine documents these as precomputed atmosphere models described by
`atmospheres.cfg` in its [planet-creation manual](https://spaceengine.org/manual/making-addons/creating-a-planet/).
The supplied standard profiles now drive rendered scattering for Earth, Venus,
Mars, Jupiter, Titan, Neptune, and Pluto. Earth, Venus, Mars,
and Pluto use values cross-checked between the supplied binary `.atm` files
(`.atm.txt` attachments) and `atmospheres.cfg.txt`; Jupiter, Titan, and Neptune
use the active standard entries in the supplied configuration. The renderer
applies the configured coefficient scale factors to the RGB Rayleigh, Mie
scattering, and Mie extinction coefficients, along with each model’s separate
Rayleigh/Mie scale heights and Mie anisotropy. The first 15 little-endian
float32 header values of the four binary files agree with those parameters to
float32 precision. The remaining binary payload has not been decoded or loaded,
so this is a parameter-based volumetric implementation, **not a claim of direct
SpaceEngine LUT import**. `MieFade` is preserved as source metadata, but its
binary semantics were not established and it is not applied as an invented
shader control.

The supplied configuration has no active standard Saturn or Uranus preset, so
those bodies retain Solister’s project-authored layered profiles. The
project-authored gas, pressure, temperature, and altitude layers also remain the
input to the illustrative lightning system. Mercury’s exosphere has negligible
visible scattering; the Moon has no atmosphere shell. The Earth profile used by
the volumetric renderer is the supplied 60 km SpaceEngine column; the separate
storm/event model keeps its own atmospheric layer facts for visual placement.

Solar direction follows the Sun-to-body vector each frame, and direct
scattering brightness varies approximately with inverse-square solar irradiance
relative to Earth. SpaceEngine’s supplied atmosphere files specify scattering
profiles, not discharge locations, lightning rates, or storm forecasts; no
lightning dataset was included. Lightning is drawn as a session-randomized,
procedural-cloud-mask-conditioned visual approximation within illustrative
storm-prone regions. Its visible ribbons are presentation effects, not a
validated weather model. Earth clouds use a separate night-side visibility
layer shaded by cloud density and viewing angle. The cloud volume is denser and
uses a cool-white diffuse-scattering approximation for a softly frosted look.
The city-light texture is suppressed beneath cloudy pixels and sampled for a
soft, localized amber glow on the clouds; this is an illustrative lighting
effect, not a model of real cloud radiative transfer. Earth lightning adds a
short-lived, center-fading white/violet cloud-top flash, a narrow violet-white
channel that rises above the deck, and faint high-altitude pink/magenta sprite
streamers. Daylight attenuates the effect. The nominal event
rate is 40 strikes per simulated second at 1× and scales with simulation speed.
The supplied flare archive contains lens-artifact
sprites/configuration, not lightning data.
Events are not forecasts or reconstructions of weather at a selected date:
the app has no live global convection, aerosol, or electric-field data. Earth
has a cloud-only night-side visibility layer; it samples the cloud and city-light
maps, hides direct city lights beneath modeled cloud cover, and adds an amber
cloud-top glow. Lightning has been observed
on Earth, Jupiter, Saturn, and Neptune. Venus’ Earth-like lightning remains
disputed; the 2026 MAVEN whistler result is a rare indication of lightning-like
electrical activity on Mars, with event location and rate still unresolved.
Uranus’ activity is also uncertain, so speculative effects are deliberately
rare. See NASA’s [lightning across the Solar System](https://science.nasa.gov/science-research/planetary-science/lightning-across-the-solar-system/)
summary and the 2026 [MAVEN whistler study](https://www.science.org/doi/10.1126/sciadv.aeb4898)
for evidence context.

Custom atmosphere, night-light, and cloud shaders now follow Three.js log-depth
handling on both WebGL2 and the WebGL1 fragment-depth-extension path, keeping
transparent shells depth-aligned with opaque bodies. The shader normally uses an 8-sample view march, reduced to five samples for
inside-shell or near-ground views, with compile-time-specialized layer loops;
it omits ozone/methane calculations for profiles that do not use them. It
cross-fades authored layer boundaries, tracks view-path transmittance, and uses
a grazing-corrected sunlight slant estimate instead of a nested sun march. It
adds no render pass and performs no per-frame CPU layer integration;
body-center, body-local ellipsoid basis, solar direction, and relative solar
irradiance are updated per visible shell. See
`src/data/spaceengine-atmosphere-models.js` for
the translated standard-profile inputs. NASA’s [planetary atmosphere
overview](https://science.nasa.gov/solar-system/10-things-planetary-atmospheres/)
and [Earth atmospheric-layer guide](https://science.nasa.gov/earth/earth-atmosphere/earths-atmosphere-a-multi-layered-cake/)
provide general context, not model-specific parameter values.

## Comets

**Comets** is an independent toggle in **View**, alongside **Milky Way** and
separate from **Asteroids**. The button has no explanatory paragraph beneath
it; the persistent date warning communicates out-of-coverage approximation.

The bundled set is **67P/Churyumov–Gerasimenko, 2P/Encke, 46P/Wirtanen, and
9P/Tempel 1**. Positions use bundled geometric heliocentric state data. No live
Horizons request is made during normal use.

### Appearance and activity

- Each comet has independent smooth heliocentric-distance ramps for the coma
  and the tail. Ramp pairs below mean **activity starts → full ramp**, with a
  perihelion setting also used to normalize solar heating:

  | Comet | Perihelion | Coma ramp | Tail ramp | Visual treatment |
  |---|---:|---:|---:|---|
  | 67P/Churyumov–Gerasimenko | 1.24 AU | 3.9 → 3.4 AU | 3.0 → 2.5 AU | Steady dust production; standard curving dust tail |
  | 46P/Wirtanen | 1.05 AU | 3.0 → 2.5 AU | 1.5 → 1.1 AU | Hyperactive gas; large glowing green spherical coma; very faint dust tail |
  | 9P/Tempel 1 | 1.54 AU | 2.5 → 2.0 AU | 1.8 → 1.5 AU | Subdued, vent-limited activity; short, stubby, low-contrast tail |
  | 2P/Encke | 0.34 AU | 1.7 → 1.2 AU | 0.5 → 0.34 AU | Nearly invisible coma until close; narrow blue plasma-beam tail inside 0.5 AU |

- The nucleus remains **solid and opaque**, both when inactive and when
  surrounded by an active cloud. The coma can visually soften or obscure the
  rock without inflating its physical mesh.
- 67P's dust is propagated as a steady illustrative emission history, so its
  broad pale dust tail curves instead of simply rotating with the nucleus.
  Wirtanen's gas-rich coma uses a bright green tint and higher gas fraction;
  Tempel 1 has only a few localized, sunlit vent plumes; Encke's ion tail is
  deliberately narrow and becomes active only in its inner-orbit ramp.
- Tail volumes use hollow, expanding, open-ended three-dimensional forms rather
  than a flat two-dimensional corona. The blue ion/plasma tail and pale dust
  tail remain separate render components.
- Near-camera suppression and depth handling help avoid oversized tail walls
  and the earlier black-disc nucleus artifact. General occlusion by every
  transparent/ring geometry is not a solved full-scene volumetric problem.

These perihelia, ramp thresholds, colors, coma sizes, tail strengths, and
brightness transitions are per-comet visual-profile settings, not epoch-specific
measurements or a calibrated gas/dust production model. Green coma color is
inspired by molecular emission, including dicarbon. Actual comets can become
active much farther out through other volatiles; outbursts, detailed chemistry,
and measured jet geometry are not reproduced.

## Asteroids and the Kuiper Belt

Supported populations include the main asteroid belt, Jupiter Trojans near L4
and L5, Hildas, near-Earth asteroids, and the Kuiper Belt. Catalogue-derived
orbits and synthetic background populations use population-specific
approximations; catalogue provenance alone does not make them full-precision,
many-body ephemerides.
- Belt distributions include illustrative eccentricity/inclination structure
  and resonance gaps. Resonant groups use dedicated approximate treatment.
- GPU-side propagation, instancing, and point/ribbon rendering reduce draw
  overhead. Draw counts depend on active layers and passes; not every population
  is guaranteed to cost exactly one draw call.
- Asteroid and ring-particle marker radii stay at their physical model sizes;
  there are no screen-space minimum/maximum boosts or focus-size multipliers.
  Apparent size follows perspective, so subpixel bodies become faint or vanish
  at long range.
- Belt navigation supports an overview and close-up reference-asteroid view.
  Procedural close-up geometry is not a measured asteroid terrain model.
- The named Kuiper selection is finite and biased by its catalogue filters;
  its synthetic background represents distribution, not identified objects.

The supplied Kuiper metadata includes **Makemake** among its named objects.
It is therefore incorrect to say all other dwarf planets are absent or that no
suitable ephemerides exist for them. Inclusion in a point layer is also distinct
from being implemented as a separately navigable, resolved body.

Detailed **Asteroids** controls are inside **View**. **All populations**
switches populations together rather than restoring a previous partial selection.
Comets remain independent, and there is no separate **Ring Rocks** menu item.

## Sky

When its data modules are present, the constellation-oriented catalogue
contains **8,790 star records**. The uploaded source snapshot omits the three
`data/sky/` catalogue modules, so guarded imports disable the constellation
layer cleanly (with a console warning) instead of failing the app or inventing
replacement data. Restore those source datasets to enable the full sky layer.
With the catalogue present, stars are always visible; there is no star-layer
toggle, while constellation figures, boundaries, and names remain separately
controlled. Each physical catalog-star disc is projected from its angular
diameter, `2 atan(R_km / (d_pc × 3.085677581e13 km))`, using the active camera
field of view. No screen-space diameter floor, halo, or size boost is applied to
those physical discs. Positive Gaia DR3 parallaxes supply distance where
available, with HYG v4.1 distances as fallback. The checked-in working copy has
no accessible per-star physical-radius array: the renderer accepts an optional
`CONST_DATA.starRadiiKm` series, otherwise it uses an explicit **one-solar-radius
proxy (695,700 km)**. This is not an individual radius measurement; unknown or
nonpositive distances produce no physical disc.

Because those stellar discs are unresolved at normal solar-system viewing
scales, a separate, halo-free point-source sample displays their catalogued
visual-magnitude flux (`10^(-0.4 V)`). Its one-device-pixel footprint is the
display's unresolved-light sample, not a larger stellar disc; flux follows
magnitude rather than screen-space size. The display exposure is not a calibrated
human-eye or instrument photometry model, and subtle star colors remain
illustrative. The motion supplement uses HYG v4.1, and matched figure endpoints
use Gaia DR3 astrometry where available. This is not a complete all-star survey
or a full Galactic dynamical model.

Sky layers include:

- Catalogue stars and selected bright-star names.
- Constellation figures, boundaries, names, and the equatorial, ecliptic and
  galactic coordinate grids. Figures, boundaries and grids are generated in code
  from the catalogue: no baked sky-overlay texture is loaded.
- A separately controlled Milky Way background texture.

Sky grids and constellation markers depth-test against foreground body geometry;
HTML sky labels are hidden when their projected label bounds overlap a nearer
body silhouette.

Sky labels stay calm: star and constellation names fade in only where they do
not collide, the number shown scales with the window size, and small-body
markers carry short names (**67P**, **Main Belt**) that appear only once the
view is close enough for them to be useful.

The 88 constellation definitions/boundaries and illustrative stick figures
should not be conflated: the IAU defines constellations, but there is no single
mandatory IAU stick-figure geometry for all renderers. Figure/data provenance
must be credited separately.

Detailed **Constellations** controls are inside **View**. Catalogue stars are
always on; figures, names, coordinate grids, boundaries, and the Milky Way are
separate controls, so enabling one does not imply that every other optional sky
layer is active. Very remote dates are not validated for accurate stellar
positions or constellation appearance.

## Textures and visual effects

Texture assets use resolution variants under `assets/textures/`, including the
original KTX2 maps where supplied. The texture pipeline uses manifests, request
management, and resolution fallbacks for missing variants.

Earth day and night maps use the original supplied KTX2 assets
(`earth_day.ktx2` and `earth_night.ktx2`) in their resolution folders. They are
installed byte-for-byte: day and night at 2K and 4K, day at 8K, and the supplied
8K night map unchanged. The KTX2 files use 2:1 equirectangular dimensions,
UASTC data, Zstandard supercompression, sRGB transfer metadata, and no
`KTXorientation` entry. The day and night color maps are sampled as sRGB, while
the cloud-coverage mask remains linear data; this keeps gamma-encoded near-black
night-map values from being mistaken for city lights. The day/cloud transform
retains its quarter-turn in longitude and vertical flip. The night map now has
its own UV matrix with the same longitude correction and an independently
reversed vertical transform,
following the in-scene report that the previously shared transform rendered the
night map upside down. The night layer uses the night map for warm, localized
city emissions and keeps the underlying dark surface near-black, with only a
faint cool earthshine hint. Direct city-light emission is masked under the
cloud-coverage map; the cloud-only night shader samples the city map for a soft
localized amber bloom and retains density- and view-dependent shading. The cloud
shell uses a cool-white scattering approximation for a softly frosted appearance.
Lightning briefly brightens a compact cloud area with a center-to-edge falloff,
a white/violet core and separate high-altitude pink streamers. A final WebGL visual comparison
of the corrected night-map orientation remains pending. Manifests
register every supplied map at its actual resolution.
Missing maps are not silently replaced with unrelated images. A stable,
broadened-coverage procedural Earth cloud map fills in because no original Earth
cloud KTX2 map is bundled. Its widened 2–16 km shell is rendered
volumetrically from both sides, including underneath for landed views; its
night-side visibility layer uses the city-light texture for illustrative cloud-top
bloom; it is not a weather forecast. Source/asset status and credits are in
`License/textures/NOTICE-TEXTURES.md`.

A visual fallback is not an ephemeris fallback: a procedural surface cannot
replace a missing position table. Missing scientific data may make a body
unavailable even when a material could be drawn.

### Graphics and texture policy

The current graphics policy selects base body textures approximately as follows,
subject to supplied assets and loader fallback:

| Setting | Base body texture target |
| --- | --- |
| Low | 2K |
| Medium | 4K |
| High | 8K |

Each resolution folder carries a `maps.json` manifest listing every map that
exists at that resolution, and the loader requests a file only when the
manifest lists it. There is no separate enhancement-map tier, and relief or
normal maps are not part of the shipped asset set. Focus-dependent texture
handling and a separate sky budget further affect what is resident in memory.

### HDR

**HDR** is the interface name for a visual preset, not HDR-monitor output or a
calibrated radiometric pipeline. It changes sky presentation, lighting, and
close-body bloom without changing orbital positions.

## Interface and shortcuts

The dock provides simulation controls, quality settings, View controls, and focus
information.

- **Simulation:** Speed, native UTC date/time selection, then Volume; pause,
  Sync Now, body navigation, and camera controls are grouped here. There are no
  separate Camera and Audio menus.
- **View:** path styles, **Markers**, Milky Way, Comets, labels, constellation
  controls (including the focused-body Surface Grid), and asteroid populations.
- **Quality:** graphics tier, available sky texture choices, HDR, and a
  **30 / 48 / 60 FPS** cap.
- **Focus:** body name, description, physical facts, distance information, and
  applicable body-specific controls such as Earth clouds or Venus atmosphere.
  A comet card includes its configured perihelion and separate coma/tail activity
  ramps alongside the ephemeris facts, and identifies the illustrative profile;
  those settings are not epoch-specific measurements.
- **Markers:** every marker is the body's astronomical symbol with its name
  above it. Markers are clickable, carry color-matched hover feedback, and
  highlight the associated path. They scale and fade with viewing conditions,
  and are suppressed for the focused object during camera travel. Choosing label
  mode **Off** hides text labels, not the independent distant-body glow markers.
  Each distant planet/moon glow marker is capped at that body's apparent
  diameter; a moon glow is suppressed while it would merge with its parent's
  marker. Moons without a distinct formal symbol share a common symbol.
- **Camera:** selecting a body glides the camera along one eased, slightly bowed
  path with a gentle field-of-view breath; the duration is sized to the distance
  travelled rather than to a fixed time. Returning to the system overview glides
  back the same way instead of cutting to it. The near clip adapts to close body
  and ring clearances, with logarithmic depth, to avoid slicing annuli during
  close fly-throughs.
- **Dock behavior:** draggable placement, idle collapse, and saved dock side/
  vertical position. Other preference persistence depends on the individual
  control; do not assume every temporary interface state is saved.
- **Loading:** a simple orbit illustration, a single percentage, and one short
  activity label. The loaded-task counter is not shown.

### Initial defaults

Defaults are **Asteroids off**, **Catalogue Stars always on**, **48 FPS**, and
**Milky Way on**. Optional interface and population preferences are stored in
`localStorage` and reused on the next launch.

### Keyboard shortcuts

| Input | Action |
| --- | --- |
| Space | Pause/resume |
| H | Hide/show the dock |
| W / S | Dolly in/out like the mouse wheel (walk forward/back while landed) |
| A / D | Strafe sideways (walk across the surface while landed) |
| Q / E | Roll counter-clockwise / clockwise |
| Mouse wheel | Zoom; scroll close to land; adjust height while landed |
| L | Land immediately on the focused or last-focused planet or Moon |
| T | Toggle asteroid populations |
| C | Stop camera motion |
| M | Mute/unmute |
| N | Sync Now |
| O | Cycle Trails → Orbits → Off |
| `-` / `+` | Zoom out / in |
| `,` / `.` | Adjust simulation speed |
| R | System overview |
| Esc | Leave landing, unfocus, or reset the camera |

Shortcuts are suppressed while editing inputs, text areas, select controls, or
editable content. Space/Enter on buttons retain their normal button behavior.
Wallpaper Engine uses a restricted shortcut set and a mouse-oriented hint list.

The speed slider supports finer adjustment, including keyboard control and
Shift-assisted precision. Active loading/error messages and the persistent
out-of-range warning are shown outside the dock controls.

## Architecture

The project combines ES modules, locally bundled dependencies, workers, and
application modules assembled by the bootstrap. File counts are intentionally
not hardcoded here: they change with releases and asset packages.

| Area | Responsibility |
| --- | --- |
| `src/main.js`, `src/app/` | Bootstrap, application state, interface wiring, frame updates |
| `src/core/` | Engine coordination, adaptive worker/cache integration, placement, orbit geometry, rendering helpers |
| `src/bodies/` | Body catalogue/shapes, factories, planets, rings, and small-body layers |
| `src/sim/` | Theory/runtime helpers, interpolation curves, path history, trails, approximate orbit propagation |
| `src/render/` | Texture pipeline, procedural textures, HDR and camera-motion effects |
| `src/shaders/` | Eclipse, atmosphere, and shadow shader integrations |
| `src/data/` | Translated SpaceEngine standard-atmosphere parameters used by the volumetric shader |
| `src/ui/`, `src/systems/` | Dock, focus/navigation, input, camera and supporting interfaces |
| `src/sky/` | Sky maps, constellation rendering and sky controls |
| `data/` | Numerical tables, metadata, catalogues, validation/provenance and reference material |
| `assets/` | Textures, audio and other local visual/media assets |
| `vendor/` | Bundled third-party libraries/theory dependencies; see their notices for actual provenance |
| `License/` | Third-party notices, attribution inventory, source records and unresolved licensing items |

The adaptive planetary path evaluates local models in a worker, constructs
bounded interpolation caches, and provides coherent snapshots for placement.
The renderer handles those snapshots, body geometry, paths, and visibility.
Extra-body and comet layers have their own table-loading/sampling logic; the
main engine does not independently solve every population in the application.

`src/core/approximate-ephemeris.js` and `src/sim/approximate-orbits.js` provide
the separate out-of-range fallback. They do not remove the original scientific
coverage guards.

## Performance

Graphics tiers change selected texture sizes, shader detail, draw ranges, label
refresh intervals, and pixel-ratio targets. The separate Performance selector
caps rendering at 30 fps with a 2560 × 1440 render-pixel budget in Balanced, or
allows up to 60 fps without that pixel-budget cap in Full; the lower of the
selected FPS preference and profile cap is used. Expensive effects and
high-resolution textures still require suitable hardware; these caps do not
guarantee a fixed FPS on every integrated GPU.

Implemented techniques include:

- Adaptive worker-side ephemeris caches rather than recomputing the full theory
  independently for every rendered frame.
- A pre-work FPS gate and additional rendering/visibility gates.
- Hidden-tab handling, frame-rate-aware controls, and moderated playback during
  cache preparation or close-up motion.
- Instanced/point-based small-body rendering and visibility culling where
  applicable.
- Trail level of detail: fewer ribbon segments and reduced glow as more paths
  are visible.
- Scratch-vector reuse, cached DOM writes, pooled label-layout data, a 30 fps
  CSS-label update ceiling, and reduced per-frame allocations in selected
  systems. This is not a claim of zero allocations in every frame.
- Camera-frustum rejection for atmospheric weather and gas-giant storm updates;
  Earth lightning events are selected from camera-facing regions, while its
  cloud-mask gate and simulation-rate-aware flash scheduling remain in place.
- Frustum-cullable orbit and trail lines with explicit/dynamic bounds; standard
  realistic orbit tessellation is 2,048 segments instead of 65,536.
- A lower ring-particle buffer ceiling; low/medium population draw counts are
  preserved while the highest tier stores fewer points.
- Texture request management, reuse and disposal during changes, with separate
  focus/sky texture considerations.
- Camera near-plane adjustment and collision handling for supported bodies.
- An eight-step cap on normal atmosphere view marches, reduced to five near the
  ground or inside a shell, plus up to six Earth cloud-volume samples (reduced
  to three or one for smaller projected views and one to three in ground mode).
- Asynchronous 512 × 256 close-approach DEM preparation, terrain-readiness
  gating during landing, and hysteretic detail activation. Near-ground mode
  lowers the renderer pixel-ratio cap to 78% of the selected quality cap.

The FPS cap is a target/limit, not a guarantee; no browser/GPU timing benchmark
is included for these code-level changes. Camera protection is not an exhaustive
collision simulation of every instanced asteroid, ring particle, or transparent
effect. Narrow-screen layout and extreme zooms should still be checked on the
target browser/device.

## Platform integration

- **Wallpaper Engine:** property/audio listeners and environment detection
  support wallpaper-specific controls. Host permissions and input behavior can
  differ from a normal browser tab.
- **Reduced motion:** supported weather/high-frequency effects observe the
  relevant preference where implemented. It is not a promise that all camera
  motion or orbital animation is automatically disabled; pause and camera
  controls remain available.
- **Audio:** local tracks, mute and volume controls; no claim that embedded media
  has been cleared for every redistribution scenario. See licensing below.

## Troubleshooting

| Symptom | Checks |
| --- | --- |
| Blank scene or failed module load | Use HTTP, enable WebGL 2/hardware acceleration, inspect the browser console and failed requests, and check paths/MIME types. |
| System or a body is unavailable | Allow caches/data to load; check for missing or mismatched tables and the applicable coverage. A procedural texture cannot repair missing numerical data. |
| Approximate warning appears | The selected date is outside supported coverage. Return to 1800-01-03 through 2199-12-28 UTC for the normal path; individual data limits still apply. |
| No historical trails outside coverage | Intentional. Try Orbits for usable osculating ellipses instead. |
| Charon, Himalia or Phoebe absent at an in-range date | Their original local tables cover 2020–2040, not the entire common interval. |
| Poor frame rate or graphics-memory errors | Lower Graphics/sky resolution, reduce optional populations/effects, and use the 30 or 48 FPS cap. |
| No audio | Interact with the page, check mute/volume and browser autoplay rules, and verify local audio files. |
| Changes appear stale | Hard-refresh so the browser drops old cached modules. |
| Date looks shifted | The picker represents UTC, not device-local time. Compare against a UTC clock. |

## Scope and limitations

Solister is an educational/exploratory visualization, not a navigation,
mission-planning, astrometry, eclipse-prediction, or photometric research tool.
It is a solo learning project integrating VSOP2013, TOP2013, and other
astronomical theories; remaining defects and simplified layers are possible.

- The scene is not a full live N-body integration of everything visible.
- Sources, coverage, precision, and uncertainty differ across populations.
- Remote-date fallback positions can be drastically wrong while still producing
  smooth, finite orbits.
- Comet activity, solar detail, atmosphere appearance, weather and lighting are
  illustrative rather than historical measurements or first-principles models.
- Synthetic belts/backgrounds are not complete inventories of real objects.
- The named Kuiper subset is not a complete dwarf-planet or trans-Neptunian
  catalogue, and some objects are points rather than separately resolved bodies.
- General transparent-volume/ring occlusion and collisions have implementation
  limits.
- No Oort cloud, galaxy-scale scene, or complete stellar survey is implemented.
  Landed walking follows the rendered body mesh with a conservative bounding-
  sphere fallback; it is not a terrain/rover simulation or mission-grade surface
  navigation.

These are scope choices and practical limits, not claims that broader features
or better astronomical datasets are scientifically impossible.

## Contributions

Solister was a solo-creation project with a deliberately controlled direction.
Contributors are all welcome and also posting issues too as a thought must not
remain bound to one mind, it must be shared to help yourself and others.

## Licenses and acknowledgments

The root **`License/`** directory contains component-specific notices and the
attribution/provenance audit. It is **not a blanket license for the entire
application**, and a public source or downloadable file does not automatically
establish unrestricted redistribution rights.

Start with:

- [License overview](License/README.md)
- [Component inventory](License/inventory.md)
- [Open licensing/provenance items](License/OPEN-ITEMS.md)
- [Texture sources and credits](License/textures/NOTICE-TEXTURES.md)
- [Theory provenance](License/theories/README.md)

The recorded audit is dated **30 September 2026**. Its source snapshots and
open items describe the evidence available at that time; they are not legal
clearance for every subsequent release or use.

### Credits and important qualifications

- **Three.js and bundled add-ons:** rendering and scene infrastructure; retain
  the applicable MIT notices and verify bundled component versions.
- **Astronomy Engine:** astronomical utilities and the Galilean moon model;
  retain its MIT notice.
- **VSOP2013, TOP2013, ELP/MPP02, MARSSAT, TASS17 and GUST86:** planetary,
  lunar and satellite theories. Publication citations, coefficient-file terms,
  wrapper licenses and bundled-code licenses are distinct matters.
- **THRASTRO ephem.js and related upstream work:** the recorded root license is
  LGPL v3; satellite files also carry per-file notices and inherited provenance.
  Applicable source-distribution obligations need review, not just copied
  license texts.
- **NASA/JPL Horizons, kernels and small-body data:** numerical sources and
  provenance. Do not describe all NASA/JPL data, software or imagery as a single
  unrestricted public-domain collection; review the terms for the actual files.
- **HYG v4.1 / David Nash / Astronexus:** the offline stellar-motion supplement
  is attributed under **CC BY-SA 4.0**. Preserve required credits and adapted-data
  notices; this does not automatically license unrelated application code.
- **ESA/Gaia/DPAC:** matched astrometry. The recorded official data terms are
  **CC BY-NC 3.0 IGO**, not the earlier README's unqualified CC BY 4.0 claim.
  Confirm the terms applicable to acquisition/use and address commercial
  authorization requirements described in the audit.
- **IAU, Hipparcos and constellation-data contributors:** definitions and
  catalogue context. Trace the provenance of the actual star, figure, boundary
  and name files rather than assigning them all the HYG supplement's license.
- **Solar System Scope:** the reported source of planet texture-pack assets,
  distributed under **CC BY 4.0**. User-supplied Earth day/night KTX2 maps are
  included at 2K/4K/8K and copied byte-for-byte; their conversion history is not
  independently established. Retain attribution/source links and map any other
  original planet textures if supplied.
- **NASA/Goddard SVS, Ernie Wright, and ESA/Gaia/DPAC:** the reported Milky Way
  source family corresponds to **Deep Star Maps 2020**. The exact local variant
  is unverified; other sky overlays need their own provenance checks.
- **Tunetank:** the reported source of background music. Track identities and
  applicable permissions/certificates remain unresolved. Do not assume that a
  YouTube source or general website-use permission authorizes bundling the
  recordings, standalone redistribution, or every wallpaper/game use.
- **Basis Universal, Emscripten and Zstandard:** texture/transcoding dependencies
  and their applicable notices, as recorded in the component inventory.

The original application's license must be chosen or confirmed by its rights
holder. No project-wide MIT, CC0 or commercial-use grant is implied by this
README. Resolve the open items before distributing a release that depends on
those permissions, and do not imply endorsement by credited organizations.
