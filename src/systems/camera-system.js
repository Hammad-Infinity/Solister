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

const LANDING_APPROACH_SPLIT = .72;

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

const CAMERA_KEYBOARD_DOLLY_RATE = 1.4;

const CAMERA_KEYBOARD_PAN_RATE = .22;

const CAMERA_SURFACE_REBASE_KEYS = Object.freeze([ "mercury", "venus", "earth", "moon", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto" ]);

let _autoLandingIntentAt = 0;

let cameraFocusFollowEnabled = true;

const _cameraClampCorrection = new THREE.Vector3;

let _cameraInputInstalled = false;

let _cameraLookDrag = null;

let _cameraRightPointer = null;

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
    return 1.8 + 1.15 * Math.min(1, span / reference);
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
    if (focusedObject?.userData) focusedObject.userData._prevPos = null;
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
    controls.minDistance = .05;
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
        body.getWorldQuaternion(_cameraLandingQuaternion);
        _cameraLandingSurfaceNormal.copy(landingState.surfaceNormalLocal || _cameraWorldUp).applyQuaternion(_cameraLandingQuaternion).normalize();
        _cameraLandingNormalRotation.setFromUnitVectors(_cameraLandingSurfaceNormal, _cameraLandingHitNormal);
        _cameraLandingTargetOffset.subVectors(controls.target, camera.position).applyQuaternion(_cameraLandingNormalRotation);
        camera.up.applyQuaternion(_cameraLandingNormalRotation).normalize();
        controls.target.copy(camera.position).add(_cameraLandingTargetOffset);
        _cameraLandingPush.copy(_cameraLandingHitPoint).addScaledVector(_cameraLandingHitNormal, clearance).sub(camera.position);
        camera.position.add(_cameraLandingPush);
        controls.target.add(_cameraLandingPush);
        body.getWorldQuaternion(_cameraLandingQuaternion).invert();
        landingState.surfaceNormalLocal.copy(_cameraLandingHitNormal).applyQuaternion(_cameraLandingQuaternion).normalize();
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

function _checkBodyClearance(body, dt) {
    if (!body?.visible || !body.geometry || !body.geometry.parameters) return;
    if (body === landingState?.body || body === camTransition?.landing?.body) {
        _enforceLandingSurfaceClearance(body);
        return;
    }
    body.updateWorldMatrix(true, false);
    body.getWorldPosition(_collisionPos);
    _collisionOffset.copy(camera.position).sub(_collisionPos);
    const distance = _collisionOffset.length();
    if (distance < 1e-12) return;
    const bodyRadius = bodyWorldRadius(body);
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
        const sunRadius = sunObj.geometry.parameters.radius;
        const margin = 1.02;
        const sunMin = sunRadius * margin;
        sunObj.getWorldPosition(_collisionPos);
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

function isLandableBody(body) {
    const key = body?.userData?.planetKey;
    return !!body && body.visible && [ "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "moon", "pluto" ].includes(key);
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
    _cameraLandingPush.subVectors(_cameraLandingPoint, camera.position);
    camera.position.copy(_cameraLandingPoint);
    controls.target.add(_cameraLandingPush);
    upWorld.copy(_cameraLandingHitNormal);
    body.worldToLocal(_cameraLandingPosition.copy(camera.position));
    body.worldToLocal(_cameraLandingStoredTarget.copy(controls.target));
    body.getWorldQuaternion(_cameraLandingQuaternion).invert();
    const upLocal = upWorld.clone().applyQuaternion(_cameraLandingQuaternion).normalize();
    const surfaceNormalLocal = upWorld.clone().applyQuaternion(_cameraLandingQuaternion).normalize();
    landingState = {
        body: body,
        localPosition: _cameraLandingPosition.clone(),
        localTarget: _cameraLandingStoredTarget.clone(),
        localUp: upLocal,
        surfaceNormalLocal: surfaceNormalLocal,
        surfaceClearance: clearance,
        previousMatrixWorld: body.matrixWorld.clone()
    };
    camera.up.copy(upWorld).normalize();
    controls.minDistance = 1e-8;
    controls.maxDistance = systemMaxDistance();
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
    body.updateWorldMatrix(true, false);
    const previousMatrix = landingState.previousMatrixWorld;
    if (previousMatrix) {
        _cameraLandingPrevInverse.copy(previousMatrix).invert();
        _cameraLandingDeltaMatrix.copy(body.matrixWorld).multiply(_cameraLandingPrevInverse);
        camera.position.applyMatrix4(_cameraLandingDeltaMatrix);
        controls.target.applyMatrix4(_cameraLandingDeltaMatrix);
        camera.up.transformDirection(_cameraLandingDeltaMatrix).normalize();
        previousMatrix.copy(body.matrixWorld);
        return;
    }
    body.localToWorld(_cameraLandingPosition.copy(landingState.localPosition));
    body.localToWorld(_cameraLandingStoredTarget.copy(landingState.localTarget));
    body.getWorldQuaternion(_cameraLandingQuaternion);
    camera.position.copy(_cameraLandingPosition);
    controls.target.copy(_cameraLandingStoredTarget);
    camera.up.copy(landingState.localUp).applyQuaternion(_cameraLandingQuaternion).normalize();
}

function captureLandingPose() {
    if (!landingState || !landingState.body?.visible) return;
    const body = landingState.body;
    body.updateWorldMatrix(true, false);
    body.worldToLocal(_cameraLandingPosition.copy(camera.position));
    body.worldToLocal(_cameraLandingStoredTarget.copy(controls.target));
    body.getWorldQuaternion(_cameraLandingQuaternion).invert();
    landingState.localPosition.copy(_cameraLandingPosition);
    landingState.localTarget.copy(_cameraLandingStoredTarget);
    landingState.localUp.copy(camera.up).applyQuaternion(_cameraLandingQuaternion).normalize();
    landingState.previousMatrixWorld?.copy(body.matrixWorld);
}

function landOnFocusedPlanet(options = {}) {
    cameraKeys.clear();
    const automatic = options === true || options?.automatic === true;
    _autoLandingIntentAt = 0;
    let body = isLandableBody(focusedObject) ? focusedObject : null;
    if (!body && isLandableBody(lastFocusedObject)) body = lastFocusedObject;
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
            approachSplit: LANDING_APPROACH_SPLIT,
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

function leavePlanetLanding() {
    cameraKeys.clear();
    _autoLandingIntentAt = 0;
    if (!landingState && !camTransition?.landing) return false;
    if (camTransition?.landing && !landingState) {
        camTransition = null;
        detachCameraFromFocus();
        controls.update();
        return true;
    }
    const body = landingState.body;
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
    controls.minDistance = 1e-8;
    controls.maxDistance = systemMaxDistance();
    zoomDistTarget = null;
    camTransition = {
        t: 0,
        duration: cinematicFocusDuration(fromCam, toCam),
        endMaxDistance: systemMaxDistance(),
        restoreWorldUp: true,
        fromTarget: fromTarget,
        fromCam: fromCam,
        fromUp: fromUp,
        toUp: _cameraWorldUp.clone(),
        followBodyRotation: true,
        transitionBody: body,
        toTargetLocal: toTargetLocal,
        toCamLocal: toCamLocal,
        planetStart: _cameraSurfaceCenter.clone(),
        toTargetBase: toTarget,
        toCamBase: toCam
    };
    distanceReadout?.noteInput();
    return true;
}

function updateCameraOrbitTarget() {
    if (!rightOrbitActive || !rightOrbitObject) return;
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
    landingState = null;
    controls.maxDistance = Math.max(controls.maxDistance, systemMaxDistance());
    rightOrbitObject = null;
    camera.updateMatrixWorld(true);
    camera.getWorldDirection(_cameraForward);
    _cameraLandingScratch.subVectors(controls.target, camera.position);
    if (_cameraLandingScratch.dot(_cameraForward) <= 1e-10) {
        controls.target.copy(camera.position).addScaledVector(_cameraForward, Math.max(_cameraLandingScratch.length(), .001));
    }
    const orbitCandidate = focusedObject?.visible ? focusedObject : lastFocusedObject?.visible ? lastFocusedObject : null;
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

function beginManualCameraMotion() {
    _autoLandingIntentAt = 0;
    detachCameraFromFocus();
    controls.autoRotate = false;
    resetCameraControlMomentum();
    if (toggleRotateBtn) toggleRotateBtn.classList.remove("active");
    if (rightOrbitActive) endRightOrbit();
    zoomDistTarget = null;
    camTransition = null;
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
            }
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        beginManualCameraMotion();
        camera.updateMatrixWorld(true);
        const aimDistance = camera.position.distanceTo(controls.target);
        freeAimDistance = THREE.MathUtils.clamp(Number.isFinite(aimDistance) ? aimDistance : 36, 1e-8, systemMaxDistance());
        camera.getWorldDirection(_cameraForward);
        controls.target.copy(camera.position).addScaledVector(_cameraForward, freeAimDistance);
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
        if (!_cameraLookDrag || event.pointerId !== _cameraLookDrag.id) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const drag = _cameraLookDrag;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if ((event.clientX - drag.startX) ** 2 + (event.clientY - drag.startY) ** 2 > 36) drag.moved = true;
        if (!dx && !dy) return;
        camera.updateMatrixWorld(true);
        camera.getWorldDirection(_cameraForward);
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
            setTimeout(endRightOrbit, 0);
        }
    }, true);
    document.addEventListener("pointercancel", event => {
        if (_cameraLookDrag?.id === event.pointerId) _cameraLookDrag = null;
        if (_cameraRightPointer === event.pointerId) {
            _cameraRightPointer = null;
            endRightOrbit();
        }
    }, true);
    window.addEventListener("blur", () => {
        cameraKeys.clear();
        if (_cameraLookDrag) _cameraLookDrag = null;
        _cameraRightPointer = null;
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

function cameraFocusSpeedScale() {
    const body = isLandableBody(focusedObject) ? focusedObject : null;
    if (!body) return 1;
    body.getWorldPosition(_cameraSurfaceCenter);
    const radius = Math.max(bodyWorldRadius(body), 1e-9);
    const gap = Math.max(0, camera.position.distanceTo(_cameraSurfaceCenter) - radius);
    const proximity = THREE.MathUtils.smoothstep(gap / radius, 0, 8);
    return .05 + .95 * proximity;
}

function cameraNavigationSpeed() {
    if (landingState?.body?.visible) return km2u(CAMERA_WALK_SPEED_MPS / 1e3);
    const body = isLandableBody(focusedObject) ? focusedObject : null;
    if (!body) return CAMERA_MOVE_MAX_SPEED;
    body.getWorldPosition(_cameraSurfaceCenter);
    const radius = Math.max(bodyWorldRadius(body), 1e-9);
    const gap = Math.max(0, camera.position.distanceTo(_cameraSurfaceCenter) - radius);
    const key = body.userData?.planetKey;
    const radiusKm = BodyShapes.maxRadiusKm(key);
    const atmosphereTopKm = PLANET_ATMOSPHERE_PROFILES?.[key]?.derived?.topKm || 0;
    const flightBlend = THREE.MathUtils.smoothstep(gap / radius, 10, 24);
    const nearSpeed = km2u(CAMERA_NEAR_BODY_SPEED_MPS / 1e3);
    const ordinarySpeed = nearSpeed + (CAMERA_MOVE_MAX_SPEED - nearSpeed) * flightBlend;
    if (!(radiusKm > 0 && atmosphereTopKm > 0)) return ordinarySpeed;
    const altitudeKm = gap / radius * radiusKm;
    const atmosphereBlend = 1 - THREE.MathUtils.smoothstep(
        altitudeKm,
        atmosphereTopKm * 1.1,
        atmosphereTopKm * 3
    );
    const atmosphereSpeed = km2u(CAMERA_ATMOSPHERE_SPEED_MPS / 1e3);
    return THREE.MathUtils.lerp(ordinarySpeed, atmosphereSpeed, atmosphereBlend);
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
    if (camTransition?.landing && !landingState) return;
    camera.updateMatrixWorld(true);
    camera.getWorldDirection(_cameraForward);
    _cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const strafe = (cameraKeys.has("d") ? 1 : 0) - (cameraKeys.has("a") ? 1 : 0);
    const dolly = (cameraKeys.has("w") ? 1 : 0) - (cameraKeys.has("s") ? 1 : 0);
    if (landingState?.body?.visible) {
        const body = landingState.body;
        body.getWorldPosition(_cameraSurfaceCenter);
        _cameraLandingNormal.subVectors(camera.position, _cameraSurfaceCenter).normalize();
        if (_bodySurfaceHitWithFallback(body, _cameraSurfaceCenter, _cameraLandingNormal, _cameraLandingHitPoint, _cameraLandingHitNormal)) {
            _cameraLandingNormal.copy(_cameraLandingHitNormal);
        }
        _cameraForward.addScaledVector(_cameraLandingNormal, -_cameraForward.dot(_cameraLandingNormal));
        _cameraRight.addScaledVector(_cameraLandingNormal, -_cameraRight.dot(_cameraLandingNormal));
        if (_cameraForward.lengthSq() < 1e-10) _cameraForward.crossVectors(_cameraRight, _cameraLandingNormal);
        if (_cameraRight.lengthSq() < 1e-10) _cameraRight.crossVectors(_cameraLandingNormal, _cameraForward);
        _cameraForward.normalize();
        _cameraRight.normalize();
        _cameraMove.set(0, 0, 0);
        if (cameraKeys.has("w")) _cameraMove.add(_cameraForward);
        if (cameraKeys.has("s")) _cameraMove.sub(_cameraForward);
        if (strafe > 0) _cameraMove.add(_cameraRight);
        if (strafe < 0) _cameraMove.sub(_cameraRight);
        if (_cameraMove.lengthSq() > 0) {
            _cameraMove.normalize().multiplyScalar(cameraNavigationSpeed() * dt);
            _walkLandedSurface(body, _cameraMove);
        }
    } else {
        if (dolly) {
            const currentDistance = zoomDistTarget ?? camera.position.distanceTo(controls.target);
            const speedScale = Math.max(.25, cameraFocusSpeedScale());
            zoomDistTarget = THREE.MathUtils.clamp(
                currentDistance * Math.exp(-dolly * CAMERA_KEYBOARD_DOLLY_RATE * speedScale * dt),
                controls.minDistance,
                controls.maxDistance
            );
        }
        if (strafe) {
            const cameraDistance = camera.position.distanceTo(controls.target);
            const body = isLandableBody(focusedObject) ? focusedObject : null;
            let nearBodyPanScale = 1;
            if (body) {
                body.getWorldPosition(_cameraSurfaceCenter);
                const radius = Math.max(bodyWorldRadius(body), 1e-9);
                const gap = Math.max(0, camera.position.distanceTo(_cameraSurfaceCenter) - radius);
                const clearanceBlend = THREE.MathUtils.smoothstep(gap / radius, 0, 8);
                nearBodyPanScale = .12 + .88 * clearanceBlend;
            }
            const panSpeed = Math.max(cameraNavigationSpeed(), cameraDistance * CAMERA_KEYBOARD_PAN_RATE * nearBodyPanScale);
            _cameraMove.copy(_cameraRight).multiplyScalar(strafe * panSpeed * dt);
            camera.position.add(_cameraMove);
            controls.target.add(_cameraMove);
        }
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
    landingState?.body?.updateWorldMatrix(true, false);
    landingState?.previousMatrixWorld?.copy(landingState.body.matrixWorld);
    camera.updateMatrixWorld(true);
    _cullMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _cullFrustum.setFromProjectionMatrix(_cullMat);
    return true;
}
