const CAMERA_NEAR_BODY_KEYS = Object.freeze([ "sun", "mercury", "venus", "earth", "moon", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto" ]);

const _atmoViewToBodyMatrix = new THREE.Matrix4;
const _atmoViewToBodyRotation = new THREE.Matrix3;
const _atmoCameraBodyMetric = new THREE.Vector3;

let _atmosphereKeys = null;

function applyStarVisibility() {
    const mwOn = !!skyToggles.milkyway;
    if (mwOn) {
        scene.background = new THREE.Color(0);
    } else {
        if (!themeGradientTexture) themeGradientTexture = createThemeGradientBackground();
        scene.background = themeGradientTexture;
    }
    if (skyMaps) {
        skyMaps.setLayerVisible("milkyway", mwOn);
        if (mwOn) {
            skyMaps.setMilkywayExposure(12.5);
            if (milkyWayTexture && !skyMaps.layerReady("milkyway")) {
                skyMaps.adoptTexture("milkyway", milkyWayTexture, skyTexRes());
            }
        }
    }
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
    const dimFactor = 1 - .22 * sunDimAmt;
    for (const item of root.userData.flareItems || []) {
        const xNdc = sunNdc.x * item.factor;
        const yNdc = sunNdc.y * item.factor;
        item.sprite.position.set(xNdc * depth * tanHalfFov * aspect, yNdc * depth * tanHalfFov, -depth);
        const sizePx = Math.max(8, item.px + item.distancePx * range + item.sunScale * apparentRadiusPx);
        item.sprite.scale.set(sizePx * worldPerPixel, sizePx * item.aspect * worldPerPixel, 1);
        item.sprite.material.rotation = flareAngle + item.rotation;
        item.sprite.material.opacity = item.opacity * (.82 + .18 * range) * dimFactor;
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

function frameStepUpdate(now, cappedDelta) {
    simTimeMs = clampSimulationDate(simTimeMs);
    const requestedRate = timeScale;
    const allowedRate = extraBodies.limitRate(Math.abs(requestedRate), cappedDelta, focusedObject?.userData.planetKey);
    simTimeMs = solarAccuracy.tick(simTimeMs, cappedDelta, requestedRate < 0 ? -allowedRate : allowedRate, isPaused, {
        focusedKey: focusedObject?.userData.planetKey,
        beltCloseUp: focusedObject?.userData.planetKey === "asteroidbelt" && camera.position.distanceTo(controls.target) < km2u(1e4),
        camera: camera,
        showOrbits: showOrbits && pathSettings.style === "orbits"
    });
    objectRegistry.sun?.getWorldPosition(_lightingOrigin);
    bodyOrientation.applyAll(objectRegistry, simTimeMs);
    updateAsteroidBelt(cappedDelta);
    earthCloudsOpacity = stepFade(earthCloudsOpacity, earthCloudsEnabled, cappedDelta);
    earthAtmosphereOpacity = stepFade(earthAtmosphereOpacity, earthAtmosphereEnabled, cappedDelta, 3);
    const earthCloud = cloudMeshes["earth"];
    if (earthCloud) {
        earthCloud.visible = earthCloudsOpacity > .001;
        earthCloud.material.opacity = .58 * earthCloudsOpacity;
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
    if (focusedObject?.userData.isComet && !focusedObject.visible) releaseFocus();
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
        const e = p * p * p * (p * (p * 6 - 15) + 10);
        let toTarget = camTransition.toTargetBase;
        let toCam = camTransition.toCamBase;
        if (focusedObject) {
            focusedObject.getWorldPosition(_ctNow);
            _ctDelta.subVectors(_ctNow, camTransition.planetStart);
            toTarget = _ctToTarget.copy(camTransition.toTargetBase).add(_ctDelta);
            toCam = _ctToCam.copy(camTransition.toCamBase).add(_ctDelta);
        }
        controls.target.lerpVectors(camTransition.fromTarget, toTarget, e);
        _ctOffsetFrom.subVectors(camTransition.fromCam, camTransition.fromTarget);
        _ctOffsetTo.subVectors(toCam, toTarget);
        const fromLength = _ctOffsetFrom.length();
        const toLength = _ctOffsetTo.length();
        if (fromLength > 1e-9 && toLength > 1e-9) {
            _ctDirFrom.copy(_ctOffsetFrom).divideScalar(fromLength);
            _ctDirTo.copy(_ctOffsetTo).divideScalar(toLength);
            _ctQuatSpin.setFromUnitVectors(_ctDirFrom, _ctDirTo);
            _ctArc.copy(_ctDirFrom).applyQuaternion(_ctQuatStep.identity().slerp(_ctQuatSpin, e));
            _ctBowAxis.subVectors(camTransition.toTargetBase, camTransition.fromTarget).cross(_ctDirTo);
            if (_ctBowAxis.lengthSq() > 1e-12) {
                _ctArc.addScaledVector(_ctBowAxis.normalize(), CAMERA_ARC_BOW * Math.sin(Math.PI * e));
            }
            _ctArc.normalize();
            camera.position.copy(controls.target).addScaledVector(_ctArc, fromLength + (toLength - fromLength) * e);
        } else {
            camera.position.lerpVectors(camTransition.fromCam, toCam, e);
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
            controls.target.add(_followDelta);
            camera.position.add(_followDelta);
            previous.copy(_followPosition);
        } else {
            focusedObject.userData._prevPos = _followPosition.clone();
        }
    }
    if (landingState) {
        controls.minDistance = 1e-8;
    } else if (focusedObject && !camTransition && _focusBounds) {
        controls.minDistance = _focusBounds.min;
        if (zoomDistTarget !== null) zoomDistTarget = Math.max(controls.minDistance, zoomDistTarget);
    }
    {
        const focusRadius = focusedObject ? focusedObject.userData.focusRadius ?? focusedObject.geometry?.parameters?.radius ?? 1 : 1;
        const distToTarget = camera.position.distanceTo(controls.target);
        const proximity = Math.max(distToTarget / Math.max(focusRadius, 1e-9), 1);
        controls.rotateSpeed = .72 * Math.min(1, Math.pow(proximity / 6, .55));
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
            wantNear = Math.min(wantNear, Math.max(1e-12, bodyWorldRadius(landingBody) * 1e-8));
        }
        if (sunObj) {
            sunObj.getWorldPosition(_lightingScratchPosition);
            const sunSurf = camera.position.distanceTo(_lightingScratchPosition) - sunObj.geometry.parameters.radius;
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
        s.userData.ringOcclusionUniforms?.uOccCenter.value.copy(saturnRingMat.userData.uSaturnPos.value);
        const actualRing = objectRegistry["saturn-ring"];
        actualRing.updateWorldMatrix(true, false);
        saturnMat.userData.uRingNormal.value.set(0, 0, 1).transformDirection(actualRing.matrixWorld);
    }
    if (objectRegistry["uranus"] && objectRegistry["uranus-ring"]) {
        const uu = objectRegistry["uranus"].userData.ringShadowUniforms;
        if (uu) {
            const um = objectRegistry["uranus"];
            const ur = objectRegistry["uranus-ring"];
            um.getWorldPosition(uu.uRingCenter.value);
            um.userData.ringOcclusionUniforms?.uOccCenter.value.copy(uu.uRingCenter.value);
            ur.updateWorldMatrix(true, false);
            uu.uRingNormal.value.set(0, 0, 1).transformDirection(ur.matrixWorld);
        }
    }
    if (objectRegistry["neptune"] && objectRegistry["neptune-ring"]) {
        const nu = objectRegistry["neptune"].userData.ringShadowUniforms;
        if (nu) {
            const nm = objectRegistry["neptune"];
            const nr = objectRegistry["neptune-ring"];
            nm.getWorldPosition(nu.uRingCenter.value);
            nm.userData.ringOcclusionUniforms?.uOccCenter.value.copy(nu.uRingCenter.value);
            nr.updateWorldMatrix(true, false);
            nu.uRingNormal.value.set(0, 0, 1).transformDirection(nr.matrixWorld);
        }
    }
    ensurePlanetOccluders(objectRegistry);
    updatePlanetOccluders();
    if (objectRegistry["earth"] && objectRegistry["moon"] && earthMat) {
        objectRegistry["moon"].getWorldPosition(_moonWorldTmp);
        earthMat.userData.uMoonPos.value.copy(_moonWorldTmp);
    }
    let earthSunDistance = 1;
    if (objectRegistry.earth) {
        objectRegistry.earth.getWorldPosition(_lightingScratchPosition);
        earthSunDistance = _lightingScratchPosition.distanceTo(_lightingOrigin);
    }
    if (!_atmosphereKeys) _atmosphereKeys = Object.freeze(Object.keys(PLANET_ATMOSPHERE_PROFILES));
    for (const key of _atmosphereKeys) {
        const atmosphere = cloudMeshes[key + "_atmosphere"];
        const body = objectRegistry[key];
        if (!atmosphere || !body) continue;
        const shellR = atmosphere.geometry?.parameters?.radius || body.geometry?.parameters?.radius || 0;
        let ownerVisible = body.visible && bodyOnScreen(body, shellR);
        if (key === "earth") ownerVisible = ownerVisible && earthAtmosphereOpacity > .001; else if (key === "venus") ownerVisible = ownerVisible && venusAtmoOpacity > .001;
        let apparentPx = Infinity, insideShell = false;
        if (ownerVisible) {
            body.getWorldPosition(_lightingScratchPosition);
            camera.getWorldPosition(_vortexCamPos);
            body.getWorldScale(_distTmp);
            const worldR = shellR * Math.max(Math.abs(_distTmp.x), Math.abs(_distTmp.y), Math.abs(_distTmp.z), 1e-12);
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
        const sunDistance = Math.max(_lightingScratchPosition.distanceTo(_lightingOrigin), 1e-8);
        uniforms.uSunIntensity.value = Math.min(4, Math.max(.0025, (earthSunDistance / sunDistance) ** 2));
        uniforms.uSunDir.value.subVectors(_lightingOrigin, _lightingScratchPosition).normalize().transformDirection(camera.matrixWorldInverse);
    }
    sunCoronaFade = stepFade(sunCoronaFade, sunCoronaEnabled, cappedDelta, 2.5);
    if (sunCoronaMesh) {
        objectRegistry["sun"].getWorldPosition(sunCoronaMesh.material.uniforms.uSunCenter.value);
        const _sunR = objectRegistry["sun"].geometry.parameters.radius || 1;
        const _corona = sunCoronaMesh.userData.coronaProfile;
        const _camPos = _lightingScratchPosition;
        camera.getWorldPosition(_camPos);
        const _sunPos = _lightingScratchDirection;
        objectRegistry["sun"].getWorldPosition(_sunPos);
        const _distanceR = _camPos.distanceTo(_sunPos) / _sunR;
        const _distanceMix = sunDistanceBlend(_distanceR);
        const _shellScale = 1.08 + (_corona.shellScale - 1.08) * _distanceMix;
        const _shellBoost = _shellScale / _corona.shellScale;
        sunCoronaMesh.scale.setScalar(_shellBoost);
        sunCoronaMesh.material.uniforms.uShellRadius.value = _sunR * _shellScale;
        sunCoronaMesh.material.uniforms.intensity.value = _corona.intensity * sunCoronaFade;
        sunCoronaMesh.material.uniforms.uStreamers.value = _corona.streamers * (GRAPHICS_STREAMERS[textureQuality] ?? 1);
        sunCoronaMesh.material.uniforms.uDistGain.value = 1 + 1.4 * _distanceMix;
        sunCoronaMesh.material.uniforms.uTime.value = now / 1e3;
        sunCoronaMesh.visible = sunCoronaMesh.material.uniforms.intensity.value > .001 && bodyOnScreen(objectRegistry.sun, _sunR * _shellScale);
    }
    if (objectRegistry["sun"]) {
        const _s = objectRegistry["sun"];
        _s.getWorldPosition(_sunLookPos);
        _sunLookScr.copy(_sunLookPos).project(camera);
        const _vw = renderer.domElement.clientWidth || window.innerWidth;
        const _vh = renderer.domElement.clientHeight || window.innerHeight;
        const _foc = .5 * _vh * camera.projectionMatrix.elements[5];
        const _sR = (_s.geometry && _s.geometry.parameters ? _s.geometry.parameters.radius : 1) || 1;
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
        if (sunHaloMesh) {
            const haloRadiusPx = 6 + 22 * _sunDistanceMix;
            sunHaloMesh.material.uniforms.uSunCenter.value.copy(_sunLookPos);
            sunHaloMesh.material.uniforms.uViewport.value.set(_vw, _vh);
            sunHaloMesh.material.uniforms.uHaloRadius.value = haloRadiusPx;
            sunHaloMesh.material.uniforms.uGain.value = .65 * (1 + 1.6 * _sunDistanceMix);
            sunHaloMesh.visible = sunCoronaFade > .01 && facing && _sunLookScr.z < 1 && _sunLookScr.z > -1 && _sx > -haloRadiusPx && _sx < _vw + haloRadiusPx && _sy > -haloRadiusPx && _sy < _vh + haloRadiusPx;
        }
        updateSunLensArtifacts(_sunLookScr, inView, _sunDistanceMix, _sPx);
        const _cent = 1 - Math.min(1, Math.hypot(_sx - _vw * .5, _sy - _vh * .5) / (.5 * Math.hypot(_vw, _vh)));
        const _dimByDist = SUN_DIM_MAX * (1 - THREE.MathUtils.smoothstep(_sDist / _sR, SUN_DIM_NEAR_R, SUN_DIM_FAR_R));
        let _dimTarget = 0;
        if (inView && _dimByDist > 0) {
            _dimTarget = _dimByDist * THREE.MathUtils.smoothstep(_cent, 0, .25);
            const _gx = Math.round(_sx), _gy = Math.round(_sy), _gr = Math.round(_sPx);
            const _gClear = Math.round(_sPx * (1 + (SUN_DIM_CLEAR_R - 1) * sunCoronaFade));
            const _gOuter = Math.round(_sPx * (1.1 + (SUN_DIM_OUTER_R - 1.1) * sunCoronaFade));
            if (sunDimEl._lastGx !== _gx || sunDimEl._lastGy !== _gy || sunDimEl._lastGr !== _gr || sunDimEl._lastGClear !== _gClear || sunDimEl._lastGOuter !== _gOuter) {
                sunDimEl._lastGx = _gx;
                sunDimEl._lastGy = _gy;
                sunDimEl._lastGr = _gr;
                sunDimEl._lastGClear = _gClear;
                sunDimEl._lastGOuter = _gOuter;
                sunDimEl.style.background = "radial-gradient(circle at " + _gx + "px " + _gy + "px, rgba(0,0,0,0) " + _gClear + "px, rgba(0,0,0,0.99) " + _gOuter + "px)";
            }
        }
        sunDimAmt += (_dimTarget - sunDimAmt) * (1 - Math.exp(-5 * cappedDelta));
        const _opQ = sunDimAmt.toFixed(2);
        if (sunDimEl._lastOp !== _opQ) {
            sunDimEl._lastOp = _opQ;
            sunDimEl.style.opacity = _opQ;
        }
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
    hdrPipeline.render(scene, camera, cappedDelta);
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

function animate(now = performance.now()) {
    requestAnimationFrame(animate);
    const frame = frameStepStart(now);
    if (!frame) return;
    frameStepUpdate(frame.now, frame.cappedDelta);
}
