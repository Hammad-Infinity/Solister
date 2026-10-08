let cometsEnabled = true, markersEnabled = true, labelMode = 'symbols';
try {
    const current = localStorage.getItem('solarCometsEnabled');
    const legacy = localStorage.getItem('solarRealisticComets');
    const saved = current ?? legacy;
    if (saved !== null) {
        cometsEnabled = saved === '1';
        if (current === null) localStorage.setItem('solarCometsEnabled', saved);
        if (legacy !== null) localStorage.removeItem('solarRealisticComets');
    } else {
        const legacy = JSON.parse(localStorage.getItem('solarAsteroidTypes') || '{}');
        cometsEnabled = !!legacy.comets && localStorage.getItem('solarAllAsteroidsEnabled') !== '0';
        localStorage.setItem('solarCometsEnabled', cometsEnabled ? '1' : '0');
    }
} catch (_) {}
try {
    const saved = localStorage.getItem('solarLabelMode');
    if (saved === 'symbols' || saved === 'names' || saved === 'off') labelMode = saved;
} catch (_) {}
markersEnabled = labelMode !== 'off';

function getLabelMode() { return labelMode; }
function setLabelMode(value) {
    if (!['symbols', 'names', 'off'].includes(value)) return;
    labelMode = value;
    markersEnabled = value !== 'off';
    try { localStorage.setItem('solarLabelMode', value); } catch (_) {}
    paintLayerControls();
}
function cometsVisible() { return cometsEnabled; }
function setCometsEnabled(enabled) {
    cometsEnabled = !!enabled;
    try { localStorage.setItem('solarCometsEnabled', cometsEnabled ? '1' : '0'); } catch (_) {}
    if (!cometsEnabled && focusedObject?.userData.isComet) releaseFocus();
    cometLayer.setEnabled(cometsEnabled);
    paintLayerControls();
}

const ASTEROID_TYPE_KEYS = ['asteroidbelt', 'trojanl4', 'trojanl5', 'hildas', 'nea', 'kuiperbelt'];
const asteroidTypePrefs = Object.fromEntries(ASTEROID_TYPE_KEYS.map(key => [key, false]));
try {
    const saved = JSON.parse(localStorage.getItem('solarAsteroidTypes') || 'null');
    for (const key of ASTEROID_TYPE_KEYS) {
        if (typeof saved?.[key] === 'boolean') asteroidTypePrefs[key] = saved[key];
    }
} catch (_) {}
let asteroidTypeButtons = null;
let asteroidMenuRows = null;
function asteroidTypeAvailable(key) { return ASTEROID_TYPE_KEYS.includes(key); }
function asteroidTypeEnabled(key) {
    return !!asteroidsEnabled && asteroidTypeAvailable(key) && asteroidTypePrefs[key] !== false;
}
function allAsteroidTypesOn() {
    return asteroidsEnabled && ASTEROID_TYPE_KEYS.every(key => asteroidTypePrefs[key]);
}
function saveAsteroidTypePrefs() {
    try { localStorage.setItem('solarAsteroidTypes', JSON.stringify(asteroidTypePrefs)); } catch (_) {}
}
function paintLayerControls() {
    paintSkyToggleButton(document.getElementById('toggle-figures'), 'figures');
    const cometButton = document.getElementById('toggle-comets');
    if (cometButton) {
        cometButton.classList.toggle('active', cometsEnabled);
        cometButton.setAttribute('aria-pressed', String(cometsEnabled));
    }
    for (const [id, value] of [['label-symbols', 'symbols'], ['label-names', 'names'], ['label-off', 'off']]) {
        document.getElementById(id)?.classList.toggle('active', labelMode === value);
    }
}
function paintLayerButtons() {
    paintLayerControls();
    const master = document.getElementById('toggle-asteroids');
    if (master) {
        const all = allAsteroidTypesOn();
        const any = ASTEROID_TYPE_KEYS.some(asteroidTypeEnabled);
        master.classList.toggle('active', all);
        master.setAttribute('aria-pressed', all ? 'true' : any ? 'mixed' : 'false');
    }
    if (!asteroidTypeButtons) asteroidTypeButtons = Array.from(document.querySelectorAll('[data-asteroid-kind]'));
    for (const button of asteroidTypeButtons) {
        const key = button.dataset.asteroidKind, on = asteroidTypeEnabled(key);
        button.hidden = !asteroidTypeAvailable(key);
        button.classList.toggle('active', on);
        button.setAttribute('aria-pressed', String(on));
        button.title = asteroidsEnabled ? 'Toggle this small-body population'
            : 'Click to enable this population and the master switch';
    }
}
function enforceAsteroidVisibility() {
    cometLayer.setEnabled(cometsVisible());
    if (!asteroidMenuRows) asteroidMenuRows = {
        belt: document.querySelectorAll('#body-select [data-key="asteroidbelt"]'),
        nea: document.querySelectorAll('[data-nea]'),
        resonant: document.querySelectorAll('[data-population]'),
    };
    const hide = object => { if (object) object.visible = false; };
    const beltOn = asteroidTypeEnabled('asteroidbelt');
    kuiperBelt.setEnabled(asteroidTypeEnabled('kuiperbelt'));
    for (const row of asteroidMenuRows.belt) row.hidden = !beltOn;
    for (const row of asteroidMenuRows.nea) row.hidden = !asteroidTypeEnabled('nea') || !nearEarth.groups.size;
    if (!beltOn) {
        hide(asteroidBelt); hide(asteroidBelt?.userData.rockPoints); hide(asteroidBelt?.userData.markers);
        hide(objectRegistry.asteroidbelt); hide(objectRegistry.asteroidbelt?.userData.closeRock);
    }
    for (const [key, group] of resonantPopulations.groups) {
        if (asteroidTypeEnabled(key)) continue;
        hide(group.anchor); hide(group.markers); hide(group.rocks);
        hide(group.catalog?.markers); hide(group.catalog?.rocks);
    }
    if (!asteroidTypeEnabled('nea')) for (const group of nearEarth.groups.values()) {
        hide(group.anchor); hide(group.markers); hide(group.rocks?.rocks);
    }
    for (const row of asteroidMenuRows.resonant) {
        const key = row.dataset.key;
        row.hidden = !asteroidTypeEnabled(key) || !resonantPopulations.groups.has(key);
    }
}
function setAsteroidTypeEnabled(key, enabled) {
    if (!asteroidTypeAvailable(key)) return;
    asteroidTypePrefs[key] = !!enabled;
    saveAsteroidTypePrefs();
    if (enabled && !asteroidsEnabled) {
        asteroidsEnabled = true;
        try { localStorage.setItem(ASTEROIDS_STORAGE_KEY, '1'); } catch (_) {}
    }
    if (!enabled && focusedObject?.userData.planetKey === key) releaseFocus();
    _lastCatalogWall = 0;
    enforceAsteroidVisibility();
    paintLayerButtons();
    setLayerNote();
}
function setAsteroidsEnabled(enabled) {
    asteroidsEnabled = !!enabled;
    for (const key of ASTEROID_TYPE_KEYS) asteroidTypePrefs[key] = asteroidsEnabled;
    saveAsteroidTypePrefs();
    try { localStorage.setItem(ASTEROIDS_STORAGE_KEY, asteroidsEnabled ? '1' : '0'); } catch (_) {}
    if (!asteroidsEnabled && ASTEROID_TYPE_KEYS.includes(focusedObject?.userData.planetKey)) releaseFocus();
    _lastCatalogWall = 0;
    enforceAsteroidVisibility();
    paintLayerButtons();
    setLayerNote();
}
function setLayerNote() {
    const element = document.getElementById('layer-note');
    if (!element) return;
    const active = ASTEROID_TYPE_KEYS.filter(asteroidTypeEnabled).length;
    element.textContent = asteroidsEnabled
        ? `${active} / ${ASTEROID_TYPE_KEYS.length} optional small-body populations enabled · ring-particle markers adapt to focus distance`
        : 'Optional small-body populations off · ring-particle markers adapt to focus distance';
}

