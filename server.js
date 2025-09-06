// --- Stellar Guardian Multiplayer Server: COOP + 1v1 DUEL + Spettatori ---
// Node.js + Socket.io v4+
// (c) 2024-2025 Luka

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// =====================================================
// FETCH SAFE (fallback per Node < 18 o node-fetch ESM)
// =====================================================
let fetchFn = globalThis.fetch;
if (typeof fetchFn !== 'function') {
  try {
    fetchFn = (...args) => import('node-fetch').then(m => m.default(...args));
    console.log('[INIT] Using dynamic import for node-fetch');
  } catch (e) {
    console.error('[INIT] Impossibile configurare fetch fallback:', e);
  }
}
async function safeFetch(url, options) {
  if (typeof fetchFn !== 'function') throw new Error('fetch non disponibile');
  return fetchFn(url, options);
}

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
let bossAttackTimer = 0; // (sostituisce bossAttackCooldown)
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
  gameInProgress = false;
  bossAttackTimer = 0;
}

// =====================================================
// DREAMLO CO-OP LEADERBOARD (robusto, no crash)
// =====================================================
async function submitCoopTeamScore(teamName, score) {
  try {
    if (!teamName) teamName = 'Team';
    if (typeof score !== 'number' || !isFinite(score) || score <= 0) {
      console.warn('[Dreamlo] Punteggio non valido, skip:', teamName, score);
      return { ok: false, reason: 'invalid_score' };
    }
    const dreamloKey = process.env.DREAMLO_KEY_PUBLIC || "5z7d7N8IBkSwrhJdyZAXxAYn3Jv1KyTEm6GJZoIALRBw";
    const tag = "coopraid";
    const url = `https://dreamlo.com/lb/${dreamloKey}/update/${encodeURIComponent(teamName)}/${Math.floor(score)}/${tag}`;
    const res = await safeFetch(url);
    if (!res.ok) {
      console.warn('[Dreamlo] HTTP non OK:', res.status);
      return { ok: false, status: res.status };
    }
    const text = await res.text();
    console.log(`[Dreamlo] Co-op score inviato: ${teamName} - ${score} (response: ${text.slice(0,80)})`);
    return { ok: true };
  } catch (err) {
    console.error('[Dreamlo] Errore invio co-op (non blocco il server):', err.message);
    return { ok: false, error: err.message };
  }
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
  if (coopObstacles.length > 80) {
    coopObstacles.splice(0, coopObstacles.length - 80);
  }
}
function updateObstacles() {
  coopObstacles.forEach(o => { o.x += o.vx; o.y += o.vy; o.angle += o.spin; });
  coopObstacles = coopObstacles.filter(o =>
    o.y < GAME_HEIGHT + 60 && o.x > -80 && o.x < GAME_WIDTH + 80 && !o.hit
  );
}

// === 1v1 DUEL STATE ===
let duelQueue = []; // [{socket, nickname, skin}]
let duelRooms = {}; // roomId -> { ... }
let duelSpectators = {}; // roomId -> [socket.id]

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
    },
    roundNum: 1,
    roundWins: { [p1.id]: 0, [p2.id]: 0 },
    maxRounds: 3
  };
  duelSpectators[room] = [];
  return room;
}
function getOpponent(room, id) {
  const duel = duelRooms[room];
  if (!duel) return null;
  return (duel.p1.id === id) ? duel.p2 : duel.p1;
}

