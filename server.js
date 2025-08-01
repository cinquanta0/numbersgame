// --- Stellar Guardian Multiplayer Server ---
// Compatibile con Render, Heroku, Vercel, locale

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Inizializza Socket.io (CORS: accetta tutti)
const io = socketIo(server, { cors: { origin: "*" } });

// --- Variabili globali co-op ---
let players = {};
let coopBoss = {
  x: 500,
  y: 150,
  angle: 0,
  health: 25000,
  maxHealth: 25000,
  dir: 1,
  yDir: 1
};
let gameInProgress = false;
let hostId = null;

// --- PATCH: Stato voice chat dei giocatori ---
let playerVoiceStatus = {}; // { socketId: true/false }

// --- Parametri boss movement ---
const BOSS_SPEED = 3.0;
const BOSS_Y_SPEED = 1.2;
const BOSS_X_MIN = 100;
const BOSS_X_MAX = 900;
const BOSS_Y_MIN = 80;
const BOSS_Y_MAX = 220;

// --- Funzione reset boss/partita ---
function resetGame() {
  coopBoss.x = 500;
  coopBoss.y = 150;
  coopBoss.angle = 0;
  coopBoss.health = 25000;
  coopBoss.maxHealth = 25000;
  coopBoss.dir = 1;
  coopBoss.yDir = 1;
  gameInProgress = false;
}

// --- Loop movimento boss + sync giocatori ---
let lastBossFrame = Date.now();
setInterval(() => {
  const now = Date.now();
  let delta = (now - lastBossFrame) / 1000;
  lastBossFrame = now;
  delta = Math.max(0.02, Math.min(delta, 0.07));

  // PATCH: invia SEMPRE la lista degli altri player!
  io.emit('otherPlayers', { players: Object.values(players) });

  if (gameInProgress) {
    coopBoss.x += coopBoss.dir * BOSS_SPEED * (delta * 60);
    if (coopBoss.x < BOSS_X_MIN) { coopBoss.x = BOSS_X_MIN; coopBoss.dir = 1; }
    if (coopBoss.x > BOSS_X_MAX) { coopBoss.x = BOSS_X_MAX; coopBoss.dir = -1; }

    coopBoss.y += coopBoss.yDir * BOSS_Y_SPEED * (delta * 60);
    if (coopBoss.y < BOSS_Y_MIN) { coopBoss.y = BOSS_Y_MIN; coopBoss.yDir = 1; }
    if (coopBoss.y > BOSS_Y_MAX) { coopBoss.y = BOSS_Y_MAX; coopBoss.yDir = -1; }

    coopBoss.angle += 0.02 * (delta * 60);

    io.emit('bossUpdate', { ...coopBoss });
  }
}, 40);

// --- Gestione socket.io ---
io.on('connection', (socket) => {
  console.log('Nuovo player:', socket.id);

  // --- JOIN LOBBY ---
  socket.on('joinLobby', (data) => {
    players[socket.id] = {
      id: socket.id,
      x: 200 + Math.random() * 400,
      y: 400 + Math.random() * 120,
      nickname: data.nickname || 'Player',
      angle: 0
    };
    // PATCH: all'ingresso, di default voice disattiva
    playerVoiceStatus[socket.id] = false;
    if (!hostId) hostId = socket.id;
    inviaLobbyAggiornata();
  });

  // --- MOVIMENTO PLAYER ---
  socket.on('playerMove', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].angle = data.angle || 0;
      players[socket.id].nickname = data.nickname;
    }
  });

  // --- INIZIA RAID COOP ---
  socket.on('startCoopRaid', () => {
    if (socket.id !== hostId) return;
    resetGame();
    gameInProgress = true;
    io.emit('gameStart', {
      boss: { ...coopBoss },
      players: Object.values(players)
    });
  });

  // --- DANNO AL BOSS ---
  socket.on('bossDamage', ({ damage }) => {
    if (!gameInProgress || coopBoss.health <= 0) return;
    coopBoss.health -= damage;
    if (coopBoss.health < 0) coopBoss.health = 0;
    io.emit('bossUpdate', { ...coopBoss });
    if (coopBoss.health <= 0) {
      gameInProgress = false;
      io.emit('bossDefeated');
    }
  });

  // --- PATCH: Voice Chat Stato ---
  socket.on('voiceActive', (data) => {
    playerVoiceStatus[socket.id] = !!data.active;
    io.emit('voiceActive', { id: socket.id, active: !!data.active });
  });

  // --- DISCONNESSIONE ---
  socket.on('disconnect', () => {
    delete players[socket.id];
    delete playerVoiceStatus[socket.id];
    if (hostId === socket.id) {
      const ids = Object.keys(players);
      hostId = ids.length > 0 ? ids[0] : null;
      if (!hostId) gameInProgress = false;
    }
    inviaLobbyAggiornata();
    io.emit('voiceActive', { id: socket.id, active: false });
  });

  function inviaLobbyAggiornata() {
    io.emit('lobbyUpdate', { players: Object.values(players) });
  }

  // --- WebRTC Voice Chat Signaling ---
  socket.on('webrtc-offer', (data) => {
    console.log(`[SIGNAL] Offer da ${socket.id} per ${data.targetId}`);
    socket.to(data.targetId).emit('webrtc-offer', {
      fromId: socket.id,
      sdp: data.sdp
    });
  });
  socket.on('webrtc-answer', (data) => {
    console.log(`[SIGNAL] Answer da ${socket.id} per ${data.targetId}`);
    socket.to(data.targetId).emit('webrtc-answer', {
      fromId: socket.id,
      sdp: data.sdp
    });
  });
  socket.on('webrtc-ice', (data) => {
    socket.to(data.targetId).emit('webrtc-ice', {
      fromId: socket.id,
      candidate: data.candidate
    });
  });
});

// --- Porta per Render, Heroku, locale ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server listening on port ' + PORT);
});
