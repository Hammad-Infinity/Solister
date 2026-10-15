function unlockMusicContext() {
    if (!musicContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        musicContext = new AudioContextClass;
        const source = musicContext.createMediaElementSource(ambientAudio);
        trackGain = musicContext.createGain();
        trackGain.gain.value = 0;
        source.connect(trackGain);
        trackGain.connect(musicContext.destination);
    }
    if (musicContext.state === "suspended") {
        musicContext.resume().catch(console.warn);
    }
}

function loadMusicTrack(shouldPlay = false) {
    if (trackGain) {
        trackGain.gain.cancelScheduledValues(musicContext.currentTime);
        trackGain.gain.value = 0;
    }
    ambientAudio.src = `./assets/audio/track${trackIndex}.mp3`;
    ambientAudio.load();
    if (shouldPlay && targetVolume() > .001) {
        ambientAudio.play().catch(error => {
            if (error.name === "NotAllowedError") {
                console.warn("Click the page to resume music.");
            }
        });
    }
}

function advanceMusicTrack() {
    trackIndex = trackIndex % TRACK_COUNT + 1;
    loadMusicTrack(true);
}

function updateMusicEnvelope() {
    if (!trackGain || ambientAudio.paused) return;
    const time = ambientAudio.currentTime;
    const duration = ambientAudio.duration;
    const finiteDuration = Number.isFinite(duration) && duration > 0;
    const fadeLength = finiteDuration ? Math.min(TRACK_FADE_SECONDS, duration / 2) : TRACK_FADE_SECONDS;
    const fadeIn = Math.min(1, time / fadeLength);
    const fadeOut = finiteDuration ? Math.min(1, Math.max(0, duration - time) / fadeLength) : 1;
    const envelope = Math.min(fadeIn, fadeOut);
    trackGain.gain.setTargetAtTime(envelope, musicContext.currentTime, .025);
}

function targetVolume() {
    return muted || !audioEnabled ? 0 : volume;
}

function persistAudio() {
    try {
        localStorage.setItem("solarVolume", String(volume));
        localStorage.setItem("solarMuted", muted ? "1" : "0");
        localStorage.setItem("solarAudioEnabled", audioEnabled ? "1" : "0");
    } catch (e) {}
}

function updateVolumeUI() {
    const eff = targetVolume();
    const displayVal = muted ? 0 : Math.round(volume * 100);
    volumeSlider.value = String(displayVal);
    volumeSlider.style.backgroundImage = `linear-gradient(to right, ` + `#6a6a6a 0%, #6a6a6a ${displayVal}%, ` + `rgba(255,255,255,0.08) ${displayVal}%, rgba(255,255,255,0.08) 100%)`;
    volumeDisplayEl.textContent = displayVal + "%";
    let level;
    if (eff <= .001) level = "mute"; else if (eff < .5) level = "low"; else level = "high";
    volumeBtn.dataset.level = level;
    volumeBtn.setAttribute("aria-label", level === "mute" ? "Unmute" : "Mute");
    volumeBtn.title = level === "mute" ? "Unmute" : "Mute";
}

function cancelFade() {
    if (fadeRaf !== null) {
        cancelAnimationFrame(fadeRaf);
        fadeRaf = null;
    }
}

function fadeTo(target, durationMs = 500, onDone) {
    cancelFade();
    const start = ambientAudio.volume;
    const t0 = performance.now();
    const dur = Math.max(1, durationMs);
    const step = now => {
        const t = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - t, 3);
        ambientAudio.volume = Math.min(1, Math.max(0, start + (target - start) * e));
        if (t < 1) {
            fadeRaf = requestAnimationFrame(step);
        } else {
            fadeRaf = null;
            if (onDone) onDone();
        }
    };
    fadeRaf = requestAnimationFrame(step);
}

function applyVolume(animated = true) {
    const target = targetVolume();
    if (target > .001) {
        if (ambientAudio.paused) {
            cancelFade();
            ambientAudio.volume = 0;
            ambientAudio.play().then(() => {
                fadeTo(target, 500);
            }).catch(err => {
                console.warn("Audio playback blocked:", err.name, err.message);
            });
        } else if (animated && Math.abs(ambientAudio.volume - target) > .005) {
            fadeTo(target, 500);
        } else {
            cancelFade();
            ambientAudio.volume = target;
        }
    } else {
        if (!ambientAudio.paused) {
            if (animated) {
                fadeTo(0, 400, () => {
                    ambientAudio.pause();
                });
            } else {
                cancelFade();
                ambientAudio.volume = 0;
                ambientAudio.pause();
            }
        } else {
            cancelFade();
            ambientAudio.volume = 0;
        }
    }
    updateVolumeUI();
}

function toggleMute() {
    audioEnabled = true;
    if (muted || volume <= .001) {
        if (volume <= .001) volume = lastNonZeroVol || .35;
        muted = false;
    } else {
        muted = true;
    }
    persistAudio();
    applyVolume(true);
}
