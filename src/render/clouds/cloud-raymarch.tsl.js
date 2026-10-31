// cloud-raymarch.tsl.js — TSL counterpart of the volumetric
// cloud shell material in render/clouds/cloud-raymarch.js
// (port step P5e22), including the wind field functions the
// classic shader splices in from render/clouds/cloud-motion.js
// (that string has exactly one consumer — this shell — so its
// Fns live here, exported for any later consumer).
//
// What stays classic JavaScript, per the file's own split:
// the volume bake (cloud-volume.js), the motion clock and
// deck driving (cloud-motion.js), the scene-light scan, and
// the mesh factory's object wiring. What is ported here is
// the shader surface plus the two derivations Phase B needs
// to rebuild and drive it: deriveCloudShellInstall reads a
// production-built shell mesh (before its first frame hook)
// and deriveCloudShellFrame transcribes that hook's
// per-frame uniform arithmetic.
//
// Translation notes, all measured choices:
// * Production's loop breaks (step ceiling, ray end, opaque
//   stop) become an `active` flag guarding a fixed 128-step
//   Loop, the shape every earlier port in this tree is proved
//   with; TSL's Break has no precedent here yet. Arithmetic
//   and update order are production's, including the frozen
//   step/t on the stopping iteration.
// * The discards (no shell hit, empty segment, alpha below
//   0.003) and the two debug-mode early returns become one
//   output select chain. Under this material's premultiplied
//   blending with depth test and writes off, writing
//   (0,0,0,0) is a discard.
// * Out-of-band macro samples are selected to zero after the
//   fetches instead of returned before them; every fetch is
//   in-range for the textures' wrap modes. The genus tile is
//   floored at 0.5 km on the discarded path only (in band it
//   already is), which keeps coordinates finite without
//   changing any kept value.
// * The static IGN start offset reads the same GL-convention
//   fragment coordinate the classic reads, via the
//   screenSize flip the comet-occlusion port proved.
// * uSteps/uLightSteps are int uniforms in the classic; here
//   they are float uniforms compared against the loop index
//   as a float (exact for every value either can hold).
// * A null coverage texture is replaced by a 1x1 black Data
//   texture, which reads the same (0,0,0,1) the classic's
//   unbound sampler does. Missing motion uniforms default to
//   0, the classic's unbound-uniform value; production always
//   passes both.
// tools/p5cloudraymarch.mjs renders this factory against
// production's real createCloudShell/createCloudVolume/
// createCloudMotion on both node backends.

import {
    Fn,
    If,
    Loop,
    abs,
    acos,
    atan,
    bool,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
    positionWorld,
    pow,
    radians,
    screenCoordinate,
    screenSize,
    select,
    smoothstep,
    sqrt,
    texture,
    texture3D,
    uniform,
    vec2,
    vec3,
    vec4
} from "three/tsl";

// ---- uniform record helpers ---------------------------------------------
// The factory consumes the production-shaped { key: {value} }
// record so one record can drive either implementation.

function floatUniform(record, key, fallback = 0) {
    const v = record?.[key]?.value;
    return uniform(typeof v === "number" && Number.isFinite(v) ? v : fallback);
}

function vec3Uniform(T, record, key, fallback) {
    const v = record?.[key]?.value;
    const out = v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
        ? new T.Vector3(v.x, v.y, v.z)
        : new T.Vector3(fallback[0], fallback[1], fallback[2]);
    return uniform(out);
}

// ---- the wind (cloud-motion.js's shared shader chunk) --------------------

// Boundary-layer profile: 0.75 of the 10 m wind at the
// surface, 1.2 by 1.5 km, then handing over to the free
// atmosphere.
export const cloudBoundaryLayer = Fn(([altKm]) => {
    return float(0.75).add(float(0.45).mul(smoothstep(0.0, 1.5, altKm)))
        .mul(float(1.0).sub(float(0.4).mul(smoothstep(2.0, 6.0, altKm))));
});

