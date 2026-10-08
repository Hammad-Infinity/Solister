const IAU_2000 = Object.freeze({
    sun:     Object.freeze({ ra: [286.13, 0],          dec: [63.87, 0],           pm: [84.176, 14.18440, 0] }),
    mercury: Object.freeze({ ra: [281.0103, -0.0328],  dec: [61.4155, -0.0049],   pm: [329.5988, 6.1385108, 0] }),
    venus:   Object.freeze({ ra: [272.76, 0],          dec: [67.16, 0],           pm: [160.20, -1.4813688, 0] }),
    earth:   Object.freeze({ ra: [0, -0.641],          dec: [90, -0.557],         pm: [190.147, 360.9856235, 0] }),
    mars:    Object.freeze({ ra: [317.269202, -0.10927547], dec: [54.432516, -0.05827105], pm: [176.049863, 350.891982443297, 0] }),
    jupiter: Object.freeze({ ra: [268.056595, -0.006499], dec: [64.495303, 0.002413], pm: [284.95, 870.536, 0] }),
    saturn:  Object.freeze({ ra: [40.589, -0.036],     dec: [83.537, -0.004],    pm: [38.90, 810.7939024, 0] }),
    uranus:  Object.freeze({ ra: [257.311, 0],         dec: [-15.175, 0],         pm: [203.81, -501.1600928, 0] }),
    neptune: Object.freeze({ ra: [299.36, 0],           dec: [43.46, 0],           pm: [249.978, 541.1397757, 0] }),
    moon:    Object.freeze({ ra: [269.9949, 0.0031],   dec: [66.5392, 0.0130],    pm: [38.3213, 13.17635815, -1.4e-12] }),
    pluto:   Object.freeze({ ra: [132.993, 0],          dec: [-6.163, 0],          pm: [302.695, 56.3625225, 0] }),
});

const J2000_JD = 2451545.0;
const DAY_MS = 86400000;
const DEG = Math.PI / 180;
const OBLIQUITY_J2000 = 23.439291111 * DEG;

/**
 * Mean IAU pole / prime-meridian orientation from NAIF's pck00011.tpc.
 * The returned body-fixed axes use Solister's local +Y north and +Z at 0 E,
 * then map J2000 equatorial coordinates into the scene's J2000 ecliptic frame.
 * Periodic nutation/phase-angle terms from the PCK are omitted; the equatorial
 * grid intentionally follows this same rendered mean body-fixed frame.
 */
export class BodyOrientation {
    constructor({ THREE }) {
        this.T = THREE;
        this.axisX = new THREE.Vector3(1, 0, 0);
        this.axisZ = new THREE.Vector3(0, 0, 1);
        this.qScene = new THREE.Quaternion().setFromAxisAngle(this.axisX, -Math.PI / 2 - OBLIQUITY_J2000);
        const permutation = new THREE.Matrix4().set(
            0, 0, 1, 0,
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 0, 1
        );
        this.qSceneBodyAxes = new THREE.Quaternion().setFromRotationMatrix(permutation);
        this.qPole = new THREE.Quaternion();
        this.qPrime = new THREE.Quaternion();
        this.qSpin = new THREE.Quaternion();
        this.result = new THREE.Quaternion();
        this.updatedJulianDay = NaN;
    }

    has(key) { return Object.prototype.hasOwnProperty.call(IAU_2000, key); }

    apply(mesh, key, milliseconds) {
        const model = IAU_2000[key];
        if (!mesh || !model || !Number.isFinite(milliseconds)) return false;
        const jd = milliseconds / DAY_MS + 2440587.5;
        const d = jd - J2000_JD;
        const T = d / 36525.0;
        const ra = (model.ra[0] + model.ra[1] * T) * DEG;
        const dec = (model.dec[0] + model.dec[1] * T) * DEG;
        const w = (model.pm[0] + model.pm[1] * d + model.pm[2] * d * d) * DEG;
        this.qPole.setFromAxisAngle(this.axisZ, ra + Math.PI / 2);
        this.qPrime.setFromAxisAngle(this.axisX, Math.PI / 2 - dec);
        this.qSpin.setFromAxisAngle(this.axisZ, w);
        this.result.copy(this.qScene)
            .multiply(this.qPole)
            .multiply(this.qPrime)
            .multiply(this.qSpin)
            .multiply(this.qSceneBodyAxes);
        mesh.quaternion.copy(this.result);
        mesh.updateMatrix();
        this.updatedJulianDay = jd;
        return true;
    }

    applyAll(objectRegistry, milliseconds) {
        let count = 0;
        for (const key of Object.keys(IAU_2000)) {
            const body = objectRegistry?.[key];
            if (body && this.apply(body, key, milliseconds)) count++;
        }
        return count;
    }

    static get source() { return 'NAIF text PCK pck00011.tpc; IAU mean pole and prime meridian'; }
    static get coverage() { return Object.keys(IAU_2000); }
}
