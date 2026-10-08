export const PERFORMANCE_PROFILES={balanced:{name:'Balanced · 30 fps target',fps:30,maxDpr:1,pixels:2560*1440},full:{name:'Full resolution · 60 fps target',fps:60,maxDpr:2,pixels:Infinity}};
export class PerformanceDefaults {
 constructor(){this.profile='balanced';try{const s=localStorage.getItem('solarPerformanceProfile');if(PERFORMANCE_PROFILES[s])this.profile=s;}catch{}this.lastFrame=NaN;this.lastRatio=NaN;this.hidden=false;}
 pixelRatio(width=innerWidth,height=innerHeight,dpr=devicePixelRatio||1){if(this.getPixelRatio)return this.getPixelRatio(width,height,dpr);const p=PERFORMANCE_PROFILES[this.profile];return Math.min(Math.max(.1,dpr),p.maxDpr,Math.sqrt(p.pixels/Math.max(1,width*height)));}
 shouldRender(now,hidden=document.hidden,fps=PERFORMANCE_PROFILES[this.profile].fps){
  if(hidden){this.lastFrame=NaN;this.hidden=true;return false;}
  if(this.hidden){this.hidden=false;this.clock?.getDelta();}
  const interval=1000/Math.max(1,Math.min(60,Number(fps)||48));
  if(!Number.isFinite(this.lastFrame)){this.lastFrame=now;return true;}
  const elapsed=now-this.lastFrame;if(elapsed<interval-.5)return false;
  this.lastFrame=elapsed>interval*4?now:this.lastFrame+Math.max(1,Math.floor((elapsed+.5)/interval))*interval;
  return true;
 }
 applySize(){if(!this.renderer)return;const ratio=this.pixelRatio();if(!Number.isFinite(this.lastRatio)||Math.abs(ratio-this.lastRatio)>1e-6){this.renderer.setPixelRatio(ratio);this.lastRatio=ratio;}this.onResize?.();this.refresh();}
 choose(profile){if(!PERFORMANCE_PROFILES[profile])return;this.profile=profile;this.lastFrame=NaN;try{localStorage.setItem('solarPerformanceProfile',profile);}catch{}this.applySize();}
 attach({renderer,clock,onResize,onTextureDefault,getPixelRatio}){
  Object.assign(this,{renderer,clock,onResize,onTextureDefault,getPixelRatio});
  const appearance=[...document.querySelectorAll('.advanced-category')].find(d=>d.querySelector('summary')?.textContent.trim()==='Appearance');
  const host=appearance?.querySelector('.advanced-content')||document.getElementById('texture-select')?.parentElement?.parentElement;
  const box=document.createElement('div');box.className='performance-defaults';
  const label=document.createElement('label');label.textContent='Performance';label.htmlFor='performance-profile';
  this.select=document.createElement('select');this.select.id='performance-profile';for(const [value,p]of Object.entries(PERFORMANCE_PROFILES)){const o=document.createElement('option');o.value=value;o.textContent=p.name;this.select.append(o);}this.select.onchange=()=>this.choose(this.select.value);
  this.note=document.createElement('p');this.note.className='performance-note';
  const reset=document.createElement('button');reset.type='button';reset.className='performance-reset';reset.textContent='Restore recommended · 2K';reset.title='Sets Balanced rendering and 2K textures. Keeps effect toggles, date, speed and camera settings.';reset.onclick=()=>{this.choose('balanced');this.onTextureDefault();};
  box.append(label,this.select,this.note,reset);
  box.hidden = true;
  host?.append(box);
  const style=document.createElement('style');style.textContent='.performance-defaults{display:grid;gap:7px;margin:12px 0 4px;padding-top:10px;border-top:1px solid #626870;font:11px/1.45 "Segoe UI",sans-serif;color:#e2e5e9}.performance-defaults select{width:100%;min-width:0;box-sizing:border-box;padding:8px 6px;border:1px solid #747b85;border-radius:7px;font:11px "Segoe UI",sans-serif;color:#e6e9ed;background:#353a42}.performance-note{margin:0;color:#cbd0d6;font-size:11px}.performance-defaults button{width:100%}';document.head.append(style);
  this.applySize();
 }
 refresh(){if(!this.select)return;this.select.value=this.profile;const ratio=this.pixelRatio(),width=Math.floor(innerWidth*ratio),height=Math.floor(innerHeight*ratio);this.note.textContent=`3D render: ${width} × ${height}. Effects and body counts unchanged; Menus and body labels stay at display resolution. Saved texture choices are kept.`;}
}