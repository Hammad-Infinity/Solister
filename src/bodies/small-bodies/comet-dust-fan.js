import { createTailVolume } from './comet-tail-volume.js';

const TWO_PI=Math.PI*2;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

export function createDustPopulation(segments=24){
    return {userData:{segments,points:new Float64Array((segments+1)*3),
        physicalLengths:new Float64Array(segments+1),emission:new Float32Array(segments+1).fill(1),
        widths:new Float64Array(segments+1)}};
}

export function createDustFanVolume(THREE,registry,nucleus,color){
    const mesh=createTailVolume(THREE,registry,nucleus,color,24,.92,false);
    mesh.name='Continuous volumetric dust fan';
    mesh.userData.fan={matrix:new Float64Array(9),vectors:new Float64Array(9),
        covariance:new Float64Array(9),records:Array.from({length:5},()=>({center:new THREE.Vector3(),tangent:new THREE.Vector3(),side:new THREE.Vector3(),up:new THREE.Vector3(),radius:0,along:0,mass:0})),
        mean:new THREE.Vector3(),offset:new THREE.Vector3(),axes:Array.from({length:3},()=>new THREE.Vector3()),sigmas:new Float64Array(3),
        centerline:new THREE.Vector3(),waveSide:new THREE.Vector3(),waveUp:new THREE.Vector3()};
    return mesh;
}

function diagonalize(data){
    const a=data.matrix,v=data.vectors,c=data.covariance;
    const scale=Math.max(c[0],c[4],c[8],1e-24);
    for(let i=0;i<9;i++){a[i]=c[i]/scale;v[i]=i%4===0?1:0;}
    for(let pass=0;pass<12;pass++){
        let p=0,q=1,largest=Math.abs(a[1]);
        if(Math.abs(a[2])>largest){p=0;q=2;largest=Math.abs(a[2]);}
        if(Math.abs(a[5])>largest){p=1;q=2;largest=Math.abs(a[5]);}
        if(largest<1e-12)break;
        const pq=a[p*3+q],tau=(a[q*3+q]-a[p*3+p])/(2*pq);
        const t=(tau>=0?1:-1)/(Math.abs(tau)+Math.sqrt(1+tau*tau));
        const cosine=1/Math.sqrt(1+t*t),sine=t*cosine;
        const pp=a[p*3+p],qq=a[q*3+q];
        for(let k=0;k<3;k++)if(k!==p&&k!==q){
            const x=a[k*3+p],y=a[k*3+q];
            a[k*3+p]=a[p*3+k]=cosine*x-sine*y;
            a[k*3+q]=a[q*3+k]=sine*x+cosine*y;
        }
        a[p*3+p]=pp-t*pq;a[q*3+q]=qq+t*pq;a[p*3+q]=a[q*3+p]=0;
        for(let k=0;k<3;k++){
            const x=v[k*3+p],y=v[k*3+q];
            v[k*3+p]=cosine*x-sine*y;v[k*3+q]=sine*x+cosine*y;
        }
    }
    const order=[0,1,2].sort((x,y)=>a[x*3+x]-a[y*3+y]);
    for(let i=0;i<3;i++){
        const k=order[i];data.axes[i].set(v[k],v[3+k],v[6+k]).normalize();
        data.sigmas[i]=Math.sqrt(Math.max(a[k*3+k]*scale,1e-20));
    }
}

