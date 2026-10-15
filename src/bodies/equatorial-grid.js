const GRID_BODIES = Object.freeze([ "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "moon", "pluto" ]);

const DEG = Math.PI / 180;

export class EquatorialGrid {
    constructor({THREE: THREE, objectRegistry: objectRegistry = {}, bodyShapes: bodyShapes, elevationCatalog: elevationCatalog = null}) {
        Object.assign(this, {
            THREE: THREE,
            objectRegistry: objectRegistry,
            bodyShapes: bodyShapes,
            elevationCatalog: elevationCatalog
        });
        this.focusedKey = null;
        this.enabled = new Set;
        this.layers = new Map;
    }
    supports(key) {
        return GRID_BODIES.includes(key);
    }
    isEnabled(key) {
        return this.enabled.has(key);
    }
    setFocused(key) {
        this.focusedKey = this.supports(key) ? key : null;
        for (const [bodyKey, previous] of [ ...this.layers ]) {
            const body = this.objectRegistry[bodyKey];
            if (!body || previous.body !== body || previous.group.parent !== body) {
                this.disposeLayer(previous);
                this.layers.delete(bodyKey);
                if (!body || !this.enabled.has(bodyKey)) continue;
                const replacement = this.createLayer(bodyKey, body);
                if (replacement) this.layers.set(bodyKey, replacement);
            }
            const layer = this.layers.get(bodyKey);
            if (layer) layer.group.visible = bodyKey === this.focusedKey && this.enabled.has(bodyKey);
        }
        if (this.focusedKey && this.enabled.has(this.focusedKey) && !this.layers.has(this.focusedKey)) {
            const body = this.objectRegistry[this.focusedKey];
            const layer = body && this.createLayer(this.focusedKey, body);
            if (layer) {
                this.layers.set(this.focusedKey, layer);
                layer.group.visible = true;
            }
        }
    }
    setEnabled(key, enabled) {
        if (!this.supports(key)) return false;
        if (!enabled) {
            this.enabled.delete(key);
            const layer = this.layers.get(key);
            if (layer) layer.group.visible = false;
            return true;
        }
        const body = this.objectRegistry[key];
        if (!body) return false;
        let layer = this.layers.get(key);
        if (!layer || layer.body !== body || layer.group.parent !== body) {
            if (layer) this.disposeLayer(layer);
            layer = this.createLayer(key, body);
            if (!layer) return false;
            this.layers.set(key, layer);
        }
        this.enabled.add(key);
        layer.group.visible = this.focusedKey === key;
        return true;
    }
    disposeLayer(layer) {
        if (!layer?.group) return;
        layer.group.traverse(object => {
            object.geometry?.dispose?.();
            const materials = Array.isArray(object.material) ? object.material : [ object.material ];
            for (const material of materials) {
                material?.map?.dispose?.();
                material?.dispose?.();
            }
        });
        layer.group.removeFromParent();
    }
    hideAll() {
        for (const layer of this.layers.values()) layer.group.visible = false;
    }
    makeLabel(text, scale) {
        if (typeof document === "undefined") return null;
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = "600 28px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(2, 8, 18, 0.9)";
        ctx.fillStyle = "rgba(214, 242, 255, 0.95)";
        ctx.strokeText(text, 128, 32);
        ctx.fillText(text, 128, 32);
        const texture = new this.THREE.CanvasTexture(canvas);
        texture.colorSpace = this.THREE.SRGBColorSpace;
        texture.minFilter = this.THREE.LinearFilter;
        const geometry = new this.THREE.PlaneGeometry(scale * 2.6, scale * .68);
        const material = new this.THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            toneMapped: false
        });
        const label = new this.THREE.Mesh(geometry, material);
        label.renderOrder = 4;
        label.userData.isEquatorialGridLabel = true;
        label.raycast = () => {};
        return label;
    }
    pointAt(key, latitudeDeg, longitudeDeg, altitudeKm, unitsPerKm = this.layers.get(key)?.unitsPerKm || 1) {
        const axes = this.bodyShapes.axesKm[key] || [ 1, 1, 1 ];
        const [a, b, c] = axes;
        const lat = latitudeDeg * DEG, lon = longitudeDeg * DEG;
        const cp = Math.cos(lat);
        const x = cp * Math.sin(lon), y = Math.sin(lat), z = cp * Math.cos(lon);
        const ellipsoidRadius = 1 / Math.sqrt((x / a) ** 2 + (y / c) ** 2 + (z / b) ** 2);
        const radiusKm = ellipsoidRadius + altitudeKm;
        return new this.THREE.Vector3(x * radiusKm * unitsPerKm, y * radiusKm * unitsPerKm, z * radiusKm * unitsPerKm);
    }
    surfaceFrame(key, latitudeDeg, longitudeDeg, point) {
        const T = this.THREE;
        const [a, b, c] = this.bodyShapes.axesKm[key] || [ 1, 1, 1 ];
        const normal = new T.Vector3(point.x / (a * a), point.y / (c * c), point.z / (b * b)).normalize();
        const lon = longitudeDeg * DEG;
        const east = new T.Vector3(Math.cos(lon), 0, -Math.sin(lon));
        east.addScaledVector(normal, -east.dot(normal)).normalize();
        const north = (new T.Vector3).crossVectors(normal, east).normalize();
        const basis = (new T.Matrix4).makeBasis(east, north, normal);
        const quaternion = (new T.Quaternion).setFromRotationMatrix(basis);
        return {
            normal: normal,
            quaternion: quaternion
        };
    }
    createLayer(key, body) {
        const geometryRadius = body.geometry?.parameters?.radius;
        const axes = body.geometry?.userData?.referenceAxesKm || this.bodyShapes.axesKm[key];
        if (!(geometryRadius > 0) || !axes?.length) return null;
        const referenceKm = Math.max(...axes);
        const unitsPerKm = geometryRadius / referenceKm;
        const maximumReliefM = this.elevationCatalog?.getMaxElevationM(key) || 0;
        const altitudeKm = Math.max(.5, maximumReliefM / 1e3 + .75);
        const group = new this.THREE.Group;
        group.name = `${key}-equatorial-grid`;
        group.visible = false;
        group.renderOrder = 4;
        group.userData.isEquatorialGrid = true;
        body.add(group);
        const lines = [];
        const pushLine = (latitude, longitude, steps, fixedLatitude) => {
            for (let i = 0; i < steps; i++) {
                const t0 = i / steps, t1 = (i + 1) / steps;
                const lat0 = fixedLatitude ? latitude : -89.75 + 179.5 * t0;
                const lat1 = fixedLatitude ? latitude : -89.75 + 179.5 * t1;
                const lon0 = fixedLatitude ? longitude + t0 * 360 : longitude;
                const lon1 = fixedLatitude ? longitude + t1 * 360 : longitude;
                const p0 = this.pointAt(key, lat0, lon0, altitudeKm, unitsPerKm);
                const p1 = this.pointAt(key, lat1, lon1, altitudeKm, unitsPerKm);
                lines.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
            }
        };
        for (let latitude = -75; latitude <= 75; latitude += 15) pushLine(latitude, 0, 360, true);
        for (let longitude = 0; longitude < 360; longitude += 15) pushLine(0, longitude, 180, false);
        const positions = new Float32Array(lines);
        const lineGeometry = new this.THREE.BufferGeometry;
        lineGeometry.setAttribute("position", new this.THREE.BufferAttribute(positions, 3));
        lineGeometry.computeBoundingSphere();
        const lineMaterial = new this.THREE.LineBasicMaterial({
            color: key === "earth" ? 8183295 : 10870783,
            transparent: true,
            opacity: .58,
            depthTest: true,
            depthWrite: false,
            blending: this.THREE.AdditiveBlending,
            toneMapped: false
        });
        const lineSegments = new this.THREE.LineSegments(lineGeometry, lineMaterial);
        lineSegments.name = `${key}-equatorial-grid-lines`;
        lineSegments.renderOrder = 4;
        lineSegments.frustumCulled = true;
        lineSegments.raycast = () => {};
        group.add(lineSegments);
        const labelScale = geometryRadius * .055;
        const labelSpecs = [ [ 0, 0, "0° E" ], [ 0, 90, "90° E" ], [ 0, 180, "180°" ], [ 0, 270, "90° W" ], [ 30, 0, "30° N" ], [ -30, 0, "30° S" ], [ 60, 0, "60° N" ], [ -60, 0, "60° S" ] ];
        for (const [latitude, longitude, text] of labelSpecs) {
            const label = this.makeLabel(text, labelScale);
            if (!label) continue;
            const pos = this.pointAt(key, latitude, longitude, altitudeKm + .12, unitsPerKm);
            const {normal: normal, quaternion: quaternion} = this.surfaceFrame(key, latitude, longitude, pos);
            label.position.copy(pos);
            label.quaternion.copy(quaternion);
            label.userData.surfaceNormal = normal;
            group.add(label);
        }
        return {
            body: body,
            group: group,
            unitsPerKm: unitsPerKm,
            altitudeKm: altitudeKm
        };
    }
    dispose() {
        for (const layer of this.layers.values()) this.disposeLayer(layer);
        this.layers.clear();
        this.enabled.clear();
        this.focusedKey = null;
    }
}
