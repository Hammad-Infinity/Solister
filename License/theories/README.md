# Analytical theories and implementations
Identified upstream: https://github.com/THRASTRO/ephem.js
Pinned source reference used for bundle comparisons: `2f679a1f698b4f20f9579d94da24af51559458ed`.
See `bundle-matches.json` for upstream URLs and hashes alongside the current local hashes. Before the comment cleanup, VSOP2013 10-extreme, MARSSAT, TASS17, and GUST86 matched their pinned upstream bundles byte-for-byte. ELPMPP02 12-full matched after removing only the generated `webmerge` context header and its newline. This project cleanup removed generated, non-legal block comments from the local theory bundles; executable/coefficient text was otherwise unchanged. Current files are therefore no longer byte-for-byte copies. TOP2013 is present locally, but the upload-based audit did not record an upstream hash comparison for it.

The repository root license is LGPLv3 (`../code/ephem-js-LGPL-3.0.txt`), accompanied here by GPLv3 as incorporated by that license. Do not describe the entire repository as MIT. The satellite source headers reproduced here contain copyright notices for Marcel Greter (2017) and Johannes Gajdosik (2005), an MIT permission text, and comments describing implementation taken from GPL2-licensed Stellarium. GPLv2 text is included as a reference for that provenance, not a claim that every file is GPLv2-only. The bundled wrappers/helpers and the original component can have different terms. A distribution compliance review must consider the actual combined files and preferred source.

## Scientific sources (citations are not redistribution licenses)
- VSOP2013 / TOP2013: J.-L. Simon, G. Francou, A. Fienga, H. Manche (2013), “New analytical planetary theories VSOP2013 and TOP2013,” Astronomy & Astrophysics 557 A49, https://doi.org/10.1051/0004-6361/201321843 . Original coefficient source paths reported upstream: `ftp://ftp.imcce.fr/pub/ephem/planets/vsop2013` and `ftp://ftp.imcce.fr/pub/ephem/planets/top2013`.
- ELP/MPP02 lunar theory: Chapront / Francou, original source path reported upstream `ftp://cyrano-se.obspm.fr/pub/2_lunar_solutions/2_elpmpp02/`.
- MARSSAT: upstream source identifies `ftp://ftp.imcce.fr/pub/ephem/satel/martian` and Stellarium `src/core/planetsephems/marssat.c`.
- TASS1.7: upstream identifies `ftp://ftp.imcce.fr/pub/ephem/satel/tass17` and Stellarium `tass17.c`.
- GUST86: upstream identifies `ftp://ftp.imcce.fr/pub/ephem/satel/gust86` and Stellarium `gust86.c`.
- Jovian moons: supplied catalog calls Astronomy Engine `JupiterMoons`; code notice in `../code/`.
- Triton/Nereid, Pluto-system and additional moon numerical tables: JPL solutions, not these analytic series; see `../data/NOTICE-JPL.txt`.

Original coefficient-file redistribution terms have not been conclusively established. The LGPL license of conversion/wrapper code is not assigned to all upstream observational/theory datasets. Corresponding source/build compliance remains open; the comment-only cleanup does not change those underlying terms.
