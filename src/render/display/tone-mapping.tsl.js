import { Fn, exp, float, vec3 } from "three/tsl";

// TSL counterpart of DISPLAY_TONE_GLSL in tone-mapping.js.
//
// The arithmetic is the display transform and nothing else: one exponential
// curve, per channel, applied once to scene radiance after any glow has been
// added. There is deliberately no clamp here. The production shader form does
// not clamp negative radiance (the CPU helper is only for probes that ask
// about physical pixels), and changing that in the node port would be a
// display change rather than a port.

export const displayToneMap = Fn(([radiance, exposure]) => {
    return vec3(1.0, 1.0, 1.0).sub(exp(radiance.mul(exposure).mul(float(-1.0))));
});

// Kept with the curve for the same reason the classic file keeps its CPU and
// shader forms adjacent: tools/p5displaychain.mjs asserts this still equals
// production's DISPLAY_DEFAULT_EXPOSURE, so the calibrated 3.53 cannot drift
// between the two material systems while both exist.
export const DISPLAY_DEFAULT_EXPOSURE = 3.53;
