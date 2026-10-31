const _cameraSystemCenter = new THREE.Vector3;

const _cameraSurfaceCenter = new THREE.Vector3;

const _cameraOffset = new THREE.Vector3;

const _cameraMove = new THREE.Vector3;

const _cameraForward = new THREE.Vector3;

const _cameraRight = new THREE.Vector3;

const _cameraUp = new THREE.Vector3;

const _cameraLandingNormal = new THREE.Vector3;

const _cameraLandingTangent = new THREE.Vector3;

const _cameraLandingPoint = new THREE.Vector3;

const _cameraLandingTarget = new THREE.Vector3;

const _cameraLandingScratch = new THREE.Vector3;

const _cameraLandingRadial = new THREE.Vector3;

const _cameraLandingQuaternion = new THREE.Quaternion;

const _cameraLandingScale = new THREE.Vector3;

const _cameraLandingPosition = new THREE.Vector3;

const _cameraLandingStoredTarget = new THREE.Vector3;

const _cameraLandingRayOrigin = new THREE.Vector3;

const _cameraLandingRayDirection = new THREE.Vector3;

const _cameraLandingHitPoint = new THREE.Vector3;

const _cameraLandingHitNormal = new THREE.Vector3;

const _cameraLandingPush = new THREE.Vector3;

const _cameraLandingPrevInverse = new THREE.Matrix4;

const _cameraLandingDeltaMatrix = new THREE.Matrix4;

const _cameraLandingNormalRotation = new THREE.Quaternion;

const _cameraLandingTargetOffset = new THREE.Vector3;

const _cameraLandingSurfaceNormal = new THREE.Vector3;

const _cameraLandingNormalMatrix = new THREE.Matrix3;

const _cameraLandingHits = [];

const _cameraLandingRaycaster = new THREE.Raycaster;

const _cameraRightAxis = new THREE.Vector3;

const _cameraWorldUp = new THREE.Vector3(0, 1, 0);

const AUTO_LANDING_DISTANCE_RATIO = .32;

// Landing altitude easing, per second.
const LANDING_CLEARANCE_RATE = 5.5;

const SURFACE_RELEASE_RATIO = .45;

// Only used to switch terrain detail on for the final part of the approach. It no longer splits the animation.
const APPROACH_SPLIT = .7;

const SURFACE_DETAIL_ENTER_RATIO = 1.045;

const SURFACE_DETAIL_EXIT_RATIO = 1.12;

const AUTO_LANDING_INTENT_WINDOW_MS = 6e3;

let _surfacePerformanceMode = false;

function setSurfacePerformanceMode(active) {
    const next = !!active;
    if (next === _surfacePerformanceMode) return;
    _surfacePerformanceMode = next;
    globalThis.setSurfaceRenderMode?.(next);
}

const CAMERA_KEYBOARD_MOVE_RATE = .095;

