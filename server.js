// --- Stellar Guardian Multiplayer Server OPTIMIZED + COOP DREAMLO LEADERBOARD ---
// PATCH: Solo ASTEROIDI in co-op (NO MINE) + ottimizzazione mobile

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const io = socketIo(server, { cors: { origin: "*" } });

// --- GLOBAL STATE ---
let players = {};
let playerVoiceStatus = {};
let coopObstacles = [];
let gameInProgress = false;
let hostId = null;

// --- Boss State ---
let coopBoss = {
  x: 500, y: 150, angle: 0,
  health: 25000, maxHealth: 25000,
  dir: 1, yDir: 1
};
const BOSS_SPEED = 3.0, BOSS_Y_SPEED = 1.2;
const BOSS_X_MIN = 100, BOSS_X_MAX = 900, BOSS_Y_MIN = 80, BOSS_Y_MAX = 220;
const GAME_WIDTH = 1000, GAME_HEIGHT = 700;

// --- Boss Attacks ---
let bossAttackCooldown = 0;
const MIN_ATTACK_INTERVAL = 700, MAX_ATTACK_INTERVAL = 1600;
const BOSS_ATTACK_PATTERNS = [
  'basic', 'spread', 'tracking', 'wave', 'laser', 'swarm', 'spiral', 'chaos', 'ultimate'
];

// --- UTILS ---
function generateUniqueId() { return Math.random().toString(36).substr(2, 9) + Date.now(); }
function resetGame() {
  coopBoss.x = 500; coopBoss.y = 150; coopBoss.angle = 0;
  coopBoss.maxHealth = 25000; // Leave health as is
  coopBoss.health = 25000; // Reset health at new game
  coopBoss.dir = 1; coopBoss.yDir = 1;
  coopObstacles = [];
  gameInProgress = false; bossAttackCooldown = 0;
}

// --- DREAMLO CO-OP LEADERBOARD ---
function submitCoopTeamScore(teamName, score) {
  const dreamloKey = "5z7d7N8IBkSwrhJdyZAXxAYn3Jv1KyTEm6GJZoIALRBw";
  const tag = "coopraid";
  const url = `https://dreamlo.com/lb/${dreamloKey}/add/${encodeURIComponent(teamName)}/${score}/${tag}`;
  fetch(url)
    .then(() => console.log(`[Dreamlo] Co-op score inviato: ${teamName} - ${score}`))
    .catch(err => console.error("[Dreamlo] Errore invio co-op:", err));
}

// --- Obstacles (PATCH: solo asteroid in co-op) ---
function spawnGlobalObstacle() {
  const id = generateUniqueId();
  // PATCH: solo asteroid
  const type = "asteroid";
  coopObstacles.push({
    id, x: Math.random() * GAME_WIDTH, y: -40,
    vx: (Math.random() - 0.5) * 1.5, vy: 2 + Math.random() * 2,
    size: 32 + Math.random() * 32, type,
    angle: 0, spin: (Math.random() - 0.5) * 0.07, hit: false
  });
}
function updateObstacles() {
  coopObstacles.forEach(o => { o.x += o.vx; o.y += o.vy; o.angle += o.spin; });
  coopObstacles = coopObstacles.filter(o =>
    o.y < GAME_HEIGHT + 60 && o.x > -80 && o.x < GAME_WIDTH + 80 && !o.hit
  );
}

