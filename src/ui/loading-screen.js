var _ephemerisLoading = false;
var _loadingActive = false;
var _pendingLoads = 0;
var _loadingMinEnd = 0;
var _loadingHideTimer = null;
var _loadingHardTimer = null;
var _showResPickerOnLoad = false;
var _loadingWorkTotal = 0;
var _loadingWorkDone = 0;
var _loadingIncludesBoot = true;
var _loadingBackground = false;
var _loadingCompleteShown = false;
function loadingProgressSnapshot(complete = false) {
    const boot = globalThis.__solisterBootProgress;
    const total = _loadingWorkTotal + (_loadingIncludesBoot && boot ? boot.total : 0);
    const done = _loadingWorkDone + (_loadingIncludesBoot && boot ? boot.done : 0);
    const percent = complete ? 100 : total ? Math.min(99, Math.floor(done / total * 100)) : 0;
    return { total, done, percent };
}
function paintLoadingProgress(complete = false) {
    const { percent } = loadingProgressSnapshot(complete);
    const number = document.getElementById('loading-percent');
    const bar = document.getElementById('loading-progress');
    const fill = document.getElementById('loading-progress-fill');
    if (number) number.textContent = percent + '%';
    if (bar) bar.setAttribute('aria-valuenow', String(percent));
    if (fill) fill.style.transform = `scaleX(${percent / 100})`;
}
function setLoadingLabel(label) {
    if (loadingLabelEl && label) loadingLabelEl.textContent = label;
}
function beginLoading(label) {
    if (!_loadingActive && _pendingLoads === 0) {
        _loadingWorkTotal = _loadingWorkDone = 0;
        _loadingIncludesBoot = !!globalThis.__solisterBootProgress && !globalThis.__solisterBootProgress.complete;
    }
    clearTimeout(_loadingHideTimer);
    clearTimeout(_loadingHardTimer);
    _loadingHideTimer = null;
    _loadingActive = true;
    _loadingBackground = false;
    _loadingCompleteShown = false;
    _loadingMinEnd = performance.now() + LOADING_MIN_MS;
    if (label) setLoadingLabel(label);
    const continueButton = document.getElementById('loading-continue');
    if (continueButton) { continueButton.hidden = true; continueButton.onclick = continueLoadingInBackground; }
    loadingScreenEl.classList.add('visible');
    loadingScreenEl.setAttribute('aria-hidden', 'false');
    controls.enabled = false;
    _loadingHardTimer = setTimeout(() => {
        if (_pendingLoads > 0 && continueButton) continueButton.hidden = false;
        paintLoadingProgress();
    }, LOADING_HARD_MS);
    paintLoadingProgress();
    _maybeFinishLoading();
}
function trackLoadStart() {
    if (!_loadingActive && !_loadingBackground) beginLoading('Loading textures');
    _pendingLoads++;
    _loadingWorkTotal++;
    _loadingCompleteShown = false;
    clearTimeout(_loadingHideTimer);
    _loadingHideTimer = null;
    if (_loadingActive) paintLoadingProgress();
}
function trackLoadEnd() {
    if (_pendingLoads <= 0) return;
    _pendingLoads--;
    _loadingWorkDone++;
    if (_loadingActive) paintLoadingProgress();
    if (!_pendingLoads && _loadingBackground) _loadingBackground = false;
    _maybeFinishLoading();
}
function _maybeFinishLoading() {
    if (!_loadingActive || _pendingLoads > 0) return;
    if (globalThis.__solisterBootProgress && !globalThis.__solisterBootProgress.complete) return;
    const wait = Math.max(0, _loadingMinEnd - performance.now());
    clearTimeout(_loadingHideTimer);
    _loadingHideTimer = setTimeout(_finishLoading, wait + 60);
}
globalThis._maybeFinishLoading = _maybeFinishLoading;
function hideLoadingOverlay() {
    _loadingActive = false;
    clearTimeout(_loadingHideTimer);
    clearTimeout(_loadingHardTimer);
    _loadingHideTimer = _loadingHardTimer = null;
    loadingScreenEl.classList.remove('visible');
    loadingScreenEl.setAttribute('aria-hidden', 'true');
    if (_showResPickerOnLoad) {
        _showResPickerOnLoad = false;
        setTimeout(showResolutionPicker, RES_PICKER_DELAY_MS);
    } else if (!document.body.classList.contains('res-picker-open')) {
        controls.enabled = true;
    }
}
function continueLoadingInBackground() {
    _loadingBackground = _pendingLoads > 0;
    hideLoadingOverlay();
}
function _finishLoading() {
    if (!_loadingActive || _pendingLoads > 0) return;
    if (globalThis.__solisterBootProgress && !globalThis.__solisterBootProgress.complete) return;
    _loadingCompleteShown = true;
    paintLoadingProgress(true);
    clearTimeout(_loadingHardTimer);
    _loadingHideTimer = setTimeout(() => {
        if (_loadingCompleteShown && _pendingLoads === 0) hideLoadingOverlay();
    }, 180);
}
function showResolutionPicker() {
    const picker = document.getElementById('resolution-picker');
    if (!picker) return;
    picker.style.display = '';
    document.body.classList.add('res-picker-open');
    picker.classList.add('visible');
    controls.enabled = false;
}
function closeResolutionPicker(choice) {
    const picker = document.getElementById('resolution-picker');
    if (!picker) return;
    picker.classList.remove('visible');
    document.body.classList.remove('res-picker-open');
    applyTextureQuality(choice, true);
    lastActivity = performance.now();
    if (!_loadingActive) controls.enabled = true;
    setTimeout(() => { picker.style.display = 'none'; }, 500);
}