// The weather field: storms and the atmosphere's state, rasterised onto the map.
//
// Two things come out of this file and both are per texel:
//
//   stormSignal  how strongly a weather system is present here, 0-1. The cloud
//                field adds this before it ranks, so a storm region becomes
//                overcast and the quiet air between systems loses cover. That
//                keeps the planet's measured climatology exact -- the rank
//                fixes the total -- while letting storms decide where.
//   cloudTypeMap RGBA, *which cloud genus* each etage carries here:
//                  R  low etage genus id     (see render/clouds/cloud-types.js)
//                  G  middle etage genus id
//                  B  high etage genus id
//                  A  tropopause height, km / 20
//                The volume bake reads this to give every column the vertical
//                extent and the internal scale of its genus, so a trade-wind
//                sky and a frontal sheet are not the same slab of cloud.
//   weatherMap   RGBA, three physical quantities and the storm's presence:
//                  R  cloud top height, km / 20
//                  G  ice fraction, 0-1
//                  B  storm intensity, 0-1
//                  A  opaque
//
// The flash map itself is returned as data, not as a texture: the bolts are
// drawn by the lightning system from a list of strike regions, and it reads
// this map to find them. One source of truth for where lightning is.
//
// The shapes are the real ones, drawn at the real sizes: a squall line is a
// line, a cyclone has an eye and an eyewall and spiral bands, and an
// extratropical cyclone is a comma with a cold front trailing from it.

const WEATHER_FIELD = {
    width: 2048,
    height: 1024,
    // Where longitude zero sits in the texture.
    //
    // Derived from the two conventions this app already uses, not guessed: the
    // body frame puts longitude 0 on +z (cosLat*sin lon, sin lat, cosLat*cos lon),
    // the sphere's own UV is u = atan2(z, -x)/2pi, and the deck material samples
    // that at u + 0.25. Composing the three gives column = W*(lon/360 + 0.5).
    // Getting this wrong by a quarter turn puts every storm 90 degrees east of
    // where the climate said it should be, and the lightning system then samples
    // clear sky at every strike region -- which is exactly what happened.
    longitudeOffsetTurns: 0.5,
    // Cloud top used to normalise the height channel: 20 km covers the deepest
    // tropical overshoot, and everything above it saturates.
    maxCloudTopKm: 20,
    seed: 770312,
    dayOfYear: 182
};

