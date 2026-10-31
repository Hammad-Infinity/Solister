function setPathStyle(name) {
    if (name === "off") {
        showOrbits = false;
        pathSettings.enabled = false;
    } else {
        showOrbits = true;
        pathSettings.enabled = true;
        pathSettings.style = name;
    }
    solarAccuracy.applied = null;
    refreshPathButtons();
}

function refreshPathButtons() {
    const current = pathSettings.enabled ? pathSettings.style : "off";
    for (const [name, btn] of Object.entries(pathButtons)) {
        btn.classList.toggle("active", name === current);
    }
}

function refreshDateRow() {
    if (document.activeElement === dateInputEl) return;
    const ms = solarAccuracy.available && solarAccuracy.snapshot ? solarAccuracy.snapshot.ms : simTimeMs;
    if (!Number.isFinite(ms)) return;
    const second = Math.floor(ms / 1e3);
    if (second === dateRenderedSecond && dateInputEl.value) return;
    const value = second * 1e3;
    if (dateInputEl.valueAsNumber !== value) dateInputEl.valueAsNumber = value;
    dateRenderedSecond = second;
}

function formatRate(s) {
    const a = Math.abs(s), back = s < 0;
    const at = (v, u, dp) => (back ? "−" : "") + v.toFixed(dp) + " " + u;
    if (a < 60) return at(a, "s/s", 1);
    if (a < 3600) return at(a / 60, "min/s", 1);
    if (a < 86400) return at(a / 3600, "hr/s", 1);
    if (a < 2592e3) return at(a / 86400, "d/s", 1);
    if (a < SECONDS_PER_YEAR) return at(a / 2592e3, "mo/s", 1);
    return at(a / SECONDS_PER_YEAR, "yr/s", 2);
}

function updateSpeedFromSlider() {
    const v = parseFloat(speedSlider.value);
    const fill = 50 + v / 2, from = Math.min(50, fill), to = Math.max(50, fill);
    speedSlider.style.backgroundImage = `linear-gradient(to right, ` + `rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.08) ${from}%, ` + `#6a6a6a ${from}%, #6a6a6a ${to}%, ` + `rgba(255,255,255,0.08) ${to}%, rgba(255,255,255,0.08) 100%)`;
    const magnitude = Math.pow(MAX_TIME_RATE, sq(Math.abs(v) / 100));
    timeScale = v < 0 ? -magnitude : magnitude;
    speedDisplay.textContent = formatRate(timeScale);
    speedSlider.setAttribute("aria-valuetext", speedDisplay.textContent);
}

let speedInputFrame = 0;

let speedQueuedPaint = null;

let speedPendingSave = null;

function flushPendingSpeedInput(save = true) {
    if (speedInputFrame) cancelAnimationFrame(speedInputFrame);
    speedInputFrame = 0;
    const pending = speedQueuedPaint;
    speedQueuedPaint = null;
    if (pending !== null) updateSpeedFromSlider();
    if (save && speedPendingSave !== null) {
        const value = speedPendingSave;
        speedPendingSave = null;
        try {
            localStorage.setItem("solarSpeed", String(value));
        } catch (_) {}
    }
}

function queueSpeedInput() {
    const value = Math.max(-100, Math.min(100, Number(speedSlider.value) || 0));
    speedSliderValue = value;
    speedQueuedPaint = value;
    speedPendingSave = value;
    if (!speedInputFrame) speedInputFrame = requestAnimationFrame(() => {
        speedInputFrame = 0;
        if (speedQueuedPaint !== null) updateSpeedFromSlider();
        speedQueuedPaint = null;
    });
}

function nudgeSpeedSlider(delta) {
    speedSlider.value = String(Math.max(-100, Math.min(100, (Number(speedSlider.value) || 0) + delta)));
    queueSpeedInput();
    flushPendingSpeedInput();
}