// The zonal wind itself, m/s, positive eastward. Same model
// as cloud-motion.js's cloudWindEast(); tools/windcheck.mjs
// holds the classic pair together.
export const cloudEastWind = Fn(([latDeg, altKm]) => {
    const alat = abs(latDeg);
    const trade = float(1.0).sub(smoothstep(24.0, 34.0, alat));
    const west = smoothstep(30.0, 42.0, alat)
        .mul(float(1.0).sub(smoothstep(66.0, 80.0, alat)));
    const bl = cloudBoundaryLayer(altKm);
    const jetLat = exp(float(-1).mul(pow(alat.sub(40.0).div(14.0), 2.0)));
    const jetSpeed = select(latDeg.greaterThanEqual(0.0), float(38.0), float(48.0));
    const jetShape = exp(float(-1).mul(pow(altKm.sub(11.0).div(3.4), 2.0)))
        .mul(smoothstep(1.0, 5.0, altKm));
    const tropLat = exp(float(-1).mul(pow(latDeg.div(18.0), 2.0)));
    const tropShape = exp(float(-1).mul(pow(altKm.sub(14.5).div(3.0), 2.0)));
    return float(-6.5).mul(trade).mul(bl)
        .add(float(9.5).mul(west).mul(bl))
        .add(jetSpeed.mul(jetLat).mul(jetShape))
        .sub(float(22.0).mul(tropLat).mul(tropShape));
});

// The motion uniforms (owned by createCloudMotion in
// production) closed over the two field functions the shell
// calls.
export function createCloudWind(record) {
    const U = {
        uCloudTime: floatUniform(record, "uCloudTime"),
        uBeltShiftDeg: floatUniform(record, "uBeltShiftDeg"),
        uDeckAltitudeKm: floatUniform(record, "uDeckAltitudeKm"),
        uMidAltitudeKm: floatUniform(record, "uMidAltitudeKm"),
        uHighAltitudeKm: floatUniform(record, "uHighAltitudeKm"),
        uDiurnalAmp: floatUniform(record, "uDiurnalAmp"),
        uDiurnalPeakHour: floatUniform(record, "uDiurnalPeakHour")
    };

    // Displacement of the field where the air came from:
    // (turns of longitude, degrees of latitude). Applied by
    // subtracting it from the sample coordinate.
    const fieldOffset = Fn(([latDeg, altKm]) => {
        const metres = cloudEastWind(latDeg, altKm).mul(U.uCloudTime);
        const cosLat = max(cos(radians(latDeg)), 0.15);
        const turns = metres.div(40030000.0).div(cosLat);
        return vec2(turns.sub(floor(turns)), U.uBeltShiftDeg);
    });

    // Convective vigour at a longitude, as a function of
    // local solar time. One is the annual mean.
    const convectiveDiurnal = Fn(([lonTurns, sunLonTurns]) => {
        const hour = fract(lonTurns.sub(sunLonTurns).add(1.0)).mul(24.0);
        return float(1.0).add(U.uDiurnalAmp
            .mul(cos(hour.sub(U.uDiurnalPeakHour).mul(0.26179939))));
    });

    return { uniforms: U, fieldOffset, convectiveDiurnal };
}

// ---- pure shell helpers ---------------------------------------------------

// Two-lobe Henyey-Greenstein, the standard fit for a cloud
// droplet phase function.
export const cloudHg = Fn(([mu, g]) => {
    const g2 = g.mul(g);
    const d = float(1.0).add(g2).sub(float(2.0).mul(g).mul(mu));
    return float(1.0).sub(g2).div(float(12.5663706).mul(pow(max(d, 1e-4), 1.5)));
});

export const cloudPhase = Fn(([mu, lobes]) => {
    return mix(cloudHg(mu, lobes.x), cloudHg(mu, lobes.y), lobes.z);
});

// Interleaved gradient noise: the static per-pixel march
// offset. Takes GL-convention fragment coordinates.
export const cloudIgn = Fn(([p]) => {
    return fract(float(52.9829189).mul(fract(dot(p, vec2(0.06711056, 0.00583715)))));
});

