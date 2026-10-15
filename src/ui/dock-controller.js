function setDockCollapsed(collapsed) {
    dockEl.classList.toggle("collapsed", collapsed);
    if (collapsed) {
        hideFocusCard();
    } else {
        lastActivity = performance.now();
        if (focusedObject) focusLineLayer.classList.add("visible");
    }
}

function showDock() {
    setDockCollapsed(false);
}

function hideDock() {
    setDockCollapsed(true);
}

function setDockSectionOpen(section, open) {
    section.classList.toggle("open", open);
    section.querySelector(".dock-section-body")?.toggleAttribute("inert", !open);
    section.querySelector(".dock-section-header")?.setAttribute("aria-expanded", String(open));
}

function makeDraggable(el, onClick) {
    let pid = null;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    let elOffsetX = 0, elOffsetY = 0;
    let elW = 0, elH = 0;
    let moved = false;
    el.addEventListener("pointerdown", e => {
        if (e.button !== 0) return;
        pid = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        const dockRect = dockEl.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        startLeft = dockRect.left;
        startTop = dockRect.top;
        elOffsetX = elRect.left - dockRect.left;
        elOffsetY = elRect.top - dockRect.top;
        elW = elRect.width;
        elH = elRect.height;
        moved = false;
        try {
            el.setPointerCapture(pid);
        } catch (_) {}
    });
    el.addEventListener("pointermove", e => {
        if (pid === null || e.pointerId !== pid) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        if (!moved) {
            moved = true;
            draggingDock = true;
            dockEl.classList.add("dragging");
            dockEl.style.right = "auto";
            dockEl.style.left = startLeft + "px";
            dockEl.style.top = startTop + "px";
        }
        const minLeft = 12 - elOffsetX;
        const maxLeft = window.innerWidth - 12 - elOffsetX - elW;
        const minTop = 12 - elOffsetY;
        const maxTop = window.innerHeight - 12 - elOffsetY - elH;
        const newLeft = startLeft + dx;
        const newTop = startTop + dy;
        dockEl.style.left = Math.max(minLeft, Math.min(maxLeft, newLeft)) + "px";
        dockEl.style.top = Math.max(minTop, Math.min(maxTop, newTop)) + "px";
    });
    const endPointer = e => {
        if (pid === null) return;
        if (e.pointerId !== undefined && e.pointerId !== pid) return;
        try {
            el.releasePointerCapture(pid);
        } catch (_) {}
        pid = null;
        if (moved) {
            const dockRect = dockEl.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const side = elRect.left + elRect.width / 2 < window.innerWidth / 2 ? "left" : "right";
            const topY = Math.max(0, Math.min(window.innerHeight - 76, dockRect.top));
            dockEl.dataset.side = side;
            dockEl.style.left = "";
            dockEl.style.right = "";
            dockEl.style.top = topY + "px";
            dockEl.classList.remove("dragging");
            draggingDock = false;
            try {
                localStorage.setItem("solarDockSide", side);
            } catch (_) {}
            try {
                localStorage.setItem("solarDockTop", topY);
            } catch (_) {}
        } else if (onClick) {
            onClick();
        }
        moved = false;
    };
    el.addEventListener("pointerup", endPointer);
    el.addEventListener("pointercancel", endPointer);
}

function bumpActivity() {
    lastActivity = performance.now();
    if (_uiIdle) {
        _uiIdle = false;
        document.body.classList.remove("ui-idle");
    }
}

function positionTexMenu(selectEl) {
    const menu = selectEl.querySelector(".tex-select-menu");
    const r = selectEl.querySelector(".tex-select-trigger").getBoundingClientRect();
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.style.bottom = "auto";
    const origin = menu.getBoundingClientRect();
    const ox = origin.left, oy = origin.top;
    menu.style.width = r.width + "px";
    menu.style.left = r.left - ox + "px";
    const need = menu.scrollHeight || 120;
    const topVp = window.innerHeight - r.bottom < need + 12 ? r.top - 4 - need : r.bottom + 4;
    menu.style.top = topVp - oy + "px";
}

function positionVisualMenu() {
    positionTexMenu(visualSelectEl);
}

function positionFpsMenu() {
    positionTexMenu(fpsSelectEl);
}