function wireSpeedControl() {
    let drag = null;
    const finish = event => {
        if (drag && event?.pointerId !== undefined && drag.id !== event.pointerId) return;
        const previous = drag;
        drag = null;
        if (previous && speedSlider.hasPointerCapture?.(previous.id)) speedSlider.releasePointerCapture(previous.id);
        flushPendingSpeedInput();
    };
    speedSlider.addEventListener("input", queueSpeedInput);
    speedSlider.addEventListener("change", () => flushPendingSpeedInput());
    speedSlider.addEventListener("blur", finish);
    speedSlider.addEventListener("pointerdown", event => {
        if (event.button !== 0 || drag) return;
        event.preventDefault();
        event.stopPropagation();
        flushPendingSpeedInput();
        speedSlider.focus({
            preventScroll: true
        });
        drag = {
            id: event.pointerId,
            x: event.clientX,
            width: Math.max(1, speedSlider.getBoundingClientRect().width),
            value: Number(speedSlider.value)
        };
        speedSlider.setPointerCapture(event.pointerId);
    });
    speedSlider.addEventListener("pointermove", event => {
        if (!drag || drag.id !== event.pointerId) return;
        event.preventDefault();
        const delta = event.clientX - drag.x;
        drag.x = event.clientX;
        drag.value = Math.max(-100, Math.min(100, drag.value + delta * 200 / drag.width * (event.shiftKey ? .025 : .25)));
        speedSlider.value = String(drag.value);
        queueSpeedInput();
    });
    speedSlider.addEventListener("pointerup", finish);
    speedSlider.addEventListener("pointercancel", finish);
    speedSlider.addEventListener("lostpointercapture", finish);
    speedSlider.addEventListener("keydown", event => {
        const sign = [ "ArrowRight", "ArrowUp" ].includes(event.key) ? 1 : [ "ArrowLeft", "ArrowDown" ].includes(event.key) ? -1 : 0;
        if (sign) {
            event.preventDefault();
            event.stopPropagation();
            nudgeSpeedSlider(sign * (event.shiftKey ? .05 : .5));
        } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            event.stopPropagation();
            speedSlider.value = event.key === "Home" ? "-100" : "100";
            queueSpeedInput();
            flushPendingSpeedInput();
        }
    });
    window.addEventListener("blur", finish);
    window.addEventListener("pagehide", finish);
}

function setVisualSelectValue(value) {
    const opt = Array.from(visualOptionEls).find(li => li.dataset.value === value);
    if (!opt) return;
    visualValueEl.textContent = opt.textContent;
    visualSelectEl.dataset.value = value;
    visualOptionEls.forEach(li => li.classList.toggle("active", li === opt));
}

function setFpsSelectValue(value) {
    const opt = Array.from(fpsOptionEls).find(li => li.dataset.value === value);
    if (!opt) return;
    fpsValueEl.textContent = opt.textContent;
    fpsSelectEl.dataset.value = value;
    fpsOptionEls.forEach(li => li.classList.toggle("active", li === opt));
}

function applyTargetFps(next) {
    performanceDefaults.lastFrame = NaN;
    const n = parseInt(next, 10);
    if (!FPS_OPTIONS.includes(n)) return;
    targetFps = n;
    _fpsLastFrame = 0;
    setFpsSelectValue(String(n));
    try {
        localStorage.setItem("solarTargetFps", String(n));
    } catch (_) {}
}

