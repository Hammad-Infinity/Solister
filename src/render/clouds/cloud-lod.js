// Which of Earth's two cloud representations is on screen.
//
// They are the same weather, drawn two ways:
//
//   * the flat deck -- one opaque textured shell, cheap, correct from orbit;
//   * the volume -- the shell shader that walks a ray through the 3D extinction
//     field, with layers, self-shadowing and depth to fly through.
//
// Only one may be visible at a time. The deck sits above the volume's shell by
// a kilometre and a half, so leaving both on hides the volume completely -- the
// failure looks exactly like "the volume renders nothing".
//
// The switch is by camera altitude above the drawn surface, with hysteresis so
// a camera hovering at the boundary does not flicker between them. Altitude,
// not distance: the bodies here are scaled, so the same camera distance means a
// different height over a different body.

const CLOUD_LOD = {
    // The crossfade band, by camera altitude above the surface.
    //
    // Above the top of the band the deck alone is drawn: a flat 2D sheet, at
    // 2048 x 1024, moved by the wind. That is the far-field representation and
    // it costs one textured quad. Below the bottom of the band the volume alone
    // is drawn. In between the two are cross-faded, so the transition is a
    // dissolve rather than a pop -- and because the volume is built *from* the
    // deck's coverage and type maps, the two agree about where every cloud is
    // throughout.
    //
    // The two weights are complementary across one band, so they always sum to
    // one and the sky never dims through the transition. An earlier version
    // faded the deck out over the first part of the band and the volume in over
    // the last, which left both at 0.35 in the middle: the clouds went 65%
    // transparent for a few hundred kilometres of descent.
    fadeStartKm: 9000,      // highest altitude at which any volume is drawn
    volumeFullKm: 6200      // below this the volume is the only representation
};

// A smoothstep on 0..1, clamped at both ends.
function smoothstep01(x) {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
}

function createCloudLod(THREE, options = {}) {
    const deck = options.deck;
    const shell = options.shell;
    const body = options.body;
    const radiusKm = options.radiusKm || 6371;
    if (!deck || !shell || !body) return null;

    const state = {
        volumetric: false,
        altitudeKm: Infinity,
        // What the caller should do with each mesh this frame.
        deckVisible: true,
        volumeVisible: false,
        deckOpacity: 1,
        volumeOpacity: 0
    };

    const centre = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const _camPos = new THREE.Vector3();

    function update(camera, opts = {}) {
        const wanted = opts.wanted !== false;
        const opacity = Number.isFinite(opts.opacity) ? opts.opacity : 1;

        body.getWorldPosition(centre);
        body.getWorldScale(scale);
        const worldRadius = body.geometry.parameters.radius * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
        const kmToWorld = worldRadius / radiusKm;

        const distance = camera.getWorldPosition(_camPos).distanceTo(centre);
        state.altitudeKm = Math.max(0, (distance - worldRadius) / kmToWorld);

        // The two representations' weights. Altitude, not distance. One ramp,
        // and the two weights are its ends, so they sum to one exactly.
        const alt = state.altitudeKm;
        const deckWeight = smoothstep01((alt - CLOUD_LOD.volumeFullKm) / (CLOUD_LOD.fadeStartKm - CLOUD_LOD.volumeFullKm));
        const volumeWeight = 1 - deckWeight;
        const on = wanted ? 1 : 0;

        state.volumetric = volumeWeight > 0.5;
        state.deckVisible = wanted && deckWeight > 0.004;
        state.volumeVisible = wanted && volumeWeight > 0.004;
        // The opacities follow `wanted` too: the cloud shadow reads them, and a
        // switched-off sky must not cast one.
        state.deckOpacity = deckWeight * opacity * on;
        state.volumeOpacity = volumeWeight * opacity * on;
        deck.visible = state.deckVisible;
        shell.visible = state.volumeVisible;
        shell.material.uniforms.uOpacity.value = state.volumeOpacity;
        return state;
    }

    const api = {
        update, state,
        fadeStartKm: CLOUD_LOD.fadeStartKm,
        volumeFullKm: CLOUD_LOD.volumeFullKm
    };
    globalThis.updateEarthCloudLod = (camera, opts) => api.update(camera, opts);
    return api;
}

globalThis.CLOUD_LOD = CLOUD_LOD;
globalThis.createCloudLod = createCloudLod;