const CAMERA_SURFACE_REBASE_KEYS = Object.freeze([ "mercury", "venus", "earth", "moon", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto" ]);

let _autoLandingIntentAt = 0;

let cameraFocusFollowEnabled = true;

const _cameraClampCorrection = new THREE.Vector3;

let _cameraInputInstalled = false;

let _cameraLookDrag = null;

let _cameraRightPointer = null;

let _cameraRightDrag = null;

const _orbitOffset = new THREE.Vector3;

const _orbitForward = new THREE.Vector3;

const _orbitRight = new THREE.Vector3;

// How close the camera is to the surface of whatever it is looking at,
// expressed as a fraction of that body's radius. Near the ground a drag has to
// move far less than it does in deep space, or the user overshoots the horizon with a twitch.
function _surfaceProximity() {
    const target = controls.target;
    if (!target) return 0;
    const dist = camera.position.distanceTo(target);
    const radius = focusedObject?.geometry?.parameters?.radius
        || focusedObject?.userData?.radius
        || 0;
    if (!(radius > 0) || !(dist > 0)) return 0;
    const altitude = Math.max(dist - radius, 0);
    // 1 when sitting on the surface, 0 once you are a radius clear of it.
    return Math.min(1, Math.max(0, 1 - altitude / radius));
}

// Scales a control speed down as the camera approaches a surface. Floor of
// 0.04 keeps the view controllable rather than sluggish when landed.
function _proximityScale() {
    return Math.max(0.04, 1 - 0.96 * _surfaceProximity());
}

function _orbitCameraByDrag(dragX, dragY) {
    const height = renderer.domElement?.clientHeight || window.innerHeight || 1;
    const rate = (controls.rotateSpeed || .7) * 2 * Math.PI / height * _proximityScale();
    _orbitOffset.subVectors(camera.position, controls.target);
    if (_orbitOffset.lengthSq() < 1e-24) return;
    _orbitForward.copy(_orbitOffset).normalize().negate();
    _orbitRight.crossVectors(_orbitForward, camera.up);
    if (_orbitRight.lengthSq() < 1e-12) return;
    _orbitRight.normalize();
    const yaw = rate * dragX, pitch = rate * dragY;
    _orbitOffset.applyAxisAngle(camera.up, -yaw);
    _orbitOffset.applyAxisAngle(_orbitRight, -pitch);
    camera.up.applyAxisAngle(_orbitRight, -pitch).normalize();
    camera.position.copy(controls.target).add(_orbitOffset);
    distanceReadout?.noteInput();
}

function bodyOnScreen(obj, radius) {
    if (!obj) return false;
    obj.getWorldPosition(_cullSphere.center);
    _cullSphere.radius = Math.max(1e-6, radius * 1.5);
    return _cullFrustum.intersectsSphere(_cullSphere);
}

function resolveFocusWorldPosition(out) {
    focusedObject.getWorldPosition(out);
    if (!focusedObject.userData.isPopulationAnchor) return;
    if (out.lengthSq() > 1e-4) return;
    let bestLen = 1e-4;
    focusedObject.traverse(child => {
        if (child === focusedObject) return;
        if (!(child.isMesh || child.isPoints || child.isInstancedMesh || child.isLine)) return;
        child.getWorldPosition(_resolveScratch);
        const len = _resolveScratch.lengthSq();
        if (len > bestLen) {
            bestLen = len;
            out.copy(_resolveScratch);
        }
    });
}

function applyLighting() {
    sunLight.decay = 0;
    sunLight.distance = 0;
    sunLight.intensity = 1.6;
}

function systemOverviewPosition() {
    const extent = 32 * AU_UNITS;
    const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov * .5);
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
    const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
    const distance = extent / Math.sin(limitingHalfFov) * 1.12;
    solarSystem.getWorldPosition(_cameraSystemCenter);
    return _cameraSystemCenter.clone().add(new THREE.Vector3(.15, .65, 1).normalize().multiplyScalar(distance));
}

function systemMaxDistance() {
    solarSystem.getWorldPosition(_cameraSystemCenter);
    return Math.max(22e4, systemOverviewPosition().distanceTo(_cameraSystemCenter) * 2);
}

function applyCameraDefaults() {
    DEFAULT_CAM_POS.copy(systemOverviewPosition());
    controls.minDistance = .05;
    controls.maxDistance = systemMaxDistance();
    camera.near = 1;
    camera.far = Math.max(12e5, controls.maxDistance * 2, SKY_RADIUS * 1.5);
    camera.updateProjectionMatrix();
    camera.position.copy(DEFAULT_CAM_POS);
    _clipPrevValid = false;
    solarSystem.getWorldPosition(_cameraSystemCenter);
    controls.target.copy(_cameraSystemCenter);
    controls.update();
}

function getZoomBounds(key, mesh) {
    if (key === "kuiperbelt") return {
        min: AU_UNITS * 2,
        max: Math.max(systemMaxDistance(), kuiperBelt.focusDistance(camera) * 1.6)
    };
    if (!mesh || !mesh.geometry || !mesh.geometry.parameters) {
        const fr = mesh && mesh.userData && mesh.userData.focusRadius || 1;
        return {
            min: Math.max(.01, fr * 1.5),
            max: AU_UNITS * 20
        };
    }
    if (mesh.userData.isPopulationAnchor) return {
        min: Math.max(.01, mesh.userData.focusRadius * 1.5),
        max: AU_UNITS * 20
    };
    if (mesh.userData.isComet) return {
        min: mesh.userData.minZoomDistance,
        max: mesh.userData.maxZoomDistance
    };
    if (mesh.userData.extraEphemeris) return {
        min: mesh.geometry.parameters.radius * textureZoomFactor(mesh),
        max: mesh.userData.maxZoomDistance
    };
    if (mesh.userData.isEphemerisMoon) return {
        min: mesh.userData.minZoomDistance,
        max: mesh.userData.maxZoomDistance
    };
    if (key === "asteroidbelt") return {
        min: Math.max(mesh.userData.rockRadius * 3, km2u(1)),
        max: AU_UNITS * 6
    };
    const radius = mesh.geometry.parameters.radius;
    if (key === "sun") return {
        min: radius * 1.5,
        max: AU_UNITS * 45
    };
    if (key === "moon") return {
        min: Math.max(1e-8, radius * .12),
        max: km2u(MOON_ORBIT_KM) * 2
    };
    const data = planetData.find(planet => planet.key === key);
    return {
        min: isLandableBody(mesh) ? Math.max(1e-8, radius * .12) : radius * textureZoomFactor(mesh),
        max: data ? data.orbitRadius * 2.2 : radius * 200
    };
}

function cinematicFocusDuration(fromCam, toCam) {
    const span = fromCam.distanceTo(toCam);
    const reference = Math.max(1e-4, Math.min(fromCam.length(), toCam.length()));
    return 2.6 + 1.7 * Math.min(1, span / reference);
}

function resetCameraControlMomentum() {
    if (!controls) return;
    const wasDamping = controls.enableDamping;
    const wasAutoRotate = controls.autoRotate;
    controls.enableDamping = false;
    controls.autoRotate = false;
    controls.update();
    controls.enableDamping = wasDamping;
    controls.autoRotate = wasAutoRotate;
}

function detachCameraFromFocus() {
    cameraFocusFollowEnabled = false;
    // _prevPos is deliberately kept: the follow block keeps tracking comets and
    // ephemeris moons through a drag, and clearing it here dropped one frame of
    // the body's motion at the start of every click.
}

function releaseFocusForManualMotion() {

    if (focusedObject?.userData?.isComet || focusedObject?.userData?.isEphemerisMoon || focusedObject?.userData?.extraEphemeris) return false;
    if (landingState || camTransition?.landing) {
        detachCameraFromFocus();
        return;
    }
    if (!focusedObject || focusedObject === solarSystem) return;
    cameraFocusFollowEnabled = false;
    if (focusedObject.userData) focusedObject.userData._prevPos = null;
    focusedObject = null;
    equatorialGrid?.setFocused(null);
    updateSurfaceGridControl(null);
    distanceReadout?.noteInput();
    hideFocusCard();

    if (focusSectionEl) setDockSectionOpen(focusSectionEl, false);
    unfocusBtn.hidden = true;
    _focusBounds = null;
    resetBodySelect();
    const keep = camera.position.distanceTo(controls.target);
    controls.minDistance = Math.min(.05, Math.max(keep * .5, 1e-8));
    controls.maxDistance = systemMaxDistance();
}

function focusOnObject(mesh, beltView = "close") {
    cameraKeys.clear();
    _autoLandingIntentAt = 0;
    rightOrbitActive = false;
    rightOrbitObject = null;
    if (mesh.userData.planetKey === "kuiperbelt" && !mesh.visible) return;
    if (!asteroidsEnabled && [ "asteroidbelt", "trojanl4", "trojanl5", "hildas", "nea", "kuiperbelt" ].includes(mesh.userData.planetKey)) return;
    if ((mesh.userData.extraEphemeris || mesh.userData.isComet) && !mesh.visible) return;
    if (!solarAccuracy.available) return;
    controls.autoRotate = false;
    resetCameraControlMomentum();
    const fromUp = camera.up.clone();
    cameraFocusFollowEnabled = true;
    if (focusedObject) focusedObject.userData._prevPos = null;
    focusedObject = mesh;
    lastFocusedObject = mesh;
    landingState = null;
    const focusKey = mesh.userData.planetKey;
    equatorialGrid?.setFocused(focusKey);
    updateSurfaceGridControl(focusKey);
    distanceReadout?.noteInput();
    unfocusBtn.hidden = false;
    controls.autoRotate = false;
    cancelZoomOnFocusChange();
    const rotateBtn = document.getElementById("toggle-rotate");
    if (rotateBtn) rotateBtn.classList.remove("active");
    const planetPos = new THREE.Vector3;
    if (mesh.userData.planetKey === "asteroidbelt" && asteroidBelt) {
        updateBeltFocusTarget(asteroidBelt.material.uniforms.uDays.value);
        solarSystem.updateMatrixWorld(true);
    }
    mesh.getWorldPosition(planetPos);
    const key = mesh.userData.planetKey;
    const radius = mesh.userData.focusRadius ?? (mesh.geometry && mesh.geometry.parameters ? mesh.geometry.parameters.radius : 1);
    const bounds = getZoomBounds(key, mesh);
    _focusBounds = bounds;
    let dist;
    if (key === "kuiperbelt") {
        dist = kuiperBelt.focusDistance(camera);
    } else if (key === "asteroidbelt") {
        mesh.userData.beltView = beltView;
        dist = beltView === "overview" ? AU_UNITS * .9 : Math.max(radius * 6, km2u(2));
        beltGuideEnabled = true;
    } else if (key === "sun") {
        dist = radius * 2.2;
    } else {
        dist = radius * 3;
    }
    if (mesh.userData.isComet) {
        const coma = mesh.userData.comaRadius || 0;
        dist = Math.max(radius * 6, coma * (coma > radius * 5.6 ? 8 : 3.2));
    }
    dist = THREE.MathUtils.clamp(dist, bounds.min * 1.2, bounds.max * .8);
    controls.minDistance = 1e-8;
    controls.maxDistance = Math.max(systemMaxDistance(), bounds.max);
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (mesh.userData.isPopulationAnchor) dir.set(.1, 1, .35).normalize();
    if (key === "asteroidbelt") {
        dir.copy(planetPos).negate().normalize().add(new THREE.Vector3(0, .65, 0)).normalize();
    }
    camera.near = mesh.userData.isEphemerisMoon || mesh.userData.isComet ? Math.max(km2u(mesh.userData.radiusKm) * .02, 1e-8) : key === "asteroidbelt" ? Math.max(mesh.userData.rockRadius * .05, 1e-6) : 1;
    if (mesh.userData.isComet) camera.near = Math.max(1e-8, radius * .005);
    camera.updateProjectionMatrix();
    camTransition = {
        t: 0,
        endMaxDistance: bounds.max,
        fromTarget: controls.target.clone(),
        fromCam: camera.position.clone(),
        fromUp: fromUp,
        toUp: _cameraWorldUp.clone(),
        planetStart: planetPos.clone(),
        toTargetBase: planetPos.clone(),
        toCamBase: planetPos.clone().add(dir.multiplyScalar(dist))
    };
    camTransition.duration = cinematicFocusDuration(camTransition.fromCam, camTransition.toCamBase);
}

function stopCameraMotion() {
    cameraKeys.clear();
    controls.autoRotate = false;
    camTransition = null;
    zoomDistTarget = null;
    const position = camera.position.clone(), quaternion = camera.quaternion.clone();
    const target = controls.target.clone(), damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    controls.target.copy(target);
    camera.updateMatrixWorld();
    toggleRotateBtn.classList.remove("active");
    distanceReadout?.noteInput();
}

function cancelZoomOnFocusChange() {
    zoomDistTarget = null;
}

function syncToNow() {
    simTimeMs = Date.now();
}

function onCanvasClick(event) {
    if (!solarAccuracy.available) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = (event.clientX - rect.left) / rect.width * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const allMeshes = [ ...planets.map(p => p.mesh), objectRegistry.sun, objectRegistry.moon, ...solarAccuracy.meshes, ...cometLayer.meshes, ...extraBodies.meshes ].filter(mesh => mesh && mesh.visible);
    const intersects = raycaster.intersectObjects(allMeshes, false);
    const hit = intersects[0]?.object || bodyGlowMarkers?.pick(event.clientX, event.clientY);
    if (!hit) return;
    if (hit === focusedObject && cameraFocusFollowEnabled) return;
    const key = hit.userData.planetKey || "sun";
    const facts = bodyFacts[key];
    if (!facts) return;
    focusOnObject(hit);
    showFocusCard(facts);
    syncBodySelect(key);
}

function refreshCameraDistance() {
    if (!distanceHudEl) return;
    const target = focusedObject;
    if (!target || target === solarSystem) {
        if (!distanceHudEl.hidden) distanceHudEl.hidden = true;
        return;
    }
    target.getWorldPosition(_distTmp);
    const dist = camera.position.distanceTo(_distTmp);
    const km = dist / AU_UNITS * KM_PER_AU;
    const text = km < 1e3 ? km.toFixed(0) + " km" : km < 1e6 ? Math.round(km).toLocaleString("en-US") + " km" : (km / KM_PER_AU).toFixed(3) + " AU";
    if (text !== _lastDistText) {
        _lastDistText = text;
        distanceHudEl.textContent = text;
    }
    if (distanceHudEl.hidden) distanceHudEl.hidden = false;
}

function focusOnSolarSystem() {
    cameraKeys.clear();
    const fromUp = camera.up.clone();
    cameraFocusFollowEnabled = true;
    rightOrbitActive = false;
    rightOrbitObject = null;
    if (focusedObject && focusedObject !== solarSystem && focusedObject.userData) {
        focusedObject.userData._prevPos = null;
    }
    focusedObject = solarSystem;
    landingState = null;
    rightOrbitActive = false;
    rightOrbitObject = null;
    equatorialGrid?.setFocused(null);
    updateSurfaceGridControl(null);
    distanceReadout?.noteInput();
    solarSystem.userData._prevPos = null;
    unfocusBtn.hidden = true;
    controls.autoRotate = false;
    resetCameraControlMomentum();
    cancelZoomOnFocusChange();
    _focusBounds = null;
    const rotateBtn = document.getElementById("toggle-rotate");
    if (rotateBtn) rotateBtn.classList.remove("active");
    controls.minDistance = .05;
    DEFAULT_CAM_POS.copy(systemOverviewPosition());
    controls.maxDistance = systemMaxDistance();
    camera.far = Math.max(12e5, controls.maxDistance * 2, SKY_RADIUS * 1.5);
    camera.updateProjectionMatrix();
    camTransition = {
        t: 0,
        endMaxDistance: systemMaxDistance(),
        fromTarget: controls.target.clone(),
        fromCam: camera.position.clone(),
        fromUp: fromUp,
        toUp: _cameraWorldUp.clone(),
        planetStart: solarSystem.getWorldPosition(new THREE.Vector3),
        toTargetBase: solarSystem.getWorldPosition(new THREE.Vector3),
        toCamBase: DEFAULT_CAM_POS.clone()
    };
    camTransition.duration = cinematicFocusDuration(camTransition.fromCam, camTransition.toCamBase);
}

function glideCameraDefaults() {
    controls.autoRotate = false;
    resetCameraControlMomentum();
    const fromUp = camera.up.clone();
    const toCam = systemOverviewPosition();
    const fromCam = camera.position.clone();
    const fromTarget = controls.target.clone();
    solarSystem.getWorldPosition(_cameraSystemCenter);
    controls.minDistance = .05;
    controls.maxDistance = Math.max(systemMaxDistance(), fromCam.distanceTo(_cameraSystemCenter), toCam.distanceTo(_cameraSystemCenter)) * 1.05;
    camera.near = 1;
    camera.far = Math.max(12e5, controls.maxDistance * 2, SKY_RADIUS * 1.5);
    camera.updateProjectionMatrix();
    DEFAULT_CAM_POS.copy(toCam);
    camTransition = {
        t: 0,
        endMaxDistance: systemMaxDistance(),
        fromTarget: fromTarget,
        fromCam: fromCam,
        fromUp: fromUp,
        toUp: _cameraWorldUp.clone(),
        planetStart: _cameraSystemCenter.clone(),
        toTargetBase: _cameraSystemCenter.clone(),
        toCamBase: toCam.clone()
    };
    camTransition.duration = cinematicFocusDuration(fromCam, camTransition.toCamBase);
}

function resetCamera() {
    focusOnSolarSystem();
    showFocusCard(bodyFacts.solarsystem);
    resetBodySelect();
}

function releaseFocus() {
    resetCamera();
}

function unfocusKeepCamera() {
    if (!focusedObject || focusedObject === solarSystem) return false;
    cameraKeys.clear();
    cameraFocusFollowEnabled = false;
    focusedObject.userData._prevPos = null;
    focusedObject = null;
    landingState = null;
    camera.up.copy(_cameraWorldUp);
    equatorialGrid?.setFocused(null);
    updateSurfaceGridControl(null);
    distanceReadout?.noteInput();
    camTransition = null;
    hideFocusCard();
    unfocusBtn.hidden = true;
    cancelZoomOnFocusChange();
    _focusBounds = null;
    resetBodySelect();
    // Keep the camera exactly where it is: a hard .05 floor threw it 500x away
    // from a comet the moment focus was released.
    const keep = camera.position.distanceTo(controls.target);
    controls.minDistance = Math.min(.05, Math.max(keep * .5, 1e-8));
    controls.maxDistance = systemMaxDistance();
    return true;
}

function _bodySurfaceHit(body, center, radial, pointOut, normalOut) {
    body.updateWorldMatrix(true, false);
    if (elevationCatalog?.surfaceHit(body.userData?.planetKey, body, center, radial, pointOut, normalOut)) return true;
    if (!body.geometry.boundingSphere) body.geometry.computeBoundingSphere();
    const radius = bodyWorldRadius(body);
    if (!(radius > 0)) return false;
    _cameraLandingRayOrigin.copy(center).addScaledVector(radial, radius * 2.25);
    _cameraLandingRayDirection.copy(radial).negate();
    _cameraLandingRaycaster.near = 0;
    _cameraLandingRaycaster.far = radius * 4.5;
    _cameraLandingRaycaster.set(_cameraLandingRayOrigin, _cameraLandingRayDirection);
    _cameraLandingHits.length = 0;
    _cameraLandingRaycaster.intersectObject(body, false, _cameraLandingHits);
    const hit = _cameraLandingHits[0];
    if (!hit) return false;
    pointOut.copy(hit.point);
    if (hit.face?.normal) {
        _cameraLandingNormalMatrix.getNormalMatrix(body.matrixWorld);
        normalOut.copy(hit.face.normal).applyMatrix3(_cameraLandingNormalMatrix).normalize();
        if (normalOut.dot(radial) < 0) normalOut.negate();
    } else {
        normalOut.copy(radial);
    }
    return true;
}

function _landingBoundingSpherePoint(body, center, radial, pointOut, normalOut) {
    if (!body?.geometry) return false;
    if (!body.geometry.boundingSphere) body.geometry.computeBoundingSphere();
    body.getWorldScale(_cameraLandingScale);
    const worldScale = Math.max(Math.abs(_cameraLandingScale.x), Math.abs(_cameraLandingScale.y), Math.abs(_cameraLandingScale.z), 1e-12);
    const radius = Math.max(bodyWorldRadius(body), (body.geometry.boundingSphere?.radius || 0) * worldScale);
    if (!(radius > 0)) return false;
    pointOut.copy(center).addScaledVector(radial, radius);
    normalOut.copy(radial);
    return true;
}

function _bodySurfaceHitWithFallback(body, center, radial, pointOut, normalOut) {
    if (!body?.geometry) return false;
    _cameraLandingRadial.copy(radial);
    if (_cameraLandingRadial.lengthSq() < 1e-18) _cameraLandingRadial.set(0, 0, 1);
    _cameraLandingRadial.normalize();
    if (_bodySurfaceHit(body, center, _cameraLandingRadial, pointOut, normalOut)) return true;
    if (_landingBoundingSpherePoint(body, center, _cameraLandingRadial, pointOut, normalOut)) return true;
    const radius = bodyWorldRadius(body);
    if (!(radius > 0)) return false;
    pointOut.copy(center).addScaledVector(_cameraLandingRadial, radius);
    normalOut.copy(_cameraLandingRadial);
    return true;
}

function _enforceLandingSurfaceClearance(body) {
    body.getWorldPosition(_cameraSurfaceCenter);
    _cameraLandingNormal.subVectors(camera.position, _cameraSurfaceCenter);
    if (_cameraLandingNormal.lengthSq() < 1e-18) {
        _cameraLandingNormal.copy(landingState?.localUp || _cameraWorldUp);
        if (landingState?.body === body) {
            body.getWorldQuaternion(_cameraLandingQuaternion);
            _cameraLandingNormal.applyQuaternion(_cameraLandingQuaternion);
        }
    }
    _cameraLandingNormal.normalize();
    if (!_bodySurfaceHitWithFallback(body, _cameraSurfaceCenter, _cameraLandingNormal, _cameraLandingHitPoint, _cameraLandingHitNormal)) return;
    const signedHeight = _cameraLandingScratch.subVectors(camera.position, _cameraLandingHitPoint).dot(_cameraLandingHitNormal);
    const landedHere = landingState?.body === body;
    const eyeHeight = cameraEyeHeightUnits(body);
    const clearance = landedHere ? Math.max(landingState.surfaceClearance || 0, eyeHeight) : eyeHeight;
    if (landedHere) {

        if (signedHeight < clearance) {
            _cameraLandingPush.copy(_cameraLandingHitNormal).multiplyScalar(clearance - signedHeight);
            camera.position.add(_cameraLandingPush);
            controls.target.add(_cameraLandingPush);
        }
        // Leaving the surface is handled in exactly one place now
        // (updateLandingPose, at SURFACE_RELEASE_RATIO). This correction only
        // keeps the camera from sinking into the ground.
        return;
    }
    if (signedHeight >= clearance) return;
    _cameraLandingPush.copy(_cameraLandingHitNormal).multiplyScalar(clearance - signedHeight);
    camera.position.add(_cameraLandingPush);
    controls.target.add(_cameraLandingPush);
    if (camTransition?.landing?.body === body) {
        camTransition.fromCam.add(_cameraLandingPush);
        camTransition.fromTarget.add(_cameraLandingPush);
        if (camTransition.followBodyRotation && camTransition.transitionBody === body) {
            body.getWorldQuaternion(_cameraLandingQuaternion).invert();
            _cameraLandingTargetOffset.copy(_cameraLandingPush).applyQuaternion(_cameraLandingQuaternion);
            camTransition.landing.fromCamLocal?.add(_cameraLandingTargetOffset);
            camTransition.landing.fromTargetLocal?.add(_cameraLandingTargetOffset);
            camTransition.toCamLocal.add(_cameraLandingTargetOffset);
            camTransition.toTargetLocal.add(_cameraLandingTargetOffset);
        } else {
            camTransition.toCamBase.add(_cameraLandingPush);
            camTransition.toTargetBase.add(_cameraLandingPush);
        }
    }
}

const _clipPrevPosition = new THREE.Vector3;
let _clipPrevValid = false;
const _clipSweepSegment = new THREE.Vector3;
const _clipSweepOrigin = new THREE.Vector3;
const _clipSweepEntry = new THREE.Vector3;
const _clipSweepShift = new THREE.Vector3;

function _sweepCameraSegment(center, expandedRadius) {
    if (!_clipPrevValid) return false;
    _clipSweepSegment.subVectors(camera.position, _clipPrevPosition);
    const a = _clipSweepSegment.lengthSq();
    if (a < 1e-24) return false;
    _clipSweepOrigin.copy(_clipPrevPosition).sub(center);
    const c = _clipSweepOrigin.lengthSq() - expandedRadius * expandedRadius;
    if (c <= 0) return false;
    const b = 2 * _clipSweepOrigin.dot(_clipSweepSegment);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return false;
    const t = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (t < 0 || t > 1) return false;
    _clipSweepEntry.copy(_clipPrevPosition).addScaledVector(_clipSweepSegment, t);
    _clipSweepShift.subVectors(_clipSweepEntry, camera.position);
    camera.position.copy(_clipSweepEntry);
    controls.target.add(_clipSweepShift);
    zoomDistTarget = null;
    return true;
}

function _checkBodyClearance(body, dt) {
    if (!body?.visible || !body.geometry || !body.geometry.parameters) return;
    if (body === landingState?.body || body === camTransition?.landing?.body) {
        _enforceLandingSurfaceClearance(body);
        return;
    }
    body.updateWorldMatrix(true, false);
    body.getWorldPosition(_collisionPos);
    const bodyRadius = bodyWorldRadius(body);

    const _stepPad = _clipPrevValid ? _clipSweepOrigin.subVectors(camera.position, _clipPrevPosition).length() * .001 : 0;
    _sweepCameraSegment(_collisionPos, bodyRadius + cameraEyeHeightUnits(body) * 1.5 + _stepPad);
    _collisionOffset.copy(camera.position).sub(_collisionPos);
    const distance = _collisionOffset.length();
    if (distance < 1e-12) return;
    if (distance > bodyRadius * 1.25) return;
    _collisionOffset.divideScalar(distance);
    if (_bodySurfaceHitWithFallback(body, _collisionPos, _collisionOffset, _cameraLandingHitPoint, _cameraLandingHitNormal)) {
        const signedHeight = _cameraLandingScratch.subVectors(camera.position, _cameraLandingHitPoint).dot(_cameraLandingHitNormal);
        const clearance = cameraEyeHeightUnits(body);
        if (signedHeight >= clearance) return;
        _cameraLandingPush.copy(_cameraLandingHitNormal).multiplyScalar(clearance - signedHeight);
        camera.position.add(_cameraLandingPush);
        controls.target.add(_cameraLandingPush);
        return;
    }
    const fallbackClearance = bodyRadius + cameraEyeHeightUnits(body);
    if (distance >= fallbackClearance) return;
    _cameraLandingPush.copy(_collisionOffset).multiplyScalar(fallbackClearance - distance);
    camera.position.add(_cameraLandingPush);
    controls.target.add(_cameraLandingPush);
}

function preventCameraClipping(dt) {
    const camPos = camera.position;
    const sunObj = objectRegistry["sun"];
    if (sunObj) {
        const sunRadius = sunObj.userData?.radius || sunObj.geometry?.parameters?.radius || 0;
        const margin = 1.02;
        const sunMin = sunRadius * margin;
        sunObj.getWorldPosition(_collisionPos);
        _sweepCameraSegment(_collisionPos, sunMin);
        _collisionOffset.subVectors(camPos, _collisionPos);
        const sunDist = _collisionOffset.length();
        if (sunDist < sunMin) {
            if (sunDist < 1e-6) {
                _cameraOffset.set(0, 0, sunMin);
                camPos.copy(_collisionPos).add(_cameraOffset);
            } else {
                camPos.copy(_collisionPos).addScaledVector(_collisionOffset, sunMin / sunDist);
            }
            zoomDistTarget = null;
        }
    }
    for (let i = 0; i < planets.length; i++) {
        _checkBodyClearance(planets[i].mesh, dt);
    }
    for (const body of solarAccuracy.meshes) _checkBodyClearance(body, dt);
    for (const body of extraBodies.meshes) if (body.visible) _checkBodyClearance(body, dt);
    if (objectRegistry["moon"]) {
        _checkBodyClearance(objectRegistry["moon"], dt);
    }
    _clipPrevPosition.copy(camera.position);
    _clipPrevValid = true;
}

function updateSurfaceGridControl(key) {
    if (!surfaceGridBtn) return;
    const enabled = !!key && !!equatorialGrid?.supports(key) && equatorialGrid.isEnabled(key);
    const supported = !!key && !!equatorialGrid?.supports(key) && !!objectRegistry[key];
    surfaceGridBtn.disabled = !supported;
    surfaceGridBtn.classList.toggle("active", enabled);
    surfaceGridBtn.setAttribute("aria-pressed", String(enabled));
    surfaceGridBtn.title = supported ? `Toggle the ${bodyFacts[key]?.name || key} equatorial surface grid.` : "Focus a supported planet or the Moon to use its surface grid.";
}

// Any solid body can be landed on: planets, moons and comet nuclei alike. A body
// qualifies if it is in the registry under its own key and has a radius; the sun has no surface.
function isLandableBody(body) {
    if (!body || !body.visible) return false;
    const key = body?.userData?.planetKey;
    if (!key || key === "sun") return false;
    if (objectRegistry[key] !== body) return false;
    // Population anchors are invisible stand-ins for asteroid groups, not surfaces.
    if (body.userData?.isPopulationAnchor) return false;
    return (body.geometry?.parameters?.radius || body.userData?.focusRadius || 0) > 0;
}

function bodyWorldRadius(body) {
    body.getWorldScale(_cameraLandingScale);
    const radius = body.geometry?.parameters?.radius || body.userData?.focusRadius || 1;
    return radius * Math.max(Math.abs(_cameraLandingScale.x), Math.abs(_cameraLandingScale.y), Math.abs(_cameraLandingScale.z), 1e-12);
}

function cameraEyeHeightUnits(body) {
    const physicalHeight = km2u(.0017);
    if (!body) return Math.max(physicalHeight, 1e-12);
    body.getWorldScale(_cameraLandingScale);
    const worldScale = Math.max(Math.abs(_cameraLandingScale.x), Math.abs(_cameraLandingScale.y), Math.abs(_cameraLandingScale.z), 1e-12);
    return Math.max(physicalHeight * worldScale, bodyWorldRadius(body) * 2e-7, 1e-12);
}

const CAMERA_MIN_POLAR_ANGLE = 0;

const CAMERA_MAX_POLAR_ANGLE = Math.PI;

function relaxControlsPolarLimits() {
    if (controls.minPolarAngle === 0 && controls.maxPolarAngle === Math.PI) return;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
}

function restoreControlsPolarLimits() {

    if (landingState || camTransition?.followBodyRotation) return;
    if (controls.minPolarAngle === CAMERA_MIN_POLAR_ANGLE && controls.maxPolarAngle === CAMERA_MAX_POLAR_ANGLE) return;
    controls.minPolarAngle = CAMERA_MIN_POLAR_ANGLE;
    controls.maxPolarAngle = CAMERA_MAX_POLAR_ANGLE;
}

function setLandingState(body, upWorld) {
    if (!body || !body.visible) return false;
    body.updateWorldMatrix(true, false);
    body.getWorldPosition(_cameraSurfaceCenter);
    _cameraLandingNormal.subVectors(camera.position, _cameraSurfaceCenter);
    if (_cameraLandingNormal.lengthSq() < 1e-18) _cameraLandingNormal.copy(upWorld);
    _cameraLandingNormal.normalize();
    if (!_bodySurfaceHitWithFallback(body, _cameraSurfaceCenter, _cameraLandingNormal, _cameraLandingHitPoint, _cameraLandingHitNormal)) return false;
    const clearance = cameraEyeHeightUnits(body);
    _cameraLandingPoint.copy(_cameraLandingHitPoint).addScaledVector(_cameraLandingHitNormal, clearance);

    const signedHeight = _cameraLandingScratch.subVectors(camera.position, _cameraLandingHitPoint).dot(_cameraLandingHitNormal);
    // The flight ends exactly at eye height, so there is nothing left to
    // animate. A post-arrival "settle" was a second, independent motion the
    // user saw as a stage after the landing; it is gone.
    if (signedHeight < clearance) {
        _cameraLandingPush.copy(_cameraLandingHitNormal).multiplyScalar(clearance - signedHeight);
        camera.position.add(_cameraLandingPush);
        controls.target.add(_cameraLandingPush);
    }
    upWorld.copy(_cameraLandingHitNormal);
    body.worldToLocal(_cameraLandingPosition.copy(camera.position));
    body.worldToLocal(_cameraLandingStoredTarget.copy(controls.target));
    body.getWorldQuaternion(_cameraLandingQuaternion).invert();
    const upLocal = upWorld.clone().applyQuaternion(_cameraLandingQuaternion).normalize();
    const surfaceNormalLocal = upWorld.clone().applyQuaternion(_cameraLandingQuaternion).normalize();
    landingState = {
        body: body,
        settle: null,
        localPosition: _cameraLandingPosition.clone(),
        localTarget: _cameraLandingStoredTarget.clone(),
        localUp: upLocal,
        surfaceNormalLocal: surfaceNormalLocal,
        surfaceClearance: clearance,
        clearanceTarget: null,
        clearanceAt: 0,
        previousBodyPosition: _cameraSurfaceCenter.clone()
    };
    camera.up.copy(upWorld).normalize();
    controls.minDistance = 1e-8;
    controls.maxDistance = systemMaxDistance();
    relaxControlsPolarLimits();
    return true;
}

function updateLandingPose() {
    if (!landingState) return;
    const body = landingState.body;
    if (!body?.visible) {
        landingState = null;
        camera.up.copy(_cameraWorldUp);
        return;
    }

    body.getWorldPosition(_cameraSurfaceCenter);
    const previous = landingState.previousBodyPosition || (landingState.previousBodyPosition = _cameraSurfaceCenter.clone());
    _cameraLandingPush.subVectors(_cameraSurfaceCenter, previous);
    if (_cameraLandingPush.lengthSq() > 0) {
        camera.position.add(_cameraLandingPush);
        controls.target.add(_cameraLandingPush);
    }
    previous.copy(_cameraSurfaceCenter);

    // Altitude control. The wheel (and the zoom keys) write surfaceClearance;
    // this is the one place that turns it into a camera position, so the
    // ground-level camera can climb and descend instead of being pinned.
    const radius = bodyWorldRadius(body);
    const eye = cameraEyeHeightUnits(body);
    // Climb and descend glide: the wheel writes a target, this eases toward it, so
    // a fast flick cannot teleport the camera up or down the atmosphere.
    if (landingState.clearanceTarget != null) {
        const now = performance.now();
        const step = Math.min(.25, Math.max(0, (now - (landingState.clearanceAt || now)) / 1000));
        landingState.clearanceAt = now;
        const current = Math.max(eye, landingState.surfaceClearance || eye);
        const target = Math.max(eye, landingState.clearanceTarget);
        const eased = current + (target - current) * (1 - Math.exp(-LANDING_CLEARANCE_RATE * step));
        landingState.surfaceClearance = Math.abs(target - eased) < target * 1e-4 ? target : eased;
        if (landingState.surfaceClearance === target) landingState.clearanceTarget = null;
    }
    const clearance = Math.max(eye, landingState.surfaceClearance || eye);
    _cameraLandingNormal.subVectors(camera.position, _cameraSurfaceCenter);
    if (_cameraLandingNormal.lengthSq() > 1e-18) {
        _cameraLandingNormal.normalize();
        if (_bodySurfaceHitWithFallback(body, _cameraSurfaceCenter, _cameraLandingNormal, _cameraLandingHitPoint, _cameraLandingHitNormal)) {
            _cameraLandingPoint.copy(_cameraLandingHitPoint).addScaledVector(_cameraLandingHitNormal, clearance);
            _cameraLandingScratch.subVectors(_cameraLandingPoint, camera.position);
            camera.position.add(_cameraLandingScratch);
            controls.target.add(_cameraLandingScratch);
        }
    }
    // Zooming out far enough hands the camera back to normal orbiting. No
    // Escape, no mode switch: the position is continuous, so it just flies.
    if (clearance >= radius * SURFACE_RELEASE_RATIO) {
        landingState = null;
        detachCameraFromFocus();
        restoreControlsPolarLimits();
    }
}

function captureLandingPose() {

    return;
}

function landOnFocusedPlanet(options = {}) {
    cameraKeys.clear();
    const automatic = options === true || options?.automatic === true;
    _autoLandingIntentAt = 0;
    let body = isLandableBody(focusedObject) ? focusedObject : null;
    if (!body && isLandableBody(lastFocusedObject)) body = lastFocusedObject;

    if (!body) body = nearbyLandableBody(2.5);
    if (!body || !solarAccuracy.available) return false;
    if (body !== focusedObject) focusOnObject(body);
    if (landingState?.body === body || camTransition?.landing?.body === body) return true;
    controls.autoRotate = false;
    resetCameraControlMomentum();
    const fromUp = camera.up.clone();
    cameraFocusFollowEnabled = true;
    body.getWorldPosition(_cameraSurfaceCenter);
    _cameraLandingNormal.subVectors(camera.position, _cameraSurfaceCenter);
    if (_cameraLandingNormal.lengthSq() < 1e-18) {
        camera.getWorldDirection(_cameraForward);
        _cameraLandingNormal.copy(_cameraForward).negate();
    }
    _cameraLandingNormal.normalize();
    const radius = bodyWorldRadius(body);
    if (!_bodySurfaceHitWithFallback(body, _cameraSurfaceCenter, _cameraLandingNormal, _cameraLandingPoint, _cameraLandingHitNormal)) return false;
    _cameraLandingNormal.copy(_cameraLandingHitNormal);
    _cameraLandingPoint.addScaledVector(_cameraLandingNormal, cameraEyeHeightUnits(body));
    camera.updateMatrixWorld(true);
    camera.getWorldDirection(_cameraForward);
    _cameraLandingTangent.copy(_cameraForward).addScaledVector(_cameraLandingNormal, -_cameraForward.dot(_cameraLandingNormal));
    if (_cameraLandingTangent.lengthSq() < 1e-10) {
        _cameraLandingTangent.copy(_cameraWorldUp).addScaledVector(_cameraLandingNormal, -_cameraWorldUp.dot(_cameraLandingNormal));
    }
    if (_cameraLandingTangent.lengthSq() < 1e-10) {
        _cameraLandingTangent.set(1, 0, 0).addScaledVector(_cameraLandingNormal, -_cameraLandingNormal.x);
    }
    _cameraLandingTangent.normalize();
    const lookDistance = Math.max(km2u(1), radius * 1e-7);
    _cameraLandingTarget.copy(_cameraLandingPoint).addScaledVector(_cameraLandingTangent, lookDistance);
    const fromCam = camera.position.clone();
    const fromTarget = controls.target.clone();
    const bodyCenter = _cameraSurfaceCenter.clone();
    const upWorld = _cameraLandingNormal.clone();
    const bodyQuaternionStart = body.getWorldQuaternion(new THREE.Quaternion);
    const bodyQuaternionInverse = bodyQuaternionStart.clone().invert();
    const toTargetLocal = _cameraLandingTarget.clone().sub(bodyCenter).applyQuaternion(bodyQuaternionInverse);
    const toCamLocal = _cameraLandingPoint.clone().sub(bodyCenter).applyQuaternion(bodyQuaternionInverse);
    const fromTargetLocal = fromTarget.clone().sub(bodyCenter).applyQuaternion(bodyQuaternionInverse);
    const fromCamLocal = fromCam.clone().sub(bodyCenter).applyQuaternion(bodyQuaternionInverse);
    const finalOffsetLength = Math.max(1e-12, toCamLocal.distanceTo(toTargetLocal));
    const startOffsetLength = Math.max(finalOffsetLength, fromCamLocal.distanceTo(fromTargetLocal));
    const approachDistance = Math.min(startOffsetLength, Math.max(finalOffsetLength * 1.25, finalOffsetLength + Math.max(radius * .008, km2u(25))));
    const terrainPreparationRequired = !!elevationCatalog && [ "mercury", "venus", "earth", "mars", "moon" ].includes(body.userData?.planetKey);
    const upLocal = upWorld.clone().applyQuaternion(bodyQuaternionInverse).normalize();
    controls.autoRotate = false;
    if (toggleRotateBtn) toggleRotateBtn.classList.remove("active");
    controls.minDistance = 1e-8;
    controls.maxDistance = systemMaxDistance();
    zoomDistTarget = null;
    camera.near = Math.max(1e-12, km2u(5e-4), radius * 1e-9);
    camera.updateProjectionMatrix();
    camTransition = {
        t: 0,
        duration: automatic ? 4.2 : Math.max(4, cinematicFocusDuration(fromCam, _cameraLandingPoint) + 1.1),
        endMaxDistance: systemMaxDistance(),
        fromTarget: fromTarget,
        fromCam: fromCam,
        fromUp: fromUp,
        toUp: upWorld.clone(),
        toUpLocal: upLocal.clone(),
        // One straight line from where the camera is to the landing point:
        // no arc bow, no mid-flight ease change.
        straight: true,
        followBodyRotation: true,
        transitionBody: body,
        toTargetLocal: toTargetLocal,
        toCamLocal: toCamLocal,
        planetStart: bodyCenter,
        toTargetBase: _cameraLandingTarget.clone(),
        toCamBase: _cameraLandingPoint.clone(),
        landing: {
            body: body,
            normal: upWorld,
            normalLocal: upLocal,
            lookDistance: lookDistance,
            fromCamLocal: fromCamLocal,
            fromTargetLocal: fromTargetLocal,
            approachDistance: approachDistance,
            approachSplit: APPROACH_SPLIT,
            terrainReady: !terrainPreparationRequired
        }
    };
    const activeTransition = camTransition;
    if (!activeTransition.landing.terrainReady && elevationCatalog?.prepareSurfaceDetail) {
        elevationCatalog.prepareSurfaceDetail(body.userData.planetKey).then(() => {
            if (camTransition === activeTransition) activeTransition.landing.terrainReady = true;
        }).catch(() => {
            if (camTransition === activeTransition) activeTransition.landing.terrainReady = true;
        });
    }
    distanceReadout?.noteInput();
    return true;
}

function nearbyLandableBody(maxRatio = 1.6) {

    let best = null, bestGap = Infinity;
    for (const candidate of Object.values(objectRegistry)) {
        if (!isLandableBody(candidate)) continue;
        candidate.getWorldPosition(_cameraSurfaceCenter);
        const radius = Math.max(bodyWorldRadius(candidate), 1e-9);
        const gap = camera.position.distanceTo(_cameraSurfaceCenter) / radius;
        if (gap <= maxRatio && gap < bestGap) {
            bestGap = gap;
            best = candidate;
        }
    }
    return best;
}

function leavePlanetLanding() {
    cameraKeys.clear();
    _autoLandingIntentAt = 0;
    if (camTransition?.landing && !landingState) {
        camTransition = null;
        detachCameraFromFocus();
        controls.update();
        return true;
    }
    const body = landingState?.body || nearbyLandableBody();
    if (!body) return false;

    endRightOrbit();
    const fromUp = camera.up.clone();
    landingState = null;
    if (!body?.visible) return true;
    controls.autoRotate = false;
    resetCameraControlMomentum();
    cameraFocusFollowEnabled = true;
    body.getWorldPosition(_cameraSurfaceCenter);
    _cameraLandingNormal.subVectors(camera.position, _cameraSurfaceCenter);
    if (_cameraLandingNormal.lengthSq() < 1e-18) _cameraLandingNormal.set(0, 0, 1);
    _cameraLandingNormal.normalize();
    const radius = bodyWorldRadius(body);
    const fromCam = camera.position.clone();
    const fromTarget = controls.target.clone();
    const toTarget = _cameraSurfaceCenter.clone();
    const toCam = _cameraSurfaceCenter.clone().addScaledVector(_cameraLandingNormal, Math.max(radius * 5.5, radius + 1e-5));
    const bodyQuaternionStart = body.getWorldQuaternion(new THREE.Quaternion);
    const bodyQuaternionInverse = bodyQuaternionStart.clone().invert();
    const toTargetLocal = toTarget.clone().sub(_cameraSurfaceCenter).applyQuaternion(bodyQuaternionInverse);
    const toCamLocal = toCam.clone().sub(_cameraSurfaceCenter).applyQuaternion(bodyQuaternionInverse);

    const fromCamLocal = fromCam.clone().sub(_cameraSurfaceCenter).applyQuaternion(bodyQuaternionInverse);
    const fromTargetLocal = fromTarget.clone().sub(_cameraSurfaceCenter).applyQuaternion(bodyQuaternionInverse);
    // frame-loop reads toUpLocal for every body-locked transition; this path
    // never set it, so _ctUpNow.copy(undefined) threw once per frame for the
    // whole flight and left the landing half-applied.
    const toUpLocal = _cameraLandingNormal.clone().applyQuaternion(bodyQuaternionInverse);
    controls.minDistance = 1e-8;
    controls.maxDistance = systemMaxDistance();
    zoomDistTarget = null;
    camTransition = {
        t: 0,
        duration: Math.max(3.4, cinematicFocusDuration(fromCam, toCam)),
        endMaxDistance: systemMaxDistance(),
        restoreWorldUp: true,
        straight: true,
        fromTarget: fromTarget,
        fromCam: fromCam,
        fromUp: fromUp,
        toUp: _cameraWorldUp.clone(),
        followBodyRotation: true,
        transitionBody: body,
        toUpLocal: toUpLocal,
        toTargetLocal: toTargetLocal,
        toCamLocal: toCamLocal,
        fromCamLocal: fromCamLocal,
        fromTargetLocal: fromTargetLocal,
        planetStart: _cameraSurfaceCenter.clone(),
        toTargetBase: toTarget,
        toCamBase: toCam
    };
    distanceReadout?.noteInput();
    return true;
}

function updateCameraOrbitTarget() {
    if (!rightOrbitActive || !rightOrbitObject) return;
    // While landed the target is the walking aim point, not the body centre.
    if (landingState) return;
    if (!rightOrbitObject.visible) {
        rightOrbitObject = null;
        return;
    }
    rightOrbitObject.getWorldPosition(controls.target);
}

function beginRightOrbit() {
    if (_cameraLookDrag) return;
    _autoLandingIntentAt = 0;

    cameraKeys.clear();
    controls.autoRotate = false;
    if (toggleRotateBtn) toggleRotateBtn.classList.remove("active");
    camTransition = null;
    zoomDistTarget = null;

    controls.maxDistance = Math.max(controls.maxDistance, systemMaxDistance());
    rightOrbitObject = null;
    camera.updateMatrixWorld(true);
    camera.getWorldDirection(_cameraForward);
    _cameraLandingScratch.subVectors(controls.target, camera.position);
    if (_cameraLandingScratch.dot(_cameraForward) <= 1e-10) {
        controls.target.copy(camera.position).addScaledVector(_cameraForward, Math.max(_cameraLandingScratch.length(), .001));
    }

    const orbitCandidate = focusedObject?.visible ? focusedObject : null;
    if (orbitCandidate && orbitCandidate !== solarSystem) {
        orbitCandidate.getWorldPosition(_cameraSurfaceCenter);
        const tolerance = Math.max(bodyWorldRadius(orbitCandidate) * .001, 1e-8);
        if (controls.target.distanceTo(_cameraSurfaceCenter) <= tolerance) {
            rightOrbitObject = orbitCandidate;
        }
    }
    rightOrbitActive = true;
    const orbitDistance = camera.position.distanceTo(controls.target);
    freeAimDistance = THREE.MathUtils.clamp(Number.isFinite(orbitDistance) ? orbitDistance : 36, 1e-8, systemMaxDistance());
    distanceReadout?.noteInput();
}

function endRightOrbit() {
    if (!rightOrbitActive) return;
    rightOrbitActive = false;
    rightOrbitObject = null;
    camera.updateMatrixWorld(true);
    freeAimDistance = Math.max(1e-8, camera.position.distanceTo(controls.target));
    distanceReadout?.noteInput();
}

function beginManualCameraMotion(releaseFocus = false) {
    _autoLandingIntentAt = 0;
    if (landingState?.settle) landingState.settle = null;

    const landingInProgress = !!camTransition?.landing && !landingState;
    if (!landingInProgress) {

        if (releaseFocus) releaseFocusForManualMotion(); else detachCameraFromFocus();
        camTransition = null;
    }
    controls.autoRotate = false;
    resetCameraControlMomentum();
    if (toggleRotateBtn) toggleRotateBtn.classList.remove("active");
    if (rightOrbitActive) endRightOrbit();
    zoomDistTarget = null;
    distanceReadout?.noteInput();
}

function wireCameraInput() {
    if (_cameraInputInstalled) return;
    _cameraInputInstalled = true;
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", event => {
        if (event.pointerType !== "mouse" || event.button !== 0) {
            if (event.pointerType === "mouse" && event.button === 2) {
                _cameraRightPointer = event.pointerId;
                beginRightOrbit();
                _cameraRightDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
            } else if (event.pointerType !== "mouse") {
                releaseFocusForManualMotion();
            }
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        beginManualCameraMotion();
        camera.updateMatrixWorld(true);
        const aimDistance = camera.position.distanceTo(controls.target);
        freeAimDistance = THREE.MathUtils.clamp(Number.isFinite(aimDistance) ? aimDistance : 36, 1e-8, systemMaxDistance());
        // The target is re-based on the first real movement, not here: re-aiming
        // on a plain click moved the orbit centre and nudged the view forward
        // every time the user clicked near a comet.
        _cameraLookDrag = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            startX: event.clientX,
            startY: event.clientY,
            moved: false
        };
        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (_) {}
    }, true);
    document.addEventListener("pointermove", event => {
        if (_cameraRightDrag && _cameraRightDrag.id === event.pointerId) {
            const dragX = event.clientX - _cameraRightDrag.x;
            const dragY = event.clientY - _cameraRightDrag.y;
            _cameraRightDrag.x = event.clientX;
            _cameraRightDrag.y = event.clientY;
            if (!_cameraRightDrag.moved && (dragX || dragY)) {
                _cameraRightDrag.moved = true;
                if (releaseFocusForManualMotion()) rightOrbitObject = null;
            }
            if (dragX || dragY) _orbitCameraByDrag(dragX, dragY);
            event.preventDefault();
        }
        if (!_cameraLookDrag || event.pointerId !== _cameraLookDrag.id) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const drag = _cameraLookDrag;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if ((event.clientX - drag.startX) ** 2 + (event.clientY - drag.startY) ** 2 > 36) {
            if (!drag.moved) releaseFocusForManualMotion();
            drag.moved = true;
        }
        if (!dx && !dy) return;
        camera.updateMatrixWorld(true);
        camera.getWorldDirection(_cameraForward);
        if (!drag.freeAim) {
            drag.freeAim = true;
            controls.target.copy(camera.position).addScaledVector(_cameraForward, freeAimDistance);
        }
        _cameraUp.copy(camera.up).normalize();
        _cameraForward.applyAxisAngle(_cameraUp, -dx * .0032).normalize();
        const pitch = Math.asin(THREE.MathUtils.clamp(_cameraForward.dot(_cameraUp), -1, 1));
        const targetPitch = THREE.MathUtils.clamp(pitch - dy * .0032, -Math.PI * .495, Math.PI * .495);
        _cameraRight.crossVectors(_cameraForward, _cameraUp);
        if (_cameraRight.lengthSq() < 1e-10) _cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
        _cameraRight.normalize();
        _cameraForward.applyAxisAngle(_cameraRight, targetPitch - pitch).normalize();
        controls.target.copy(camera.position).addScaledVector(_cameraForward, freeAimDistance);
        distanceReadout?.noteInput();
    }, true);
    document.addEventListener("pointerup", event => {
        if (_cameraLookDrag && event.pointerId === _cameraLookDrag.id) {
            event.preventDefault();
            event.stopImmediatePropagation();
            const drag = _cameraLookDrag;
            _cameraLookDrag = null;
            try {
                canvas.releasePointerCapture(event.pointerId);
            } catch (_) {}
            if (!drag.moved) onCanvasClick(event);
            return;
        }
        if (_cameraRightPointer === event.pointerId) {
            _cameraRightPointer = null;
            _cameraRightDrag = null;
            setTimeout(endRightOrbit, 0);
        }
    }, true);
    document.addEventListener("pointercancel", event => {
        if (_cameraLookDrag?.id === event.pointerId) _cameraLookDrag = null;
        if (_cameraRightPointer === event.pointerId) {
            _cameraRightPointer = null;
            _cameraRightDrag = null;
            endRightOrbit();
        }
    }, true);
    window.addEventListener("blur", () => {
        cameraKeys.clear();
        if (_cameraLookDrag) _cameraLookDrag = null;
        _cameraRightPointer = null;
        _cameraRightDrag = null;
        endRightOrbit();
    });
}

