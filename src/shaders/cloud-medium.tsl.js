import { Fn, float, max, mix, sqrt, exp } from "three/tsl";

// TSL counterpart of cloud-medium.glsl.js.
//
// The Earth cloud deck is a participating medium, not a painted sheet:
// coverage fills a shell, extinction turns the chord through that shell into
// optical depth, and optical depth into transmittance. This module is the
// node-material form of that one source of truth for the P3/P4 port. Keep the
// arithmetic identical to CLOUD_MEDIUM_GLSL; tools/p3cloudmedium.mjs renders
// both forms and compares the frames.

export const CLOUD_DECK_THICKNESS_KM = 5;
export const CLOUD_EXTINCTION_PER_KM = 0.32; // 3.2e-4 /m

// Chord, in km, through a shell whose outer surface the ray leaves at
// cos(zenith) = mu. Spherical outside the deck; flat-layer limit under it,
// where the shell is 5 km thick and the horizon is not in play.
export const cloudChord = Fn(([mu, shell, inside]) => {
    const thickness = max(shell.x.sub(shell.y), float(0.001));
    const b = shell.x.mul(mu);
    const disc = b.mul(b).sub(shell.x.mul(shell.x).sub(shell.y.mul(shell.y)));
    const spherical = max(b.sub(sqrt(max(disc, float(0.0)))), thickness);
    return mix(spherical, thickness.div(max(mu, float(0.08))), inside);
});

// Beer-Lambert. Coverage scales how much of the shell is filled, so a thin
// wisp seen edge-on ends up as opaque as a thick one, with no clamp and no
// bright rim: once the chord is long enough the transmittance is simply zero.
export const cloudTransmittance = Fn(([coverage, chordKm, extinctionKm]) => {
    const opticalDepth = extinctionKm.mul(max(coverage, float(0.0))).mul(chordKm);
    return exp(opticalDepth.mul(-1.0));
});