// Local spherical frame: longitude in turns, colatitude in
// turns of PI, altitude above the body in km.
export const cloudLocalFrame = Fn(([p, centre, planetRadius, kmToWorld]) => {
    const d = p.sub(centre);
    const r = length(d);
    const altKm = r.sub(planetRadius).div(kmToWorld);
    return vec3(
        atan(d.x, d.z).mul(0.15915494309).add(0.5),
        acos(clamp(d.y.div(max(r, 1e-6)), -1.0, 1.0)).mul(0.31830988618),
        altKm
    );
});

// The longitude of the point below the sun, in turns.
export const cloudSubsolarLongitude = Fn(([sunDir]) => {
    return atan(sunDir.x, sunDir.z).mul(0.15915494309).add(0.5);
});

// How much of a detail octave survives at this footprint.
export const cloudDetailWeight = Fn(([tileKm, pixelKm]) => {
    const feature = tileKm.mul(0.015625);
    return float(1.0).sub(smoothstep(feature.mul(0.6), feature.mul(3.0), pixelKm));
});

// Two-stream reflectance of a conservatively scattering slab.
export const cloudReflectance = Fn(([tau]) => {
    return tau.div(tau.add(2.0));
});

// ---- the shell ------------------------------------------------------------

/**
 * Node-material counterpart of createCloudShell's material.
 *
 * @param {object} args
 * @param {object} args.T         the node-build THREE namespace
 * @param {object} args.uniforms  production-shaped {key:{value}}
 * @param {object} [args.install] deriveCloudShellInstall output
 *                                (material state; production's
 *                                constants when omitted)
 * @returns {{material, uniforms, wind, field}} the material,
 *   its uniform nodes by production key (per-frame writes go
 *   through these), the wind closure, and the field Fns.
 */
