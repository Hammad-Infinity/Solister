import {BodyShapes} from '../bodies/body-shapes.js';
import {LDB_VERTEX_PARS,LDB_VERTEX_TAIL,LDB_FRAGMENT_PARS,LDB_FRAGMENT_HEAD} from '../render/log-depth-glsl.js';
const TINTS={sun:0xffffff,mercury:0xe7e2db,venus:0xfffcf3,earth:0xbce5ff,mars:0xffbb9b,
    jupiter:0xffe7ce,saturn:0xffefd0,uranus:0xc6f5f5,neptune:0xb9d0ff,comet67p:0xbfe8ff,comet2p:0xd6e8ff,comet46p:0xd3f2ff,comet9p:0xc7e5ff};
const clamp01=x=>Math.max(0,Math.min(1,x));
export function markerOpacityForDiameter(diameterPixels){
    const t=clamp01((diameterPixels-2.0)/(14.0-2.0));
    return 1-t*t*(3-2*t);
}
function hierarchyVisible(object){
    for(let o=object;o;o=o.parent)if(!o.visible)return false;
    return true;
}
export function focusedMarkerFade(distance, radius, focused) {
    if (!focused || !(radius > 0)) return 1;
    const t = clamp01((distance / radius - 24) / 16);
    return t * t * (3 - 2 * t);
}
export class BodyGlowMarkers {
    constructor({THREE,scene,solarSystem,objectRegistry,camera,renderer}){
        Object.assign(this,{T:THREE,scene,solarSystem,objectRegistry,camera,renderer});
        const T=THREE;
        this.group=new T.Group();this.group.name='Distant Sun, planet and moon markers';scene.add(this.group);
        this.entries=new Map();this.occluders=new Map();
        this.size=new T.Vector2();this.eye=new T.Vector3();this.world=new T.Vector3();
        this.view=new T.Vector3();this.worldView=new T.Vector3();this.ndc=new T.Vector3();this.scale=new T.Vector3();
        this.localView=new T.Vector3();this.inverseBodyMatrix=new T.Matrix4();
        this.rayStart=new T.Vector3();this.rayEnd=new T.Vector3();this.closest=new T.Vector3();
    }
    create(key,body){
        const T=this.T,geometry=new T.BufferGeometry();
        geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(3),3));
        const material=new T.ShaderMaterial({
            uniforms:{uOpacity:{value:0},uPixels:{value:1},uTint:{value:new T.Color(TINTS[key]||0xf0f0e8)}},
            vertexShader:`uniform float uPixels;${LDB_VERTEX_PARS}
                void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_PointSize=uPixels;${LDB_VERTEX_TAIL}}`,
            fragmentShader:`uniform float uOpacity;uniform vec3 uTint;${LDB_FRAGMENT_PARS}
                void main(){${LDB_FRAGMENT_HEAD}
                    float r=length(gl_PointCoord-0.5);
                    if(r>0.5)discard;
                    float core=1.0-smoothstep(0.07,0.17,r);
                    float halo=0.22*exp(-r*r*16.0)*(1.0-smoothstep(0.35,0.5,r));
                    float colorGlow=0.14*exp(-r*r*8.0)*(1.0-smoothstep(0.38,0.5,r));
                    float alpha=clamp(core+halo+colorGlow,0.0,1.0)*uOpacity;
                    if(alpha<0.001)discard;
                    vec3 starColor=mix(uTint,vec3(1.0),0.45*core);
                    starColor+=uTint*colorGlow*0.6;
                    gl_FragColor=vec4(starColor,alpha);
                }`,
            transparent:true,depthWrite:false,depthTest:true,
            // Normal blending keeps overlapping planet/moon markers from
            // accumulating into an oversized additive glare.
            blending:T.NormalBlending,toneMapped:false,fog:false,
        });
        const point=new T.Points(geometry,material);point.frustumCulled=false;
        point.renderOrder=5;point.raycast=()=>{};point.visible=false;this.group.add(point);
        const entry={body,point,opacity:0,x:0,y:0,distance:Infinity,markerDiameter:0};this.entries.set(key,entry);return entry;
    }
    updateOccluders(){
        const T=this.T,wanted=new Set();
        for(const key of ['sun',...Object.keys(BodyShapes.axesKm)]){
            const body=this.objectRegistry[key];
            if(!body||!hierarchyVisible(body)||!body.geometry?.parameters?.radius)continue;
            wanted.add(key);body.updateWorldMatrix(true,false);
            let occluder=this.occluders.get(key);
            if(!occluder){occluder={body,inverse:new T.Matrix4(),axes:new T.Vector3()};this.occluders.set(key,occluder);}
            occluder.body=body;occluder.inverse.copy(body.matrixWorld).invert();
            const radius=body.geometry.parameters.radius,axes=body.geometry.userData.referenceAxesKm;
            if(axes){const k=radius/Math.max(...axes);occluder.axes.set(axes[0]*k,axes[2]*k,axes[1]*k);}
            else occluder.axes.setScalar(radius);
        }
        for(const key of this.occluders.keys())if(!wanted.has(key))this.occluders.delete(key);
    }
    occluded(body,world){
        for(const occluder of this.occluders.values()){
            if(occluder.body===body)continue;
            const a=this.rayStart.copy(this.eye).applyMatrix4(occluder.inverse).divide(occluder.axes);
            const d=this.rayEnd.copy(world).applyMatrix4(occluder.inverse).divide(occluder.axes).sub(a);
            const lengthSq=d.lengthSq();if(!(lengthSq>0))continue;
            const t=-a.dot(d)/lengthSq;
            if(t<=0||t>=1)continue;
            if(this.closest.copy(a).addScaledVector(d,t).lengthSq()<1)return true;
        }
        return false;
    }
    update(dt,focusedObject=null,enabled=true){
        const sceneVisible=hierarchyVisible(this.solarSystem);
        this.group.visible=sceneVisible&&enabled;
        for(const [key,entry]of this.entries){
            if(this.objectRegistry[key]!==entry.body){
                entry.point.removeFromParent();entry.point.geometry.dispose();entry.point.material.dispose();this.entries.delete(key);
            }
        }
        if(!sceneVisible||!enabled){for(const entry of this.entries.values()){entry.opacity=0;entry.point.visible=false;}return;}
        this.camera.updateWorldMatrix(true,false);this.camera.getWorldPosition(this.eye);
        this.group.updateWorldMatrix(true,false);this.renderer.getSize(this.size);
        this.updateOccluders();
        const easing=1-Math.exp(-Math.max(0,Math.min(dt,.1))/0.16),dpr=this.renderer.getPixelRatio();
        const keys=new Set(['sun',...Object.keys(BodyShapes.axesKm)]);
        for(const [key,body]of Object.entries(this.objectRegistry))if(body?.userData?.isComet)keys.add(key);
        for(const key of keys){
            const body=this.objectRegistry[key];if(!body)continue;
            const entry=this.entries.get(key)||this.create(key,body);
            body.getWorldPosition(this.world);body.getWorldScale(this.scale);
            this.view.copy(this.world).applyMatrix4(this.camera.matrixWorldInverse);
            this.ndc.copy(this.world).project(this.camera);
            const geometryRadius=body.geometry?.parameters?.radius||0;
            const referenceAxes=body.geometry?.userData?.referenceAxesKm;
            const axisRatio=referenceAxes?.length
                ? Math.min(...referenceAxes)/Math.max(...referenceAxes)
                : 1;
            const minimumWorldScale=Math.min(Math.abs(this.scale.x),Math.abs(this.scale.y),Math.abs(this.scale.z));
            // Use the smallest physical semi-axis as a conservative circular
            // bound for oblate bodies so the glow cannot exceed their projected
            // silhouette at any orientation.
            const radius=geometryRadius*axisRatio*minimumWorldScale;
            this.worldView.copy(this.eye).sub(this.world).normalize();
            let surfaceRadius=geometryRadius*Math.max(Math.abs(this.scale.x),Math.abs(this.scale.y),Math.abs(this.scale.z));
            if(referenceAxes?.length===3&&body.matrixWorld){
                this.inverseBodyMatrix.copy(body.matrixWorld).invert();
                const e=this.inverseBodyMatrix.elements,v=this.worldView;
                this.localView.set(e[0]*v.x+e[4]*v.y+e[8]*v.z,
                    e[1]*v.x+e[5]*v.y+e[9]*v.z,e[2]*v.x+e[6]*v.y+e[10]*v.z);
                const axisMax=Math.max(...referenceAxes);
                const axes=[referenceAxes[0],referenceAxes[2],referenceAxes[1]];
                const dx=this.localView.x/(geometryRadius*axes[0]/axisMax);
                const dy=this.localView.y/(geometryRadius*axes[1]/axisMax);
                const dz=this.localView.z/(geometryRadius*axes[2]/axisMax);
                const denominator=Math.sqrt(dx*dx+dy*dy+dz*dz);
                if(denominator>0)surfaceRadius=1/denominator;
            }
            const depth=-this.view.z;
            const inView=hierarchyVisible(body)&&depth>this.camera.near&&depth<this.camera.far&&Math.abs(this.ndc.x)<1&&Math.abs(this.ndc.y)<1;
            const radiusPixels=radius*this.camera.projectionMatrix.elements[5]*this.size.y/Math.max(depth,this.camera.near);
            const diameterPixels=Math.max(0,2*radiusPixels);
            const markerPixels=Math.min(10,diameterPixels);
            const markerPhysicalPixels=markerPixels*dpr;
            const distance=this.world.distanceTo(this.eye);
            const isFocused=body===focusedObject;
            const focusedNear=isFocused&&distance<=radius*24;
            const focusFade=focusedMarkerFade(distance,radius,isFocused);
            const small=markerOpacityForDiameter(diameterPixels);
            const hasPixelFootprint=markerPhysicalPixels>=1.0;
            const blocked=inView&&small>0&&this.occluded(body,this.world);
            const screenX=(this.ndc.x*.5+.5)*this.size.x;
            const screenY=(-this.ndc.y*.5+.5)*this.size.y;
            const parentKey=body.userData?.parentKey||(body.userData?.isMoon?'earth':null);
            const parentEntry=parentKey?this.entries.get(parentKey):null;
            const overlapsParentMarker=!!(parentEntry?.point.visible&&parentEntry.opacity>.05&&
                Math.hypot(screenX-parentEntry.x,screenY-parentEntry.y)<
                    (markerPixels+parentEntry.markerDiameter)*.5);
            const edge=clamp01(Math.min(1-Math.abs(this.ndc.x),1-Math.abs(this.ndc.y))/.055);
            const target=inView&&hasPixelFootprint&&!blocked&&!overlapsParentMarker?small*edge*focusFade:0;
            if(focusedNear)entry.opacity=0;
            else entry.opacity+=(target-entry.opacity)*easing;
            if(Math.abs(target-entry.opacity)<.001)entry.opacity=target;
            entry.point.visible=inView&&hasPixelFootprint&&!blocked&&!overlapsParentMarker&&!focusedNear&&entry.opacity>.001;
            entry.point.material.uniforms.uOpacity.value=entry.opacity;
            entry.point.material.uniforms.uPixels.value=Math.max(1.0,markerPhysicalPixels);
            entry.x=screenX;entry.y=screenY;entry.markerDiameter=markerPixels;
            entry.distance=distance;
            this.world.addScaledVector(this.worldView,surfaceRadius*1.002);
            entry.point.position.copy(this.group.worldToLocal(this.world));
        }
    }
    pick(clientX,clientY){
        const rect=this.renderer.domElement.getBoundingClientRect();
        const x=(clientX-rect.left)*this.size.x/rect.width,y=(clientY-rect.top)*this.size.y/rect.height;
        let selected=null,best=Infinity,depth=Infinity;
        for(const entry of this.entries.values()){
            if(!entry.point.visible||entry.opacity<.15)continue;
            const distance=Math.hypot(x-entry.x,y-entry.y);
            if(distance<=6&&(distance<best-.25||(Math.abs(distance-best)<=.25&&entry.distance<depth))){
                best=distance;depth=entry.distance;selected=entry.body;
            }
        }
        return selected;
    }
    dispose(){
        for(const entry of this.entries.values()){entry.point.geometry.dispose();entry.point.material.dispose();}
        this.entries.clear();this.occluders.clear();this.group.removeFromParent();
    }
}
