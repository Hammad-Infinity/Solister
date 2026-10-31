// The volumetric cloud shell: what the volume is rendered into.
//
// This is the part you fly through. The shell is a sphere a little above the
// planet; the shader intersects the view ray with it, walks the ray through the
// 3D extinction field, and integrates the light that reaches the eye. Because
// the cloud is a *field* and not a surface, being inside it works without a
// special case: the near intersection collapses to zero and the same march runs
// from wherever the camera is.
//
// The technique is the one the literature settled on:
//
//   * march with a random per-pixel offset, so a small number of steps does not
//     produce banding. With the offset the error becomes noise, and the eye
//     tolerates noise far better than rings [Schneider 2015, "Optimisations for
//     Real-Time Volumetric Cloudscapes"]. The offset here is *static*: this
//     renderer has no temporal reprojection, and an offset that changes every
//     frame would look like television static instead of grain.
//   * integrate transmittance analytically over each step rather than with a
//     point sample, which is what lets 60 steps look like 600;
//   * step by the size of a pixel rather than by a constant: a step much
//     smaller than a pixel costs work nobody can see, and a step much larger
//     aliases the layer. In clear air the step grows, so a ray can cross a gap
//     between two clouds without spending its whole budget there;
//   * add detail at march time from a small tiling noise, and fade that detail
//     out as the footprint grows past it, so distant cloud stays clean instead
//     of turning into grain [Guerrilla, Nubis];
//   * stop early once the ray is opaque -- a cloud that is already white behind
//     a cloud cannot be seen;
//   * light with a short second march toward the sun and a two-lobe
//     Henyey-Greenstein phase function, which is what gives a cloud its bright
//     forward-scattering rim and its darker back.
//
// Everything is in SI units inside the shader: extinction per metre, distance
// in metres, optical depth dimensionless. The only scaled quantity is the
// distance itself, which the renderer works in planet radii.

const CLOUD_MARCH = {
    // Steps along the view ray. The march spends them where the sampling rate
    // is set by the pixel footprint, so this is a ceiling, not a fixed cost.
    maxSteps: 64,
    // Steps toward the sun for self-shadowing.
    lightSteps: 5,
    // Whether the largest detail octave also shadows the sun roll-off. It is
    // the octave that draws the bumps you can see, so it is the one that has to
    // shade them: without it a deck of billows is flat cream. The weight that
    // gates it is the same one the view march uses, so at a footprint where the
    // octave has already faded out (orbital range) this costs one branch, and
    // near the camera it costs one fetch per sun sample.
    lightDetail: 1,
    // Distance toward the sun, as a fraction of the view step. Long enough to
    // cross the layer the sample is in, short enough not to cost.
    lightMarchFraction: 0.55,
    // A step through empty air is this many times a step through cloud: the
    // field is smooth and empty there, so little is lost by skipping it. It is
    // also capped in absolute terms, because a long step that lands inside a
    // cloud integrates that whole step as if it were dense and paints a band.
    emptyStepFactor: 8.0,
    maxEmptyStepKm: 2.0,
    // Step growth along the ray. A fixed step is right near the camera and
    // useless far from it: a ray that grazes the shell crosses hundreds of
    // kilometres, and 64 fixed steps of 2.5 km would stop before it reached
    // the far side, leaving the limb empty. Growing by 6 percent per step
    // multiplies the reach by about 20 while keeping the near field dense.
    stepGrowth: 1.06,
    maxStepKm: 6.0,
    // Mask warp: the tile of the detail noise that breaks up the deck's
    // extrusion, and how far it can move the coverage across its threshold.
    // 0.35 is about half the width of the smoothstep, so a column can gain or
    // lose its cloud over a few kilometres of height.
    warpTileKm: 64,
    warpStrength: 0.35,
    // Close-range domain warp. The volume is 160 x 80 x 80, so a pixel a few
    // hundred metres wide sits inside one voxel and sees trilinear
    // interpolation, which draws flat faces and soft cubes. Warping the sample
    // position by a fraction of a kilometre in all three directions turns those
    // faces into the cauliflower edge of a real cloud. It fades in as the pixel
    // footprint drops below 60 km and is off entirely from orbit.
    closeWarpKm: 2.6,
    closeWarpTileKm: 9.8,
    closeWarpFromKm: 8.0,
    closeWarpToKm: 60.0,
    // Where the march gives up: below this transmittance nothing behind matters.
    stopTransmittance: 0.02,
    // Henyey-Greenstein lobes for water cloud (two-lobe fit, mixed 0.7) and for
    // ice (narrower forward lobe, because cirrus crystals scatter forward hard).
    water: { g1: 0.5, g2: -0.3, mix: 0.7 },
    // Asymmetry parameter of the droplet size distribution: g = 0.85 for
    // stratus and cumulus (droplets scatter strongly forward), 0.8 for ice.
    // Used both for the phase function and for the transport correction above.
    anisotropy: 0.85,
    ice: { g1: 0.6, g2: -0.2, mix: 0.8 },
    // Multiple-scattering approximation: a cloud is not a single-scattering
    // medium, and without this term the shadowed side goes black. 0.35 is the
    // usual scale for the second-order contribution.
    multiScatter: 0.35,
    // Ambient (sky) light reaching a cloud from above.
    ambient: 0.22,
    albedo: 0.9,
    // The detail noise's tile sizes, km: one tile is this many km across, so
    // the smallest feature in it is a 64th of that. Three octaves covering
    // 3.7 km, 1.2 km and 375 m of feature size are what let one coarse volume
    // hold structure at every distance a camera can see it from. Each octave
    // fades once a pixel is wider than its features -- see detailWeight().
    // The shell's thickness above the surface, km. Cloud tops reach 12-14 km;
    // the shell covers the whole troposphere so every layer is inside it.
    shellTopKm: 14.5
};

