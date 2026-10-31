// A planetary atmosphere as a term in the planet surface's own radiance.
//
// The atmosphere as a term in the planet surface's own radiance:
//
//     groundColor = groundColor * Attenuation + Inscatter;
//
// opaque, per pixel, no second surface and no alpha to get wrong. This module does the same thing to a three.js
// MeshStandardMaterial through onBeforeCompile, at the one point in the
// fragment shader where the lit colour still exists as linear radiance and
// nothing has been tone mapped yet: right after `opaque_fragment`.
//
// Geometry is taken from the vertex position in local space, which is
// planet-centred and, in this app, unscaled (the body meshes carry rotation
// only). One constant converts to kilometres: the same KM_PER_AU / AU_UNITS the
// app uses to build every radius, so the atmosphere's ground radius lands on
// the mesh's equator by construction rather than by a tuning factor.
//
// The sun is the scene's own light, not a second one. This build lights
// everything with a PointLight of decay 0 and distance 0, so the irradiance is
// constant across bodies; the atmosphere must see exactly that number or the
// air and the ground will disagree about how bright the sun is. The tables hold
// radiance per unit solar irradiance (their phase function carries the physical
// 1/4pi), so multiplying by the same irradiance puts both terms in the same
// units with no fudge factor and no pi.

const ATM_HORIZON_EPS = 1e-3;

// Where the eye ray meets the ground, exactly.
//
// A fragment's varying is interpolated across a triangle, so it sits on the
// chord between two vertices and the air term is a difference of two table
// fetches that changes by 50% for a 3 km error in the ground radius (measured).
// The direction from the eye to that point is exact, so the point is re-derived
// by intersecting the ray with the ground sphere.
const ATM_SURFACE_POINT_GLSL = `
// The surface point: where the eye ray through this fragment meets the ground
// sphere the table was baked on.
//
// The fragment's varying is the interpolated position on a triangle of the
// drawn mesh. That point is inside the true surface by the chord of one
// triangle -- 7.6 km for a 64x32 sphere -- and near the limb a point 7 km
// inside maps to a tangential displacement of sqrt(2 R h) ~ 310 km, which is
// why the shaded limb and the reference disagreed while the arithmetic looked
// healthy. The direction from the eye through that point, on the other hand,
// is exact: the rasteriser interpolates a fragment's position on the ray that
// produced it. So the ray is the input and the point is solved for.
//
// The obvious quadratic form t = -b - sqrt(b*b - c) cannot be used here: with
// b ~ 3.2e4 km, b*b is 1e9 and c = eyeR^2 - Rg^2 is 9e4, so float32 loses
// every digit of the discriminant. Rationalising the root removes the
// subtraction entirely and is exact at the limb as well as at the sub-camera
// point:
//
//   s = (eyeR^2 - Rg^2) / (eyeR cosA + sqrt(Rg^2 - perp^2))
//
// with cosA the cosine between the view ray and the direction to the eye, and
// perp the distance from the centre to the ray's closest approach.
//
// The radius is uAtmRadii.x -- the Rg the table itself was baked on -- and not
// the drawn semi-axes. The tables store density as a function of height over
// their own ground; sampling at the mesh's WGS84 6378 km instead of the table's
// 6371 km is +7 km of height, where transmittance has already halved.
//
// Local space, kilometres in and out.
vec3 atmSurfacePoint(vec3 rasterKm, vec3 eyeKm, float groundKm) {
    vec3 dir = normalize(rasterKm - eyeKm);
    float eyeR = max(length(eyeKm), 1e-6);
    float cosA = clamp(-dot(dir, eyeKm) / eyeR, -1.0, 1.0);
    float perp = sqrt(max(groundKm * groundKm - eyeR * eyeR * (1.0 - cosA * cosA), 0.0));
    float s = (eyeR * eyeR - groundKm * groundKm) / max(eyeR * cosA + perp, 1e-6);
    return eyeKm + dir * s;
}
`;


