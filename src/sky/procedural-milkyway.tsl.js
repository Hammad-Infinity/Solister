// procedural-milkyway.tsl.js — TSL twin of the MILKYWAY_GLSL block that
// src/sky/procedural-milkyway.js generates from BAND (port step P5e10).
//
// The calibrated constants are imported from the classic file (BAND) and
// the noise-cell frequencies are recomputed with the exact same
// formulas and 5-decimal rounding the GLSL template uses, so every
// number stays single-source: editing BAND changes both shaders. The
// classic file's JS mirror (milkyWayDensityAlong, used by the star
// catalogue on the CPU) is not part of this port and stays where it is.
//
// Literal-translation notes (production semantics preserved, not
// "fixed"):
// - Every GLSL pow(x, 2.0) is a squaring multiply here. x is signed in
//   most of those calls; GLSL pow is technically undefined for x < 0
//   but every compiler that renders production computes x*x for a
//   constant exponent 2.0, while WGSL pow really does return NaN
//   there. The multiply is the only translation that reproduces
//   production's values on both backends.
// - The filament loop samples skyNoise with fl * 57.2958 where fl was
//   built from degrees * 0.017453 — i.e. degrees passed where radians
//   are used everywhere else (the CPU mirror converts properly and
//   therefore disagrees with the dome shader in the filament field
//   only; that inconsistency predates this port and is reproduced
//   as-is).
// - degrees()/radians()/asin/atan are the builtins on both sides.

import {
    Fn,
    If,
    Loop,
    abs,
    asin,
    atan,
    clamp,
    cos,
    degrees,
    exp,
    float,
    floor,
    fract,
    mat3,
    max,
    min,
    mix,
    normalize,
    pow,
    radians,
    sin,
    smoothstep,
    uniform,
    vec3
} from "three/tsl";
import { BAND } from "./procedural-milkyway.js";

const F = BAND;
const kLong = cellDeg => 360 / (2 * Math.PI * cellDeg);
const kLat = cellDeg => 180 / (Math.PI * cellDeg);
const N5 = v => Number(v.toFixed(5));
// The classic N table, index for index (procedural-milkyway.js).
const N = {
    warpL: N5(kLong(F.warp[1])), warpB: N5(kLat(F.warp[2])),
    filL: N5(kLong(F.filament[0])), filB: N5(kLat(F.filament[1])),
    cloudL: N5(kLong(F.cloud[0])), cloudB: N5(kLat(F.cloud[1])),
    wanderL: N5(kLong(11.8)), wanderB: N5(kLat(60)),
    raggedL: N5(kLong(5.1)), raggedB: N5(kLat(30)),
    grainL: N5(kLong(F.grain[0])), grainB: N5(kLat(F.grain[0])),
    blobL: N5(kLong(F.blob[3])), blobB: N5(kLat(F.blob[3] * 0.62)),
    cirrusL: N5(kLong(F.cirrus[2])), cirrusB: N5(kLat(F.cirrus[3])),
    veilL: N5(kLong(F.veil[2])), veilB: N5(kLat(F.veil[3])),
    riftL: N5(kLong(14)), riftB: N5(kLat(9))
};

function asFloatNode(value, fallback) {
    if (value === undefined) return float(fallback);
    return typeof value === "number" ? uniform(value) : value;
}

function asMat3Node(value) {
    if (value === undefined) {
        return mat3(
            vec3(1.0, 0.0, 0.0),
            vec3(0.0, 1.0, 0.0),
            vec3(0.0, 0.0, 1.0)
        );
    }
    if (Array.isArray(value) && value.length === 9) {
        return mat3(
            vec3(value[0], value[1], value[2]),
            vec3(value[3], value[4], value[5]),
            vec3(value[6], value[7], value[8])
        );
    }
    if (value?.isMatrix3) return uniform(value);
    return value;
}

const sq = v => v.mul(v);
const triple = a => vec3(a[0], a[1], a[2]);

