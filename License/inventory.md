# Component inventory
Paths are project-relative where established from imports. Absent assets are explicitly marked, not inferred to be cleared.

| Component / files | Evidence and terms | Status / action |
|---|---|---|
| `vendor/three.bundle.js`; THREE addons embedded in it | THREE r160 reported by supplied bundle/project; upstream r160 MIT text in `code/three-r160-MIT.txt` | Preserve notice. Custom bundle/addon composition not reproduced byte-for-byte; identify extra components separately. |
| `vendor/astronomy.browser.min.js`, wrapper `astronomy.js`; JupiterMoons | Astronomy Engine, Don Cross, MIT (`code/Astronomy-Engine-MIT.txt`) | Exact stripped/minified build version not established. Current upstream notice retrieved; confirm release-specific notice before distribution. |
| `vendor/basis/basis_transcoder.js` and expected `.wasm` | Basis Universal Apache-2.0; Emscripten MIT/NCSA and possible Zstandard BSD dependencies; texts supplied | WASM/build revision not supplied. Included dependency texts are candidates, not a verified complete binary notice inventory. |
| `vendor/theories/vsop2013.js` | Exact bytes match THRASTRO ephem.js 10-extreme distribution; LGPLv3 root | Preserve LGPL+GPL texts; supply required corresponding source/build materials on distribution. Underlying coefficient provenance separate. |
| `vendor/theories/top2013.js` | Referenced by runtime, but NOT in flattened uploads | Expected THRASTRO TOP2013, not verified; review actual installed file. |
| `vendor/theories/elpmpp02.js` | Matches THRASTRO 12-full except removed webmerge comment | Root LGPLv3; record this alteration and review corresponding source obligations. |
| `martians.sat.js`, `saturnians.tass17.js`, `uranians.gust86.js` | Exact THRASTRO minified matches. Unminified individual headers copied under `theories/` | Mixed context: individual MIT permission/copyright notices, root LGPLv3, and Stellarium/GPL2 provenance comments. Do not simply label the combined distributions MIT-only. |
| `data/constellation-motion-data.js` | Header identifies HYG v4.1 subset, CC BY-SA 4.0, David Nash/Astronexus | `data/NOTICE-HYG.txt`; retain attribution, indicate subset/reindexing/zero handling; license adapted data appropriately. |
| `data/constellation-gaia-astrometry.js` | Gaia DR3 plus Hipparcos crossmatch; ESA current data terms CC BY-NC 3.0 IGO | Incorrect CC BY 4.0 header corrected (comment only). `data/NOTICE-GAIA.txt`; commercial authorization unresolved. |
| `data/constellation-data.js`: star coordinates/names, figures, boundaries | No source/license notice supplied | UNVERIFIED; do not assign NASA/HYG/Stellarium licensing by similarity. Recover original sources. |
| Small-body catalog and model: `smallbodies-meta.json`, sample/coefficients/validation | Metadata: JPL SBDB, 2026-09-19; NEOWISE/albedo-derived sizes; Horizons DE441 fits | `data/NOTICE-JPL.txt`; scientific citations/metadata are not permission grants. Underlying tables and fit generator not all supplied. |
| Kuiper tables: `kuiper-meta.json`, expected binary | Metadata: JPL Horizons, 24 selected bodies, 2026-09-21 | Same JPL notice; binary referenced but not supplied for byte verification. |
| Pluto/Charon/Himalia/Phoebe and historical JSON tables | Supplied metadata cites JPL PLU060/DE440, JUP347/DE442, SAT441L and Horizons | Same JPL notice; preserve query/solution metadata. |
| Neptune moon tables / `neptune-core.js` | Body catalog cites JPL NEP098 for Triton and Nereid | Actual table/kernel provenance and redistribution terms need confirmation; not a license for SPICE software. |
| V8 comet core/layer/Fun and offline ephemeris | Project-generated code/derivatives; JPL Horizons queries/solutions retained in JSON | Preserve V8 metadata/validation. No invented MIT grant for JPL data or user code. |
| Planet surface/ring/cloud textures | User identifies Solar System Scope | Source pack CC BY 4.0 confirmed; exact local image/KTX2 inventory absent. `textures/NOTICE-TEXTURES.md`. |
| `milky_way.ktx2`, `starmap.ktx2`, `sky_overlay_rgb.ktx2` and resolution variants | Runtime names known; user identifies NASA 2020 maps for Milky Way only | Likely SVS4851; do NOT automatically assign same source to starmap or overlays. Verify variants and all original credits. |
| `assets/audio/track1.mp3` … `track6.mp3` | Runtime has six slots; user identifies Tunetank YouTube channel only | Track titles/authors/URLs/receipts absent; `audio/UNVERIFIED.md`. |
| Original app source, procedural shaders/textures, supplied atmosphere GLSL, CSS/tests | No complete original-project ownership/license statement supplied | Retain existing rights; no blanket relicensing. Recover source provenance for externally copied shaders/fonts/icons and unprovided vendor modules. |

Full observed file hashes are in `observed-files.json`; they identify this audit's inputs, not a license assignment. Missing components are not implicitly covered by neighboring files.
