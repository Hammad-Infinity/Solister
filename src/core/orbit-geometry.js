export const PARENT_GM = Object.freeze({
    sun: 132712440041.9394, earth: 398600.435436, mars: 42828.375816,
    jupiter: 126686531.9, saturn: 37931206.23, uranus: 5793951.3,
    neptune: 6835099.97, pluto: 869.3,
});
export function createAnchoredOrbitGeometry(THREE, segments = 2048) {
    const coordinates = new Float32Array(segments * 3);
    for (let i = 0; i < segments; i++) {
        const t = i / segments * Math.PI * 2;
        coordinates[i * 3] = -2 * Math.sin(t / 2) ** 2;
        coordinates[i * 3 + 1] = Math.sin(t);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(coordinates, 3));
    geometry.userData.bodyAnchoredOrbit = true;
    return geometry;
}
export function setAnchoredOrbitMatrix(line, U, V, cosE, sinE, position) {
    line.matrixAutoUpdate = false;
    line.frustumCulled = false;
    line.matrix.set(
        U[0]*cosE+V[0]*sinE, -U[0]*sinE+V[0]*cosE, 0, position.x,
        U[1]*cosE+V[1]*sinE, -U[1]*sinE+V[1]*cosE, 0, position.y,
        U[2]*cosE+V[2]*sinE, -U[2]*sinE+V[2]*cosE, 1, position.z,
        0, 0, 0, 1
    );
    line.matrixWorldNeedsUpdate = true;
}
export function ellipseFromState(position, velocity, mu) {
    if (!(mu > 0) || !position || !velocity) return null;
    const r = Array.from(position).slice(0, 3), v = Array.from(velocity).slice(0, 3);
    if (r.length !== 3 || v.length !== 3 || ![...r,...v].every(Number.isFinite)) return null;
    const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const radius = Math.hypot(...r), h = cross(r,v), hLength = Math.hypot(...h);
    if (!(radius > 0) || !(hLength > 0)) return null;
    const invA = 2 / radius - dot(v,v) / mu;
    if (!(invA > 0)) return null;
    const a = 1 / invA, vxh = cross(v,h);
    const eVector = vxh.map((x,i) => x / mu - r[i] / radius);
    const e = Math.hypot(...eVector);
    if (!(e < 1) || !Number.isFinite(a)) return null;
    const axisP = e > 1e-10 ? eVector.map(x=>x/e) : r.map(x=>x/radius);
    const axisQ = cross(h.map(x=>x/hLength),axisP);
    const b = a * Math.sqrt(Math.max(0,1-e*e));
    let cosE = dot(r,axisP) / a + e, sinE = dot(r,axisQ) / b;
    const norm = Math.hypot(cosE,sinE);
    if (!(norm > 0)) return null;
    cosE /= norm; sinE /= norm;
    return { U: axisP.map(x=>x*a), V: axisQ.map(x=>x*b), cosE, sinE, a, e };
}
export function sceneAxes(ellipse, km2u) {
    const toScene = v => [km2u(v[0]),km2u(v[2]),-km2u(v[1])];
    return { U: toScene(ellipse.U), V: toScene(ellipse.V) };
}
export const OrbitGeometry = Object.freeze({
    PARENT_GM, createAnchoredOrbitGeometry, setAnchoredOrbitMatrix, ellipseFromState, sceneAxes,
});