const DEG = Math.PI / 180;

const EPS = 23.4392911 * DEG;

const COS_E = Math.cos(EPS);

const SIN_E = Math.sin(EPS);

const R00 = -.0548755604162154, R01 = -.873437090234885, R02 = -.4838350155487132;

const R10 = .4941094278755837, R11 = -.4448296299600112, R12 = .746982244497219;

const R20 = -.8676661490190047, R21 = -.1980763734312015, R22 = .4559837761750669;

const RES_ORDER = [ "16k", "8k", "4k", "2k" ];

export const SKY_RADIUS = 8e6;

export const MILKYWAY_EXPOSURE = 12.5;

const MILKYWAY_EXPOSURE_RES_FACTOR = {
    "2k": .98,
    "4k": .965,
    "8k": .95,
    "16k": .935
};

function milkywayExposureForResolution(exposure, resolution) {
    const base = Number.isFinite(exposure) ? exposure : MILKYWAY_EXPOSURE;
    return base * (MILKYWAY_EXPOSURE_RES_FACTOR[resolution] || MILKYWAY_EXPOSURE_RES_FACTOR["4k"]);
}

export const SKY_LAYER_DEFS = {
    milkyway: {
        frame: "equatorial",
        file: "milky_way.ktx2"
    },
    celgrid: {
        frame: "equatorial"
    },
    eclipticgrid: {
        frame: "ecliptic"
    },
    galacticgrid: {
        frame: "galactic"
    }
};

function buildEquirectSphere(THREE, frame, lonSegs = 360, latSegs = 180) {
    const vcount = (lonSegs + 1) * (latSegs + 1);
    const pos = new Float32Array(vcount * 3);
    const uv = new Float32Array(vcount * 2);
    const idx = new Uint32Array(lonSegs * latSegs * 6);
    let p = 0, q = 0;
    for (let iy = 0; iy <= latSegs; iy++) {
        const v = iy / latSegs;
        const lat = (90 - 180 * v) * DEG;
        for (let ix = 0; ix <= lonSegs; ix++) {
            const u = ix / lonSegs;
            const lon = ((180 - 360 * u) % 360 + 360) % 360 * DEG;
            const cl = Math.cos(lat);
            const sl = Math.sin(lat);
            const cx = cl * Math.cos(lon);
            const cy = cl * Math.sin(lon);
            const cz = sl;
            let x, y, z;
            if (frame === "ecliptic") {
                x = cx;
                y = cy * COS_E - cz * SIN_E;
                z = cy * SIN_E + cz * COS_E;
            } else if (frame === "galactic") {
                const l = ((540 - 360 * u) % 360 + 360) % 360 * DEG;
                const glx = cl * Math.cos(l);
                const gly = cl * Math.sin(l);
                const glz = sl;
                x = R00 * glx + R10 * gly + R20 * glz;
                y = R01 * glx + R11 * gly + R21 * glz;
                z = R02 * glx + R12 * gly + R22 * glz;
            } else {
                x = cx;
                y = cy;
                z = cz;
            }
            const Y = y * COS_E + z * SIN_E;
            const Z = -y * SIN_E + z * COS_E;
            pos[p++] = x;
            pos[p++] = Z;
            pos[p++] = -Y;
            uv[q++] = u;
            uv[q++] = 1 - v;
        }
    }
    let t = 0;
    for (let iy = 0; iy < latSegs; iy++) {
        for (let ix = 0; ix < lonSegs; ix++) {
            const a = iy * (lonSegs + 1) + ix;
            const b = a + 1;
            const c = a + lonSegs + 1;
            const d = c + 1;
            idx[t++] = a;
            idx[t++] = c;
            idx[t++] = d;
            idx[t++] = a;
            idx[t++] = d;
            idx[t++] = b;
        }
    }
    const g = new THREE.BufferGeometry;
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
}