function updateElevationSurfaceDetail() {
    if (!elevationCatalog) return;
    let inSurfaceRenderRange = false;
    for (const key of [ "mercury", "venus", "earth", "mars", "moon" ]) {
        const body = objectRegistry[key];
        if (!body || !body.visible) {
            elevationCatalog.setSurfaceDetail(key, false);
            continue;
        }
        body.getWorldPosition(_cameraSurfaceCenter);
        const radius = Math.max(bodyWorldRadius(body), 1e-9);
        const ratio = camera.position.distanceTo(_cameraSurfaceCenter) / radius;
        const landingTransition = camTransition?.landing?.body === body && landingState?.body !== body;
        const pinned = landingState?.body === body;
        const profile = PLANET_ATMOSPHERE_PROFILES?.[key];
        const radiusKm = BodyShapes.maxRadiusKm(key) || 0;
        const atmosphereTopKm = profile?.derived?.renderTopKm ?? profile?.derived?.topKm ?? 0;
        const altitudeKm = Math.max(0, ratio - 1) * radiusKm;
        const surfaceCutoffKm = atmosphereTopKm > 0
            ? atmosphereTopKm * (_surfacePerformanceMode ? 2.6 : 1.7)
            : radiusKm * (_surfacePerformanceMode ? .04 : .02);
        if (pinned || altitudeKm <= surfaceCutoffKm) inSurfaceRenderRange = true;
        if (elevationCatalog.hasMap(key) && !elevationCatalog.hasPreparedSurfaceDetail(key) && ratio < 1.32) {
            elevationCatalog.prepareSurfaceDetail(key).catch(() => {});
        }
        if (landingTransition) {
            const preparedForFinalApproach = camTransition.landing.terrainReady
                && camTransition.t / camTransition.duration >= camTransition.landing.approachSplit - .015;
            elevationCatalog.setSurfaceDetail(key, preparedForFinalApproach);
            continue;
        }
        const detailWasActive = !!body.userData?.elevationDetailActive;
        const active = pinned || ratio < (detailWasActive ? SURFACE_DETAIL_EXIT_RATIO : SURFACE_DETAIL_ENTER_RATIO);
        elevationCatalog.setSurfaceDetail(key, active);
    }
    setSurfacePerformanceMode(inSurfaceRenderRange);
}

