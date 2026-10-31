export function installAnchoredDock() {
    const dock = document.getElementById("ui-dock"), body = document.getElementById("dock-body");
    const style = document.createElement("style");
    style.textContent = `\n #ui-dock{height:76px!important;width:var(--dock-width)}\n #ui-dock #dock-body{position:absolute;top:var(--panel-offset,0px);height:var(--panel-height,520px)!important;max-height:none!important;box-sizing:border-box;overflow-x:hidden!important;overflow-y:auto!important;scrollbar-width:none!important;scrollbar-gutter:auto!important;overscroll-behavior:contain;overflow-anchor:none}\n #ui-dock #dock-body::-webkit-scrollbar,#ui-dock #dock-body *::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}\n #ui-dock #dock-body *{scrollbar-width:none!important}\n `;
    document.head.append(style);
    let queued = false, disposed = false;
    const observed = new Set;
    function layout() {
        queued = false;
        if (disposed || !body.isConnected) return;
        const oldScroll = body.scrollTop, box = body.getBoundingClientRect(), cs = getComputedStyle(body);
        let bottom = parseFloat(cs.paddingTop) || 0;
        for (const child of body.children) {
            const css = getComputedStyle(child);
            if (css.display === "none" || css.position === "absolute" || css.position === "fixed") continue;
            const r = child.getBoundingClientRect();
            const top = child.offsetParent === body ? child.offsetTop : r.top - box.top - body.clientTop + oldScroll;
            bottom = Math.max(bottom, top + child.offsetHeight + (parseFloat(css.marginBottom) || 0));
        }
        const natural = Math.ceil(bottom + (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0));
        const available = Math.max(1, innerHeight - 24), h = Math.min(available, Math.max(76, natural));
        const top = dock.getBoundingClientRect().top, anchor = top + 38;
        let panelTop = anchor > innerHeight / 2 ? anchor + 26 - h : anchor - 26;
        panelTop = Math.max(12, Math.min(innerHeight - 12 - h, panelTop));
        const offset = panelTop - top + "px", height = h + "px";
        const changed = dock.style.getPropertyValue("--panel-height") !== height || dock.style.getPropertyValue("--panel-offset") !== offset;
        if (!changed) return;
        dock.style.setProperty("--panel-offset", offset);
        dock.style.setProperty("--panel-height", height);
        const next = Math.min(oldScroll, Math.max(0, body.scrollHeight - body.clientHeight));
        if (body.scrollTop !== next) body.scrollTop = next;
    }
    function schedule() {
        if (!disposed && !queued) {
            queued = true;
            requestAnimationFrame(layout);
        }
    }
    const sizeObserver = new ResizeObserver(schedule);
    function observeChildren() {
        for (const child of observed) if (child.parentElement !== body) {
            sizeObserver.unobserve(child);
            observed.delete(child);
        }
        for (const child of body.children) if (!observed.has(child)) {
            observed.add(child);
            sizeObserver.observe(child);
        }
    }
    let anchorSignature = "";
    const anchorObserver = new MutationObserver(() => {
        const signature = [ dock.style.top, dock.style.left, dock.style.right, dock.className, dock.dataset.side ].join("|");
        if (signature !== anchorSignature) {
            anchorSignature = signature;
            schedule();
        }
    });
    anchorObserver.observe(dock, {
        attributes: true,
        attributeFilter: [ "style", "class", "data-side" ]
    });
    const contentObserver = new MutationObserver(() => {
        observeChildren();
        schedule();
    });
    contentObserver.observe(body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [ "class", "hidden", "open" ]
    });
    observeChildren();
    addEventListener("resize", schedule);
    layout();
    return {
        layout: layout,
        dispose() {
            disposed = true;
            sizeObserver.disconnect();
            anchorObserver.disconnect();
            contentObserver.disconnect();
            removeEventListener("resize", schedule);
            style.remove();
        }
    };
}

const CLOUD_SHADOW_QUALITY = Object.freeze({ low: true, medium: true, high: true });

function seededPlanetStormRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = state + 1831565813 | 0;
        let t = state;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function makePlanetStormRegions(T, key) {
    const jupiter = key === "jupiter";
    const bands = jupiter ? [ -34, -25, -17, -8, 6, 15, 22, 31, 40 ] : [ -42, -34, -24, -13, 8, 18, 28, 35, 43 ];
    const perBand = jupiter ? 4 : 3;
    const rand = seededPlanetStormRandom(jupiter ? 6975970 : 370594);
    const regions = [];
    for (let b = 0; b < bands.length; b++) for (let j = 0; j < perBand; j++) {
        const latDeg = bands[b] + (rand() - .5) * (jupiter ? 4 : 3.2);
        const lonDeg = (j * 360 / perBand + b * 137.507764 + (rand() - .5) * 24 + 360) % 360;
        const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180, c = Math.cos(lat);
        regions.push({
            center: new T.Vector3(-c * Math.cos(lon), Math.sin(lat), c * Math.sin(lon)),
            activity: .65 + rand() * .55,
            next: 0
        });
    }
    const hotspot = jupiter ? [ -22.5, 40, 1.8 ] : [ 35, 230, 1.45 ];
    const lat = hotspot[0] * Math.PI / 180, lon = hotspot[1] * Math.PI / 180, c = Math.cos(lat);
    regions.push({
        center: new T.Vector3(-c * Math.cos(lon), Math.sin(lat), c * Math.sin(lon)),
        activity: hotspot[2],
        next: 0
    });
    return regions;
}

const shaderUV = `vec2 detailUV(vec3 n){n=normalize(n);return vec2(fract(atan(n.z,-n.x)/6.28318530718),1.0-acos(clamp(n.y,-1.0,1.0))/3.14159265359);}`;

const cloudSampling = `\nvec4 detailCloudUV(vec2 uv){\n vec2 dx=dFdx(uv),dy=dFdy(uv);\n dx.x-=floor(dx.x+.5);dy.x-=floor(dy.x+.5);\n vec2 p=(dMapTransform*vec3(uv,1.0)).xy;\n dx=(dMapTransform*vec3(dx,0.0)).xy;dy=(dMapTransform*vec3(dy,0.0)).xy;\n #if __VERSION__ >= 300\n  return textureGrad(dCloudMap,p,dx,dy);\n #elif defined(GL_EXT_shader_texture_lod)\n  return texture2DGradEXT(dCloudMap,p,dx,dy);\n #else\n  return texture2D(dCloudMap,p);\n #endif\n}\n`;