// --- LOOP: Boss + Sync (Ottimizzato) ---
let lastBossFrame = Date.now();
setInterval(() => {
  const now = Date.now();
  let delta = (now - lastBossFrame) / 1000;
  lastBossFrame = now;
  delta = Math.max(0.02, Math.min(delta, 0.07));

  // Solo invio se ci sono player
  if (Object.keys(players).length > 0) {
    io.emit('otherPlayers', { players: Object.values(players) });
  }

  if (gameInProgress) {
    // BOSS MOVEMENT
    coopBoss.x += coopBoss.dir * BOSS_SPEED * (delta * 60);
    if (coopBoss.x < BOSS_X_MIN) { coopBoss.x = BOSS_X_MIN; coopBoss.dir = 1; }
    if (coopBoss.x > BOSS_X_MAX) { coopBoss.x = BOSS_X_MAX; coopBoss.dir = -1; }
    coopBoss.y += coopBoss.yDir * BOSS_Y_SPEED * (delta * 60);
    if (coopBoss.y < BOSS_Y_MIN) { coopBoss.y = BOSS_Y_MIN; coopBoss.yDir = 1; }
    if (coopBoss.y > BOSS_Y_MAX) { coopBoss.y = BOSS_Y_MAX; coopBoss.yDir = -1; }
    coopBoss.angle += 0.02 * (delta * 60);

    io.emit('bossUpdate', { ...coopBoss });

    // --- BOSS ATTACK LOGIC: solo se c'è almeno un player vivo ---
    bossAttackCooldown -= 40;
    if (bossAttackCooldown <= 0 && Object.keys(players).length > 0) {
      let unlockedPatterns = Math.min(Math.ceil((coopBoss.maxHealth - coopBoss.health) / 3000) + 2, BOSS_ATTACK_PATTERNS.length);
      const pattern = BOSS_ATTACK_PATTERNS[Math.floor(Math.random() * unlockedPatterns)];
      io.emit('bossAttack', { pattern, x: coopBoss.x, y: coopBoss.y, time: Date.now() });
      bossAttackCooldown = Math.random() * (MAX_ATTACK_INTERVAL - MIN_ATTACK_INTERVAL) + MIN_ATTACK_INTERVAL;
    }

    // PATCH: solo asteroid!
    if (Math.random() < 0.035) spawnGlobalObstacle();
    updateObstacles();
    io.emit('obstaclesUpdate', coopObstacles);
  }
}, 50); // 20Hz

// --- SOCKET.IO HANDLERS ---
io.on('connection', (socket) => {
  socket.on('joinLobby', (data) => {
    players[socket.id] = {
      id: socket.id,
      x: 200 + Math.random() * 400,
      y: 400 + Math.random() * 120,
      nickname: data.nickname || 'Player',
      angle: 0
    };
    playerVoiceStatus[socket.id] = false;
    if (!hostId) hostId = socket.id;
    inviaLobbyAggiornata();
  });

  socket.on('playerMove', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].angle = data.angle || 0;
      players[socket.id].nickname = data.nickname;
    }
  });

  socket.on('startCoopRaid', () => {
    if (socket.id !== hostId) return;
    resetGame();
    gameInProgress = true;
    io.emit('gameStart', { boss: { ...coopBoss }, players: Object.values(players) });
  });

  socket.on('bossDamage', ({ damage }) => {
    if (!gameInProgress || coopBoss.health <= 0) return;
    coopBoss.health -= damage;
    if (coopBoss.health < 0) coopBoss.health = 0;
    io.emit('bossUpdate', { ...coopBoss });
    if (coopBoss.health <= 0) {
      gameInProgress = false;
      const squadNicknames = Object.values(players).map(p => p.nickname).join("_") || "Team";
      submitCoopTeamScore(squadNicknames, Math.floor(coopBoss.maxHealth));
      io.emit('bossDefeated');
    }
  });

  socket.on('voiceActive', (data) => {
    playerVoiceStatus[socket.id] = !!data.active;
    io.emit('voiceActive', { id: socket.id, active: !!data.active });
  });

  socket.on('shoot', (data) => io.emit('spawnBullet', data));

  socket.on('obstacleHit', (obstacleId) => {
    const ob = coopObstacles.find(o => o.id === obstacleId);
    if (ob) ob.hit = true;
    io.emit('obstaclesUpdate', coopObstacles);
  });

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

  // --- WebRTC Signaling ---
  socket.on('webrtc-offer', (data) =>
    socket.to(data.targetId).emit('webrtc-offer', { fromId: socket.id, sdp: data.sdp }));
  socket.on('webrtc-answer', (data) =>
    socket.to(data.targetId).emit('webrtc-answer', { fromId: socket.id, sdp: data.sdp }));
  socket.on('webrtc-ice', (data) =>
    socket.to(data.targetId).emit('webrtc-ice', { fromId: socket.id, candidate: data.candidate }));
});

// --- PORT ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on port ' + PORT));
