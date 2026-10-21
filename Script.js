/* =========================================================
   ALONTE DJ PRO v1.0
   Dual Deck DJ Engine
   Audio, BPM, Sync, EQ, Mixer, FX, Waveforms, Scratching
   ========================================================= */

"use strict";

/* ===================== GLOBAL VARIABLES ===================== */

let audioCtx = null;
let masterAnimationStarted = false;
let partialWaveformAnimationStarted = false;

const deckSources = {};
const deckAnalysers = {};
const deckGainNodes = {};
const deckCrossGains = {};
const deckFilters = {};
const deckEqualizerFilters = {};
const deckEffects = {};

const deckGainKnobValues = { A: 50, B: 50 };
const deckBaseLevels = { A: 80, B: 80 };

const overviewBuffers = { A: null, B: null };
const overviewColors = { A: "#2fd381", B: "#2196f3" };

const partialWaveforms = {
    A: { buffer: null, audioEl: null, canvas: null, ctx: null, color: "#00a3a3" },
    B: { buffer: null, audioEl: null, canvas: null, ctx: null, color: "#a30040" }
};

const eqFrequencies = [
    32, 64, 125, 250, 500,
    1000, 2000, 4000, 8000, 16000
];

const \$ = id => document.getElementById(id);

const clamp = (value, min, max) =>
    Math.min(max, Math.max(min, value));

function setStatus(message) {
    const status = \$("status");
    if (status) status.textContent = message;
}

/* ===================== AUDIO CONTEXT ===================== */

function ensureAudioContext() {
    if (audioCtx) return audioCtx;

    const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
        alert("Your browser does not support the Web Audio API.");
        return null;
    }

    audioCtx = new AudioContextClass();
    return audioCtx;
}

function applyChannelGain(deck) {
    if (!audioCtx || !deckGainNodes[deck]) return;

    const level = clamp(deckBaseLevels[deck] / 100, 0, 1);
    const knobGain = clamp(deckGainKnobValues[deck] / 50, 0, 2);

    deckGainNodes[deck].gain.setTargetAtTime(
        level * knobGain,
        audioCtx.currentTime,
        0.02
    );
}

function initAudioContext(deck) {
    const audio = \$(`audio${deck}`);
    const context = ensureAudioContext();

    if (!audio || !context || deckSources[deck]) return;

    try {
        const source = context.createMediaElementSource(audio);

        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.75;

        const low = context.createBiquadFilter();
        low.type = "lowshelf";
        low.frequency.value = 320;

        const mid = context.createBiquadFilter();
        mid.type = "peaking";
        mid.frequency.value = 1000;
        mid.Q.value = 1;

        const high = context.createBiquadFilter();
        high.type = "highshelf";
        high.frequency.value = 3200;

        const eqFilters = eqFrequencies.map((frequency, index) => {
            const filter = context.createBiquadFilter();

            if (index === 0) {
                filter.type = "lowshelf";
            } else if (index === eqFrequencies.length - 1) {
                filter.type = "highshelf";
            } else {
                filter.type = "peaking";
                filter.Q.value = 1;
            }

            filter.frequency.value = Math.min(
                frequency,
                context.sampleRate / 2 - 1
            );

            filter.gain.value = 0;
            return filter;
        });

        const channelGain = context.createGain();
        const eqMasterGain = context.createGain();
        const crossGain = context.createGain();

        const delay = context.createDelay(2);
        delay.delayTime.value = 0.30;

        const feedback = context.createGain();
        feedback.gain.value = 0;

        const wet = context.createGain();
        wet.gain.value = 0;

        deckSources[deck] = source;
        deckAnalysers[deck] = analyser;
        deckGainNodes[deck] = channelGain;
        deckCrossGains[deck] = crossGain;
        deckFilters[deck] = { low, mid, high };
        deckEqualizerFilters[deck] = eqFilters;

        deckEffects[deck] = {
            delay,
            feedback,
            wet,
            eqMasterGain
        };

        source.connect(analyser);
        analyser.connect(low);
        low.connect(mid);
        mid.connect(high);

        let previousNode = high;

        eqFilters.forEach(filter => {
            previousNode.connect(filter);
            previousNode = filter;
        });

        previousNode.connect(channelGain);
        channelGain.connect(eqMasterGain);
        eqMasterGain.connect(crossGain);
        crossGain.connect(context.destination);

        previousNode.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wet);
        wet.connect(channelGain);

        const levelSlider = \$(`level${deck}`);

        if (levelSlider) {
            deckBaseLevels[deck] = clamp(
                Number(levelSlider.value),
                0,
                100
            );
        }

        applyChannelGain(deck);
        updateCrossfader();
        updateEqualizer();
        initializePartialWaveforms();

        setStatus(`Deck ${deck} audio engine ready.`);
    } catch (error) {
        console.error(`Deck ${deck} audio setup error:`, error);
        setStatus(`Deck ${deck} audio setup failed.`);
    }
}

