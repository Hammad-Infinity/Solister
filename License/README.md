# Third-party licenses, credits and open items
Audit date: 2026-09-30. Scope: supplied source files, V8 additions and user-reported asset sources. This is an attribution/audit folder, **not a blanket license for the application and not a release-clearance certificate**. Missing texture/audio/binary files and unprovided build sources limit verification.

## Start here
- `inventory.md`: component mapping and status.
- `OPEN-ITEMS.md`: issues to resolve before distribution, especially commercial release.
- `code/`: upstream software license texts (not all project code).
- `theories/`: specific satellite notices, theory provenance and bundle comparisons.
- `data/`: catalog notices, global-elevation provenance, and Creative Commons legal texts.
- `textures/`, `audio/`: asset credits and missing provenance.
- `policies/`: dated official-source text snapshots/excerpts; policies are not universal software licenses.
- `sources.json`: retrieved URLs, dates and hashes for copied texts.
- `observed-files.json`: hashes of supplied files; observation does not establish copyright ownership.

**No project-wide MIT license is being invented.** Retain any existing project license and notices. Only the project rights holder can choose the original application's license, subject to third-party obligations. The code/license copies here apply to their identified components, not everything beside them.

### Key findings
1. HYG v4.1-derived motion data: **CC BY-SA 4.0**, including attribution and ShareAlike requirements for adapted data.
2. Gaia data: ESA's current official license is **CC BY-NC 3.0 IGO**, not the supplied subset's original CC BY 4.0 claim. The header is corrected to reference the official terms; data are unchanged. ESA's archive terms require a request to `data.licences@esa.int` before commercial use.
3. THRASTRO ephem.js: root **LGPL v3**; per-file satellite sources also contain MIT notices and Stellarium/GPL2 provenance language. Preserve all relevant notices and review actual combined-build/source obligations. Copying these texts alone does not satisfy every distribution obligation.
4. Solar System Scope texture pack: **CC BY 4.0**, subject to asset identity and required attribution/change indications.
5. NASA SVS Deep Star Maps 2020: likely source family for the reported Milky Way map; exact local variant unverified. Retain NASA/Gaia credits and review third-party terms, rather than declaring all NASA/JPL material public domain.
6. Tunetank: six unnamed local track slots cannot be tied to individual licensed recordings. Current general license excludes video games; website/educational permission is not proof of permission for this bundle or standalone redistribution.
7. Elevation grids: source attribution and conversion metadata are recorded in `data/NOTICE-ELEVATION.md` and `../data/elevation/catalog.json`. The compact grids are resampled/quantized derivatives; verify each provider's current terms before redistribution or commercial use.

Nothing in this patch removes music, changes celestial data, imposes a new license on the user's code, or claims endorsement by the credited organizations. Obtain appropriate legal review for a release if needed.