// How fast the camera is allowed to move around the focused body, relative to
// Earth. Big bodies get bigger steps, small moons much smaller ones: at the same
// zoom a wheel notch over Phoebe should not throw the camera off the rock.
// The exponent keeps the range usable - radius spans five orders of magnitude.
function bodySizeSpeedScale(body = focusedObject) {
    const radius = body && body !== solarSystem ? bodyWorldRadius(body) : 0;
    const earth = objectRegistry?.earth ? bodyWorldRadius(objectRegistry.earth) : 0;
    if (!(radius > 0) || !(earth > 0)) return 1;
    return THREE.MathUtils.clamp(Math.pow(radius / earth, .35), .35, 1.8);
}

function cameraFocusSpeedScale() {
    return bodySizeSpeedScale();
}

const _atmoTrackPosition = new THREE.Vector3;
const _atmoTrackScale = new THREE.Vector3;
let atmosphereTrackKey = null;

function cameraAtmosphereSpeedFactor() {
    atmosphereTrackKey = null;
    let factor = 1;
    if (typeof PLANET_ATMOSPHERE_PROFILES === "undefined" || typeof cloudMeshes === "undefined") return 1;
    for (const key in PLANET_ATMOSPHERE_PROFILES) {
        const shell = cloudMeshes[key + "_atmosphere"];
        const body = objectRegistry[key];
        if (!shell || !body?.geometry?.parameters) continue;
        body.getWorldPosition(_atmoTrackPosition);
        const bodyR = bodyWorldRadius(body);
        body.getWorldScale(_atmoTrackScale);
        const worldScale = Math.max(Math.abs(_atmoTrackScale.x), Math.abs(_atmoTrackScale.y), Math.abs(_atmoTrackScale.z), 1e-12);
        const shellR = (shell.geometry?.parameters?.radius || body.geometry.parameters.radius) * worldScale;
        if (!(shellR > bodyR)) continue;
        const distance = camera.position.distanceTo(_atmoTrackPosition);
        if (distance >= shellR || distance <= bodyR * .5) continue;
        const depth = THREE.MathUtils.clamp((distance - bodyR) / (shellR - bodyR), 0, 1);
        // Squared ramp: keeps the old feel high up, drops to 6% at the surface so a
        // drag turns the view instead of throwing it over the horizon.
        const bodyFactor = .06 + .94 * depth * depth;
        if (bodyFactor < factor) {
            factor = bodyFactor;
            atmosphereTrackKey = key;
        }
    }
    return factor;
}