/* ===================== CROSS FADER ===================== */

function updateCrossfader() {
    if (!audioCtx) return;

    const slider = \$("crossfader");
    const position = slider
        ? clamp(Number(slider.value), 0, 100) / 100
        : 0.5;

    const gainA = Math.cos(position * Math.PI / 2);
    const gainB = Math.sin(position * Math.PI / 2);

    if (deckCrossGains.A) {
        deckCrossGains.A.gain.setTargetAtTime(
            gainA,
            audioCtx.currentTime,
            0.02
        );
    }

    if (deckCrossGains.B) {
        deckCrossGains.B.gain.setTargetAtTime(
            gainB,
            audioCtx.currentTime,
            0.02
        );
    }
}

\$("crossfader")?.addEventListener("input", updateCrossfader);

document.addEventListener("DOMContentLoaded", () => {
    const crossfader = \$("crossfader");
    const leftButton = \$("cfLeftBtn");
    const rightButton = \$("cfRightBtn");

    const TRANSITION_DURATION = 5000;
    let transitionFrame = null;

    function smoothCrossfade(targetValue) {
        if (!crossfader) return;

        if (transitionFrame !== null) {
            cancelAnimationFrame(transitionFrame);
        }

        const startValue = Number(crossfader.value);
        const startTime = performance.now();

        function animate(now) {
            const progress = Math.min(
                (now - startTime) / TRANSITION_DURATION,
                1
            );

            const eased = progress * progress * (3 - 2 * progress);

            crossfader.value =
                startValue + (targetValue - startValue) * eased;

            crossfader.dispatchEvent(new Event("input", {
                bubbles: true
            }));

            if (progress < 1) {
                transitionFrame = requestAnimationFrame(animate);
            } else {
                crossfader.value = targetValue;
                crossfader.dispatchEvent(new Event("input", {
                    bubbles: true
                }));
                crossfader.dispatchEvent(new Event("change", {
                    bubbles: true
                }));
                transitionFrame = null;
            }
        }

        transitionFrame = requestAnimationFrame(animate);
    }

    leftButton?.addEventListener("click", () => smoothCrossfade(0));
    rightButton?.addEventListener("click", () => smoothCrossfade(100));
    
    initializeEqualizerControls();
});

/* ===================== PLAY / PAUSE / CUE ===================== */

async function playTrack(deck) {
    const audio = \$(`audio${deck}`);

    if (!audio || !audio.src) {
        alert(`Load a music file into Deck ${deck} first.`);
        return;
    }

    initAudioContext(deck);

    if (!audioCtx) return;

    try {
        if (audioCtx.state === "suspended") {
            await audioCtx.resume();
        }

        await audio.play();
        setStatus(`Deck ${deck} playing.`);
    } catch (error) {
        console.error(error);
        setStatus(`Unable to play Deck ${deck}.`);
    }
}

function pauseTrack(deck) {
    const audio = \$(`audio${deck}`);
    if (!audio) return;

    audio.pause();
    setStatus(`Deck ${deck} paused.`);
}

function cueTrack(deck) {
    const audio = \$(`audio${deck}`);
    if (!audio) return;

    audio.pause();

    try {
        audio.currentTime = 0;
    } catch (_) {}

    setStatus(`Deck ${deck} returned to the beginning.`);
}

/* ===================== LOAD TRACKS ===================== */

const trackLoadRequests = { A: 0, B: 0 };