const ATM_COMPOSITE_GLSL = `
// The composite itself, as a pure function of its inputs, so a probe can call
// it with the same numbers the rasteriser would hand it.
//
// ground is the surface radiance the body was already shaded with; the return
// value is what replaces it. Radiance in, radiance out: transmittance
// multiplies the ground, the air is added, and both are in the same units
// because the air is scaled by the same solar irradiance the ground was lit by.
// The two terms the composite is made of, so a probe can look at each one
// without patching the shader. Out parameters because GLSL ES has no tuples.
void atmCompositeTerms(vec3 fragKm, vec3 eyeKm, vec3 sunDir, out vec3 air, out vec3 atten) {
    vec3 toEye = eyeKm - fragKm;
    float dist = max(length(toEye), 1e-6);
    vec3 view = -toEye / dist;                    // eye -> fragment
    float eyeR = max(length(eyeKm), 1e-6);
    float fragR = max(length(fragKm), 1e-6);
    float eyeMu = dot(eyeKm, view) / eyeR;
    float fragMu = dot(fragKm, view) / fragR;
    // The two ground-side inscatter fetches meet at the horizon and are
    // ill-conditioned within a hair of it, so that band is blended from both
    // sides instead of being sampled on one.
    float rgOverR = uAtmRadii.x / eyeR;
    float horizonMu = -sqrt(max(1.0 - rgOverR * rgOverR, 0.0));

    AtmRay ray;
    ray.eyePos = eyeKm;
    ray.eyeR = eyeR;
    ray.eyeMu = eyeMu;
    ray.viewDir = view;
    ray.viewLen = dist;
    ray.fragPos = fragKm;
    ray.fragR = fragR;
    ray.fragMu = fragMu;

    atten = atmTransmittanceSegment(eyeR, eyeMu, fragR, fragMu);
    air = abs(eyeMu - horizonMu) < ATM_HORIZON_EPS
        ? atmInscatterGroundFix(ray, sunDir, atten, ATM_HORIZON_EPS)
        : atmInscatterGround(ray, sunDir, atten);
}

vec3 atmCompositeSurface(vec3 fragKm, vec3 eyeKm, vec3 sunDir, vec3 ground) {
    vec3 air, atten;
    atmCompositeTerms(fragKm, eyeKm, sunDir, air, atten);
    return ground * atten + air * uAtmSunIrradiance;
}
`;

// The injected tail: derive the surface point exactly, then composite.
const ATM_INJECT_GLSL = `
{
    // The stretch first, then the surface point: the ray is solved for where it
    // meets the ellipsoid, which in this space is the sphere the table knows.
    vec3 atmEyeKm = atmToTable(uAtmEyeLocalKm);
    vec3 atmSunKm = normalize(atmToTable(uAtmSunDirLocal));
    vec3 atmRasterKm = atmToTable(vAtmLocalPos * uAtmKmPerUnit);
    vec3 atmFragKm = atmSurfacePoint(atmRasterKm, atmEyeKm, uAtmRadii.x);
    if (uAtmDebugMode < 0.5) {
        gl_FragColor.rgb = atmCompositeSurface(atmFragKm, atmEyeKm, atmSunKm, gl_FragColor.rgb);
    } else {
        // A window into the shader for probes, inert unless a probe opens it:
        // 1 the air term, 2 the transmittance, 3 the surface point, 4 the point
        // the rasteriser handed us, 5 the eye -- all in units of 1000 km, which
        // keeps the readback in a comfortable range. 6 is the scale factors
        // themselves: the length of the varying, km per unit, and the ground
        // radius, in their own units rather than in 1000 km.
        vec3 atmAir, atmAtten;
        atmCompositeTerms(atmFragKm, atmEyeKm, atmSunKm, atmAir, atmAtten);
        if (uAtmDebugMode < 1.5) gl_FragColor = vec4(atmAir, atmAtten.r);
        else if (uAtmDebugMode < 2.5) gl_FragColor = vec4(atmAtten, 1.0);
        else if (uAtmDebugMode < 3.5) gl_FragColor = vec4(atmFragKm * 0.001, 1.0);
        else if (uAtmDebugMode < 4.5) gl_FragColor = vec4(atmRasterKm * 0.001, 1.0);
        else if (uAtmDebugMode < 5.5) gl_FragColor = vec4(atmEyeKm * 0.001, 1.0);
        else gl_FragColor = vec4(length(vAtmLocalPos), uAtmKmPerUnit * 0.001, uAtmRadii.x * 0.001, 1.0);
    }
}
`;