export function createCloudRaymarch({ T, uniforms: record, install = null }) {
    const volumeTexture = record?.uVolume?.value;
    const detailTexture = record?.uDetail?.value;
    if (!volumeTexture || !detailTexture) {
        throw new Error("createCloudRaymarch needs uVolume and uDetail textures (production returns no shell without a volume)");
    }
    let coverageTexture = record?.uCoverage?.value || null;
    if (!coverageTexture) {
        coverageTexture = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
        coverageTexture.format = T.RGBAFormat;
        coverageTexture.needsUpdate = true;
    }
    const vol = texture3D(volumeTexture);
    const det = texture3D(detailTexture);
    const cov = texture(coverageTexture);

    const wind = createCloudWind(record);
    const U = {
        ...wind.uniforms,
        uCenter: vec3Uniform(T, record, "uCenter", [0, 0, 0]),
        uSunDir: vec3Uniform(T, record, "uSunDir", [1, 0, 0]),
        uSunColor: vec3Uniform(T, record, "uSunColor", [1.0, 0.97, 0.93]),
        uWater: vec3Uniform(T, record, "uWater", [0, 0, 0]),
        uIce: vec3Uniform(T, record, "uIce", [0, 0, 0]),
        uShellRadius: floatUniform(record, "uShellRadius"),
        uPlanetRadius: floatUniform(record, "uPlanetRadius"),
        uKmToWorld: floatUniform(record, "uKmToWorld"),
        uSunIntensity: floatUniform(record, "uSunIntensity", 1.0),
        uMaxExtinction: floatUniform(record, "uMaxExtinction"),
        uMaxIceExtinction: floatUniform(record, "uMaxIceExtinction"),
        uTopKm: floatUniform(record, "uTopKm"),
        uSteps: floatUniform(record, "uSteps"),
        uLightSteps: floatUniform(record, "uLightSteps"),
        uLightDetail: floatUniform(record, "uLightDetail"),
        uStopT: floatUniform(record, "uStopT"),
        uMultiScatter: floatUniform(record, "uMultiScatter"),
        uAmbient: floatUniform(record, "uAmbient"),
        uAlbedo: floatUniform(record, "uAlbedo"),
        uLightFraction: floatUniform(record, "uLightFraction"),
        uEmpty: floatUniform(record, "uEmpty"),
        uMaxEmptyStep: floatUniform(record, "uMaxEmptyStep"),
        uPixelKm: floatUniform(record, "uPixelKm", 0.25),
        uStepGrowth: floatUniform(record, "uStepGrowth"),
        uMaxStepKm: floatUniform(record, "uMaxStepKm"),
        uAnisotropy: floatUniform(record, "uAnisotropy"),
        uWarpTileKm: floatUniform(record, "uWarpTileKm"),
        uWarpStrength: floatUniform(record, "uWarpStrength"),
        uCloseWarpTileKm: floatUniform(record, "uCloseWarpTileKm"),
        uCloseWarpKm: floatUniform(record, "uCloseWarpKm"),
        uCloseWarpFromKm: floatUniform(record, "uCloseWarpFromKm"),
        uCloseWarpToKm: floatUniform(record, "uCloseWarpToKm"),
        uDebug: floatUniform(record, "uDebug"),
        uOpacity: floatUniform(record, "uOpacity", 1.0)
    };

    // Macro extinction at a point, per metre: (water, ice,
    // genus feature size in km). `primary` selects the view
    // march's mask/close warps; the sun march samples the
    // unwarped field. Production's longitude out-parameter is
    // dead at both callers and is not returned.
    const macroExtinction = (primary) => Fn(([p, pixelKm]) => {
        const local = cloudLocalFrame(p, U.uCenter, U.uPlanetRadius, U.uKmToWorld);
        const latDeg = float(90.0).sub(local.y.mul(180.0));
        const advect = wind.fieldOffset(latDeg, local.z);
        const localKm = p.sub(U.uCenter).div(U.uKmToWorld);

        let closeWarp = float(0.0);
        if (primary) {
            const amount = select(
                U.uCloseWarpToKm.greaterThan(U.uCloseWarpFromKm),
                float(1.0).sub(smoothstep(U.uCloseWarpFromKm, U.uCloseWarpToKm, pixelKm)),
                float(0.0)
            );
            const n = det.sample(localKm.div(U.uCloseWarpTileKm).add(0.37)).r.sub(0.5);
            closeWarp = n.mul(amount);
        }
        const cosLat = max(cos(radians(latDeg)), 0.2);
        const warpLon = closeWarp.mul(U.uCloseWarpKm).div(40030.0).div(cosLat);
        const warpLat = closeWarp.mul(U.uCloseWarpKm).div(20015.0);
        const warpAlt = closeWarp.mul(U.uCloseWarpKm).mul(0.35);

        const sampleAlt = local.z.add(warpAlt);
        const v = vol.sample(vec3(
            local.x.sub(advect.x).add(warpLon),
            local.y.add(advect.y.div(180.0)).add(warpLat),
            sampleAlt.div(U.uTopKm)
        ));

        const uvWrappedLat = local.y.add(warpLat);
        const advectLow = wind.fieldOffset(latDeg, U.uDeckAltitudeKm);
        const advectMid = wind.fieldOffset(latDeg, U.uMidAltitudeKm);
        const advectHigh = wind.fieldOffset(latDeg, U.uHighAltitudeKm);
        const coverLow = cov.sample(vec2(
            local.x.sub(advectLow.x).add(warpLon),
            uvWrappedLat.add(advectLow.y.div(180.0)))).r;
        const coverMid = cov.sample(vec2(
            local.x.sub(advectMid.x).add(warpLon),
            uvWrappedLat.add(advectMid.y.div(180.0)))).g;
        const coverHigh = cov.sample(vec2(
            local.x.sub(advectHigh.x).add(warpLon),
            uvWrappedLat.add(advectHigh.y.div(180.0)))).b;
        const blendMid = smoothstep(1.8, 3.4, sampleAlt);
        const blendHigh = smoothstep(6.0, 9.5, sampleAlt);
        let coverage = mix(mix(coverLow, coverMid, blendMid), coverHigh, blendHigh);
        if (primary) {
            const warp = det.sample(localKm.div(U.uWarpTileKm)).r;
            coverage = coverage.add(warp.sub(0.5).mul(U.uWarpStrength));
        }
        const mask = smoothstep(0.22, 0.72, coverage);
        const diurnal = wind.convectiveDiurnal(local.x, cloudSubsolarLongitude(U.uSunDir));

        const result = vec3(
            v.r.mul(U.uMaxExtinction).mul(mask),
            v.g.mul(U.uMaxIceExtinction).mul(mask).mul(diurnal),
            max(0.5, v.b.mul(64.0))
        );
        const inBand = local.z.greaterThanEqual(0.05).and(local.z.lessThanEqual(U.uTopKm));
        return select(inBand, result, vec3(0.0));
    });
    const macroPrimary = macroExtinction(true);
    const macroSun = macroExtinction(false);

    // Extinction with detail eroded into the edges; returns
    // (extinction per metre, ice fraction) — production's
    // out-parameter as the second component.
    const extinctionAt = Fn(([p, pixelKm]) => {
        const macro = macroPrimary(p, pixelKm);
        const e = macro.x.add(macro.y);
        const iceFraction = select(e.greaterThan(0.0), macro.y.div(e), float(0.0));

        const tile = max(macro.z, 0.5);
        const t0 = tile;
        const t1 = tile.mul(0.34);
        const t2 = tile.mul(0.11);
        const w0 = cloudDetailWeight(t0, pixelKm);
        const w1 = cloudDetailWeight(t1, pixelKm).mul(0.55);
        const w2 = cloudDetailWeight(t2, pixelKm).mul(0.30);

        const localKm = p.sub(U.uCenter).div(U.uKmToWorld);
        let shape = mix(0.5, det.sample(localKm.div(t0)).r, w0);
        shape = mix(shape, det.sample(localKm.div(t1)).r, w1);
        shape = mix(shape, det.sample(localKm.div(t2)).r, w2);
        const keep = smoothstep(0.26, 0.58, shape);
        const eroded = e.mul(mix(1.0, keep, w0));
        const out = select(e.greaterThan(0.0),
            select(w0.greaterThan(0.0), eroded, e),
            float(0.0));
        return vec2(out, iceFraction);
    });

    // Optical depth toward the sun over a short march,
    // the step in metres because extinction is per metre.
    const sunOpticalDepth = Fn(([p, stepMetres, pixelKm]) => {
        const tau = float(0.0).toVar();
        const stepWorld = stepMetres.mul(U.uKmToWorld).mul(0.001);
        Loop(5, ({ i }) => {
            const stepIndex = i.toFloat().add(1.0);
            If(stepIndex.lessThanEqual(U.uLightSteps), () => {
                const q = p.add(U.uSunDir.mul(stepWorld).mul(stepIndex));
                const m = macroSun(q, pixelKm);
                const e0 = m.x.add(m.y);
                const w0 = cloudDetailWeight(max(m.z, 0.5), pixelKm).mul(U.uLightDetail);
                const localKm = q.sub(U.uCenter).div(U.uKmToWorld);
                const shape = mix(0.5, det.sample(localKm.div(max(m.z, 0.5))).r, w0);
                const shaded = e0.mul(mix(1.0, smoothstep(0.26, 0.58, shape), w0));
                const e = select(e0.greaterThan(0.0).and(w0.greaterThan(0.0)), shaded, e0);
                tau.assign(tau.add(e.mul(stepMetres)));
            });
        });
        return tau;
    });

    const march = Fn(() => {
        const ro = cameraPosition;
        const rd = normalize(positionWorld.sub(ro));

        // The shell, then the planet in front of its far side.
        const oc = ro.sub(U.uCenter);
        const b = dot(oc, rd);
        const c = dot(oc, oc).sub(U.uShellRadius.mul(U.uShellRadius));
        const hRaw = b.mul(b).sub(c);
        const shellHit = hRaw.greaterThanEqual(0.0);
        const h = sqrt(max(hRaw, 0.0));
        const tNear = max(0.0, b.negate().sub(h));
        const tFarShell = b.negate().add(h);
        const pc = dot(oc, oc).sub(U.uPlanetRadius.mul(U.uPlanetRadius));
        const ph = b.mul(b).sub(pc);
        const tp = b.negate().sub(sqrt(max(ph, 0.0)));
        const tFar = select(ph.greaterThan(0.0).and(tp.greaterThan(0.0)),
            min(tFarShell, tp), tFarShell);
        const marchValid = shellHit.and(tFar.greaterThan(tNear));

        const pixelKm = max(U.uPixelKm, 0.02);
        const stepKm = clamp(pixelKm.mul(1.5), 0.075, 2.5);
        const fragPx = vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y));
        const invKmToWorld = float(1.0).div(U.uKmToWorld);

        const stepLen = stepKm.mul(U.uKmToWorld).toVar();
        const t = tNear.add(stepLen.mul(cloudIgn(fragPx))).toVar();
        const scattered = vec3(0.0).toVar();
        const transmittance = float(1.0).toVar();
        const totalTau = float(0.0).toVar();
        const tauView = float(0.0).toVar();
        const reflectance = float(0.0).toVar();
        const previousEmpty = bool(false).toVar();
        const active = bool(true).toVar();
        const mu = dot(rd.negate(), U.uSunDir);

        Loop(128, ({ i }) => {
            If(i.toFloat().greaterThanEqual(U.uSteps).or(t.greaterThan(tFar)), () => {
                active.assign(false);
            });
            If(active, () => {
                const p = ro.add(rd.mul(t)).toVar();
                const ext = extinctionAt(p, pixelKm);
                const e = ext.x.toVar();
                const iceFrac = ext.y.toVar();
                const emptyStep = min(stepLen.mul(U.uEmpty),
                    max(stepLen, U.uMaxEmptyStep.mul(U.uKmToWorld)));
                const ds = select(e.greaterThan(0.0), stepLen, emptyStep);
                const slab = ds.toVar();
                const slabMetres = slab.mul(invKmToWorld).mul(1000.0).toVar();

                // A long step that ended in cloud started in
                // clear air: resample halfway back, exactly as
                // production does (its ice fraction is taken
                // either way, the sample only if it is cloud).
                If(e.greaterThan(0.0).and(previousEmpty), () => {
                    const pm = ro.add(rd.mul(t.sub(ds.mul(0.5))));
                    const extm = extinctionAt(pm, pixelKm);
                    iceFrac.assign(extm.y);
                    If(extm.x.greaterThan(0.0), () => {
                        p.assign(pm);
                        e.assign(extm.x);
                        slab.assign(ds.mul(0.5));
                        slabMetres.assign(slab.mul(invKmToWorld).mul(1000.0));
                    });
                });
                previousEmpty.assign(e.lessThanEqual(0.0));

                If(e.greaterThan(0.0), () => {
                    const tauSun = sunOpticalDepth(p,
                        slabMetres.mul(U.uLightFraction), pixelKm);
                    const up = normalize(p.sub(U.uCenter));
                    const stepTau = e.mul(slabMetres);
                    tauView.assign(tauView.add(stepTau));
                    const transport = float(1.0).sub(U.uAnisotropy);
                    const reflectanceNew = cloudReflectance(tauView.mul(transport));
                    // toVar() is load-bearing: a bare expression
                    // would materialise at its use sites below,
                    // after reflectance.assign() has already
                    // overwritten the value it must read -- the
                    // generated code then computes
                    // reflectanceNew - reflectanceNew (measured
                    // in the P5e22 shader dump).
                    const dReflectance = reflectanceNew.sub(reflectance).toVar();
                    reflectance.assign(reflectanceNew);
                    const lit = exp(tauSun.mul(transport).negate());
                    const cosSun = max(dot(up, U.uSunDir), 0.0);
                    const sunRadiance = U.uSunColor.mul(U.uSunIntensity).mul(U.uAlbedo)
                        .mul(float(1.0).div(3.14159265)).mul(cosSun).mul(lit).mul(dReflectance);
                    const forward = cloudPhase(mu, mix(U.uWater, U.uIce, iceFrac))
                        .mul(12.5663706).mul(U.uMultiScatter);
                    const forwardRadiance = U.uSunColor.mul(U.uSunIntensity).mul(U.uAlbedo)
                        .mul(forward).mul(lit).mul(transmittance)
                        .mul(float(1.0).sub(exp(stepTau.negate())));
                    const ambient = U.uSunColor.mul(U.uAmbient)
                        .mul(float(0.35).add(float(0.65).mul(clamp(
                            dot(up, U.uSunDir).mul(0.5).add(0.5), 0.0, 1.0))))
                        .mul(dReflectance);
                    totalTau.assign(totalTau.add(stepTau));
                    scattered.assign(scattered.add(sunRadiance.add(forwardRadiance).add(ambient)));
                    transmittance.assign(transmittance.mul(exp(stepTau.negate())));
                    If(transmittance.lessThan(U.uStopT), () => {
                        active.assign(false);
                    });
                });

                If(active, () => {
                    stepLen.assign(min(stepLen.mul(U.uStepGrowth),
                        U.uMaxStepKm.mul(U.uKmToWorld)));
                    t.assign(t.add(ds));
                });
            });
        });

        const alpha = float(1.0).sub(transmittance).mul(U.uOpacity);
        const cloud = vec4(scattered.mul(U.uOpacity), alpha);
        const kept = select(alpha.greaterThanEqual(0.003), cloud, vec4(0.0));
        const show = select(U.uDebug.lessThan(2.5),
            float(1.0).sub(transmittance),
            clamp(float(1.0).sub(exp(totalTau.negate())), 0.0, 1.0));
        const marched = select(marchValid,
            select(U.uDebug.greaterThan(1.5), vec4(show, show, show, 1.0), kept),
            vec4(0.0));
        const debugMagenta = U.uDebug.greaterThan(0.5).and(U.uDebug.lessThan(1.5));
        return select(debugMagenta, vec4(1.0, 0.0, 1.0, 1.0), marched);
    });

    const material = new T.MeshBasicNodeMaterial();
    material.colorNode = march();
    const state = install?.state || null;
    material.transparent = state ? state.transparent : true;
    material.depthWrite = state ? state.depthWrite : false;
    material.depthTest = state ? state.depthTest : false;
    material.blending = state ? state.blending : T.CustomBlending;
    material.blendSrc = state ? state.blendSrc : T.OneFactor;
    material.blendDst = state ? state.blendDst : T.OneMinusSrcAlphaFactor;
    material.side = state ? state.side : T.FrontSide;
    // NOT state.premultipliedAlpha: production sets the flag
    // true on its ShaderMaterial, where no output chunk acts
    // on it -- the raw march output reaches the explicit
    // One/OneMinusSrcAlpha blend unchanged. A node material
    // with the flag true instead premultiplies rgb by alpha
    // in its output stage on top of that (measured at P5e2;
    // re-measured here as a forward-term-shaped alpha
    // suppression), so the node material keeps it false.
    material.premultipliedAlpha = false;
    // The classic custom shader appends no tone-mapping or
    // output-conversion chunks, so its value reaches the
    // display chain raw; keep the node material the same.
    material.toneMapped = false;

    return {
        material,
        uniforms: U,
        wind,
        field: { macroPrimary, macroSun, extinctionAt, sunOpticalDepth, march }
    };
}

