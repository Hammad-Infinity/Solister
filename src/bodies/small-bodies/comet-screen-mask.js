const TILE_PIXELS = 32;

const SUPPORT = Math.sqrt(32 + 36) + .05;

const RAY_SUPPORT = Math.sqrt(32) + .05;

function perspectiveBounds(position, depth, variance, depthVariance, covariance, projection, offset, size) {
    const denominator = depth * depth - depthVariance;
    const center = position * depth + covariance;
    const spread = Math.sqrt(Math.max(0, center * center - denominator * (position * position - variance)));
    return [ ((projection * (center - spread) / denominator - offset) * .5 + .5) * size, ((projection * (center + spread) / denominator - offset) * .5 + .5) * size ];
}

export function createTailScreenMask(THREE, mesh, uniforms) {
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    uniforms.nodeMask = {
        value: texture
    };
    uniforms.maskViewport = {
        value: new THREE.Vector4
    };
    uniforms.maskGrid = {
        value: new THREE.Vector3(1, 1, TILE_PIXELS)
    };
    uniforms.screenMaskEnabled = {
        value: true
    };
    uniforms.maskBits = {
        value: Float32Array.from({
            length: 24
        }, (_, index) => 2 ** (index % 8))
    };
    const viewport = new THREE.Vector4;
    const matrix = new THREE.Matrix4;
    const projectionMatrix = new THREE.Matrix4;
    const frustum = new THREE.Frustum;
    const center = new THREE.Vector3;
    const sideCamera = new THREE.Vector3;
    const upCamera = new THREE.Vector3;
    const tangentCamera = new THREE.Vector3;
    const signature = new Float64Array(53).fill(NaN);
    let width = 1, height = 1, disposed = false, integerMask = false;
    let scratch = new Uint8Array(4);
    function cameraAxis(output, input, scale) {
        const m = matrix.elements;
        return output.set((m[0] * input.x + m[4] * input.y + m[8] * input.z) * scale, (m[1] * input.x + m[5] * input.y + m[9] * input.z) * scale, (m[2] * input.x + m[6] * input.y + m[10] * input.z) * scale);
    }
    return {
        update(renderer, camera) {
            if (disposed) return;
            renderer.getCurrentViewport(viewport);
            let unchanged = true, index = 0;
            for (const source of [ camera.matrixWorldInverse, camera.projectionMatrix, mesh.matrixWorld ]) {
                for (const value of source.elements) {
                    if (signature[index] !== value) unchanged = false;
                    signature[index++] = value;
                }
            }
            for (const value of [ viewport.x, viewport.y, viewport.z, viewport.w, mesh.userData.volumeVersion ]) {
                if (signature[index] !== value) unchanged = false;
                signature[index++] = value;
            }
            if (unchanged) return;
            const columns = Math.max(1, Math.ceil(viewport.z / TILE_PIXELS));
            const rows = Math.max(1, Math.ceil(viewport.w / TILE_PIXELS));
            const integer = renderer.capabilities.isWebGL2;
            let changed = columns !== width || rows !== height || integer !== integerMask;
            if (changed) {
                texture.dispose();
                width = columns;
                height = rows;
                integerMask = integer;
                texture.format = integer ? THREE.RedIntegerFormat : THREE.RGBAFormat;
                texture.type = integer ? THREE.UnsignedIntType : THREE.UnsignedByteType;
                texture.internalFormat = integer ? "R32UI" : null;
                texture.image = {
                    data: integer ? new Uint32Array(width * height) : new Uint8Array(width * height * 4),
                    width: width,
                    height: height
                };
                scratch = integer ? new Uint32Array(width * height) : new Uint8Array(width * height * 4);
            }
            scratch.fill(0);
            matrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
            projectionMatrix.multiplyMatrices(camera.projectionMatrix, matrix);
            frustum.setFromProjectionMatrix(projectionMatrix);
            const projection = camera.projectionMatrix.elements;
            const count = uniforms.nodeCount.value;
            let candidates = 0;
            for (let nodeIndex = 0; nodeIndex < count; nodeIndex++) {
                const node = uniforms.nodes.value[nodeIndex];
                const tangent = uniforms.tangents.value[nodeIndex];
                const up = uniforms.upAxes.value[nodeIndex];
                const side = mesh.userData.nodeSides[nodeIndex];
                const radius = Math.max(node.w, 1e-8);
                const upRadius = radius * up.w;
                const alongRadius = Math.max(tangent.w, radius * .5);
                center.set(node.x, node.y, node.z);
                let outside = false;
                for (const plane of frustum.planes) {
                    const extent = SUPPORT * Math.hypot(plane.normal.dot(side) * radius, plane.normal.dot(up) * upRadius, plane.normal.dot(tangent) * alongRadius);
                    if (plane.distanceToPoint(center) + extent < -1e-12) {
                        outside = true;
                        break;
                    }
                }
                if (outside) continue;
                center.applyMatrix4(matrix);
                cameraAxis(sideCamera, side, radius * RAY_SUPPORT);
                cameraAxis(upCamera, up, upRadius * RAY_SUPPORT);
                cameraAxis(tangentCamera, tangent, alongRadius * RAY_SUPPORT);
                const xVariance = sideCamera.x ** 2 + upCamera.x ** 2 + tangentCamera.x ** 2;
                const yVariance = sideCamera.y ** 2 + upCamera.y ** 2 + tangentCamera.y ** 2;
                const zVariance = sideCamera.z ** 2 + upCamera.z ** 2 + tangentCamera.z ** 2;
                const xz = sideCamera.x * sideCamera.z + upCamera.x * upCamera.z + tangentCamera.x * tangentCamera.z;
                const yz = sideCamera.y * sideCamera.z + upCamera.y * upCamera.z + tangentCamera.y * tangentCamera.z;
                const depth = -center.z;
                let left = 0, right = width - 1, bottom = 0, top = height - 1;
                if (camera.isPerspectiveCamera && Math.abs(depth) > Math.sqrt(zVariance) + camera.near) {
                    const x = perspectiveBounds(center.x, depth, xVariance, zVariance, xz, projection[0], projection[8], viewport.z);
                    const y = perspectiveBounds(center.y, depth, yVariance, zVariance, yz, projection[5], projection[9], viewport.w);
                    left = Math.max(0, Math.floor((x[0] - 2) / TILE_PIXELS));
                    right = Math.min(width - 1, Math.floor((x[1] + 2) / TILE_PIXELS));
                    bottom = Math.max(0, Math.floor((y[0] - 2) / TILE_PIXELS));
                    top = Math.min(height - 1, Math.floor((y[1] + 2) / TILE_PIXELS));
                }
                if (right < left || top < bottom) continue;
                const stride = integerMask ? 1 : 4;
                const channel = integerMask ? 0 : Math.floor(nodeIndex / 8);
                const bit = 1 << (integerMask ? nodeIndex : nodeIndex % 8);
                for (let y = bottom; y <= top; y++) {
                    for (let x = left; x <= right; x++) {
                        scratch[(y * width + x) * stride + channel] |= bit;
                        candidates++;
                    }
                }
            }
            mesh.userData.maskCandidatesPerTile = candidates / (width * height);
            uniforms.maskViewport.value.copy(viewport);
            uniforms.maskGrid.value.set(width, height, TILE_PIXELS);
            const pixels = texture.image.data;
            if (!changed) {
                for (let index = 0; index < pixels.length; index++) {
                    if (pixels[index] !== scratch[index]) {
                        changed = true;
                        break;
                    }
                }
            }
            if (changed) {
                pixels.set(scratch);
                texture.needsUpdate = true;
            }
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            texture.dispose();
        }
    };
}