["A", "B"].forEach(deck => {
    const fileInput = \$(`file${deck}`);
    const audio = \$(`audio${deck}`);
    const name = \$(`name${deck}`);
    const bpmDisplay = \$(`bpmDisplay${deck}`);
    const pitchSlider = \$(`pitch${deck}`);

    if (!fileInput || !audio) return;

    fileInput.addEventListener("change", async event => {
        const file = event.target.files?.[0];
        if (!file) return;

        const requestId = ++trackLoadRequests[deck];

        audio.pause();

        if (audio.dataset.objectUrl) {
            URL.revokeObjectURL(audio.dataset.objectUrl);
            delete audio.dataset.objectUrl;
        }

        const objectUrl = URL.createObjectURL(file);

        audio.dataset.objectUrl = objectUrl;
        audio.src = objectUrl;
        audio.playbackRate = 1;

        delete audio.dataset.originalBpm;

        if (name) {
            name.textContent = file.name;
            name.title = file.name;
            name.style.display = "";
            name.style.visibility = "visible";
            name.style.opacity = "1";
        }

        if (bpmDisplay) {
            bpmDisplay.textContent = "SCANNING...";
            bpmDisplay.style.display = "";
            bpmDisplay.style.visibility = "visible";
            bpmDisplay.style.opacity = "1";
        }

        if (pitchSlider) pitchSlider.value = 0;
        updatePitch(deck);

        overviewBuffers[deck] = null;
        partialWaveforms[deck].buffer = null;

        initializePartialWaveforms();
        drawMasterOverview();

        initAudioContext(deck);
        loadOverviewWaveform(deck, file);
        loadTrackWaveform(deck, file, audio);

        audio.load();

        setStatus(`Deck ${deck}: music loaded, detecting BPM...`);

        try {
            let bpm = null;
            try {
                const formData = new FormData();
                formData.append("audio", file, file.name);
                const response = await fetch("http://127.0.0.1:5000/detect-bpm", {
                    method: "POST",
                    body: formData
                });
                if (response.ok) {
                    const data = await response.json();
                    if (Number.isFinite(Number(data.bpm))) bpm = Number(data.bpm);
                }
            } catch (e) {
                console.log("Local Python server offline. Using in-browser JS BPM engine...");
            }

            if (!bpm) {
                const context = ensureAudioContext();
                const bytes = await file.arrayBuffer();
                const audioBuffer = await context.decodeAudioData(bytes.slice(0));
                bpm = await analyzeBPM(audioBuffer);
            }

            if (requestId !== trackLoadRequests[deck]) return;

            audio.dataset.originalBpm = String(bpm);

            if (bpmDisplay) {
                bpmDisplay.textContent = bpm.toFixed(1);
                bpmDisplay.style.display = "";
                bpmDisplay.style.visibility = "visible";
                bpmDisplay.style.opacity = "1";
            }

            setStatus(`Deck ${deck}: ${file.name} | BPM ${bpm.toFixed(1)}`);
        } catch (error) {
            if (requestId !== trackLoadRequests[deck]) return;

            console.error(`[Deck ${deck}] BPM detection error:`, error);
            delete audio.dataset.originalBpm;

            if (bpmDisplay) {
                bpmDisplay.textContent = "BPM N/A";
                bpmDisplay.style.display = "";
                bpmDisplay.style.visibility = "visible";
                bpmDisplay.style.opacity = "1";
            }

            setStatus(`Deck ${deck}: music loaded (BPM Analysis skipped)`);
        }

        drawMasterOverview();
    });
});

/* ===================== BPM ANALYSIS ===================== */

