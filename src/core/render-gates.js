export class LabelRenderGate {
    constructor(intervalMs = 1e3 / 30) {
        this.intervalMs = Math.max(1, intervalMs);
        this.lastNeeded = -Infinity;
        this.lastRender = -Infinity;
    }
    needsRender({showLabels: showLabels, conLabels: conLabels, starLabels: starLabels}, now) {
        const needed = !!(showLabels || conLabels || starLabels);
        if (needed) this.lastNeeded = now;
        if (!(needed || now - this.lastNeeded <= 500)) return false;
        if (now - this.lastRender < this.intervalMs - .5) return false;
        this.lastRender = now;
        return true;
    }
}