// The air beside the disc.
//
// Same tables, same eye vector, same sun as the composite: the only difference
// is that these pixels' rays never reach the ground. The table's eye-ray term
// covers that case as it stands (atmInscatterSky), so the halo is not a second
// model -- it is the other branch of the same one.
//
// The mesh sits at the table's top radius, behind the body, and is opaque. The
// depth buffer therefore keeps it exactly the pixels the ground mesh did not
// draw, and nothing is added twice.
//
// That used to be an analytic discard -- "hide any ray that meets the body" --
// and it left a dark sub-pixel seam all the way around the limb, because the
// drawn body is a tessellated chord: its silhouette sits a few kilometres
// inside the true ellipsoid the test used, so the band of pixels between the two
// was drawn by neither. The depth buffer has no such gap: it is the rasteriser's
// own answer to which surface is nearer.
const ATM_SKY_VERTEX_GLSL = `
varying vec4 vAtmClip;
void main() {
    // The clip position is interpolated exactly in screen space by the
    // rasteriser, so vAtmClip.xy / vAtmClip.w is the pixel's own NDC position to
    // the last bit. Everything else here -- a direction computed per vertex, or
    // a ray built from the interpolated surface position -- is a smooth field
    // sampled on a triangle, and near the limb that is not good enough: the
    // band's radiance falls by 10 % per kilometre of impact parameter, so a
    // 4e-5 rad interpolation error is a 3 % error in the answer (measured).
    vAtmClip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = vAtmClip;
}
`;

const ATM_SKY_FRAGMENT_GLSL = `
varying vec4 vAtmClip;

uniform vec3 uAtmEyeLocalKm;
uniform vec2 uAtmRayScale;      // 1/P00, 1/P11: NDC -> view-space slope
uniform mat3 uAtmViewToLocal;   // view-space direction -> body-local direction
uniform vec3 uAtmSunDirLocal;
uniform vec3 uAtmSunIrradiance;
// Inert unless a probe opens it: writes the ray the sky term integrates on, so
// a disagreement with the CPU mirror can be pinned on the geometry instead of
// guessed at.
uniform float uAtmSkyDebug;

void main() {
    // Into the table's own space: the drawn ellipsoid becomes the sphere the
    // table was baked on (see uAtmAxisScale). Everything downstream -- the eye
    // ray, the horizon, the cosine to the sun -- is measured against the
    // ellipsoid's normal once the stretch is applied, so nothing else changes.
    vec3 eyeKm = atmToTable(uAtmEyeLocalKm);
    // The exact ray through this pixel. The perspective projection's first and
    // fifth diagonal entries are all it takes to turn NDC into a view-space
    // slope -- inverting the matrix per fragment is the same answer computed the
    // hard way, and it costs precision that the band cannot spare.
    vec2 ndc = vAtmClip.xy / vAtmClip.w;
    vec3 dirView = normalize(vec3(ndc.x * uAtmRayScale.x, ndc.y * uAtmRayScale.y, -1.0));
    vec3 dir = normalize(atmToTable(uAtmViewToLocal * dirView));

    // atmSkyRay lives in the sampling library: the sky mesh and any future
    // caller must integrate on the same ray, and the unit probe compiles the
    // library alone.
    AtmRay ray = atmSkyRay(eyeKm, dir);
    if (uAtmSkyDebug > 0.5) {
        gl_FragColor = vec4(ray.eyeMu, length(cross(eyeKm, dir)) * 0.001,
                            ray.eyeR * 0.001, 1.0);
        return;
    }
    vec3 air = atmInscatterSky(ray, normalize(atmToTable(uAtmSunDirLocal))) * uAtmSunIrradiance;
    gl_FragColor = vec4(air, 1.0);
}
`;

