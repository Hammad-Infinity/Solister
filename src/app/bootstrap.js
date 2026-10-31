import { createSolisterRenderer } from "./renderer-runtime.js";

const scripts = [ "../shaders/cloud-medium.glsl.js", "../audio/audio-manager.js", "../ui/loading-screen.js", "../render/weather/climate.js", "../render/weather/thermodynamics.js", "../render/weather/storms.js", "../render/weather/weather-field.js", "../render/clouds/cloud-field.js", "../render/clouds/cloud-types.js", "../render/clouds/cloud-volume.js", "../render/clouds/cloud-motion.js", "../render/clouds/cloud-raymarch.js", "../render/clouds/cloud-lod.js", "../render/procedural-textures.js", "../render/terra-bake.js", "../render/texture-pipeline.js", "../render/brdf/surface-brdf.js", "../shaders/eclipse.glsl.js", "../shaders/single-glow.glsl.js", "../render/atmosphere/transmittance-table.js", "../render/atmosphere/bruneton-luts.js", "../render/atmosphere/lut-binary.js", "../render/atmosphere/atm-tables.js", "../render/display/tone-mapping.js", "../render/display/bloom.js", "../render/display/dither.js", "../render/display/antialias.js", "../render/display/display-chain.js", "../data/atmosphere-reference-models.js", "../shaders/atm-sampling.glsl.js", "../shaders/planet-atmosphere-composite.glsl.js", "../shaders/planet-atmosphere.glsl.js", "../shaders/ring-shadow-receiver.glsl.js", "../shaders/moon-shadow.glsl.js", "../shaders/ring-particle-shadow.glsl.js", "../shaders/ring-sun-shading.glsl.js", "../shaders/ring-planet-occlusion.glsl.js", "../bodies/sun-factory.js", "../bodies/planet-factory.js", "../bodies/small-bodies/belt-factory.js", "../systems/camera-system.js", "../systems/focus-ui.js", "../ui/dock-controller.js", "../ui/moon-flyout.js", "../ui/ui-controller.js", "../ui/sky-toggle-controller.js", "./layers.js", "./frame-loop.js", "./state.js" ];

// Small, dependency-free notice used when the WebGL context is lost mid-session.
// Inline styles on purpose: the regular stylesheets may not have loaded, and
// this must be readable even if the app never finished booting.
globalThis.__solisterSetContextNotice = (visible, message) => {
    const id = "solister-context-notice";
    let node = document.getElementById(id);
    if (!visible) {
        if (node) node.remove();
        return;
    }
    if (!node) {
        node = document.createElement("div");
        node.id = id;
        node.setAttribute("role", "status");
        node.style.cssText = [
            "position:fixed", "left:50%", "bottom:24px", "transform:translateX(-50%)",
            "z-index:2147483647", "max-width:min(560px,calc(100vw - 32px))",
            "padding:12px 18px", "border-radius:10px",
            "background:rgba(28,28,30,.96)", "border:1px solid rgba(255,255,255,.14)",
            "color:#e8e8ea", "font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif",
            "box-shadow:0 8px 28px rgba(0,0,0,.5)", "text-align:center"
        ].join(";");
        document.body.appendChild(node);
    }
    node.textContent = message || "Graphics context lost \u2014 restoring\u2026";
};

function loadScript(path) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = new URL(path, import.meta.url).href;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load script: " + script.src));
        document.head.appendChild(script);
    });
}

// The two folders the code zip deliberately does not carry. Served from a bare
// copy of it, every one of these requests 404s and the page reports a wall of
// noise with the real cause nowhere in it. One HEAD request each, and the
// loading screen says what is wrong in words.
async function checkContentFolders() {
    const missing = [];
    for (const [label, url] of [["assets", "./assets/textures/2k/maps.json"], ["data", "./data/sky/star-catalog.js"]]) {
        try {
            const response = await fetch(url, { method: "HEAD", cache: "no-store" });
            if (!response.ok) missing.push(label);
        } catch (error) {
            missing.push(label);
        }
    }
    if (!missing.length) return;
    // Persistent, not the progress label: the loader overwrites that a second
    // later and the reason would vanish with it.
    globalThis.__solisterSetContextNotice?.(true,
        "Missing folder: " + missing.join(" and ") + "/ beside index.html. " +
        "This zip is code only: extract it over the folder that already has them.");
    console.error("[Solister] " + missing.join(" and ") + "/ not found beside index.html. " +
        "Extract the code zip over the folder that already holds assets/ and data/, then reload.");
}

// state.js is a classic script and cannot await the renderer seam, so the
// one production renderer is created here, immediately before state.js runs.
// The production material set is still GLSL, so nodeMaterialsReady stays
// false: ?renderer= is parsed and reported by the seam, but the actual
// production renderer remains WebGLRenderer until the TSL port replaces the
// material system. The info object makes that state inspectable by probes
// instead of letting a request silently mean something else.
async function installProductionRenderer() {
    if (globalThis.__solisterRendererHandle) return globalThis.__solisterRendererHandle;
    const handle = await createSolisterRenderer({ nodeMaterialsReady: false });
    globalThis.__solisterRendererHandle = handle;
    globalThis.__solisterRendererInfo = handle.info;
    if (Number.isInteger(handle.configIndex)) globalThis.__solisterRendererConfig = handle.configIndex;
    globalThis.__solisterRendererBlocked = handle.blocked === true;
    if (handle.error) globalThis.__solisterRendererError = handle.error;
    else delete globalThis.__solisterRendererError;
    if (handle.info?.fallbackReason === "material-system-not-node-ready") {
        console.info("[Solister] renderer request '" + handle.info.requestedBackend +
            "' recorded; production materials are not node-ready yet, so this boot uses WebGL.");
    }
    return handle;
}

export async function startApp({dependencies: dependencies = {}} = {}) {
    await checkContentFolders();
    globalThis.__solisterBootProgress = {
        total: scripts.length,
        done: 0,
        complete: false
    };
    for (const [name, value] of Object.entries(dependencies)) globalThis[name] = value;
    const preloads = scripts.map(path => {
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "script";
        link.href = new URL(path + "?solisterbuild=" + encodeURIComponent(globalThis.__SOLISTER_BUILD_TAG || "dev"), import.meta.url).href;
        document.head.appendChild(link);
        return link;
    });
    try {
        for (const path of scripts) {
            if (path === "./state.js") await installProductionRenderer();
            await loadScript(path + "?solisterbuild=" + encodeURIComponent(globalThis.__SOLISTER_BUILD_TAG || "dev"));
            globalThis.__solisterBootProgress.done++;
            globalThis.paintLoadingProgress?.();
            if (path.endsWith("lut-binary.js")) {
                // Baked scattering tables must be in the store before buildSystem()
                // runs, so fetch them here; the GPU path still covers a build without.
                try {
                    await globalThis.preloadBakedAtmosphereTables?.();
                } catch (error) {
                    console.warn("baked atmosphere tables unavailable:", error);
                }
            }
        }
    } finally {
        for (const link of preloads) link.remove();
    }
    // A throw inside state.js (loaded as a classic script) cannot reject
    // loadScript's promise, so surface it here instead of reporting a clean boot.
    if (globalThis.__solisterStartupFailure) {
        throw new Error(globalThis.__solisterStartupFailure);
    }
    globalThis.__solisterBootProgress.complete = true;
    globalThis.paintLoadingProgress?.();
    globalThis._maybeFinishLoading?.();
}