function wireSelectMenus() {
    setVisualSelectValue(textureQuality);
    fpsTriggerEl.addEventListener("click", e => {
        e.stopPropagation();
        bodySelectEl.classList.remove("open");
        visualSelectEl.classList.remove("open");
        if (!fpsSelectEl.classList.contains("open")) positionFpsMenu();
        fpsSelectEl.classList.toggle("open");
    });
    fpsOptionEls.forEach(li => {
        li.addEventListener("click", () => {
            fpsSelectEl.classList.remove("open");
            applyTargetFps(li.dataset.value);
        });
    });
    visualTriggerEl.addEventListener("click", e => {
        e.stopPropagation();
        bodySelectEl.classList.remove("open");
        fpsSelectEl.classList.remove("open");
        if (!visualSelectEl.classList.contains("open")) positionVisualMenu();
        visualSelectEl.classList.toggle("open");
    });
    visualOptionEls.forEach(li => {
        li.addEventListener("click", () => {
            const next = li.dataset.value;
            visualSelectEl.classList.remove("open");
            applyTextureQuality(next);
        });
    });
    bodyTriggerEl.addEventListener("click", e => {
        e.stopPropagation();
        const opening = !bodySelectEl.classList.contains("open");
        bodySelectEl.classList.toggle("open");
        if (opening) positionBodyMenu();
    });
    bodyOptionEls.forEach(li => {
        li.addEventListener("click", () => {
            bodySelectEl.classList.remove("open");
            const key = li.dataset.key;
            const mesh = objectRegistry[key];
            const facts = bodyFacts[key];
            if (!mesh || !facts || (mesh.userData.extraEphemeris || mesh.userData.isComet) && !mesh.visible) return;
            if (!solarAccuracy.available || mesh.userData.approximate && !mesh.visible) return;
            syncBodySelect(key);
            focusOnObject(mesh);
            showFocusCard(facts);
        });
    });
    document.addEventListener("click", e => {
        if (!fpsSelectEl.contains(e.target)) fpsSelectEl.classList.remove("open");
        if (!visualSelectEl.contains(e.target)) visualSelectEl.classList.remove("open");
        if (!bodySelectEl.contains(e.target)) bodySelectEl.classList.remove("open");
    });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            fpsSelectEl.classList.remove("open");
            bodySelectEl.classList.remove("open");
        }
    });
}

