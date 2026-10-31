# three r186 — production WebGL set (P1) + P0 WebGPU files

Official three.js **0.186.1** builds (`REVISION = '186'`):

- `three.core.js`
- `three.module.js` (`three`) — **loaded by the production app in P1**
- `three.webgpu.js` (`three/webgpu`) — P0 harness only for now
- `three.tsl.js` (`three/tsl`) — P0 harness only for now
- `addons/` — the exact addon files the old r160 bundle exposed as globals:
  OrbitControls, CSS2DRenderer/CSS2DObject and KTX2Loader, with their closed
  dependency set (WorkerPool, ktx-parse, zstddec, ColorSpaces and the basis
  transcoder under `addons/libs/basis/`)
- `LICENSE`

As of P1, `index.html` maps `three` and `three/addons/` to this directory and
`src/app/three-runtime.js` installs the same globals the r160 bundle used to
provide. That bundle was deleted at P1 closure (r86) after the existing gate
passed unchanged on r186; nothing in production or the migrated test pages
loads it. The app still creates **`THREE.WebGLRenderer`** everywhere; no
production code imports `three/webgpu` or `three/tsl` yet. Those two builds
remain for `tests/p0-webgpu.html` / the later backend-neutral renderer step.