globalThis.cameraAtmosphereSpeedFactor = cameraAtmosphereSpeedFactor;
globalThis.cameraAtmosphereKey = () => atmosphereTrackKey;

const _navBodyCenter = new THREE.Vector3;

// The step a key press should take right now. Close to a body the tuned orbital
// speed is meaningless - on a 1.7 km nucleus it crosses the whole rock in a few
// microseconds - so the local ceiling follows the body's radius and the camera's
// height above it. Far away it returns Infinity and the old speed stands.
function cameraLocalSpeedCeiling(body = focusedObject) {
    if (!body || body === solarSystem) return Infinity;
    const radius = bodyWorldRadius(body);
    if (!(radius > 0)) return Infinity;
    body.getWorldPosition(_navBodyCenter);
    const altitude = Math.max(0, camera.position.distanceTo(_navBodyCenter) - radius);
    if (altitude > radius * 60) return Infinity;
    const surface = Math.min(km2u(CAMERA_NEAR_BODY_SPEED_MPS / 1000), radius * CAMERA_SURFACE_SPEED_RADII);
    return Math.max(surface, altitude * CAMERA_ALTITUDE_SPEED_RATE);
}

function cameraNavigationSpeed(body = focusedObject) {
    return Math.min(CAMERA_MOVE_MAX_SPEED * bodySizeSpeedScale(body), cameraLocalSpeedCeiling(body));
}

