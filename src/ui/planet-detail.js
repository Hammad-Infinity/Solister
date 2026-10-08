export function installAnchoredDock(){
 const dock=document.getElementById('ui-dock'),body=document.getElementById('dock-body');
 const style=document.createElement('style');style.textContent=`
 #ui-dock{height:76px!important;width:var(--dock-width)}
 #ui-dock #dock-body{position:absolute;top:var(--panel-offset,0px);height:var(--panel-height,520px)!important;max-height:none!important;box-sizing:border-box;overflow-x:hidden!important;overflow-y:auto!important;scrollbar-width:none!important;scrollbar-gutter:auto!important;overscroll-behavior:contain;overflow-anchor:none}
 #ui-dock #dock-body::-webkit-scrollbar,#ui-dock #dock-body *::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}
 #ui-dock #dock-body *{scrollbar-width:none!important}
 `;document.head.append(style);
 let queued=false,disposed=false;const observed=new Set();
 function layout(){
  queued=false;if(disposed||!body.isConnected)return;
  const oldScroll=body.scrollTop,box=body.getBoundingClientRect(),cs=getComputedStyle(body);
  let bottom=parseFloat(cs.paddingTop)||0;
  for(const child of body.children){
   const css=getComputedStyle(child);
   if(css.display==='none'||css.position==='absolute'||css.position==='fixed')continue;
   const r=child.getBoundingClientRect();
   const top=child.offsetParent===body?child.offsetTop:r.top-box.top-body.clientTop+oldScroll;
   bottom=Math.max(bottom,top+child.offsetHeight+(parseFloat(css.marginBottom)||0));
  }
  const natural=Math.ceil(bottom+(parseFloat(cs.paddingBottom)||0)+(parseFloat(cs.borderTopWidth)||0)+(parseFloat(cs.borderBottomWidth)||0));
  const available=Math.max(1,innerHeight-24),h=Math.min(available,Math.max(76,natural));
  const top=dock.getBoundingClientRect().top,anchor=top+38;
  let panelTop=anchor>innerHeight/2?anchor+26-h:anchor-26;
  panelTop=Math.max(12,Math.min(innerHeight-12-h,panelTop));
  const offset=(panelTop-top)+'px',height=h+'px';
  const changed=dock.style.getPropertyValue('--panel-height')!==height||dock.style.getPropertyValue('--panel-offset')!==offset;
  if(!changed)return;
  dock.style.setProperty('--panel-offset',offset);dock.style.setProperty('--panel-height',height);
  const next=Math.min(oldScroll,Math.max(0,body.scrollHeight-body.clientHeight));
  if(body.scrollTop!==next)body.scrollTop=next;
 }
 function schedule(){if(!disposed&&!queued){queued=true;requestAnimationFrame(layout);}}
 const sizeObserver=new ResizeObserver(schedule);
 function observeChildren(){
  for(const child of observed)if(child.parentElement!==body){sizeObserver.unobserve(child);observed.delete(child);}
  for(const child of body.children)if(!observed.has(child)){observed.add(child);sizeObserver.observe(child);}
 }
 let anchorSignature='';
 const anchorObserver=new MutationObserver(()=>{
  const signature=[dock.style.top,dock.style.left,dock.style.right,dock.className,dock.dataset.side].join('|');
  if(signature!==anchorSignature){anchorSignature=signature;schedule();}
 });
 anchorObserver.observe(dock,{attributes:true,attributeFilter:['style','class','data-side']});
 const contentObserver=new MutationObserver(()=>{observeChildren();schedule();});
 contentObserver.observe(body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','open']});
 observeChildren();addEventListener('resize',schedule);layout();
 return {layout,dispose(){disposed=true;sizeObserver.disconnect();anchorObserver.disconnect();contentObserver.disconnect();removeEventListener('resize',schedule);style.remove();}};
}
function seededPlanetStormRandom(seed){
 let state=seed>>>0;
 return ()=>{
  state=(state+0x6D2B79F5)|0;let t=state;
  t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);
  return ((t^(t>>>14))>>>0)/4294967296;
 };
}
function makePlanetStormRegions(T,key){
 const jupiter=key==='jupiter';
 const bands=jupiter?[-34,-25,-17,-8,6,15,22,31,40]:[-42,-34,-24,-13,8,18,28,35,43];
 const perBand=jupiter?4:3;
 const rand=seededPlanetStormRandom(jupiter?0x6A71E2:0x5A7A2);
 const regions=[];
 for(let b=0;b<bands.length;b++)for(let j=0;j<perBand;j++){
  const latDeg=bands[b]+(rand()-.5)*(jupiter?4.0:3.2);
  const lonDeg=(j*360/perBand+b*137.507764+ (rand()-.5)*24+360)%360;
  const lat=latDeg*Math.PI/180,lon=lonDeg*Math.PI/180,c=Math.cos(lat);
  regions.push({
   center:new T.Vector3(-c*Math.cos(lon),Math.sin(lat),c*Math.sin(lon)),
   activity:.65+rand()*.55,
   next:0
  });
 }
 const hotspot=jupiter?[-22.5,40,1.8]:[35,230,1.45];
 const lat=hotspot[0]*Math.PI/180,lon=hotspot[1]*Math.PI/180,c=Math.cos(lat);
 regions.push({
  center:new T.Vector3(-c*Math.cos(lon),Math.sin(lat),c*Math.sin(lon)),
  activity:hotspot[2],next:0
 });
 return regions;
}
const shaderUV=`vec2 detailUV(vec3 n){n=normalize(n);return vec2(fract(atan(n.z,-n.x)/6.28318530718),1.0-acos(clamp(n.y,-1.0,1.0))/3.14159265359);}`;
const cloudSampling=`
vec4 detailCloudUV(vec2 uv){
 vec2 dx=dFdx(uv),dy=dFdy(uv);
 dx.x-=floor(dx.x+.5);dy.x-=floor(dy.x+.5);
 vec2 p=(dMapTransform*vec3(uv,1.0)).xy;
 dx=(dMapTransform*vec3(dx,0.0)).xy;dy=(dMapTransform*vec3(dy,0.0)).xy;
 #if __VERSION__ >= 300
  return textureGrad(dCloudMap,p,dx,dy);
 #elif defined(GL_EXT_shader_texture_lod)
  return texture2DGradEXT(dCloudMap,p,dx,dy);
 #else
  return texture2D(dCloudMap,p);
 #endif
}
`;
function hook(material,key,uniforms,declarations,vertex,token,effect){
 material.extensions=Object.assign({},material.extensions,{derivatives:true,shaderTextureLOD:true});
 const previous=material.onBeforeCompile,cache=material.customProgramCacheKey();
 material.onBeforeCompile=function(s,r){previous.call(this,s,r);Object.assign(s.uniforms,uniforms);
  s.vertexShader='varying vec3 vDetailLocal;\n'+s.vertexShader;
  s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vDetailLocal=position;'+vertex);
  s.fragmentShader='varying vec3 vDetailLocal;\n'+declarations+'\n'+s.fragmentShader;
  s.fragmentShader=s.fragmentShader.replace(token,token+'\n{\n'+effect+'\n}\n');
 };
 material.customProgramCacheKey=()=>cache+'|detail-'+key;material.needsUpdate=true;
}
export class PlanetDetail {
 constructor({THREE,objectRegistry,cloudMeshes,camera,renderer,getEnabled}){
  Object.assign(this,{T:THREE,objectRegistry,cloudMeshes,camera,renderer,getEnabled});const T=THREE;
  this.earthMaterial=null;this.cloudMaterial=null;this.gas={};this.v=new T.Vector3();this.p=new T.Vector3();this.s=new T.Vector3();this.q=new T.Quaternion();this.q2=new T.Quaternion();this.m=new T.Matrix4();this.screen=new T.Vector2();
  this.u={dCloudMap:{value:null},dCloudRotation:{value:new T.Matrix3()},dSun:{value:new T.Vector3(1,0,0)},dCloudRatio:{value:1.001884},dShadowStrength:{value:0},dMapTransform:{value:new T.Matrix3()},dLocalCamera:{value:new T.Vector3()}};
 }
 bindEarth(earth,cloud){
  if(this.earthMaterial!==earth.material){this.earthMaterial=earth.material;
   hook(earth.material,'shadow',this.u,`uniform sampler2D dCloudMap;uniform mat3 dCloudRotation;uniform mat3 dMapTransform;uniform vec3 dSun;uniform float dCloudRatio;uniform float dShadowStrength;${shaderUV}${cloudSampling}`,'','#include <lights_fragment_end>',`
    vec3 sn=normalize(vDetailLocal);float sunHeight=dot(sn,dSun);
    if(dShadowStrength>0.001 && sunHeight>0.0){
     float rayDistance=-sunHeight+sqrt(max(0.0,sunHeight*sunHeight+dCloudRatio*dCloudRatio-1.0));
     vec3 hit=normalize(dCloudRotation*(sn+dSun*rayDistance));
     vec2 uv=detailUV(hit);
     vec3 a=detailCloudUV(uv).rgb;
     vec3 b=detailCloudUV(uv+vec2(.00035,0.0)).rgb;
     vec3 c=detailCloudUV(uv-vec2(.00035,0.0)).rgb;
     float density=dot((a+b+c)/3.0,vec3(.333333));
     float shadow=(1.0-exp(-density*3.4))*dShadowStrength*smoothstep(0.0,.045,sunHeight);
     reflectedLight.directDiffuse*=1.0-shadow;
     reflectedLight.directSpecular*=1.0-shadow;
    }
   `);
  }
  if(this.cloudMaterial!==cloud.material){this.cloudMaterial=cloud.material;
   hook(cloud.material,'cloud-volume',this.u,`uniform sampler2D dCloudMap;uniform mat3 dMapTransform;uniform vec3 dLocalCamera;uniform float dCloudRatio;${shaderUV}${cloudSampling}`,'','#include <map_fragment>',`
    vec3 outer=normalize(vDetailLocal)*dCloudRatio;
    vec3 towardEye=normalize(dLocalCamera-outer);
    float facing=max(dot(normalize(outer),towardEye),0.001);
    float innerR=1.0+(dCloudRatio-1.0)*.25;
    float b=dot(outer,towardEye),disc=b*b-dot(outer,outer)+innerR*innerR;
    float distanceIn=disc>0.0?b-sqrt(disc):2.0*b;
    distanceIn=clamp(distanceIn,0.0,.20);
    float optical=0.0,grey=0.0;
    for(int j=0;j<12;j++){
     vec3 pos=outer-towardEye*(float(j)+.5)*distanceIn/12.0;
     float altitude=(length(pos)-innerR)/max(.00001,dCloudRatio-innerR);
     float envelope=smoothstep(0.0,.18,altitude)*(1.0-smoothstep(.80,1.0,altitude));
     vec2 uv=detailUV(pos);
     vec3 sampleCloud=detailCloudUV(uv).rgb;
     float density=max(max(sampleCloud.r,sampleCloud.g),sampleCloud.b)*envelope;
     optical+=density;grey+=density*density;
    }
    float depth=optical*distanceIn/(12.0*max(.00001,dCloudRatio-innerR));
    diffuseColor.a*=1.0-exp(-depth*3.8);
    diffuseColor.rgb=vec3(mix(.60,1.0,clamp(grey/max(optical,.00001),0.0,1.0)));
   `);
  }
 }
 bindGas(key,mesh){
  const T=this.T,old=this.gas[key];if(old?.material===mesh.material)return old;
  // Lightning/storm flashes recur inside stable, planet-specific latitude
  // belts and longitudes instead of teleporting to random points on the globe.
  const regions=makePlanetStormRegions(T,key);
  const state={material:mesh.material,regions,events:Array(4).fill(null),paused:true,last:0,u:{gCenters:{value:Array.from({length:4},()=>new T.Vector4(0,1,0,.007))},gSun:{value:new T.Vector3(1,0,0)},gPowers:{value:Array(4).fill(0)},gTint:{value:new T.Vector3(...(key==='jupiter'?[.83,.87,1.0]:[.66,.80,1.0]))},gDiffusion:{value:key==='jupiter'?.34:.16}}};this.gas[key]=state;
  hook(mesh.material,'regional-storm-'+key,state.u,'uniform vec4 gCenters[4];uniform vec3 gSun;uniform float gPowers[4];uniform vec3 gTint;uniform float gDiffusion;','','#include <emissivemap_fragment>',`
   vec3 n=normalize(vDetailLocal);float illumination=0.0;
   for(int i=0;i<4;i++){
    if(gPowers[i]>.001){
     vec3 delta=n-gCenters[i].xyz;float d=dot(delta,delta)/(gCenters[i].w*gCenters[i].w);
     float irregular=.78+.24*sin(n.x*1800.0+n.y*970.0)*sin(n.z*1400.0);
     illumination+=gPowers[i]*(3.5*exp(-d*irregular*2.5)+gDiffusion*exp(-d*.48));
    }
   }
   float night=1.0-smoothstep(-.15,.06,dot(n,gSun));
   totalEmissiveRadiance+=gTint*illumination*night;
  `);return state;
 }
 update(){
  const T=this.T,earth=this.objectRegistry.earth,cloud=this.cloudMeshes.earth,sun=this.objectRegistry.sun;if(!sun)return;
  sun.getWorldPosition(this.s);
  if(earth&&cloud&&cloud.material.map?.image){
   this.bindEarth(earth,cloud);earth.updateWorldMatrix(true,false);cloud.updateWorldMatrix(true,false);
   earth.getWorldPosition(this.p);earth.getWorldQuaternion(this.q);cloud.getWorldQuaternion(this.q2).invert();
   this.q2.multiply(this.q);this.m.makeRotationFromQuaternion(this.q2);this.u.dCloudRotation.value.setFromMatrix4(this.m);
   this.u.dSun.value.copy(this.s).sub(this.p).normalize().applyQuaternion(this.q.invert());
   const map=cloud.material.map;
   for(const texture of [map,earth.material.map,earth.userData.nightMesh?.material.uniforms.nightTexture.value]){
    if(texture && texture.wrapS!==T.RepeatWrapping){texture.wrapS=T.RepeatWrapping;texture.needsUpdate=true;}
   }
   const gradientSampling=this.renderer.capabilities.isWebGL2 || this.renderer.extensions?.has?.('EXT_shader_texture_lod');
   if(!gradientSampling && map.minFilter!==T.LinearFilter){map.minFilter=T.LinearFilter;map.generateMipmaps=false;map.needsUpdate=true;}
   map.updateMatrix();this.u.dCloudMap.value=map;this.u.dMapTransform.value.copy(map.matrix);
   this.u.dCloudRatio.value=cloud.geometry.parameters.radius/earth.geometry.parameters.radius;
   this.u.dShadowStrength.value=cloud.visible?Math.min(.90,cloud.material.opacity):0;
   this.camera.getWorldPosition(this.v);cloud.worldToLocal(this.v);this.u.dLocalCamera.value.copy(this.v).divideScalar(earth.geometry.parameters.radius);
  }else this.u.dShadowStrength.value=0;
  const now=performance.now()/1000;this.renderer.getSize(this.screen);
  for(const key of ['jupiter','saturn']){
   const mesh=this.objectRegistry[key];if(!mesh)continue;mesh.updateWorldMatrix(true,false);const state=this.bindGas(key,mesh);
   mesh.getWorldPosition(this.p);mesh.getWorldQuaternion(this.q).invert();state.u.gSun.value.copy(this.s).sub(this.p).normalize().applyQuaternion(this.q);
   this.camera.getWorldPosition(this.v);this.v.sub(this.p);const distance=this.v.length();this.v.normalize().applyQuaternion(this.q);
   mesh.getWorldScale(this.p);const radius=(mesh.geometry?.parameters?.radius||0)*Math.abs(this.p.x);
   const pixels=radius*this.camera.projectionMatrix.elements[5]*this.screen.y/(2*Math.max(radius,distance));
   if(document.hidden||!this.getEnabled(key)||!mesh.visible||pixels<24||now-state.last>1){state.u.gPowers.value.fill(0);state.events.fill(null);state.paused=true;state.last=now;continue;}
   state.last=now;
   if(state.paused){state.paused=false;for(const region of state.regions)region.next=now+2+Math.random()*30/Math.max(.45,region.activity);}
   for(let i=0;i<4;i++){
    const event=state.events[i];let power=0;
    if(event){const age=now-event.start;if(age>1)state.events[i]=null;
     else for(const [delay,gain]of (key==='jupiter'?[[0,1],[.30,.5]]:[[0,.8],[.20,.3]])){const t=age-delay;if(t>=0)power+=gain*(1-Math.exp(-t/.015))*Math.exp(-t/.10);}
    }
    state.u.gPowers.value[i]=power;
   }
   for(const region of state.regions){
    if(now<region.next)continue;
    region.next=now+(key==='jupiter'?14:24)-Math.log(Math.max(.001,1-Math.random()))*(key==='jupiter'?28:38)/Math.max(.45,region.activity);
    const n=region.center;if(n.dot(state.u.gSun.value)>-.06||n.dot(this.v)<.15)continue;
    const slot=state.events.findIndex(e=>!e);if(slot<0)continue;
    state.u.gCenters.value[slot].set(n.x,n.y,n.z,(key==='jupiter'?.006:.004)+Math.random()*.004);
    state.events[slot]={start:now};
   }
  }
 }
}
export function textureZoomFactor(mesh){
 const image=mesh.material?.map?.image,width=image?.naturalWidth||image?.width||0;
 const lod=Math.max(0,Math.min(2,Math.log2(Math.max(2048,width)/2048)));
 return width?(lod<1?1.75-.35*lod:1.50-.10*lod):1.65;
}