// Installed once a body's table is in memory. Returns the uniform object so the
// frame loop can keep the eye and sun up to date; a null return means the body
// is not composited (no table or no material).
function installAtmComposite(THREE, key, table, body, options = {}) {
    const material = body?.material;
    if (!material || !table) return null;
    const kmPerUnit = typeof KM_PER_AU === "number" && typeof AU_UNITS === "number"
        ? KM_PER_AU / AU_UNITS
        : NaN;
    if (!(kmPerUnit > 0)) {
        console.warn("[Solister] atmosphere composite: scene scale is not available for " + key + ".");
        return null;
    }
    // A table is baked on its own ground radius, and that radius is not always
    // the radius the body is drawn with: the models for the giants are stored at
    // a reduced scale (the Jupiter table is the same model at one tenth of its
    // kilometres, Neptune's is an Earth-sized envelope). Sampling those tables
    // with the scene's kilometres would put every eye position outside the
    // shell and render no air at all. So the unit that reaches the shader is
    // table kilometres per world unit: the scene's km/unit times the ratio
    // between the table's ground and the drawn one. For a body baked at its own
    // radius the ratio is 1 and this is a no-op -- Earth, Venus and Mars.
    const radiusUnits = body?.geometry?.parameters?.radius;
    if (!(radiusUnits > 0)) {
        console.warn("[Solister] atmosphere composite: " + key + " has no drawn radius.");
        return null;
    }
    const drawnGroundKm = radiusUnits * kmPerUnit;
    const tableScale = table.header.groundRadiusKm / drawnGroundKm;

    // How far the drawn body is from a sphere of its own equatorial radius:
    // the stretch that makes the ellipsoid the table's ground. The axes are in
    // kilometres and independent of the table's scale, so the ratio is the same
    // number in both spaces. Bodies drawn as spheres keep (1, 1, 1).
    const axesKm = body?.geometry?.userData?.referenceAxesKm;
    const polarStretch = axesKm && axesKm[2] > 0 ? axesKm[0] / axesKm[2] : 1;

    const uniforms = {
        ...atmSamplingUniforms(THREE, table.header, table),
        uAtmAxisScale: { value: new THREE.Vector3(1, polarStretch, 1) },
        uAtmKmPerUnit: { value: kmPerUnit * tableScale },
        uAtmEyeLocalKm: { value: new THREE.Vector3() },
        uAtmSunDirLocal: { value: new THREE.Vector3(1, 0, 0) },
        // Solar irradiance at this body, in the same units the surface's own
        // lighting uses: colour * intensity * three's point-light falloff.
        uAtmSunIrradiance: { value: new THREE.Vector3(1, 1, 1) },
        uAtmDebugMode: { value: 0 },
        // Read by the sky mesh, which rebuilds each pixel's ray from its clip
        // position. They live on the shared set so the frame loop keeps them
        // current in one place for every material that needs them.
        uAtmRayScale: { value: new THREE.Vector2(1, 1) },
        uAtmViewToLocal: { value: new THREE.Matrix3() },
        // Probes flip this to measure the composite against the bare surface.
        // The material is never recompiled; only this branch changes.
        uAtmEnabled: { value: options.enabled === false ? 0 : 1 }
    };

    const previous = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, renderer) {
        if (typeof previous === "function") previous.call(this, shader, renderer);

        for (const name of Object.keys(uniforms)) shader.uniforms[name] = uniforms[name];

        shader.vertexShader = "varying vec3 vAtmLocalPos;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\n    vAtmLocalPos = position;"
        );

        // highp sampler3D has no default precision in GLSL ES 3.00, and the
        // planet shader does not declare one.
        shader.fragmentShader = "precision highp sampler3D;\n"
            + "varying vec3 vAtmLocalPos;\n"
            + "uniform float uAtmKmPerUnit;\n"
            + "uniform vec3 uAtmEyeLocalKm;\n"
            + "uniform vec3 uAtmSunDirLocal;\n"
            + "uniform vec3 uAtmSunIrradiance;\n"
            + "uniform float uAtmEnabled;\n"
            + "uniform float uAtmDebugMode;\n"
            + ATM_SAMPLING_GLSL
            + ATM_SURFACE_POINT_GLSL
            + "const float ATM_HORIZON_EPS = " + ATM_HORIZON_EPS.toFixed(6) + ";\n"
            + ATM_COMPOSITE_GLSL
            + shader.fragmentShader;

        const anchor = "#include <opaque_fragment>";
        if (!shader.fragmentShader.includes(anchor)) {
            console.warn("[Solister] atmosphere composite: opaque_fragment anchor missing for " + key + ".");
            return;
        }
        shader.fragmentShader = shader.fragmentShader.replace(
            anchor,
            anchor + "\nif (uAtmEnabled > 0.5) " + ATM_INJECT_GLSL
        );
    };

    // The material was already compiled for this body before the table arrived,
    // so force exactly one rebuild.
    material.customProgramCacheKey = function () {
        return (previous && previous.customProgramCacheKey
            ? previous.customProgramCacheKey.call(this)
            : "") + "|atm-composite";
    };
    material.userData.atmComposite = uniforms;
    material.needsUpdate = true;
    return uniforms;
}

