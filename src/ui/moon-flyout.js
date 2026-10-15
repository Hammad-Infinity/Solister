function validMoonKeys(parentKey) {
    const moons = moonGroups[parentKey] || [];
    return moons.filter(key => {
        const opt = [ ...bodyOptionEls ].find(li => li.dataset.key === key);
        if (!opt || opt.hidden) return false;
        if (opt.getAttribute("aria-disabled") === "true") return false;
        return true;
    });
}

function showMoonFlyout(parentKey, anchorEl) {
    const keys = validMoonKeys(parentKey);
    if (!keys.length) {
        hideMoonFlyout(true);
        return;
    }
    clearTimeout(flyoutHideTimer);
    moonFlyout.innerHTML = "";
    for (const key of keys) {
        const facts = bodyFacts[key];
        if (!facts) continue;
        const item = document.createElement("button");
        item.type = "button";
        item.className = "moon-flyout-item";
        item.dataset.key = key;
        item.textContent = facts.name;
        item.addEventListener("click", e => {
            e.stopPropagation();
            hideMoonFlyout(true);
            bodySelectEl.classList.remove("open");
            const mesh = objectRegistry[key];
            const f = bodyFacts[key];
            if (!mesh || !f) return;
            if (mesh.userData.extraEphemeris && !mesh.visible) return;
            if (!solarAccuracy.available) return;
            syncBodySelect(key);
            focusOnObject(mesh);
            showFocusCard(f);
        });
        moonFlyout.appendChild(item);
    }
    moonFlyout.hidden = false;
    const r = anchorEl.getBoundingClientRect();
    const fw = moonFlyout.offsetWidth;
    const fh = moonFlyout.offsetHeight;
    const openRight = r.right + 6 + fw <= window.innerWidth - 8;
    const left = openRight ? r.right + 6 : r.left - fw - 6;
    const top = Math.max(8, Math.min(window.innerHeight - fh - 8, r.top));
    moonFlyout.style.left = left + "px";
    moonFlyout.style.top = top + "px";
}

function hideMoonFlyout(immediate = false) {
    clearTimeout(flyoutHideTimer);
    const doHide = () => {
        moonFlyout.hidden = true;
        moonFlyout.innerHTML = "";
    };
    if (immediate) doHide(); else flyoutHideTimer = setTimeout(doHide, 120);
}

function syncBodySelect(key) {
    let matched = false;
    bodyOptionEls.forEach(li => {
        const on = li.dataset.key === key;
        li.classList.toggle("active", on);
        if (on) matched = true;
    });
    if (matched && bodyFacts[key]) {
        bodyValueEl.textContent = bodyFacts[key].name;
    }
}

function resetBodySelect() {
    bodyValueEl.textContent = "Select a body…";
    bodyOptionEls.forEach(li => li.classList.remove("active"));
}

function wireMoonFlyouts() {
    const groupedKeys = new Set;
    for (const moons of Object.values(moonGroups)) {
        for (const key of moons) groupedKeys.add(key);
    }
    for (const li of bodyOptionEls) {
        if (groupedKeys.has(li.dataset.key)) li.classList.add("grouped");
    }
    for (const parentKey of Object.keys(moonGroups)) {
        const planetOption = [ ...bodyOptionEls ].find(li => li.dataset.key === parentKey);
        if (!planetOption) continue;
        planetOption.classList.add("has-moons");
        planetOption.addEventListener("mouseenter", () => showMoonFlyout(parentKey, planetOption));
        planetOption.addEventListener("mouseleave", () => hideMoonFlyout());
    }
    moonFlyout.addEventListener("mouseenter", () => clearTimeout(flyoutHideTimer));
    moonFlyout.addEventListener("mouseleave", () => hideMoonFlyout());
}
