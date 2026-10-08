import { createTailScreenMask } from './comet-screen-mask.js';
import { createCometOcclusion, COMET_OCCLUSION_SHADER } from './comet-occlusion.js';

const MAX_SEGMENTS = 24;
const GAUSSIAN_NORMALIZATION = Math.sqrt(2 * Math.PI);
const VERTEX_SHADER = `
varying vec3 vLocal;
void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT_SHADER = `
#include <common>
${COMET_OCCLUSION_SHADER}
varying vec3 vLocal;
uniform vec3 eye;
uniform vec3 tint;
uniform vec3 coreTint;
uniform vec3 sunDirection;
uniform vec3 boundsMin;
uniform vec3 boundsMax;
uniform float opacity;
uniform float brightness;
uniform float ionTail;
uniform float comaRadius;
uniform vec3 headAxis;
#if __VERSION__ >= 300
uniform highp usampler2D nodeMask;
#else
uniform sampler2D nodeMask;
#endif
uniform vec4 maskViewport;
uniform vec3 maskGrid;
uniform float maskBits[24];
uniform bool screenMaskEnabled;
uniform int nodeCount;
uniform vec4 metricX[24];
uniform vec4 metricY[24];
uniform vec4 metricZ[24];
uniform float columnScale[24];
vec2 tailBoxHit(vec3 origin, vec3 direction) {
    vec3 signValue = step(vec3(0.0), direction) * 2.0 - 1.0;
    vec3 inverse = 1.0 / (signValue * max(abs(direction), vec3(0.0000001)));
    vec3 first = (boundsMin - origin) * inverse;
    vec3 second = (boundsMax - origin) * inverse;
    vec3 nearHit = min(first, second);
    vec3 farHit = max(first, second);
    return vec2(max(max(nearHit.x, nearHit.y), nearHit.z), min(min(farHit.x, farHit.y), farHit.z));
}
float tailErf(float value) {
    float magnitude = min(abs(value), 7.0);
    float t = 1.0 / (1.0 + 0.3275911 * magnitude);
    float polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
        0.284496736) * t + 0.254829592) * t;
    return sign(value) * (1.0 - polynomial * exp(-magnitude * magnitude));
}
float tailColumn(vec3 origin, vec3 direction, float start, float finish, vec4 mx, vec4 my, vec4 mz, float scale) {
    vec3 point = vec3(mx.w, my.w, mz.w);
    vec3 ray = vec3(dot(direction, mx.xyz),
        dot(direction, my.xyz), dot(direction, mz.xyz));
    float coefficient = max(dot(ray, ray), 0.000000000001);
    float center = -dot(point, ray) / coefficient;
    vec3 nearest = point + ray * center;
    float impact = dot(nearest, nearest);
    if (impact > 32.0) return 0.0;
    float root = sqrt(0.5 * coefficient);
    float interval = tailErf((finish - center) * root) - tailErf((start - center) * root);
    float integral = sqrt(PI / (2.0 * coefficient)) * max(0.0, interval) * exp(-0.5 * impact);
    float headDensity = 1.0;
    #if COMET_ION_TAIL
    if (comaRadius > 0.0) {
        vec3 brightestPoint = origin + direction * clamp(center, start, finish);
        headDensity = smoothstep(-comaRadius * 0.08, comaRadius * 0.02, dot(brightestPoint, headAxis));
    }
    #endif
    return integral * scale * headDensity;
}
void main() {
    if (cometNucleusPixel()) discard;
    if (opacity <= 0.0 || nodeCount == 0) discard;
    vec3 direction = normalize(vLocal - eye);
    vec2 hit = tailBoxHit(eye, direction);
    float start = max(0.0, hit.x);
    float finish = cometRayLimit(eye, direction, hit.y);
    if (finish <= start) discard;
    #if COMET_ION_TAIL
    if (comaRadius > 0.0) {
        float rate = dot(direction, headAxis);
        float initial = dot(eye, headAxis);
        float boundary = -comaRadius * 0.08;
        if (abs(rate) < 0.0000001) {
            if (initial < boundary) discard;
        } else {
            float crossing = (boundary - initial) / rate;
            if (rate > 0.0) start = max(start, crossing);
            else finish = min(finish, crossing);
        }
        if (finish <= start) discard;
    }
    #endif
    cometWriteDepth(eye,direction,start);
    #if __VERSION__ >= 300
    uint candidates = 16777215u;
    #else
    vec3 candidates = vec3(255.0);
    #endif
    if (screenMaskEnabled) {
        vec2 tile = floor((gl_FragCoord.xy - maskViewport.xy) / maskGrid.z);
        vec2 uv = (tile + 0.5) / maskGrid.xy;
        #if __VERSION__ >= 300
        candidates = texture2D(nodeMask, uv).r;
        if (candidates == 0u) discard;
        #else
        candidates = floor(texture2D(nodeMask, uv).rgb * 255.0 + 0.5);
        if (dot(candidates, vec3(1.0)) < 0.5) discard;
        #endif
    }
    float column = 0.0;
    #if __VERSION__ >= 300
    uint allNodes = (1u << uint(nodeCount)) - 1u;
    candidates &= allNodes;
    if (candidates == allNodes) {
        for (int i = 0; i < 24; i++) {
            if (i >= nodeCount) break;
            column += tailColumn(eye, direction, start, finish, metricX[i], metricY[i], metricZ[i], columnScale[i]);
        }
    } else {
        for (int i = 0; i < 24; i++) {
            if (candidates == 0u) break;
            uint lowest = candidates & (~candidates + 1u);
            int index = int(log2(float(lowest)) + 0.5);
            candidates &= candidates - 1u;
            column += tailColumn(eye, direction, start, finish, metricX[index], metricY[index], metricZ[index], columnScale[index]);
        }
    }
    #else
    for (int i = 0; i < 24; i++) {
        if (i >= nodeCount) break;
        float candidate = i < 8 ? candidates.r : (i < 16 ? candidates.g : candidates.b);
        if (mod(floor(candidate / maskBits[i]), 2.0) < 0.5) continue;
        column += tailColumn(eye, direction, start, finish, metricX[i], metricY[i], metricZ[i], columnScale[i]);
    }
    #endif
    float opticalColumn=max(0.0,column*opacity);
    #if COMET_ION_TAIL
    float alpha=opticalColumn/(1.0+opticalColumn/0.68);
    #else
    float alpha=1.0-exp(-opticalColumn);
    #endif
    if (alpha < 0.00003) discard;
    float forward = pow(max(0.0, dot(direction, sunDirection)), 3.0);
    float scattering = mix(0.9 + 0.45 * forward, 1.0, ionTail);
    vec3 tailColor=tint;
    #if COMET_ION_TAIL
    tailColor=mix(tint,coreTint,0.72*smoothstep(0.025,0.26,alpha));
    #endif
    gl_FragColor = vec4(tailColor * brightness * scattering, min(alpha, 0.92));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

function smoothstep(start, finish, value) {
    const t = Math.max(0, Math.min(1, (value - start) / Math.max(1e-12, finish - start)));
    return t * t * (3 - 2 * t);
}

export function createTailVolume(THREE, registry, nucleus, color, segments = MAX_SEGMENTS, flatten = 1, ionTail = false) {
    const count = Math.max(8, Math.min(MAX_SEGMENTS, Math.round(segments)));
    const occlusion = createCometOcclusion(THREE, registry, nucleus);
    const uniforms = {
        ...occlusion.uniforms,
        eye: { value: new THREE.Vector3() },
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        tint: { value: new THREE.Color(color) },
        coreTint: { value: new THREE.Color(0x59ddff) },
        opacity: { value: 0 },
        comaRadius: { value: 0 },
        headAxis: { value: new THREE.Vector3(1, 0, 0) },
        brightness: { value: ionTail ? 1.04 : 1.8 },
        ionTail: { value: ionTail ? 1 : 0 },
        boundsMin: { value: new THREE.Vector3() },
        boundsMax: { value: new THREE.Vector3() },
        nodeCount: { value: 0 },
        nodes: { value: Array.from({ length: MAX_SEGMENTS }, () => new THREE.Vector4()) },
        tangents: { value: Array.from({ length: MAX_SEGMENTS }, () => new THREE.Vector4()) },
        upAxes: { value: Array.from({ length: MAX_SEGMENTS }, () => new THREE.Vector4()) },
        weights: { value: new Float32Array(MAX_SEGMENTS) },
        metricX: { value: Array.from({ length: MAX_SEGMENTS }, () => new THREE.Vector4()) },
        metricY: { value: Array.from({ length: MAX_SEGMENTS }, () => new THREE.Vector4()) },
        metricZ: { value: Array.from({ length: MAX_SEGMENTS }, () => new THREE.Vector4()) },
        columnScale: { value: new Float32Array(MAX_SEGMENTS) },
    };
    const material = new THREE.ShaderMaterial({
        uniforms, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER,
        defines: { COMET_ION_TAIL: ionTail ? 1 : 0 },
        transparent: true, depthWrite: false, depthTest: true,
        side: THREE.BackSide, toneMapped: !ionTail, fog: false,
        blending: THREE.NormalBlending,
        extensions: { fragDepth: true },
    });
    material.addEventListener('dispose', () => occlusion.dispose());
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = ionTail ? 'Volumetric blue ion tail' : 'Volumetric sunlit dust tail';
    mesh.raycast = () => {};
    mesh.frustumCulled=!ionTail;
    mesh.renderOrder = ionTail ? 6 : 4;
    mesh.visible = false;
    mesh.userData = {
        points: new Float64Array((count + 1) * 3),
        emission: new Float32Array(count + 1).fill(1),
        physicalLengths: new Float64Array(count + 1),
        widths: new Float64Array(count + 1),
        referenceWidths:ionTail?new Float64Array(count+1):null,
        renderRadii:ionTail?new Float64Array(MAX_SEGMENTS):null,
        renderAlong:ionTail?new Float64Array(MAX_SEGMENTS):null,
        renderFlatten:ionTail?new Float64Array(MAX_SEGMENTS):null,
        renderColumns:ionTail?new Float32Array(MAX_SEGMENTS):null,
        viewBounds:ionTail?new THREE.Box3():null,
        viewMatrix:ionTail?new THREE.Matrix4():null,
        viewPoint:ionTail?new THREE.Vector3():null,
        viewViewport:ionTail?new THREE.Vector4():null,
        segments: count,
        flatten: Math.max(0.8, Math.min(1.15, flatten)),
        boxPositions: new Float32Array(geometry.getAttribute('position').array),
        bounds: new THREE.Box3(),
        center: new THREE.Vector3(),
        tangent: new THREE.Vector3(),
        side: new THREE.Vector3(),
        up: new THREE.Vector3(),
        previousUp: new THREE.Vector3(),
        extent: new THREE.Vector3(),
        scratch: new THREE.Vector3(),
        volumeReady: false,
        volumeVersion: 0,
        nodeSides: Array.from({ length: MAX_SEGMENTS }, () => new THREE.Vector3()),
    };
    const screenMask = createTailScreenMask(THREE, mesh, uniforms);
    material.addEventListener('dispose', () => screenMask.dispose());
    const eye = new THREE.Vector3();
    const sun = new THREE.Vector3();
    mesh.onBeforeRender = (renderer, scene, camera) => {
        camera.getWorldPosition(eye);
        uniforms.eye.value.copy(eye);
        mesh.worldToLocal(uniforms.eye.value);
        if(ionTail)softenIonKernel(mesh,renderer,camera);
        for (let index = 0; index < uniforms.nodeCount.value; index++) {
            const node = uniforms.nodes.value[index];
            const x = uniforms.eye.value.x - node.x;
            const y = uniforms.eye.value.y - node.y;
            const z = uniforms.eye.value.z - node.z;
            const mx = uniforms.metricX.value[index], my = uniforms.metricY.value[index], mz = uniforms.metricZ.value[index];
            mx.w = x * mx.x + y * mx.y + z * mx.z;
            my.w = x * my.x + y * my.y + z * my.z;
            mz.w = x * mz.x + y * mz.y + z * mz.z;
        }
        if (registry.sun) registry.sun.getWorldPosition(sun);
        else sun.set(0, 0, 0);
        uniforms.sunDirection.value.copy(sun);
        mesh.worldToLocal(uniforms.sunDirection.value);
        uniforms.sunDirection.value.normalize();
        const bound = mesh.geometry.boundingSphere;
        if (bound) occlusion.update(mesh, renderer, camera, bound.center, bound.radius);
        screenMask.update(renderer, camera);
    };
    return mesh;
}

export function writeTailVolume(mesh, points, widthFunction, opacity) {
    const data = mesh.userData;
    const uniforms = mesh.material.uniforms;
    const segments = data.segments;
    const bounds = data.bounds.makeEmpty();
    const weights = uniforms.weights.value;
    let count = 0;
    let frameReady = false;
    const ionStream=uniforms.ionTail.value>0.5;
    let referenceMass=0,streamerMass=0;
    for (let i = 0; i <= segments; i++) data.widths[i] = Math.max(1e-10, widthFunction(i / segments));
    for (let i = 0; i < segments; i++) {
        const first = i * 3;
        const next = first + 3;
        const tangent = data.tangent.set(points[next] - points[first], points[next + 1] - points[first + 1], points[next + 2] - points[first + 2]);
        const length = tangent.length();
        if (!(length > 1e-12)) continue;
        tangent.divideScalar(length);
        const radius = Math.max(1e-10, (data.widths[i] + data.widths[i + 1]) * 0.5);
        const alongRadius = Math.max(length * 0.68, radius * 0.55);
        const up = data.up;
        if (frameReady) up.copy(data.previousUp).addScaledVector(tangent, -data.previousUp.dot(tangent));
        else up.set(0, 1, 0).addScaledVector(tangent, -tangent.y);
        if (up.lengthSq() < 1e-10) up.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
        up.normalize();
        data.side.crossVectors(up, tangent).normalize();
        data.previousUp.copy(up);
        frameReady = true;
        const center = data.center.set(
            (points[first] + points[next]) * 0.5,
            (points[first + 1] + points[next + 1]) * 0.5,
            (points[first + 2] + points[next + 2]) * 0.5
        );
        if (count === 0) uniforms.headAxis.value.copy(tangent);
        data.nodeSides[count].copy(data.side);
        const safeRadius = Math.max(radius, 1e-8);
        const safeAlong = Math.max(alongRadius, safeRadius * 0.5);
        uniforms.metricX.value[count].set(data.side.x / safeRadius, data.side.y / safeRadius, data.side.z / safeRadius, 0);
        uniforms.metricY.value[count].set(up.x / (safeRadius * data.flatten), up.y / (safeRadius * data.flatten), up.z / (safeRadius * data.flatten), 0);
        uniforms.metricZ.value[count].set(tangent.x / safeAlong, tangent.y / safeAlong, tangent.z / safeAlong, 0);
        uniforms.nodes.value[count].set(center.x, center.y, center.z, radius);
        uniforms.tangents.value[count].set(tangent.x, tangent.y, tangent.z, alongRadius);
        uniforms.upAxes.value[count].set(up.x, up.y, up.z, data.flatten);
        const fraction = (i + 0.5) / segments;
        const emission = (data.emission[i] + data.emission[i + 1]) * 0.5;
        const head=smoothstep(0,0.006,fraction);
        const envelope=head*(1-smoothstep(0.58,1,fraction));
        const referenceDensity=emission*envelope*Math.exp(-fraction*1.8);
        const streamEnvelope=head*(1-0.55*smoothstep(0.82,1,fraction));
        const density=ionStream?emission*streamEnvelope*Math.exp(-fraction*0.7):referenceDensity;
        weights[count]=density*length/(alongRadius*GAUSSIAN_NORMALIZATION);
        if(ionStream){
            const massScale=length*safeRadius*data.flatten*safeAlong/alongRadius;
            const referenceRadius=data.referenceWidths&&data.referenceWidths[0]>0
                ?Math.max(1e-10,(data.referenceWidths[i]+data.referenceWidths[i+1])*0.5):radius;
            const referenceSafeRadius=Math.max(referenceRadius,1e-8);
            const referenceAlong=Math.max(length*0.68,referenceRadius*0.55);
            const referenceSafeAlong=Math.max(referenceAlong,referenceSafeRadius*0.5);
            const referenceScale=length*referenceSafeRadius*data.flatten*referenceSafeAlong/referenceAlong;
            referenceMass+=referenceDensity*referenceScale;
            streamerMass+=density*massScale;
        }
        uniforms.columnScale.value[count] = weights[count] / (safeRadius * GAUSSIAN_NORMALIZATION);
        const extent = data.extent.set(
            Math.abs(tangent.x) * alongRadius + Math.abs(data.side.x) * radius + Math.abs(up.x) * radius * data.flatten,
            Math.abs(tangent.y) * alongRadius + Math.abs(data.side.y) * radius + Math.abs(up.y) * radius * data.flatten,
            Math.abs(tangent.z) * alongRadius + Math.abs(data.side.z) * radius + Math.abs(up.z) * radius * data.flatten
        ).multiplyScalar(4.5);
        bounds.expandByPoint(data.scratch.copy(center).sub(extent));
        bounds.expandByPoint(data.scratch.copy(center).add(extent));
        count++;
    }
    if(ionStream&&streamerMass>0){
        const gain=referenceMass/streamerMass;
        for(let i=0;i<count;i++){
            weights[i]*=gain;
            uniforms.columnScale.value[i]*=gain;
        }
    }
    if(ionStream){
        for(let i=0;i<count;i++){
            data.renderRadii[i]=Math.max(uniforms.nodes.value[i].w,1e-8);
            data.renderAlong[i]=Math.max(uniforms.tangents.value[i].w,data.renderRadii[i]*0.5);
            data.renderFlatten[i]=uniforms.upAxes.value[i].w;
            data.renderColumns[i]=uniforms.columnScale.value[i];
        }
    }
    data.volumeVersion++;
    uniforms.nodeCount.value = count;
    uniforms.opacity.value = Math.max(0, Number.isFinite(opacity) ? opacity : 0);
    data.volumeReady = count > 0;
    if (!count) {
        mesh.visible = false;
        return;
    }
    uniforms.boundsMin.value.copy(bounds.min);
    uniforms.boundsMax.value.copy(bounds.max);
    fitTailBox(mesh,bounds);
    mesh.visible = uniforms.opacity.value > 0;
}


function fitTailBox(mesh,bounds){
    const data=mesh.userData;
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
        const offset = i * 3;
        position.setXYZ(i,
            data.boxPositions[offset] < 0 ? bounds.min.x : bounds.max.x,
            data.boxPositions[offset + 1] < 0 ? bounds.min.y : bounds.max.y,
            data.boxPositions[offset + 2] < 0 ? bounds.min.z : bounds.max.z
        );
    }
    position.needsUpdate = true;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    mesh.geometry.boundingBox.copy(bounds);
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    bounds.getBoundingSphere(mesh.geometry.boundingSphere);
}
function axisScale(axis,matrix){
    const e=matrix.elements,x=e[0]*axis.x+e[4]*axis.y+e[8]*axis.z;
    const y=e[1]*axis.x+e[5]*axis.y+e[9]*axis.z,z=e[2]*axis.x+e[6]*axis.y+e[10]*axis.z;
    return Math.max(1e-12,Math.hypot(x,y,z));
}
function softenIonKernel(mesh,renderer,camera){
    const data=mesh.userData,u=mesh.material.uniforms,count=u.nodeCount.value;
    if(!count)return;
    renderer.getCurrentViewport(data.viewViewport);
    const height=Math.max(1,data.viewViewport.w),dpr=renderer.getPixelRatio?.()||1;
    const projection=Math.max(1e-12,Math.abs(camera.projectionMatrix.elements[5]));
    data.viewMatrix.multiplyMatrices(camera.matrixWorldInverse,mesh.matrixWorld);
    const bounds=data.viewBounds.makeEmpty();
    let changed=false;
    for(let i=0;i<count;i++){
        const node=u.nodes.value[i],tangent=u.tangents.value[i],up=u.upAxes.value[i],side=data.nodeSides[i];
        data.viewPoint.set(node.x,node.y,node.z).applyMatrix4(data.viewMatrix);
        const depth=camera.isPerspectiveCamera?Math.max(camera.near,-data.viewPoint.z):1;
        const sigma=2*depth*1.1*dpr/(projection*height);
        const baseRadius=data.renderRadii[i],baseAlong=data.renderAlong[i],baseFlat=data.renderFlatten[i];
        const x=Math.hypot(baseRadius,sigma/axisScale(side,mesh.matrixWorld));
        const y=Math.hypot(baseRadius*baseFlat,sigma/axisScale(up,mesh.matrixWorld));
        const z=Math.hypot(baseAlong,sigma/axisScale(tangent,mesh.matrixWorld));
        if(node.w!==x||tangent.w!==z||up.w!==y/x)changed=true;
        node.w=x;tangent.w=z;up.w=y/x;
        u.metricX.value[i].set(side.x/x,side.y/x,side.z/x,0);
        u.metricY.value[i].set(up.x/y,up.y/y,up.z/y,0);
        u.metricZ.value[i].set(tangent.x/z,tangent.y/z,tangent.z/z,0);
        const massScale=baseRadius*baseRadius*baseFlat*baseAlong/(x*y*z);
        u.columnScale.value[i]=data.renderColumns[i]*massScale;
        data.extent.set(
            Math.abs(side.x)*x+Math.abs(up.x)*y+Math.abs(tangent.x)*z,
            Math.abs(side.y)*x+Math.abs(up.y)*y+Math.abs(tangent.y)*z,
            Math.abs(side.z)*x+Math.abs(up.z)*y+Math.abs(tangent.z)*z).multiplyScalar(4.5);
        data.center.set(node.x,node.y,node.z);
        bounds.expandByPoint(data.scratch.copy(data.center).sub(data.extent));
        bounds.expandByPoint(data.scratch.copy(data.center).add(data.extent));
    }
    u.boundsMin.value.copy(bounds.min);u.boundsMax.value.copy(bounds.max);
    if(changed){fitTailBox(mesh,bounds);data.volumeVersion++;}
}
