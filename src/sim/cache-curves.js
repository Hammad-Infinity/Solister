export function blend(values,n,u,out=new Array(n)){
 const x=3*u,w=[-(x-1)*(x-2)*(x-3)/6,x*(x-2)*(x-3)/2,-x*(x-1)*(x-3)/2,x*(x-1)*(x-2)/6];
 for(let k=0;k<n;k++)out[k]=w[0]*values[k]+w[1]*values[n+k]+w[2]*values[2*n+k]+w[3]*values[3*n+k];return out;
}
export function orbitFromValues(v){
 const U=v.slice(0,3),V=v.slice(3,6),e=v[6],E=Math.atan2(v[8],v[7]);
 return {U,V,e,E,position:U.map((x,i)=>x*(Math.cos(E)-e)+V[i]*Math.sin(E))};
}
export function fitCurve(fn,start,end,maxSpan,tolerance,orbital=false){
 const rows=[],memo=new Map();let maxProbeError=0,evaluations=0;
 const evalAt=t=>{if(!memo.has(t)){memo.set(t,fn(t));evaluations++;}return memo.get(t);};
 const error=(a,b)=>{if(orbital){a=orbitFromValues(a).position;b=orbitFromValues(b).position;}return Math.hypot(...a.map((x,i)=>x-b[i]));};
 function visit(a,b,depth){
  const values=[];for(let i=0;i<4;i++)values.push(...evalAt(a+(b-a)*i/3));const n=values.length/4;
  let peak=0;for(const u of [.125,.25,.5,.75,.875])peak=Math.max(peak,error(blend(values,n,u),evalAt(a+(b-a)*u)));
  if(!Number.isFinite(peak))throw new Error('Non-finite interpolation residual');
  if(peak>tolerance){if(depth>=18||b-a<.01)throw new Error('Cache could not meet sampled interpolation tolerance');const m=(a+b)/2;visit(a,m,depth+1);visit(m,b,depth+1);}
  else {rows.push([a,b,...values]);maxProbeError=Math.max(maxProbeError,peak);}
 }
 const count=Math.max(1,Math.ceil((end-start)/maxSpan));for(let i=0;i<count;i++)visit(start+(end-start)*i/count,start+(end-start)*(i+1)/count,0);
 const stride=rows[0].length,records=new Float64Array(rows.length*stride);rows.forEach((r,i)=>records.set(r,i*stride));
 return {records,stride,dimensions:(stride-2)/4,maxProbeError,evaluations,tolerance};
}
export function readCurve(curve,t,out){
 const a=curve.records,s=curve.stride,count=a.length/s,n=curve.dimensions;
 if(t<a[0]-1e-6||t>a[(count-1)*s+1]+1e-6)throw new RangeError('No extrapolation outside cached interval');
 let i=curve._readCursor??0;
 if(i>=count||t<a[i*s]||!(t<a[i*s+1]||(i===count-1&&t<=a[i*s+1]))){
  let lo=0,hi=count;while(lo<hi){const m=(lo+hi)>>>1;if(a[m*s]<=t)lo=m+1;else hi=m;}i=Math.max(0,lo-1);
 }
 curve._readCursor=i;
 const p=i*s,u=Math.max(0,Math.min(1,(t-a[p])/(a[p+1]-a[p]))),x=3*u;
 const w0=-(x-1)*(x-2)*(x-3)/6,w1=x*(x-2)*(x-3)/2,w2=-x*(x-1)*(x-3)/2,w3=x*(x-1)*(x-2)/6;
 out=out||new Array(n);const base=p+2;
 for(let k=0;k<n;k++)out[k]=w0*a[base+k]+w1*a[base+n+k]+w2*a[base+2*n+k]+w3*a[base+3*n+k];
 return out;
}
export function readCurveDerivative(curve,t,out){
 out=readCurve(curve,t,out);
 const a=curve.records,s=curve.stride,n=curve.dimensions,p=curve._readCursor*s;
 const span=a[p+1]-a[p],x=3*Math.max(0,Math.min(1,(t-a[p])/span)),k=3/span;
 const w0=-(3*x*x-12*x+11)/6*k,w1=(3*x*x-10*x+6)/2*k;
 const w2=(-3*x*x+8*x-3)/2*k,w3=(3*x*x-6*x+2)/6*k,base=p+2;
 for(let j=0;j<n;j++)out[j]=w0*a[base+j]+w1*a[base+n+j]+w2*a[base+2*n+j]+w3*a[base+3*n+j];
 return out;
}