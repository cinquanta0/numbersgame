let audioCtx = null;
const sounds = {};
let soundsReady = false;

// Carica buffer audio solo dopo unlock
async function loadAudioBuffer(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Audio file not found: ' + url);
    const arrayBuffer = await response.arrayBuffer();
    return await audioCtx.decodeAudioData(arrayBuffer);
  } catch (e) {
    console.warn("Audio load error:", url, e.message);
    return null;
  }
}

// Inizializza suoni SOLO dopo unlock
async function initSounds() {
  sounds.playerShoot = await loadAudioBuffer('lasersmall-000_hQ3EaFMr.mp3');
  sounds.bossShoot   = await loadAudioBuffer('laserlarge-000_m1pLl5OY.mp3');
  sounds.explosion   = await loadAudioBuffer('explosionCrunch_001.mp3');
  sounds.playerHit   = await loadAudioBuffer('hitHurt.mp3');
  soundsReady = true;
  console.log("Audio buffers loaded");
}

// Sblocca audio, crea AudioContext e carica suoni
window.startGameAudio = async function() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
  if (!soundsReady) {
    await initSounds();
  }
};

// Play sound: chiamala solo dopo che audio è sbloccato!
function playSound(name, volume = 0.5) {
  if (!audioCtx || !sounds[name]) return;
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  const src = audioCtx.createBufferSource();
  src.buffer = sounds[name];
  const gain = audioCtx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(audioCtx.destination);
  src.start(0);
}

// NON chiamare initSounds o unlock su DOMContentLoaded!
// Sblocca l'audio SOLO al click/tap su bottone "Gioca ora"