function createCloudShell(THREE, options = {}) {
    const O = { ...CLOUD_MARCH, ...options };
    const volume = options.volume;
    if (!volume) return null;
    const radiusKm = options.radiusKm || 6371;
    const shellRadiusKm = radiusKm + O.shellTopKm;
    const planetRadius = options.planetRadius;         // world units of the drawn body
    const maxRadiusKm = options.maxRadiusKm || radiusKm;

    const geometry = new THREE.SphereGeometry(shellRadiusKm / maxRadiusKm * planetRadius, 192, 96);

    const material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
            uVolume: { value: volume.texture },
            uDetail: { value: volume.detailTexture },
            uCoverage: { value: options.coverageTexture || null },
            uCenter: { value: new THREE.Vector3() },
            uShellRadius: { value: planetRadius * shellRadiusKm / radiusKm },
            uPlanetRadius: { value: planetRadius },
            uKmToWorld: { value: planetRadius / radiusKm },
            uSunDir: { value: new THREE.Vector3(1, 0, 0) },
            uSunColor: { value: new THREE.Vector3(1.0, 0.97, 0.93) },
            uSunIntensity: { value: 1.0 },
            uMaxExtinction: { value: volume.extinctionMaxPerM },
            uMaxIceExtinction: { value: volume.iceExtinctionPerM },
            uTopKm: { value: volume.topKm },
            uSteps: { value: O.maxSteps },
            uLightSteps: { value: O.lightSteps },
            uLightDetail: { value: O.lightDetail },
            uStopT: { value: O.stopTransmittance },
            uWater: { value: new THREE.Vector3(O.water.g1, O.water.g2, O.water.mix) },
            uIce: { value: new THREE.Vector3(O.ice.g1, O.ice.g2, O.ice.mix) },
            uMultiScatter: { value: O.multiScatter },
            uAmbient: { value: O.ambient },
            uAlbedo: { value: O.albedo },
            uLightFraction: { value: O.lightMarchFraction },
            uEmpty: { value: O.emptyStepFactor },
            uMaxEmptyStep: { value: O.maxEmptyStepKm },
            // Size of one pixel at the clouds, km. Set every frame from the
            // camera; the whole sampling rate is derived from it.
            uPixelKm: { value: 0.25 },
            uStepGrowth: { value: O.stepGrowth },
            uMaxStepKm: { value: O.maxStepKm },
            uAnisotropy: { value: O.anisotropy },
            uWarpTileKm: { value: O.warpTileKm },
            uWarpStrength: { value: O.warpStrength },
            // The close-range domain warp: amplitude in km, and the footprint
            // in km over which it fades in.
            uCloseWarpTileKm: { value: O.closeWarpTileKm },
            uCloseWarpKm: { value: O.closeWarpKm },
            uCloseWarpFromKm: { value: O.closeWarpFromKm },
            uCloseWarpToKm: { value: O.closeWarpToKm },
            // The wind uniforms are owned by cloud-motion.js and merged in
            // here, so the shader and the motion share one set of values.
            ...(O.motionUniforms || {}),
            // 1 = paint the shell flat magenta. A probe can then tell "the
            // geometry and depth path work" from "the march produces nothing",
            // which are indistinguishable in a photograph of a cloud.
            uDebug: { value: 0 },
            uOpacity: { value: 1.0 }
        },
        vertexShader: /* glsl */ `
            precision highp float;
            #include <common>
            out vec3 vWorld;
            void main() {
                vec4 world = modelMatrix * vec4(position, 1.0);
                vWorld = world.xyz;
                gl_Position = projectionMatrix * viewMatrix * world;
            }
        `,
        fragmentShader: /* glsl */ `
            precision highp float;
            precision highp sampler3D;

            uniform sampler3D uVolume;
            uniform sampler3D uDetail;
            uniform sampler2D uCoverage;
            uniform vec3 uCenter;
            uniform float uShellRadius;
            uniform float uPlanetRadius;
            uniform float uKmToWorld;
            uniform vec3 uSunDir;
            uniform vec3 uSunColor;
            uniform float uSunIntensity;
            uniform float uMaxExtinction;
            uniform float uMaxIceExtinction;
            uniform float uTopKm;
            uniform int uSteps;
            uniform int uLightSteps;
            uniform float uLightDetail;
            uniform float uStopT;
            uniform vec3 uWater;
            uniform vec3 uIce;
            uniform float uMultiScatter;
            uniform float uAmbient;
            uniform float uAlbedo;
            uniform float uLightFraction;
            uniform float uEmpty;

            uniform float uMaxEmptyStep;
            uniform float uPixelKm;
            uniform float uStepGrowth;
            uniform float uMaxStepKm;
            uniform float uAnisotropy;
            uniform float uWarpTileKm;
            uniform float uWarpStrength;

            // Close-range domain warp, faded in by footprint (see cloud-lod.js
            // for the altitude band). Its own tile so it does not correlate
            // with the genus detail it is hiding.
            uniform float uCloseWarpTileKm;
            uniform float uCloseWarpKm;
            uniform float uCloseWarpFromKm;
            uniform float uCloseWarpToKm;

            // The wind, shared with the deck (cloud-motion.js).
            ${CLOUD_WIND_GLSL}
            uniform float uDebug;
            uniform float uOpacity;

            in vec3 vWorld;
            out vec4 fragColor;

            // Two-lobe Henyey-Greenstein, the standard fit for a cloud droplet
            // phase function: one lobe forward, one backward.
            float hg(float mu, float g) {
                float g2 = g * g;
                float d = 1.0 + g2 - 2.0 * g * mu;
                return (1.0 - g2) / (12.5663706 * pow(max(d, 1e-4), 1.5));
            }
            float phase(float mu, vec3 lobes) {
                return mix(hg(mu, lobes.x), hg(mu, lobes.y), lobes.z);
            }

            // Interleaved gradient noise: a cheap, screen-aligned dither. Every
            // pixel starts its march at a different offset, so the steps' error
            // is noise rather than rings.
            float ign(vec2 p) {
                return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
            }

            // Local spherical frame: longitude, latitude, altitude above the body.
            vec3 toLocal(vec3 p) {
                vec3 d = (p - uCenter);
                float r = length(d);
                float altKm = (r - uPlanetRadius) / uKmToWorld;
                return vec3(atan(d.x, d.z) * 0.15915494309 + 0.5, acos(clamp(d.y / max(r, 1e-6), -1.0, 1.0)) * 0.31830988618, altKm);
            }

            // Macro extinction at a point, in per metre, in two channels:
            // x = water cloud, y = ice cloud. Both channels are scaled here by
            // the deck's own 2048 x 1024 coverage, which carries the horizontal
            // detail -- a 160 x 80 x 80 volume can say where cloud is
            // *vertically* and roughly where it is horizontally, and no more
            // than that without costing hundreds of megabytes.
            //
            // Ice is masked by the same altitude-blended coverage as water, not
            // exempted from it. The blend below reaches the high etage's own
            // map by cirrus altitudes, so high cloud can still exist over a
            // clear low sky -- but where the high map is clear there is no ice
            // either. The volume bakes genus geometry into every column and
            // leaves presence to these maps; an unmasked ice channel therefore
            // put an optically thick veil over the whole planet, which is the
            // white sky a landed camera saw in every direction.
            // The longitude of the point below the sun, in the same turns the
            // volume texture uses: 0.5 is the subsolar meridian.
            float subsolarLongitude() {
                return atan(uSunDir.x, uSunDir.z) * 0.15915494309 + 0.5;
            }

            // Returns (water, ice, feature size in km). The third is the size of
            // this cloud genus's internal structure, baked into the volume's blue
            // channel by cloud-volume.js: cirrus is laid out in filaments a few
            // kilometres apart and cumulus in lumps of a few kilometres, and one
            // global tile size cannot be both.
            vec3 macroExtinction(vec3 p, float pixelKm, out float longitude, bool primary) {
                vec3 local = toLocal(p);
                longitude = local.x;
                // Outside the troposphere a sample costs nothing.
                if (local.z < 0.05 || local.z > uTopKm) return vec3(0.0);

                // ---- where the air came from -------------------------------
                // The field is a snapshot; this is what makes it move. The
                // displacement is subtracted because sampling at "where the air
                // came from" is what shows the cloud travelling with the wind.
                float latDeg = 90.0 - local.y * 180.0;
                vec2 advect = cloudFieldOffset(latDeg, local.z);
                // local.y is 0 at the north pole. The volume's slices were baked
                // with the north pole at v = 0, and the deck's canvas texture is
                // uploaded flipped (three's default), so both read local.y as
                // their v. Using 1.0 - local.y here mirrored every cloud field
                // north to south, which is invisible until you compare it with
                // the deck beside it.
                // ---- close-range domain warp -------------------------------
                // One fetch, faded out by 60 km of footprint. It shifts the
                // sample in all three directions, which is what breaks the
                // voxel faces that a fly-through would otherwise see.
                float closeWarp = 0.0;
                if (primary && uCloseWarpToKm > uCloseWarpFromKm) {
                    float amount = 1.0 - smoothstep(uCloseWarpFromKm, uCloseWarpToKm, pixelKm);
                    if (amount > 0.0) {
                        vec3 localKm = (p - uCenter) / uKmToWorld;
                        // A tile of its own, unrelated to the genus detail, so
                        // the warp does not correlate with the cloud's lumps.
                        float n = texture(uDetail, localKm / (uCloseWarpTileKm) + 0.37).r - 0.5;
                        closeWarp = n * amount;
                    }
                }
                float cosLat = max(cos(radians(latDeg)), 0.2);
                float warpLon = closeWarp * uCloseWarpKm / 40030.0 / cosLat;
                float warpLat = closeWarp * uCloseWarpKm / 20015.0;
                float warpAlt = closeWarp * uCloseWarpKm * 0.35;

                float sampleAlt = local.z + warpAlt;
                vec4 v = texture(uVolume, vec3(local.x - advect.x + warpLon,
                                               local.y + advect.y / 180.0 + warpLat,
                                               sampleAlt / uTopKm));
                // The deck paints one coverage map per etage into the same
                // texture's three channels, and each layer drifts at the wind of
                // its own altitude. So the mask is sampled three times -- R for
                // the low layer, G for the middle, B for the high -- and blended
                // by how far up this sample is. Sampling one channel everywhere
                // (which is what the single-layer version did) would pin every
                // cirrus shield to the low deck's footprint, the one thing the
                // split exists to prevent.
                float uvWrappedLat = local.y + warpLat;
                vec2 advectLow = cloudFieldOffset(latDeg, uDeckAltitudeKm);
                vec2 advectMid = cloudFieldOffset(latDeg, uMidAltitudeKm);
                vec2 advectHigh = cloudFieldOffset(latDeg, uHighAltitudeKm);
                vec2 uvLow = vec2(local.x - advectLow.x + warpLon, uvWrappedLat + advectLow.y / 180.0);
                vec2 uvMid = vec2(local.x - advectMid.x + warpLon, uvWrappedLat + advectMid.y / 180.0);
                vec2 uvHigh = vec2(local.x - advectHigh.x + warpLon, uvWrappedLat + advectHigh.y / 180.0);
                float coverLow = texture(uCoverage, uvLow).r;
                float coverMid = texture(uCoverage, uvMid).g;
                float coverHigh = texture(uCoverage, uvHigh).b;
                // Where one layer's map hands over to the next. The middle etage
                // starts at 2 km and the high etage around 5-6, so the blends sit
                // just above each boundary and are wide enough not to band.
                float blendMid = smoothstep(1.8, 3.4, sampleAlt);
                float blendHigh = smoothstep(6.0, 9.5, sampleAlt);
                float coverage = mix(mix(coverLow, coverMid, blendMid), coverHigh, blendHigh);
                // The deck is a map, and a map extruded through the whole
                // troposphere makes every cloud a vertical wall with the map's
                // own 20 km grid as its silhouette -- the flat plates that were
                // obvious the moment the camera got close. Warping the mask with
                // a coarse 3D noise moves the boundary in and out with height,
                // which is what gives the flank of a cumulus its cauliflower
                // edge. It costs one fetch, and only on the primary march: the
                // sun's shadow rays use the unwarped mask, where a kilometre of
                // wobble changes nothing.
                if (primary) {
                    vec3 localKm = (p - uCenter) / uKmToWorld;
                    float warp = texture(uDetail, localKm / uWarpTileKm).r;
                    coverage += (warp - 0.5) * uWarpStrength;
                }
                float mask = smoothstep(0.22, 0.72, coverage);
                // Deep convection has a diurnal cycle that the low cloud deck
                // does not: the anvil is brightest in the late afternoon over
                // land. Only the ice channel carries it -- a stratus sheet is
                // driven by the boundary layer, not by insolation.
                float diurnal = cloudConvectiveDiurnal(local.x, subsolarLongitude());

                return vec3(v.r * uMaxExtinction * mask,
                            v.g * uMaxIceExtinction * mask * diurnal,
                            max(0.5, v.b * 64.0));
            }

            // Extinction, with detail eroded into the edges. The noise is
            // sampled in the body's own kilometre frame -- the Cartesian
            // position, not stretched longitude, latitude and altitude -- which
            // is what keeps billows equally sized in all three directions
            // instead of smeared into horizontal streaks.
            //
            // Nothing is eroded below a threshold, so dense cores stay solid
            // and only the edges get fluff. Both octaves fade out once a pixel
            // is wider than their features: that is the exact moment the noise
            // would stop reading as shape and start reading as grain.
            // How much of an octave survives at this footprint. The noise's
            // smallest feature is one 64th of a tile; below that size a pixel
            // can still resolve it, above about three features it would only
            // alias, so the octave fades out between the two.
            float detailWeight(float tileKm, float pixelKm) {
                float feature = tileKm * 0.015625;
                return 1.0 - smoothstep(feature * 0.6, feature * 3.0, pixelKm);
            }

            float extinctionAt(vec3 p, float pixelKm, out float iceFraction) {
                float longitude;
                vec3 macro = macroExtinction(p, pixelKm, longitude, true);
                float e = macro.x + macro.y;
                iceFraction = e > 0.0 ? macro.y / e : 0.0;
                if (e <= 0.0) return 0.0;

                // Three octaves of this genus's own feature size: the lumps, the
                // billows on the lumps, and the wisps on the billows.
                float tile = macro.z;
                float t0 = tile, t1 = tile * 0.34, t2 = tile * 0.11;
                float w0 = detailWeight(t0, pixelKm);
                if (w0 <= 0.0) return e;
                float w1 = detailWeight(t1, pixelKm) * 0.55;
                float w2 = detailWeight(t2, pixelKm) * 0.30;

                vec3 localKm = (p - uCenter) / uKmToWorld;
                // 0.5 is neutral: it leaves the macro shape alone, so an octave
                // that has faded out restores the smooth cloud rather than
                // eroding it.
                float shape = mix(0.5, texture(uDetail, localKm / t0).r, w0);
                shape = mix(shape, texture(uDetail, localKm / t1).r, w1);
                shape = mix(shape, texture(uDetail, localKm / t2).r, w2);
                float keep = smoothstep(0.26, 0.58, shape);
                return e * mix(1.0, keep, w0);
            }

            // Optical depth toward the sun over a short march inside the shell.
            // the step is metres, because extinction is per metre: mixing the
            // two units here is not a small error, it is seven orders of
            // magnitude, and it is what once left every cloud lit only by the
            // ambient term -- flat, navy, and with no shadowed side at all.
            float sunOpticalDepth(vec3 p, float stepMetres, float pixelKm) {
                float tau = 0.0;
                float ignored;
                vec3 dir = uSunDir;
                float stepWorld = stepMetres * uKmToWorld * 0.001;
                for (int i = 1; i <= 5; i++) {
                    if (i > uLightSteps) break;
                    // The macro field only. Shadowing a 200 m wisp of detail
                    // noise at five samples of a 700 m march is noise on noise,
                    // and it costs two texture fetches per sun sample -- the
                    // single most expensive thing in this shader.
                    vec3 q = p + dir * stepWorld * float(i);
                    vec3 m = macroExtinction(q, pixelKm, ignored, false);
                    float e = m.x + m.y;
                    // The largest detail octave casts the shadow it draws. Its
                    // footprint weight is the view march's own, so an octave
                    // already faded out at this pixel size costs nothing here:
                    // the fetch disappears with the weight. Only this octave --
                    // the next one down is a few hundred metres, which five
                    // samples of a 700 m march would turn into noise on noise
                    // rather than a shadowed flank.
                    float w0 = detailWeight(m.z, pixelKm) * uLightDetail;
                    if (e > 0.0 && w0 > 0.0) {
                        vec3 localKm = (q - uCenter) / uKmToWorld;
                        float shape = mix(0.5, texture(uDetail, localKm / m.z).r, w0);
                        e *= mix(1.0, smoothstep(0.26, 0.58, shape), w0);
                    }
                    tau += e * stepMetres;
                }
                return tau;
            }

            // What a cloud *reflects*. exp(-tau) is the fraction of light that
            // has not been scattered at all, which is not what makes a cloud
            // bright: a cloud is the whitest natural surface on Earth because
            // multiple scattering sends most of the incident light back out.
            //
            // The two-stream (diffusion) reflectance of a conservatively
            // scattering slab is R = tau / (tau + 2): it rises to 1 as the slab
            // thickens and leaves nothing for a clear sky. Turning it into a
            // radiance is then Lambert's law, R/pi, which is the same convention
            // the planet surface under it is drawn with -- so a cloud and the
            // ground beneath it can be compared directly.
            float cloudReflectance(float tau) {
                return tau / (tau + 2.0);
            }

            void main() {
                if (uDebug > 0.5 && uDebug < 1.5) {
                    fragColor = vec4(1.0, 0.0, 1.0, 1.0);
                    return;
                }
                vec3 ro = cameraPosition;
                vec3 rd = normalize(vWorld - ro);

                // The shell.
                vec3 oc = ro - uCenter;
                float b = dot(oc, rd);
                float c = dot(oc, oc) - uShellRadius * uShellRadius;
                float h = b * b - c;
                if (h < 0.0) discard;
                h = sqrt(h);
                float tNear = max(0.0, -b - h);
                float tFar = -b + h;

                // The planet blocks anything behind it. This is an analytic
                // sphere, so it is exact, needs no depth buffer, and works with
                // the camera anywhere.
                float pc = dot(oc, oc) - uPlanetRadius * uPlanetRadius;
                float ph = b * b - pc;
                if (ph > 0.0) {
                    float tp = -b - sqrt(ph);
                    if (tp > 0.0) tFar = min(tFar, tp);
                }
                if (tFar <= tNear) discard;

                // One step is about one pixel, clamped to the layer's own
                // vertical resolution: a pixel smaller than 75 m cannot show
                // anything finer, and one wider than the layer would skip it.
                float pixelKm = max(uPixelKm, 0.02);
                float stepKm = clamp(pixelKm * 1.5, 0.075, 2.5);
                float stepLen = stepKm * uKmToWorld;

                // Jitter the start within one step. ign() is a fixed function
                // of the pixel, so the offset is stable from frame to frame:
                // a frame-varying dither would trade banding for boiling grain.
                float t = tNear + stepLen * ign(gl_FragCoord.xy);

                vec3 scattered = vec3(0.0);
                float transmittance = 1.0;
                // Scattering angle: between the direction the light came from
                // and the direction it leaves toward the eye. With the wrong
                // sign the forward lobe of every cloud lands on its shadowed
                // side, which is the one thing the eye checks first.
                float mu = dot(-rd, uSunDir);
                bool previousEmpty = false;
                float totalTau = 0.0;
                // Optical depth accumulated along the view ray, and the
                // reflectance that depth has already produced. Their difference
                // between two samples is the light this slab adds -- see the
                // multiple-scattering block below.
                float tauView = 0.0;
                float reflectance = 0.0;

                for (int i = 0; i < 128; i++) {
                    if (i >= uSteps || t > tFar) break;
                    vec3 p = ro + rd * t;
                    float iceFrac;
                    float e = extinctionAt(p, pixelKm, iceFrac);
                    // Empty air is crossed in a longer step, cloud in short
                    // ones: the budget goes where the field has structure.
                    float emptyStep = min(stepLen * uEmpty, max(stepLen, uMaxEmptyStep * uKmToWorld));
                    float ds = e > 0.0 ? stepLen : emptyStep;

                    // A long step that ends inside a cloud crossed the cloud's
                    // surface somewhere along itself, and integrating the whole
                    // step as dense cloud is what paints the bright/dark bands
                    // along the step grid. Looking halfway back costs one sample
                    // and puts the first cloud sample near the surface, where
                    // the light actually is. The step still advances by its full
                    // length, so the march keeps moving.
                    float slab = ds;
                    // The slab in metres: extinction is per metre, and every
                    // optical depth below is built from this one number.
                    float slabMetres = slab * (1.0 / uKmToWorld) * 1000.0;
                    if (e > 0.0 && previousEmpty) {
                        vec3 pm = ro + rd * (t - ds * 0.5);
                        float em = extinctionAt(pm, pixelKm, iceFrac);
                        if (em > 0.0) { p = pm; e = em; slab = ds * 0.5; slabMetres = slab * (1.0 / uKmToWorld) * 1000.0; }
                    }
                    previousEmpty = e <= 0.0;
                    if (e > 0.0) {
                        float tauSun = sunOpticalDepth(p, slabMetres * uLightFraction, pixelKm);

                        // The local vertical. The cloud layers are horizontal,
                        // so this is the slab's normal -- not latitude, which is
                        // what this read once and which lit the poles
                        // differently for no reason.
                        vec3 up = normalize(p - uCenter);

                        // Multiple scattering.
                        //
                        // A cloud is not a single-scattering medium: a droplet
                        // scatters light tens of times before it leaves, and
                        // that is why a cloud is the whitest thing in the sky.
                        // Integrating single scattering alone gives 0.08 where
                        // reality gives 0.9, and the cloud comes out slate grey
                        // -- which is exactly what this shader did.
                        //
                        // The two-stream diffusion result for a conservatively
                        // scattering slab is R = tau/(tau+2). The *increment* of
                        // that reflectance across this step is how much of the
                        // incident light the step reflects, and summing the
                        // increments over the ray saturates at one for an
                        // optically thick cloud and stays small for a wisp.
                        // Using tau along the *view* ray is what makes the top
                        // of a cumulus white and its base grey.
                        //
                        // Using the sun's optical depth here instead -- as this
                        // did -- asks "how much cloud is between this point and
                        // the sun", which is zero at the top of every cloud, so
                        // the sunlit tops came out black. Shadowing belongs in
                        // exp(-tauSun), not in the reflectance.
                        float stepTau = e * slabMetres;
                        tauView += stepTau;
                        // Reflectance integrates over the *transport* optical
                        // depth, tau (1 - g), not the total one. A droplet
                        // scatters mostly forward, so the depth a photon must
                        // random-walk through before it forgets its direction is
                        // the transport mean free path, seven times longer at
                        // g = 0.85. With the total tau, R = tau/(tau+2) is
                        // already 0.96 ten metres below a cloud top: every
                        // cloud deposits its whole radiance in a skin at the
                        // top, where nothing below can shade it, and a deck of
                        // billows renders as a flat white card. With the
                        // transport tau the same slab develops its gradient
                        // over the depth a photon actually samples, which is
                        // what gives a cumulus its bright top and grey base.
                        // The sun march already worked in this depth (lit,
                        // below); this is the same correction on the view side.
                        float reflectanceNew = cloudReflectance(tauView * (1.0 - uAnisotropy));
                        float dReflectance = reflectanceNew - reflectance;
                        reflectance = reflectanceNew;

                        // Light reaching this point, attenuated by the cloud
                        // between it and the sun. exp(-tau) is the *direct*
                        // beam, and it is the wrong quantity for a cloud: with
                        // an extinction of 0.05 per metre, forty metres below a
                        // cloud top the direct beam is down to e^-2 and a real
                        // cloud there is still several times brighter than that.
                        // What illuminates the interior is the diffuse field,
                        // and in the diffusion limit a scattering medium
                        // attenuates at the transport-corrected rate,
                        // sigma*(1-g), not at sigma. With g = 0.85 that is a
                        // mean free path nearly seven times longer -- which is
                        // why a cumulus is white all the way down its sunlit
                        // side and grey only where the path is genuinely long.
                        float lit = exp(-tauSun * (1.0 - uAnisotropy));
                        // Lambert: a cloud top under a high sun is bright, the
                        // same cloud at the terminator is not.
                        float cosSun = max(dot(up, uSunDir), 0.0);
                        vec3 sunRadiance = uSunColor * uSunIntensity * uAlbedo
                            * (1.0 / 3.14159265) * cosSun * lit * dReflectance;

                        // Single scattering, kept separate because it is the
                        // only part that carries the phase function: it puts the
                        // bright rim on a backlit edge and the glow around the
                        // sun, which multiple scattering would smear out.
                        float forward = phase(mu, mix(uWater, uIce, iceFrac)) * 12.5663706 * uMultiScatter;
                        vec3 forwardRadiance = uSunColor * uSunIntensity * uAlbedo
                            * forward * lit * transmittance * (1.0 - exp(-stepTau));

                        // Sky light from above, same Lambert shape.
                        vec3 ambient = uSunColor * uAmbient
                            * (0.35 + 0.65 * clamp(dot(up, uSunDir) * 0.5 + 0.5, 0.0, 1.0))
                            * dReflectance;

                        totalTau += stepTau;
                        scattered += sunRadiance + forwardRadiance + ambient;
                        transmittance *= exp(-stepTau);
                        if (transmittance < uStopT) break;
                    }
                    // Grow the step with distance so a grazing ray still
                    // crosses the shell. Clamped, because a step longer than a
                    // cloud layer would skip it outright.
                    stepLen = min(stepLen * uStepGrowth, uMaxStepKm * uKmToWorld);
                    t += ds;
                }

                if (uDebug > 1.5) {
                    // 2 = coverage (alpha), 3 = how much cloud the ray actually
                    // met. A photograph cannot tell an empty sky from a dark
                    // cloud; these two numbers can.
                    float show = uDebug < 2.5 ? (1.0 - transmittance) : clamp(1.0 - exp(-totalTau), 0.0, 1.0);
                    fragColor = vec4(vec3(show), 1.0);
                    return;
                }
                float alpha = (1.0 - transmittance) * uOpacity;
                if (alpha < 0.003) discard;
                // Premultiplied: colour is already multiplied by coverage.
                fragColor = vec4(scattered * uOpacity, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        // Outside the shell the front face is the closest surface the clouds
        // own, so ordinary depth testing puts them correctly in front of their
        // own planet and correctly behind anything nearer (the Moon during an
        // eclipse). Inside the shell there is no front face at all, and the
        // planet is handled analytically.
        side: THREE.FrontSide,
        // The shell never writes depth and never tests it: this renderer runs
        // with a logarithmic depth buffer, and the analytic sphere in the
        // shader already knows exactly where the planet is, so the depth buffer
        // would only add a second, disagreeing answer.
        depthTest: false
    });
    material.premultipliedAlpha = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "volumetric clouds";
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;

    const state = {
        frames: 0,
        inside: false,
        altitudeKm: 0,
        light: null,
        lightAge: 1e9
    };
    mesh.userData.state = state;

    const _sunPos = new THREE.Vector3();
    const _camWorld = new THREE.Vector3();

    // The sun, from whichever light actually lights the scene. Not from the sun
    // body: at orbit scale that is a camera-relative proxy whose position says
    // nothing about the lighting. Rescanned every half second, because the
    // light is re-parented as the focus changes.
    function findSun(scene) {
        let best = null;
        scene.traverse(o => {
            if (!o.isLight || o.intensity <= 0.01 || o.visible === false) return;
            if (!best || o.intensity > best.intensity) best = o;
        });
        state.light = best;
        state.lightAge = 0;
    }

    // The hook belongs to the object, not the material: this renderer follows
    // modern three, which calls Object3D.onBeforeRender only. A material-level
    // hook is a silent no-op, and every uniform below would stay at its default
    // -- which is exactly how the first version of this file rendered nothing.
    mesh.onBeforeRender = (renderer, scene, camera) => {
        const u = material.uniforms;
        // The shell is a child of the body, so its centre and radius have to be
        // read from the world matrix every frame: the planet both moves and
        // scales as the camera flies.
        mesh.updateWorldMatrix(true, false);
        const m = mesh.matrixWorld.elements;
        u.uCenter.value.set(m[12], m[13], m[14]);
        const s = mesh.matrixWorld.getMaxScaleOnAxis();
        const planetWorld = planetRadius * s;
        u.uShellRadius.value = planetWorld * shellRadiusKm / radiusKm;
        u.uPlanetRadius.value = planetWorld;
        u.uKmToWorld.value = planetWorld / radiusKm;

        // Camera altitude above the surface, km, and the footprint of one pixel
        // at that distance. Everything the march spends follows from these two.
        camera.getWorldPosition(_camWorld);
        const distance = _camWorld.distanceTo(u.uCenter.value);
        const altitudeKm = Math.max(0, (distance - planetWorld) / u.uKmToWorld.value);
        state.altitudeKm = altitudeKm;
        const heightPx = Math.max(1, renderer.getDrawingBufferSize(_bufferSize).y);
        // fov is undefined on an orthographic camera, and some passes in this
        // renderer use one. A non-finite value here would make every step NaN
        // and the whole shell silently vanish, so the fallback is explicit.
        const fov = Number.isFinite(camera.fov) ? camera.fov : 45;
        const pixelKm = Math.min(100, Math.max(0.01, Math.max(altitudeKm, 4) * 2 * Math.tan(fov * Math.PI / 360) / heightPx));
        u.uPixelKm.value = pixelKm;
        mesh.userData.debug = { altitudeKm, pixelKm, fov, heightPx, distance };

        // Depth and culling flip once when the camera crosses the shell.
        const inside = distance < u.uShellRadius.value;
        if (inside !== state.inside) {
            state.inside = inside;
            material.side = inside ? THREE.BackSide : THREE.FrontSide;
        }

        // Sun direction and colour.
        state.lightAge++;
        if (!state.light || state.lightAge > 30 || !state.light.parent) findSun(scene);
        if (state.light) {
            state.light.getWorldPosition(_sunPos);
            u.uSunDir.value.copy(_sunPos).sub(u.uCenter.value).normalize();
            const c = state.light.color;
            u.uSunColor.value.set(c.r, c.g, c.b);
            u.uSunIntensity.value = Math.min(1, state.light.intensity);
        }

        state.frames++;
        mesh.userData.frames = state.frames;
    };

    const _bufferSize = new THREE.Vector2();

    return mesh;
}

globalThis.CLOUD_MARCH = CLOUD_MARCH;
globalThis.createCloudShell = createCloudShell;
