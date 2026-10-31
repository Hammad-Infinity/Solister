const CAMERA_NEAR_BODY_KEYS = Object.freeze([ "sun", "mercury", "venus", "earth", "moon", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto" ]);

const _atmoViewToBodyMatrix = new THREE.Matrix4;

const _flOccQuat = new THREE.Quaternion;
const _flOccMat4 = new THREE.Matrix4;

function _updateRingOccluder(uniforms, body) {
    if (!uniforms || !body) return;
    body.getWorldPosition(uniforms.uOccCenter.value);
    if (uniforms.uOccInvRot) {
        body.getWorldQuaternion(_flOccQuat).invert();
        _flOccMat4.makeRotationFromQuaternion(_flOccQuat);
        uniforms.uOccInvRot.value.setFromMatrix4(_flOccMat4);
    }
}
const _atmoViewToBodyRotation = new THREE.Matrix3;
const _atmoCameraBodyMetric = new THREE.Vector3;

let _atmosphereKeys = null;

let _cloudDeckAxisScale = null;

function transitionEase(x) {
    const t = x < 0 ? 0 : x > 1 ? 1 : x;
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function applyStarVisibility() {
    const mwOn = !!skyToggles.milkyway;
    if (mwOn) {
        scene.background = new THREE.Color(0);
    } else {
        if (!themeGradientTexture) themeGradientTexture = createThemeGradientBackground();
        scene.background = themeGradientTexture;
    }
    if (skyMaps) skyMaps.setLayerVisible("milkyway", mwOn);
}

function stepFade(current, enabled, dt, speed = CLOUD_FADE_SPEED) {
    const target = enabled ? 1 : 0;
    let next = current + (target - current) * (1 - Math.exp(-speed * dt));
    if (!enabled && next < .005) next = 0;
    if (enabled && next > .995) next = 1;
    return next;
}

function sunDistanceBlend(distanceInSolarRadii) {
    const logDistance = Math.log2(Math.max(1, distanceInSolarRadii));
    return THREE.MathUtils.smoothstep(logDistance, Math.log2(2), Math.log2(8192));
}

function updateSunLensArtifacts(sunNdc, visible, distanceMix, apparentRadiusPx) {
    const root = sunLensArtifacts;
    if (!root) return;
    root.visible = !!visible;
    if (!visible) return;
    const viewportHeight = renderer.domElement?.clientHeight || window.innerHeight || 1;
    const depth = root.userData.flareDepth || 2;
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov * .5));
    const aspect = Math.max(1e-6, camera.aspect || 1);
    const worldPerPixel = 2 * depth * tanHalfFov / viewportHeight;
    const flareAngle = Math.atan2(-sunNdc.y, -sunNdc.x);
    const range = THREE.MathUtils.clamp(distanceMix, 0, 1);
    const sunDiameterPx = Math.max(0, apparentRadiusPx * 2);
    for (const item of root.userData.flareItems || []) {
        const xNdc = sunNdc.x * item.factor;
        const yNdc = sunNdc.y * item.factor;
        item.sprite.position.set(xNdc * depth * tanHalfFov * aspect, yNdc * depth * tanHalfFov, -depth);
        let sizePx = Math.max(8, item.px + item.distancePx * range + item.sunScale * apparentRadiusPx);
        if (sunDiameterPx > 80) sizePx = Math.min(sizePx, sunDiameterPx);
        item.sprite.scale.set(sizePx * worldPerPixel, sizePx * item.aspect * worldPerPixel, 1);
        item.sprite.material.rotation = flareAngle + item.rotation;
        item.sprite.material.opacity = item.opacity * (.82 + .18 * range);
    }
}

function frameStepStart(now) {
    if (_contextLost) return null;
    updateMusicEnvelope();
    if (!performanceDefaults.shouldRender(now, document.hidden, targetFps)) return null;
    const delta = clock.getDelta();
    const cappedDelta = Math.min(delta, .1);
    camera.updateMatrixWorld();
    focusLodTick();
    _cullMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _cullFrustum.setFromProjectionMatrix(_cullMat);
    return {
        now: now,
        cappedDelta: cappedDelta
    };
}

// Night-side aurora brightness multiplier. The standing rule is that a night
// side is genuinely dark and no aurora term may lift it; at 0 the shells are
// still built and animated but contribute nothing. Override live with globalThis.__solisterAuroraLift = 1.
const AURORA_NIGHT_LIFT = 0;

// Simulation time at the last cloud-motion step, so the cloud clock follows the
// simulation rather than the frame rate.
// null until the first frame: simTimeMs belongs to state.js, which loads after
// this file, so it cannot be read here.
let _lastCloudSimMs = null;
const _cloudViewCentre = new THREE.Vector3();
const _cloudViewDirection = new THREE.Vector3();

function frameStepUpdate(now, cappedDelta) {
    simTimeMs = clampSimulationDate(simTimeMs);
    const requestedRate = timeScale;
    let allowedRate = extraBodies.limitRate(Math.abs(requestedRate), cappedDelta, focusedObject?.userData.planetKey);
    // A focused comet is a few km of ice; at a day per second it sweeps thousands
    // of its own widths per frame, which reads as the camera stuttering. Cap the
    // rate so it never crosses more than 2% of the viewing distance in a frame.
    if (focusedObject?.userData.isComet) {
        const step = cometLayer.stepPerSecond(focusedObject, camera, controls.target);
        if (step > 0) allowedRate = Math.min(allowedRate, step);
    }
    simTimeMs = solarAccuracy.tick(simTimeMs, cappedDelta, requestedRate < 0 ? -allowedRate : allowedRate, isPaused, {
        focusedKey: focusedObject?.userData.planetKey,
        beltCloseUp: focusedObject?.userData.planetKey === "asteroidbelt" && camera.position.distanceTo(controls.target) < km2u(1e4),
        camera: camera,
        showOrbits: showOrbits && pathSettings.style === "orbits"
    });
    bodyOrientation.applyAll(objectRegistry, simTimeMs);
    updateAsteroidBelt(cappedDelta);
    earthCloudsOpacity = stepFade(earthCloudsOpacity, earthCloudsEnabled, cappedDelta);
    earthAtmosphereOpacity = stepFade(earthAtmosphereOpacity, earthAtmosphereEnabled, cappedDelta, 3);
    const earthCloud = cloudMeshes["earth"];
    if (earthCloud) {
        earthCloud.visible = earthCloudsOpacity > .001;
        earthCloud.material.opacity = .95 * earthCloudsOpacity;
        const _cloudMap = earthCloud.material.map;
        eclipseUniforms.uCloudShadowMap.value = _cloudMap || null;
        if (_cloudMap && objectRegistry.earth) {
            _atmoViewToBodyMatrix.copy(objectRegistry.earth.matrixWorld).invert();
            eclipseUniforms.uCloudShadowSunLocal.value.copy(_lightingOrigin)
                .sub(earthCloud.getWorldPosition(_lightingScratchPosition))
                .transformDirection(_atmoViewToBodyMatrix);
            const _surfaceMap = objectRegistry.earth.material?.map;
            eclipseUniforms.uCloudShadowUvOffset.value.set(
                _cloudMap.offset.x - (_surfaceMap?.offset.x || 0),
                _cloudMap.offset.y - (_surfaceMap?.offset.y || 0)
            );
            eclipseUniforms.uCloudShadowUseAlpha.value = _cloudMap.userData?.cloudMaskChannel === "alpha" ? 1 : 0;
        }
        eclipseUniforms.uCloudShadowStrength.value = .65 * earthCloudsOpacity * (earthCloud.visible ? 1 : 0);
    }
    // The volume and the deck are mutually exclusive, and the deck sits above
    // the volume's shell, so this has to run after the deck's own visibility
    // above or the volume is hidden behind an opaque shell.
    if (typeof updateEarthCloudLod === "function") {
        const lod = updateEarthCloudLod(camera, { wanted: earthCloudsOpacity > .001, opacity: earthCloudsOpacity });
        if (lod) {
            // The crossfade owns both opacities now, so the deck's own ramp
            // above is overridden here rather than fought with. The shadow is
            // cast by whichever representation is drawn more strongly.
            if (earthCloud) earthCloud.material.opacity = .95 * lod.deckOpacity;
            const lit = Math.max(lod.deckOpacity, lod.volumeOpacity * 0.85);
            eclipseUniforms.uCloudShadowStrength.value = .65 * lit;
        }
    }
    // The sky moves. Cloud time follows the simulation clock, with a floor so
    // that at 1x the drift is still visible; a date jump is capped inside the
    // motion itself so it cannot fling the field across the planet.
    const motion = globalThis.cloudMotion;
    if (motion) {
        if (_lastCloudSimMs === null) _lastCloudSimMs = simTimeMs;
        const simDeltaSeconds = Math.abs(simTimeMs - _lastCloudSimMs) / 1000;
        _lastCloudSimMs = simTimeMs;
        const floorFactor = (globalThis.CLOUD_MOTION && CLOUD_MOTION.minTimeFactor) || 120;
        const cloudSeconds = Math.max(simDeltaSeconds, cappedDelta * floorFactor);
        // The flat deck carries one texture offset, so it moves with the wind
        // at the latitude being looked at -- see cloud-motion.js.
        if (objectRegistry.earth) {
            objectRegistry.earth.getWorldPosition(_cloudViewCentre);
            _cloudViewDirection.copy(camera.position).sub(_cloudViewCentre).normalize();
            motion.setViewLatitude(Math.asin(Math.max(-1, Math.min(1, _cloudViewDirection.y))) * 180 / Math.PI);
        }
        const dayOfYear = ((simTimeMs / 86400000) % 365.2422 + 365.2422) % 365.2422;
        const declination = typeof solarDeclinationDeg === "function" ? solarDeclinationDeg(dayOfYear) : 0;
        motion.advance(cloudSeconds, declination, cappedDelta);
    }
    const earthCloudGlow = objectRegistry.earth?.userData?.cloudGlowMesh;
    if (earthCloudGlow?.material?.uniforms && earthCloud && objectRegistry.earth) {
        earthCloudGlow.visible = earthCloudsOpacity > .001 && earthCloud.visible;
        const uniforms = earthCloudGlow.material.uniforms;
        const cloudTexture = earthCloud.material.map;
        uniforms.uOpacity.value = .58 * earthCloudsOpacity;
        if (cloudTexture) {
            cloudTexture.updateMatrix();
            uniforms.uCloudTexture.value = cloudTexture;
            uniforms.uCloudTextureMatrix.value.copy(cloudTexture.matrix);
        }
        objectRegistry.earth.getWorldPosition(_lightingScratchPosition);
        camera.getWorldPosition(_vortexCamPos);
        objectRegistry.earth.getWorldScale(_distTmp);
        const glowRadius = (earthCloudGlow.geometry?.parameters?.radius || 0) * Math.max(Math.abs(_distTmp.x), Math.abs(_distTmp.y), Math.abs(_distTmp.z), 1e-12);
        uniforms.uInsideShell.value = _vortexCamPos.distanceTo(_lightingScratchPosition) < glowRadius ? 1 : 0;
        uniforms.uSunDirection.value.subVectors(_lightingOrigin, _lightingScratchPosition).normalize();
    }
    venusAtmoOpacity = stepFade(venusAtmoOpacity, venusAtmoEnabled, cappedDelta);

    if (focusedObject?.userData.approximate && !focusedObject.visible) releaseFocus();
    if (focusedObject?.userData.isEphemerisMoon && !solarAccuracy.available) resetCamera();
    if (focusedObject?.userData.extraEphemeris && !extraBodies.inCoverage(solarAccuracy.snapshot?.ms ?? simTimeMs, focusedObject.userData.planetKey)) {
        unfocusBtn.click();
    }
    extraBodies.update({
        ms: solarAccuracy.snapshot?.ms ?? simTimeMs,
        et: solarAccuracy.snapshot?.et,
        available: solarAccuracy.available,
        showLabels: showLabels
    });
    cometLayer.update({
        ms: solarAccuracy.snapshot?.ms ?? simTimeMs,
        et: solarAccuracy.snapshot?.et,
        available: solarAccuracy.available,
        showOrbits: showOrbits,
        style: pathSettings.style,
        length: pathSettings.length,
        delta: cappedDelta
    });
    if (focusedObject?.userData.isComet && !focusedObject.visible) {
        // Out of coverage: hold the last frame instead of resetting the camera.
        focusedObject.userData._prevPos = null;
    }
    if (asteroidsEnabled) {
        const wallNow = now;
        const simMoved = Math.abs(simTimeMs - _lastCatalogSimMs) > 30 * 60 * 1e3;
        if (_lastCatalogWall === 0 || wallNow - _lastCatalogWall >= CATALOG_UPDATE_MS || simMoved) {
            _lastCatalogWall = wallNow;
            _lastCatalogSimMs = simTimeMs;
            resonantPopulations.update({
                available: solarAccuracy.available,
                et: solarAccuracy.snapshot?.et,
                enabled: asteroidsEnabled,
                markersEnabled: beltGuideEnabled,
                groupOn: {
                    trojanl4: asteroidTypeEnabled("trojanl4"),
                    trojanl5: asteroidTypeEnabled("trojanl5"),
                    hildas: asteroidTypeEnabled("hildas")
                }
            });
            nearEarth.update({
                et: solarAccuracy.snapshot?.et,
                enabled: asteroidTypeEnabled("nea")
            });
            kuiperBelt.update({
                enabled: asteroidTypeEnabled("kuiperbelt"),
                et: solarAccuracy.available ? solarAccuracy.snapshot?.et : NaN,
                showLabels: showLabels,
                focusedKey: focusedObject?.userData.planetKey
            });
        }
    }
    enforceAsteroidVisibility();
    if (camTransition) {
        camTransition.t += Math.min(cappedDelta, 1 / 30);
        const p = Math.min(camTransition.t / camTransition.duration, 1);
        const landing = camTransition.landing;
        const bodyLocked = !!(camTransition.followBodyRotation && camTransition.transitionBody && camTransition.toCamLocal && camTransition.toTargetLocal);
        // One ease for the whole flight. The old code ran two chained eases
        // split at 0.66, which brought the camera to a full stop two thirds
        // of the way down and then started a second, slower descent: that was the "two stage" landing.
        const e = transitionEase(p);
        let toTarget = camTransition.toTargetBase;
        let toCam = camTransition.toCamBase;
        let fromTarget = camTransition.fromTarget;
        let fromCam = camTransition.fromCam;
        _ctUpNow.set(0, 0, 0);
        if (bodyLocked) {
            const body = camTransition.transitionBody;
            body.updateWorldMatrix(true, false);
            body.getWorldPosition(_ctNow);
            body.getWorldQuaternion(_ctBodyQuat);
            toCam = _ctToCam.copy(camTransition.toCamLocal).applyQuaternion(_ctBodyQuat).add(_ctNow);
            toTarget = _ctToTarget.copy(camTransition.toTargetLocal).applyQuaternion(_ctBodyQuat).add(_ctNow);
            const fromLocal = camTransition.fromCamLocal || landing?.fromCamLocal;
            const fromTargetLocal = camTransition.fromTargetLocal || landing?.fromTargetLocal;
            if (fromLocal && fromTargetLocal && fromLocal.length() <= bodyWorldRadius(body) * 8) {
                fromCam = _ctFromCam.copy(fromLocal).applyQuaternion(_ctBodyQuat).add(_ctNow);
                fromTarget = _ctFromTarget.copy(fromTargetLocal).applyQuaternion(_ctBodyQuat).add(_ctNow);
            } else {
                _ctDelta.subVectors(_ctNow, camTransition.planetStart);
                fromCam = _ctFromCam.copy(camTransition.fromCam).add(_ctDelta);
                fromTarget = _ctFromTarget.copy(camTransition.fromTarget).add(_ctDelta);
            }
            // Defensive: a body-locked transition without a local up (there are
            // two builders, and one historically omitted it) must not throw
            // once per frame. Fall back to the current up.
            if (camTransition.toUpLocal) {
                _ctUpNow.copy(camTransition.toUpLocal).applyQuaternion(_ctBodyQuat).normalize();
            } else if (camTransition.toUp) {
                _ctUpNow.copy(camTransition.toUp).normalize();
            }
        } else if (focusedObject) {
            focusedObject.getWorldPosition(_ctNow);
            _ctDelta.subVectors(_ctNow, camTransition.planetStart);
            toTarget = _ctToTarget.copy(camTransition.toTargetBase).add(_ctDelta);
            toCam = _ctToCam.copy(camTransition.toCamBase).add(_ctDelta);
            if (camTransition.toUp) _ctUpNow.copy(camTransition.toUp).normalize();
        }
        if (camTransition.fromUp && _ctUpNow.lengthSq() > .5) {
            _ctUpQuat.setFromUnitVectors(camTransition.fromUp, _ctUpNow);
            camera.up.copy(camTransition.fromUp).applyQuaternion(_ctQuatStep.identity().slerp(_ctUpQuat, e)).normalize();
        }
        if (bodyLocked) relaxControlsPolarLimits();
        controls.target.lerpVectors(fromTarget, toTarget, e);
        if (camTransition.straight) {
            // Straight chord between the two endpoints: the direction is not
            // slerped and no bow is added, so the camera never swings around the planet on the way down.
            camera.position.lerpVectors(fromCam, toCam, e);
        } else {
        _ctOffsetFrom.subVectors(fromCam, fromTarget);
        _ctOffsetTo.subVectors(toCam, toTarget);
        const fromLength = _ctOffsetFrom.length();
        const toLength = _ctOffsetTo.length();
        if (fromLength > 1e-9 && toLength > 1e-9) {
            _ctDirFrom.copy(_ctOffsetFrom).divideScalar(fromLength);
            _ctDirTo.copy(_ctOffsetTo).divideScalar(toLength);
            _ctQuatSpin.setFromUnitVectors(_ctDirFrom, _ctDirTo);
            _ctArc.copy(_ctDirFrom).applyQuaternion(_ctQuatStep.identity().slerp(_ctQuatSpin, e));
            _ctBowAxis.subVectors(toTarget, fromTarget).cross(_ctDirTo);
            if (_ctBowAxis.lengthSq() > 1e-12 && !landing) {
                _ctArc.addScaledVector(_ctBowAxis.normalize(), CAMERA_ARC_BOW * Math.sin(Math.PI * e));
            }
            _ctArc.normalize();
            camera.position.copy(controls.target).addScaledVector(_ctArc, fromLength + (toLength - fromLength) * e);
        } else {
            camera.position.lerpVectors(fromCam, toCam, e);
        }
        }
        if (p >= 1) {
            const completedTransition = camTransition;
            if (camTransition.endMaxDistance !== undefined) {
                controls.maxDistance = camTransition.endMaxDistance;
            }
            camTransition = null;
            if (completedTransition.landing) {
                setLandingState(completedTransition.landing.body, completedTransition.landing.normal);
            } else if (completedTransition.restoreWorldUp) {
                camera.up.copy(_cameraWorldUp);
            }
            if (focusedObject) {
                focusedObject.getWorldPosition(_ctNow);
                focusedObject.userData._prevPos = focusedObject.userData._prevPos || new THREE.Vector3;
                focusedObject.userData._prevPos.copy(_ctNow);
            }
        }
    }
    if (focusedObject && focusedObject !== solarSystem && !camTransition && !landingState) {
        focusedObject.getWorldPosition(_followPosition);
        const previous = focusedObject.userData._prevPos;
        if (previous) {
            _followDelta.subVectors(_followPosition, previous);
            // Real motion is small next to the viewing distance. Anything bigger is
            // a jump (new epoch, re-sampled orbit), and dragging the camera by it is
            // what made the view lurch, so re-seed instead.
            const limit = camera.position.distanceTo(controls.target) * .5;
            if (_followDelta.lengthSq() < limit * limit) {
                controls.target.add(_followDelta);
                camera.position.add(_followDelta);
            }
            previous.copy(_followPosition);
        } else {
            focusedObject.userData._prevPos = _followPosition.clone();
        }
    }
    if (landingState) {
        controls.minDistance = 1e-8;
        relaxControlsPolarLimits();
    } else if (focusedObject && !camTransition && _focusBounds) {
        restoreControlsPolarLimits();
        controls.minDistance = _focusBounds.min;
        if (zoomDistTarget !== null) zoomDistTarget = Math.max(controls.minDistance, zoomDistTarget);
    } else {
        restoreControlsPolarLimits();
    }
    {
        const focusRadius = focusedObject ? focusedObject.userData.focusRadius ?? focusedObject.geometry?.parameters?.radius ?? 1 : 1;
        const distToTarget = camera.position.distanceTo(controls.target);
        const proximity = Math.max(distToTarget / Math.max(focusRadius, 1e-9), 1);
        controls.rotateSpeed = .5 * Math.min(1, Math.pow(proximity / 6, .55));
    }
    updateCameraOrbitTarget();
    updateLandingPose();
    const frameRotateSpeed = controls.autoRotateSpeed;
    controls.autoRotateSpeed = frameRotateSpeed * cappedDelta * 60;
    controls.dampingFactor = 1 - Math.pow(.95, cappedDelta * 60);
    controls.update();
    controls.autoRotateSpeed = frameRotateSpeed;
    if (zoomDistTarget !== null && !camTransition) {
        const curDist = camera.position.distanceTo(controls.target);
        const newDist = curDist + (zoomDistTarget - curDist) * (1 - Math.exp(-ZOOM_EASE_RATE * cappedDelta));
        _zoomDir.subVectors(camera.position, controls.target).normalize();
        camera.position.copy(controls.target).addScaledVector(_zoomDir, newDist);
        if (Math.abs(newDist - zoomDistTarget) < Math.max(1e-10, zoomDistTarget * 1e-5)) {
            zoomDistTarget = null;
        }
    }
    updateCameraNavigation(cappedDelta);
    clampCameraToSystem();
    preventCameraClipping(cappedDelta);
    clampCameraToSystem();
    if (typeof globalThis.maybeAutoLandOnFocusedPlanet === "function") {
        globalThis.maybeAutoLandOnFocusedPlanet();
    }
    updateElevationSurfaceDetail();
    captureLandingPose();
    rebaseFloatingOrigin();
    {
        const sunObj = objectRegistry["sun"];
        const camDist = camera.position.distanceTo(controls.target);
        const asteroidCloseUp = focusedObject?.userData.planetKey === "asteroidbelt";
        const focusedRadius = focusedObject?.userData.focusRadius ?? focusedObject?.geometry?.parameters?.radius ?? .2;
        const minimumNear = asteroidCloseUp ? 1e-8 : Math.max(1e-8, focusedRadius * 1e-8);
        let wantNear = Math.max(minimumNear, Math.min(50, camDist * 1e-5));
        let nearestBodyClearance = Infinity;
        for (const key of CAMERA_NEAR_BODY_KEYS) {
            const body = objectRegistry[key];
            if (!body?.visible) continue;
            body.getWorldPosition(_lightingScratchPosition);
            body.getWorldScale(_lightingScratchDirection);
            const worldScale = Math.max(Math.abs(_lightingScratchDirection.x), Math.abs(_lightingScratchDirection.y), Math.abs(_lightingScratchDirection.z));
            let extent = bodyWorldRadius(body);
            const ringOuter = body.userData?.ringMesh?.geometry?.parameters?.outerRadius;
            if (ringOuter > 0) extent = Math.max(extent, ringOuter * worldScale);
            nearestBodyClearance = Math.min(nearestBodyClearance, Math.max(0, camera.position.distanceTo(_lightingScratchPosition) - extent));
        }
        if (Number.isFinite(nearestBodyClearance)) {
            wantNear = Math.min(wantNear, Math.max(minimumNear, nearestBodyClearance * .05));
        }
        const landingBody = landingState?.body || camTransition?.landing?.body;
        if (landingBody) {
            // Near plane just in front of the eye, not a fraction of the planet: a
            // range ratio that extreme is what makes the ground z-fight.
            const eye = cameraEyeHeightUnits(landingBody);
            wantNear = Math.min(wantNear, Math.max(eye * .25, 1e-12));
        }
        if (sunObj) {
            sunObj.getWorldPosition(_lightingScratchPosition);
            const sunSurf = camera.position.distanceTo(_lightingScratchPosition) - (sunObj.userData?.radius || sunObj.geometry?.parameters?.radius || 0);
            if (sunSurf > minimumNear * 2) {
                wantNear = Math.min(wantNear, sunSurf * .9);
            }
        }
        if (Math.abs(camera.near - wantNear) > wantNear * 1e-4) {
            camera.near = wantNear;
            camera.updateProjectionMatrix();
        }
    }
    camera.updateMatrixWorld(true);
    _cullMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _cullFrustum.setFromProjectionMatrix(_cullMat);
    objectRegistry.sun?.getWorldPosition(_lightingOrigin);
    if (objectRegistry.sun) sunLight.position.copy(_lightingOrigin);
    // Ring shadow needs the live body-to-Sun direction each frame.
    for (const key in objectRegistry) {
        const updater = objectRegistry[key]?.userData?.updateRingShadow;
        if (updater) updater(_lightingOrigin);
    }
    updateEarthEclipse();
    if (ringShadowBindings.length) updateRingParticleShadows();
    if (ringSunShadingBindings.length) updateRingSunShading();
    if (objectRegistry["earth"] && objectRegistry["earth"].userData.nightMesh) {
        const earth = objectRegistry["earth"];
        const nightMesh = earth.userData.nightMesh;
        const earthPos = _lightingScratchPosition;
        earth.getWorldPosition(earthPos);
        camera.getWorldPosition(_vortexCamPos);
        earth.getWorldScale(_distTmp);
        const nightRadius = (nightMesh.geometry?.parameters?.radius || earth.geometry?.parameters?.radius || 0) * Math.max(Math.abs(_distTmp.x), Math.abs(_distTmp.y), Math.abs(_distTmp.z), 1e-12);
        const nightInside = _vortexCamPos.distanceTo(earthPos) < nightRadius;
        const dir = _lightingScratchDirection.subVectors(_lightingOrigin, earthPos).normalize();
        const nightUniforms = nightMesh.material.uniforms;
        nightUniforms.uInsideShell.value = nightInside ? 1 : 0;
        nightUniforms.sunDirection.value.copy(dir);
        const dayTexture = earth.material?.map;
        if (dayTexture) {
            dayTexture.updateMatrix();
            nightUniforms.dayTexture.value = dayTexture;
            nightUniforms.dayTextureMatrix.value.copy(dayTexture.matrix);
            nightUniforms.hasDayTexture.value = 1;
        } else {
            nightUniforms.hasDayTexture.value = 0;
        }
        const nightTexture = nightUniforms.nightTexture.value;
        if (nightTexture) {
            nightTexture.updateMatrix();
            nightUniforms.nightTextureMatrix.value.copy(nightTexture.matrix);
        }
    }
    if (objectRegistry["saturn"] && saturnMat && saturnRingMat) {
        if (objectRegistry["earth"] && objectRegistry["moon"] && moonMat) {
            objectRegistry["earth"].getWorldPosition(moonMat.userData.uEarthPos.value);
        }
        const s = objectRegistry["saturn"];
        s.getWorldPosition(saturnMat.userData.uSaturnCenter.value);
        saturnMat.userData.uRingTex.value = objectRegistry["saturn-ring"].material.map;
        s.getWorldPosition(saturnRingMat.userData.uSaturnPos.value);
        const _satRingOcc = objectRegistry["saturn-ring"].material.userData.ringOcclusionUniforms;
        if (_satRingOcc) _updateRingOccluder(_satRingOcc, s);
        const actualRing = objectRegistry["saturn-ring"];
        actualRing.updateWorldMatrix(true, false);
        const su = s.userData.ringShadowUniforms;
        if (su) {
            s.getWorldPosition(su.uRingCenter.value);
            su.uRingNormal.value.set(0, 0, 1).transformDirection(actualRing.matrixWorld);
            su.uSunPos.value.copy(_lightingOrigin);
        }
    }
    if (objectRegistry["uranus"] && objectRegistry["uranus-ring"]) {
        const uu = objectRegistry["uranus"].userData.ringShadowUniforms;
        if (uu) {
            const um = objectRegistry["uranus"];
            const ur = objectRegistry["uranus-ring"];
            um.getWorldPosition(uu.uRingCenter.value);
            if (ur.material.userData.ringOcclusionUniforms) _updateRingOccluder(ur.material.userData.ringOcclusionUniforms, um);
            ur.updateWorldMatrix(true, false);
            uu.uRingNormal.value.set(0, 0, 1).transformDirection(ur.matrixWorld);
            uu.uSunPos.value.copy(_lightingOrigin);
        }
    }
    if (objectRegistry["neptune"] && objectRegistry["neptune-ring"]) {
        const nu = objectRegistry["neptune"].userData.ringShadowUniforms;
        if (nu) {
            const nm = objectRegistry["neptune"];
            const nr = objectRegistry["neptune-ring"];
            nm.getWorldPosition(nu.uRingCenter.value);
            if (nr.material.userData.ringOcclusionUniforms) _updateRingOccluder(nr.material.userData.ringOcclusionUniforms, nm);
            nr.updateWorldMatrix(true, false);
            nu.uRingNormal.value.set(0, 0, 1).transformDirection(nr.matrixWorld);
            nu.uSunPos.value.copy(_lightingOrigin);
        }
    }
    ensurePlanetOccluders(objectRegistry);
    updatePlanetOccluders();
    if (objectRegistry["earth"] && objectRegistry["moon"] && earthMat) {
        objectRegistry["moon"].getWorldPosition(_moonWorldTmp);
        earthMat.userData.uMoonPos.value.copy(_moonWorldTmp);
    }
    syncPlanetAtmospheres();
    syncAtmAtmospheres();
    for (const key in auroraShells) {
        const aurora = auroraShells[key];
        const auroraBody = objectRegistry[key];
        if (!aurora || !auroraBody) continue;
        const auroraR = aurora.geometry?.parameters?.radius || auroraBody.geometry?.parameters?.radius || 0;
        let auroraVisible = auroraBody.visible && bodyOnScreen(auroraBody, auroraR);
        if (auroraVisible) {
            auroraBody.getWorldPosition(_lightingScratchPosition);
            camera.getWorldPosition(_vortexCamPos);
            auroraBody.getWorldScale(_distTmp);
            const auroraWorldR = auroraR * Math.max(Math.abs(_distTmp.x), Math.abs(_distTmp.y), Math.abs(_distTmp.z), 1e-12);
            const auroraD = _lightingScratchPosition.distanceTo(_vortexCamPos);
            const auroraVh = renderer.domElement?.clientHeight || window.innerHeight;
            const auroraPx = auroraD <= auroraWorldR ? Infinity : camera.projectionMatrix.elements[5] * auroraVh * .5 * auroraWorldR / Math.sqrt(Math.max(auroraD * auroraD - auroraWorldR * auroraWorldR, 1e-20));
            const auroraFade = auroraD <= auroraWorldR ? 1 : THREE.MathUtils.smoothstep(auroraPx, 6, 42);
            aurora.visible = auroraFade > .003;
            if (aurora.visible) {
                aurora.material.uniforms.uTime.value = now / 1000;
                aurora.material.uniforms.uSunWorldPos.value.copy(_lightingOrigin);
                // Standing rule: the night side stays genuinely dark and no aurora term
                // may lift it. AURORA_NIGHT_LIFT is the only knob; the shells are still
                // built and updated, they just add nothing.
                const lift = globalThis.__solisterAuroraLift ?? AURORA_NIGHT_LIFT;
                aurora.material.uniforms.uIntensity.value = aurora.userData.auroraGain * auroraFade * lift;
                aurora.visible = auroraFade > .003 && lift > 0.001;
            }
        } else {
            aurora.visible = false;
        }
    }

    const _cloudDeck = cloudMeshes.earth;
    if (_cloudDeck?.material?.userData?.uEarthCloudInsideShell && objectRegistry.earth) {
        const _deckRadius = _cloudDeck.geometry?.parameters?.radius || 0;
        let _deckInside = false;
        if (_deckRadius > 0) {
            if (!_cloudDeckAxisScale) {
                const _deckAxes = BodyShapes.axesKm.earth || [ 1, 1, 1 ];
                const _deckMaxAxis = Math.max(..._deckAxes);
                _cloudDeckAxisScale = new THREE.Vector3(_deckAxes[0] / _deckMaxAxis, _deckAxes[2] / _deckMaxAxis, _deckAxes[1] / _deckMaxAxis);
            }
            _atmoViewToBodyMatrix.copy(objectRegistry.earth.matrixWorld).invert().multiply(camera.matrixWorld);
            _deckInside = _atmoCameraBodyMetric.setFromMatrixPosition(_atmoViewToBodyMatrix).divide(_cloudDeckAxisScale).length() < _deckRadius;
        }
        _cloudDeck.material.userData.uEarthCloudInsideShell.value = _deckInside ? 1 : 0;
    }
    if (objectRegistry["sun"]) {
        const _s = objectRegistry["sun"];
        _s.getWorldPosition(_sunLookPos);
        _sunLookScr.copy(_sunLookPos).project(camera);
        const _vw = renderer.domElement.clientWidth || window.innerWidth;
        const _vh = renderer.domElement.clientHeight || window.innerHeight;
        const _foc = .5 * _vh * camera.projectionMatrix.elements[5];
        const _sR = _s.userData?.radius || (_s.geometry && _s.geometry.parameters ? _s.geometry.parameters.radius : 1) || 1;
        camera.getWorldPosition(_vortexCamPos);
        const _sDist = Math.max(1e-9, _vortexCamPos.distanceTo(_sunLookPos));
        const _sunDistanceMix = sunDistanceBlend(_sDist / _sR);
        const _sDenom = Math.sqrt(Math.max(1e-12, _sDist * _sDist - _sR * _sR));
        const _sPx = _sR * _foc / _sDenom;
        const _sx = (_sunLookScr.x * .5 + .5) * _vw;
        const _sy = (-_sunLookScr.y * .5 + .5) * _vh;
        camera.getWorldDirection(_sunLookDir);
        const facing = _sunLookDir.x * (_sunLookPos.x - _vortexCamPos.x) + _sunLookDir.y * (_sunLookPos.y - _vortexCamPos.y) + _sunLookDir.z * (_sunLookPos.z - _vortexCamPos.z) > 0;
        const inView = facing && _sunLookScr.z < 1 && _sunLookScr.z > -1 && _sx > -_sPx && _sx < _vw + _sPx && _sy > -_sPx && _sy < _vh + _sPx;
        sunCoronaFade = stepFade(sunCoronaFade, sunCoronaEnabled, cappedDelta, 2.5);
        if (sunCoronaMesh) {
            objectRegistry["sun"].getWorldPosition(sunCoronaMesh.material.uniforms.uSunCenter.value);
            const _coronaR = objectRegistry["sun"].geometry?.parameters?.radius || _sR;
            const _corona = sunCoronaMesh.userData.coronaProfile;
            camera.getWorldPosition(_vortexCamPos);
            const _coronaDistR = _vortexCamPos.distanceTo(_sunLookPos) / _coronaR;
            const _coronaMix = sunDistanceBlend(_coronaDistR);
            const _shellScale = 1.08 + (_corona.shellScale - 1.08) * _coronaMix;
            sunCoronaMesh.scale.setScalar(_shellScale / _corona.shellScale);
            sunCoronaMesh.material.uniforms.uShellRadius.value = _coronaR * _shellScale;
            sunCoronaMesh.material.uniforms.intensity.value = _corona.intensity * sunCoronaFade;
            sunCoronaMesh.material.uniforms.uStreamers.value = _corona.streamers * (GRAPHICS_STREAMERS[textureQuality] ?? 1);
            sunCoronaMesh.material.uniforms.uDistGain.value = 1 + 1.4 * _coronaMix;
            sunCoronaMesh.material.uniforms.uTime.value = now / 1e3;
            sunCoronaMesh.visible = sunCoronaMesh.material.uniforms.intensity.value > .001 && bodyOnScreen(objectRegistry.sun, _coronaR * _shellScale);
        }
        if (sunHaloMesh) {
            const haloRadiusPx = 6 + 22 * _sunDistanceMix;
            sunHaloMesh.material.uniforms.uSunCenter.value.copy(_sunLookPos);
            sunHaloMesh.material.uniforms.uViewport.value.set(_vw, _vh);
            sunHaloMesh.material.uniforms.uHaloRadius.value = haloRadiusPx;
            sunHaloMesh.material.uniforms.uGain.value = .65 * (1 + 1.6 * _sunDistanceMix);
            sunHaloMesh.visible = sunCoronaFade > .01 && facing && _sunLookScr.z < 1 && _sunLookScr.z > -1 && _sx > -haloRadiusPx && _sx < _vw + haloRadiusPx && _sy > -haloRadiusPx && _sy < _vh + haloRadiusPx;
        }
        updateSunLensArtifacts(_sunLookScr, inView, _sunDistanceMix, _sPx, 1);
        const _sunMarker = bodyGlowMarkers?.entries?.get("sun");
        if (_sunMarker) _sunMarker.point.visible = false;
    }
    updateAsteroidMarkerLOD();
    moonEclipses.update(ENABLE_NEW_MOON_SHADOWS && solarAccuracy.available, camera);
    trailLayer.update({
        generation: solarAccuracy.generation,
        enabled: showOrbits,
        available: solarAccuracy.available
    });
    extraBodies.renderPaths({
        et: solarAccuracy.snapshot?.et,
        enabled: showOrbits,
        style: pathSettings.style,
        settings: pathSettings,
        trailLayer: trailLayer,
        focusedKey: focusedObject?.userData.planetKey
    });
    planetWeather?.update(now / 1e3);
    planetDetail.update();
    saturnAlignment.update();
    ringAsteroids.update({
        days: simTimeMs / 864e5 + 2440587.5 - 2451545,
        delta: cappedDelta
    });
    {
        const skyR = skyMaps && skyMaps.domeRadius || SKY_RADIUS;
        if (skyMaps) skyMaps.update(camera);
        if (starField) starField.update(camera);
        if (constellationLayer) {
            constellationLayer.update(camera, skyR, simTimeMs);
        }
    }
    const _frameLabelMode = typeof getLabelMode === "function" ? getLabelMode() : "symbols";
    bodyGlowMarkers?.update(cappedDelta, focusedObject, true);
    for (const lo of labelObjects) {
        if (!lo.element) continue;
        if (_frameLabelMode === "off" || !markersEnabled) {
            lo.visible = false;
            lo.element.style.display = "none";
            continue;
        }
        lo.visible = true;
        lo.element.style.display = "";
        const name = lo.element.querySelector(".label-name");
        if (name) name.style.display = _frameLabelMode === "names" ? "" : "none";
    }
    updatePlanetVisuals();

    if (_clipPrevValid && !_clipPrevPosition.equals(camera.position)) preventCameraClipping(0);
    displayChain.render(scene, camera);
    const _labelMode = typeof getLabelMode === "function" ? getLabelMode() : "symbols";
    const _effectiveShowLabels = _labelMode !== "off";
    const _needsCssLabelsThisFrame = labelRenderGate.needsRender({
        showLabels: _effectiveShowLabels,
        conLabels: skyLayerEnabled("conLabels"),
        starLabels: skyLayerEnabled("starLabels")
    }, now);
    if (constellationLayer) {
        const _skyArea = window.innerWidth * window.innerHeight;
        constellationLayer.declutterStarLabels(camera, window.innerWidth, window.innerHeight, {
            starBudget: skyLayerEnabled("starLabels") ? Math.round(Math.max(10, Math.min(34, _skyArea / 3e4))) : 0,
            constellationBudget: skyLayerEnabled("conLabels") ? Math.round(Math.max(8, Math.min(22, _skyArea / 55e3))) : 0
        });
        if (typeof constellationLayer.updateLabelOcclusion === "function") {
            constellationLayer.updateLabelOcclusion(camera, window.innerWidth, window.innerHeight);
        }
    }
    if (_needsCssLabelsThisFrame) labelRenderer.render(scene, camera);
    updateFocusLine();
    _labelAccum += cappedDelta;
    if (_labelAccum >= (GRAPHICS_LABEL_INTERVAL[textureQuality] ?? LABEL_UPDATE_INTERVAL)) {
        _labelAccum = 0;
        updateLabelVisibility();
    }
    refreshCameraDistance();
    _uiAccum += cappedDelta;
    if (_uiAccum >= .1) {
        _uiAccum = 0;
        refreshDateRow();
    }
}

// One piece of logic, called by the frame loop and by the probes: the shells were
// measured wrong for four rounds because a probe that re-implements this either
// misses a uniform or writes it and has it overwritten on the next frame.
function syncPlanetAtmospheres() {
    if (!_atmosphereKeys) _atmosphereKeys = Object.freeze(Object.keys(PLANET_ATMOSPHERE_PROFILES));
    for (const key of _atmosphereKeys) {
        const atmosphere = cloudMeshes[key + "_atmosphere"];
        const body = objectRegistry[key];
        if (!atmosphere || !body) continue;
        // The surface composite already carries this body's air. Drawing the
        // shell as well would add a second air light over the same pixels.
        if (atmosphere.userData.atmSuppressed) {
            atmosphere.visible = false;
            continue;
        }
        const shellR = atmosphere.geometry?.parameters?.radius || body.geometry?.parameters?.radius || 0;
        // Cull and size in WORLD units. The shell radius is a local one and the far
        // bodies are drawn at a world scale, so feeding the local radius to the
        // world frustum culled the shell out at the focus distance and let it flick
        // on and off as the frustum edge swept past while zooming.
        body.getWorldPosition(_lightingScratchPosition);
        body.getWorldScale(_distTmp);
        const worldR = shellR * Math.max(Math.abs(_distTmp.x), Math.abs(_distTmp.y), Math.abs(_distTmp.z), 1e-12);
        let ownerVisible = body.visible && bodyOnScreen(body, worldR);
        if (key === "earth") ownerVisible = ownerVisible && earthAtmosphereOpacity > .001; else if (key === "venus") ownerVisible = ownerVisible && venusAtmoOpacity > .001;
        let apparentPx = Infinity, insideShell = false;
        if (ownerVisible) {
            camera.getWorldPosition(_vortexCamPos);
            const d = _lightingScratchPosition.distanceTo(_vortexCamPos);
            _atmoViewToBodyMatrix.copy(body.matrixWorld).invert().multiply(camera.matrixWorld);
            const bodyAxes = atmosphere.material.uniforms.uBodyAxisScale.value;
            _atmoCameraBodyMetric.setFromMatrixPosition(_atmoViewToBodyMatrix).divide(bodyAxes);
            insideShell = _atmoCameraBodyMetric.length() < shellR;
            _atmoViewToBodyRotation.setFromMatrix4(_atmoViewToBodyMatrix);
            const vh = renderer.domElement?.clientHeight || window.innerHeight;
            apparentPx = insideShell ? Infinity : camera.projectionMatrix.elements[5] * vh * .5 * worldR / Math.sqrt(Math.max(d * d - worldR * worldR, 1e-20));
        }
        const screenFade = insideShell ? 1 : THREE.MathUtils.smoothstep(apparentPx, 1.6, 3.2);
        atmosphere.visible = ownerVisible && (insideShell || apparentPx >= 1.6);
        if (!atmosphere.visible) continue;
        if (!atmosphere.geometry?.boundingSphere) atmosphere.geometry.computeBoundingSphere();
        const uniforms = atmosphere.material.uniforms;
        const profile = PLANET_ATMOSPHERE_PROFILES[key];
        const atmosphereToggle = key === "earth" ? earthAtmosphereOpacity : key === "venus" ? venusAtmoOpacity : 1;
        const compatibilityGain = key === "earth" || key === "venus" ? 1.08 : 1;
        uniforms.intensity.value = profile.intensity * atmosphereToggle * compatibilityGain * screenFade;
        uniforms.uBodyCenterView.value.copy(_lightingScratchPosition).applyMatrix4(camera.matrixWorldInverse);
        uniforms.uViewToBodyLocal.value.copy(_atmoViewToBodyRotation);
        uniforms.uInsideShell.value = insideShell ? 1 : 0;
        // Eye height above the LOCAL surface in ground radii. Terrain in a basin sits
        // below the datum, and the shader must not clamp the eye radius to 1.0 or the ground test degenerates.
        {
            const bodyR = (typeof bodyWorldRadius === "function" ? bodyWorldRadius(body) : 0) || worldR || 1;
            const clearanceUnits = landingState && landingState.body === body
                ? Math.max(landingState.surfaceClearance || 0, 0)
                : Math.max(_lightingScratchPosition.distanceTo(_vortexCamPos) - bodyR, 0);
            uniforms.uEyeHeightR.value = Math.max(clearanceUnits / Math.max(bodyR, 1e-12), 1e-7);
        // The inside march is the dominant cost in a surface view; keep its
        // sample budget tied to the preset even if the preset changed after the shells were built.
        if (uniforms.uSkySamples) {
            const tier = globalThis.__solisterGraphicsTier;
            uniforms.uSkySamples.value = tier === "low" ? 8 : tier === "medium" ? 16 : 32;
        }
        }
        // Inside the shell the geometry renders at its exit surface, behind the ground,
        // so depth-testing would cull every fragment over the surface and cut the haze
        // at the horizon. Landing haze composites in front: no depth test inside,
        // keep it outside so nearer bodies still occlude the shell.
        atmosphere.material.depthTest = !insideShell;
        // The scene sun has decay 0, so the ground under this shell is lit at one
        // fixed exposure wherever the body is. The atmosphere is lit by that same
        // exposure: an astronomical inverse-square term here put Neptune's shell at
        // 1/900 of Earth's light while it still occluded the disc, which is the
        // black horizon on every giant. Per-body brightness belongs to the profile's
        // optical depth, not to an exposure multiplier.
        uniforms.uSunIntensity.value = 1;
        // uSkyGain is a single physical exposure baked into the material, so
        // there is nothing to recompute here each frame.
        uniforms.uSunDir.value.subVectors(_lightingOrigin, _lightingScratchPosition).normalize().transformDirection(camera.matrixWorldInverse);
    }
}

globalThis.syncPlanetAtmospheres = syncPlanetAtmospheres;

const _atmEyeWorldTmp = new THREE.Vector3();
const _atmEyeLocalTmp = new THREE.Vector3();
const _atmSunDirTmp = new THREE.Vector3();
const _atmBodyWorldTmp = new THREE.Vector3();
const _atmBodyInverse = new THREE.Matrix4();
const _atmCamRot = new THREE.Matrix3();
const _atmBodyRot = new THREE.Matrix3();

// Eye and sun for each body composited on its own surface. Cheap: a few vector
// ops per body per frame, no allocation.
function syncAtmAtmospheres() {
    const entries = globalThis.atmCompositeReady;
    if (!entries || entries.length === 0) return;
    camera.getWorldPosition(_atmEyeWorldTmp);
    for (const entry of entries) {
        const body = entry.body, uniforms = entry.uniforms;
        if (!body || !uniforms) continue;
        body.updateWorldMatrix(true, false);
        // Local space is planet-centred and unscaled, so this is a rotation and
        // a translation away from the eye vector the atmosphere needs.
        _atmEyeLocalTmp.copy(_atmEyeWorldTmp);
        body.worldToLocal(_atmEyeLocalTmp);
        uniforms.uAtmEyeLocalKm.value.copy(_atmEyeLocalTmp).multiplyScalar(uniforms.uAtmKmPerUnit.value);
        body.getWorldPosition(_atmBodyWorldTmp);
        // Where the sun is, by the same definition the shell and the ring shadows
        // use: the sun body's world position. The PointLight is moved around the
        // focused body as a shading proxy and its position is not a reliable
        // stand-in for the sun on every body.
        _atmSunDirTmp.subVectors(_lightingOrigin, _atmBodyWorldTmp);
        if (_atmSunDirTmp.lengthSq() < 1e-20) _atmSunDirTmp.set(1, 0, 0);
        // The shader works in body-local space, so this is world -> local:
        // transformDirection walks local -> world and needs the inverse.
        _atmSunDirTmp.normalize().transformDirection(_atmBodyInverse.copy(body.matrixWorld).invert());
        uniforms.uAtmSunDirLocal.value.copy(_atmSunDirTmp);
        // The sky mesh rebuilds each pixel's ray from its clip position, which
        // needs the projection it was drawn with and the view -> local
        // rotation. Both are per frame, both come from the matrices that were
        // actually used.
        if (uniforms.uAtmRayScale) {
            // NDC times these two slopes is the view-space direction of the
            // pixel's ray, for a perspective camera. An orthographic camera has
            // zeros there, which correctly makes every ray parallel.
            const p = camera.projectionMatrix.elements;
            uniforms.uAtmRayScale.value.set(
                Math.abs(p[0]) > 1e-12 ? 1 / p[0] : 0,
                Math.abs(p[5]) > 1e-12 ? 1 / p[5] : 0);
        }
        if (uniforms.uAtmViewToLocal) {
            _atmCamRot.setFromMatrix4(camera.matrixWorld);
            _atmBodyRot.setFromMatrix4(_atmBodyInverse.copy(body.matrixWorld).invert());
            uniforms.uAtmViewToLocal.value.copy(_atmBodyRot).multiply(_atmCamRot);
        }
        // Exactly the irradiance three hands this body's surface, so the air and
        // the ground agree on how bright the sun is: light colour * intensity *
        // getDistanceAttenuation(), transcribed from three's lights_pars_begin
        // (the non-LEGACY branch). A Color has r/g/b, not x/y/z, so
        // Vector3.copy would write NaN.
        const sunDist = Math.max(sunLight.position.distanceTo(_atmBodyWorldTmp), 1e-6);
        let falloff = 1 / Math.max(Math.pow(sunDist, sunLight.decay), 0.01);
        if (sunLight.distance > 0) {
            const t = Math.max(1 - Math.pow(sunDist / sunLight.distance, 4), 0);
            falloff *= t * t;
        }
        uniforms.uAtmSunIrradiance.value
            .set(sunLight.color.r, sunLight.color.g, sunLight.color.b)
            .multiplyScalar(sunLight.intensity * falloff);
    }
}

globalThis.syncAtmAtmospheres = syncAtmAtmospheres;

function animate(now = performance.now()) {
    requestAnimationFrame(animate);
    const frame = frameStepStart(now);
    if (!frame) return;
    frameStepUpdate(frame.now, frame.cappedDelta);
}