function noteAutomaticLandingIntent() {
    _autoLandingIntentAt = performance.now();
}

function maybeAutoLandOnFocusedPlanet() {
    if (!_autoLandingIntentAt) return false;
    const now = performance.now();
    if (now - _autoLandingIntentAt > AUTO_LANDING_INTENT_WINDOW_MS) {
        _autoLandingIntentAt = 0;
        return false;
    }
    if (landingState || camTransition || rightOrbitActive || !solarAccuracy.available) return false;
    const body = focusedObject;
    if (!isLandableBody(body)) return false;
    body.getWorldPosition(_cameraSurfaceCenter);
    const radius = Math.max(bodyWorldRadius(body), 1e-9);
    const gap = Math.max(0, camera.position.distanceTo(_cameraSurfaceCenter) - radius);
    if (gap / radius > AUTO_LANDING_DISTANCE_RATIO) return false;
    return landOnFocusedPlanet({ automatic: true });
}

globalThis.maybeAutoLandOnFocusedPlanet = maybeAutoLandOnFocusedPlanet;

function _walkLandedSurface(body, movement) {
    if (!body?.visible || landingState?.body !== body) return false;
    body.getWorldPosition(_cameraSurfaceCenter);
    _cameraLandingNormal.subVectors(camera.position, _cameraSurfaceCenter);
    if (_cameraLandingNormal.lengthSq() < 1e-18) return false;
    _cameraLandingNormal.normalize();
    if (!_bodySurfaceHitWithFallback(body, _cameraSurfaceCenter, _cameraLandingNormal, _cameraLandingHitPoint, _cameraLandingHitNormal)) return false;
    _cameraLandingSurfaceNormal.copy(_cameraLandingHitNormal);
    camera.position.add(movement);
    controls.target.add(movement);
    _cameraLandingNormal.subVectors(camera.position, _cameraSurfaceCenter);
    if (_cameraLandingNormal.lengthSq() < 1e-18) {
        camera.position.sub(movement);
        controls.target.sub(movement);
        return false;
    }
    _cameraLandingNormal.normalize();
    if (!_bodySurfaceHitWithFallback(body, _cameraSurfaceCenter, _cameraLandingNormal, _cameraLandingPoint, _cameraLandingHitNormal)) {
        camera.position.sub(movement);
        controls.target.sub(movement);
        return false;
    }
    const eyeHeight = cameraEyeHeightUnits(body);
    const clearance = Math.max(landingState.surfaceClearance || 0, eyeHeight);
    _cameraLandingNormalRotation.setFromUnitVectors(_cameraLandingSurfaceNormal, _cameraLandingHitNormal);
    _cameraLandingTargetOffset.subVectors(controls.target, camera.position).applyQuaternion(_cameraLandingNormalRotation);
    camera.up.applyQuaternion(_cameraLandingNormalRotation).normalize();
    camera.position.copy(_cameraLandingPoint).addScaledVector(_cameraLandingHitNormal, clearance);
    controls.target.copy(camera.position).add(_cameraLandingTargetOffset);
    body.getWorldQuaternion(_cameraLandingQuaternion).invert();
    landingState.surfaceNormalLocal.copy(_cameraLandingHitNormal).applyQuaternion(_cameraLandingQuaternion).normalize();
    landingState.surfaceClearance = clearance;
    return true;
}

