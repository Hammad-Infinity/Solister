import { configureNucleusStencil, useNucleusStencil } from './comet-stencil.js';
import { createDustPopulation, createDustFanVolume, writeDustFanVolume } from './comet-dust-fan.js';
import {extrapolateTable} from '../../sim/approximate-orbits.js';
import {osculatingEllipse,sampleEllipse} from './comet-orbit.js';
import {createPlume,writePlume} from './comet-plume.js';
import { createTailVolume, writeTailVolume } from './comet-tail-volume.js';
import { COMET_KM_PER_AU, cometVisualProfile } from './comet-appearance.js';
import { createCometVolume } from './comet-volume.js';
import { SOLAR_MU, COMET_START_MS, COMET_END_MS, decodeCometData, sampleComet, cometActivity, cometAppearance, propagateDust } from './comet-core.js';
const DAY=86400;
const DUST_BETAS=[.03,.08,.16,.28,.45];
const DUST_WEIGHTS=[.25,.23,.2,.18,.14];
const META_URL=new URL('../../../data/comets/comet-ephemeris.json',import.meta.url);
const STATES_URL=new URL('../../../data/comets/comet-ephemeris.bin',import.meta.url);
const CATALOG=[['comet67p','67P/Churyumov–Gerasimenko',1.7],['comet2p','2P/Encke',2.4],['comet46p','46P/Wirtanen',.6],['comet9p','9P/Tempel 1',3]];
export class CometLayer {
    constructor(options){
        Object.assign(this,options);this.enabled=false;this.entries=new Map();this.tables=null;this.loading=null;this.error='';this.disposed=false;
        this.jd=NaN;this.waveTime=0;this.waveUpdateAt=0;this.lastNotice='';this.highlighted=null;
        this.scratch=new Float64Array(6);this.dustScratch=new Float64Array(3);this.mapScratch=new this.THREE.Vector3();this.ionAway=new this.THREE.Vector3();this.ionCross=new this.THREE.Vector3();this.ionUp=new this.THREE.Vector3();this.jetSun=new this.THREE.Vector3();this.jetOrigin=new this.THREE.Vector3();this.jetNormal=new this.THREE.Vector3();this.jetDirection=new this.THREE.Vector3();this.jetSide=new this.THREE.Vector3();this.waveTangent=new this.THREE.Vector3();this.waveSide=new this.THREE.Vector3();this.waveUp=new this.THREE.Vector3();
        this.rows=Array.from(document.querySelectorAll('[data-comet-body]'));
        this.notice=document.createElement('p');this.notice.id='comet-ephemeris-status';this.notice.style.cssText='font-size:11px;line-height:1.4;color:var(--text-secondary,#999);margin:6px 12px';this.notice.hidden=true;
        document.getElementById('solar-accuracy-status')?.after(this.notice);
        for(const [key,name,radius]of CATALOG){
            const profile=cometVisualProfile(key);
            const stats=[['Category','Periodic comet'],['Designation',name.split('/')[0]],['Nucleus radius','about '+radius+' km'],
                ['Perihelion setting',profile.perihelionAU.toFixed(2)+' AU'],
                ['Coma ramp',`${profile.comaRamp.startAU.toFixed(2)} → ${profile.comaRamp.fullAU.toFixed(2)} AU`],
                ['Tail ramp',`${profile.tailRamp.startAU.toFixed(2)} → ${profile.tailRamp.fullAU.toFixed(2)} AU`],
                ['Activity profile',profile.appearance],
                ['Observed range','1800-01-03 through 2199-12-28 UTC'],['Orbit source','JPL Horizons'],
                ['Appearance limits','Illustrative profile, not an epoch-specific measurement or calibrated exposure']];
            this.bodyFacts[key]={name,kind:'Comet',tagline:'Periodic comet represented by its available JPL ephemeris.',stats};
        }
    }
    async load(){
        if(this.tables||this.loading||this.disposed)return this.loading;
        this.error='';this.controller=new AbortController();const signal=this.controller.signal;
        const timeout=setTimeout(()=>this.controller?.abort(),60000);this.onLoadStart?.();
        this.loading=(async()=>{
            try{
                const read=async(url,type)=>{const r=await fetch(url,{signal});if(!r.ok)throw Error(url.pathname+': '+r.status);return r[type]();};
                const [meta,buffer]=await Promise.all([read(META_URL,'json'),read(STATES_URL,'arrayBuffer')]);
                if(globalThis.crypto?.subtle){const sum=await crypto.subtle.digest('SHA-256',buffer);const hex=Array.from(new Uint8Array(sum),v=>v.toString(16).padStart(2,'0')).join('');if(hex!==meta.sha256)throw Error('Comet data checksum mismatch; clear the deployment cache.');}
                const tables=decodeCometData(meta,buffer);if(this.disposed)return;
                this.tables=tables;
                for(const [key,t]of tables){const f=this.bodyFacts[key];if(t.solution)f.stats.push(['JPL solution',t.solution]);if(t.dataArc)f.stats.push(['Observation arc',t.dataArc]);}
                if(this.enabled)this.buildRender();
            }catch(e){this.controller?.abort();if(!this.disposed)this.error='Comet data unavailable: '+(e.name==='AbortError'?'request timed out':e.message)+'. Toggle Comets off/on to retry.';}
            finally{clearTimeout(timeout);this.controller=null;this.loading=null;this.onLoadEnd?.();}
        })();return this.loading;
    }
    setEnabled(on){
        on=!!on;if(this.enabled===on)return;this.enabled=on;
        if(on){if(this.tables)this.buildRender();else this.load();}
        else{this.clearRender();this.setNotice('');this.paintRows(false);}
    }
    rebuild(enabled=this.enabled){
        this.clearRender();this.enabled=!!enabled;
        if(!this.enabled){this.setNotice('');return;}
        if(this.tables)this.buildRender();else this.load();
    }
    mapPosition(p,out){return out.set(p[0]*this.au,p[2]*this.au,-p[1]*this.au);}
    nucleus(radius,index){
        const T=this.THREE,g=new T.SphereGeometry(1,64,40),a=g.getAttribute('position'),colors=new Float32Array(a.count*3);
        const pits=[[.5,.7,.5,.035],[-.6,.5,.5,.028],[.4,-.5,.75,.03],[-.7,-.6,-.3,.025],[.2,.2,-.95,.035]];
        for(let i=0;i<a.count;i++){
            let x=a.getX(i),y=a.getY(i),z=a.getZ(i),d=1+.055*Math.sin(3.5*x+2*z+index)*Math.cos(3*y-x)+.025*Math.sin(5*z-2*y)+.008*Math.sin(19*x+7*y)*Math.sin(23*z-3*y);
            if(index===0)d*=.77+.25*Math.sqrt(x*x+.06);
            for(const [px,py,pz,w]of pits){const r=Math.hypot(px,py,pz),q=(x-px/r)**2+(y-py/r)**2+(z-pz/r)**2;d-=.025*Math.exp(-q/w);d+=.008*Math.exp(-(((q-w*1.3)/w)**2));}
            const shade=.8+.2*Math.sin(17*x+index)*Math.sin(21*y-5*z);colors.set([shade,shade*.95,shade*.9],i*3);
            a.setXYZ(i,x*d*radius*1.25,y*d*radius*.85,z*d*radius);
        }
        g.setAttribute('color',new T.BufferAttribute(colors,3));g.computeVertexNormals();
        const normals=g.getAttribute('normal'),bins=new Map();
        for(let i=0;i<a.count;i++){const key=[a.getX(i),a.getY(i),a.getZ(i)].map(v=>Math.round(v/radius*1e7)).join(',');let bin=bins.get(key);if(!bin){bin={ids:[],sum:new T.Vector3()};bins.set(key,bin);}bin.ids.push(i);bin.sum.add(new T.Vector3(normals.getX(i),normals.getY(i),normals.getZ(i)));}
        for(const bin of bins.values()){bin.sum.normalize();for(const i of bin.ids)normals.setXYZ(i,bin.sum.x,bin.sum.y,bin.sum.z);}normals.needsUpdate=true;
        g.computeBoundingSphere();g.parameters.radius=g.boundingSphere.radius;
        const material=new T.MeshStandardMaterial({roughness:1,metalness:0,vertexColors:true});material.color.setRGB(.04,.04,.04);material.transparent=false;material.depthWrite=true;configureNucleusStencil(T,material);
        return new T.Mesh(g,material);
    }
    buildRender(){
        const tables=this.tables;
        if(!this.enabled||!tables||this.entries.size||this.disposed)return;
        const T=this.THREE;let index=0;
        for(const [key,t]of tables){
            const root=new T.Group();root.visible=false;this.solarSystem.add(root);
            const radius=this.km2u(t.radiusKm);
            const mesh=this.nucleus(radius,index++);mesh.renderOrder=0;mesh.visible=false;mesh.userData={planetKey:key,planetName:t.name,isComet:true,radiusKm:t.radiusKm,minZoomDistance:mesh.geometry.parameters.radius*1.7,maxZoomDistance:this.au*20};root.add(mesh);this.objectRegistry[key]=mesh;
            const coma=createCometVolume(T,this.objectRegistry,mesh);root.add(coma);
            const profile = cometVisualProfile(key);
            const ions = [createTailVolume(T, this.objectRegistry, mesh, 0x2c70d8, 24, 1, true)];
            const ion = ions[0];
            const dust = [createDustFanVolume(T,this.objectRegistry,mesh,profile.dustTint)];
            const dustPopulations=DUST_BETAS.map(()=>createDustPopulation(24));
            root.add(...ions, ...dust);
            const jets = Array.from({ length: profile.jetCount || 0 }, () => createPlume(T, profile.dustTint, 16));
            if (jets.length) root.add(...jets);
            const effectEye = new T.Vector3();
            const effectHead = new T.Vector3();
            for (const jet of jets) {
                jet.renderOrder = 6;
                jet.material.uniforms.transmission = { value: 1 };
                jet.onBeforeRender = (renderer, scene, camera) => {
                    useNucleusStencil(T,renderer,jet.material,mesh);
                    camera.getWorldPosition(effectEye);
                    mesh.getWorldPosition(effectHead);
                    jet.material.uniforms.transmission.value = Math.exp(-0.1 * coma.material.uniforms.opticalDepth.value *
                        Math.min(1, effectEye.distanceTo(effectHead) / Math.max(coma.scale.x, 1e-12)));
                };
            }
            const positions=mesh.geometry.getAttribute('position'),normals=mesh.geometry.getAttribute('normal'),vents=[];
            for(let j=0;j<jets.length;j++){const y=1-2*(j+.5)/jets.length,theta=j*2.39996323,radial=Math.sqrt(1-y*y),dir=new T.Vector3(radial*Math.cos(theta),y,radial*Math.sin(theta));let best=-Infinity,index=0;
                for(let i=0;i<positions.count;i++){const q=new T.Vector3().fromBufferAttribute(positions,i).normalize().dot(dir);if(q>best){best=q;index=i;}}
                vents.push({position:new T.Vector3().fromBufferAttribute(positions,index),normal:new T.Vector3().fromBufferAttribute(normals,index).normalize()});
                jets[j].material.uniforms.phase={value:0};jets[j].material.fragmentShader=jets[j].material.fragmentShader.replace('uniform vec3 tint;','uniform float phase;uniform float transmission;uniform vec3 tint;').replace('float a=opacity*vEmission*fade*','float packets=.38+.62*pow(.5+.5*sin((vUv.x*7.-phase)*6.2831853),3.);float a=transmission*packets*opacity*vEmission*fade*');
            }
            const path=new T.Line(new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(new Float32Array(770*3),3)),new T.LineBasicMaterial({color:0xbfdde7,transparent:true,opacity:.26,depthWrite:false}));path.frustumCulled=false;this.solarSystem.add(path);
            this.entries.set(key,{t,root,mesh,coma,ion,ions,dust,dustPopulations,jets,vents,path,pathEpoch:NaN,pathStyle:'',pathLength:NaN,state:new Float64Array(6),r:0,active:0,appearance:{},tailJD:NaN});
        }
        this.paintRows(false);
    }
    paintRows(visible){
        for(const row of this.rows){const on=visible&&this.entries.has(row.dataset.key);if(row.hidden===on)row.hidden=!on;const disabled=String(!on);if(row.getAttribute('aria-disabled')!==disabled)row.setAttribute('aria-disabled',disabled);}
    }
    setNotice(text){if(text===this.lastNotice)return;this.lastNotice=text;this.notice.textContent=text;this.notice.hidden=!text;}
    sample(t,jd,out){
        if(sampleComet(t,jd,out))return true;
        return !!this.approximate&&extrapolateTable(t,jd,t.startJD,t.endJD,sampleComet,SOLAR_MU,out);
    }
    update({ms,et,available,showOrbits,style,length,delta=0}){
        if(!this.enabled)return;
        this.waveTime += Math.max(0, Math.min(0.1, Number.isFinite(delta) ? delta : 0));
        const waveStamp = Math.floor(this.waveTime * 30 + 1e-7) / 30;
        const waveChanged = waveStamp > this.waveUpdateAt;
        if (waveChanged) this.waveUpdateAt = waveStamp;
        const covered=Number.isFinite(ms)&&ms>=COMET_START_MS&&ms<COMET_END_MS;
        const jd=available&&Number.isFinite(et)?2451545+et/DAY:NaN;
        const approximate=!covered;
        if(this.approximate!==approximate){for(const e of this.entries.values())e.pathEpoch=NaN;}
        this.approximate=approximate;this.jd=jd;
        this.setNotice(this.error||(this.loading?'Loading extended comet ephemerides…':''));
        let any=false;
        for(const [key,e]of this.entries){
            const visible=this.sample(e.t,jd,e.state);e.root.visible=visible;e.mesh.visible=visible;
            if(!visible){e.path.visible=false;continue;}any=true;
            this.mapPosition(e.state,e.mesh.position);e.r=Math.hypot(e.state[0],e.state[1],e.state[2]);cometAppearance(e.r,e.appearance,key);
            e.active=e.appearance.comaActivity;
            const tailActive=e.appearance.tailActivity;
            e.mesh.material.opacity=1;e.mesh.material.depthWrite=true;
            e.mesh.rotation.y=jd*Math.PI/2;
            e.coma.position.copy(e.mesh.position);
            const units=this.km2u(1);
            const comaRadius = Math.max(e.mesh.geometry.parameters.radius * 2.8, e.appearance.comaRadiusKm * units);
            e.coma.scale.setScalar(comaRadius);
            const comaUniforms = e.coma.material.uniforms;
            comaUniforms.opticalDepth.value = e.appearance.opticalDepth;
            comaUniforms.activity.value = e.appearance.comaActivity;
            comaUniforms.dustRadius.value = Math.max(0.001, Math.min(1, e.appearance.dustRadiusKm * units / comaRadius));
            comaUniforms.gasLength.value = Math.max(0.01, e.appearance.gasLengthKm * units / comaRadius);
            comaUniforms.gasFraction.value = e.appearance.gasFraction;
            comaUniforms.coreRadius.value = Math.max(0.000001, e.mesh.geometry.parameters.radius * 1.25 / comaRadius);
            comaUniforms.dustTint.value.setHex(e.appearance.dustTint);
            comaUniforms.gasTint.value.setHex(e.appearance.gasTint);
            const phase = ((jd % 32) + 32) % 32 / 32 * Math.PI * 2;
            comaUniforms.flow.value.set(Math.sin(phase) * 0.2, Math.cos(phase) * 0.17, Math.sin(phase * 2) * 0.12);
            e.coma.visible = e.appearance.comaActivity > 0 && e.appearance.opticalDepth > 0;
            e.coma.userData.radiusKm = e.appearance.comaRadiusKm;
            e.mesh.userData.comaRadius = e.coma.visible ? comaRadius : 0;
            for (const tail of [...e.ions, ...e.dust]) {
                tail.visible = tailActive > 0 && tail.userData.volumeReady;
                tail.material.uniforms.comaRadius.value = e.coma.visible ? comaRadius : 0;
            }
            if (tailActive > 0 && (e.ionJD !== jd || waveChanged)) { this.updateIons(e); e.ionJD = jd; }
            const dustChanged = tailActive > 0 && (!Number.isFinite(e.tailJD) || Math.abs(jd - e.tailJD) >= 1 / 2880);
            if (dustChanged) {
                this.updateTails(e, jd);
                e.tailJD = jd;
            }
            for (const tail of e.ions) tail.material.uniforms.opacity.value = e.appearance.ionBrightness;
            for (let i = 0; i < e.dust.length; i++) {
                const tail = e.dust[i];
                tail.material.uniforms.opacity.value = e.appearance.dustBrightness;
                tail.position.copy(e.mesh.position);
            }
            if (tailActive > 0 && waveChanged && !dustChanged) this.updateDustFan(e);
            this.updateJets(e,jd);
            this.updatePath(e,jd,showOrbits,style,length,key===this.highlighted);
        }
        this.paintRows(any);
    }
    tailPoint(state, entry, output) {
        const units = this.km2u(1);
        output.set(
            (state[0] - entry.state[0]) * COMET_KM_PER_AU * units,
            (state[2] - entry.state[2]) * COMET_KM_PER_AU * units,
            -(state[1] - entry.state[1]) * COMET_KM_PER_AU * units
        );
        return output;
    }
    tailWidth(tail, index, physicalWidthKm) {
        const units = this.km2u(1);
        const physicalLength = tail.userData.physicalLengths[index] * units;
        const offset = index * 3;
        const points = tail.userData.points;
        const length = Math.hypot(points[offset], points[offset + 1], points[offset + 2]);
        const compression = physicalLength > 1e-12 ? Math.min(1, length / physicalLength) : 1;
        return physicalWidthKm * units * compression;
    }
    updateIons(entry) {
        const state = entry.state;
        const solarWind = 400 * 86400 / COMET_KM_PER_AU;
        const away = this.ionAway.set(
            state[0] / entry.r - state[3] / solarWind,
            state[2] / entry.r - state[5] / solarWind,
            -state[1] / entry.r + state[4] / solarWind
        ).normalize();
        const cross = this.ionCross.set(0, 1, 0).cross(away);
        if (cross.lengthSq() < 1e-10) cross.set(1, 0, 0).cross(away);
        cross.normalize();
        const up = this.ionUp.crossVectors(away, cross).normalize();
        for (const tail of entry.ions) {
            const points = tail.userData.points;
            const count = tail.userData.segments;
            for (let i = 0; i <= count; i++) {
                const fraction = Math.pow(i / count, 1.6);
                const length = entry.appearance.ionLengthKm * fraction;
                const phase = fraction * 7 - ((this.jd % 16 + 16) % 16) * Math.PI * 2 / 16 - this.waveTime * 0.34;
                const transverse = entry.appearance.ionRadiusKm * fraction * 0.08;
                const x = away.x * length + cross.x * Math.sin(phase) * transverse + up.x * Math.cos(phase * 2 + 0.7) * transverse;
                const y = away.y * length + cross.y * Math.sin(phase) * transverse + up.y * Math.cos(phase * 2 + 0.7) * transverse;
                const z = away.z * length + cross.z * Math.sin(phase) * transverse + up.z * Math.cos(phase * 2 + 0.7) * transverse;
                this.scratch[0] = state[0] + x / COMET_KM_PER_AU;
                this.scratch[1] = state[1] - z / COMET_KM_PER_AU;
                this.scratch[2] = state[2] + y / COMET_KM_PER_AU;
                this.tailPoint(this.scratch, entry, this.mapScratch);
                points.set([this.mapScratch.x, this.mapScratch.y, this.mapScratch.z], i * 3);
                tail.userData.physicalLengths[i] = Math.hypot(x, y, z);
            }
            tail.position.copy(entry.mesh.position);
            let streamWidth=0;
            writeTailVolume(tail,points,fraction=>{
                const index=Math.round(fraction*count);
                const physicalWidth=entry.appearance.ionRadiusKm*(0.28+0.72*Math.sqrt(Math.pow(fraction,1.6)));
                const compressed=this.tailWidth(tail,index,physicalWidth);
                tail.userData.referenceWidths[index]=compressed;
                streamWidth=Math.max(streamWidth,compressed);
                return streamWidth;
            },entry.appearance.ionBrightness);
        }
    }
    updateTails(entry, jd) {
        const active = entry.appearance.tailActivity;
        const units = this.km2u(1);
        entry.dustPopulations.forEach((tail, population) => {
            const points = tail.userData.points;
            const count = tail.userData.segments;
            const ageLimit = this.approximate ? Infinity : jd - entry.t.startJD;
            const maximumAge = Math.max(0, Math.min(entry.appearance.dustAgeDays, ageLimit));
            for (let i = 0; i <= count; i++) {
                const age = maximumAge * i / count;
                const valid = this.sample(entry.t, jd - age, this.scratch);
                const released = valid ? cometActivity(
                    Math.hypot(this.scratch[0], this.scratch[1], this.scratch[2]),
                    entry.mesh.userData.planetKey, 'tail',
                ) : 0;
                tail.userData.emission[i] = Math.min(1, released / Math.max(active, 1e-12));
                if (i === 0) {
                    points.set([0, 0, 0], 0);
                    tail.userData.physicalLengths[i] = 0;
                    continue;
                }
                if (!valid || released === 0) {
                    points.copyWithin(i * 3, (i - 1) * 3, i * 3);
                    tail.userData.physicalLengths[i] = tail.userData.physicalLengths[i - 1];
                    continue;
                }
                propagateDust(this.scratch, age, DUST_BETAS[population], this.dustScratch);
                tail.userData.physicalLengths[i] = Math.hypot(
                    this.dustScratch[0] - entry.state[0],
                    this.dustScratch[1] - entry.state[1],
                    this.dustScratch[2] - entry.state[2]
                ) * COMET_KM_PER_AU;
                this.tailPoint(this.dustScratch, entry, this.mapScratch);
                points.set([this.mapScratch.x, this.mapScratch.y, this.mapScratch.z], i * 3);
            }
            for(let i=0;i<=count;i++){
                const physical=tail.userData.physicalLengths[i];
                const width=Math.min(entry.appearance.dustWidthKm,entry.appearance.dustRadiusKm*.085+physical*.055);
                tail.userData.widths[i]=Math.max(units*.01,this.tailWidth(tail,i,width));
            }
        });
        this.updateDustFan(entry);
    }
    updateDustFan(entry){
        const tail=entry.dust[0];tail.position.copy(entry.mesh.position);
        writeDustFanVolume(tail,entry.dustPopulations,DUST_WEIGHTS,entry.appearance.dustBrightness,this.waveTime);
    }
    updateJets(e,jd){
        const a=e.appearance.jetActivity,rad=e.mesh.geometry.parameters.radius,sunward=this.jetSun.set(-e.state[0],-e.state[2],e.state[1]).normalize();
        const origin=this.jetOrigin,normal=this.jetNormal,direction=this.jetDirection,side=this.jetSide;
        for(let j=0;j<e.jets.length;j++){
            const jet=e.jets[j],vent=e.vents[j],points=jet.userData.points,n=jet.userData.segments;
            origin.copy(vent.position).applyQuaternion(e.mesh.quaternion);normal.copy(vent.normal).applyQuaternion(e.mesh.quaternion).normalize();
            let light=Math.max(0,Math.min(1,(normal.dot(sunward)-.02)/.5));light=light*light*(3-2*light);
            jet.visible=a>0&&light>0;jet.userData.sunlight=light;if(!jet.visible){jet.material.uniforms.opacity.value=0;continue;}
            const phase=((jd%1)+1)%1*24+j/8;jet.material.uniforms.phase.value=phase;
            direction.copy(normal).multiplyScalar(.75).addScaledVector(sunward,.25).normalize();side.set(0,1,0).cross(direction);if(side.lengthSq()<1e-10)side.set(1,0,0).cross(direction);side.normalize();
            const reach=rad*(50+9*j)*Math.sqrt(a);
            for(let i=0;i<=n;i++){const u=i/n;this.mapScratch.copy(origin).addScaledVector(direction,reach*u).addScaledVector(side,Math.sin(u*8-phase*6.28318530718+j)*rad*.55*u*u);points.set([this.mapScratch.x,this.mapScratch.y,this.mapScratch.z],i*3);}
            writePlume(jet,points,u=>rad*(.1+(3.5+.6*(j%3))*Math.pow(u,.7)),.7*a*light);
            jet.position.copy(e.mesh.position);
        }
    }
    updatePath(e,jd,enabled,style,length,highlighted){
        e.path.visible=!!enabled&&!(this.approximate&&style==='trails');if(!e.path.visible)return;
        e.path.material.opacity=highlighted?.78:.26;
        if(style!=='trails'){
            if(e.path.userData.osculating&&e.pathBodyJD===jd)return;
            const orbit=osculatingEllipse(e.state,e.orbitElements||(e.orbitElements={}));
            if(orbit){
                const attr=e.path.geometry.attributes.position;e.path.position.copy(e.mesh.position);
                for(let i=0;i<=768;i++){if(i===0||i===768)this.scratch.set(e.state);else sampleEllipse(orbit,i/768,this.scratch);this.mapPosition(this.scratch,this.mapScratch).sub(e.path.position);attr.setXYZ(i,this.mapScratch.x,this.mapScratch.y,this.mapScratch.z);}
                attr.needsUpdate=true;e.path.geometry.setDrawRange(0,769);e.path.userData.osculating=true;e.pathBodyJD=jd;e.pathEpoch=NaN;return;
            }
        }
        e.path.userData.osculating=false;
        const fraction=Number.isFinite(length)?Math.max(.05,Math.min(1,length)):.65;
        const rebuild=!Number.isFinite(e.pathEpoch)||Math.abs(jd-e.pathEpoch)>=1||e.pathStyle!==style||e.pathLength!==fraction||jd<=e.pathBefore||(style!=='trails'&&jd>=e.pathAfter);
        const attr=e.path.geometry.attributes.position;
        if(rebuild){
            e.pathEpoch=jd;e.pathStyle=style;e.pathLength=fraction;
            const duration=e.t.periodDays*(style==='trails'?fraction:1),start=Math.max(e.t.startJD,jd-(style==='trails'?duration:duration*.5));
            const end=Math.min(e.t.endJD,jd+(style==='trails'?0:duration*.5));
            const times=[];for(let i=0;i<=768;i++){const t=start+(end-start)*i/768;if(Math.abs(t-jd)>1e-8)times.push(t);}times.push(jd);times.sort((a,b)=>a-b);
            e.pathBodyIndex=times.indexOf(jd);e.pathBefore=times[e.pathBodyIndex-1]??-Infinity;e.pathAfter=times[e.pathBodyIndex+1]??Infinity;
            e.path.position.copy(e.mesh.position);
            for(let i=0;i<times.length;i++){this.sample(e.t,times[i],this.scratch);this.mapPosition(this.scratch,this.mapScratch).sub(e.path.position);attr.setXYZ(i,this.mapScratch.x,this.mapScratch.y,this.mapScratch.z);}
            e.path.geometry.setDrawRange(0,times.length);attr.needsUpdate=true;
        }
        if(rebuild||e.pathBodyJD!==jd){
            this.mapScratch.copy(e.mesh.position).sub(e.path.position);attr.setXYZ(e.pathBodyIndex,this.mapScratch.x,this.mapScratch.y,this.mapScratch.z);attr.needsUpdate=true;e.pathBodyJD=jd;
        }
    }
    setHighlighted(key){this.highlighted=key;}
    clearRender(){
        const geometry=new Set(),material=new Set();
        for(const [key,e]of this.entries){
            for(const obj of [e.root,e.path]){obj.removeFromParent();obj.traverse(o=>{if(o.geometry)geometry.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])material.add(m);});}
            if(this.objectRegistry[key]===e.mesh)delete this.objectRegistry[key];
        }
        for(const g of geometry)g.dispose();for(const m of material)m.dispose();this.entries.clear();this.paintRows(false);
    }
    get meshes(){return Array.from(this.entries.values(),e=>e.mesh);}
    dispose(){if(this.disposed)return;this.disposed=true;this.controller?.abort();this.clearRender();this.tables=null;this.notice.remove();}
}