// The mesh that draws air where the disc is not.
//
// It shares the surface material's uniform objects rather than copying them:
// the eye, the sun, the tables, the projection and the frame are the same
// values the surface composites with, so there is one place they can be wrong
// instead of two.
function installAtmSky(THREE, key, table, body, uniforms) {
    const geometry = body?.geometry;
    const radiusUnits = geometry?.parameters?.radius;
    const groundKm = table.header.groundRadiusKm;
    const topKm = table.header.topRadiusKm;
    if (!(radiusUnits > 0) || !(topKm > groundKm)) return null;
    // The shell follows the drawn body's shape, 60 km (Rt - Rg) above every
    // axis: the inner edge has to be the drawn silhouette exactly, and the outer
    // edge has to be where the table's air ends.
    const shellRadius = radiusUnits * (topKm / groundKm);
    const shapes = globalThis.BodyShapes || null;
    if (!shapes) return null;
    const segments = typeof atmosphereShellSegments === "function"
        ? atmosphereShellSegments()
        : [ 128, 64 ];
    const skyGeometry = shapes.createGeometry(THREE, key, shellRadius, segments[0], segments[1]);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            ...uniforms,
            uAtmSkyDebug: { value: 0 }
        },
        vertexShader: ATM_SKY_VERTEX_GLSL,
        // The sampling library is the whole prelude: the halo calls the same
        // atmInscatterSky the composite would have called for a sky ray.
        // highp sampler3D has no default precision in GLSL ES 3.00 and the
        // library declares the sampler, so the qualifier goes first, ahead of
        // everything it applies to.
        fragmentShader: "precision highp sampler3D;\n" + ATM_SAMPLING_GLSL + ATM_SKY_FRAGMENT_GLSL,
        // Opaque, because these pixels belong to no other surface: the ground
        // mesh refused them at the silhouette. Nothing blends here, so there is
        // no alpha that has to mean two things.
        transparent: false,
        depthWrite: true,
        depthTest: true,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false
    });
    const mesh = new THREE.Mesh(skyGeometry, material);
    mesh.name = key + " air";
    mesh.userData.isAtmSky = true;
    mesh.renderOrder = 1;
    mesh.raycast = () => {};
    body.add(mesh);
    return mesh;
}

// Bodies whose shell is currently suppressed, so the frame loop can keep the
// eye and sun uniforms current and nothing re-enables the shell behind our back.
const atmCompositeReady = [];

// Loads one table per body and installs the composite and the sky mesh on each.
// Sequential on purpose: five tables is 21 MB of video memory, and doing them in
// parallel only moves the same bytes through the same decompressor at once.
// Yielding a frame between bodies keeps the scene responsive while they load;
// a table's conversion is 20 ms, so the whole set costs the frame loop nothing
// it can feel.
async function startAtmAtmospheres(THREE, keys = null) {
    const list = keys || (typeof ATM_TABLE_BODIES !== "undefined" ? ATM_TABLE_BODIES : [ "earth" ]);
    const installed = [];
    // `objectRegistry` and `cloudMeshes` are top-level consts in classic scripts:
    // they live in the shared global lexical scope, so they are reached by name
    // and never as properties of globalThis.
    const registry = typeof objectRegistry !== "undefined" ? objectRegistry : null;
    if (!registry) return installed;
    for (const key of list) {
        const body = registry[key];
        if (!body || body.userData?.atmComposite) continue;
        let table = null;
        try {
            table = await loadAtmTable(THREE, key);
        } catch (error) {
            console.warn("[Solister] atmosphere table for " + key + " is not available:", error && error.message);
            continue;
        }
        const uniforms = installAtmComposite(THREE, key, table, body);
        if (!uniforms) continue;
        // The shell would add a second air light over the same disc. Double
        // counting is the exact failure this port removes, so it goes.
        const shell = typeof cloudMeshes !== "undefined" ? cloudMeshes[key + "_atmosphere"] : null;
        const sky = installAtmSky(THREE, key, table, body, uniforms);
        // Only drop the shell once the air beside the disc has something to
        // replace it with. Suppressing it without a sky mesh would take the
        // body's limb away.
        if (shell && sky) {
            shell.userData.atmSuppressed = true;
            // Take it out of the frame immediately; the frame loop's
            // syncPlanetAtmospheres would hide it on the next tick, and one
            // frame of two airs over the same disc is one too many.
            shell.visible = false;
        }
        const entry = { key, body, uniforms, sky };
        atmCompositeReady.push(entry);
        installed.push(entry);
        // Let the frame loop run before the next table is decompressed.
        await new Promise(resolve => typeof requestAnimationFrame === "function"
            ? requestAnimationFrame(resolve)
            : setTimeout(resolve, 0));
    }
    return installed;
}

// Exposed so a probe can run the same source the material compiles.
globalThis.ATM_COMPOSITE_GLSL = ATM_COMPOSITE_GLSL;
globalThis.ATM_SURFACE_POINT_GLSL = ATM_SURFACE_POINT_GLSL;
globalThis.installAtmComposite = installAtmComposite;
globalThis.installAtmSky = installAtmSky;
globalThis.ATM_SKY_FRAGMENT_GLSL = ATM_SKY_FRAGMENT_GLSL;
globalThis.startAtmAtmospheres = startAtmAtmospheres;
globalThis.atmCompositeReady = atmCompositeReady;
globalThis.ATM_HORIZON_EPS = ATM_HORIZON_EPS;