// createMilkyWayBand -> { milkyWayBand }, the twin of the GLSL
// milkyWayBand(worldDir): scene direction in, linear colour out (the
// GLSL pow(d, 2.2) is part of the function, preserved). Options mirror
// the classic createMilkyWayUniforms(THREE) values: toGalactic
// (mat3/Matrix3/9-array; classic value: galacticFrame()), rhoZero
// (classic uRhoZero, default 1), dust (classic uDust, default 1).
export function createMilkyWayBand(options = {}) {
    const uToGalactic = asMat3Node(options.toGalactic);
    const uRhoZero = asFloatNode(options.rhoZero, 1.0);
    const uDust = asFloatNode(options.dust, 1.0);

    const cellHash = (p) => {
        const q = fract(
            p.mul(vec3(0.3183099, 0.3678794, 0.4142136)).add(vec3(0.11, 0.37, 0.73))
        ).mul(17.0).toVar();
        return fract(q.x.mul(q.y).mul(q.z).mul(q.x.add(q.y).add(q.z)));
    };

    const valueNoise = (p) => {
        const i = floor(p).toVar();
        const f0 = p.sub(i).toVar();
        const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0))).toVar();
        return mix(
            mix(
                mix(cellHash(i), cellHash(i.add(vec3(1.0, 0.0, 0.0))), f.x),
                mix(cellHash(i.add(vec3(0.0, 1.0, 0.0))), cellHash(i.add(vec3(1.0, 1.0, 0.0))), f.x),
                f.y
            ),
            mix(
                mix(cellHash(i.add(vec3(0.0, 0.0, 1.0))), cellHash(i.add(vec3(1.0, 0.0, 1.0))), f.x),
                mix(cellHash(i.add(vec3(0.0, 1.0, 1.0))), cellHash(i.add(vec3(1.0, 1.0, 1.0))), f.x),
                f.y
            ),
            f.z
        ).mul(2.0).sub(1.0);
    };

    const skyNoise = (kl, kb, lr, br) => valueNoise(vec3(
        float(kl).mul(cos(lr)),
        float(kl).mul(sin(lr)),
        float(kb).mul(br)
    ));

    const ridged = (n) => float(1.0).sub(abs(n));

    const bandEnvelope = (b) => {
        const x = b.sub(F.ridgeShift).toVar();
        const ax = abs(x).toVar();
        return float(F.env[0][0]).mul(exp(sq(x.div(F.env[0][1])).negate()))
            .add(float(F.env[1][0]).mul(exp(sq(x.div(F.env[1][1])).negate())))
            .add(float(F.knee[0]).mul(exp(pow(ax.div(F.knee[1]), float(F.knee[2])).negate())))
            .add(float(F.tail[0]).mul(exp(ax.div(F.tail[1]).negate())));
    };

    const LONG_COS = Number((Math.PI / 360).toFixed(8));
    const bandLongitude = (l) => float(1.0)
        .add(float(F.centre[0]).mul(exp(sq(l.div(F.centre[1])).negate())))
        .add(float(F.centre[2]).mul(cos(l.mul(LONG_COS))));

    const meanTransmittance = (b) => {
        const ab = abs(b).toVar();
        return float(1.0)
            .sub(float(F.meanT[0][0]).mul(exp(sq(b.div(F.meanT[0][1])).negate())))
            .sub(float(F.meanT[1][0]).mul(exp(sq(b.div(F.meanT[1][1])).negate())))
            .sub(float(F.meanT[2][0]).mul(exp(pow(ab.div(F.meanT[2][1]), float(F.meanT[2][2])).negate())));
    };

    const bandTransmittance = Fn(([l, b, lr, br]) => {
        const wu = skyNoise(N.warpL, N.warpB, lr, br).toVar();
        const wv = skyNoise(N.warpL * 2.3, N.warpB * 2.1, lr, br.add(2.7)).toVar();
        const lu = l.add(wu.mul(F.warp[0] * 6).add(wv.mul(F.warp[0] * 2))).toVar();
        const lb = b.add(wu.mul(F.warp[0] * 1.2).add(wv.mul(F.warp[0] * 0.5))).toVar();
        const wander = float(F.lane[2])
            .mul(skyNoise(N.wanderL, N.wanderB, lr, br.add(1.3))).mul(2.0).toVar();
        const ragged = float(1.0)
            .sub(float(F.lane[3]).mul(skyNoise(N.raggedL, N.raggedB, lr, br.add(4.1))).mul(2.0)).toVar();
        const side = float(F.lane[4]).toVar();
        If(b.lessThan(0.0), () => {
            side.assign(float(F.lane[5]));
        });
        const lane = float(F.lane[0]).mul(side).mul(ragged)
            .mul(exp(sq(b.sub(wander).div(F.lane[1])).negate())).toVar();
        const filament = float(0.0).toVar();
        const amplitude = float(1.0).toVar();
        const deg2rad = Number((1 / 57.2958).toFixed(6));
        const fl = lu.mul(deg2rad).toVar();
        const fb = lb.mul(deg2rad).toVar();
        Loop(F.filament[2], ({ i }) => {
            const k = pow(float(2.0), float(i)).toVar();
            const n = ridged(skyNoise(
                float(N.filL).mul(k), float(N.filB).mul(k),
                fl.mul(57.2958), fb.mul(57.2958)
            )).toVar();
            filament.addAssign(amplitude.mul(
                pow(max(float(0.0), n.sub(0.25)).div(0.75), float(1.5))
            ));
            amplitude.mulAssign(float(F.filament[3]));
        });
        const height = exp(sq(b.div(F.filament[5])).negate());
        const blobN = skyNoise(N.blobL, N.blobB, lr, br.add(6.1)).toVar();
        const blob = float(F.blob[0])
            .mul(smoothstep(float(F.blob[1]), float(1.0), blobN))
            .mul(exp(sq(b.div(F.blob[2])).negate())).mul(uDust).toVar();
        const cirrus = smoothstep(float(0.25), float(0.95), skyNoise(N.cirrusL, N.cirrusB, lr, br.add(8.3)));
        const tau = lane.add(float(F.filament[4]).mul(filament).mul(height).mul(side))
            .mul(uDust).add(blob)
            .add(float(F.cirrus[0]).mul(cirrus).mul(exp(sq(b.div(F.cirrus[1])).negate())).mul(uDust)).toVar();
        return max(float(0.02), float(1.0).sub(min(float(0.96), tau)));
    });

    const bandGrain = (lr, br, b) => {
        const n = skyNoise(N.grainL, N.grainB, lr, br).toVar();
        const m = skyNoise(N.grainL * 2.7, N.grainB * 2.3, lr, br.add(1.9)).toVar();
        const k = max(float(0.0), n.mul(0.65).add(m.mul(0.35))).toVar();
        return float(F.grain[1]).mul(k).mul(exp(sq(b.div(F.grain[2])).negate()));
    };

    const bandVeil = (lr, br, b) => {
        const n = skyNoise(N.veilL, N.veilB, lr, br).toVar();
        const m = skyNoise(N.veilL * 2.3, N.veilB * 2.1, lr, br.add(5.7)).toVar();
        return triple(F.veil[4]).mul(float(F.veil[0])
            .mul(n.mul(0.7).add(m.mul(0.3)).add(0.45))
            .mul(smoothstep(float(12.0), float(F.veil[1]), abs(b))));
    };

    const bandClouds = (lr, br, b) => {
        const a = skyNoise(N.cloudL, N.cloudB, lr, br).toVar();
        const c = skyNoise(N.cloudL * 2.2, N.cloudB * 2.4, lr, br.add(3.9)).toVar();
        return float(F.cloud[2]).mul(a.mul(1.25).add(c.mul(0.75))).mul(2.0)
            .mul(exp(sq(b.div(F.cloud[3])).negate()));
    };

    const bandWarm = (l, b) => exp(sq(b.div(F.warm[0])).negate())
        .mul(float(0.78).add(
            float(F.warm[1]).mul(exp(sq(l.div(F.warm[2])).negate()))
        ));

    const milkyWayShoulder = (d) => {
        const knee = float(0.55);
        const over = max(d.sub(knee), vec3(0.0, 0.0, 0.0)).toVar();
        return min(d, vec3(0.55, 0.55, 0.55))
            .add(float(1.0).sub(knee).mul(
                float(1.0).sub(exp(over.div(float(1.0).sub(knee)).negate()))
            ));
    };

    const milkyWayTarget = Fn(([dir]) => {
        const g = uToGalactic.mul(dir).toVar();
        const b = degrees(asin(clamp(g.z, float(-1.0), float(1.0)))).toVar();
        const l = degrees(atan(g.y, g.x)).toVar();
        const lr = radians(l).toVar();
        const br = radians(b).toVar();
        const ratio = min(float(1.35), bandTransmittance(l, b, lr, br).div(meanTransmittance(b))).toVar();
        const rift = float(1.0).sub(float(F.rift[0])
            .mul(exp(sq(b.div(F.rift[1])).negate()))
            .mul(float(1.0).sub(F.rift[2]).add(
                float(F.rift[2]).mul(skyNoise(N.riftL, N.riftB, lr, br))
            ))).toVar();
        const light = float(F.gain).mul(bandEnvelope(b)).mul(bandLongitude(l))
            .mul(ratio).mul(rift)
            .mul(float(1.0).add(bandClouds(lr, br, b)).add(bandGrain(lr, br, b))).toVar();
        const w = bandWarm(l, b).toVar();
        const warm = triple(F.warmTint).mul(w)
            .add(triple(F.coolTint).mul(float(1.0).sub(w))).toVar();
        const coreGlow = float(F.bulge[0])
            .mul(exp(sq(l.div(F.bulge[1])).negate()))
            .mul(exp(sq(b.div(F.bulge[1] * 0.62)).negate())).toVar();
        const sky = triple(F.pedestal)
            .add(light.mul(warm).mul(uRhoZero))
            .add(bandVeil(lr, br, b).mul(uRhoZero))
            .add(triple(F.bulge[2]).mul(coreGlow).mul(uRhoZero)).toVar();
        return milkyWayShoulder(sky);
    });

    const milkyWayBand = Fn(([worldDir]) => {
        const d = clamp(
            milkyWayTarget(normalize(worldDir)),
            vec3(0.0, 0.0, 0.0), vec3(1.0, 1.0, 1.0)
        ).toVar();
        return pow(d, vec3(2.2, 2.2, 2.2));
    });

    return { milkyWayBand };
}
