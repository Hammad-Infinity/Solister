const EARTH_STORM_HOTSPOTS = Object.freeze([
 [8,-62], [6,18], [10,105], [19,78], [17,-90], [-7,135],
 [39,-55], [43,150], [-36,160], [-41,-110], [28,48], [33,-25]
]);
function seededWeatherRandom(seed){
 let state=seed>>>0;
 return ()=>{
  state=(state+0x6D2B79F5)|0;let t=state;
  t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);
  return ((t^(t>>>14))>>>0)/4294967296;
 };
}
export class EarthWeather {
 constructor({THREE,objectRegistry,cloudMeshes,camera,renderer,getLightningEnabled}){
  Object.assign(this,{T:THREE,objectRegistry,cloudMeshes,camera,renderer,getLightningEnabled});
  const T=THREE;
  this.earthPos=new T.Vector3();
  this.sunPos=new T.Vector3();
  this.moonPos=new T.Vector3();
  this.viewPos=new T.Vector3();
  this.a=new T.Vector3();
  this.b=new T.Vector3();
  this.q=new T.Quaternion();
  this.size=new T.Vector2();
  this.scale=new T.Vector3();
  this.cloud=null;
  this.surface=null;
  this.texture=null;
  this.candidates=[];
  this.events=Array(8).fill(null);
  this.regions=[];
  this.hotspots=EARTH_STORM_HOTSPOTS.map(([latDeg,lonDeg])=>{
   const lat=latDeg*Math.PI/180,lon=lonDeg*Math.PI/180,c=Math.cos(lat);
   return new T.Vector3(-c*Math.cos(lon),Math.sin(lat),c*Math.sin(lon));
  });
  this.stormPaused=true;
  this.next=0;
  this.lastTime=null;
  this.stats={events:0,candidates:0,regions:0,scheduledBursts:0,globalRateTarget:4.2};
  this.cloudU=this.uniforms();
  this.surfaceU=this.uniforms();
 }
 uniforms(){
  const T=this.T;
  return {
   uWeatherSun:{value:new T.Vector3(1,0,0)},
   uWeatherMoon:{value:new T.Vector3(1,0,0)},
   uWeatherMoonPhase:{value:0},
   uStormCenters:{value:Array.from({length:8},()=>new T.Vector4(1,0,0,.02))},
   uStormPower:{value:Array(8).fill(0)},
  };
 }
 bind(material,u,cloud){
  if(!material||material.userData.orbitalWeather)return;
  const previous=material.onBeforeCompile;
  const cacheKey=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer){
   if(previous)previous.call(this,shader,renderer);
   if(!shader.vertexShader.includes('#include <begin_vertex>')||!shader.fragmentShader.includes('#include <emissivemap_fragment>')){
    console.warn('Earth weather: unsupported material shader.');
    return;
   }
   Object.assign(shader.uniforms,u);
   shader.vertexShader='varying vec3 vWeatherLocal;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vWeatherLocal=normalize(position);');
   shader.fragmentShader=`varying vec3 vWeatherLocal;
    uniform vec3 uWeatherSun;uniform vec3 uWeatherMoon;uniform float uWeatherMoonPhase;
    uniform vec4 uStormCenters[8];uniform float uStormPower[8];
    float weatherTexture(vec3 n){return .5+.25*sin(n.x*1270.0+n.z*790.0)*sin(n.y*1030.0-n.x*330.0)+.25*sin(n.z*2190.0+n.y*1670.0);}
   `+shader.fragmentShader;
   const common=`
    vec3 weatherN=normalize(vWeatherLocal);
    float weatherNight=1.0-smoothstep(-.12,.10,dot(weatherN,uWeatherSun));
    float weatherMoon=max(dot(weatherN,uWeatherMoon),0.0)*uWeatherMoonPhase;
   `;
   const effect=cloud?`
    float cloudDensity=clamp(max(max(diffuseColor.r,diffuseColor.g),diffuseColor.b),0.0,1.0);
    diffuseColor.a*=smoothstep(.012,.18,cloudDensity);
    totalEmissiveRadiance*=1.0-weatherNight;
    totalEmissiveRadiance+=cloudDensity*weatherNight*(vec3(.026,.038,.055)+weatherMoon*vec3(.025,.028,.032));
    float illumination=0.0;
    for(int i=0;i<8;i++){
     if(uStormPower[i]>.001){
      vec3 offset=weatherN-uStormCenters[i].xyz;
      float d=dot(offset,offset)/(uStormCenters[i].w*uStormCenters[i].w);
      d*=.70+.65*weatherTexture(weatherN);
      illumination+=uStormPower[i]*(3.8*exp(-d*2.6)+.38*exp(-d*.43)+3.0*exp(-d*9.0));
     }
    }
    totalEmissiveRadiance+=vec3(.72,.84,1.0)*illumination*cloudDensity*weatherNight;
   `:`
    totalEmissiveRadiance+=weatherNight*(vec3(.002,.003,.005)+weatherMoon*vec3(.003,.004,.005))*mix(vec3(.35),vec3(1.0),diffuseColor.rgb);
   `;
   shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n'+common+effect);
  };
  material.customProgramCacheKey=()=>cacheKey+'|orbital-weather-v1|'+Number(cloud);
  material.userData.orbitalWeather=true;
  material.needsUpdate=true;
 }
 drawableImage(image){
  if(!image)return false;
  const w=image.naturalWidth||image.videoWidth||image.width;
  const h=image.naturalHeight||image.videoHeight||image.height;
  if(!w||!h)return false;
  const checks=['HTMLImageElement','HTMLCanvasElement','HTMLVideoElement','ImageBitmap','OffscreenCanvas','SVGImageElement','VideoFrame'];
  for(const name of checks){
   const C=globalThis[name];
   if(C&&image instanceof C)return true;
  }
  return false;
 }
 fallbackSample(){
  this.candidates=[];
  for(let y=18;y<110;y+=4){
   for(let x=0;x<256;x+=4){
    const u=(x+.5)/256;
    const v=(y+.5)/128;
    const lat=90-v*180;
    const belt=Math.exp(-Math.pow(Math.abs(lat)-18,2)/260)+.45*Math.exp(-Math.pow(Math.abs(lat)-42,2)/420);
    const n=.5+.5*Math.sin(x*12.9898+y*78.233)*Math.sin(x*.37-y*.19);
    if(belt*n<.42)continue;
    const phi=u*Math.PI*2;
    const theta=v*Math.PI;
    this.candidates.push(new this.T.Vector3(-Math.cos(phi)*Math.sin(theta),Math.cos(theta),Math.sin(phi)*Math.sin(theta)));
   }
  }
  if(this.candidates.length>1024){
   const source=this.candidates;
   this.candidates=Array.from({length:1024},(_,i)=>source[Math.floor(i*source.length/1024)]);
  }
 }
 sample(texture){
  this.texture=texture;
  this.candidates=[];
  this.regions=[];
  this.stats.regions=0;
  this.clear();
  this.next=performance.now()/1000+3;
  const image=texture?.image;
  if(!this.drawableImage(image)){
   this.fallbackSample();
   this.stats.candidates=this.candidates.length;
   this.createRegions();
   return;
  }
  try{
   const canvas=document.createElement('canvas');
   canvas.width=256;
   canvas.height=128;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   ctx.drawImage(image,0,0,256,128);
   const pixels=ctx.getImageData(0,0,256,128).data;
   for(let y=20;y<108;y+=2){
    for(let x=0;x<256;x+=2){
     const offset=(y*256+x)*4;
     const brightness=Math.max(pixels[offset],pixels[offset+1],pixels[offset+2])/255;
     if(brightness<.43||pixels[offset+3]<96)continue;
     const phi=(x+.5)/256*Math.PI*2;
     const theta=(y+.5)/128*Math.PI;
     this.candidates.push(new this.T.Vector3(
      -Math.cos(phi)*Math.sin(theta),
       Math.cos(theta),
       Math.sin(phi)*Math.sin(theta)));
    }
   }
   if(this.candidates.length>1024){
    const source=this.candidates;
    this.candidates=Array.from({length:1024},(_,i)=>source[Math.floor(i*source.length/1024)]);
   }
  }catch(error){
   this.fallbackSample();
  }
  this.stats.candidates=this.candidates.length;
  this.createRegions();
 }
 createRegions(){
  const rand=seededWeatherRandom(0xEA271A0C);
  this.regions=this.hotspots.map((center,index)=>{
   const latitude=Math.abs(Math.asin(this.T.MathUtils.clamp(center.y,-1,1))*180/Math.PI);
   return {
    center:center.clone(),
    radius:.012+rand()*.006,
    activity:latitude<24?1.35:.72,
    next:0,
    due:false
   };
  });
  this.stats.regions=this.regions.length;
  this.clear();
  this.stormPaused=true;
 }
 directions(mesh,u,phase){
  mesh.getWorldQuaternion(this.q).invert();
  u.uWeatherSun.value.copy(this.sunPos).sub(this.earthPos).normalize().applyQuaternion(this.q);
  u.uWeatherMoon.value.copy(this.moonPos).sub(this.earthPos).normalize().applyQuaternion(this.q);
  u.uWeatherMoonPhase.value=phase;
 }
 clear(){
  this.events.fill(null);
  this.cloudU.uStormPower.value.fill(0);
 }
 update(){
  const earth=this.objectRegistry.earth;
  const cloud=this.cloudMeshes.earth;
  const sun=this.objectRegistry.sun;
  const moon=this.objectRegistry.moon;
  if(!earth||!sun){this.clear();return;}
  earth.updateWorldMatrix(true,false);
  earth.getWorldPosition(this.earthPos);
  sun.getWorldPosition(this.sunPos);
  let phase=0;
  if(moon){
   moon.getWorldPosition(this.moonPos);
   this.a.copy(this.sunPos).sub(this.moonPos).normalize();
   this.b.copy(this.earthPos).sub(this.moonPos).normalize();
   phase=Math.pow(Math.max(0,(1+this.a.dot(this.b))*.5),1.6);
  }else{
   this.moonPos.copy(this.earthPos).addScalar(1);
  }
  if(this.surface!==earth.material){
   this.surface=earth.material;
   this.bind(this.surface,this.surfaceU,false);
  }
  this.directions(earth,this.surfaceU,phase);
  if(!cloud){this.clear();return;}
  if(this.cloud!==cloud){
   this.cloud=cloud;
   this.texture=null;
   this.clear();
   this.next=performance.now()/1000+3;
  }
  cloud.updateWorldMatrix(true,false);
  cloud.renderOrder=2;
  this.bind(cloud.material,this.cloudU,true);
  this.directions(cloud,this.cloudU,phase);
  if(cloud.material.map!==this.texture)this.sample(cloud.material.map);
  const now=performance.now()/1000;
  this.stats.globalRateTarget=4.2+1.0*Math.sin(now/47)+.7*Math.sin(now/113+1.7);
  const gap=this.lastTime!==null && now-this.lastTime>1;
  this.lastTime=now;
  for(const region of this.regions)region.due=false;
  if(!Number.isFinite(this.globalNext)||gap)this.globalNext=now;
  let scheduled=0;
  while(this.globalNext<=now && scheduled++<32){
   const eligible=this.regions.filter(region=>!region.due&&now>=region.next);
   if(!eligible.length){this.globalNext=now+.35;break;}
   const total=eligible.reduce((sum,region)=>sum+region.activity,0);
   let pick=Math.random()*total,chosen=eligible[eligible.length-1];
   for(const region of eligible){pick-=region.activity;if(pick<=0){chosen=region;break;}}
   chosen.due=true;
   chosen.next=now+4+Math.random()*8/Math.max(.35,chosen.activity);
   this.stats.scheduledBursts++;
   this.globalNext+=-Math.log(Math.max(.000001,1-Math.random()))/this.stats.globalRateTarget;
  }
  if(scheduled>=32)this.globalNext=now+.2;
  this.camera.getWorldPosition(this.viewPos);
  this.renderer.getSize(this.size);
  earth.getWorldScale(this.scale);
  const distance=this.viewPos.distanceTo(this.earthPos);
  const radius=(earth.geometry?.parameters?.radius||0)*Math.abs(this.scale.x);
  const pixels=radius*this.camera.projectionMatrix.elements[5]*this.size.y/(2*Math.max(distance,radius));
  if(gap||document.hidden||!cloud.visible||cloud.material.opacity<.01||!this.getLightningEnabled()||pixels<18){
   this.clear();
   this.stormPaused=true;
   return;
  }
  if(this.stormPaused){
   this.stormPaused=false;
   for(const region of this.regions){
    region.next=now+2-Math.log(Math.max(.000001,1-Math.random()))*5/Math.max(.35,region.activity);
   }
  }
  cloud.getWorldQuaternion(this.q).invert();
  this.a.copy(this.viewPos).sub(this.earthPos).normalize().applyQuaternion(this.q);
  for(let i=0;i<this.events.length;i++){
   const event=this.events[i];
   let power=0;
   if(event){
    const age=now-event.start;
    if(age>1)this.events[i]=null;
    else for(const [delay,gain]of event.pulses){
     const p=age-delay;
     if(p>=0)power+=gain*(1-Math.exp(-p/.012))*Math.exp(-p/.095);
    }
   }
   this.cloudU.uStormPower.value[i]=Math.min(2.4,power);
  }
  for(const region of this.regions){
   if(!region.due)continue;
   const n=region.center;
   if(n.dot(this.cloudU.uWeatherSun.value)>-.08||n.dot(this.a)<.15)continue;
   const slot=this.events.findIndex(event=>!event);
   if(slot<0)continue;
   this.cloudU.uStormCenters.value[slot].set(n.x,n.y,n.z,region.radius*(.85+Math.random()*.3));
   const pulses=[[0,.85+Math.random()*.45],[.25+Math.random()*.12,.25+Math.random()*.4]];
   if(Math.random()<.2)pulses.push([.68+Math.random()*.08,.2]);
   this.events[slot]={start:now,pulses};
   this.stats.events++;
  }
 }
}