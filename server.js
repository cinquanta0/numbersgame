// --- Stellar Guardian Multiplayer Server: COOP + 1v1 DUEL Optimized ---
// Node.js + Socket.io v4+
// (c) 2024-2025 Luka

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// === COOP GLOBAL STATE ===
let players = {};
let playerVoiceStatus = {};
let coopObstacles = [];
let gameInProgress = false;
let hostId = null;

// === Boss State (COOP) ===
let coopBoss = {
  x: 500, y: 150, angle: 0,
  health: 25000, maxHealth: 25000,
  dir: 1, yDir: 1
};
const BOSS_SPEED = 3.0, BOSS_Y_SPEED = 1.2;
const BOSS_X_MIN = 100, BOSS_X_MAX = 900, BOSS_Y_MIN = 80, BOSS_Y_MAX = 220;
const GAME_WIDTH = 1000, GAME_HEIGHT = 700;

// === Boss Attacks ===
let bossAttackCooldown = 0;
const MIN_ATTACK_INTERVAL = 700, MAX_ATTACK_INTERVAL = 1600;
const BOSS_ATTACK_PATTERNS = [
  'basic', 'spread', 'tracking', 'wave', 'laser', 'swarm', 'spiral', 'chaos', 'ultimate'
];

// === UTILS ===
function generateUniqueId() {
  return Math.random().toString(36).substr(2, 9) + Date.now();
}
function resetGame() {
  coopBoss.x = 500; coopBoss.y = 150; coopBoss.angle = 0;
  coopBoss.maxHealth = 25000;
  coopBoss.health = 25000;
  coopBoss.dir = 1; coopBoss.yDir = 1;
  coopObstacles = [];
  gameInProgress = false; bossAttackCooldown = 0;
}

// === DREAMLO CO-OP LEADERBOARD ===
function submitCoopTeamScore(teamName, score) {
  const dreamloKey = "5z7d7N8IBkSwrhJdyZAXxAYn3Jv1KyTEm6GJZoIALRBw";
  const tag = "coopraid";
  const url = `https://dreamlo.com/lb/${dreamloKey}/add/${encodeURIComponent(teamName)}/${score}/${tag}`;
  fetch(url)
    .then(() => console.log(`[Dreamlo] Co-op score inviato: ${teamName} - ${score}`))
    .catch(err => console.error("[Dreamlo] Errore invio co-op:", err));
}

