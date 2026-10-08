// Logarithmic-depth support snippets for custom ShaderMaterials.
//
// The renderer runs with logarithmicDepthBuffer enabled (see src/app/state.js):
// that is the permanent fix for Z-fighting at the simulator's real-scale
// far/near ratio (~1e14), where a linear 24-bit depth buffer collapses every
// distant surface onto the same depth value.
//
// three.js only injects its logdepthbuf shader chunks into its built-in
// materials. Custom ShaderMaterials must write gl_FragDepth themselves,
// otherwise their depth TESTS compare linearly-encoded values against a
// log-encoded buffer and their depth WRITES corrupt it. These four snippets
// are concatenated into every custom shader in the project:
//   LDB_VERTEX_PARS   declare the varying (vertex, global scope)
//   LDB_VERTEX_TAIL   capture 1+w after gl_Position (end of vertex main)
//   LDB_FRAGMENT_PARS declare uniform+varying (fragment, global scope)
//   LDB_FRAGMENT_HEAD write log depth (first line of fragment main)
// Everything is guarded, so the shaders compile and fall back gracefully on
// renderers/builds without the EXT frag-depth path.
const GUARD = '#if defined(USE_LOGDEPTHBUF) && defined(USE_LOGDEPTHBUF_EXT)';
export const LDB_VERTEX_PARS = '\n' + GUARD + '\nvarying float vLDBDepth;\n#endif\n';
export const LDB_VERTEX_TAIL = '\n' + GUARD + '\nvLDBDepth=1.0+gl_Position.w;\n#endif\n';
export const LDB_FRAGMENT_PARS = '\n' + GUARD + '\nuniform float logDepthBufFC;\nvarying float vLDBDepth;\n#endif\n';
export const LDB_FRAGMENT_HEAD = '\n' + GUARD + '\ngl_FragDepth=log2(vLDBDepth)*logDepthBufFC*0.5;\n#endif\n';

// Classic scripts (bootstrap.js loads earth-atmosphere.glsl.js, sun-factory.js
// and belt-factory.js as plain <script> tags) cannot use `import`, so the same
// constants are also published on globalThis. ES modules evaluate before the
// bootstrap script tags run, so these globals are always ready in time.
globalThis.LDB_VERTEX_PARS = LDB_VERTEX_PARS;
globalThis.LDB_VERTEX_TAIL = LDB_VERTEX_TAIL;
globalThis.LDB_FRAGMENT_PARS = LDB_FRAGMENT_PARS;
globalThis.LDB_FRAGMENT_HEAD = LDB_FRAGMENT_HEAD;
