const CAMERA_NEAR_BODY_KEYS = Object.freeze([
    'sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter',
    'saturn', 'uranus', 'neptune', 'pluto',
]);
function applyStarVisibility() {
    const mwOn = !!(skyToggles.milkyway);
    if (mwOn) {
        scene.background = new THREE.Color(0x000000);
    } else {
        if (!themeGradientTexture) themeGradientTexture = createThemeGradientBackground();
        scene.background = themeGradientTexture;
    }
    if (skyMaps) {
        skyMaps.setLayerVisible('milkyway', mwOn);
        if (mwOn) {
            skyMaps.setMilkywayExposure(12.5);
            if (milkyWayTexture && !skyMaps.layerReady('milkyway')) {
                skyMaps.adoptTexture('milkyway', milkyWayTexture, skyTexRes());
            }
        }
    }
}
function stepFade(current, enabled, dt, speed = CLOUD_FADE_SPEED) {
    const target = enabled ? 1.0 : 0.0;
    let next = current + (target - current) * (1 - Math.exp(-speed * dt));
    if (!enabled && next < 0.005) next = 0.0;
    if (enabled && next > 0.995) next = 1.0;
    return next;
}
function sunDistanceBlend(distanceInSolarRadii) {
    const logDistance = Math.log2(Math.max(1.0, distanceInSolarRadii));
    return THREE.MathUtils.smoothstep(logDistance, Math.log2(2.0), Math.log2(8192.0));
}
function updateSunLensArtifacts(sunNdc, visible, distanceMix) {
    const points = sunLensArtifacts;
    if (!points) return;
    const gain = points.material?.uniforms?.uGain;
    if (!visible) {
        if (gain) gain.value = 0.0;
        return;
    }
    const position = points.geometry?.getAttribute('position');
    if (!position) return;
    const factors = points.userData.flareFactors;
    const offsets = points.userData.flareOffsets;
    const depth = 2.0;
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const aspect = Math.max(1e-6, camera.aspect || 1.0);
    for (let i = 0; i < factors.length; i++) {
        const xNdc = sunNdc.x * factors[i] + offsets[i];
        const yNdc = sunNdc.y * factors[i] + offsets[i + factors.length];
        position.setXYZ(i, xNdc * depth * tanHalfFov * aspect,
            yNdc * depth * tanHalfFov, -depth);
    }
    position.needsUpdate = true;
    if (gain) gain.value = (0.72 + 0.22 * distanceMix) * (1.0 - 0.28 * sunDimAmt);
    const pixelRatio = points.material?.uniforms?.uPixelRatio;
    if (pixelRatio) pixelRatio.value = renderer?.getPixelRatio?.() || 1.0;
}
function frameStepStart(now) {
    if (_contextLost) return null;
    updateMusicEnvelope();
    if (!performanceDefaults.shouldRender(now, document.hidden, targetFps)) return null;
    const delta = clock.getDelta();
    const cappedDelta = Math.min(delta, 0.1);
    camera.updateMatrixWorld();
    focusLodTick();
    _cullMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _cullFrustum.setFromProjectionMatrix(_cullMat);
    return { now, cappedDelta };
}
function frameStepUpdate(now, cappedDelta) {
    simTimeMs = clampSimulationDate(simTimeMs);
    const requestedRate = timeScale;
    const allowedRate = extraBodies.limitRate(Math.abs(requestedRate), cappedDelta,
        focusedObject?.userData.planetKey);
    simTimeMs = solarAccuracy.tick(
        simTimeMs, cappedDelta, requestedRate < 0 ? -allowedRate : allowedRate, isPaused, {
            focusedKey: focusedObject?.userData.planetKey,
            beltCloseUp: focusedObject?.userData.planetKey === 'asteroidbelt' &&
                camera.position.distanceTo(controls.target) < km2u(10000),
            camera,
            showOrbits: showOrbits && pathSettings.style === 'orbits'
        }
    );
    objectRegistry.sun?.getWorldPosition(_lightingOrigin);
    bodyOrientation.applyAll(objectRegistry, simTimeMs);
    updateAsteroidBelt(cappedDelta);
    earthCloudsOpacity = stepFade(earthCloudsOpacity, earthCloudsEnabled, cappedDelta);
    const earthCloud = cloudMeshes['earth'];
    if (earthCloud) {
        earthCloud.visible = earthCloudsOpacity > 0.001;
        earthCloud.material.opacity = 0.90 * earthCloudsOpacity;
        earthCloud.material.emissiveIntensity = 0.2 * earthCloudsOpacity;
    }
    const earthAtmo = cloudMeshes['earth_atmosphere'];
    if (earthAtmo) {
        earthAtmo.visible = earthCloudsOpacity > 0.001;
        earthAtmo.material.uniforms.intensity.value =
            PLANET_ATMOSPHERE_PROFILES.earth.intensity * earthCloudsOpacity * 0.90;
    }
    venusAtmoOpacity = stepFade(venusAtmoOpacity, venusAtmoEnabled, cappedDelta);
    const venusAtmo = cloudMeshes['venus'];
    if (venusAtmo && venusAtmo.material.uniforms) {
        applyVenusAtmosphereOpacity(venusAtmo, venusAtmoOpacity);
    }
    const venusScattering = cloudMeshes['venus_atmosphere'];
    if (venusScattering) {
        venusScattering.visible = venusAtmoOpacity > 0.001;
        venusScattering.material.uniforms.intensity.value =
            PLANET_ATMOSPHERE_PROFILES.venus.intensity * venusAtmoOpacity * 0.90;
    }
    if (focusedObject?.userData.approximate && !focusedObject.visible) releaseFocus();
    if (focusedObject?.userData.isEphemerisMoon && !solarAccuracy.available) resetCamera();
    if (focusedObject?.userData.extraEphemeris &&
        !extraBodies.inCoverage(solarAccuracy.snapshot?.ms ?? simTimeMs, focusedObject.userData.planetKey)) {
        unfocusBtn.click();
    }
    extraBodies.update({
        ms: solarAccuracy.snapshot?.ms ?? simTimeMs,
        et: solarAccuracy.snapshot?.et,
        available: solarAccuracy.available,
        showLabels
    });
    cometLayer.update({
        ms: solarAccuracy.snapshot?.ms ?? simTimeMs,
        et: solarAccuracy.snapshot?.et, available: solarAccuracy.available,
        showOrbits, style: pathSettings.style, length: pathSettings.length, delta: cappedDelta
    });
    if (focusedObject?.userData.isComet && !focusedObject.visible) releaseFocus();
    if (asteroidsEnabled) {
        const wallNow = now;
        const simMoved = Math.abs(simTimeMs - _lastCatalogSimMs) > 30 * 60 * 1000;
        if (_lastCatalogWall === 0 || wallNow - _lastCatalogWall >= CATALOG_UPDATE_MS || simMoved) {
            _lastCatalogWall = wallNow;
            _lastCatalogSimMs = simTimeMs;
            resonantPopulations.update({
                available: solarAccuracy.available,
                et: solarAccuracy.snapshot?.et,
                enabled: asteroidsEnabled,
                markersEnabled: beltGuideEnabled,
                groupOn: {
                    trojanl4: asteroidTypeEnabled('trojanl4'),
                    trojanl5: asteroidTypeEnabled('trojanl5'),
                    hildas: asteroidTypeEnabled('hildas')
                }
            });
            nearEarth.update({ et: solarAccuracy.snapshot?.et,
                enabled: asteroidTypeEnabled('nea') });
            kuiperBelt.update({
                enabled: asteroidTypeEnabled('kuiperbelt'),
                et: solarAccuracy.available ? solarAccuracy.snapshot?.et : NaN,
                showLabels, focusedKey: focusedObject?.userData.planetKey
            });
        }
    }
    enforceAsteroidVisibility();
    if (camTransition) {
        camTransition.t += Math.min(cappedDelta, 1 / 30);
        const p = Math.min(camTransition.t / camTransition.duration, 1);
        const e = p * p * p * (p * (p * 6 - 15) + 10);
        if (_camFovBase === 0) _camFovBase = camera.fov;
        camera.fov = _camFovBase * (1 + CAMERA_FOV_BREATH * Math.sin(Math.PI * p));
        camera.updateProjectionMatrix();
        let toTarget = camTransition.toTargetBase;
        let toCam    = camTransition.toCamBase;
        if (focusedObject) {
            focusedObject.getWorldPosition(_ctNow);
            _ctDelta.subVectors(_ctNow, camTransition.planetStart);
            toTarget = _ctToTarget.copy(camTransition.toTargetBase).add(_ctDelta);
            toCam    = _ctToCam.copy(camTransition.toCamBase).add(_ctDelta);
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
                focusedObject.userData._prevPos = focusedObject.userData._prevPos || new THREE.Vector3();
                focusedObject.userData._prevPos.copy(_ctNow);
            }
        }
    } else if (_camFovBase !== 0) {
        camera.fov = _camFovBase;
        camera.updateProjectionMatrix();
        _camFovBase = 0;
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
    // Sense of scale: orbiting a body must feel like orbiting something
    // massive. Close to the surface the same drag used to whip the camera
    // around a planet in a second, reading as a small toy ball; the orbit
    // sensitivity now scales with distance-from-surface so near-surface
    // passes glide slowly (huge) while the default 6-radius framing keeps
    // the usual responsiveness.
    {
        const focusRadius = focusedObject
            ? (focusedObject.userData.focusRadius ??
               focusedObject.geometry?.parameters?.radius ?? 1)
            : 1;
        const distToTarget = camera.position.distanceTo(controls.target);
        const proximity = Math.max(distToTarget / Math.max(focusRadius, 1e-9), 1);
        controls.rotateSpeed = 0.72 * Math.min(1, Math.pow(proximity / 6, 0.55));
    }
    updateCameraOrbitTarget();
    updateLandingPose();
    const frameRotateSpeed = controls.autoRotateSpeed;
    controls.autoRotateSpeed = frameRotateSpeed * cappedDelta * 60;
    controls.dampingFactor = 1 - Math.pow(0.95, cappedDelta * 60);
    controls.update();
    controls.autoRotateSpeed = frameRotateSpeed;
    if (zoomDistTarget !== null && !camTransition) {
        const curDist = camera.position.distanceTo(controls.target);
        const newDist = curDist + (zoomDistTarget - curDist)
                      * (1 - Math.exp(-ZOOM_EASE_RATE * cappedDelta));
        _zoomDir.subVectors(camera.position, controls.target).normalize();
        camera.position.copy(controls.target).addScaledVector(_zoomDir, newDist);
        if (Math.abs(newDist - zoomDistTarget) < Math.max(1e-10, zoomDistTarget * 0.00001)) {
            zoomDistTarget = null;
        }
    }
    updateCameraNavigation(cappedDelta);
    clampCameraToSystem();
    preventCameraClipping(cappedDelta);
    clampCameraToSystem();
    captureLandingPose();
    rebaseFloatingOrigin();
    {
        const sunObj  = objectRegistry['sun'];
        const camDist = camera.position.distanceTo(controls.target);
        const asteroidCloseUp = focusedObject?.userData.planetKey === 'asteroidbelt';
        const focusedRadius = focusedObject?.userData.focusRadius ??
            focusedObject?.geometry?.parameters?.radius ?? 0.2;
        const minimumNear = asteroidCloseUp ? 1e-8 :
            Math.max(1e-8, focusedRadius * 1e-8);
        // Keep the near plane many orders of magnitude closer than the camera
        // target. The renderer uses logarithmic depth, so this preserves depth
        // precision while preventing close ring particles and inner ring edges
        // from being sliced by a conventional near clip plane.
        let wantNear = Math.max(minimumNear, Math.min(50, camDist * 1e-5));
        // Also account for free-flight views where the camera target is still
        // the Sun/system center. Include ring outer radii: a camera inside an
        // annulus must not inherit a large near plane from that distant target.
        let nearestBodyClearance = Infinity;
        for (const key of CAMERA_NEAR_BODY_KEYS) {
            const body = objectRegistry[key];
            if (!body?.visible) continue;
            body.getWorldPosition(_lightingScratchPosition);
            body.getWorldScale(_lightingScratchDirection);
            const worldScale = Math.max(Math.abs(_lightingScratchDirection.x),
                Math.abs(_lightingScratchDirection.y), Math.abs(_lightingScratchDirection.z));
            let extent = bodyWorldRadius(body);
            const ringOuter = body.userData?.ringMesh?.geometry?.parameters?.outerRadius;
            if (ringOuter > 0) extent = Math.max(extent, ringOuter * worldScale);
            nearestBodyClearance = Math.min(nearestBodyClearance,
                Math.max(0, camera.position.distanceTo(_lightingScratchPosition) - extent));
        }
        if (Number.isFinite(nearestBodyClearance)) {
            wantNear = Math.min(wantNear, Math.max(minimumNear, nearestBodyClearance * 0.05));
        }
        const landingBody = landingState?.body || camTransition?.landing?.body;
        if (landingBody) {
            wantNear = Math.min(wantNear, Math.max(1e-12, bodyWorldRadius(landingBody) * 1e-8));
        }
        if (sunObj) {
            sunObj.getWorldPosition(_lightingScratchPosition);
            const sunSurf = camera.position.distanceTo(_lightingScratchPosition) - sunObj.geometry.parameters.radius;
            if (sunSurf > minimumNear * 2) {
                wantNear = Math.min(wantNear, sunSurf * 0.9);
            }
        }
        if (Math.abs(camera.near - wantNear) > wantNear * 0.0001) {
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
    if (objectRegistry['earth'] && objectRegistry['earth'].userData.nightMesh) {
        const earth = objectRegistry['earth'];
        const nightMesh = earth.userData.nightMesh;
        const earthPos = _lightingScratchPosition;
        earth.getWorldPosition(earthPos);
        const dir = _lightingScratchDirection.subVectors(_lightingOrigin, earthPos).normalize();
        nightMesh.material.uniforms.sunDirection.value.copy(dir);
    }
    if (objectRegistry['saturn'] && saturnMat && saturnRingMat) {
        if (objectRegistry['earth'] && objectRegistry['moon'] && moonMat) {
            objectRegistry['earth'].getWorldPosition(moonMat.userData.uEarthPos.value);
        }
        const s = objectRegistry['saturn'];
        s.getWorldPosition(saturnMat.userData.uSaturnCenter.value);
        saturnMat.userData.uRingTex.value = objectRegistry['saturn-ring'].material.map;
        s.getWorldPosition(saturnRingMat.userData.uSaturnPos.value);
        s.userData.ringOcclusionUniforms?.uOccCenter.value.copy(saturnRingMat.userData.uSaturnPos.value);
        const actualRing = objectRegistry['saturn-ring'];
        actualRing.updateWorldMatrix(true, false);
        saturnMat.userData.uRingNormal.value.set(0, 0, 1).transformDirection(actualRing.matrixWorld);
    }
    if (objectRegistry['uranus'] && objectRegistry['uranus-ring']) {
        const uu = objectRegistry['uranus'].userData.ringShadowUniforms;
        if (uu) {
            const um = objectRegistry['uranus'];
            const ur = objectRegistry['uranus-ring'];
            um.getWorldPosition(uu.uRingCenter.value);
            um.userData.ringOcclusionUniforms?.uOccCenter.value.copy(uu.uRingCenter.value);
            ur.updateWorldMatrix(true, false);
            uu.uRingNormal.value.set(0, 0, 1).transformDirection(ur.matrixWorld);
        }
    }
    if (objectRegistry['neptune'] && objectRegistry['neptune-ring']) {
        const nu = objectRegistry['neptune'].userData.ringShadowUniforms;
        if (nu) {
            const nm = objectRegistry['neptune'];
            const nr = objectRegistry['neptune-ring'];
            nm.getWorldPosition(nu.uRingCenter.value);
            nm.userData.ringOcclusionUniforms?.uOccCenter.value.copy(nu.uRingCenter.value);
            nr.updateWorldMatrix(true, false);
            nu.uRingNormal.value.set(0, 0, 1).transformDirection(nr.matrixWorld);
        }
    }
    // Universal analytic occlusion (permanent depth-precision fix): moons and
    // dwarf planets occluded by their parent, planets by the sun — exact at
    // every zoom level, independent of the degenerate depth buffer.
    ensurePlanetOccluders(objectRegistry);
    updatePlanetOccluders();
    if (objectRegistry['earth'] && objectRegistry['moon'] && earthMat) {
        objectRegistry['moon'].getWorldPosition(_moonWorldTmp);
        earthMat.userData.uMoonPos.value.copy(_moonWorldTmp);
    }
    if (venusAtmo?.material?.uniforms && objectRegistry.venus) {
        objectRegistry.venus.getWorldPosition(_lightingScratchPosition);
        venusAtmo.material.uniforms.uVenusCenter.value.copy(_lightingScratchPosition);
        venusAtmo.material.uniforms.uSunDir.value
            .subVectors(_lightingOrigin, _lightingScratchPosition).normalize();
    }
    for(const key of Object.keys(PLANET_ATMOSPHERE_PROFILES)){
        const atmosphere=cloudMeshes[key+'_atmosphere'];
        const body=objectRegistry[key];
        if(!atmosphere||!body)continue;
        // Screen-size gate: below ~2 px the body itself is sub-pixel and the
        // glow marker carries the presentation — skip the shell entirely.
        const shellR=atmosphere.geometry?.parameters?.radius||body.geometry?.parameters?.radius||0;
        let ownerVisible=body.visible&&bodyOnScreen(body,shellR);
        if(key==='earth')ownerVisible=ownerVisible&&earthCloudsOpacity>0.001;
        else if(key==='venus')ownerVisible=ownerVisible&&venusAtmoOpacity>0.001;
        let apparentPx=Infinity,insideShell=false;
        if(ownerVisible){
            body.getWorldPosition(_lightingScratchPosition);
            camera.getWorldPosition(_vortexCamPos);
            body.getWorldScale(_distTmp);
            const worldR=shellR*Math.max(_distTmp.x,_distTmp.y,_distTmp.z,1e-12);
            const d=_lightingScratchPosition.distanceTo(_vortexCamPos);
            insideShell=d<worldR;
            const vh=renderer.domElement?.clientHeight||window.innerHeight;
            apparentPx=insideShell
                ?Infinity
                :camera.projectionMatrix.elements[5]*vh*0.5*worldR/Math.sqrt(Math.max(d*d-worldR*worldR,1e-20));
        }
        atmosphere.visible=ownerVisible&&apparentPx>=1.6;
        if(!atmosphere.visible)continue;
        // Flip the shell when the camera dives inside it so the scattering
        // sky still surrounds the viewer at the surface.
        const wantSide=insideShell?THREE.BackSide:THREE.FrontSide;
        if(atmosphere.material.side!==wantSide)atmosphere.material.side=wantSide;
        if(!atmosphere.geometry?.boundingSphere)atmosphere.geometry.computeBoundingSphere();
        const uniforms=atmosphere.material.uniforms;
        uniforms.uBodyCenterView.value.copy(_lightingScratchPosition).applyMatrix4(camera.matrixWorldInverse);
        uniforms.uSunDir.value.subVectors(_lightingOrigin,_lightingScratchPosition).normalize().transformDirection(camera.matrixWorldInverse);
    }
    sunCoronaFade = stepFade(sunCoronaFade, sunCoronaEnabled, cappedDelta, 2.5);
    {
        const sunObj = objectRegistry['sun'];
        const uniforms = sunObj?.material?.uniforms;
        if (uniforms?.uTime) uniforms.uTime.value = now / 1000;
        if (uniforms?.uFocusGlow && sunObj) {
            const sunPos = sunObj.getWorldPosition(_lightingScratchPosition);
            const radius = sunObj.geometry?.parameters?.radius || 1;
            const distanceR = camera.position.distanceTo(sunPos) / radius;
            const nearSurface = 1 - THREE.MathUtils.smoothstep(distanceR, 2.0, 12.0);
            const focusedSun = focusedObject === sunObj || focusedObject?.userData?.planetKey === 'sun';
            const target = Math.max(nearSurface * 0.82, focusedSun ? 0.35 + nearSurface * 0.65 : 0);
            const current = uniforms.uFocusGlow.value;
            uniforms.uFocusGlow.value = current + (target - current) * (1 - Math.exp(-2.7 * cappedDelta));
        }
    }
    if (sunCoronaMesh) {
        objectRegistry['sun'].getWorldPosition(
            sunCoronaMesh.material.uniforms.uSunCenter.value
        );
        const _sunR = objectRegistry['sun'].geometry.parameters.radius || 1;
        const _corona = sunCoronaMesh.userData.coronaProfile;
        const _camPos = _lightingScratchPosition;
        camera.getWorldPosition(_camPos);
        const _sunPos = _lightingScratchDirection;
        objectRegistry['sun'].getWorldPosition(_sunPos);
        const _distanceR = _camPos.distanceTo(_sunPos) / _sunR;
        const _distanceMix = sunDistanceBlend(_distanceR);
        const _shellBoost = 1.0 + 0.25 * _distanceMix;
        sunCoronaMesh.scale.setScalar(_shellBoost);
        sunCoronaMesh.material.uniforms.uShellRadius.value =
            _sunR * _corona.shellScale * _shellBoost;
        sunCoronaMesh.material.uniforms.intensity.value =
            _corona.intensity * sunCoronaFade;
        sunCoronaMesh.material.uniforms.uStreamers.value =
            _corona.streamers * (GRAPHICS_STREAMERS[textureQuality] ?? 1.0);
        // A smooth, logarithmic distance response: quiet close up, much fuller
        // in system views, with the same physical photosphere underneath.
        sunCoronaMesh.material.uniforms.uDistGain.value = 1.0 + 2.5 * _distanceMix;
        sunCoronaMesh.material.uniforms.uTime.value = now / 1000;
        sunCoronaMesh.visible = sunCoronaMesh.material.uniforms.intensity.value > 0.001 &&
            bodyOnScreen(objectRegistry.sun, _sunR * _corona.shellScale * _shellBoost);
    }
    if (sunHaloMesh) {
        objectRegistry['sun'].getWorldPosition(sunHaloMesh.material.uniforms.uSunCenter.value);
        const _sunR = objectRegistry['sun'].geometry.parameters.radius || 1;
        const _camPos = _lightingScratchPosition;
        camera.getWorldPosition(_camPos);
        const _sunPos = _lightingScratchDirection;
        objectRegistry['sun'].getWorldPosition(_sunPos);
        const _distanceMix = sunDistanceBlend(_camPos.distanceTo(_sunPos) / _sunR);
        // The expanded halo uses a broad, smooth falloff and strengthens with
        // range, so the photosphere never appears separated from its glow.
        const _haloRadius = _sunR * (7.0 + 3.0 * _distanceMix);
        sunHaloMesh.material.uniforms.uHaloRadius.value = _haloRadius;
        sunHaloMesh.material.uniforms.uGain.value = 1.35 * (1.0 + 2.5 * _distanceMix);
        sunHaloMesh.visible = sunCoronaFade > 0.01 && bodyOnScreen(objectRegistry.sun, _haloRadius);
    }
    if (objectRegistry['sun']) {
        const _s = objectRegistry['sun'];
        _s.getWorldPosition(_sunLookPos);
        _sunLookScr.copy(_sunLookPos).project(camera);
        const _vw = renderer.domElement.clientWidth || window.innerWidth;
        const _vh = renderer.domElement.clientHeight || window.innerHeight;
        const _foc = 0.5 * _vh * camera.projectionMatrix.elements[5];
        const _sR = (_s.geometry && _s.geometry.parameters ? _s.geometry.parameters.radius : 1) || 1;
        camera.getWorldPosition(_vortexCamPos);
        const _sDist = Math.max(1e-9, _vortexCamPos.distanceTo(_sunLookPos));
        const _sunDistanceMix = sunDistanceBlend(_sDist / _sR);
        if (sunSurfaceSpriteMesh?.material?.uniforms?.uGlowGain) {
            sunSurfaceSpriteMesh.material.uniforms.uGlowGain.value =
                0.72 + 1.35 * _sunDistanceMix;
        }
        const _sDenom = Math.sqrt(Math.max(1e-12, _sDist * _sDist - _sR * _sR));
        const _sPx = _sR * _foc / _sDenom;
        const _sx = (_sunLookScr.x * 0.5 + 0.5) * _vw;
        const _sy = (-_sunLookScr.y * 0.5 + 0.5) * _vh;
        camera.getWorldDirection(_sunLookDir);
        const facing = _sunLookDir.x * (_sunLookPos.x - _vortexCamPos.x) +
                       _sunLookDir.y * (_sunLookPos.y - _vortexCamPos.y) +
                       _sunLookDir.z * (_sunLookPos.z - _vortexCamPos.z) > 0;
        const inView = facing && _sunLookScr.z < 1 && _sunLookScr.z > -1 &&
                       _sx > -_sPx && _sx < _vw + _sPx && _sy > -_sPx && _sy < _vh + _sPx;
        updateSunLensArtifacts(_sunLookScr, inView, _sunDistanceMix);
        const _cent = 1.0 - Math.min(1, Math.hypot(_sx - _vw * 0.5, _sy - _vh * 0.5) /
            (0.5 * Math.hypot(_vw, _vh)));
        const _dimByDist = SUN_DIM_MAX * (1.0 - THREE.MathUtils.smoothstep(
            _sDist / _sR, SUN_DIM_NEAR_R, SUN_DIM_FAR_R));
        let _dimTarget = 0;
        if (inView && _dimByDist > 0.0) {
            _dimTarget = _dimByDist * THREE.MathUtils.smoothstep(_cent, 0.0, 0.25);
            const _gx = Math.round(_sx), _gy = Math.round(_sy), _gr = Math.round(_sPx);
            const _gClear = Math.round(_sPx * (1 + (SUN_DIM_CLEAR_R - 1) * sunCoronaFade));
            const _gOuter = Math.round(_sPx * (1.10 + (SUN_DIM_OUTER_R - 1.10) * sunCoronaFade));
            if (sunDimEl._lastGx !== _gx || sunDimEl._lastGy !== _gy || sunDimEl._lastGr !== _gr ||
                sunDimEl._lastGClear !== _gClear || sunDimEl._lastGOuter !== _gOuter) {
                sunDimEl._lastGx = _gx;
                sunDimEl._lastGy = _gy;
                sunDimEl._lastGr = _gr;
                sunDimEl._lastGClear = _gClear; sunDimEl._lastGOuter = _gOuter;
                sunDimEl.style.background = 'radial-gradient(circle at ' + _gx + 'px ' + _gy + 'px, rgba(0,0,0,0) ' + _gClear + 'px, rgba(0,0,0,0.99) ' + _gOuter + 'px)';
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
    moonEclipses.update(
        ENABLE_NEW_MOON_SHADOWS && solarAccuracy.available,
        camera
    );
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
        trailLayer,
        focusedKey: focusedObject?.userData.planetKey
    });
    earthWeather.update();
    planetDetail.update();
    saturnAlignment.update();
    ringAsteroids.update({
        days: simTimeMs / 86400000 + 2440587.5 - 2451545.0,
        delta: cappedDelta
    });
    {
        const skyR = (skyMaps && skyMaps.domeRadius) || SKY_RADIUS;
        if (skyMaps) skyMaps.update(camera);
        if (constellationLayer) {
            constellationLayer.update(camera, skyR, simTimeMs);
        }
    }
    const _frameLabelMode=typeof getLabelMode==='function'?getLabelMode():'symbols';
    bodyGlowMarkers?.update(cappedDelta, focusedObject, true);
    for(const lo of labelObjects){
        if(!lo.element)continue;
        if(_frameLabelMode==='off'||!markersEnabled){lo.visible=false;lo.element.style.display='none';continue;}
        lo.visible=true;lo.element.style.display='';
        const name=lo.element.querySelector('.label-name');
        if(name)name.style.display=_frameLabelMode==='names'?'':'none';
    }
    updatePlanetVisuals();
    renderer.render(scene, camera);
    const _labelMode = typeof getLabelMode==="function"?getLabelMode():"symbols";
    const _effectiveShowLabels = _labelMode !== "off";
    const _needsCssLabelsThisFrame = labelRenderGate.needsRender({
        showLabels: _effectiveShowLabels,
        conLabels: skyLayerEnabled('conLabels'),
        starLabels: skyLayerEnabled('starLabels')
    }, now);
    if (constellationLayer) {
        const _skyArea = window.innerWidth * window.innerHeight;
        constellationLayer.declutterStarLabels(camera, window.innerWidth, window.innerHeight, {
            starBudget: skyLayerEnabled('starLabels') ? Math.round(Math.max(10, Math.min(34, _skyArea / 30000))) : 0,
            constellationBudget: skyLayerEnabled('conLabels') ? Math.round(Math.max(8, Math.min(22, _skyArea / 55000))) : 0
        });
        if (typeof constellationLayer.updateLabelOcclusion === 'function') {
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
    if (_uiAccum >= 0.1) {
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