function startNextDuelRound(roomId, roundNumber = 1) {
  const duel = duelRooms[roomId];
  if (!duel) return;
  const INIT_HEALTH = 500;
  const playerStates = {
    [duel.p1.id]: { x: 300, y: 600, health: INIT_HEALTH, energy: 100 },
    [duel.p2.id]: { x: 900, y: 600, health: INIT_HEALTH, energy: 100 }
  };
  duel.states[duel.p1.id] = { ...playerStates[duel.p1.id], id: duel.p1.id, maxHealth: INIT_HEALTH };
  duel.states[duel.p2.id] = { ...playerStates[duel.p2.id], id: duel.p2.id, maxHealth: INIT_HEALTH };
  duel.powerups = [];
  duel.obstacles = [];
  duel.events = [];
  console.log(`[DUEL] Inizio nuovo round ${roundNumber} in room ${roomId}`);
  io.in(roomId).emit('duel_next_round', {
    round: roundNumber,
    playerStates
  });
  duelSpectators[roomId]?.forEach(sid => {
    io.to(sid).emit('duel_next_round', {
      round: roundNumber,
      playerStates
    });
  });
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
    duelSpectators[room]?.forEach(sid => {
      io.to(sid).emit('powerup_spawn', powerup);
    });
  }
}
function spawnDuelObstacle(room) {
  const type = "mine";
  const x = 150 + Math.random() * 700;
  const y = 250 + Math.random() * 300;
  const obstacle = { id: generateUniqueId(), type, x, y, size: 32 + Math.random() * 22, hit: false };
  if (duelRooms[room]) {
    duelRooms[room].obstacles.push(obstacle);
    io.in(room).emit('duel_obstacle_spawn', obstacle);
    duelSpectators[room]?.forEach(sid => {
      io.to(sid).emit('duel_obstacle_spawn', obstacle);
    });
  }
}

// === LOOP GIOCO (COOP/DUEL SYNC) ===
let lastBossFrame = Date.now();
let lastOtherPlayersBroadcast = 0;
const OTHER_PLAYERS_INTERVAL = 90; // ms ~11Hz

setInterval(() => {
  const now = Date.now();
  let delta = (now - lastBossFrame) / 1000;
  lastBossFrame = now;
  delta = Math.max(0.02, Math.min(delta, 0.07));

  // Broadcast posizioni (throttled)
  if (Object.keys(players).length > 0) {
    if (now - lastOtherPlayersBroadcast >= OTHER_PLAYERS_INTERVAL) {
      lastOtherPlayersBroadcast = now;
      io.emit('otherPlayers', {
        players: Object.values(players).map(p => ({
          id: p.id, x: p.x, y: p.y, angle: p.angle, nickname: p.nickname, dead: p.dead
        }))
      });
    }
  }

  if (gameInProgress) {
    coopBoss.x += coopBoss.dir * BOSS_SPEED * (delta * 60);
    if (coopBoss.x < BOSS_X_MIN) { coopBoss.x = BOSS_X_MIN; coopBoss.dir = 1; }
    if (coopBoss.x > BOSS_X_MAX) { coopBoss.x = BOSS_X_MAX; coopBoss.dir = -1; }
    coopBoss.y += coopBoss.yDir * BOSS_Y_SPEED * (delta * 60);
    if (coopBoss.y < BOSS_Y_MIN) { coopBoss.y = BOSS_Y_MIN; coopBoss.yDir = 1; }
    if (coopBoss.y > BOSS_Y_MAX) { coopBoss.y = BOSS_Y_MAX; coopBoss.yDir = -1; }
    coopBoss.angle += 0.02 * (delta * 60);

    io.emit('bossUpdate', { ...coopBoss });

    // Timer attacchi boss a tempo reale
    bossAttackTimer -= (delta * 1000);
    if (bossAttackTimer <= 0 && Object.keys(players).length > 0) {
      let unlockedPatterns = Math.min(
        Math.ceil((coopBoss.maxHealth - coopBoss.health) / 3000) + 2,
        BOSS_ATTACK_PATTERNS.length
      );
      const pattern = BOSS_ATTACK_PATTERNS[Math.floor(Math.random() * unlockedPatterns)];
      io.emit('bossAttack', { pattern, x: coopBoss.x, y: coopBoss.y, time: Date.now() });
      bossAttackTimer = Math.random() * (MAX_ATTACK_INTERVAL - MIN_ATTACK_INTERVAL) + MIN_ATTACK_INTERVAL;
    }

    if (Math.random() < 0.035) spawnGlobalObstacle();
    updateObstacles();
    io.emit('obstaclesUpdate', coopObstacles);
  }

  // Duel sync
  for (const [room, duel] of Object.entries(duelRooms)) {
    if (duel.ended) continue;

    if (Math.random() < 0.025) spawnDuelPowerup(room);
    if (Math.random() < 0.012) spawnDuelObstacle(room);

    [duel.p1, duel.p2].forEach(playerSocket => {
      if (!playerSocket.connected) return;
      const oppId = getOpponent(room, playerSocket.id)?.id;
      let oppState = duel.states[oppId] || {};
      let meta = duel.playerMeta[oppId] || {};
      if (typeof oppState.maxHealth !== "number") oppState.maxHealth = 100;
      let selfState = duel.states[playerSocket.id] || {};
      if (typeof selfState.maxHealth !== "number") selfState.maxHealth = 100;

      playerSocket.emit('duel_state', {
        opponent: { ...oppState, skin: meta.skin, nickname: meta.nickname },
        self: selfState,
        powerups: duel.powerups,
        obstacles: duel.obstacles,
        events: duel.events
      });
    });

    if (duelSpectators[room]) {
      const playerStates = [
        { ...duel.states[duel.p1.id], ...duel.playerMeta[duel.p1.id] },
        { ...duel.states[duel.p2.id], ...duel.playerMeta[duel.p2.id] }
      ];
      duelSpectators[room].forEach(sid => {
        io.to(sid).emit('duel_state', {
          players: playerStates,
          spectators: duelSpectators[room].length
        });
        io.to(sid).emit('powerup_spawn', ...duel.powerups);
        io.to(sid).emit('duel_obstacle_spawn', ...duel.obstacles);
      });
    }

    duel.events = [];
  }
}, 50);

