// The display transform: the one place where linear scene radiance becomes a
// number in the framebuffer. Everything upstream of this file works in
// radiance; nothing downstream of it knows what radiance is.
//
// The curve is the reference's, copied as arithmetic, not as taste:
//
//     out = 1 - exp(-exposure * radiance)
//
// applied per channel, once, to the sum of the whole scene. There is no
// second transfer function after it. That is not an omission on our side --
// the reference writes these values straight into an 8-bit buffer, and its own
// overlays prove it: marks are anti-aliased in this domain by inverting the
// curve (`log(1 - d) * -1/exposure`) before the frame is toned again, and its
// dithering quantises to 1/256 of the *result*. An sRGB encode anywhere after
// the curve would break both.
//
// So this build does not gamma-encode its output either: see display-chain.js,
// which pins the renderer's output colour space to linear for exactly this
// reason. Mixing the two -- tone curve and sRGB transfer -- is the single most
// common way this pipeline ends up looking "close but wrong".

const DISPLAY_TONE_GLSL = `
// Per channel, once. The exposure scalar is the scene's one knob: the
// reference keeps it as a view setting, so it is a setting here too rather
// than a constant buried in the arithmetic.
vec3 displayToneMap(vec3 radiance, float exposure) {
    return vec3(1.0) - exp(-exposure * radiance);
}
`;

// The same curve on the CPU, for probes and for any code that has to reason
// about a pixel without a GPU. Kept adjacent to the GLSL so the two cannot
// drift apart unnoticed.
function displayToneMap(rgb, exposure) {
    return [0, 1, 2].map(i => 1 - Math.exp(-exposure * Math.max(rgb[i], 0)));
}

// The one scalar. It multiplies the whole scene's radiance before the curve,
// so it is the only thing that decides how bright the picture is; every
// relationship inside the image (air to ground, day to night, band to disc) is
// fixed upstream by the tables and does not move when this changes.
//
// Its default is not a taste call: it comes from the calibration probe
// (tools/tonecalib.mjs), which renders every body that has an atmosphere table
// at one fixed 5.6R / 62-degree phase framing, pools equal numbers of lit disc
// luminances from all seven, and solves for the value whose curve sits closest
// to the picture this build had before the display transform existed. The
// pooled fit is 3.531 over 150 591 samples (RMS 10.49 of 255 levels); the old
// Earth-only fit, 3.88, scored 12.86 on the same pool. Per-body fits range
// 3.12-4.39, which is the bodies' real brightness spread and is not normalised
// away: there is one display exposure, and per-body brightness stays upstream
// in the irradiance and the tables. No disc channel reaches 250 at this value.
// Change this number and the whole scene moves; change nothing else.
const DISPLAY_DEFAULT_EXPOSURE = 3.53;

globalThis.DISPLAY_TONE_GLSL = DISPLAY_TONE_GLSL;
globalThis.displayToneMap = displayToneMap;
globalThis.DISPLAY_DEFAULT_EXPOSURE = DISPLAY_DEFAULT_EXPOSURE;