// A calm, unlit background.
function createWeatherField(THREE, options = {}) {
    const P = { ...WEATHER_FIELD, ...options };
    const W = P.width, H = P.height;
    const landAt = P.landAt || (() => 0);

    const population = buildStormPopulation({
        seed: P.seed,
        dayOfYear: P.dayOfYear,
        landAt,
        climateAt: P.climateAt
    });

    const stormSignal = new Float32Array(W * H);
    const flashMap = new Float32Array(W * H);

    // ---- geometry helpers --------------------------------------------------
    const kmPerDegLat = 111.32;
    const lonToX = lon => {
        let u = lon / 360 + P.longitudeOffsetTurns;
        u = ((u % 1) + 1) % 1;
        return u * W;
    };
    const latToY = lat => (90 - lat) / 180 * H;
    // A texel is 20 km at the equator and narrower in longitude toward the
    // poles, so the km-to-texel scale has to be local: 2048 texels span the
    // 40 030 km circumference, and a degree of longitude shrinks as cos(lat).
    const texelsPerKmAtLat = lat => W / (kmPerDegLat * 360 * Math.max(0.06, Math.cos(lat * Math.PI / 180)));
    const texelAreaKm2AtLat = lat => (40030 / W) * (40030 / W) * Math.cos(lat * Math.PI / 180);

    const smooth = (e0, e1, x) => {
        const t = Math.max(0, Math.min(1, (x - e0) / Math.max(e1 - e0, 1e-9)));
        return t * t * (3 - 2 * t);
    };

    // Write into a target array inside a storm's bounding box, in km. The
    // profile is handed a taper that reaches zero exactly at the box edge:
    // without it every system ends on a straight cut where its shape outgrew
    // its own bounding box, and the map filled with rectangles.
    const paint = (storm, radiusKm, profile) => {
        const cy = latToY(storm.lat);
        const cx = lonToX(storm.lon);
        const latSpan = radiusKm / kmPerDegLat;                 // degrees
        const y0 = Math.max(0, Math.floor(latToY(Math.min(90, storm.lat + latSpan))));
        const y1 = Math.min(H - 1, Math.ceil(latToY(Math.max(-90, storm.lat - latSpan))));
        if (y1 < y0) return;
        for (let y = y0; y <= y1; y++) {
            const lat = 90 - (y + 0.5) * 180 / H;
            const texelsPerKm = texelsPerKmAtLat(lat);
            // Longitude span widens with latitude in texels, not in km.
            const xSpan = radiusKm / (kmPerDegLat * Math.max(0.05, Math.cos(lat * Math.PI / 180))) * W / 360;
            const x0 = Math.floor(cx - xSpan), x1 = Math.ceil(cx + xSpan);
            for (let x = x0; x <= x1; x++) {
                let dx = x - cx;
                dx = ((dx % W) + W) % W;
                if (dx > W / 2) dx -= W;
                const dy = y - cy;
                const r = Math.hypot(dx, dy) / texelsPerKm;
                const taper = 1 - smooth(radiusKm * 0.72, radiusKm, r);
                if (taper <= 0) continue;
                profile(r, x, y, dx / texelsPerKm, dy / texelsPerKm, taper);
            }
        }
    };

    const deposit = (value, x, y) => {
        if (y < 0 || y >= H) return;
        const xi = ((x % W) + W) % W;
        const i = y * W + xi;
        if (value > stormSignal[i]) stormSignal[i] = value;
    };

    // ---- the systems -------------------------------------------------------
    for (const storm of population.storms) {
        const R = storm.diameterKm / 2;
        const intensity = storm.intensity;
        const rng = (storm.lat * 977 + storm.lon * 131 + storm.diameterKm) % 6.283;

        if (storm.kind === "cyclone") {
            const eye = storm.eyeKm;
            paint(storm, R, (r, x, y, dx, dy, taper) => {
                if (r > R) return;
                // Eye: clear air inside the radius of the eye.
                if (r < eye) { deposit(0, x, y); return; }
                // The central overcast: solid from the eyewall out to about
                // half the radius, thinning outward. A cyclone is a filled
                // shield of cloud, not a ring -- the eye is the only hole in it.
                const shield = (1 - smooth(eye * 1.2, R * 0.55, r)) * 0.92
                             + Math.exp(-r / (R * 0.8)) * 0.15;
                // Spiral rainbands: logarithmic arcs. They are cut sharply in
                // angle (a band has edges) and fade with radius, which keeps
                // them reading as arcs rather than as a row of beads.
                const theta = Math.atan2(dy, dx);
                const spiral = 0.5 + 0.5 * Math.cos(2 * (theta * storm.hemisphere) - 4.6 * Math.log(Math.max(1, r)));
                const arc = smooth(0.72, 0.96, spiral) * Math.exp(-r / (R * 0.85)) * 0.55;
                const value = intensity * Math.max(shield, arc + shield * 0.4) * taper;
                deposit(Math.min(1, Math.max(0, value)), x, y);
            });
        } else if (storm.kind === "mcs") {
            // A squall line: an elongated core with a sharp leading edge and a
            // broad stratiform shield trailing behind it.
            const cosA = Math.cos(storm.orientationRad), sinA = Math.sin(storm.orientationRad);
            paint(storm, R * 1.3, (r, x, y, dx, dy, taper) => {
                const along = dx * cosA + dy * sinA;
                const across = -dx * sinA + dy * cosA;
                const core = Math.exp(-Math.pow(Math.abs(across) / (R * 0.22), 2)
                                      - Math.pow(Math.abs(along) / (R * 0.9), 2));
                const shield = Math.exp(-Math.pow(r / (R * 1.1), 2)) * 0.55;
                deposit(Math.min(1, intensity * (core * 1.15 + shield) * taper), x, y);
            });
        } else {
            // Extratropical cyclone: a comma cloud with a cold front trailing
            // out of the low centre.
            const front = storm.frontAngleRad;
            paint(storm, R, (r, x, y, dx, dy, taper) => {
                const theta = Math.atan2(dy, dx);
                let dTheta = theta - front;
                dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
                // The front: a band along one radius, widening outward.
                const acrossFront = Math.abs(dTheta) * r;
                const frontBand = Math.exp(-Math.pow(acrossFront / (30 + 0.12 * r), 2))
                                  * Math.exp(-r / (R * 1.15));
                // The comma head: the occluded cloud mass around the centre.
                const head = Math.exp(-Math.pow(r / (R * 0.42), 2));
                deposit(Math.min(1, intensity * (head * 1.05 + frontBand * 0.85) * taper), x, y);
            });
        }

        // Lightning: the storm's whole flash rate, spread over its active area.
        // A Gaussian weighted by each texel's true area keeps the total equal to
        // the storm's rate no matter what latitude it sits at.
        const activeRadiusKm = Math.sqrt(storm.activeAreaKm2 / Math.PI);
        paint(storm, activeRadiusKm * 1.8, (r, x, y, dx, dy, taper) => {
            if (r > activeRadiusKm * 1.8) return;
            const w = Math.exp(-Math.pow(r / activeRadiusKm, 2));
            if (w < 0.02) return;
            const lat = 90 - (y + 0.5) * 180 / H;
            const texelKm2 = texelAreaKm2AtLat(lat);
            const xi = ((x % W) + W) % W;
            flashMap[y * W + xi] += storm.flashPerSecond * (texelKm2 / storm.activeAreaKm2) * w * taper;
        });
    }

    // Individual cells: sub-texel, so their lightning is deposited directly into
    // the texel they sit in, spread over its true area. There are a few thousand
    // of them; each is a point of light, which at this resolution is what a
    // thunderstorm is.
    // A cell is 5-15 km across, which is smaller than a texel: it has no shape
    // this map can hold, so it contributes its lightning to the one texel it
    // stands in and nothing to the drawn cloud. Painting it would put a
    // 20-km square of overcast where a city-sized storm belongs -- the field
    // already has weather at that scale from its own turbulence.
    for (const cell of population.cells) {
        const x = Math.round(lonToX(cell.lon));
        const y = Math.round(latToY(cell.lat));
        if (y < 0 || y >= H) continue;
        const lat = 90 - (y + 0.5) * 180 / H;
        const xi = ((x % W) + W) % W;
        flashMap[y * W + xi] += cell.flashPerSecond / Math.max(1, texelAreaKm2AtLat(lat));
    }

    // ---- the atmosphere's state, row by row --------------------------------
    // Cloud top and ice fraction follow from the climate at each latitude: the
    // depth a parcel can reach and the temperature it finds on the way. Doing
    // it per row is both correct (they are zonal means) and cheap.
    const climateAt = P.climateAt || globalThis.earthClimateAt;
    const cloudTopKmRow = new Float32Array(H);
    const iceRow = new Float32Array(H);
    const capeRow = new Float32Array(H);
    const climateRow = new Array(H);
    for (let y = 0; y < H; y++) {
        const lat = 90 - (y + 0.5) * 180 / H;
        const c = climateAt(lat, { dayOfYear: P.dayOfYear, longitudeDeg: 0, isLand: false });
        climateRow[y] = c;
        const parcel = globalThis.parcelAscent({
            surfaceT_C: c.surfaceT_C, surfaceRH: c.rh,
            tropopauseKm: c.tropopauseKm, tropopauseC: c.tropopauseC,
            lapseEnvKPerKm: c.lapseEnvKPerKm
        });
        cloudTopKmRow[y] = parcel.cloudTopKm;
        // Ice fraction at the cloud top: the top of a cloud is the coldest part
        // of it, so the phase there is what the satellite sees.
        const topT = c.surfaceT_C - c.lapseEnvKPerKm * parcel.cloudTopKm;
        iceRow[y] = globalThis.iceFraction(topT);
        capeRow[y] = parcel.capeJkg;
    }

    // ---- the texture -------------------------------------------------------
    const data = new Uint8Array(W * H * 4);
    const typeData = new Uint8Array(W * H * 4);
    const classify = typeof classifyCloudTypes === "function" ? classifyCloudTypes : null;
    let flashMax = 1e-9;
    for (let i = 0; i < W * H; i++) if (flashMap[i] > flashMax) flashMax = flashMap[i];

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const storm = stormSignal[i];
            // Inside a storm the top is higher than the zonal mean: deep
            // convection reaches the tropopause. Scale the row's cloud top by
            // the storm's strength, and cap it.
            const topKm = Math.min(P.maxCloudTopKm, cloudTopKmRow[y] * (0.55 + 0.6 * storm));
            const ice = Math.min(1, iceRow[y] * (0.65 + 0.5 * storm));
            const p = i * 4;
            data[p] = Math.round(topKm / P.maxCloudTopKm * 255);
            data[p + 1] = Math.round(ice * 255);
            data[p + 2] = Math.round(Math.min(1, storm) * 255);
            data[p + 3] = 255;

            // ---- which genus ------------------------------------------------
            if (classify) {
                const lat = 90 - (y + 0.5) * 180 / H;
                const lon = (x + 0.5) / W * 360 - 180;
                const t = classify({
                    surfaceT_C: climateRow[y].surfaceT_C,
                    rh: climateRow[y].rh,
                    capeJkg: capeRow[y],
                    ice,
                    storm,
                    land: landAt(lat, lon),
                    // The column's cloud only has the etages it actually
                    // reaches; see classifyCloudTypes.
                    //
                    // This is the *unscaled* ascent top, not the storm-scaled
                    // value written into the cloud-top channel above. That value
                    // exists so the channel varies across a system; feeding it
                    // here multiplied quiet air's cloud top by 0.55, which put
                    // most of the planet below the 2 km middle-etage base and
                    // left the middle etage empty in fair weather -- while the
                    // deck was drawing its own middle coverage at 24 % of the
                    // sky. The volume and the deck have to agree about which
                    // etages exist.
                    cloudTopKm: cloudTopKmRow[y],
                    tropopauseKm: climateRow[y].tropopauseKm
                });
                const q = i * 4;
                typeData[q] = t.low;
                typeData[q + 1] = t.mid;
                typeData[q + 2] = t.high;
                typeData[q + 3] = Math.round(climateRow[y].tropopauseKm / P.maxCloudTopKm * 255);
            }
        }
    }

    const texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    texture.name = "Weather field: cloud top, ice fraction, storm intensity";
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;

    // The type map is nearest-filtered on purpose: interpolating between genus
    // 3 and genus 7 would invent genus 5 at every boundary, and there is no
    // such cloud.
    const typeTexture = new THREE.DataTexture(typeData, W, H, THREE.RGBAFormat);
    typeTexture.name = "Cloud type map: genus per etage, tropopause";
    typeTexture.wrapS = THREE.RepeatWrapping;
    typeTexture.wrapT = THREE.ClampToEdgeWrapping;
    typeTexture.minFilter = THREE.NearestFilter;
    typeTexture.magFilter = THREE.NearestFilter;
    typeTexture.colorSpace = THREE.NoColorSpace;
    typeTexture.needsUpdate = true;

    // How much of the map each genus covers, for the record and for the probes.
    const typeHistogram = new Array(16).fill(0);
    for (let i = 0; i < W * H; i++) { typeHistogram[typeData[i * 4]]++; typeHistogram[typeData[i * 4 + 1]]++; typeHistogram[typeData[i * 4 + 2]]++; }

    const stats = {
        storms: population.storms.length,
        cells: population.cells.length,
        flashPerSecond: population.flashPerSecond,
        averageCellRate: population.averageCellRate,
        flashMax,
        cloudTopKmRange: [Math.min(...cloudTopKmRow), Math.max(...cloudTopKmRow)],
        tropicalFlashFraction: (() => {
            let trop = 0, all = 0;
            for (const s of [...population.storms, ...population.cells]) {
                all += s.flashPerSecond;
                if (Math.abs(s.lat) < 30) trop += s.flashPerSecond;
            }
            return all > 0 ? trop / all : 0;
        })()
    };

    return { texture, typeTexture, typeData, typeHistogram, stormSignal, flashMap, stats, population, landAt };
}

globalThis.WEATHER_FIELD = WEATHER_FIELD;
globalThis.createWeatherField = createWeatherField;