// === RATE LIMITERS & MAPS ===
const lastBossDamageTime = new Map();
const chatCounters = new Map();

// === HELPERS ===
function sanitizeName(str, max = 16) {
  return (str || 'Player').toString().replace(/[^A-Za-z0-9_ ]/g, '').slice(0, max);
}
function buildTeamName() {
  return Object.values(players)
    .map(p => sanitizeName(p.nickname, 12))
    .join('_')
    .slice(0, 48) || 'Team';
}

// === SOCKET.IO HANDLERS ===
io.on('connection', (socket) => {
  // --- JOIN LOBBY ---
  socket.on('joinLobby', (data) => {
    players[socket.id] = {
      id: socket.id,
      x: 200 + Math.random() * 400,
      y: 400 + Math.random() * 120,
      nickname: sanitizeName(data.nickname,16),
      angle: 0,
      health: 100,
      maxHealth: 100,
      role: "dps",
      ready: false,
      lives: 3,
      dead: false
    };
    playerVoiceStatus[socket.id] = false;
    if (!hostId) hostId = socket.id;
    inviaLobbyAggiornata();
  });

  socket.on('playerMove', (data) => {
    if (players[socket.id] && !players[socket.id].dead) {
      if (typeof data.x === 'number') players[socket.id].x = data.x;
      if (typeof data.y === 'number') players[socket.id].y = data.y;
      players[socket.id].angle = typeof data.angle === 'number' ? data.angle : players[socket.id].angle;
      if (data.nickname) players[socket.id].nickname = sanitizeName(data.nickname,16);
    }
  });

  socket.on('playerReady', ({ ready }) => {
    if (players[socket.id]) {
      players[socket.id].ready = !!ready;
      inviaLobbyAggiornata();
    }
  });

  socket.on('selectRole', ({ role }) => {
    if (players[socket.id] && typeof role === 'string') {
      players[socket.id].role = role;
      inviaLobbyAggiornata();
    }
  });

  socket.on('startCoopRaid', () => {
    if (socket.id !== hostId) return;
    const allReady = Object.values(players).every(p => p.ready);
    if (!allReady) {
      socket.emit('error', { message: "Non tutti sono pronti!" });
      return;
    }
    Object.values(players).forEach(p => {
      p.health = 100;
      p.lives = 3;
      p.dead = false;
    });
    resetGame();
    gameInProgress = true;
    io.emit('gameStart', { boss: { ...coopBoss }, players: Object.values(players) });
  });

  socket.on('bossDamage', ({ damage }) => {
    if (!gameInProgress || coopBoss.health <= 0) return;
    if (typeof damage !== "number" || damage <= 0 || damage > 300) return;
    if (players[socket.id]?.dead) return;

    // Throttle DPS (min 60ms)
    const now = Date.now();
    const last = lastBossDamageTime.get(socket.id) || 0;
    if (now - last < 60) return;
    lastBossDamageTime.set(socket.id, now);

    const role = players[socket.id]?.role;
    let finalDamage = damage;
    if (role === "dps") finalDamage *= 1.25;
    if (role === "tank") finalDamage *= 0.75;
    if (role === "support") finalDamage *= 1.05;
    if (role === "healer") finalDamage *= 0.9;

    coopBoss.health -= finalDamage;
    if (coopBoss.health < 0) coopBoss.health = 0;
    io.emit('bossUpdate', { ...coopBoss });
    if (coopBoss.health <= 0) {
      gameInProgress = false;
      const squadNicknames = buildTeamName();
      submitCoopTeamScore(squadNicknames, Math.floor(coopBoss.maxHealth))
        .then(r => { if (!r.ok) console.warn('[Dreamlo] punteggio non salvato:', r); });
      io.emit('bossDefeated', { team: squadNicknames, score: Math.floor(coopBoss.maxHealth) });
    }
  });

  socket.on('playerHit', ({ damage }) => {
    if (!gameInProgress || typeof damage !== "number" || damage <= 0 || damage > 100) return;
    const player = players[socket.id];
    if (!player || player.dead) return;
    player.health -= damage;
    if (player.health <= 0) {
      player.health = 0;
      player.lives -= 1;
      if (player.lives <= 0) {
        player.dead = true;
        io.to(socket.id).emit('playerDead', { lives: 0 });
      } else {
        io.to(socket.id).emit('playerCanRetry', { lives: player.lives });
      }
      inviaLobbyAggiornata();
    } else {
      io.to(socket.id).emit('playerHit', { health: player.health, lives: player.lives });
    }
  });

  socket.on('playerRetry', () => {
    const player = players[socket.id];
    if (!player || !player.dead) return;
    if (player.lives <= 0) {
      io.to(socket.id).emit('playerDead', { lives: 0 });
      return;
    }
    player.health = 100;
    player.dead = false;
    io.to(socket.id).emit('playerRespawn', { health: player.health, lives: player.lives });
    inviaLobbyAggiornata();
  });

  socket.on('voiceActive', (data) => {
    playerVoiceStatus[socket.id] = !!data.active;
    io.emit('voiceActive', { id: socket.id, active: !!data.active });
  });

  socket.on('chatMessage', (data) => {
    if (typeof data.text !== "string" || data.text.length > 200) return;
    // Rate limit chat: max 8 in 10s
    const now = Date.now();
    const history = chatCounters.get(socket.id) || [];
    const recent = history.filter(t => now - t < 10000);
    if (recent.length >= 8) return;
    recent.push(now);
    chatCounters.set(socket.id, recent);

    io.emit('chatMessage', {
      nickname: sanitizeName(data.nickname || players[socket.id]?.nickname || 'Player',16),
      text: data.text
    });
  });

  socket.on('shoot', (data) => {
    if (players[socket.id] && !players[socket.id].dead) {
      io.emit('spawnBullet', data);
    }
  });

  socket.on('obstacleHit', (obstacleId) => {
    const ob = coopObstacles.find(o => o.id === obstacleId);
    if (ob) ob.hit = true;
    io.emit('obstaclesUpdate', coopObstacles);
  });

  // === DUEL QUEUE ===
  socket.on('duel_queue', (data) => {
    if (duelQueue.find(p => p.socket.id === socket.id)) return;
    duelQueue.push({ socket, nickname: sanitizeName(data.nickname || "Player",16), skin: data.skin || "navicella2.png" });
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

    // Special ability
    if (action === 'special_ability' && data.type) {
      if (duel.states[socket.id]?.health <= 0) return;
      const opponentId = getOpponent(room, socket.id)?.id;
      if (opponentId && io.sockets.sockets.get(opponentId)) {
        io.to(opponentId).emit('duel_special', { type: data.type });
        console.log(`[DUEL] Special ability '${data.type}' from ${socket.id} to ${opponentId}`);
      }
      return;
    }

    if (player?.skin) duel.playerMeta[socket.id].skin = player.skin;
    if (player?.nickname) duel.playerMeta[socket.id].nickname = sanitizeName(player.nickname,16);

    // Stato server-authoritative (ignora health client)
    {
      const prev = duel.states[socket.id] || { id: socket.id, health: 100, maxHealth: 100, energy: 100 };
      duel.states[socket.id] = {
        id: socket.id,
        x: typeof player?.x === 'number' ? player.x : prev.x,
        y: typeof player?.y === 'number' ? player.y : prev.y,
        health: prev.health,
        maxHealth: prev.maxHealth,
        energy: typeof player?.energy === 'number'
          ? Math.max(0, Math.min(player.energy, 100))
          : prev.energy
      };
    }

    if (duel.states[socket.id]?.health <= 0) {
      if (action === "shoot" || action === "powerup_pick" || action === "obstacle_hit" || action === "special_ability") return;
    }

    if (action === "shoot" &&
        typeof data.x === "number" &&
        typeof data.y === "number" &&
        typeof data.vx === "number" &&
        typeof data.vy === "number") {
      if (duel.states[socket.id]?.health <= 0) return;
      const opponent = getOpponent(room, socket.id);
      if (opponent && io.sockets.sockets.get(opponent.id)) {
        io.to(opponent.id).emit('duel_opponent_shoot', {
          x: data.x, y: data.y, vx: data.vx, vy: data.vy
        });
      }
      duel.events.push({ type: "shoot", player: socket.id, x: data.x, y: data.y, vx: data.vx, vy: data.vy });
      // (Nota: damage effettivo verrà assegnato su 'duel_hit')
    }

    if (action === "emote" && data.emote) {
      duel.events.push({ type: "emote", player: socket.id, emote: data.emote });
      io.in(room).emit('duel_emote', { player: socket.id, emote: data.emote });
      duelSpectators[room]?.forEach(sid => {
        io.to(sid).emit('duel_emote', { player: socket.id, emote: data.emote });
      });
    }

    if (action === "powerup_pick" && data.powerupId) {
      if (duel.states[socket.id]?.health <= 0) return;
      const idx = duel.powerups.findIndex(p => p.id === data.powerupId);
      if (idx >= 0) {
        duel.powerups[idx].active = false;
        duel.events.push({ type: "powerup_pick", player: socket.id, powerup: duel.powerups[idx] });
        io.in(room).emit('powerup_picked', { player: socket.id, powerup: duel.powerups[idx] });
        duelSpectators[room]?.forEach(sid => {
          io.to(sid).emit('powerup_picked', { player: socket.id, powerup: duel.powerups[idx] });
        });
      }
    }

    if (action === "obstacle_hit" && data.obstacleId) {
      if (duel.states[socket.id]?.health <= 0) return;
      const idx = duel.obstacles.findIndex(o => o.id === data.obstacleId);
      if (idx >= 0) {
        duel.obstacles[idx].hit = true;
        duel.events.push({ type: "obstacle_hit", player: socket.id, obstacle: duel.obstacles[idx] });
        io.in(room).emit('duel_obstacle_hit', { player: socket.id, obstacle: duel.obstacles[idx] });
        duelSpectators[room]?.forEach(sid => {
          io.to(sid).emit('duel_obstacle_hit', { player: socket.id, obstacle: duel.obstacles[idx] });
        });
      }
    }

    const p1dead = duel.states[duel.p1.id]?.health <= 0;
    const p2dead = duel.states[duel.p2.id]?.health <= 0;

    if ((p1dead || p2dead) && !duel.ended) {
      if (!duel.roundNum) duel.roundNum = 1;
      if (!duel.roundWins) duel.roundWins = { [duel.p1.id]: 0, [duel.p2.id]: 0 };
      if (!duel.maxRounds) duel.maxRounds = 3;

      let roundWinner = null;
      if (p1dead && p2dead) roundWinner = "draw";
      else if (p1dead) roundWinner = duel.p2.id;
      else if (p2dead) roundWinner = duel.p1.id;

      if (roundWinner && roundWinner !== "draw") duel.roundWins[roundWinner] += 1;
      duel.stats[duel.p1.id].kills = p2dead ? 1 : 0;
      duel.stats[duel.p2.id].kills = p1dead ? 1 : 0;

      const winNeeded = Math.ceil(duel.maxRounds / 2);
      const p1Win = duel.roundWins[duel.p1.id] >= winNeeded;
      const p2Win = duel.roundWins[duel.p2.id] >= winNeeded;
      const roundsFinished = duel.roundNum >= duel.maxRounds;

      if (p1Win || p2Win || roundsFinished) {
        duel.ended = true;
        let finalWinner;
        if (duel.roundWins[duel.p1.id] > duel.roundWins[duel.p2.id]) finalWinner = duel.p1.id;
        else if (duel.roundWins[duel.p2.id] > duel.roundWins[duel.p1.id]) finalWinner = duel.p2.id;
        else finalWinner = "draw";
        duel.winner = finalWinner;
        io.to(duel.p1.id).emit('duel_end', {
          winner: finalWinner === "draw" ? "draw" : (duel.p1.id === finalWinner ? duel.p1.id : duel.p2.id),
          stats: duel.stats
        });
        io.to(duel.p2.id).emit('duel_end', {
          winner: finalWinner === "draw" ? "draw" : (duel.p2.id === finalWinner ? duel.p2.id : duel.p1.id),
          stats: duel.stats
        });
        duelSpectators[room]?.forEach(sid =>
          io.to(sid).emit('duel_end', { winner: finalWinner, stats: duel.stats })
        );
        setTimeout(() => {
          delete duelRooms[room];
          delete duelSpectators[room];
        }, 3000);
      } else {
        duel.roundNum += 1;
        startNextDuelRound(room, duel.roundNum);
      }
    }
  });

  socket.on('duel_hit', ({ room, damage }) => {
    const duel = duelRooms[room];
    if (!duel || duel.ended) return;
    const attackerId = socket.id;
    const defenderId = getOpponent(room, attackerId)?.id;
    if (!defenderId) return;
    if (typeof damage !== 'number' || damage <= 0 || damage > 60) damage = 20;
    if (duel.states[defenderId] && duel.states[defenderId].health > 0 &&
        duel.states[attackerId] && duel.states[attackerId].health > 0) {
      duel.states[defenderId].health -= damage;
      if (duel.states[defenderId].health < 0) duel.states[defenderId].health = 0;
      duel.stats[attackerId].damage += damage;
    }
  });

  socket.on('duel_join', ({ roomId, role }) => {
    if (!roomId || !duelRooms[roomId]) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (role === 'spectator') {
      if (!duelSpectators[roomId]) duelSpectators[roomId] = [];
      duelSpectators[roomId].push(socket.id);
      socket.join(roomId);
      const duel = duelRooms[roomId];
      const playerStates = [
        { ...duel.states[duel.p1.id], ...duel.playerMeta[duel.p1.id] },
        { ...duel.states[duel.p2.id], ...duel.playerMeta[duel.p2.id] }
      ];
      socket.emit('duel_state', {
        players: playerStates,
        spectators: duelSpectators[roomId].length
      });
    }
  });

  // === DISCONNECT PATCH COMPLETA ===
  socket.on('disconnect', () => {
    // 1. Rimuovi da lobby coop
    delete players[socket.id];
    delete playerVoiceStatus[socket.id];

    // 2. Se era host coop -> passa host o ferma partita
    if (hostId === socket.id) {
      const ids = Object.keys(players);
      hostId = ids.length > 0 ? ids[0] : null;
      if (!hostId) {
        gameInProgress = false;
        // (opzionale) io.emit('coop_aborted');
      }
    }

    // 3. Rimuovi da duelQueue (se era in attesa)
    duelQueue = duelQueue.filter(entry => entry.socket.id !== socket.id);

    // 4. Rimuovi da spettatori (aggiorna conteggio)
    for (const [roomId, spectators] of Object.entries(duelSpectators)) {
      if (!Array.isArray(spectators)) continue;
      const before = spectators.length;
      duelSpectators[roomId] = spectators.filter(sid => sid !== socket.id);
      if (before !== duelSpectators[roomId].length) {
        io.to(roomId).emit('duel_spectators', { spectators: duelSpectators[roomId].length });
      }
    }

    // 5. Se era player attivo in un duel => vittoria all'altro
    for (const [roomId, duel] of Object.entries(duelRooms)) {
      if (!duel || duel.ended) continue;
      if (duel.p1.id === socket.id || duel.p2.id === socket.id) {
        duel.ended = true;
        const disconnectedId = socket.id;
        const survivorSocket = (duel.p1.id === disconnectedId) ? duel.p2 : duel.p1;
        const survivorId = survivorSocket?.id;
        let winner = survivorId || 'draw';
        if (winner !== 'draw' && duel.stats[winner]) {
            duel.stats[winner].kills = 1;
        }
        if (survivorId && io.sockets.sockets.get(survivorId)) {
          io.to(survivorId).emit('duel_end', {
            winner: survivorId,
            stats: duel.stats,
            reason: 'opponent_disconnect'
          });
        }
        duelSpectators[roomId]?.forEach(sid => {
          io.to(sid).emit('duel_end', {
            winner,
            stats: duel.stats,
            reason: 'opponent_disconnect'
          });
        });
        setTimeout(() => {
          delete duelRooms[roomId];
          delete duelSpectators[roomId];
        }, 2500);
      }
    }

    // 6. Aggiorna lobby coop & voice stato
    inviaLobbyAggiornata();
    io.emit('voiceActive', { id: socket.id, active: false });
  });

  function inviaLobbyAggiornata() {
    io.emit('lobbyUpdate', { players: Object.values(players) });
  }

  // --- WEBRTC ---
  socket.on('webrtc-offer', (data) =>
    socket.to(data.targetId).emit('webrtc-offer', { fromId: socket.id, sdp: data.sdp }));
  socket.on('webrtc-answer', (data) =>
    socket.to(data.targetId).emit('webrtc-answer', { fromId: socket.id, sdp: data.sdp }));
  socket.on('webrtc-ice', (data) =>
    socket.to(data.targetId).emit('webrtc-ice', { fromId: socket.id, candidate: data.candidate }));
});

// === GLOBAL ERROR HANDLERS ===
process.on('unhandledRejection', err => {
  console.error('[unhandledRejection]', err);
});
process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err);
  // Valuta se riavviare con un process manager
});

// === PORT ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server listening on port ' + PORT);
  console.log('Node version:', process.version);
});