function coordinateToScene(THREE, frame, lonDeg, latDeg, out = new THREE.Vector3) {
    const lon = lonDeg * DEG, lat = latDeg * DEG;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    const cx = cl * Math.cos(lon), cy = cl * Math.sin(lon), cz = sl;
    let x, y, z;
    if (frame === "ecliptic") {
        x = cx;
        y = cy * COS_E - cz * SIN_E;
        z = cy * SIN_E + cz * COS_E;
    } else if (frame === "galactic") {
        x = R00 * cx + R10 * cy + R20 * cz;
        y = R01 * cx + R11 * cy + R21 * cz;
        z = R02 * cx + R12 * cy + R22 * cz;
    } else {
        x = cx;
        y = cy;
        z = cz;
    }
    const Y = y * COS_E + z * SIN_E, Z = -y * SIN_E + z * COS_E;
    return out.set(x, Z, -Y);
}

function buildCoordinateGrid(THREE, frame) {
    const vertices = [];
    const addLine = points => {
        for (let i = 1; i < points.length; i++) {
            vertices.push(points[i - 1].x, points[i - 1].y, points[i - 1].z, points[i].x, points[i].y, points[i].z);
        }
    };
    for (let lat = -75; lat <= 75; lat += 15) {
        const points = [];
        for (let lon = 0; lon <= 360; lon += 1) points.push(coordinateToScene(THREE, frame, lon, lat));
        addLine(points);
    }
    for (let lon = 0; lon < 360; lon += 15) {
        const points = [];
        for (let lat = -82; lat <= 82; lat += 1) points.push(coordinateToScene(THREE, frame, lon, lat));
        addLine(points);
    }
    for (const lat of [ -82, 82 ]) {
        const points = [];
        for (let lon = 0; lon <= 360; lon += 1) points.push(coordinateToScene(THREE, frame, lon, lat));
        addLine(points);
    }
    const geometry = new THREE.BufferGeometry;
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    return geometry;
}

const GRID_LABEL_TEXTURES = new Map;

const GRID_LABEL_MATERIALS = new Map;

function makeGridLabelSprite(THREE, text, color, width) {
    const key = `${text}|${color}`;
    let texture = GRID_LABEL_TEXTURES.get(key);
    if (!texture) {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 160;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = "600 116px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 12;
        ctx.strokeStyle = "rgba(0,0,0,.55)";
        ctx.strokeText(text, 320, 80);
        ctx.fillStyle = color;
        ctx.fillText(text, 320, 80);
        texture = new THREE.CanvasTexture(canvas);
        if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
        GRID_LABEL_TEXTURES.set(key, texture);
    }
    let material = GRID_LABEL_MATERIALS.get(key);
    if (!material) {
        material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            toneMapped: false,
            opacity: .78
        });
        GRID_LABEL_MATERIALS.set(key, material);
    }
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(width, width * .3, 1);
    return sprite;
}

const SKY_VERT = `\n    varying vec2 vUv;\n    varying vec3 vSkyDirection;\n    void main() {\n        vUv = uv;\n        vSkyDirection=position;\n        vec4 mv = modelViewMatrix * vec4(position, 1.0);\n        gl_Position = projectionMatrix * mv;\n        gl_Position.z = gl_Position.w;\n    }\n`;

