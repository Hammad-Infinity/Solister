const A=3.2,E=.0549,I=5.145*Math.PI/180;
export function funMoonPoint(angle,out){
 const r=A*(1-E*E)/(1+E*Math.cos(angle)),s=r*Math.sin(angle);
 out.x=r*Math.cos(angle);out.y=s*Math.sin(I);out.z=s*Math.cos(I);return out;
}