function positionBodyMenu() {
    const menu = bodySelectEl.querySelector(".tex-select-menu");
    if (!menu) return;
    const r = bodyTriggerEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const naturalH = menu.scrollHeight;
    let top, maxH;
    if (spaceBelow >= naturalH || spaceBelow >= spaceAbove) {
        maxH = Math.max(120, spaceBelow);
        top = r.bottom + 4;
    } else {
        maxH = Math.max(120, spaceAbove);
        top = Math.max(8, r.top - Math.min(naturalH, maxH) - 4);
    }
    menu.style.position = "fixed";
    menu.style.left = r.left + "px";
    menu.style.width = r.width + "px";
    menu.style.top = top + "px";
    menu.style.right = "auto";
    menu.style.maxHeight = maxH + "px";
    menu.style.overflowY = "auto";
}

function buildShortcutList(items) {
    shortcutListEl.innerHTML = "";
    items.forEach(([key, label]) => {
        const li = document.createElement("li");
        const kbd = document.createElement("kbd");
        kbd.textContent = key;
        const span = document.createElement("span");
        span.textContent = label;
        li.appendChild(kbd);
        li.appendChild(span);
        shortcutListEl.appendChild(li);
    });
}

function applyInputMode() {
    if (typeof window.wallpaperRegisterAudioListener === "function") {
        isWallpaperEngine = true;
    }
    const we = isWallpaperEngine;
    document.body.classList.toggle("wallpaper-mode", we);
    if (!inputModeReady) return;
    if (shortcutsTitleEl) {
        shortcutsTitleEl.textContent = we ? "Mouse Controls" : "Shortcuts";
    }
    if (shortcutListEl) {
        buildShortcutList(we ? MOUSE_CONTROLS : KEYBOARD_SHORTCUTS);
    }
}

function wireDock() {
    makeDraggable(dockHandleEl, () => {
        if (dockEl.classList.contains("collapsed")) showDock(); else hideDock();
    });
    document.querySelectorAll(".dock-section").forEach(section => {
        const header = section.querySelector(".dock-section-header");
        if (!header) return;
        setDockSectionOpen(section, section.classList.contains("open"));
        const toggle = () => {
            const isOpen = section.classList.contains("open");
            document.querySelectorAll(".dock-section").forEach(s => setDockSectionOpen(s, false));
            if (!isOpen) setDockSectionOpen(section, true);
            showDock();
        };
        makeDraggable(header, toggle);
        header.addEventListener("click", e => {
            if (e.detail === 0) toggle();
        });
    });
    (function dockSubgroupFolds() {
        const groups = [];
        for (const btn of document.querySelectorAll("#dock-body .dock-subgroup-title")) {
            const group = btn.closest(".dock-subgroup");
            if (group) groups.push({
                group: group,
                btn: btn
            });
        }
        const setOpen = ({group: group, btn: btn}, open) => {
            group.classList.toggle("folded", !open);
            group.querySelector(":scope > .dock-subgroup-panel")?.toggleAttribute("inert", !open);
            btn.setAttribute("aria-expanded", open ? "true" : "false");
        };
        for (const entry of groups) {
            const toggle = () => {
                const opening = entry.group.classList.contains("folded");
                for (const other of groups) {
                    if (other === entry || other.group.parentElement !== entry.group.parentElement) continue;
                    if (!other.group.classList.contains("folded")) setOpen(other, false);
                }
                setOpen(entry, opening);
            };
            setOpen(entry, false);
            makeDraggable(entry.btn, toggle);
            entry.btn.addEventListener("click", e => {
                if (e.detail === 0) toggle();
            });
        }
    })();
    dockBodyEl.addEventListener("mouseenter", () => {
        hoveringDockBody = true;
        lastActivity = performance.now();
    });
    dockBodyEl.addEventListener("mouseleave", () => {
        hoveringDockBody = false;
        lastActivity = performance.now();
    });
    setInterval(() => {
        if (draggingDock || hoveringDockBody) return;
        if (performance.now() - lastActivity >= IDLE_TIMEOUT_MS) {
            hideDock();
            if (!_uiIdle) {
                _uiIdle = true;
                document.body.classList.add("ui-idle");
            }
        }
    }, 250);
    try {
        const savedSide = localStorage.getItem("solarDockSide");
        if (savedSide === "left" || savedSide === "right") {
            dockEl.dataset.side = savedSide;
        }
        const savedTop = parseFloat(localStorage.getItem("solarDockTop"));
        if (!isNaN(savedTop)) {
            dockEl.style.top = Math.max(12, Math.min(window.innerHeight - 100, savedTop)) + "px";
        }
    } catch (e) {}
}