async function analyzeBPM(buffer) {
    const sampleRate = buffer.sampleRate;
    const channelCount = buffer.numberOfChannels;
    const hop = Math.max(1, Math.floor(sampleRate * 0.02));
    const envelope = [];
    const channels = [];

    for (let channel = 0; channel < channelCount; channel++) {
        channels.push(buffer.getChannelData(channel));
    }

    for (let start = 0; start < buffer.length; start += hop) {
        const end = Math.min(start + hop, buffer.length);
        let sum = 0;
        let count = 0;

        for (let i = start; i < end; i += 2) {
            let sample = 0;
            for (let channel = 0; channel < channelCount; channel++) {
                sample += channels[channel][i] || 0;
            }
            sample /= channelCount;
            sum += sample * sample;
            count++;
        }

        envelope.push(Math.sqrt(sum / Math.max(count, 1)));
    }

    if (envelope.length < 100) {
        throw new Error("Track is too short for BPM analysis.");
    }

    const onset = new Float32Array(envelope.length);
    let mean = 0;

    for (let i = 0; i < envelope.length; i++) {
        mean += envelope[i];
    }
    mean /= envelope.length;

    for (let i = 1; i < envelope.length; i++) {
        const current = envelope[i] - mean;
        const previous = envelope[i - 1] - mean;
        onset[i] = Math.max(0, current - previous);
    }

    const onsetRate = sampleRate / hop;
    const scores = [];

    for (let bpm = 60; bpm <= 200; bpm += 0.25) {
        const lag = Math.round(onsetRate * 60 / bpm);
        if (lag < 1 || lag >= onset.length) continue;

        let score = 0;
        let count = 0;
        const stride = Math.max(1, Math.floor(onset.length / 6000));

        for (let i = lag; i < onset.length; i += stride) {
            score += onset[i] * onset[i - lag];
            count++;
        }

        scores.push({
            bpm,
            score: score / Math.max(count, 1)
        });
    }

    scores.sort((a, b) => b.score - a.score);

    if (!scores.length || scores[0].score <= 0) {
        throw new Error("No reliable beat pattern found.");
    }

    return Math.round(scores[0].bpm * 10) / 10;
}

/* ===================== BPM SYNC ===================== */

function syncTrack(deck) {
    const otherDeck = deck === "A" ? "B" : "A";
    const target = \$(`audio${deck}`);
    const source = \$(`audio${otherDeck}`);

    if (!target?.src || !source?.src) {
        alert("Load a track into both decks before using SYNC.");
        return;
    }

    const targetBpm = Number(target.dataset.originalBpm);
    const sourceBpm = Number(source.dataset.originalBpm);

    if (
        !Number.isFinite(targetBpm) || targetBpm <= 0 ||
        !Number.isFinite(sourceBpm) || sourceBpm <= 0
    ) {
        alert("Wait until BPM analysis finishes for both tracks.");
        return;
    }

    const desiredRate = (sourceBpm * source.playbackRate) / targetBpm;
    const slider = \$(`pitch${deck}`);

    const minRate = slider ? Math.max(0.1, 1 + Number(slider.min || -50) / 100) : 0.5;
    const maxRate = slider ? 1 + Number(slider.max || 50) / 100 : 1.5;

    const newRate = clamp(desiredRate, minRate, maxRate);

    target.playbackRate = newRate;

    if (slider) {
        slider.value = (newRate - 1) * 100;
    }

    updatePitch(deck);

    if (
        !source.paused &&
        Number.isFinite(source.duration) && source.duration > 0 &&
        Number.isFinite(target.duration) && target.duration > 0
    ) {
        const progress = source.currentTime / source.duration;
        target.currentTime = clamp(progress, 0, 1) * target.duration;
        if (target.paused) playTrack(deck);
    }

    setStatus(`Deck ${deck} synced to Deck ${otherDeck}.`);
}

/* ===================== PITCH CONTROL ===================== */

