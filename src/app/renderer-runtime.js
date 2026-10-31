import * as THREE from "three";

// P2 renderer seam.
//
// This module is the only place that chooses a drawing backend. Callers ask
// for "webgl", "webgpu" or "auto" (normally from ?renderer=...) and receive
// one renderer on one canvas plus a plain-data description of what was
// actually created. Materials never branch on the result: they are either
// the current GLSL material set, which requires the legacy WebGL renderer,
// or a node/TSL material set, which can run on WebGPURenderer's WebGPU and
// WebGL backends. The nodeMaterialsReady flag is therefore a property of
// the material system the caller is about to use, not a per-material switch.
//
// Production passes nodeMaterialsReady:false until the shader port lands.
// In that state every request resolves to the existing WebGLRenderer path,
// with the same two context configurations the app has always retried, and
// the returned info records why a WebGPU request was not honoured yet.

export const SOLISTER_RENDERER_REQUESTS = Object.freeze(["webgl", "webgpu", "auto"]);

const LEGACY_WEBGL_CONFIGURATIONS = Object.freeze([
    Object.freeze({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        stencil: true,
        logarithmicDepthBuffer: true,
        failIfMajorPerformanceCaveat: false
    }),
    Object.freeze({
        // No MSAA, no stencil, default adapter, standard depth buffer: the
        // combination older drivers and software rasterisers accept.
        antialias: false,
        alpha: false,
        powerPreference: "default",
        stencil: false,
        logarithmicDepthBuffer: false,
        failIfMajorPerformanceCaveat: false
    })
]);

export function normalizeRendererRequest(value, fallback = "webgl") {
    const raw = value === null || value === undefined ? "" : String(value).trim().toLowerCase();
    if (raw === "webgl" || raw === "webgl2") return "webgl";
    if (raw === "webgpu" || raw === "gpu") return "webgpu";
    if (raw === "auto") return "auto";
    return SOLISTER_RENDERER_REQUESTS.includes(fallback) ? fallback : "webgl";
}

export function rendererRequestFromSearch(search) {
    let params = null;
    if (search && typeof search.get === "function") {
        params = search;
    } else if (typeof search === "string") {
        params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    } else if (search && typeof search.search === "string") {
        params = new URLSearchParams(search.search.startsWith("?") ? search.search.slice(1) : search.search);
    } else if (typeof globalThis !== "undefined" && globalThis.location?.search) {
        params = new URLSearchParams(globalThis.location.search.slice(1));
    }
    const value = params?.get("renderer");
    return { requestedBackend: normalizeRendererRequest(value), requestedValue: value ?? null };
}

function makeInfo(fields) {
    return Object.freeze({
        requestedBackend: fields.requestedBackend,
        requestedValue: fields.requestedValue ?? null,
        actualBackend: fields.actualBackend ?? null,
        rendererKind: fields.rendererKind ?? null,
        threeBackendName: fields.threeBackendName ?? null,
        threeBackendIsWebGL: fields.threeBackendIsWebGL === true,
        threeBackendIsWebGPU: fields.threeBackendIsWebGPU === true,
        nodeMaterialsReady: fields.nodeMaterialsReady === true,
        fallbackReason: fields.fallbackReason ?? null,
        configIndex: Number.isInteger(fields.configIndex) ? fields.configIndex : null,
        blocked: fields.blocked === true,
        error: fields.error ? String(fields.error.message || fields.error) : null
    });
}

function makeHandle(fields) {
    const info = makeInfo(fields);
    return {
        renderer: fields.renderer ?? null,
        canvas: fields.renderer?.domElement ?? fields.canvas ?? null,
        error: fields.error ?? null,
        blocked: fields.blocked === true,
        configIndex: Number.isInteger(fields.configIndex) ? fields.configIndex : null,
        info
    };
}

