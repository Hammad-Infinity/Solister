importScripts('./theory-runtime.js');
let engine,nep,makeHistory,minEt,maxEt;
const ready=(async()=>{
 importScripts('../../vendor/astronomy.browser.min.js','../../vendor/theories/vsop2013.js','../../vendor/theories/top2013.js','../../vendor/theories/elpmpp02.js','../../vendor/theories/martians.sat.js','../../vendor/theories/saturnians.tass17.js','../../vendor/theories/uranians.gust86.js');
 const [e,n,h]=await Promise.all([import('../core/engine.js'),import('../bodies/small-bodies/neptune-core.js'),import('./path-history-core.js')]);
 nep=await n.loadNeptuneEphemeris();engine=e.createEngine(globalThis,nep);makeHistory=h.history;
 minEt=engine.epoch(n.UTC_START);maxEt=engine.epoch(n.UTC_END_EXCLUSIVE-1);
})();ready.catch(()=>{});
self.onmessage=async({data:q})=>{try{await ready;const result=makeHistory(engine,nep,q.key,q.et,minEt,maxEt);postMessage({id:q.id,token:q.token,result},[result.points.buffer,result.times.buffer,result.lengths.buffer]);}
 catch(e){postMessage({id:q.id,token:q.token,key:q.key,error:String(e?.message||e)});}};