export function writeDustFanVolume(mesh,populations,betaWeights,opacity,waveTime){
    const state=mesh.userData,fan=state.fan,u=mesh.material.uniforms;
    const count=state.segments,bounds=state.bounds.makeEmpty();let nodes=0;
    for(let i=0;i<=count;i++){
        const k=i*3;state.points[k]=state.points[k+1]=state.points[k+2]=0;
        for(let j=0;j<populations.length;j++)for(let axis=0;axis<3;axis++)state.points[k+axis]+=populations[j].userData.points[k+axis]*betaWeights[j];
    }
    for(let i=0;i<count;i++){
        const k=i*3,n=k+3,fraction=(i+.5)/count;
        const envelope=smooth(0,.025,fraction)*(1-smooth(.58,1,fraction))*Math.exp(-fraction*1.8);
        fan.mean.set(0,0,0);let mass=0;
        for(let j=0;j<populations.length;j++){
            const d=populations[j].userData,r=fan.records[j];
            r.center.set((d.points[k]+d.points[n])*.5,(d.points[k+1]+d.points[n+1])*.5,(d.points[k+2]+d.points[n+2])*.5);
            r.tangent.set(d.points[n]-d.points[k],d.points[n+1]-d.points[k+1],d.points[n+2]-d.points[k+2]);
            const length=r.tangent.length();r.radius=Math.max(1e-10,(d.widths[i]+d.widths[i+1])*.5);r.along=Math.max(length*.68,r.radius*.55);
            r.mass=betaWeights[j]*(d.emission[i]+d.emission[i+1])*.5*envelope*length*r.radius*.92;
            if(!(length>1e-12)){r.mass=0;continue;}
            r.tangent.divideScalar(length);r.up.set(0,1,0).addScaledVector(r.tangent,-r.tangent.y);
            if(r.up.lengthSq()<1e-10)r.up.set(1,0,0).addScaledVector(r.tangent,-r.tangent.x);
            r.up.normalize();r.side.crossVectors(r.up,r.tangent).normalize();fan.mean.addScaledVector(r.center,r.mass);mass+=r.mass;
        }
        if(!(mass>1e-24))continue;
        fan.mean.divideScalar(mass);fan.covariance.fill(0);
        for(const r of fan.records){
            if(r.mass<=0)continue;const weight=r.mass/mass;
            fan.offset.subVectors(r.center,fan.mean);
            const vectors=[r.side,r.up,r.tangent,fan.offset],variances=[r.radius*r.radius,r.radius*r.radius*.92*.92,r.along*r.along,1];
            for(let j=0;j<4;j++){
                const vector=vectors[j],values=[vector.x,vector.y,vector.z],gain=weight*variances[j];
                for(let row=0;row<3;row++)for(let column=0;column<3;column++)fan.covariance[row*3+column]+=values[row]*values[column]*gain;
            }
        }
        diagonalize(fan);
        const up=fan.axes[0],side=fan.axes[1],along=fan.axes[2];
        const sx=fan.sigmas[1],sy=fan.sigmas[0],sz=fan.sigmas[2];
        fan.centerline.set(state.points[n]-state.points[k],state.points[n+1]-state.points[k+1],state.points[n+2]-state.points[k+2]).normalize();
        fan.waveSide.set(0,1,0).cross(fan.centerline);if(fan.waveSide.lengthSq()<1e-10)fan.waveSide.set(1,0,0).cross(fan.centerline);
        fan.waveSide.normalize();fan.waveUp.crossVectors(fan.centerline,fan.waveSide).normalize();
        const amplitude=Math.min(sx,sz)*.045*fraction*fraction,phase=fraction*7-waveTime*.29;
        fan.mean.addScaledVector(fan.waveSide,Math.sin(phase)*amplitude).addScaledVector(fan.waveUp,Math.cos(phase*1.4+.7)*amplitude*.45);
        if(nodes===0)u.headAxis.value.copy(fan.centerline);
        u.nodes.value[nodes].set(fan.mean.x,fan.mean.y,fan.mean.z,sx);
        u.tangents.value[nodes].set(along.x,along.y,along.z,sz);
        u.upAxes.value[nodes].set(up.x,up.y,up.z,sy/sx);state.nodeSides[nodes].copy(side);
        u.metricX.value[nodes].set(side.x/sx,side.y/sx,side.z/sx,0);
        u.metricY.value[nodes].set(up.x/sy,up.y/sy,up.z/sy,0);
        u.metricZ.value[nodes].set(along.x/sz,along.y/sz,along.z/sz,0);
        u.columnScale.value[nodes]=mass/(TWO_PI*sx*sy*sz);
        state.extent.set(Math.abs(side.x)*sx+Math.abs(up.x)*sy+Math.abs(along.x)*sz,
            Math.abs(side.y)*sx+Math.abs(up.y)*sy+Math.abs(along.y)*sz,
            Math.abs(side.z)*sx+Math.abs(up.z)*sy+Math.abs(along.z)*sz).multiplyScalar(6);
        bounds.expandByPoint(state.scratch.copy(fan.mean).sub(state.extent));bounds.expandByPoint(state.scratch.copy(fan.mean).add(state.extent));nodes++;
    }
    state.volumeVersion++;state.volumeReady=nodes>0;u.nodeCount.value=nodes;u.opacity.value=Math.max(0,opacity);
    mesh.visible=state.volumeReady&&opacity>0;if(!state.volumeReady)return;
    u.boundsMin.value.copy(bounds.min);u.boundsMax.value.copy(bounds.max);
    const position=mesh.geometry.attributes.position;
    for(let i=0;i<position.count;i++){
        const k=i*3;position.setXYZ(i,state.boxPositions[k]<0?bounds.min.x:bounds.max.x,
            state.boxPositions[k+1]<0?bounds.min.y:bounds.max.y,state.boxPositions[k+2]<0?bounds.min.z:bounds.max.z);
    }
    position.needsUpdate=true;if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();mesh.geometry.boundingBox.copy(bounds);
    if(!mesh.geometry.boundingSphere)mesh.geometry.computeBoundingSphere();bounds.getBoundingSphere(mesh.geometry.boundingSphere);
}
