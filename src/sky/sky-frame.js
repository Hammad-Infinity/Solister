// One frame for everything on the sky dome.
//
// Equatorial unit vectors use x toward RA 0h, y toward RA 6h, z toward the north
// celestial pole. Scene vectors are the dome's own axes, where +y is the ecliptic
// north pole and +z points at RA 6h on the equator. Stars, constellation figures
// and the Milky Way all convert through these two functions, so they cannot drift
// apart.
export const OBLIQUITY_RADIANS = 23.4392911 * Math.PI / 180;

const COS_EPS = Math.cos(OBLIQUITY_RADIANS);
const SIN_EPS = Math.sin(OBLIQUITY_RADIANS);

export function eqUnitToScene(eq, out) {
    const x = eq.x, y = eq.y, z = eq.z;
    return out.set(x, -y * SIN_EPS + z * COS_EPS, -(y * COS_EPS + z * SIN_EPS));
}

export function sceneToEqUnit(scene, out) {
    const x = scene.x, y = scene.y, z = scene.z;
    return out.set(x, -y * SIN_EPS - z * COS_EPS, y * COS_EPS - z * SIN_EPS);
}

export function sceneToRaDec(scene, out) {
    sceneToEqUnit(scene, out);
    const ra = Math.atan2(out.y, out.x) / (Math.PI / 180);
    return {
        ra: (ra + 360) % 360,
        dec: Math.asin(Math.max(-1, Math.min(1, out.z))) / (Math.PI / 180)
    };
}

// Galactic frame, from the IAU pole and centre, mapped to scene axes.
//
// Both reference points are equatorial, so they go through the same conversion
// the stars use; a band in the wrong place is worse than no band.
const GALACTIC_POLE_RA = 192.85948;
const GALACTIC_POLE_DEC = 27.12825;
const GALACTIC_CENTRE_RA = 266.405;
const GALACTIC_CENTRE_DEC = -28.936;

function unitFromRaDec(raDegrees, decDegrees) {
    const ra = raDegrees * Math.PI / 180;
    const dec = decDegrees * Math.PI / 180;
    return [ Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec) ];
}

function cross(a, b) {
    return [ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] ];
}

// Galactic basis in equatorial coordinates: x at the centre, z at the north pole,
// y completing the right-handed set. Built once, used by the band matrix and by
// the star catalog, so both describe the same Galaxy.
let _basis = null;
export function galacticBasis() {
    if (_basis) return _basis;
    const pole = unitFromRaDec(GALACTIC_POLE_RA, GALACTIC_POLE_DEC);
    const centre = unitFromRaDec(GALACTIC_CENTRE_RA, GALACTIC_CENTRE_DEC);
    const along = centre[0] * pole[0] + centre[1] * pole[1] + centre[2] * pole[2];
    const x = [ centre[0] - along * pole[0], centre[1] - along * pole[1], centre[2] - along * pole[2] ];
    const xLen = Math.hypot(x[0], x[1], x[2]);
    x[0] /= xLen; x[1] /= xLen; x[2] /= xLen;
    return _basis = { x: x, y: cross(pole, x), z: pole };
}

// Galactic (l, b) in degrees to an equatorial unit vector. Exact inverse of the
// matrix below, which is why a star placed at l = 0, b = 0 lands on the band's
// brightest point and not merely near it.
export function galacticToEqUnit(lDegrees, bDegrees, out) {
    const b = galacticBasis();
    const cb = Math.cos(bDegrees * Math.PI / 180), sb = Math.sin(bDegrees * Math.PI / 180);
    const cl = Math.cos(lDegrees * Math.PI / 180), sl = Math.sin(lDegrees * Math.PI / 180);
    const gx = cb * cl, gy = cb * sl, gz = sb;
    return out.set(
        b.x[0] * gx + b.y[0] * gy + b.z[0] * gz,
        b.x[1] * gx + b.y[1] * gy + b.z[1] * gz,
        b.x[2] * gx + b.y[2] * gy + b.z[2] * gz
    );
}

export function galacticFrame(THREE) {
    const basis = galacticBasis();
    const pole = basis.z;
    const x = basis.x, y = basis.y;
    const eqToGalactic = new THREE.Matrix3().set(
        x[0], x[1], x[2],
        y[0], y[1], y[2],
        pole[0], pole[1], pole[2]
    );
    // Scene to equatorial, as a matrix, so the rows can be composed directly.
    const c = COS_EPS, s = SIN_EPS;
    const sceneToEquatorial = new THREE.Matrix3().set(
        1, 0, 0,
        0, -s, -c,
        0, c, -s
    );
    return eqToGalactic.multiply(sceneToEquatorial);
}
