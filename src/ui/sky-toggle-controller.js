function skyLayerEnabled(key) {
    return !!skyToggles[key];
}

const SKY_TOGGLE_BUTTON_IDS = Object.freeze({
    milkyway: "toggle-milkyway",
    figures: "toggle-figures",
    boundaries: "toggle-boundaries",
    grid: "toggle-grid",
    eclipticGrid: "toggle-ecliptic-grid",
    galacticGrid: "toggle-galactic-grid",
    conLabels: "toggle-conlabels",
    starLabels: "toggle-starlabels"
});

const skyToggleBindings = new WeakMap;

function paintSkyToggleButton(button, key) {
    if (!button) return;
    const on = skyLayerEnabled(key);
    button.classList.toggle("active", on);
    button.setAttribute("aria-pressed", String(on));
}

function saveSkyToggles() {
    const saved = {};
    for (const key of Object.keys(SKY_TOGGLE_BUTTON_IDS)) saved[key] = !!skyToggles[key];
    try {
        localStorage.setItem("solarSkyToggles", JSON.stringify(saved));
    } catch (_) {}
}

function applySkyToggles(initial = false) {
    const domeOn = true;
    const labelsOn = true;
    if (skyMaps) {
        skyMaps.group.visible = domeOn;
        const figures = domeOn && skyLayerEnabled("figures");
        const boundaries = domeOn && skyLayerEnabled("boundaries");
        skyMaps.setLayerVisible("celgrid", domeOn && skyLayerEnabled("grid"));
        skyMaps.setLayerVisible("eclipticgrid", domeOn && skyLayerEnabled("eclipticGrid"));
        skyMaps.setLayerVisible("galacticgrid", domeOn && skyLayerEnabled("galacticGrid"));
    }
    if (constellationLayer) {
        constellationLayer.group.visible = labelsOn;
        if (constellationLayer.figures) constellationLayer.figures.visible = domeOn && skyLayerEnabled("figures");
        if (constellationLayer.figureEndpointStars) constellationLayer.figureEndpointStars.visible = domeOn && skyLayerEnabled("figures");
        if (constellationLayer.boundaries) constellationLayer.boundaries.visible = domeOn && skyLayerEnabled("boundaries");
        if (constellationLayer.stars) constellationLayer.stars.visible = true;
        if (constellationLayer.starPointSources) constellationLayer.starPointSources.visible = true;
        if (constellationLayer.namedStars) constellationLayer.namedStars.visible = false;
        for (const label of constellationLayer.labels || []) {
            label.visible = labelsOn && skyLayerEnabled("conLabels");
        }
        for (const label of constellationLayer.starLabels || []) {
            label.visible = labelsOn && skyLayerEnabled("starLabels");
        }
    }
    applyStarVisibility();
    for (const [key, id] of Object.entries(SKY_TOGGLE_BUTTON_IDS)) {
        paintSkyToggleButton(document.getElementById(id), key);
    }
    if (!initial) saveSkyToggles();
}

function wireSkyToggle(id, key) {
    if (!Object.prototype.hasOwnProperty.call(SKY_TOGGLE_BUTTON_IDS, key)) return;
    const button = document.getElementById(id);
    if (!button) return;
    const previous = skyToggleBindings.get(button);
    if (previous && previous.key === key) {
        paintSkyToggleButton(button, key);
        return;
    }
    if (previous) button.removeEventListener("click", previous.handler);
    const handler = () => {
        skyToggles[key] = !skyToggles[key];
        applySkyToggles();
        paintSkyToggleButton(button, key);
    };
    skyToggleBindings.set(button, {
        key: key,
        handler: handler
    });
    button.addEventListener("click", handler);
    paintSkyToggleButton(button, key);
}
