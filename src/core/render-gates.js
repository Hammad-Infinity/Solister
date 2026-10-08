export class LabelRenderGate {
 constructor(){this.lastNeeded=-Infinity;}
 needsRender({showLabels,conLabels,starLabels},now){
  const needed=!!(showLabels||conLabels||starLabels);
  if(needed)this.lastNeeded=now;
  return needed||now-this.lastNeeded<=500;
 }
}
