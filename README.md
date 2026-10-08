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
- **W/A/S/D** move relative to the camera's view. While landed, movement follows
  the rendered surface at a capped 1.4 m/s; near a focused planet or Moon but
  not landed, it is capped at 1.4 m/s. Interplanetary flight remains faster.
- **Q/E** roll counter-clockwise/clockwise.
- Select a planet or the Moon, then press **L** to approach and settle at a
  near-surface tangent view, with the eye positioned about 1.7 m above the
  rendered surface. While landed, WASD continues to move tangent to the
  rendered surface, left-drag still aims, and the wheel adjusts height.
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

- **Earth:** day/night materials, city lights, clouds, cloud-shadow and eclipse
  effects, atmosphere rendering, and illustrative lightning at a fixed set of
  storm-prone regions. Jupiter and Saturn likewise use stable regional storm
  bands rather than whole-globe random flash locations.
- **Venus:** a surface/atmosphere presentation with a focus control to reveal the
  surface. Surface maps and atmospheric appearance are visualization inputs,
  not a live visible-light view through the clouds.
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

The runtime elevation catalog applies global topography to **Earth (NOAA ETOPO1),
Mercury (MESSENGER), Venus (Magellan), Mars (MOLA), and the Moon (LOLA)**. The
source maps are resampled to 2048 × 1024 grids for rendering; this is lower
resolution than several native source products. Relief is exaggerated 20× for visibility, with bump mapping and hypsometric
contrast from the same 16-bit grids; this deliberately strong presentation boost
is not a scientific elevation scale. Vertical
datums and conversions are recorded in `data/elevation/catalog.json`, with the
reproducible builder in
`tools/build_elevation_catalog.py`. For Mars, the PDS MEGDR label identifies the
product datum as the GMM3 (mgm1025) degree/order 50 areoid; cells without
observations are interpolated in the supplied MEGDR, and the source height is
applied radially without an areoid-to-ellipsoid correction. Other planets and
moons retain their reference shapes; no global DEM is fabricated for them.

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

The Sun keeps a neutral-white, procedurally granulated photosphere with a bright
white centre. A sphere-attached layer adds 1,600 randomly distributed white flecks,
streaks, and tapered spikes with varied physical lengths, widths, and brightness.
Their physical sizes are fixed in solar-radius units (ordinary perspective still
applies), while their emission responds smoothly to camera distance.

The analytic corona integrates its power-law radial column in **closed form**
(no march loop), rolls off with a soft knee, self-extinguishes with a
Beer–Lambert term, and fades smoothly at the shell edge. A broader additive halo
joins the photosphere without a visible rim; both corona and halo grow brighter
with distance. Fine, low-intensity lens ghosts and streaks move along the
Sun-to-screen-centre axis as the camera moves, providing subtle parallax.

The photosphere uses procedural granulation, but there is no measured
active-region, filament, prominence, or loop reconstruction. These visual
effects are illustrative and are not an eye-safe representation of looking at
the real Sun.

### Atmospheres

Bodies that possess a real atmosphere no longer wear a corona glow shell. They
get a light-scattering atmosphere instead: Rayleigh + Mie **single scattering**
with Beer–Lambert extinction along both the view ray and the sun ray,
Rayleigh/Henyey–Greenstein phase functions, an isotropic multiple-scattering
approximation, and — where they matter — ozone (Earth) and methane
(Uranus/Neptune) absorption bands. Earth additionally receives lunar-eclipse
shadowing on its atmosphere.

The physical database (composition, pressure, temperature, and gravity) derives
mixture molar mass, scale height `H = R·T/(M̄·g)`, relative molecular
Rayleigh strength from refractivity/King factors, and vertical optical depth
from the hydrostatic column `N = P/(m·g)`. Aerosol/Mie settings, absorber
profiles, and per-body visual gains are tuned inputs, not measurements or a
complete first-principles atmosphere model. Bodies without a real atmosphere
(Mercury, the Moon, …) get no scattering shell; their distant presentation is
carried by the glow marker.

The march uses a fixed small sample count and a closed-form grazing-corrected
slant factor instead of a nested sun loop, so the cost stays a handful of ALU
ops per fragment — no extra render passes, no per-frame CPU work beyond two
vector uniforms per visible shell. Clouds, lightning, and weather remain
stylized layers and are not historical meteorological reconstructions.

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

The constellation-oriented catalogue contains **8,790 star records** in the
supplied dataset. Catalogue stars are always visible; there is no star-layer
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

Texture assets use resolution variants under `assets/textures/`, including KTX2
maps where supplied. The texture pipeline uses manifests, request management,
and procedural fallbacks to reduce missing-map requests and keep supported
visuals usable while assets load.

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

| Key | Action |
| --- | --- |
| Space | Pause/resume |
| H | Hide/show the dock |
| W / A / S / D | Move the camera |
| Q / E | Roll counter-clockwise / clockwise |
| L | Land on the focused or last-focused planet or Moon |
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
refresh intervals, and pixel-ratio targets. Expensive effects and high-resolution
textures still require suitable hardware; Low does not guarantee that every
feature runs at a fixed FPS on every integrated GPU.

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
- Scratch-vector reuse, cached DOM writes, and independently throttled UI work
  in relevant paths. This is not a claim of zero allocations in every frame.
- Texture request management, reuse and disposal during changes, with separate
  focus/sky texture considerations.
- Camera near-plane adjustment and collision handling for supported bodies.

The FPS cap is a target/limit, not a guarantee. Camera protection is not an
exhaustive collision simulation of every instanced asteroid, ring particle, or
transparent effect. Narrow-screen layout and extreme zooms should still be
checked on the target browser/device.

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
  Landing provides simple surface walking and clearance against the rendered
  body mesh, not a terrain/rover simulation or mission-grade surface navigation.

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
  distributed under **CC BY 4.0**. Retain attribution, source links and actual
  modification information; exact local asset mapping still needs verification.
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