function updateCameraNavigation(dt) {
    if (!cameraKeys.size || !(dt > 0)) return;
    if (landingState?.settle) landingState.settle = null;
    if (camTransition?.landing && !landingState) return;
    camera.updateMatrixWorld(true);
    camera.getWorldDirection(_cameraForward);
    _cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const strafe = (cameraKeys.has("d") ? 1 : 0) - (cameraKeys.has("a") ? 1 : 0);
    const dolly = (cameraKeys.has("w") ? 1 : 0) - (cameraKeys.has("s") ? 1 : 0);
    const atmosphereFactor = cameraAtmosphereSpeedFactor();
    const sizeFactor = bodySizeSpeedScale();
    const speedCeiling = cameraLocalSpeedCeiling();
    if (dolly) {
        zoomDistTarget = null;
        const moveSpeed = Math.min(speedCeiling, Math.max(
            cameraNavigationSpeed(),
            camera.position.distanceTo(controls.target) * CAMERA_KEYBOARD_MOVE_RATE * sizeFactor
        ));
        _cameraMove.copy(_cameraForward).multiplyScalar(dolly * moveSpeed * atmosphereFactor * dt);
        camera.position.add(_cameraMove);
        controls.target.add(_cameraMove);
    }
    if (strafe) {
        const cameraDistance = camera.position.distanceTo(controls.target);
        const panSpeed = Math.min(speedCeiling, Math.max(cameraNavigationSpeed(), cameraDistance * CAMERA_KEYBOARD_MOVE_RATE * sizeFactor));
        _cameraMove.copy(_cameraRight).multiplyScalar(strafe * panSpeed * atmosphereFactor * dt);
        camera.position.add(_cameraMove);
        controls.target.add(_cameraMove);
    }
    const roll = (cameraKeys.has("e") ? 1 : 0) - (cameraKeys.has("q") ? 1 : 0);
    if (roll) {
        _cameraForward.copy(camera.getWorldDirection(_cameraForward)).normalize();
        camera.up.applyAxisAngle(_cameraForward, roll * .8 * dt).normalize();
        controls.update();
    }
}

