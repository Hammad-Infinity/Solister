// Shared logarithmic-depth chunks for production ShaderMaterials,
// mirroring three r186's own logdepthbuf chunks (same depth
// curve, so custom shaders depth-test correctly against built-in
// materials). The renderer feeds logDepthBufFC to every program
// when the logarithmic depth buffer capability is on.
//
// P5d1 fix: these chunks previously guarded on USE_LOGDEPTHBUF /
// USE_LOGDEPTHBUF_EXT, which three renamed to
// USE_LOGARITHMIC_DEPTH_BUFFER; under r186 every consumer
// silently fell back to linear depth while built-in materials
// kept logarithmic depth (measured at P5c14, proved by
// tools/p5logdepth.mjs: a shell at 1.002 radii won zero disc
// pixels against a log-depth sphere). The WebGL1-era fallback
// (vertex-z remapping without fragment depth) is dropped, as
// r186 itself dropped it; the varying names and the
// isOrthographic ternary are production's own, unchanged.
const LOG_DEPTH_GUARD = "#ifdef USE_LOGARITHMIC_DEPTH_BUFFER";

export const LDB_VERTEX_PARS = "\n" + LOG_DEPTH_GUARD + "\nvarying float vLDBDepth;\nvarying float vLDBPerspective;\n#endif\n";

export const LDB_VERTEX_TAIL = "\n#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\nvLDBDepth = 1.0 + gl_Position.w;\nvLDBPerspective = isOrthographic ? 0.0 : 1.0;\n#endif\n";

export const LDB_FRAGMENT_PARS = "\n#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\nuniform float logDepthBufFC;\nvarying float vLDBDepth;\nvarying float vLDBPerspective;\n#endif\n";

export const LDB_FRAGMENT_HEAD = "\n#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\ngl_FragDepth = vLDBPerspective == 0.0 ? gl_FragCoord.z : log2(vLDBDepth) * logDepthBufFC * 0.5;\n#endif\n";

globalThis.LDB_VERTEX_PARS = LDB_VERTEX_PARS;

globalThis.LDB_VERTEX_TAIL = LDB_VERTEX_TAIL;

globalThis.LDB_FRAGMENT_PARS = LDB_FRAGMENT_PARS;

globalThis.LDB_FRAGMENT_HEAD = LDB_FRAGMENT_HEAD;
