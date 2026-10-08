import { useNucleusStencil } from './comet-stencil.js';
import { createNucleusDepth } from './comet-depth.js';

export const COMET_OCCLUSION_SHADER = `
#include <packing>
uniform sampler2D nucleusDepth;
uniform mat4 localToClip;
uniform vec4 depthViewport;
uniform float depthRange;
uniform bool hasNucleusDepth;
uniform float nucleusOpacity;
uniform int occluderCount;
uniform vec4 occluders[12];
#if defined(USE_LOGDEPTHBUF) && defined(USE_LOGDEPTHBUF_EXT)
uniform float logDepthBufFC;
#endif
vec2 cometSphereHit(vec3 origin, vec3 direction, float radius) {
    float along = dot(origin, direction);
    vec3 perpendicular = cross(origin, direction);
    float distanceSquared = dot(perpendicular, perpendicular);
    float discriminant = radius * radius - distanceSquared;
    if (discriminant <= 0.0) return vec2(1.0, -1.0);
    float chord = sqrt(discriminant);
    return vec2(-along - chord, -along + chord);
}
bool cometNucleusPixel() {
    if (!hasNucleusDepth || nucleusOpacity < 0.999) return false;
    vec2 uv = (gl_FragCoord.xy - depthViewport.xy) / depthViewport.zw;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) return false;
    return unpackRGBAToDepth(texture2D(nucleusDepth, uv)) < 0.99999;
}
void cometWriteDepth(vec3 origin,vec3 direction,float distanceAlong){
    vec4 clip=localToClip*vec4(origin+direction*distanceAlong,1.0);
    #if defined(USE_LOGDEPTHBUF) && defined(USE_LOGDEPTHBUF_EXT)
    // Logarithmic depth path: keep comet volumes in the same depth space as
    // everything else so they occlude and get occluded without Z-fighting.
    gl_FragDepth=log2(max(1.0+clip.w,1e-6))*logDepthBufFC*0.5;
    #else
    float depth=clamp(clip.z/max(clip.w,0.000001)*0.5+0.5,0.0,1.0);
    #if __VERSION__ >= 300
    gl_FragDepth=depth;
    #elif defined(GL_EXT_frag_depth)
    gl_FragDepthEXT=depth;
    #endif
    #endif
}
float cometRayLimit(vec3 origin, vec3 direction, float finish) {
    for (int i = 0; i < 12; i++) {
        if (i >= occluderCount) break;
        vec2 hit = cometSphereHit(origin - occluders[i].xyz, direction, occluders[i].w);
        if (hit.y > 0.0 && hit.x < finish && hit.y > hit.x) finish = min(finish, max(0.0, hit.x));
    }
    if (hasNucleusDepth) {
        vec2 uv = (gl_FragCoord.xy - depthViewport.xy) / depthViewport.zw;
        if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) {
            float depth = unpackRGBAToDepth(texture2D(nucleusDepth, uv));
            if (depth < 0.99999) finish = mix(finish, min(finish, depth * depthRange), nucleusOpacity);
        }
    }
    return finish;
}`;

function hierarchyVisible(object) {
    for (let parent = object; parent; parent = parent.parent) {
        if (!parent.visible) return false;
    }
    return true;
}

export function createCometOcclusion(THREE, registry, nucleus) {
    const depth = createNucleusDepth(THREE, nucleus);
    const _nucleusDistGuard = { value: 0 };
    const uniforms = {
        nucleusOpacity: { value: 1 },
        localToClip: { value: new THREE.Matrix4() },
        nucleusDepth: { value: null },
        depthViewport: { value: new THREE.Vector4() },
        depthRange: { value: 1 },
        hasNucleusDepth: { value: false },
        occluderCount: { value: 0 },
        occluders: { value: Array.from({ length: 12 }, () => new THREE.Vector4()) },
        nucleusDistGuard: _nucleusDistGuard,
    };
    const eye = new THREE.Vector3();
    const center = new THREE.Vector3();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const candidates = [];
    const pool = [];

    function update(volume, renderer, camera, localCenter, localRadius) {
        volume.updateWorldMatrix(true, false);
        uniforms.localToClip.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(volume.matrixWorld);
        camera.getWorldPosition(eye);
        center.copy(localCenter).applyMatrix4(volume.matrixWorld);
        volume.getWorldScale(scale);
        const unit = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z), 1e-15);
        const radius = Math.max(localRadius * unit, 1e-15);
        uniforms.nucleusOpacity.value = nucleus.material?.opacity ?? 1;
        const camWorld = camera.getWorldPosition(new THREE.Vector3());
        const nucWorld = nucleus.getWorldPosition(new THREE.Vector3());
        const nucScale = nucleus.getWorldScale(new THREE.Vector3());
        const nucRadius = (nucleus.geometry?.parameters?.radius || 1) * Math.max(Math.abs(nucScale.x), Math.abs(nucScale.y), Math.abs(nucScale.z));
        const distToNucleus = camWorld.distanceTo(nucWorld);
        const zoomedIn = distToNucleus < nucRadius * 12;
        _nucleusDistGuard.value = zoomedIn ? 1 : 0;
        const stencil=useNucleusStencil(THREE,renderer,volume.material,nucleus);
        const mask = !stencil && uniforms.nucleusOpacity.value > 0.001 && zoomedIn ? depth.render(renderer, camera) : null;
        uniforms.hasNucleusDepth.value = !!mask && zoomedIn;
        if (mask) {
            uniforms.nucleusDepth.value = mask.texture;
            uniforms.depthViewport.value.copy(mask.viewport);
            uniforms.depthRange.value = mask.rangeWorld / unit;
        }
        axis.subVectors(center, eye);
        const distance = axis.length();
        if (distance > 0) axis.divideScalar(distance);
        candidates.length = 0;
        let used = 0;
        for (const body of Object.values(registry)) {
            if (!body?.isMesh || body === nucleus || body.userData.isComet ||
                body.userData.isPopulationAnchor || body.userData.isAtmosphere ||
                Array.isArray(body.material) || body.material?.wireframe ||
                (body.material?.opacity ?? 1) < 0.95 || !hierarchyVisible(body)) continue;
            const baseRadius = body.geometry?.parameters?.radius;
            if (!(baseRadius > 0)) continue;
            body.getWorldPosition(position);
            body.getWorldScale(scale);
            const bodyRadius = baseRadius * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
            offset.subVectors(position, eye);
            const along = offset.dot(axis);
            const range = offset.length();
            if (range - bodyRadius > distance + radius || along + bodyRadius < 0) continue;
            const cone = distance > radius ? radius * Math.max(0, Math.min(1, along / distance)) : radius;
            if (Math.max(0, range * range - along * along) > (bodyRadius + cone) ** 2) continue;
            const item = pool[used] || (pool[used] = { value: new THREE.Vector4(), distance: 0 });
            used++;
            volume.worldToLocal(position);
            item.value.set(position.x, position.y, position.z, bodyRadius / unit);
            item.distance = range - bodyRadius;
            candidates.push(item);
        }
        candidates.sort((a, b) => a.distance - b.distance);
        const count = Math.min(12, candidates.length);
        uniforms.occluderCount.value = count;
        for (let i = 0; i < count; i++) uniforms.occluders.value[i].copy(candidates[i].value);
    }

    return { uniforms, update, dispose: () => depth.dispose() };
}
