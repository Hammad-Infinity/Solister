import {PathLines} from './path-lines.js';
import {lowerBound} from './path-history-core.js';
export class WorldTrails extends PathLines {
 setHighlighted(key){this.highlightedKey=key || null;}
 create(info){
  const entry=super.create(info);
  const material=entry.mesh.material;
  material.uniforms.uHover={value:0};
  material.uniforms.uDpr={value:1};
  material.uniforms.uWidth={value:1};
  material.fragmentShader=`uniform vec3 tint;uniform vec3 bodyDisk;uniform vec3 parentDisk;
   uniform float uWidth;uniform float strength;uniform float halfWidth;uniform float uHover;uniform float uDpr;
   varying float vSide;varying float vFade;
   void main(){
    float mask=smoothstep(0.0,2.0,distance(gl_FragCoord.xy,bodyDisk.xy)-bodyDisk.z)
      *smoothstep(0.0,2.0,distance(gl_FragCoord.xy,parentDisk.xy)-parentDisk.z);
    float d=abs(vSide)*halfWidth/(max(uDpr,1.0)*uWidth);
    float core=1.0-smoothstep(0.45,1.05,d);
    float glow=exp(-d*d/5.0)*0.30*uHover;
    float alpha=(core*0.75+glow)*clamp(vFade,0.0,1.0)*strength*mask;
    if(alpha<0.002)discard;
    gl_FragColor=vec4(mix(tint,vec3(1.0),0.30*uHover),min(alpha,0.95));
   }`;
  return entry;
 }
 draw(entry,cache,headLength,endIndex,orbitLength,head,settings){
  const target=headLength-orbitLength*settings.length;
  const tail=Math.max(cache.lengths[0],target);
  const span=Math.max(1e-12,headLength-tail);
  const start=Math.max(1,lowerBound(cache.lengths,tail));
  const points=cache.points,lengths=cache.lengths;
  const interp=Math.max(0,Math.min(1,(tail-lengths[start-1])/Math.max(1e-12,lengths[start]-lengths[start-1])));
  let ax=points[(start-1)*3]+interp*(points[start*3]-points[(start-1)*3]),ay=points[(start-1)*3+1]+interp*(points[start*3+1]-points[(start-1)*3+1]),az=points[(start-1)*3+2]+interp*(points[start*3+2]-points[(start-1)*3+2]),af=0,segmentCount=0;
  const geometry=entry.mesh.geometry;
  const positions=geometry.attributes.position.array;
  const ends=geometry.attributes.aEnd.array;
  const fades=geometry.attributes.aFade.array;
  const emit=(bx,by,bz,bf)=>{
   if(segmentCount>=4400)return;
   const baseVertex=segmentCount++*6;
   for(let corner=0;corner<6;corner++){
    const offset=(baseVertex+corner)*3;
    positions[offset]=ax-head.x;
    positions[offset+1]=ay-head.y;
    positions[offset+2]=az-head.z;
    ends[offset]=bx-head.x;
    ends[offset+1]=by-head.y;
    ends[offset+2]=bz-head.z;
    fades[baseVertex+corner]=(corner===2||corner===3||corner===5)?bf:af;
   }
   ax=bx;ay=by;az=bz;af=bf;
  }
  for(let i=start;i<=endIndex;i++){
   if(lengths[i]<=tail)continue;
   emit(points[i*3],points[i*3+1],points[i*3+2],Math.pow(Math.min(1,(lengths[i]-tail)/span),0.8));
  }
  if(Math.hypot(ax-head.x,ay-head.y,az-head.z)>1e-12)emit(head.x,head.y,head.z,1);
  const count=segmentCount*6;
  geometry.setDrawRange(0,count);
  entry.limited=target<cache.lengths[0]-1e-6;
  if(!count)return;
  for(const name of ['position','aEnd','aFade']){
   const attribute=geometry.attributes[name];
   if(attribute.clearUpdateRanges&&attribute.addUpdateRange){
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0,count*attribute.itemSize);
   }else if(attribute.updateRange){
    attribute.updateRange.offset=0;
    attribute.updateRange.count=count*attribute.itemSize;
   }
   attribute.needsUpdate=true;
  }
  entry.limited=target<cache.lengths[0]-1e-6;
 }
 update(state){
  super.update(state);
  const dpr=this.renderer.getPixelRatio();
  const width=Math.max(0.1,this.getSettings().width);
  for(const [key,entry] of this.entries){
   const u=entry.mesh.material.uniforms;
   u.uHover.value=key===this.highlightedKey?1:0;
   u.uDpr.value=dpr;
   u.uWidth.value=width;
   u.halfWidth.value=(u.uHover.value?4.5:1.15)*dpr*width;
  }
 }
}