function installGroundAtmosphere(material, key, uniforms) {
    const previous = material.onBeforeCompile, cache = material.customProgramCacheKey();
    material.onBeforeCompile = function(shader, renderer) {
        previous.call(this, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = "varying vec3 vGroundAtmoLocal;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vGroundAtmoLocal=position;");
        shader.fragmentShader = "varying vec3 vGroundAtmoLocal;\nuniform vec3 uGroundAtmoCamera;uniform vec3 uGroundAtmoSun;uniform vec3 uGroundAtmoMetricScale;uniform float uGroundAtmoRadius;uniform float uGroundAtmoScaleHeight;uniform float uGroundAtmoTop;uniform float uGroundAtmoOpticalScale;uniform float uGroundAtmoScatterGain;uniform vec3 uGroundAtmoColor;uniform float uGroundAtmoStrength;\n" + shader.fragmentShader;
        const token = "#include <lights_fragment_end>";
        const effect = `
        if(uGroundAtmoStrength>.001 && uGroundAtmoRadius>0.0){
         vec3 metricScale=max(uGroundAtmoMetricScale,vec3(1e-6));
         vec3 cameraPoint=uGroundAtmoCamera*metricScale/uGroundAtmoRadius;
         vec3 surfacePoint=vGroundAtmoLocal*metricScale/uGroundAtmoRadius;
         vec3 cameraRay=cameraPoint-surfacePoint;
         float rayLength=length(cameraRay);
         if(rayLength>1e-6){
          vec3 rayDirection=cameraRay/rayLength;
          vec3 sunDirection=normalize(uGroundAtmoSun*metricScale);
          float column=0.0,litColumn=0.0;
          for(int sampleIndex=0;sampleIndex<5;sampleIndex++){
           float f=(float(sampleIndex)+.5)/5.0;
           vec3 samplePoint=mix(surfacePoint,cameraPoint,f);
           float altitude=length(samplePoint)-1.0;
           if(altitude<=uGroundAtmoTop){
            float density=exp(-max(0.0,altitude)/max(uGroundAtmoScaleHeight,1e-6));
            float edge=1.0-smoothstep(uGroundAtmoTop*.72,uGroundAtmoTop,altitude);
            float columnStep=density*edge*(rayLength/5.0)/max(uGroundAtmoScaleHeight,1e-6);
            float sunMu=dot(normalize(samplePoint),sunDirection);
            float sunLit=smoothstep(-.08,.18,sunMu);
            column+=columnStep;
            litColumn+=columnStep*sunLit;
           }
          }
          float opticalDepth=min(column*uGroundAtmoOpticalScale,8.0);
          float transmittance=exp(-opticalDepth);
          float daylight=litColumn/max(column,1e-6);
          float phase=.65+.35*pow(max(0.0,dot(rayDirection,sunDirection)),2.0);
          float haze=clamp((1.0-transmittance)*daylight*phase*uGroundAtmoScatterGain,0.0,.72);
          float attenuation=mix(1.0,transmittance,uGroundAtmoStrength);
          reflectedLight.directDiffuse*=attenuation;
          reflectedLight.directSpecular*=attenuation;
          reflectedLight.indirectDiffuse*=attenuation;
          reflectedLight.indirectSpecular*=attenuation;
          totalEmissiveRadiance*=attenuation;
          reflectedLight.indirectDiffuse+=uGroundAtmoColor*haze*uGroundAtmoStrength;
         }
        }
        `;
        shader.fragmentShader = shader.fragmentShader.replace(token, token + "\n{\n" + effect + "\n}\n");
    };
    material.customProgramCacheKey = () => cache + "|ground-atmosphere-" + key;
    material.needsUpdate = true;
}

function hook(material, key, uniforms, declarations, vertex, token, effect, postToken = null, postEffect = "") {
    material.extensions = Object.assign({}, material.extensions, {
        derivatives: true,
        shaderTextureLOD: true
    });
    const previous = material.onBeforeCompile, cache = material.customProgramCacheKey();
    material.onBeforeCompile = function(s, r) {
        previous.call(this, s, r);
        Object.assign(s.uniforms, uniforms);
        s.vertexShader = "varying vec3 vDetailLocal;\n" + s.vertexShader;
        s.vertexShader = s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vDetailLocal=position;" + vertex);
        s.fragmentShader = "varying vec3 vDetailLocal;\n" + declarations + "\n" + s.fragmentShader;
        s.fragmentShader = s.fragmentShader.replace(token, token + "\n{\n" + effect + "\n}\n");
        if (postToken && postEffect) s.fragmentShader = s.fragmentShader.replace(postToken, postToken + "\n{\n" + postEffect + "\n}\n");
    };
    material.customProgramCacheKey = () => cache + "|detail-" + key;
    material.needsUpdate = true;
}

