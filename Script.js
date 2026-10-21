/* =========================================================
   ALONTE DJ PRO v1.0
   Dual Deck DJ Engine
   ========================================================= */

"use strict";

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

const eqFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const getElem = id => document.getElementById(id);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function setStatus(message) {
    const status = getElem("status");
    if (status) status.textContent = message;
}

function ensureAudioContext() {
    if (audioCtx) return audioCtx;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();
    return audioCtx;
}

async function playTrack(deck) {
    const audio = getElem(`audio${deck}`);
    if (!audio || !audio.src) {
        alert(`Load a music file into Deck ${deck} first.`);
        return;
    }
    const context = ensureAudioContext();
    if (!context) return;
    try {
        if (context.state === "suspended") {
            await context.resume();
        }
        await audio.play();
        setStatus(`Deck ${deck} playing.`);
    } catch (error) {
        console.error(error);
        setStatus(`Unable to play Deck ${deck}.`);
    }
}

function pauseTrack(deck) {
    const audio = getElem(`audio${deck}`);
    if (!audio) return;
    audio.pause();
    setStatus(`Deck ${deck} paused.`);
}

function cueTrack(deck) {
    const audio = getElem(`audio${deck}`);
    if (!audio) return;
    audio.pause();
    try { audio.currentTime = 0; } catch (_) {}
    setStatus(`Deck ${deck} returned to start.`);
}

function syncTrack(deck) {
    setStatus(`Deck ${deck} synced.`);
}

function resetPitch(deck) {
    const slider = getElem(`pitch${deck}`);
    if (!slider) return;
    slider.value = 0;
}

function toggleEqualizer() {
    getElem("equalizerPanel")?.classList.toggle("eq-open");
}

["A", "B"].forEach(deck => {
    const fileInput = getElem(`file${deck}`);
    const audio = getElem(`audio${deck}`);
    const name = getElem(`name${deck}`);

    if (!fileInput || !audio) return;

    fileInput.addEventListener("change", event => {
        const file = event.target.files?.[0];
        if (!file) return;

        const objectUrl = URL.createObjectURL(file);
        audio.src = objectUrl;
        audio.load();

        if (name) {
            name.textContent = file.name;
        }
        setStatus(`Deck ${deck}: ${file.name} loaded.`);
    });
});

window.playTrack = playTrack;
window.pauseTrack = pauseTrack;
window.cueTrack = cueTrack;
window.syncTrack = syncTrack;
window.resetPitch = resetPitch;
window.toggleEqualizer = toggleEqualizer;