function wireUIEvents() {
    pauseBtn.addEventListener("click", () => {
        isPaused = !isPaused;
        pauseBtn.textContent = isPaused ? "▶" : "⏸";
    });
    wireSpeedControl();
    wireCameraInput();
    surfaceGridBtn?.addEventListener("click", () => {
        const key = focusedObject?.userData?.planetKey;
        if (!key || !equatorialGrid?.supports(key)) return;
        equatorialGrid.setEnabled(key, !equatorialGrid.isEnabled(key));
        updateSurfaceGridControl(key);
    });
    function toggleLabelsVisibility() {
        showLabels = !showLabels;
        toggleLabelsBtn?.classList.toggle("active", showLabels);
        for (const label of labelObjects) label._lastOp = undefined;
        if (!showLabels) {
            labelObjects.forEach(label => label.element.style.opacity = "0");
        }
    }
    toggleLabelsBtn?.addEventListener("click", toggleLabelsVisibility);
    toggleRotateBtn.addEventListener("click", () => {
        controls.autoRotate = !controls.autoRotate;
        toggleRotateBtn.classList.toggle("active", controls.autoRotate);
        distanceReadout?.noteInput();
    });
    resetViewBtn.addEventListener("click", resetCamera);
    syncNowBtn.addEventListener("click", syncToNow);
    unfocusBtn.addEventListener("click", releaseFocus);
    Object.entries(pathButtons).forEach(([name, btn]) => btn.addEventListener("click", () => setPathStyle(name)));
    dateInputEl.addEventListener("blur", () => {
        dateRenderedSecond = NaN;
    });
    dateInputEl.addEventListener("change", () => {
        dateRenderedSecond = NaN;
        const ms = dateInputEl.valueAsNumber;
        dateInputEl.setCustomValidity("");
        if (Number.isFinite(ms)) simTimeMs = clampSimulationDate(ms);
    });
    volumeSlider.addEventListener("input", () => {
        const v = parseInt(volumeSlider.value, 10) / 100;
        volume = v;
        if (v > 0) {
            lastNonZeroVol = v;
            muted = false;
        } else {
            muted = true;
        }
        audioEnabled = true;
        persistAudio();
        cancelFade();
        const target = targetVolume();
        ambientAudio.volume = target;
        if (target > .001 && ambientAudio.paused) {
            ambientAudio.play().catch(() => {});
        } else if (target <= .001 && !ambientAudio.paused) {
            ambientAudio.pause();
        }
        updateVolumeUI();
    });
    volumeBtn.addEventListener("click", toggleMute);
    renderer.domElement.addEventListener("wheel", event => {
        if (!controls.enabled) return;
        event.preventDefault();
        const speedScale = cameraFocusSpeedScale() * (globalThis.cameraAtmosphereSpeedFactor ? globalThis.cameraAtmosphereSpeedFactor() : 1);
        if (landingState?.body?.visible) {
            // Altitude is exponential like every other zoom in the app, so the first
            // notch off the surface actually moves.
            const body = landingState.body;
            const radius = bodyWorldRadius(body);
            const minimumClearance = cameraEyeHeightUnits(body);
            const maximumClearance = Math.max(minimumClearance, radius * .45);
            const clearance = Math.max(minimumClearance, landingState.clearanceTarget ?? landingState.surfaceClearance ?? minimumClearance);
            const factor = Math.exp(event.deltaY * ZOOM_SENSITIVITY * 3 * cameraFocusSpeedScale());
            landingState.clearanceTarget = Math.max(minimumClearance, Math.min(maximumClearance, clearance * factor));
            landingState.clearanceAt = performance.now();
            zoomDistTarget = null;
            return;
        }
        const curDist = camera.position.distanceTo(controls.target);
        if (zoomDistTarget === null) zoomDistTarget = curDist;
        const factor = Math.exp(event.deltaY * ZOOM_SENSITIVITY * speedScale);
        let next = zoomDistTarget * factor;
        next = Math.max(controls.minDistance, Math.min(controls.maxDistance, next));
        zoomDistTarget = next;
    }, {
        passive: false
    });
    renderer.domElement.addEventListener("pointerdown", e => {
        if (e.button !== 0) return;
        _pointerDownPos = {
            x: e.clientX,
            y: e.clientY
        };
    });
    renderer.domElement.addEventListener("pointerup", e => {
        if (e.button !== 0 || !_pointerDownPos) return;
        const dx = e.clientX - _pointerDownPos.x;
        const dy = e.clientY - _pointerDownPos.y;
        _pointerDownPos = null;
        if (dx * dx + dy * dy > 36) return;
        onCanvasClick(e);
    });
    renderer.domElement.addEventListener("contextmenu", e => e.preventDefault());
    renderer.domElement.addEventListener("webglcontextlost", event => {
        event.preventDefault();
        if (_contextLost) return;
        _contextLost = true;
        contextOverlay.style.display = "flex";
    }, false);
    renderer.domElement.addEventListener("webglcontextrestored", () => {
        if (!_contextLost) return;
        _contextLost = false;
        contextOverlay.style.display = "none";
        if (typeof renderer.resetState === "function") renderer.resetState();
        for (const tex of loadedTextures.values()) if (tex) tex.needsUpdate = true;
        for (const key in proceduralTextures) {
            const tex = proceduralTextures[key];
            if (tex) tex.needsUpdate = true;
        }
        scene.traverse(obj => {
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [ obj.material ];
                for (const m of mats) if (m) m.needsUpdate = true;
            }
            if (obj.geometry) obj.geometry.needsUpdate = true;
        });
        applyGraphicsPixelRatio();
        clock.start();
    }, false);
    document.addEventListener("mousemove", bumpActivity, {
        passive: true
    });
    document.addEventListener("mousedown", bumpActivity, {
        passive: true
    });
    document.addEventListener("wheel", bumpActivity, {
        passive: true
    });
    document.addEventListener("keydown", bumpActivity);
    window.addEventListener("resize", () => {
        if (bodySelectEl.classList.contains("open")) positionBodyMenu();
        if (visualSelectEl.classList.contains("open")) positionVisualMenu();
        if (fpsSelectEl.classList.contains("open")) positionFpsMenu();
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        performanceDefaults.applySize();
        renderer.setSize(window.innerWidth, window.innerHeight);
        labelRenderer.setSize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener("resize", () => {
        const rect = dockEl.getBoundingClientRect();
        if (dockEl.style.top) {
            const topY = Math.max(0, Math.min(window.innerHeight - 76, rect.top));
            dockEl.style.top = topY + "px";
        }
    });
    window.addEventListener("keydown", e => {
        if (e.defaultPrevented || e.isComposing) return;
        if (isWallpaperEngine && ![ "w", "a", "s", "d", "q", "e", "l", "o", "r", "t", "c", "escape" ].includes(e.key.toLowerCase())) return;
        if (e.target.isContentEditable || e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
        if ((e.key === " " || e.key === "Enter") && e.target.closest?.("button,summary")) return;
        const key = e.key.toLowerCase();
        if ([ "w", "a", "s", "d", "q", "e" ].includes(key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            cameraKeys.add(key);
            beginManualCameraMotion(true);
            return;
        }
        switch (key) {
          case " ":
            e.preventDefault();
            pauseBtn.click();
            break;
          case "t":
            if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                setAsteroidsEnabled(!allAsteroidTypesOn());
            }
            break;
          case "c":
            if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                stopCameraMotion();
            }
            break;
          case "h":
            if (dockEl.classList.contains("collapsed")) showDock(); else hideDock();
            break;
          case "l":
            if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                landOnFocusedPlanet();
            }
            break;
          case "m":
            if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                toggleMute();
            }
            break;
          case "n":
            if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                syncToNow();
            }
            break;
          case "o":
            if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                const cur = pathSettings.enabled ? pathSettings.style : "off";
                setPathStyle(cur === "trails" ? "orbits" : cur === "orbits" ? "off" : "trails");
            }
            break;
          case "r":
            resetViewBtn.click();
            break;
          case "+":
          case "=":
            e.preventDefault();
            controls.domElement.dispatchEvent(new WheelEvent("wheel", {
                deltaY: -240 * Math.max(1, window.devicePixelRatio | 0),
                bubbles: true,
                cancelable: true
            }));
            break;
          case "-":
          case "_":
            e.preventDefault();
            controls.domElement.dispatchEvent(new WheelEvent("wheel", {
                deltaY: 240 * Math.max(1, window.devicePixelRatio | 0),
                bubbles: true,
                cancelable: true
            }));
            break;
          case ",":
          case "<":
            e.preventDefault();
            nudgeSpeedSlider(e.shiftKey ? -.05 : -.5);
            break;
          case ".":
          case ">":
            e.preventDefault();
            nudgeSpeedSlider(e.shiftKey ? .05 : .5);
            break;
          case "escape":
            e.preventDefault();
            // Escape backs out one step and never flies the camera anywhere:
            // landing -> leave the surface, focused -> let go but stay put.
            if (!leavePlanetLanding()) unfocusKeepCamera();
            break;
        }
    });
    window.addEventListener("keyup", e => {
        const key = e.key.toLowerCase();
        cameraKeys.delete(key);
    });
    document.addEventListener("pointerdown", unlockMusicContext, true);
    document.addEventListener("keydown", unlockMusicContext, true);
    ambientAudio.addEventListener("playing", () => {
        failedTracks = 0;
    });
    ambientAudio.addEventListener("ended", advanceMusicTrack);
    ambientAudio.addEventListener("error", () => {
        console.warn(`Cannot play track${trackIndex}.mp3`, ambientAudio.error);
        failedTracks++;
        if (failedTracks < TRACK_COUNT) {
            advanceMusicTrack();
        } else {
            console.error("No playable music tracks found. Check TRACK_COUNT and paths.");
        }
    });
}
