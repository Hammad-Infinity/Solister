import {MOONS} from '../catalog.js';
const MAX_CASTERS=8;
const GLSL=`
varying vec3 vSatelliteReceiverView;
uniform float uSatelliteEclipsesOn;
uniform vec4 uSatelliteSunView;
uniform int uSatelliteCasterCount;
uniform vec4 uSatelliteCasters[8];
float satelliteDiscVisibility(vec3 p, vec4 caster) {
    vec3 toSun = uSatelliteSunView.xyz - p;
    vec3 toMoon = caster.xyz - p;
    float ds = length(toSun), dm = length(toMoon);
    float sunRadius = uSatelliteSunView.w, moonRadius = caster.w;
    if (sunRadius <= 0.0 || moonRadius <= 0.0 || ds <= sunRadius ||
        dm <= moonRadius || dm >= ds) return 1.0;
    vec3 s = toSun / ds;
    if (dot(toMoon, s) <= 0.0) return 1.0;
    float coneRadius = moonRadius + dm * sunRadius / max(ds - sunRadius, 1e-8);
    if (length(cross(toMoon, s)) > coneRadius) return 1.0;
    vec3 m = toMoon / dm;
    float separation = atan(length(cross(s, m)), dot(s, m));
    float rs = asin(clamp(sunRadius / ds, 0.0, 1.0));
    float rm = asin(clamp(moonRadius / dm, 0.0, 1.0));
    float d = separation / max(rs, 1e-8);
    float r = rm / max(rs, 1e-8);
    if (d >= 1.0 + r) return 1.0;
    if (d <= abs(1.0 - r)) return 1.0 - min(1.0, r*r);
    float d2=d*d, r2=r*r;
    float a=acos(clamp((d2+1.0-r2)/(2.0*d),-1.0,1.0));
    float b=acos(clamp((d2+r2-1.0)/(2.0*d*r),-1.0,1.0));
    float product=(-d+1.0+r)*(d+1.0-r)*(d-1.0+r)*(d+1.0+r);
    float overlap=a+r2*b-0.5*sqrt(max(0.0,product));
    return clamp(1.0-overlap/3.141592653589793,0.0,1.0);
}
float satelliteSunVisibility(vec3 p) {
    if (uSatelliteEclipsesOn < 0.5) return 1.0;
    float visibility=1.0;
    for (int i=0; i<8; i++) {
        if (i < uSatelliteCasterCount) visibility *= satelliteDiscVisibility(p,uSatelliteCasters[i]);
    }
    return visibility;
}
`;
export class MoonEclipses {
    constructor({THREE,objectRegistry,km2u}) {
        Object.assign(this,{THREE,objectRegistry,km2u});
        this.groups=[];this.temp=new THREE.Vector3();
    }
    install(material,uniforms,isRing) {
        if(!material||material.userData.satelliteEclipseInstalled)return;
        const previous=material.onBeforeCompile;
        const key=material.customProgramCacheKey();
        material.onBeforeCompile=function(shader,renderer){
            if(previous)previous.call(this,shader,renderer);
            if(!shader.vertexShader.includes('#include <project_vertex>')||
               !shader.fragmentShader.includes('#include <lights_fragment_end>')) {
                console.warn('Satellite eclipses skipped: unsupported material shader.',this.type);
                return;
            }
            Object.assign(shader.uniforms,uniforms);
            shader.vertexShader='varying vec3 vSatelliteReceiverView;\n'+shader.vertexShader;
            shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',
                '#include <project_vertex>\n vSatelliteReceiverView=(modelViewMatrix*vec4(transformed,1.0)).xyz;');
            shader.fragmentShader=GLSL+'\n'+shader.fragmentShader;
            shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',
                '#include <lights_fragment_end>\n'+
                'float satelliteVisibility=satelliteSunVisibility(vSatelliteReceiverView);\n'+
                'reflectedLight.directDiffuse *= satelliteVisibility;\n'+
                'reflectedLight.directSpecular *= satelliteVisibility;\n'+
                (isRing?'totalEmissiveRadiance *= satelliteVisibility;\n':''));
        };
        material.customProgramCacheKey=()=>key+'|satellite-disc-eclipse-view-v1|'+Number(isRing);
        material.userData.satelliteEclipseInstalled=true;material.needsUpdate=true;
    }
    rebuild() {
        this.groups=[];
        const T=this.THREE;
        for(const parent of ['mars','jupiter','saturn','uranus','neptune']) {
            const body=this.objectRegistry[parent];if(!body)continue;
            const casters=Object.values(MOONS).filter(x=>x.parent===parent);
            if(casters.length>MAX_CASTERS)throw new Error('Increase the eclipse caster limit before expanding this catalogue.');
            const uniforms={uSatelliteEclipsesOn:{value:0},uSatelliteSunView:{value:new T.Vector4()},
                uSatelliteCasterCount:{value:0},uSatelliteCasters:{value:Array.from({length:MAX_CASTERS},()=>new T.Vector4())}};
            for(const m of (Array.isArray(body.material)?body.material:[body.material]))this.install(m,uniforms,false);
            if(parent==='saturn'){
                const ring=this.objectRegistry['saturn-ring'];
                if(ring)for(const m of (Array.isArray(ring.material)?ring.material:[ring.material]))this.install(m,uniforms,true);
            }
            this.groups.push({casters,uniforms});
        }
    }
    update(enabled,camera) {
        const sun=this.objectRegistry.sun;
        if(!enabled||!sun){for(const g of this.groups)g.uniforms.uSatelliteEclipsesOn.value=0;return;}
        camera.updateMatrixWorld(true);
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        sun.getWorldPosition(this.temp).applyMatrix4(camera.matrixWorldInverse);
        const sx=this.temp.x,sy=this.temp.y,sz=this.temp.z;
        const radius=sun.geometry?.parameters?.radius||0;
        for(const {casters,uniforms:u} of this.groups){
            u.uSatelliteSunView.value.set(sx,sy,sz,radius);
            let n=0;
            for(const info of casters){
                const mesh=this.objectRegistry[info.key];if(!mesh||!mesh.visible)continue;
                mesh.getWorldPosition(this.temp).applyMatrix4(camera.matrixWorldInverse);
                u.uSatelliteCasters.value[n++].set(this.temp.x,this.temp.y,this.temp.z,this.km2u(info.radiusKm));
            }
            u.uSatelliteCasterCount.value=n;u.uSatelliteEclipsesOn.value=1;
        }
    }
}