function placeSegmentedThumb(group) {
    if (!group) return;
    const thumb = group.querySelector(':scope > .seg-thumb');
    const active = group.querySelector(':scope > .toggle-btn.active');
    if (!thumb) return;
    const setIf = (property, value) => { if (thumb.style[property] !== value) thumb.style[property] = value; };
    if (!active || !group.offsetWidth) { setIf('opacity', '0'); return; }
    setIf('opacity', '1');
    setIf('width', (active.offsetWidth + 6) + 'px');
    setIf('transform', 'translateX(' + (active.offsetLeft - 3) + 'px)');
}
function initSegmentedSlider(group) {
    if (!group || group.dataset.segInit) return;
    group.dataset.segInit = '1';
    const place = () => placeSegmentedThumb(group);
    group.addEventListener('click', () => requestAnimationFrame(place));
    const observer = new MutationObserver(() => requestAnimationFrame(place));
    observer.observe(group, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    const subgroup = group.closest('.dock-subgroup');
    if (subgroup) {
        const parentObserver = new MutationObserver(() => requestAnimationFrame(place));
        parentObserver.observe(subgroup, { attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('resize', place);
    requestAnimationFrame(place);
    setTimeout(place, 450);
    setTimeout(place, 1500);
}
function initSegmentedSliders() {
    initSegmentedSlider(document.getElementById('paths-toggle-group'));
    initSegmentedSlider(document.getElementById('labels-toggle-group'));
}
function wireLayerToggles() {
    document.getElementById('toggle-comets')?.addEventListener('click', () => setCometsEnabled(!cometsEnabled));
    wireSkyToggle('toggle-figures', 'figures');
    document.getElementById('label-symbols')?.addEventListener('click', () => setLabelMode('symbols'));
    document.getElementById('label-names')?.addEventListener('click', () => setLabelMode('names'));
    document.getElementById('label-off')?.addEventListener('click', () => setLabelMode('off'));
    initSegmentedSliders();
    document.getElementById('toggle-asteroids')?.addEventListener('click', () => setAsteroidsEnabled(!allAsteroidTypesOn()));
    for (const button of document.querySelectorAll('[data-asteroid-kind]')) {
        button.addEventListener('click', () => {
            const key = button.dataset.asteroidKind;
            setAsteroidTypeEnabled(key, !asteroidTypeEnabled(key));
        });
    }
    paintLayerButtons();
    setLayerNote();
}
