import {SOLAR_MU} from './comet-core.js';
export function osculatingEllipse(state,out={}){
 const [x,y,z,vx,vy,vz]=state,r=Math.hypot(x,y,z),hx=y*vz-z*vy,hy=z*vx-x*vz,hz=x*vy-y*vx,h=Math.hypot(hx,hy,hz);
 if(!(r>0&&h>0))return null;
 const ex=(vy*hz-vz*hy)/SOLAR_MU-x/r,ey=(vz*hx-vx*hz)/SOLAR_MU-y/r,ez=(vx*hy-vy*hx)/SOLAR_MU-z/r,e=Math.hypot(ex,ey,ez);
 if(!Number.isFinite(e)||e>=1)return null;
 const px=e>1e-10?ex/e:x/r,py=e>1e-10?ey/e:y/r,pz=e>1e-10?ez/e:z/r;
 const qx=(hy*pz-hz*py)/h,qy=(hz*px-hx*pz)/h,qz=(hx*py-hy*px)/h;
 Object.assign(out,{e,p:h*h/SOLAR_MU,px,py,pz,qx,qy,qz,start:Math.atan2(x*qx+y*qy+z*qz,x*px+y*py+z*pz)});return out;
}
export function sampleEllipse(orbit,fraction,out){
 const f=orbit.start+fraction*Math.PI*2,c=Math.cos(f),s=Math.sin(f),r=orbit.p/(1+orbit.e*c);
 out[0]=r*(orbit.px*c+orbit.qx*s);out[1]=r*(orbit.py*c+orbit.qy*s);out[2]=r*(orbit.pz*c+orbit.qz*s);return out;
}