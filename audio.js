const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

async function loadAudioBuffer(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`File non trovato: ${url}`);
    const arrayBuffer = await response.arrayBuffer();
    return await audioCtx.decodeAudioData(arrayBuffer);
  } catch (e) {
    console.warn("Errore audio:", e.message);
    return null;
  }
}

const sounds = {};

async function initSounds() {
  sounds.playerShoot = await loadAudioBuffer('lasersmall-000_hQ3EaFMr.mp3');
  sounds.bossShoot   = await loadAudioBuffer('laserlarge-000_m1pLl5OY.mp3');
  sounds.explosion   = await loadAudioBuffer('explosionCrunch_001.mp3');
  sounds.playerHit   = await loadAudioBuffer('hitHurt.mp3');
}

function playSound(name, volume = 0.5) {
  if (!sounds[name]) return;
  const src = audioCtx.createBufferSource();
  src.buffer = sounds[name];
  const gain = audioCtx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(audioCtx.destination);
  src.start(0);
}

window.addEventListener('DOMContentLoaded', () => {
  initSounds();
  document.body.addEventListener('touchstart', () => {
    audioCtx.resume();
  }, { once: true });
});