export class PlanetDetail {
    constructor({THREE: THREE, objectRegistry: objectRegistry, cloudMeshes: cloudMeshes, camera: camera, renderer: renderer, getEnabled: getEnabled, getQuality: getQuality, getAtmosphereProfile: getAtmosphereProfile, getRadiusKm: getRadiusKm}) {
        Object.assign(this, {
            T: THREE,
            objectRegistry: objectRegistry,
            cloudMeshes: cloudMeshes,
            camera: camera,
            renderer: renderer,
            getEnabled: getEnabled,
            getQuality: getQuality,
            getAtmosphereProfile: getAtmosphereProfile,
            getRadiusKm: getRadiusKm
        });
        const T = THREE;
        this.earthMaterial = null;
        this.cloudMaterial = null;
        this.gas = {};
        this.groundAtmosphere = {};
        this.v = new T.Vector3;
        this.p = new T.Vector3;
        this.s = new T.Vector3;
        this.scale = new T.Vector3;
        this.projected = new T.Vector3;
        this.q = new T.Quaternion;
        this.q2 = new T.Quaternion;
        this.m = new T.Matrix4;
        this.screen = new T.Vector2;
        this.earthTextures = [ null, null, null ];
        this.u = {
            dCloudMap: {
                value: null
            },
            dCloudRotation: {
                value: new T.Matrix3
            },
            dSun: {
                value: new T.Vector3(1, 0, 0)
            },
            dCloudRatio: {
                value: 1.001884
            },
            dCloudSteps: {
                value: 6
            },
            dShadowStrength: {
                value: 0
            },
            dMapTransform: {
                value: new T.Matrix3
            },
            dLocalCamera: {
                value: new T.Vector3
            }
        };
    }
    bindEarth(earth, cloud) {
        if (this.earthMaterial !== earth.material) {
            this.earthMaterial = earth.material;
            hook(earth.material, "shadow", this.u, `uniform sampler2D dCloudMap;uniform mat3 dCloudRotation;uniform mat3 dMapTransform;uniform vec3 dSun;uniform float dCloudRatio;uniform float dShadowStrength;${shaderUV}${cloudSampling}`, "", "#include <lights_fragment_end>", `\n    vec3 sn=normalize(vDetailLocal);float sunHeight=dot(sn,dSun);\n    if(dShadowStrength>0.001 && sunHeight>0.0){\n     float rayDistance=-sunHeight+sqrt(max(0.0,sunHeight*sunHeight+dCloudRatio*dCloudRatio-1.0));\n     vec3 hit=normalize(dCloudRotation*(sn+dSun*rayDistance));\n     vec2 uv=detailUV(hit);\n     vec3 a=detailCloudUV(uv).rgb;\n     vec3 b=detailCloudUV(uv+vec2(.00035,0.0)).rgb;\n     vec3 c=detailCloudUV(uv-vec2(.00035,0.0)).rgb;\n     float density=dot((a+b+c)/3.0,vec3(.333333));\n     float shadow=(1.0-exp(-density*3.4))*dShadowStrength*smoothstep(0.0,.045,sunHeight);\n     reflectedLight.directDiffuse*=1.0-shadow;\n     reflectedLight.directSpecular*=1.0-shadow;\n    }\n   `);
        }
        if (this.cloudMaterial !== cloud.material) {
            this.cloudMaterial = cloud.material;
            hook(cloud.material, "cloud-volume", this.u, `uniform sampler2D dCloudMap;uniform mat3 dMapTransform;uniform vec3 dLocalCamera;uniform vec3 dSun;uniform float dCloudRatio;uniform float dCloudSteps;${shaderUV}${cloudSampling}`, "", "#include <map_fragment>", `\n    vec3 outer=normalize(vDetailLocal)*dCloudRatio;\n    vec3 towardEye=normalize(dLocalCamera-outer);\n    float eyeDistance=length(dLocalCamera-outer);\n    float innerR=1.0+(dCloudRatio-1.0)*.10;\n    float b=dot(outer,towardEye);\n    float disc=b*b-dot(outer,outer)+innerR*innerR;\n    float root=sqrt(max(disc,0.0));\n    bool cameraInside=length(dLocalCamera)<dCloudRatio;\n    vec3 marchDirection;\n    float distanceIn;\n    if(cameraInside){\n     marchDirection=towardEye;\n     float innerDistance=max(0.0,-b-root);\n     distanceIn=disc>0.0?min(eyeDistance,innerDistance):eyeDistance;\n    }else{\n     marchDirection=-towardEye;\n     float innerDistance=max(0.0,b-root);\n     distanceIn=disc>0.0?innerDistance:2.0*max(0.0,b);\n    }\n    distanceIn=clamp(distanceIn,0.0,.20);\n    float optical=0.0,grey=0.0;\n    for(int j=0;j<6;j++){\n     if(float(j)>=dCloudSteps)break;\n     vec3 pos=outer+marchDirection*(float(j)+.5)*distanceIn/max(1.0,dCloudSteps);\n     float altitude=(length(pos)-innerR)/max(.00001,dCloudRatio-innerR);\n     float envelope=smoothstep(0.0,.18,altitude)*(1.0-smoothstep(.80,1.0,altitude));\n     vec2 uv=detailUV(pos);\n     vec3 sampleCloud=detailCloudUV(uv).rgb;\n     float density=max(max(sampleCloud.r,sampleCloud.g),sampleCloud.b)*envelope;\n     optical+=density;grey+=density*density;\n    }\n    float depth=optical*distanceIn/(max(1.0,dCloudSteps)*max(.00001,dCloudRatio-innerR));\n    diffuseColor.a*=1.0-exp(-depth*7.2);\n    float frostDensity=clamp(grey/max(optical,.00001),0.0,1.0);\n    diffuseColor.rgb=mix(vec3(.72,.79,.89),vec3(1.0,1.04,1.10),frostDensity);\n   `, "#include <lights_fragment_end>", `\n    vec3 cloudNormal=normalize(vDetailLocal);\n    vec3 viewDirection=normalize(dLocalCamera-vDetailLocal);\n    vec3 sunDirection=normalize(dSun);\n    float sunMu=dot(cloudNormal,sunDirection);\n    float viewMu=max(dot(cloudNormal,viewDirection),0.0);\n    float rimScatter=pow(1.0-viewMu,1.6);\n    float backScatter=pow(max(dot(-sunDirection,viewDirection),0.0),2.0);\n    float sunFill=smoothstep(-.10,.38,sunMu);\n    float frostScatter=diffuseColor.a*(.018+.09*rimScatter+.09*backScatter+.035*sunFill);\n    reflectedLight.indirectDiffuse+=vec3(.52,.62,.78)*frostScatter;\n    if(length(dLocalCamera)<dCloudRatio){\n     vec3 cloudSample=detailCloudUV(detailUV(cloudNormal)).rgb;\n     float cloudDensity=max(max(cloudSample.r,cloudSample.g),cloudSample.b);\n     float cloudMask=smoothstep(.20,.58,cloudDensity);\n     float undersideFill=mix(.08,.52,smoothstep(-.06,.24,sunMu))*cloudMask*diffuseColor.a;\n     reflectedLight.indirectDiffuse+=vec3(.50,.60,.76)*undersideFill;\n    }\n   `);
        }
    }
    bindGas(key, mesh) {
        const T = this.T, old = this.gas[key];
        if (old?.material === mesh.material) return old;
        const regions = makePlanetStormRegions(T, key);
        const state = {
            material: mesh.material,
            regions: regions,
            events: Array(4).fill(null),
            paused: true,
            last: 0,
            u: {
                gCenters: {
                    value: Array.from({
                        length: 4
                    }, () => new T.Vector4(0, 1, 0, .007))
                },
                gSun: {
                    value: new T.Vector3(1, 0, 0)
                },
                gPowers: {
                    value: Array(4).fill(0)
                },
                gTint: {
                    value: new T.Vector3(...key === "jupiter" ? [ .83, .87, 1 ] : [ .66, .8, 1 ])
                },
                gDiffusion: {
                    value: key === "jupiter" ? .34 : .16
                }
            }
        };
        this.gas[key] = state;
        hook(mesh.material, "regional-storm-" + key, state.u, "uniform vec4 gCenters[4];uniform vec3 gSun;uniform float gPowers[4];uniform vec3 gTint;uniform float gDiffusion;", "", "#include <emissivemap_fragment>", `\n   vec3 n=normalize(vDetailLocal);float illumination=0.0;\n   for(int i=0;i<4;i++){\n    if(gPowers[i]>.001){\n     vec3 delta=n-gCenters[i].xyz;float d=dot(delta,delta)/(gCenters[i].w*gCenters[i].w);\n     float irregular=.78+.24*sin(n.x*1800.0+n.y*970.0)*sin(n.z*1400.0);\n     illumination+=gPowers[i]*(3.5*exp(-d*irregular*2.5)+gDiffusion*exp(-d*.48));\n    }\n   }\n   float night=1.0-smoothstep(-.15,.06,dot(n,gSun));\n   totalEmissiveRadiance+=gTint*illumination*night;\n  `);
        return state;
    }
    updateGroundAtmosphere(key, mesh, sun) {
        if (!mesh?.material || !sun || !mesh.visible) {
            if (mesh?.userData) mesh.userData.groundAtmosphereBlend = 0;
            return;
        }
        const profile = this.getAtmosphereProfile?.(key);
        const radiusKm = this.getRadiusKm?.(key);
        const derived = profile?.derived;
        const radius = mesh.geometry?.parameters?.radius;
        if (!profile || !(radiusKm > 0) || !(radius > 0)) {
            mesh.userData.groundAtmosphereBlend = 0;
            return;
        }
        let state = this.groundAtmosphere[key];
        if (!state || state.material !== mesh.material) {
            const T = this.T;
            const uniforms = {
                uGroundAtmoCamera: { value: new T.Vector3 },
                uGroundAtmoSun: { value: new T.Vector3(1, 0, 0) },
                uGroundAtmoMetricScale: { value: new T.Vector3(1, 1, 1) },
                uGroundAtmoRadius: { value: radius },
                uGroundAtmoScaleHeight: { value: .001 },
                uGroundAtmoTop: { value: .01 },
                uGroundAtmoOpticalScale: { value: .08 },
                uGroundAtmoScatterGain: { value: .5 },
                uGroundAtmoColor: { value: new T.Color(profile.rayleigh || 0x72a9eb) },
                uGroundAtmoStrength: { value: 0 }
            };
            installGroundAtmosphere(mesh.material, key, uniforms);
            state = { material: mesh.material, uniforms: uniforms };
            this.groundAtmosphere[key] = state;
        }
        const uniforms = state.uniforms;
        const axes = mesh.geometry.userData?.referenceAxesKm || [ radiusKm, radiusKm, radiusKm ];
        const maxAxis = Math.max(...axes);
        const metricScale = uniforms.uGroundAtmoMetricScale.value.set(maxAxis / axes[0], maxAxis / axes[2], maxAxis / axes[1]);
        uniforms.uGroundAtmoRadius.value = radius;
        const scaleHeightKm = profile.scaleHeight || derived?.scaleHeightKm || 8;
        const topKm = derived?.renderTopKm ?? derived?.topKm ?? scaleHeightKm * 8;
        uniforms.uGroundAtmoScaleHeight.value = Math.max(1e-6, scaleHeightKm / radiusKm);
        uniforms.uGroundAtmoTop.value = Math.max(1e-6, topKm / radiusKm);
        uniforms.uGroundAtmoOpticalScale.value = Math.max(0, Number(profile.opticalDepth ?? derived?.opticalDepth) || 0.05);
        uniforms.uGroundAtmoScatterGain.value = Math.max(.05, Math.min(1.15, Number(profile.intensity) || .5));
        uniforms.uGroundAtmoColor.value.setHex(profile.rayleigh || 0x72a9eb);
        mesh.updateWorldMatrix(true, false);
        sun.updateWorldMatrix(true, false);
        this.camera.updateWorldMatrix(true, false);
        mesh.getWorldPosition(this.p);
        mesh.getWorldQuaternion(this.q).invert();
        sun.getWorldPosition(this.s);
        uniforms.uGroundAtmoSun.value.copy(this.s).sub(this.p).normalize().applyQuaternion(this.q);
        this.camera.getWorldPosition(this.v);
        mesh.worldToLocal(this.v);
        uniforms.uGroundAtmoCamera.value.copy(this.v);
        const cameraRadius = Math.hypot(this.v.x * metricScale.x, this.v.y * metricScale.y, this.v.z * metricScale.z) / radius;
        const altitudeKm = Math.max(0, (cameraRadius - 1) * radiusKm);
        const strength = 1 - this.T.MathUtils.smoothstep(altitudeKm, topKm * .58, topKm * 1.35);
        uniforms.uGroundAtmoStrength.value = strength;
        mesh.userData.groundAtmosphereBlend = strength;
    }
    update() {
        const T = this.T, earth = this.objectRegistry.earth, cloud = this.cloudMeshes.earth, sun = this.objectRegistry.sun;
        if (!sun) return;
        const cloudShadowsAllowed = !!CLOUD_SHADOW_QUALITY[this.getQuality?.()];
        this.renderer.getSize(this.screen);
        sun.getWorldPosition(this.s);
        for (const key of [ "earth", "venus", "mars" ]) this.updateGroundAtmosphere(key, this.objectRegistry[key], sun);
        if (earth && cloud && cloud.material.map?.image) {
            this.bindEarth(earth, cloud);
            earth.updateWorldMatrix(true, false);
            cloud.updateWorldMatrix(true, false);
            earth.getWorldPosition(this.p);
            earth.getWorldScale(this.scale);
            this.camera.getWorldPosition(this.v);
            const earthRadius = earth.geometry?.parameters?.radius || 1;
            const cameraDistance = Math.max(this.v.distanceTo(this.p), this.camera.near);
            const earthScale = Math.max(Math.abs(this.scale.x), Math.abs(this.scale.y), Math.abs(this.scale.z));
            const pixelRadius = earthRadius * earthScale * this.camera.projectionMatrix.elements[5] * this.screen.y / (2 * cameraDistance);
            const groundMode = (earth.userData?.groundAtmosphereBlend || 0) > .5;
            const groundSteps = this.getQuality?.() === "high" ? 3 : this.getQuality?.() === "medium" ? 2 : 1;
            this.u.dCloudSteps.value = groundMode ? groundSteps : pixelRadius < 24 ? 1 : pixelRadius < 160 ? 3 : 6;
            earth.getWorldQuaternion(this.q);
            cloud.getWorldQuaternion(this.q2).invert();
            this.q2.multiply(this.q);
            this.m.makeRotationFromQuaternion(this.q2);
            this.u.dCloudRotation.value.setFromMatrix4(this.m);
            this.u.dSun.value.copy(this.s).sub(this.p).normalize().applyQuaternion(this.q.invert());
            const map = cloud.material.map;
            this.earthTextures[0] = map;
            this.earthTextures[1] = earth.material.map;
            this.earthTextures[2] = earth.userData.nightMesh?.material.uniforms.nightTexture.value;
            for (let i = 0; i < this.earthTextures.length; i++) {
                const texture = this.earthTextures[i];
                if (texture && texture.wrapS !== T.RepeatWrapping) {
                    texture.wrapS = T.RepeatWrapping;
                    texture.needsUpdate = true;
                }
            }
            const gradientSampling = this.renderer.capabilities.isWebGL2 || this.renderer.extensions?.has?.("EXT_shader_texture_lod");
            if (!gradientSampling && map.minFilter !== T.LinearFilter) {
                map.minFilter = T.LinearFilter;
                map.generateMipmaps = false;
                map.needsUpdate = true;
            }
            map.updateMatrix();
            this.u.dCloudMap.value = map;
            this.u.dMapTransform.value.copy(map.matrix);
            this.u.dCloudRatio.value = cloud.geometry.parameters.radius / earthRadius;
            this.u.dShadowStrength.value = cloud.visible && cloudShadowsAllowed ? Math.min(.9, cloud.material.opacity) : 0;
            cloud.worldToLocal(this.v);
            this.u.dLocalCamera.value.copy(this.v).divideScalar(earthRadius);
        } else this.u.dShadowStrength.value = 0;
        const now = performance.now() / 1e3;
        for (const key of [ "jupiter", "saturn" ]) {
            const mesh = this.objectRegistry[key];
            if (!mesh) continue;
            mesh.updateWorldMatrix(true, false);
            const state = this.bindGas(key, mesh);
            mesh.getWorldPosition(this.p);
            mesh.getWorldQuaternion(this.q).invert();
            state.u.gSun.value.copy(this.s).sub(this.p).normalize().applyQuaternion(this.q);
            this.camera.getWorldPosition(this.v);
            this.v.sub(this.p);
            const distance = this.v.length();
            this.v.normalize().applyQuaternion(this.q);
            mesh.getWorldScale(this.scale);
            const radius = (mesh.geometry?.parameters?.radius || 0) * Math.max(Math.abs(this.scale.x), Math.abs(this.scale.y), Math.abs(this.scale.z));
            const safeDistance = Math.max(radius, distance);
            const pixels = radius * this.camera.projectionMatrix.elements[5] * this.screen.y / (2 * safeDistance);
            this.projected.copy(this.p).project(this.camera);
            const radiusNdcY = radius * this.camera.projectionMatrix.elements[5] / safeDistance;
            const radiusNdcX = radius * this.camera.projectionMatrix.elements[0] / safeDistance;
            const inView = this.projected.z >= -1 && this.projected.z <= 1 && Math.abs(this.projected.x) <= 1 + radiusNdcX && Math.abs(this.projected.y) <= 1 + radiusNdcY;
            if (document.hidden || !this.getEnabled(key) || !mesh.visible || !inView || pixels < 24 || now - state.last > 1) {
                state.u.gPowers.value.fill(0);
                state.events.fill(null);
                state.paused = true;
                state.last = now;
                continue;
            }
            state.last = now;
            if (state.paused) {
                state.paused = false;
                for (const region of state.regions) region.next = now + 2 + Math.random() * 30 / Math.max(.45, region.activity);
            }
            for (let i = 0; i < 4; i++) {
                const event = state.events[i];
                let power = 0;
                if (event) {
                    const age = now - event.start;
                    if (age > 1) state.events[i] = null; else for (const [delay, gain] of key === "jupiter" ? [ [ 0, 1 ], [ .3, .5 ] ] : [ [ 0, .8 ], [ .2, .3 ] ]) {
                        const t = age - delay;
                        if (t >= 0) power += gain * (1 - Math.exp(-t / .015)) * Math.exp(-t / .1);
                    }
                }
                state.u.gPowers.value[i] = power;
            }
            for (const region of state.regions) {
                if (now < region.next) continue;
                region.next = now + (key === "jupiter" ? 14 : 24) - Math.log(Math.max(.001, 1 - Math.random())) * (key === "jupiter" ? 28 : 38) / Math.max(.45, region.activity);
                const n = region.center;
                if (n.dot(state.u.gSun.value) > -.06 || n.dot(this.v) < .15) continue;
                const slot = state.events.findIndex(e => !e);
                if (slot < 0) continue;
                state.u.gCenters.value[slot].set(n.x, n.y, n.z, (key === "jupiter" ? .006 : .004) + Math.random() * .004);
                state.events[slot] = {
                    start: now
                };
            }
        }
    }
}

export function textureZoomFactor(mesh) {
    const image = mesh.material?.map?.image, width = image?.naturalWidth || image?.width || 0;
    const lod = Math.max(0, Math.min(2, Math.log2(Math.max(2048, width) / 2048)));
    return width ? lod < 1 ? 1.75 - .35 * lod : 1.5 - .1 * lod : 1.65;
}