function updatePitch(deck) {
    const slider = \$(`pitch${deck}`);
    const audio = \$(`audio${deck}`);
    const display = \$(`pitchValue${deck}`);

    if (!slider || !audio) return;

    const percent = Number(slider.value);
    const rate = Math.max(0.1, 1 + percent / 100);

    audio.playbackRate = rate;

    if (display) {
        display.textContent = `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
    }
}

function resetPitch(deck) {
    const slider = \$(`pitch${deck}`);
    if (!slider) return;

    slider.value = 0;
    updatePitch(deck);
}

["A", "B"].forEach(deck => {
    \$(`pitch${deck}`)?.addEventListener("input", () => updatePitch(deck));
    \$(`play${deck}`)?.addEventListener("click", () => playTrack(deck));
    \$(`pause${deck}`)?.addEventListener("click", () => pauseTrack(deck));
    \$(`cue${deck}`)?.addEventListener("click", () => cueTrack(deck));
    \$(`sync${deck}`)?.addEventListener("click", () => syncTrack(deck));
    \$(`pitchReset${deck}`)?.addEventListener("click", () => resetPitch(deck));
});

/* ===================== TIME DISPLAY ===================== */

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

["A", "B"].forEach(deck => {
    const audio = \$(`audio${deck}`);
    if (!audio) return;

    function updateTime() {
        const display = \$(`timeDisplay${deck}`);
        if (display) {
            display.textContent = formatTime(audio.currentTime);
        }
        drawMasterOverview();
    }

    ["timeupdate", "loadedmetadata", "seeked"].forEach(eventName => {
        audio.addEventListener(eventName, updateTime);
    });
});

/* ===================== 10-BAND EQUALIZER ===================== */

function updateEqualizer() {
    if (!audioCtx) return;

    const enabled = $("eqOnCheck") ? $("eqOnCheck").checked : true;
    const masterSlider = \$("eqMasterGain");
    const masterDb = masterSlider ? Number(masterSlider.value) : 0;
    const masterLinear = Math.pow(10, masterDb / 20);

    if (\$("eqMasterValue")) {
        \$("eqMasterValue").textContent = `${masterDb > 0 ? "+" : ""}${masterDb} dB`;
    }

    ["A", "B"].forEach(deck => {
        const filters = deckEqualizerFilters[deck];
        const masterNode = deckEffects[deck]?.eqMasterGain;

        if (filters) {
            filters.forEach((filter, index) => {
                const frequency = eqFrequencies[index];
                const slider = document.querySelector(`#equalizerPanel [data-frequency="${frequency}"]`);
                const db = slider ? Number(slider.value) : 0;

                filter.gain.setTargetAtTime(
                    enabled ? db : 0,
                    audioCtx.currentTime,
                    0.02
                );

                const output = \$(`eqValue${frequency}`);
                if (output) {
                    output.textContent = `${db > 0 ? "+" : ""}${db} dB`;
                }
            });
        }

        if (masterNode) {
            masterNode.gain.setTargetAtTime(
                masterLinear,
                audioCtx.currentTime,
                0.02
            );
        }
    });
}

function applyEqualizerPreset(presetName) {
    const presets = {
        "Flat": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        "Club Master": [5, 4, 3, 0, -1, 1, 3, 4, 4, 3],
        "Deep Bass": [8, 7, 5, 3, 1, 0, 0, 0, 1, 1],
        "Vocal Boost": [-2, -1, 0, 2, 4, 5, 4, 2, 0, -1],
        "Electronic": [5, 4, 2, 0, -2, 1, 3, 4, 3, 2]
    };

    const values = presets[presetName];
    if (!values) return;

    values.forEach((value, index) => {
        const frequency = eqFrequencies[index];
        const slider = document.querySelector(`#equalizerPanel [data-frequency="${frequency}"]`);
        if (slider) slider.value = value;
    });

    updateEqualizer();
}

function toggleEqualizer() {
    \$("equalizerPanel")?.classList.toggle("eq-open");
}

function initializeEqualizerControls() {
    const panel = \$("equalizerPanel");
    if (!panel || panel.dataset.eqInitialized === "true") return;

    panel.dataset.eqInitialized = "true";

    panel.querySelectorAll('input[type="range"]').forEach(slider => {
        slider.addEventListener("input", updateEqualizer);
    });

    \$("eqOnCheck")?.addEventListener("change", updateEqualizer);
    \$("eqMasterGain")?.addEventListener("input", updateEqualizer);

    \$("eqPreset")?.addEventListener("change", event => {
        applyEqualizerPreset(event.target.value);
    });

    updateEqualizer();
}

/* ===================== WAVEFORMS ===================== */

function initializePartialWaveforms() {
    ["A", "B"].forEach(deck => {
        const wf = partialWaveforms[deck];
        wf.canvas = \$(`deck${deck}Waveform`);
        wf.ctx = wf.canvas ? wf.canvas.getContext("2d") : null;
        wf.audioEl = \$(`audio${deck}`);
    });

    if (!partialWaveformAnimationStarted) {
        partialWaveformAnimationStarted = true;
        requestAnimationFrame(renderPartialWaveforms);
    }
}

async function loadTrackWaveform(deck, file, audioElement) {
    const wf = partialWaveforms[deck];
    if (!wf || !file || !audioElement) return;

    wf.audioEl = audioElement;
    wf.buffer = null;

    try {
        const context = ensureAudioContext();
        if (!context) return;

        const bytes = await file.arrayBuffer();
        const buffer = await context.decodeAudioData(bytes.slice(0));

        if (wf.audioEl !== audioElement) return;
        wf.buffer = buffer;
    } catch (error) {
        console.error(`Deck ${deck} waveform decode error:`, error);
    }
}