// === Obstacles (solo asteroid in co-op) ===
function spawnGlobalObstacle() {
  const id = generateUniqueId();
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

// === 1v1 DUEL STATE ===
let duelQueue = []; // [{socket, nickname, skin}]
let duelRooms = {}; // roomId: { p1: socket, p2: socket, states: {id: {}}, stats: {}, ... }

// --- DUEL HELPERS ---
function createDuelRoom(p1, p2) {
  const room = generateUniqueId();
  duelRooms[room] = {
    p1, p2,
    states: {},
    stats: { [p1.id]: {kills: 0, damage: 0}, [p2.id]: {kills: 0, damage: 0} },
    powerups: [],
    obstacles: [],
    events: [],
    winner: null,
    ended: false,
    playerMeta: {
      [p1.id]: { skin: p1.skin || "navicella2.png", nickname: p1.nickname || "Player" },
      [p2.id]: { skin: p2.skin || "navicella2.png", nickname: p2.nickname || "Player" }
    }
  };
  return room;
}
function getOpponent(room, id) {
  const duel = duelRooms[room];
  if (!duel) return null;
  return (duel.p1.id === id) ? duel.p2 : duel.p1;
}

// === DUEL POWERUP MANAGEMENT ===
const DUEL_POWERUP_TYPES = ['heal', 'shield', 'damage', 'speed'];
function spawnDuelPowerup(room) {
  const type = DUEL_POWERUP_TYPES[Math.floor(Math.random() * DUEL_POWERUP_TYPES.length)];
  const x = 200 + Math.random() * 600;
  const y = 200 + Math.random() * 400;
  const powerup = { id: generateUniqueId(), type, x, y, active: true };
  if (duelRooms[room]) {
    duelRooms[room].powerups.push(powerup);
    io.in(room).emit('powerup_spawn', powerup);
  }
}
// Obstacles 1v1 (esempio: mine)
function spawnDuelObstacle(room) {
  const type = "mine";
  const x = 150 + Math.random() * 700;
  const y = 250 + Math.random() * 300;
  const obstacle = { id: generateUniqueId(), type, x, y, size: 32 + Math.random() * 22, hit: false };
  if (duelRooms[room]) {
    duelRooms[room].obstacles.push(obstacle);
    io.in(room).emit('duel_obstacle_spawn', obstacle);
  }
}

// === MAIN GAME LOOP (COOP/DUEL SYNC) ===
let lastBossFrame = Date.now();
setInterval(() => {
  const now = Date.now();
  let delta = (now - lastBossFrame) / 1000;
  lastBossFrame = now;
  delta = Math.max(0.02, Math.min(delta, 0.07));

  // COOP: sync otherPlayers
  if (Object.keys(players).length > 0) {
    io.emit('otherPlayers', { players: Object.values(players) });
  }

  // COOP: Boss movement, attacks, obstacles
  if (gameInProgress) {
    coopBoss.x += coopBoss.dir * BOSS_SPEED * (delta * 60);
    if (coopBoss.x < BOSS_X_MIN) { coopBoss.x = BOSS_X_MIN; coopBoss.dir = 1; }
    if (coopBoss.x > BOSS_X_MAX) { coopBoss.x = BOSS_X_MAX; coopBoss.dir = -1; }
    coopBoss.y += coopBoss.yDir * BOSS_Y_SPEED * (delta * 60);
    if (coopBoss.y < BOSS_Y_MIN) { coopBoss.y = BOSS_Y_MIN; coopBoss.yDir = 1; }
    if (coopBoss.y > BOSS_Y_MAX) { coopBoss.y = BOSS_Y_MAX; coopBoss.yDir = -1; }
    coopBoss.angle += 0.02 * (delta * 60);

    io.emit('bossUpdate', { ...coopBoss });

    // Boss attack logic
    bossAttackCooldown -= 40;
    if (bossAttackCooldown <= 0 && Object.keys(players).length > 0) {
      let unlockedPatterns = Math.min(Math.ceil((coopBoss.maxHealth - coopBoss.health) / 3000) + 2, BOSS_ATTACK_PATTERNS.length);
      const pattern = BOSS_ATTACK_PATTERNS[Math.floor(Math.random() * unlockedPatterns)];
      io.emit('bossAttack', { pattern, x: coopBoss.x, y: coopBoss.y, time: Date.now() });
      bossAttackCooldown = Math.random() * (MAX_ATTACK_INTERVAL - MIN_ATTACK_INTERVAL) + MIN_ATTACK_INTERVAL;
    }

    if (Math.random() < 0.035) spawnGlobalObstacle();
    updateObstacles();
    io.emit('obstaclesUpdate', coopObstacles);
  }

  // DUEL 1v1: Sync states and events, spawn powerups/obstacles
  for (const [room, duel] of Object.entries(duelRooms)) {
    if (duel.ended) continue;

    // Powerup spawn ogni 4 secondi circa
    if (Math.random() < 0.025) spawnDuelPowerup(room);
    // Obstacle spawn ogni 7 secondi circa
    if (Math.random() < 0.012) spawnDuelObstacle(room);

    [duel.p1, duel.p2].forEach(playerSocket => {
      if (!playerSocket.connected) return;
      const oppId = getOpponent(room, playerSocket.id)?.id;
      let oppState = duel.states[oppId] || {};
      let meta = duel.playerMeta[oppId] || {};
      // PATCH: Always send maxHealth in opponent state for client health bar
      if (typeof oppState.maxHealth !== "number") oppState.maxHealth = 100;
      playerSocket.emit('duel_state', {
        opponent: { ...oppState, skin: meta.skin, nickname: meta.nickname },
        powerups: duel.powerups,
        obstacles: duel.obstacles,
        events: duel.events
      });
    });
    duel.events = [];
  }
}, 50);

// === SOCKET.IO HANDLERS ===
io.on('connection', (socket) => {
  // --- COOP MODE ---
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

  socket.on('chatMessage', (data) => {
    if (typeof data.text === "string" && data.text.length <= 200) {
      io.emit('chatMessage', {
        nickname: data.nickname || 'Player',
        text: data.text
      });
    }
  });

  socket.on('shoot', (data) => io.emit('spawnBullet', data));
  socket.on('obstacleHit', (obstacleId) => {
    const ob = coopObstacles.find(o => o.id === obstacleId);
    if (ob) ob.hit = true;
    io.emit('obstaclesUpdate', coopObstacles);
  });

  // --- DISCONNECTION: COOP + DUEL ---
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

    // Rimuovi dalla queue DUEL
    duelQueue = duelQueue.filter(p => p.socket.id !== socket.id);

    // Se era in una room DUEL, notifica avversario e termina la room
    for (const [room, duel] of Object.entries(duelRooms)) {
      if (duel.ended) continue;
      if (duel.p1.id === socket.id || duel.p2.id === socket.id) {
        duel.ended = true;
        const winner = (duel.p1.id === socket.id) ? duel.p2.id : duel.p1.id;
        if (io.sockets.sockets.get(winner))
          io.to(winner).emit('duel_opponent_left');
        io.to(duel.p1.id).emit('duel_end', { winner, stats: duel.stats });
        io.to(duel.p2.id).emit('duel_end', { winner, stats: duel.stats });
        delete duelRooms[room];
      }
    }
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

  // --- 1v1 DUEL PvP MODE ---
  socket.on('duel_queue', (data) => {
    if (duelQueue.find(p => p.socket.id === socket.id)) return;
    duelQueue.push({ socket, nickname: data.nickname || "Player", skin: data.skin || "navicella2.png" });
    if (duelQueue.length >= 2) {
      const [p1, p2] = duelQueue.splice(0, 2);
      const room = createDuelRoom(p1.socket, p2.socket);
      const opp1 = { id: p2.socket.id, nickname: p2.nickname, skin: p2.skin };
      const opp2 = { id: p1.socket.id, nickname: p1.nickname, skin: p1.skin };
      p1.socket.join(room);
      p2.socket.join(room);
      p1.socket.emit('duel_opponent_found', { room, opponent: opp1 });
      p2.socket.emit('duel_opponent_found', { room, opponent: opp2 });
    }
  });

  socket.on('duel_cancel', () => {
    duelQueue = duelQueue.filter(p => p.socket.id !== socket.id);
  });

  socket.on('duel_update', (data) => {
    const { room, player, action } = data;
    const duel = duelRooms[room];
    if (!duel || duel.ended) return;
    if (player.skin) duel.playerMeta[socket.id].skin = player.skin;
    if (player.nickname) duel.playerMeta[socket.id].nickname = player.nickname;
    duel.states[socket.id] = { ...player, id: socket.id, maxHealth: (typeof player.maxHealth === "number" ? player.maxHealth : 100) };
    if (action === "shoot") {
      duel.events.push({ type: "shoot", player: socket.id, ...player });
      duel.stats[socket.id].damage += 25;
    }
    // Eventi: emote, powerup, ecc.
    if (action === "emote" && data.emote) {
      duel.events.push({ type: "emote", player: socket.id, emote: data.emote });
      io.in(room).emit('duel_emote', { player: socket.id, emote: data.emote });
    }
    // Powerup raccolto
    if (action === "powerup_pick" && data.powerupId) {
      const idx = duel.powerups.findIndex(p => p.id === data.powerupId);
      if (idx >= 0) {
        duel.powerups[idx].active = false;
        duel.events.push({ type: "powerup_pick", player: socket.id, powerup: duel.powerups[idx] });
        io.in(room).emit('powerup_picked', { player: socket.id, powerup: duel.powerups[idx] });
      }
    }
    // Ostacolo colpito
    if (action === "obstacle_hit" && data.obstacleId) {
      const idx = duel.obstacles.findIndex(o => o.id === data.obstacleId);
      if (idx >= 0) {
        duel.obstacles[idx].hit = true;
        duel.events.push({ type: "obstacle_hit", player: socket.id, obstacle: duel.obstacles[idx] });
        io.in(room).emit('duel_obstacle_hit', { player: socket.id, obstacle: duel.obstacles[idx] });
      }
    }
    // Gestione morte server-side (race condition safe)
    const p1dead = duel.states[duel.p1.id]?.health <= 0;
    const p2dead = duel.states[duel.p2.id]?.health <= 0;
    if ((p1dead || p2dead) && !duel.ended) {
      duel.ended = true;
      let winner = null;
      if (p1dead && p2dead) winner = "draw";
      else if (p1dead) winner = duel.p2.id;
      else if (p2dead) winner = duel.p1.id;
      duel.stats[duel.p1.id].kills = p2dead ? 1 : 0;
      duel.stats[duel.p2.id].kills = p1dead ? 1 : 0;
      duel.winner = winner;
      io.to(duel.p1.id).emit('duel_end', { winner, stats: duel.stats });
      io.to(duel.p2.id).emit('duel_end', { winner, stats: duel.stats });
      setTimeout(() => delete duelRooms[room], 3000);
    }
  });

  // --- PATCH: Rematch (il client farà semplicemente startDuelQueue di nuovo) ---
});

// === PORT ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on port ' + PORT));
