import {AdaptiveEphemerisLayer} from './adaptive-ephemeris.js';
import {ALL_MOONS,PLANETS,SYSTEM_GM} from '../bodies/catalog.js';
import {PARENT_GM} from './orbit-geometry.js';
import {DATA_START,DATA_END,outsideData,validDate,makeKepler,advanceKepler} from '../sim/approximate-orbits.js';
const WARNING='APPROXIMATE — outside validated 1800–2199 data. Fixed two-body orbits, not reliable predictions. Historical trails and named Kuiper objects are unavailable; unusable fallback states are hidden. Accuracy degrades with time; sky/small-body models are also unvalidated here.';
export class ApproximateEphemerisLayer extends AdaptiveEphemerisLayer{
 constructor(options){super(options);this.approximate=false;this.seeds={};this.extendedSide=null;
  for(const m of Object.values(this.bodyFacts||{})){if(m.stats)m.stats=m.stats.map(row=>row[0]==='Date controls'?['Validated data coverage',row[1]]:row);}
  if(typeof document!=='undefined'){this.warning=document.createElement('div');this.warning.id='extended-date-warning';this.warning.setAttribute('role','status');this.warning.hidden=true;this.warning.style.cssText='position:fixed;top:12px;left:50%;transform:translateX(-50%);max-width:min(620px,70vw);padding:9px 13px;background:#302b23;color:#ffe1a1;border:1px solid #806d46;border-radius:8px;font:12px/1.45 system-ui;z-index:10;pointer-events:none;';document.body.appendChild(this.warning);}
 }
 setWarning(on){if(this.warning){this.warning.hidden=!on;if(on&&this.warning.textContent!==WARNING)this.warning.textContent=WARNING;}}
 status(code,message=''){
  if(this.approximate&&(code==='ready'||code==='loading')){const text=code==='loading'?'Preparing endpoint-based approximate orbits…':WARNING;if(this.lastMessage!==code+'|'+text){this.lastMessage=code+'|'+text;this.onStatus(code,text);}return;}
  super.status(code,message);
 }
 rebuild(...args){this.approximate=false;this.extendedSide=null;this.seeds={};this.setWarning(false);super.rebuild(...args);}
 clearDisplay(){this.snapshot=null;this.applied=null;this.available=false;this.solarSystem.visible=false;for(const p of this.paths.values())p.line.visible=false;}
 resetClock(){this.generation++;this.blocks=[];this.returnedEpoch=null;this.effectiveRate=0;this.clearDisplay();for(const p of this.paths.values()){p.line.removeFromParent();p.line.geometry.dispose();p.line.material.dispose();}this.paths.clear();this.pendingPaths=[];}
 makeSeed(s){
  const seed={ms:s.ms,et:s.et,planets:{},moons:{},bias:{}};
  for(const [key,m]of Object.entries(ALL_MOONS))seed.moons[key]=makeKepler([...s.relative[key],...s.velocities[key]],s.et,PARENT_GM[m.parent]+m.gm);
  for(const key of PLANETS){const o=s.orbits[key],a=Math.hypot(...o.U),n=Math.sqrt(PARENT_GM.sun/(a*a*a)),rate=n/(1-o.e*Math.cos(o.E));const v=o.U.map((u,i)=>rate*(-u*Math.sin(o.E)+o.V[i]*Math.cos(o.E)));seed.planets[key]=makeKepler([...o.position,...v],s.et,PARENT_GM.sun);seed.bias[key]=o.correction.slice();
   if(key==='earth')for(let i=0;i<3;i++)seed.bias[key][i]+=s.relative.moon[i]/82.300569074;
   else if(SYSTEM_GM[key])for(const [id,m]of Object.entries(ALL_MOONS))if(m.parent===key)for(let i=0;i<3;i++)seed.bias[key][i]+=s.relative[id][i]*m.gm/SYSTEM_GM[key];
  }return seed;
 }
 approximateSnapshot(seed,ms){
  const et=seed.et+(ms-seed.ms)/1000,s={ms,et,approximate:true,positions:{},relative:{},velocities:{},orbits:{},unavailable:[]},out=new Float64Array(6);
  for(const [key,m]of Object.entries(ALL_MOONS)){if(advanceKepler(seed.moons[key],et,out)){s.relative[key]=Array.from(out.subarray(0,3));s.velocities[key]=Array.from(out.subarray(3));}else{s.relative[key]=[0,0,0];s.velocities[key]=[0,0,0];s.unavailable.push(key);}}
  for(const key of PLANETS){const o=seed.planets[key];if(!advanceKepler(o,et,out)){s.positions[key]=[0,0,0];s.unavailable.push(key);continue;}const c=seed.bias[key].slice();
   if(key==='earth')for(let i=0;i<3;i++)c[i]-=s.relative.moon[i]/82.300569074;
   else if(SYSTEM_GM[key])for(const [id,m]of Object.entries(ALL_MOONS))if(m.parent===key)for(let i=0;i<3;i++)c[i]-=s.relative[id][i]*m.gm/SYSTEM_GM[key];
   const position=Array.from(out.subarray(0,3));s.orbits[key]={U:o.U,V:o.V,e:o.e,E:o.lastE,position,correction:c};s.positions[key]=position.map((v,i)=>v+c[i]);
  }return s;
 }
 tick(ms,delta,rate,paused,options={}){
  if(!validDate(ms)){this.clearDisplay();this.status('error','Date cannot be represented by this browser.');return ms;}
  if(!outsideData(ms)){
   if(this.approximate){this.approximate=false;this.extendedSide=null;this.resetClock();for(const key of [...PLANETS,...Object.keys(ALL_MOONS)])if(this.objectRegistry[key]){this.objectRegistry[key].userData.approximate=false;if(PLANETS.includes(key))this.objectRegistry[key].visible=true;}}
   this.setWarning(false);const shown=super.tick(ms,delta,rate,paused,options);
   if(!paused&&this.available&&((rate>0&&shown>=DATA_END-1)||(rate<0&&shown<=DATA_START))){const next=shown+Math.max(0,delta)*1000*rate;if(validDate(next)&&outsideData(next))return this.tick(next,0,rate,true,options);}
   return shown;
  }
  this.approximate=true;this.setWarning(true);this.lastStepSeconds=0;const side=ms<DATA_START?'before':'after',anchor=side==='before'?DATA_START:DATA_END-1;
  if(this.extendedSide!==side){this.extendedSide=side;this.resetClock();}
  if(!this.seeds[side]){
   super.tick(anchor,0,0,true,{...options,showOrbits:false});
   if(this.available&&this.snapshot?.ms===anchor)this.seeds[side]=this.makeSeed(this.snapshot);
   else {this.clearDisplay();return ms;}
  }
  let shown=paused?ms:ms+Math.max(0,delta)*1000*rate;if(!validDate(shown))shown=ms;
  if(!outsideData(shown)||((shown<DATA_START)!==(ms<DATA_START)))return this.tick(shown,0,rate,true,options);
  this.lastStepSeconds=(shown-ms)/1000;this.effectiveRate=paused?0:rate;this.buffering=false;
  this.snapshot=this.approximateSnapshot(this.seeds[side],shown);this.applied=null;this.available=true;this.solarSystem.visible=true;this.applySnapshot();
  const parent=ALL_MOONS[options.focusedKey]?.parent||options.focusedKey,overview=!parent||parent==='sun'||parent==='solarsystem';
  for(const [key,p]of this.paths)p.line.visible=!!options.showOrbits&&p.valid!==false&&!this.snapshot.unavailable.includes(key)&&!this.snapshot.unavailable.includes(ALL_MOONS[key]?.parent)&&(overview||ALL_MOONS[key]?.parent===parent);
  for(const key of [...PLANETS,...Object.keys(ALL_MOONS)]){const body=this.objectRegistry[key];if(body){body.userData.approximate=true;body.visible=!this.snapshot.unavailable.includes(key)&&!this.snapshot.unavailable.includes(ALL_MOONS[key]?.parent);}}
  this.pendingPaths=[];this.returnedEpoch=shown;this.status('ready');return shown;
 }
 dispose(){this.warning?.remove();this.seeds={};super.dispose();}
}