export class SkyMaps {
    constructor(o) {
        this.THREE = o.THREE;
        this.scene = o.scene;
        this.renderer = o.renderer;
        this.basePath = o.basePath || "./assets/textures";
        this.resolution = RES_ORDER.includes(o.resolution) ? o.resolution : "2k";
        this.makeLoader = o.makeLoader || null;
        this._fallbackLoader = new this.THREE.TextureLoader;
        this.onLoadStart = o.onLoadStart || null;
        this.onLoadEnd = o.onLoadEnd || null;
        this.milkywayOpacity = o.milkywayOpacity ?? 1;
        this.milkywayBaseExposure = o.milkywayExposure ?? MILKYWAY_EXPOSURE;
        this.milkywayExposure = milkywayExposureForResolution(this.milkywayBaseExposure, this.resolution);
        this.milkywayStretch = o.milkywayStretch ?? 40;
        this.milkywayGamma = o.milkywayGamma ?? 1.15;
        this.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy() || 1);
        this.domeRadius = o.radius ?? SKY_RADIUS;
        this.group = new this.THREE.Group;
        this.group.name = "sky-maps";
        this.group.matrixAutoUpdate = true;
        this.scene.add(this.group);
        this._geoCache = new Map;
        this._texCache = new Map;
        this._inflight = new Map;
        this._state = {};
        this._tmpV = new this.THREE.Vector3;
        this._buildLayers();
        if (this._state.milkyway?.mesh?.material?.uniforms?.uExposure) {
            this._state.milkyway.mesh.material.uniforms.uExposure.value = this.milkywayExposure;
        }
        const tmp = this._tmpV;
        const self = this;
        const snap = (renderer, scene, camera) => {
            if (!camera) return;
            camera.getWorldPosition(tmp);
            self.group.position.copy(tmp);
            self.group.scale.setScalar(self.domeRadius);
            self.group.updateMatrixWorld(true);
        };
        this.group.traverse(obj => {
            if (obj.isMesh) {
                obj.onBeforeRender = snap;
                obj.frustumCulled = false;
            }
        });
        this.group.scale.setScalar(this.domeRadius);
    }
    _recordIssue(layer, url, error) {
        try {
            const item = {
                time: Date.now(),
                type: "sky-texture",
                layer: layer,
                url: url || "",
                message: String(error?.message || error || "")
            };
            const list = globalThis.__solisterTextureErrors || (globalThis.__solisterTextureErrors = []);
            list.push(item);
            if (list.length > 120) list.splice(0, list.length - 120);
            if (globalThis.dispatchEvent && globalThis.CustomEvent) globalThis.dispatchEvent(new globalThis.CustomEvent("solister-texture-error", {
                detail: item
            }));
        } catch (e) {}
    }
    _geometry(frame) {
        if (!this._geoCache.has(frame)) this._geoCache.set(frame, buildEquirectSphere(this.THREE, frame));
        return this._geoCache.get(frame);
    }
    _buildLayers() {
        const T = this.THREE;
        {
            const mat = new T.ShaderMaterial({
                uniforms: {
                    uMap: {
                        value: null
                    },
                    uExposure: {
                        value: this.milkywayExposure
                    },
                    uOpacity: {
                        value: this.milkywayOpacity
                    },
                    uHasMap: {
                        value: 0
                    },
                    uStretch: {
                        value: this.milkywayStretch ?? 40
                    },
                    uTexelSize: {
                        value: new T.Vector2(1 / 4096, 1 / 2048)
                    },
                    uStarSharpness: {
                        value: 1.35
                    },
                    uDenoise: {
                        value: .78
                    },
                    uStarGain: {
                        value: 1.35
                    },
                    uSaturation: {
                        value: 1.32
                    },
                    uGamma: {
                        value: this.milkywayGamma ?? 1.15
                    }
                },
                vertexShader: SKY_VERT,
                fragmentShader: `\n                    uniform sampler2D uMap;\n                    uniform float uExposure;\n                    uniform float uOpacity;\n                    uniform float uHasMap;\n                    uniform float uStretch;\n                    uniform float uGamma;\n                    uniform vec2 uTexelSize;\n                    uniform float uStarSharpness;\n                    uniform float uDenoise;\n                    uniform float uStarGain;\n                    uniform float uSaturation;\n                    varying vec3 vSkyDirection;\n                    vec4 skySample(vec2 uv,vec2 dx,vec2 dy){\n                        #if __VERSION__ >= 300\n                        return textureGrad(uMap,uv,dx,dy);\n                        #elif defined(GL_EXT_shader_texture_lod)\n                        return texture2DGradEXT(uMap,uv,dx,dy);\n                        #else\n                        return texture2D(uMap,uv);\n                        #endif\n                    }\n                    void main() {\n                        vec3 direction=normalize(vSkyDirection);\n                        vec3 equatorial=vec3(direction.x,-direction.y*0.3977771559319137-direction.z*0.9174820620691818,direction.y*0.9174820620691818-direction.z*0.3977771559319137);\n                        float longitude=length(equatorial.xy)>0.0000001?atan(equatorial.y,equatorial.x):0.0;\n                        vec2 vUv=vec2(fract(0.5-longitude/6.283185307179586),0.5+asin(clamp(equatorial.z,-1.0,1.0))/3.141592653589793);\n                        vec2 dx=uTexelSize,dy=uTexelSize;\n                        #if __VERSION__ >= 300 || defined(GL_OES_standard_derivatives)\n                        dx=dFdx(vUv);dy=dFdy(vUv);\n                        dx.x-=floor(dx.x+0.5);dy.x-=floor(dy.x+0.5);\n                        #endif\n                        vec3 c = uHasMap > 0.5 ? skySample(vUv,dx,dy).rgb : vec3(0.0);\n                        float starCore = 0.0;\n                        vec3 starGlow = vec3(0.0);\n                        if (uHasMap > 0.5 && (uStarSharpness > 0.0 || uDenoise > 0.0 || uStarGain > 0.0)) {\n                            vec2 footprint=vec2(length(vec2(dx.x,dy.x)),length(vec2(dx.y,dy.y)));\n                            vec2 stepUV = max(uTexelSize, footprint);\n                            vec3 mean = c * 4.0;\n                            vec3 localMin = c, localMax = c;\n                            for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++) {\n                                if(x==0 && y==0)continue;\n                                vec2 uv = vUv + vec2(float(x),float(y))*stepUV;\n                                uv.x = fract(uv.x);\n                                uv.y = clamp(uv.y,uTexelSize.y*.5,1.0-uTexelSize.y*.5);\n                                vec3 sampleColor = skySample(uv,dx,dy).rgb;\n                                float weight = (x==0 || y==0) ? 2.0 : 1.0;\n                                mean += sampleColor * weight;\n                                localMin = min(localMin,sampleColor);\n                                localMax = max(localMax,sampleColor);\n                            }\n                            mean /= 16.0;\n                            vec3 detail = c - mean;\n                            const vec3 luma = vec3(0.2126,0.7152,0.0722);\n                            float centerL = dot(c,luma), meanL = dot(mean,luma);\n                            float delta = centerL - meanL;\n                            float noiseFloor = 0.0007 + meanL * 0.035;\n                            float signal = smoothstep(noiseFloor*1.6,noiseFloor*5.0,abs(delta));\n                            signal = max(signal,smoothstep(noiseFloor*4.0,noiseFloor*14.0,\n                                                          dot(localMax-localMin,luma)));\n                            float contrast = abs(delta)/max(max(centerL,meanL),0.002);\n                            float compact = smoothstep(0.04,0.24,contrast) * signal;\n                            starCore = compact * smoothstep(0.0,noiseFloor*2.0,delta);\n                            vec3 clean = mix(c,mean,uDenoise*(1.0-signal));\n                            c = clean + detail*uStarSharpness*1.6*compact;\n                            c = max(localMin,c);\n                            c += max(detail,vec3(0.0))*uStarGain*compact;\n                            vec3 floorColor = localMin, wideMax=localMax;\n                            for(int j=0;j<4;j++){\n                                vec2 offset = j==0?vec2(3.0,0.0):j==1?vec2(-3.0,0.0):j==2?vec2(0.0,3.0):vec2(0.0,-3.0);\n                                vec2 q=vUv+offset*stepUV;q.x=fract(q.x);q.y=clamp(q.y,uTexelSize.y*.5,1.0-uTexelSize.y*.5);\n                                vec3 wide=skySample(q,dx,dy).rgb;floorColor=min(floorColor,wide);wideMax=max(wideMax,wide);\n                            }\n                            float floorLum=dot(floorColor,luma),peakLum=mix(dot(wideMax,luma),dot(localMax,luma),smoothstep(noiseFloor,noiseFloor*3.0,delta));\n                            float prominence=smoothstep(noiseFloor*4.0,noiseFloor*14.0,peakLum-floorLum);\n                            float concentration=clamp((centerL-floorLum)/max(peakLum-floorLum,0.00001),0.0,1.0);\n                            vec3 nearbyStars=max(mean-floorColor,vec3(0.0));\n                            float nearbySignal=smoothstep(noiseFloor*3.0,noiseFloor*14.0,peakLum-floorLum);\n                            nearbySignal*=smoothstep(0.05,0.32,(peakLum-floorLum)/max(peakLum,0.002));\n                            starGlow=nearbyStars*nearbySignal*0.06;\n                            float pointWeight=pow(concentration,4.0);\n                            vec3 tight=floorColor+max(c-floorColor,vec3(0.0))*pointWeight*1.42;\n                            c=mix(c,tight,prominence*min(uStarSharpness,1.0));\n                        }\n                        float expGain = max(uExposure, 0.01);\n                        float k = max(uStretch, 1.0);\n                        vec3 x = c * expGain;\n                        #if __VERSION__ >= 300\n                        vec3 stretched=asinh(x*k)/asinh(k);\n                        #else\n                        vec3 stretched=log(x*k+sqrt(x*x*k*k+vec3(1.0)))/log(k+sqrt(k*k+1.0));\n                        #endif\n                        vec3 col = pow(max(stretched, 0.0), vec3(1.0 / max(uGamma, 0.5)));\n                        col = col / (1.0 + col * 0.35);\n                        col *= vec3(1.08, 0.96, 0.88);\n                        col *= 1.0 + uStarGain * 0.35 * starCore;\n                        float luminance = dot(col, vec3(0.2126, 0.7152, 0.0722));\n                        col = mix(vec3(luminance), col, max(0.0, uSaturation));\n                        col+=sqrt(max(starGlow*expGain,vec3(0.0)))*0.085;\n                        float poleFade=1.0-smoothstep(0.94,1.0,abs(vUv.y*2.0-1.0));\n                        col *= uOpacity * poleFade;\n                        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);\n                    }\n                `,
                side: T.DoubleSide,
                depthWrite: false,
                depthTest: true,
                transparent: false,
                blending: T.NormalBlending,
                toneMapped: false,
                fog: false
            });
            mat.extensions = {
                derivatives: true,
                shaderTextureLOD: true
            };
            const mesh = new T.Mesh(this._geometry("equatorial"), mat);
            mesh.frustumCulled = false;
            mesh.renderOrder = -2100;
            mesh.visible = false;
            mesh.name = "sky-milkyway";
            this.group.add(mesh);
            this._state.milkyway = {
                mesh: mesh,
                ready: false,
                res: null,
                visible: false,
                exposure: this.milkywayExposure
            };
        }
        const addGridLayer = (key, frame, name, renderOrder, color) => {
            const hex = `#${Number(color).toString(16).padStart(6, "0")}`;
            const mat = new T.ShaderMaterial({
                uniforms: {
                    uOpacity: {
                        value: .5
                    },
                    uColor: {
                        value: new T.Color(color)
                    }
                },
                vertexShader: `varying float vViewZ; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vViewZ=mv.z; gl_Position=projectionMatrix*mv; }`,
                fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying float vViewZ; void main(){ if(vViewZ>=0.0) discard; gl_FragColor=vec4(uColor*uOpacity,uOpacity); }`,
                transparent: true,
                blending: T.AdditiveBlending,
                depthWrite: false,
                depthTest: true,
                toneMapped: false,
                fog: false
            });
            const gridGroup = new T.Group;
            gridGroup.name = name;
            const lines = new T.LineSegments(buildCoordinateGrid(T, frame), mat);
            lines.frustumCulled = false;
            lines.renderOrder = renderOrder;
            gridGroup.add(lines);
            const labelAt = (text, lon, lat) => {
                const width = Math.min(.06, 15 * Math.PI / 180 * Math.cos(lat * Math.PI / 180) * .92);
                const sprite = makeGridLabelSprite(T, text, hex, width);
                if (!sprite) return;
                sprite.position.copy(coordinateToScene(T, frame, lon, lat)).multiplyScalar(1.001);
                sprite.renderOrder = renderOrder + 1;
                gridGroup.add(sprite);
            };
            const markerLats = [ -82, -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 82 ];
            for (const lat of markerLats) {
                for (let lon = 0; lon < 360; lon += 15) {
                    let longitudeLabel, latitudeLabel;
                    if (frame === "equatorial") {
                        longitudeLabel = `${String(Math.round(lon / 15)).padStart(2, "0")}h`;
                        latitudeLabel = `${lat < 0 ? "-" : ""}${Math.abs(lat)}°`;
                    } else if (frame === "ecliptic") {
                        longitudeLabel = `λ ${String(lon).padStart(3, "0")}°`;
                        latitudeLabel = `β ${lat > 0 ? "+" : ""}${lat}°`;
                    } else {
                        longitudeLabel = `l ${String(lon).padStart(3, "0")}°`;
                        latitudeLabel = `b ${lat > 0 ? "+" : ""}${lat}°`;
                    }
                    labelAt(longitudeLabel, lon - 1, lat + 1);
                    labelAt(latitudeLabel, lon + 1, lat - 1);
                }
            }
            gridGroup.material = mat;
            this.group.add(gridGroup);
            this._state[key] = {
                mesh: gridGroup,
                ready: true,
                res: "procedural",
                visible: false,
                procedural: true
            };
        };
        addGridLayer("celgrid", "equatorial", "sky-equatorial-grid", -1800, 14411508);
        addGridLayer("eclipticgrid", "ecliptic", "sky-ecliptic-grid", -1790, 15784358);
        addGridLayer("galacticgrid", "galactic", "sky-galactic-grid", -1780, 13681650);
    }
    _gpuCap() {
        const m = this.renderer.capabilities.maxTextureSize || 4096;
        return m >= 16384 ? "16k" : m >= 8192 ? "8k" : m >= 4096 ? "4k" : "2k";
    }
    _chain(layer, reqRes) {
        const gpu = this._gpuCap();
        const supports16k = gpu === "16k";
        const unique = items => items.filter((item, index) => RES_ORDER.includes(item) && items.indexOf(item) === index);
        if (layer === "milkyway") {
            if (reqRes === "16k") return unique(supports16k ? [ "16k", "8k", "4k" ] : [ "8k", "4k" ]);
            if (reqRes === "8k") return [ "8k", "4k" ];
            return [ "4k", "8k" ];
        }
        const isCelestialGrid = layer === "celgrid" || layer === "eclipticgrid" || layer === "galacticgrid";
        if (isCelestialGrid && reqRes === "16k") {
            return unique(supports16k ? [ "16k", "8k", "4k", "2k" ] : [ "8k", "4k", "2k" ]);
        }
        const isResolutionTieredGrid = layer === "celgrid" || layer === "eclipticgrid" || layer === "galacticgrid";
        if (isResolutionTieredGrid) {
            if (reqRes === "16k") return unique(supports16k ? [ "16k", "8k", "4k" ] : [ "8k", "4k" ]);
            if (reqRes === "8k") return [ "8k", "4k" ];
            return [ "4k", "8k" ];
        }
        const requested = reqRes === "16k" ? "8k" : reqRes;
        if (requested === "8k") return [ "8k", "4k", "2k" ];
        if (requested === "4k") return [ "4k", "2k", "8k" ];
        return [ "2k", "4k", "8k" ];
    }
    _loadUrl(url) {
        return new Promise((resolve, reject) => {
            if (this.onLoadStart) this.onLoadStart();
            const doneOK = tex => {
                if (this.onLoadEnd) this.onLoadEnd();
                resolve(tex);
            };
            const doneErr = (error = null) => {
                if (this.onLoadEnd) this.onLoadEnd();
                reject(error || new Error("404 " + url));
            };
            try {
                const loader = this.makeLoader ? this.makeLoader("sky") : this._fallbackLoader;
                loader.load(url, doneOK, undefined, doneErr);
            } catch (e) {
                if (this.onLoadEnd) this.onLoadEnd();
                reject(e);
            }
        });
    }
    _disposeTex(key) {
        const t = this._texCache.get(key);
        if (t) {
            t.dispose();
            this._texCache.delete(key);
        }
    }
    _installTexture(layer, tex, res) {
        const st = this._state[layer];
        if (!st) return;
        tex.colorSpace = this.THREE.SRGBColorSpace;
        tex.anisotropy = this.anisotropy;
        tex.minFilter = this.THREE.LinearMipmapLinearFilter;
        tex.magFilter = this.THREE.LinearFilter;
        tex.generateMipmaps = !tex.isCompressedTexture;
        tex.wrapS = this.THREE.RepeatWrapping;
        tex.wrapT = this.THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        const mat = st.mesh.material;
        if (mat.uniforms && mat.uniforms.uMap) {
            mat.uniforms.uMap.value = tex;
            if (mat.uniforms.uTexelSize) {
                const image = tex.image || tex.source?.data || {};
                const width = image.width || tex.mipmaps?.[0]?.width || 4096;
                const height = image.height || tex.mipmaps?.[0]?.height || Math.max(1, width / 2);
                mat.uniforms.uTexelSize.value.set(1 / width, 1 / height);
            }
            if (mat.uniforms.uHasMap) mat.uniforms.uHasMap.value = 1;
            mat.uniformsNeedUpdate = true;
        } else {
            mat.map = tex;
            mat.needsUpdate = true;
        }
        st.ready = true;
        st.res = res || st.res || this.resolution;
        st.mesh.visible = st.visible;
    }
    adoptTexture(layer, texture, res = null) {
        if (!this._state[layer] || !texture) return false;
        const key = `${layer}@adopted`;
        this._texCache.set(key, texture);
        this._installTexture(layer, texture, res || this.resolution);
        return true;
    }
    async _ensureTexture(layer) {
        const st = this._state[layer];
        if (st?.procedural) return true;
        const def = SKY_LAYER_DEFS[layer];
        if (!def || !st) return false;
        const chain = this._chain(layer, this.resolution);
        const wantRes = chain[0];
        if (st.ready && st.res && (st.res === wantRes || st.res === "adopted")) return true;
        if (this._inflight.has(layer)) return this._inflight.get(layer);
        const job = (async () => {
            for (const res of chain) {
                const key = `${layer}@${res}`;
                let tex = this._texCache.get(key);
                try {
                    if (!tex) {
                        const files = def.files ? [ ...def.files ] : [ def.file ];
                        const candidates = layer === "celgrid" ? files.flatMap(file => [ `./textures/${res}/${file}`, `${this.basePath}/${res}/${file}` ]) : files.map(file => `${this.basePath}/${res}/${file}`);
                        let lastErr = null;
                        for (const url of candidates) {
                            try {
                                tex = await this._loadUrl(url);
                                break;
                            } catch (err) {
                                lastErr = err;
                            }
                        }
                        if (!tex) throw lastErr || new Error("no url for " + layer);
                        this._texCache.set(key, tex);
                    }
                    for (const r of RES_ORDER) if (r !== res) this._disposeTex(`${layer}@${r}`);
                    this._installTexture(layer, tex, res);
                    return true;
                } catch (e) {}
            }
            this._recordIssue(layer, null, "no usable texture in " + chain.join("/"));
            st.ready = false;
            st.res = null;
            st.mesh.visible = false;
            return false;
        })();
        this._inflight.set(layer, job);
        try {
            return await job;
        } finally {
            this._inflight.delete(layer);
        }
    }
    setLayerVisible(layer, visible) {
        const st = this._state[layer];
        if (!st) return;
        st.visible = !!visible;
        if (st.procedural) {
            st.mesh.visible = !!visible;
            if (visible && !st._notifiedVisible) {
                st._notifiedVisible = true;
                if (this.onVisibilityApplied) this.onVisibilityApplied();
            }
            if (!visible) st._notifiedVisible = false;
            return;
        }
        if (visible) {
            if (st.ready && st.mesh.material?.uniforms?.uMap?.value) {
                st.mesh.visible = true;
            }
            this._ensureTexture(layer).then(() => {
                if (!st.visible) return;
                st.mesh.visible = !!st.ready;
                if (!st._notifiedVisible) {
                    st._notifiedVisible = true;
                    if (this.onVisibilityApplied) this.onVisibilityApplied();
                }
            });
        } else {
            st._notifiedVisible = false;
            st.mesh.visible = false;
        }
    }
    isLayerVisible(layer) {
        return !!this._state[layer]?.visible;
    }
    layerReady(layer) {
        return !!this._state[layer]?.ready;
    }
    layerRes(layer) {
        return this._state[layer]?.res || null;
    }
    setBrightness(layer, k) {
        const st = this._state[layer];
        if (!st) return;
        const u = st.mesh.material.uniforms;
        if (!u) return;
        if (layer === "milkyway" && u.uExposure) {
            u.uExposure.value = k;
            st.exposure = k;
        } else if (u.uOpacity) {
            u.uOpacity.value = k;
        }
        st.mesh.material.uniformsNeedUpdate = true;
    }
    setMilkywayExposure(exposure = null) {
        if (Number.isFinite(exposure)) this.milkywayBaseExposure = exposure;
        if (!Number.isFinite(this.milkywayBaseExposure)) this.milkywayBaseExposure = MILKYWAY_EXPOSURE;
        const resolved = milkywayExposureForResolution(this.milkywayBaseExposure, this.resolution);
        this.milkywayExposure = resolved;
        this.setBrightness("milkyway", resolved);
    }
    getMilkywayExposure() {
        const u = this._state.milkyway?.mesh?.material?.uniforms;
        return u?.uExposure?.value ?? this.milkywayExposure ?? MILKYWAY_EXPOSURE;
    }
    setStarSharpness(value) {
        const uniform = this._state.milkyway?.mesh.material.uniforms.uStarSharpness;
        if (uniform && Number.isFinite(value)) uniform.value = Math.max(0, Math.min(1.5, value));
    }
    setMilkywayDenoise(value) {
        const uniform = this._state.milkyway?.mesh.material.uniforms.uDenoise;
        if (uniform && Number.isFinite(value)) uniform.value = Math.max(0, Math.min(1, value));
    }
    setStarGain(value) {
        const uniform = this._state.milkyway?.mesh.material.uniforms.uStarGain;
        if (uniform && Number.isFinite(value)) uniform.value = Math.max(0, Math.min(1.5, value));
    }
    setMilkywaySaturation(value) {
        const uniform = this._state.milkyway?.mesh?.material?.uniforms?.uSaturation;
        if (uniform && Number.isFinite(value)) uniform.value = Math.max(0, Math.min(2, value));
    }
    setMilkywayStretch(v) {
        this.milkywayStretch = v;
        const u = this._state.milkyway?.mesh?.material?.uniforms;
        if (u?.uStretch) {
            u.uStretch.value = v;
            this._state.milkyway.mesh.material.uniformsNeedUpdate = true;
        }
    }
    setMilkywayGamma(v) {
        this.milkywayGamma = v;
        const u = this._state.milkyway?.mesh?.material?.uniforms;
        if (u?.uGamma) {
            u.uGamma.value = v;
            this._state.milkyway.mesh.material.uniformsNeedUpdate = true;
        }
    }
    setResolution(res) {
        if (!RES_ORDER.includes(res) || res === this.resolution) return;
        this.resolution = res;
        this.setMilkywayExposure(this.milkywayBaseExposure);
        for (const layer of Object.keys(this._state)) {
            if (this._state[layer].visible) {
                if (this._state[layer].procedural) continue;
                this._state[layer].ready = false;
                this._ensureTexture(layer);
            }
        }
    }
    update(camera) {
        if (!camera) return;
        if (isFinite(camera.far) && camera.far < this.domeRadius * 1.05) {
            camera.far = this.domeRadius * 1.25;
            camera.updateProjectionMatrix();
        }
        camera.getWorldPosition(this._tmpV);
        this.group.position.copy(this._tmpV);
        this.group.scale.setScalar(this.domeRadius);
    }
    static autoResolution(renderer, navigator_) {
        const max = renderer.capabilities.maxTextureSize || 4096;
        const mem = navigator_ && navigator_.deviceMemory || 8;
        if (max >= 8192 && mem >= 8) return "8k";
        if (max >= 4096 && mem >= 4) return "4k";
        return "2k";
    }
    dispose() {
        for (const key of [ ...this._texCache.keys() ]) this._disposeTex(key);
        for (const g of this._geoCache.values()) g.dispose();
        const disposedMaterials = new Set, disposedTextures = new Set;
        for (const st of Object.values(this._state)) {
            if (st.procedural) {
                st.mesh.traverse(obj => {
                    if (obj.geometry) obj.geometry.dispose();
                    const mats = obj.material ? Array.isArray(obj.material) ? obj.material : [ obj.material ] : [];
                    for (const mat of mats) {
                        if (mat.map && !disposedTextures.has(mat.map)) {
                            disposedTextures.add(mat.map);
                            mat.map.dispose();
                        }
                        if (!disposedMaterials.has(mat)) {
                            disposedMaterials.add(mat);
                            mat.dispose();
                        }
                    }
                });
            } else st.mesh.material.dispose();
        }
        this.scene.remove(this.group);
    }
}