// ---- derivations ----------------------------------------------------------

/**
 * Read a production createCloudShell mesh — before its first
 * frame hook has overwritten the initial uniforms — into the
 * record + state createCloudRaymarch consumes, plus the
 * geometry/mesh/frame scalars the caller rebuilds with.
 */
export function deriveCloudShellInstall(mesh) {
    const material = mesh.material;
    const src = material.uniforms || {};
    const uniforms = {};
    for (const key of Object.keys(src)) uniforms[key] = { value: src[key]?.value };
    const planetRadius = src.uPlanetRadius?.value;
    const kmToWorld = src.uKmToWorld?.value;
    const shellRadius = src.uShellRadius?.value;
    const radiusKm = planetRadius / kmToWorld;
    return {
        uniforms,
        state: {
            transparent: material.transparent,
            depthWrite: material.depthWrite,
            depthTest: material.depthTest,
            blending: material.blending,
            blendSrc: material.blendSrc,
            blendDst: material.blendDst,
            side: material.side,
            premultipliedAlpha: material.premultipliedAlpha
        },
        geometry: {
            radius: mesh.geometry?.parameters?.radius,
            widthSegments: mesh.geometry?.parameters?.widthSegments,
            heightSegments: mesh.geometry?.parameters?.heightSegments
        },
        meshProps: {
            name: mesh.name,
            frustumCulled: mesh.frustumCulled,
            renderOrder: mesh.renderOrder
        },
        // The closure scalars the frame hook works from,
        // recovered from the initial uniform values
        // (uShellRadius = planetRadius * shellRadiusKm / radiusKm,
        // uKmToWorld = planetRadius / radiusKm).
        frame: {
            planetRadius,
            radiusKm,
            shellRadiusKm: shellRadius * radiusKm / planetRadius
        }
    };
}

