const sharedNuclei = new WeakMap;

function createSharedDepth(THREE, nucleus) {
    const scene = new THREE.Scene;
    const material = new THREE.ShaderMaterial({
        uniforms: {
            range: {
                value: 1
            }
        },
        precision: "highp",
        vertexShader: `uniform float range;varying highp vec3 vView;\n            void main(){vec4 point=modelViewMatrix*vec4(position,1.0);vView=point.xyz/max(range,1e-20);gl_Position=projectionMatrix*point;}`,
        fragmentShader: `#include <packing>\n            varying highp vec3 vView;\n            void main(){gl_FragColor=packDepthToRGBA(clamp(length(vView),0.0,0.99999));}`,
        side: THREE.FrontSide,
        toneMapped: false,
        blending: THREE.NoBlending
    });
    const proxy = new THREE.Mesh(nucleus.geometry, material);
    proxy.matrixAutoUpdate = false;
    proxy.frustumCulled = false;
    scene.add(proxy);
    return {
        refs: 0,
        scene: scene,
        material: material,
        proxy: proxy,
        records: new Map,
        eye: new THREE.Vector3,
        center: new THREE.Vector3,
        view: new THREE.Vector3,
        scale: new THREE.Vector3,
        viewport: new THREE.Vector4,
        clearColor: new THREE.Color
    };
}

function sameSignature(record, nucleus, camera, viewport) {
    let same = record.geometry === nucleus.geometry;
    const signature = record.signature;
    let index = 0;
    for (const matrix of [ camera.matrixWorldInverse, camera.projectionMatrix, nucleus.matrixWorld ]) {
        for (const value of matrix.elements) {
            if (signature[index] !== value) same = false;
            signature[index++] = value;
        }
    }
    const geometry = nucleus.geometry;
    for (const value of [ viewport.x, viewport.y, viewport.z, viewport.w, geometry.attributes.position.version, geometry.index?.version ?? 0, geometry.drawRange.start, geometry.drawRange.count ]) {
        if (signature[index] !== value) same = false;
        signature[index++] = value;
    }
    record.geometry = geometry;
    return same;
}

function projectedAxis(position, depth, radius, scale, offset, size) {
    const denominator = depth * depth - radius * radius;
    const spread = radius * Math.sqrt(Math.max(0, depth * depth + position * position - radius * radius));
    const minimum = scale * (position * depth - spread) / denominator - offset;
    const maximum = scale * (position * depth + spread) / denominator - offset;
    return [ (minimum * .5 + .5) * size, (maximum * .5 + .5) * size ];
}

export function createNucleusDepth(THREE, nucleus) {
    let shared = sharedNuclei.get(nucleus);
    if (!shared) {
        shared = createSharedDepth(THREE, nucleus);
        sharedNuclei.set(nucleus, shared);
    }
    shared.refs++;
    let disposed = false;
    return {
        render(renderer, camera) {
            if (disposed) return null;
            nucleus.getWorldPosition(shared.center);
            if (nucleus.geometry.boundingSphere) shared.center.copy(nucleus.geometry.boundingSphere.center).applyMatrix4(nucleus.matrixWorld);
            camera.getWorldPosition(shared.eye);
            nucleus.getWorldScale(shared.scale);
            renderer.getCurrentViewport(shared.viewport);
            const viewport = shared.viewport;
            const radius = (nucleus.geometry.boundingSphere?.radius ?? nucleus.geometry.parameters.radius) * Math.max(Math.abs(shared.scale.x), Math.abs(shared.scale.y), Math.abs(shared.scale.z));
            const distance = shared.eye.distanceTo(shared.center);
            if (radius * camera.projectionMatrix.elements[5] * viewport.w / (2 * Math.max(distance - radius, 1e-15)) < .5) return null;
            let record = shared.records.get(renderer);
            if (!record) {
                record = {
                    target: new THREE.WebGLRenderTarget(1, 1, {
                        minFilter: THREE.NearestFilter,
                        magFilter: THREE.NearestFilter,
                        depthBuffer: true,
                        stencilBuffer: false
                    }),
                    signature: new Float64Array(56).fill(NaN),
                    geometry: null,
                    viewport: new THREE.Vector4,
                    rangeWorld: 1,
                    draws: 0,
                    valid: false
                };
                shared.records.set(renderer, record);
            }
            if (sameSignature(record, nucleus, camera, viewport)) return record.valid ? record : null;
            record.valid = false;
            let left = 0, bottom = 0, right = viewport.z, top = viewport.w;
            shared.view.copy(shared.center).applyMatrix4(camera.matrixWorldInverse);
            const depth = -shared.view.z;
            if (camera.isPerspectiveCamera && depth > radius + camera.near) {
                const projection = camera.projectionMatrix.elements;
                const x = projectedAxis(shared.view.x, depth, radius, projection[0], projection[8], viewport.z);
                const y = projectedAxis(shared.view.y, depth, radius, projection[5], projection[9], viewport.w);
                left = Math.max(0, Math.floor(x[0]) - 2);
                right = Math.min(viewport.z, Math.ceil(x[1]) + 2);
                bottom = Math.max(0, Math.floor(y[0]) - 2);
                top = Math.min(viewport.w, Math.ceil(y[1]) + 2);
            }
            if (!(right > left && top > bottom)) return null;
            record.target.setSize(right - left, top - bottom);
            record.target.viewport.set(-left, -bottom, viewport.z, viewport.w);
            record.target.scissorTest = false;
            record.viewport.set(viewport.x + left, viewport.y + bottom, right - left, top - bottom);
            record.rangeWorld = Math.max(distance + radius * 2, camera.near * 2, 1e-15);
            shared.material.uniforms.range.value = record.rangeWorld;
            shared.proxy.geometry = nucleus.geometry;
            shared.proxy.matrix.copy(nucleus.matrixWorld);
            shared.proxy.matrixWorld.copy(nucleus.matrixWorld);
            shared.proxy.matrixWorldNeedsUpdate = true;
            const target = renderer.getRenderTarget();
            const face = renderer.getActiveCubeFace?.() ?? 0;
            const level = renderer.getActiveMipmapLevel?.() ?? 0;
            const alpha = renderer.getClearAlpha();
            const autoClear = renderer.autoClear;
            const xr = renderer.xr.enabled;
            const shadow = renderer.shadowMap.autoUpdate;
            const shadowUpdate = renderer.shadowMap.needsUpdate;
            renderer.getClearColor(shared.clearColor);
            try {
                renderer.xr.enabled = false;
                renderer.shadowMap.autoUpdate = false;
                renderer.shadowMap.needsUpdate = false;
                renderer.autoClear = false;
                renderer.setRenderTarget(record.target);
                renderer.setClearColor(16777215, 1);
                renderer.clear();
                renderer.render(shared.scene, camera);
                record.texture = record.target.texture;
                record.draws++;
                record.valid = true;
            } finally {
                renderer.setRenderTarget(target, face, level);
                renderer.setClearColor(shared.clearColor, alpha);
                renderer.autoClear = autoClear;
                renderer.xr.enabled = xr;
                renderer.shadowMap.autoUpdate = shadow;
                renderer.shadowMap.needsUpdate = shadowUpdate;
            }
            return record;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            if (--shared.refs) return;
            shared.material.dispose();
            shared.proxy.removeFromParent();
            for (const record of shared.records.values()) record.target.dispose();
            shared.records.clear();
            sharedNuclei.delete(nucleus);
        }
    };
}
