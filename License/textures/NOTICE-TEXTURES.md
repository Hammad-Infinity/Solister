# Texture sources and credits
## Solar System Scope
User-reported source of planet textures: https://www.solarsystemscope.com/textures/ . The official page explicitly distributes its texture pack under **CC BY 4.0**. Full legal text: `../data/CC-BY-4.0.txt`.

Suggested credit for verified pack assets: “Textures by Solar System Scope, licensed under Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/).” Include the source link and describe actual alterations. Runtime uses KTX2/resolution variants, but the original images and conversion history were not supplied: complete the asset-by-asset mapping and record resizing, conversion, reprojection or color edits accurately. Do not claim unverified modifications as known facts.
The pack uses NASA imagery/elevation data, adjusted colors and fictional terrain in unmapped areas; it is not entirely unmodified mission imagery. The source page's attribution license must be retained despite NASA source material.

## Milky Way — likely NASA SVS Deep Star Maps 2020
User called the source “NASA Deep Sky 2020 maps.” The matching official product is **Deep Star Maps 2020**, https://svs.gsfc.nasa.gov/4851/ , released September 9, 2020, visualization by Ernie Wright. It includes multiple celestial/galactic/EXR variants and later corrections. Exact local map variant and original bytes have not been verified.

Official credit:
> NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC.

For figures originating from that product, also retain its additional credit:
> Constellation figures based on those developed for the IAU by Alan MacRobert of Sky and Telescope magazine (Roger Sinnott and Rick Fienberg).

NASA media-use guidance is saved in `../policies/`; acknowledge the source, do not imply endorsement, and review third-party rights. Do not turn that guidance into a universal MIT/CC0 grant or assume it overrides ESA's separate Gaia data terms. Confirm the applicable terms for the selected visual asset; the Gaia numerical subset has its own notice.

Runtime names include `milky_way.ktx2`, `starmap.ktx2` and `sky_overlay_rgb.ktx2`. The user's source statement confirms only the Milky Way source family. It does not establish the origin of every overlay/grid/star texture or of `constellation-data.js`. These need independent mapping. Procedural nucleus/atmosphere/cloud effects are separate from licensed input textures.
