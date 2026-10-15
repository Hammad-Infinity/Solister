const LOG_DEPTH_GUARD = "#ifdef USE_LOGDEPTHBUF";

export const LDB_VERTEX_PARS = "\n" + LOG_DEPTH_GUARD + "\n#ifdef USE_LOGDEPTHBUF_EXT\nvarying float vLDBDepth;\nvarying float vLDBPerspective;\n#else\nuniform float logDepthBufFC;\n#endif\n#endif\n";

export const LDB_VERTEX_TAIL = "\n#ifdef USE_LOGDEPTHBUF\n#ifdef USE_LOGDEPTHBUF_EXT\nvLDBDepth = 1.0 + gl_Position.w;\nvLDBPerspective = isOrthographic ? 0.0 : 1.0;\n#else\nif (!isOrthographic) {\n    gl_Position.z = log2(max(1e-6, gl_Position.w + 1.0)) * logDepthBufFC - 1.0;\n    gl_Position.z *= gl_Position.w;\n}\n#endif\n#endif\n";

export const LDB_FRAGMENT_PARS = "\n#ifdef USE_LOGDEPTHBUF\n#ifdef USE_LOGDEPTHBUF_EXT\nuniform float logDepthBufFC;\nvarying float vLDBDepth;\nvarying float vLDBPerspective;\n#endif\n#endif\n";

export const LDB_FRAGMENT_HEAD = "\n#ifdef USE_LOGDEPTHBUF\n#ifdef USE_LOGDEPTHBUF_EXT\ngl_FragDepthEXT = vLDBPerspective == 0.0 ? gl_FragCoord.z : log2(vLDBDepth) * logDepthBufFC * 0.5;\n#endif\n#endif\n";

globalThis.LDB_VERTEX_PARS = LDB_VERTEX_PARS;

globalThis.LDB_VERTEX_TAIL = LDB_VERTEX_TAIL;

globalThis.LDB_FRAGMENT_PARS = LDB_FRAGMENT_PARS;

globalThis.LDB_FRAGMENT_HEAD = LDB_FRAGMENT_HEAD;