function createLegacyWebGLHandle({ requestedBackend, requestedValue, canvas, makeCanvas, nodeMaterialsReady }) {
    const fallbackReason = requestedBackend === "webgl" ? null : "material-system-not-node-ready";
    // Context attributes cannot be renegotiated on a canvas that has already
    // produced a context, so the two-configuration retry owns canvas
    // creation. A caller-supplied canvas gets the primary configuration.
    const attempts = canvas ? 1 : LEGACY_WEBGL_CONFIGURATIONS.length;
    let lastMessage = "";
    let blocked = false;

    for (let i = 0; i < attempts; i++) {
        const attemptCanvas = canvas || makeCanvas();
        let creationMessage = "";
        const onCreationError = (event) => {
            creationMessage = (event && event.statusMessage) || "";
            event.preventDefault?.();
        };
        attemptCanvas.addEventListener("webglcontextcreationerror", onCreationError, false);
        let candidate = null;
        try {
            candidate = new THREE.WebGLRenderer({ ...LEGACY_WEBGL_CONFIGURATIONS[i], canvas: attemptCanvas });
        } catch (error) {
            lastMessage = creationMessage || (error && error.message) || "context creation failed";
        }
        attemptCanvas.removeEventListener("webglcontextcreationerror", onCreationError, false);

        if (candidate) {
            if (i > 0 && typeof console !== "undefined" && console.info) {
                console.info("[Solister] using the reduced WebGL configuration (no MSAA, no stencil, standard depth buffer).");
            }
            return makeHandle({
                renderer: candidate,
                canvas: attemptCanvas,
                requestedBackend,
                requestedValue,
                actualBackend: "webgl",
                rendererKind: "WebGLRenderer",
                threeBackendName: null,
                threeBackendIsWebGL: false,
                threeBackendIsWebGPU: false,
                nodeMaterialsReady,
                fallbackReason,
                configIndex: i,
                blocked: false,
                error: null
            });
        }

        blocked = /block|context loss|too many/i.test(lastMessage);
        if (blocked) {
            // Do not ask again: every request compounds the browser's block.
            console.warn("[Solister] the browser refused a WebGL context (" + lastMessage + "); not retrying.");
            break;
        }
    }

    return makeHandle({
        renderer: null,
        canvas,
        requestedBackend,
        requestedValue,
        actualBackend: null,
        rendererKind: "WebGLRenderer",
        nodeMaterialsReady,
        fallbackReason,
        configIndex: null,
        blocked,
        error: new Error(lastMessage || "the browser refused a WebGL context")
    });
}

async function createNodeRendererHandle({ requestedBackend, requestedValue, canvas, makeCanvas, options }) {
    const attemptCanvas = canvas || makeCanvas();
    let renderer = null;
    try {
        const { WebGPURenderer } = await import("three/webgpu");
        renderer = new WebGPURenderer({
            canvas: attemptCanvas,
            antialias: options.antialias ?? true,
            alpha: options.alpha ?? false,
            depth: options.depth ?? true,
            stencil: options.stencil ?? true,
            logarithmicDepthBuffer: options.logarithmicDepthBuffer ?? false,
            powerPreference: options.powerPreference ?? "high-performance",
            forceWebGL: requestedBackend === "webgl"
        });
        await renderer.init();
    } catch (error) {
        try { renderer?.dispose?.(); } catch { /* the creation error is the useful one */ }
        return makeHandle({
            renderer: null,
            canvas: attemptCanvas,
            requestedBackend,
            requestedValue,
            actualBackend: null,
            rendererKind: "WebGPURenderer",
            nodeMaterialsReady: true,
            fallbackReason: null,
            blocked: false,
            error
        });
    }

    const backend = renderer.backend || null;
    const threeBackendIsWebGPU = backend?.isWebGPUBackend === true;
    const threeBackendIsWebGL = backend?.isWebGLBackend === true;
    const actualBackend = threeBackendIsWebGPU ? "webgpu" : "webgl";
    return makeHandle({
        renderer,
        canvas: attemptCanvas,
        requestedBackend,
        requestedValue,
        actualBackend,
        rendererKind: "WebGPURenderer",
        threeBackendName: backend?.constructor?.name || null,
        threeBackendIsWebGL,
        threeBackendIsWebGPU,
        nodeMaterialsReady: true,
        fallbackReason: requestedBackend !== "webgl" && !threeBackendIsWebGPU ? "webgpu-unavailable" : null,
        configIndex: null,
        blocked: false,
        error: null
    });
}

export async function createSolisterRenderer(options = {}) {
    const fromSearch = rendererRequestFromSearch(options.search);
    const requestedBackend = normalizeRendererRequest(options.requestedBackend ?? options.backend ?? fromSearch.requestedBackend);
    const requestedValue = options.requestedValue ?? fromSearch.requestedValue;
    const nodeMaterialsReady = options.nodeMaterialsReady === true;
    const makeCanvas = typeof options.makeCanvas === "function"
        ? options.makeCanvas
        : () => document.createElement("canvas");

    if (!nodeMaterialsReady) {
        return createLegacyWebGLHandle({
            requestedBackend,
            requestedValue,
            canvas: options.canvas || null,
            makeCanvas,
            nodeMaterialsReady
        });
    }

    return createNodeRendererHandle({
        requestedBackend,
        requestedValue,
        canvas: options.canvas || null,
        makeCanvas,
        options
    });
}
