function install(material,key,u,vertexDecl,vertex,fragmentDecl,effect){
 const previous=material.onBeforeCompile,cache=material.customProgramCacheKey();
 material.onBeforeCompile=function(s,r){previous.call(this,s,r);Object.assign(s.uniforms,u);
  s.vertexShader=vertexDecl+'\n'+s.vertexShader;
  s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+vertex);
  s.fragmentShader=fragmentDecl+'\n'+s.fragmentShader;
  s.fragmentShader=s.fragmentShader.replace('#include <lights_fragment_end>','#include <lights_fragment_end>\n{\n'+effect+'\n}');
 };
 material.customProgramCacheKey=()=>cache+'|registered-saturn-'+key+'-ellipsoid-2';material.needsUpdate=true;
}
export class SaturnAlignment{
 constructor({THREE,objectRegistry}){
  Object.assign(this,{T:THREE,objectRegistry});const T=THREE;
  this.sun=new T.Vector3();this.inverse=new T.Matrix4();this.material=null;this.ringMaterial=null;
  this.u={aPlanetToRing:{value:new T.Matrix4()},aRingToPlanet:{value:new T.Matrix4()},aSunRing:{value:new T.Vector3()},aSunPlanet:{value:new T.Vector3()},aRadius:{value:1},aAxes:{value:new T.Vector3(1,1,1)},aInner:{value:1.35},aOuter:{value:2.4},aRingTexture:{value:null},aRingUV:{value:new T.Matrix3()},aOpacity:{value:1},aCutoff:{value:.1}};
 }
 update(){
  const p=this.objectRegistry.saturn,r=this.objectRegistry['saturn-ring'],sun=this.objectRegistry.sun;if(!p||!r||!sun||!r.material.map)return;
  p.updateWorldMatrix(true,false);r.updateWorldMatrix(true,false);sun.getWorldPosition(this.sun);
  this.inverse.copy(r.matrixWorld).invert();this.u.aPlanetToRing.value.multiplyMatrices(this.inverse,p.matrixWorld);this.u.aSunRing.value.copy(this.sun).applyMatrix4(this.inverse);
  this.inverse.copy(p.matrixWorld).invert();this.u.aRingToPlanet.value.multiplyMatrices(this.inverse,r.matrixWorld);this.u.aSunPlanet.value.copy(this.sun).applyMatrix4(this.inverse);
  const radius=p.geometry.parameters.radius;this.u.aRadius.value=radius;
  const axes=p.geometry.userData.referenceAxesKm;
  if(axes){const k=radius/Math.max(...axes);this.u.aAxes.value.set(axes[0]*k,axes[2]*k,axes[1]*k);}
  else this.u.aAxes.value.setScalar(radius);
  if(this.geometry!==r.geometry){this.geometry=r.geometry;let lo=Infinity,hi=0;const a=r.geometry.attributes.position;
   for(let i=0;i<a.count;i++){const length=Math.hypot(a.getX(i),a.getY(i));lo=Math.min(lo,length);hi=Math.max(hi,length);}
   this.u.aInner.value=lo;this.u.aOuter.value=hi;
  }
  const texture=r.material.map;texture.updateMatrix();this.u.aRingTexture.value=texture;this.u.aRingUV.value.copy(texture.matrix);
  this.u.aOpacity.value=r.visible?r.material.opacity:0;this.u.aCutoff.value=r.material.alphaTest;
  if(this.material!==p.material){this.material=p.material;
   install(p.material,'planet',this.u,'uniform mat4 aPlanetToRing;varying vec3 vAnnulusPoint;','vAnnulusPoint=(aPlanetToRing*vec4(position,1.0)).xyz;',
    'varying vec3 vAnnulusPoint;uniform vec3 aSunRing;uniform float aInner;uniform float aOuter;uniform sampler2D aRingTexture;uniform mat3 aRingUV;uniform float aOpacity;uniform float aCutoff;',`
    vec3 direction=normalize(aSunRing-vAnnulusPoint);
    if(abs(direction.z)>0.000001 && aOpacity>0.0){
     float distanceToPlane=-vAnnulusPoint.z/direction.z;
     if(distanceToPlane>0.0){
      vec3 hit=vAnnulusPoint+direction*distanceToPlane;float radius=length(hit.xy);
      if(radius>aInner && radius<aOuter){
       vec2 uv=vec2(fract(atan(hit.y,hit.x)/6.28318530718),(radius-aInner)/(aOuter-aInner));
       uv=(aRingUV*vec3(uv,1.0)).xy;
       float alpha=texture2D(aRingTexture,uv).a*aOpacity;
       float transmission=1.0-.90*alpha*step(aCutoff,alpha);
       reflectedLight.directDiffuse*=transmission;reflectedLight.directSpecular*=transmission;
      }
     }
    }
   `);
  }
  if(this.ringMaterial!==r.material){this.ringMaterial=r.material;
   install(r.material,'ring',this.u,'uniform mat4 aRingToPlanet;varying vec3 vPlanetPoint;','vPlanetPoint=(aRingToPlanet*vec4(position,1.0)).xyz;',
    'varying vec3 vPlanetPoint;uniform vec3 aSunPlanet;uniform float aRadius;uniform vec3 aAxes;',`
    vec3 point=vPlanetPoint/aAxes;
    vec3 direction=normalize((aSunPlanet-vPlanetPoint)/aAxes);
    float along=dot(point,direction);
    float impact=length(cross(point,direction));
    float blocked=(1.0-smoothstep(.998,1.002,impact))*step(along,0.0);
    float visibility=1.0-.95*blocked;
    reflectedLight.directDiffuse*=visibility;reflectedLight.directSpecular*=visibility;
    totalEmissiveRadiance*=visibility;
   `);
  }
 }
}