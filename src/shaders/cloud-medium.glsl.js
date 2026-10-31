// The Earth cloud deck is a participating medium, not a painted sheet.
//
// A sheet has opacity. A medium has optical depth: coverage fills a shell,
// extinction turns the chord the ray takes through that shell into optical
// depth, and optical depth into transmittance. The difference is visible at
// the limb, where the same wisp is a hundred times longer on the slant than it
// is face-on, and under the deck, where the layer is locally flat.
//
// One source of truth. The material patch and tools/cld1.mjs both read this.
const CLOUD_DECK_THICKNESS_KM = 5;
const CLOUD_EXTINCTION_PER_KM = .32;          // 3.2e-4 /m

const CLOUD_MEDIUM_GLSL = `
// Chord, in km, through a shell whose outer surface the ray leaves at
// cos(zenith) = mu. Spherical outside the deck; flat-layer limit under it,
// where the shell is 5 km thick and the horizon is not in play.
float cloudChord(float mu, vec2 shell, float inside) {
    float thickness = max(shell.x - shell.y, 1e-3);
    float b = shell.x * mu;
    float disc = b * b - (shell.x * shell.x - shell.y * shell.y);
    float spherical = max(b - sqrt(max(disc, 0.0)), thickness);
    return mix(spherical, thickness / max(mu, .08), inside);
}
// Beer-Lambert. Coverage scales how much of the shell is filled, so a thin
// wisp seen edge-on ends up as opaque as a thick one, with no clamp and no
// bright rim: once the chord is long enough the transmittance is simply zero.
float cloudTransmittance(float coverage, float chordKm, float extinctionKm) {
    return exp(-extinctionKm * max(coverage, 0.0) * chordKm);
}
`;
