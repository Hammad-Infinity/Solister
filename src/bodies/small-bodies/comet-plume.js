import { LDB_VERTEX_PARS, LDB_VERTEX_TAIL, LDB_FRAGMENT_PARS, LDB_FRAGMENT_HEAD } from "../../render/log-depth-glsl.js";

const VERT = `attribute float aEmission;varying vec2 vUv;varying float vEmission;varying vec3 vN;varying vec3 vEye;${LDB_VERTEX_PARS}\nvoid main(){vUv=uv;vEmission=aEmission;vec4 p=modelViewMatrix*vec4(position,1.);vEye=-p.xyz;vN=normalMatrix*normal;gl_Position=projectionMatrix*p;${LDB_VERTEX_TAIL}}`;

const FRAG = `uniform vec3 tint;uniform float opacity;uniform float startFade;varying vec2 vUv;varying float vEmission;varying vec3 vN;varying vec3 vEye;${LDB_FRAGMENT_PARS}\nvoid main(){${LDB_FRAGMENT_HEAD}float fade=smoothstep(0.,startFade,vUv.x)*(1.-smoothstep(.55,1.,vUv.x));float cloud=.65+.35*sin(vUv.y*37.6991+sin(vUv.x*18.)*1.3);float soft=pow(abs(dot(normalize(vN),normalize(vEye))),1.4);float a=opacity*vEmission*fade*cloud*soft*.38;if(a<.0001)discard;gl_FragColor=vec4(tint,a);}`;

export function createPlume(T, color, segments = 32, flatten = 1) {
    const radial = 40, count = (segments + 1) * (radial + 1), g = new T.BufferGeometry, uv = new Float32Array(count * 2), idx = [];
    for (let i = 0; i <= segments; i++) for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        uv[k * 2] = i / segments;
        uv[k * 2 + 1] = j / radial;
        if (i < segments && j < radial) {
            const q = k + radial + 1;
            idx.push(k, q, k + 1, k + 1, q, q + 1);
        }
    }
    g.setIndex(idx);
    g.setAttribute("position", new T.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("normal", new T.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("uv", new T.BufferAttribute(uv, 2));
    g.setAttribute("aEmission", new T.BufferAttribute(new Float32Array(count).fill(1), 1));
    const material = new T.ShaderMaterial({
        uniforms: {
            tint: {
                value: new T.Color(color)
            },
            opacity: {
                value: 0
            },
            startFade: {
                value: .003
            }
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        toneMapped: false
    });
    const mesh = new T.Mesh(g, material);
    mesh.raycast = () => {};
    mesh.frustumCulled = false;
    mesh.userData = {
        points: new Float64Array((segments + 1) * 3),
        boundsSphere: new T.Sphere(new T.Vector3, 0),
        segments: segments,
        radial: radial,
        flatten: flatten,
        openEnded: true,
        cos: [],
        sin: []
    };
    for (let j = 0; j <= radial; j++) {
        mesh.userData.cos.push(Math.cos(j / radial * Math.PI * 2));
        mesh.userData.sin.push(Math.sin(j / radial * Math.PI * 2));
    }
    return mesh;
}

export function writePlume(mesh, points, widthFn, opacity) {
    const d = mesh.userData, n = d.segments, m = d.radial, p = mesh.geometry.attributes.position, normals = mesh.geometry.attributes.normal;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    d.widthFn = widthFn;
    for (let i = 0; i <= n; i++) {
        const a = Math.max(0, i - 1) * 3, b = Math.min(n, i + 1) * 3;
        let tx = points[b] - points[a], ty = points[b + 1] - points[a + 1], tz = points[b + 2] - points[a + 2], len = Math.hypot(tx, ty, tz);
        if (len < 1e-15) {
            tx = 1;
            ty = tz = 0;
            len = 1;
        }
        tx /= len;
        ty /= len;
        tz /= len;
        let sx = tz, sy = 0, sz = -tx;
        len = Math.hypot(sx, sz);
        if (len < 1e-8) {
            sx = 0;
            sy = tz;
            sz = -ty;
            len = Math.hypot(sy, sz);
        }
        sx /= len;
        sy /= len;
        sz /= len;
        const ux = ty * sz - tz * sy, uy = tz * sx - tx * sz, uz = tx * sy - ty * sx, w = widthFn(i / n);
        for (let j = 0; j <= m; j++) {
            const c = d.cos[j] * w, s = d.sin[j] * w * d.flatten;
            const x = points[i * 3] + sx * c + ux * s, y = points[i * 3 + 1] + sy * c + uy * s, z = points[i * 3 + 2] + sz * c + uz * s;
            p.setXYZ(i * (m + 1) + j, x, y, z);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            maxZ = Math.max(maxZ, z);
            normals.setXYZ(i * (m + 1) + j, sx * d.cos[j] + ux * d.sin[j] / d.flatten, sy * d.cos[j] + uy * d.sin[j] / d.flatten, sz * d.cos[j] + uz * d.sin[j] / d.flatten);
        }
    }
    p.needsUpdate = normals.needsUpdate = true;
    const sphere = d.boundsSphere;
    sphere.center.set((minX + maxX) * .5, (minY + maxY) * .5, (minZ + maxZ) * .5);
    sphere.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * .5 + 1e-9;
    mesh.geometry.boundingSphere = sphere;
    mesh.frustumCulled = true;
    mesh.material.uniforms.opacity.value = opacity;
}
