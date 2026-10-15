const AU_KM = 149597870.7;

const kmFormat = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1
});

const auFormat = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4
});

const metreFormat = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
});

export function formatCameraDistance(sceneDistance, auUnits) {
    if (!Number.isFinite(sceneDistance) || sceneDistance < 0) return "";
    if (!(auUnits > 0) || !Number.isFinite(auUnits)) return "";
    const au = sceneDistance / auUnits;
    if (au >= 1) return auFormat.format(au) + " AU";
    const km = au * AU_KM;
    return km < 1 ? metreFormat.format(km * 1e3) + " m" : kmFormat.format(km) + " km";
}

export class CameraDistance {
    constructor({THREE: THREE, camera: camera, controls: controls, canvas: canvas, solarSystem: solarSystem, getFocused: getFocused, getSun: getSun, getName: getName, au: au, idleMs: idleMs = 3e3, now: now = () => performance.now(), eventTarget: eventTarget = window}) {
        Object.assign(this, {
            camera: camera,
            controls: controls,
            canvas: canvas,
            solarSystem: solarSystem,
            getFocused: getFocused,
            getSun: getSun,
            getName: getName,
            au: au,
            idleMs: idleMs,
            now: now
        });
        this.cameraWorld = new THREE.Vector3;
        this.bodyWorld = new THREE.Vector3;
        this.lastInput = -Infinity;
        this.timer = null;
        this.onChange = null;
        this.pointers = new Set;
        this.removeListeners = [];
        const listen = (target, name, fn) => {
            target.addEventListener(name, fn, {
                passive: true
            });
            this.removeListeners.push(() => target.removeEventListener(name, fn));
        };
        listen(canvas, "pointerdown", e => {
            if (!controls.enabled) return;
            this.pointers.add(e.pointerId);
            this.noteInput();
        });
        listen(eventTarget, "pointermove", e => {
            if (controls.enabled && this.pointers.has(e.pointerId)) this.noteInput();
        });
        for (const name of [ "pointerup", "pointercancel" ]) listen(eventTarget, name, e => this.pointers.delete(e.pointerId));
        listen(eventTarget, "blur", () => this.pointers.clear());
        listen(canvas, "wheel", () => {
            if (controls.enabled) this.noteInput();
        });
        const start = () => {
            if (controls.enabled) this.noteInput();
        };
        controls.addEventListener("start", start);
        this.removeListeners.push(() => controls.removeEventListener("start", start));
    }
    noteInput() {
        this.lastInput = this.now();
        if (this.timer === null) this.timer = setTimeout(() => this.checkIdle(), this.idleMs);
        this.onChange?.(false);
    }
    checkIdle() {
        this.timer = null;
        const remaining = this.idleMs - (this.now() - this.lastInput);
        if (remaining > 0) this.timer = setTimeout(() => this.checkIdle(), remaining); else this.onChange?.(true);
    }
    read() {
        if (this.now() - this.lastInput >= this.idleMs) return "";
        const focused = this.getFocused();
        const overview = !focused || focused === this.solarSystem || focused.userData?.planetKey === "solarsystem";
        const target = overview ? this.getSun() : focused;
        if (!target?.getWorldPosition) return "";
        this.camera.getWorldPosition(this.cameraWorld);
        target.getWorldPosition(this.bodyWorld);
        const distance = formatCameraDistance(this.cameraWorld.distanceTo(this.bodyWorld), this.au);
        if (!distance) return "";
        const name = overview ? "Sun" : this.getName(target);
        const reference = target.userData?.isPopulationAnchor ? "reference point" : "centre";
        return "Camera → " + (name || "focused body") + " " + reference + " · " + distance;
    }
    dispose() {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.lastInput = -Infinity;
        this.pointers.clear();
        for (const remove of this.removeListeners) remove();
        this.removeListeners.length = 0;
        this.onChange = null;
    }
}
