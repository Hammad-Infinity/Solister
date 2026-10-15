const scripts = [ "../audio/audio-manager.js", "../ui/loading-screen.js", "../render/procedural-textures.js", "../render/texture-pipeline.js", "../render/brdf/surface-brdf.js", "../shaders/eclipse.glsl.js", "../shaders/single-glow.glsl.js", "../render/atmosphere/transmittance-table.js", "../data/spaceengine-atmosphere-models.js", "../shaders/planet-atmosphere.glsl.js", "../shaders/ring-shadow-receiver.glsl.js", "../shaders/moon-shadow.glsl.js", "../shaders/ring-particle-shadow.glsl.js", "../shaders/ring-sun-shading.glsl.js", "../shaders/ring-planet-occlusion.glsl.js", "../bodies/sun-factory.js", "../bodies/planet-factory.js", "../bodies/small-bodies/belt-factory.js", "../systems/camera-system.js", "../systems/focus-ui.js", "../ui/dock-controller.js", "../ui/moon-flyout.js", "../ui/ui-controller.js", "../ui/sky-toggle-controller.js", "./layers.js", "./frame-loop.js", "./state.js" ];

function loadScript(path) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = new URL(path, import.meta.url).href;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load script: " + script.src));
        document.head.appendChild(script);
    });
}

export async function startApp({dependencies: dependencies = {}} = {}) {
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
        link.href = new URL(path, import.meta.url).href;
        document.head.appendChild(link);
        return link;
    });
    try {
        for (const path of scripts) {
            await loadScript(path);
            globalThis.__solisterBootProgress.done++;
            globalThis.paintLoadingProgress?.();
        }
    } finally {
        for (const link of preloads) link.remove();
    }
    globalThis.__solisterBootProgress.complete = true;
    globalThis.paintLoadingProgress?.();
    globalThis._maybeFinishLoading?.();
}
