# Global elevation data attribution

The compact `data/elevation/*.u16` files are generated, reprojected/resampled,
and quantized derivatives. They are not the original source rasters. Their
source names, URLs, dimensions, native resolutions, vertical references,
encoding ranges, and SHA-256 hashes are recorded in `data/elevation/catalog.json`.

| Runtime grid | Source product | Attribution / source |
|---|---|---|
| `earth.u16` | NOAA NGDC ETOPO5 global relief (5 arc-minute) | NOAA National Centers for Environmental Information, [ETOPO5 directory](https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO5/TOPO/ETOPO5/) and [dataset documentation](https://iridl.ldeo.columbia.edu/SOURCES/.NOAA/.NGDC/.ETOPO5/.dataset_documentation.html). |
| `mercury.u16` | MESSENGER Global DEM 665 m, version 2 | U.S. Geological Survey Astrogeology, [Global DEM product page](https://astrogeology.usgs.gov/search/map/mercury_messenger_global_dem_665m) and [source GeoTIFF](https://planetarymaps.usgs.gov/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif). |
| `venus.u16` | Magellan Global Topographic Data Record GTDR-SINUS.3, version 2 | U.S. Geological Survey Astrogeology, [product page](https://astrogeology.usgs.gov/search/map/Venus/Magellan/RadarProperties/Venus_Magellan_Topography_Global_4641m_v02) and [source GeoTIFF](https://planetarymaps.usgs.gov/mosaic/Venus_Magellan_Topography_Global_4641m_v02.tif). |
| `mars.u16` | MGS MOLA MEGDR, 16 pixels/degree, product version 2.0 | NASA Planetary Data System Geosciences Node, [MOLA MEGDR documentation](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html) and [MEG016 product directory](https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg016/). |
| `moon.u16` | LOLA LDEM_16_UINT, 16 pixels/degree | NASA Goddard Scientific Visualization Studio, [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/) and [source raster](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif). |

The build script is `tools/build_elevation_catalog.py`. It bilinearly samples
source grids into 2048 × 1024 global rasters and linearly encodes the sampled
height range into unsigned 16-bit values. The Moon source uses 0.5 m per DN with
a 20,000-DN zero-elevation offset. The GPU bump approximation uses the high
byte of the 16-bit grid in an 8-bit, single-channel texture; full 16-bit values
remain available for CPU relief and surface sampling.

This notice records provenance and attribution, not a legal opinion or a
license grant. Consult each source provider's terms before redistribution or
commercial use. Provider names and agencies do not imply endorsement of
Solister.