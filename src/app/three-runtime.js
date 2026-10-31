import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

// P1 keeps the production app on WebGLRenderer; it only moves the library
// underneath it from the old r160 global bundle to the vendored r186 module
// build. The classic scripts loaded by bootstrap still read these names from
// globalThis, so this module is imported first by main.js and installs the
// same four globals the r160 bundle used to provide. Later renderer work can
// replace this compatibility seam with explicit imports.
globalThis.THREE = THREE;
globalThis.OrbitControls = OrbitControls;
globalThis.CSS2DObject = CSS2DObject;
globalThis.CSS2DRenderer = CSS2DRenderer;
globalThis.KTX2Loader = KTX2Loader;

export { THREE, OrbitControls, CSS2DObject, CSS2DRenderer, KTX2Loader };