function clampCameraToSystem() {
    solarSystem.getWorldPosition(_cameraSystemCenter);
    _cameraOffset.subVectors(camera.position, _cameraSystemCenter);
    const distance = _cameraOffset.length();
    const maximum = systemMaxDistance();
    if (!(distance > maximum)) return;
    _cameraClampCorrection.copy(_cameraOffset).multiplyScalar(maximum / distance).sub(_cameraOffset);
    camera.position.add(_cameraClampCorrection);
    controls.target.add(_cameraClampCorrection);
}

function rebaseFloatingOrigin() {
    const threshold = 4096;
    const cameraOffsetSq = camera.position.lengthSq();
    if (cameraOffsetSq < 32 * 32) return false;
    let approachingBodySurface = false;
    for (const key of CAMERA_SURFACE_REBASE_KEYS) {
        const body = objectRegistry[key];
        if (!body?.visible || !body.geometry?.parameters) continue;
        body.getWorldPosition(_cameraSystemCenter);
        const localRadius = bodyWorldRadius(body) * 64;
        if (localRadius > 0 && camera.position.distanceToSquared(_cameraSystemCenter) < localRadius * localRadius) {
            approachingBodySurface = true;
            break;
        }
    }
    if (!approachingBodySurface && cameraOffsetSq < threshold * threshold) return false;
    _cameraOffset.copy(camera.position);
    solarSystem.position.sub(_cameraOffset);
    sceneOriginOffset.add(_cameraOffset);
    camera.position.sub(_cameraOffset);
    controls.target.sub(_cameraOffset);
    DEFAULT_CAM_POS.sub(_cameraOffset);
    sunLight.position.sub(_cameraOffset);
    if (focusedObject?.userData?._prevPos) focusedObject.userData._prevPos.sub(_cameraOffset);
    if (solarSystem.userData?._prevPos) solarSystem.userData._prevPos.sub(_cameraOffset);
    if (camTransition) {
        for (const key of [ "fromTarget", "fromCam", "planetStart", "toTargetBase", "toCamBase" ]) {
            camTransition[key]?.sub?.(_cameraOffset);
        }
    }
    solarSystem.updateMatrixWorld(true);

    landingState?.previousBodyPosition?.sub(_cameraOffset);

    if (landingState?.settle) {
        landingState.settle.fromPos.sub(_cameraOffset);
        landingState.settle.toPos.sub(_cameraOffset);
        landingState.settle.fromTarget.sub(_cameraOffset);
        landingState.settle.toTarget.sub(_cameraOffset);
    }
    if (_clipPrevValid) _clipPrevPosition.sub(_cameraOffset);
    camera.updateMatrixWorld(true);
    _cullMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _cullFrustum.setFromProjectionMatrix(_cullMat);
    return true;
}