/**
 * The mesh's per-frame hook, as pure arithmetic: centre and
 * radii from the world matrix, the pixel footprint from the
 * camera, the side flip at the shell crossing, and the sun
 * from the caller's resolved light (the scene scan itself
 * stays production JavaScript).
 *
 * @param {object} frame   deriveCloudShellInstall(...).frame
 * @param {object} input   {centre:{x,y,z}, maxScaleOnAxis,
 *   cameraPosition:{x,y,z}, drawingBufferHeight, fovDeg,
 *   wasInside, light: null | {position:{x,y,z},
 *   color:{r,g,b}, intensity}}
 */
export function deriveCloudShellFrame(frame, input) {
    const centre = input.centre;
    const planetWorld = frame.planetRadius * input.maxScaleOnAxis;
    const uShellRadius = planetWorld * frame.shellRadiusKm / frame.radiusKm;
    const uKmToWorld = planetWorld / frame.radiusKm;

    const dx = input.cameraPosition.x - centre.x;
    const dy = input.cameraPosition.y - centre.y;
    const dz = input.cameraPosition.z - centre.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const altitudeKm = Math.max(0, (distance - planetWorld) / uKmToWorld);
    const heightPx = Math.max(1, input.drawingBufferHeight);
    const fov = Number.isFinite(input.fovDeg) ? input.fovDeg : 45;
    const uPixelKm = Math.min(100, Math.max(0.01,
        Math.max(altitudeKm, 4) * 2 * Math.tan(fov * Math.PI / 360) / heightPx));

    const inside = distance < uShellRadius;
    const out = {
        uCenter: { x: centre.x, y: centre.y, z: centre.z },
        uShellRadius,
        uPlanetRadius: planetWorld,
        uKmToWorld,
        uPixelKm,
        altitudeKm,
        distance,
        inside,
        // THREE side constants: FrontSide 0, BackSide 1 — the
        // value to write when the crossing flips, else null.
        sideToApply: inside !== input.wasInside ? (inside ? 1 : 0) : null
    };
    if (input.light) {
        const sx = input.light.position.x - centre.x;
        const sy = input.light.position.y - centre.y;
        const sz = input.light.position.z - centre.z;
        const len = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
        out.uSunDir = { x: sx / len, y: sy / len, z: sz / len };
        out.uSunColor = {
            r: input.light.color.r, g: input.light.color.g, b: input.light.color.b
        };
        out.uSunIntensity = Math.min(1, input.light.intensity);
    }
    return out;
}