function renderPartialWaveforms() {
    requestAnimationFrame(renderPartialWaveforms);

    ["A", "B"].forEach(deck => {
        const wf = partialWaveforms[deck];
        if (!wf.canvas || !wf.ctx) return;

        const canvas = wf.canvas;
        const ctx = wf.ctx;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        if (!width || !height) return;

        const dpr = window.devicePixelRatio || 1;
        const pixelWidth = Math.round(width * dpr);
        const pixelHeight = Math.round(height * dpr);

        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = "#060911";
        ctx.fillRect(0, 0, width, height);

        if (wf.buffer && wf.audioEl) {
            const duration = wf.audioEl.duration || 1;
            const currentTime = wf.audioEl.currentTime || 0;
            const channelData = wf.buffer.getChannelData(0);
            const samples = channelData.length;

            const windowSize = 4.0;
            const startTime = Math.max(0, currentTime - windowSize / 2);
            const endTime = Math.min(duration, startTime + windowSize);

            const startSample = Math.floor((startTime / duration) * samples);
            const endSample = Math.floor((endTime / duration) * samples);
            const step = Math.max(1, Math.floor((endSample - startSample) / width));

            ctx.strokeStyle = wf.color;
            ctx.lineWidth = 2;
            ctx.beginPath();

            let xIndex = 0;
            for (let i = startSample; i < endSample; i += step) {
                const sample = channelData[i] || 0;
                const y = (height / 2) + sample * (height / 2);
                if (xIndex === 0) ctx.moveTo(xIndex, y);
                else ctx.lineTo(xIndex, y);
                xIndex++;
            }
            ctx.stroke();
        }
    });

    ["A", "B"].forEach(deck => updateLedMeter(deck));
}

async function loadOverviewWaveform(deck, file) {
    try {
        const context = ensureAudioContext();
        if (!context) return;
        const bytes = await file.arrayBuffer();
        const buffer = await context.decodeAudioData(bytes.slice(0));
        overviewBuffers[deck] = buffer;
        drawMasterOverview();
    } catch (e) {
        console.error("Overview waveform error:", e);
    }
}

function drawMasterOverview() {
    const canvas = \$("masterOverviewCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }

    ctx.fillStyle = "#060911";
    ctx.fillRect(0, 0, width, height);

    ["A", "B"].forEach(deck => {
        const buf = overviewBuffers[deck];
        const audio = \$(`audio${deck}`);
        if (!buf) return;

        const data = buf.getChannelData(0);
        const step = Math.ceil(data.length / width);
        ctx.strokeStyle = overviewColors[deck];
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (let x = 0; x < width; x++) {
            let min = 1.0;
            let max = -1.0;
            for (let j = 0; j < step; j++) {
                const datum = data[(x * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
            const yMin = (1 + min) * height / 2;
            const yMax = (1 + max) * height / 2;
            ctx.moveTo(x, yMin);
            ctx.lineTo(x, yMax);
        }
        ctx.stroke();

        if (audio && audio.duration) {
            const progress = audio.currentTime / audio.duration;
            const playheadX = progress * width;
            ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
            ctx.fillRect(playheadX, 0, 2, height);
        }
    });
}

function updateLedMeter(deck) {
    const analyser = deckAnalysers[deck];
    const container = \$(`meter${deck}`);
    if (!analyser || !container) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i];
    }
    const average = sum / Math.max(1, data.length);
    const active = Math.round((average / 300) * 20);
    const segments = container.querySelectorAll(".led-segment");

    segments.forEach((segment, index) => {
        const level = segments.length - 1 - index;
        if (level < active) {
            if (level >= 6) segment.style.background = "#ff3030";
            else if (level >= 4) segment.style.background = "#ffe44d";
            else segment.style.background = overviewColors[deck];
        } else {
            segment.style.background = "#111";
        }
    });
}

/* ===================== GLOBAL WINDOW BINDINGS (Vercel Fix) ===================== */
window.playTrack = playTrack;
window.pauseTrack = pauseTrack;
window.cueTrack = cueTrack;
window.syncTrack = syncTrack;
window.toggleEqualizer = toggleEqualizer;
