// --- Stellar Guardian Multiplayer Server: ENHANCED 1v1 DUEL + COOP ---
// Node.js + Socket.io v4+
// (c) 2024-2025 Luka - Enhanced Edition

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000
});

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

// === ENHANCED 1v1 DUEL SYSTEM ===
let duelQueue = []; // Giocatori in attesa
let duelRooms = {}; // Stanze di duello attive
let duelLeaderboard = []; // Classifiche globali
let playerProfiles = {}; // Profili persistenti giocatori

// Configurazioni avanzate del duello
const DUEL_CONFIG = {
  ARENA_WIDTH: 800,
  ARENA_HEIGHT: 600,
  POWERUP_SPAWN_RATE: 0.005, // Probabilità per frame
  OBSTACLE_SPAWN_RATE: 0.003,
  MAX_POWERUPS: 3,
  MAX_OBSTACLES: 5,
  ROUND_TIME_LIMIT: 180000, // 3 minuti
  ENERGY_REGEN_RATE: 1.5,
  SHIELD_DURATION: 5000,
  SPEED_BOOST_DURATION: 7000,
  DAMAGE_BOOST_DURATION: 8000
};

// Tipi di powerup disponibili
const POWERUP_TYPES = [
  { type: 'health', weight: 30, effect: { health: 35 } },
  { type: 'energy', weight: 25, effect: { energy: 50 } },
  { type: 'shield', weight: 15, effect: { shield: DUEL_CONFIG.SHIELD_DURATION } },
  { type: 'damage', weight: 15, effect: { damageMultiplier: 1.5, duration: DUEL_CONFIG.DAMAGE_BOOST_DURATION } },
  { type: 'speed', weight: 10, effect: { speedMultiplier: 1.4, duration: DUEL_CONFIG.SPEED_BOOST_DURATION } },
  { type: 'rapid', weight: 5, effect: { fireRateMultiplier: 2.0, duration: 6000 } }
];

// === UTILITY FUNCTIONS ===
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
  bossAttackCooldown = 0;
}

function getRandomWeighted(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item;
  }
  return items[items.length - 1];
}

// === DUEL ROOM MANAGEMENT ===
function createDuelRoom(p1, p2) {
  const roomId = generateUniqueId();
  const room = {
    id: roomId,
    p1, p2,
    states: {
      [p1.id]: { 
        x: 150, y: 300, angle: 0, health: 100, maxHealth: 100, 
        energy: 100, maxEnergy: 100, shields: 0, effects: {}
      },
      [p2.id]: { 
        x: 650, y: 300, angle: Math.PI, health: 100, maxHealth: 100, 
        energy: 100, maxEnergy: 100, shields: 0, effects: {}
      }
    },
    stats: {
      [p1.id]: { kills: 0, damage: 0, hits: 0, shots: 0, powerupsCollected: 0 },
      [p2.id]: { kills: 0, damage: 0, hits: 0, shots: 0, powerupsCollected: 0 }
    },
    powerups: [],
    obstacles: [],
    events: [],
    bullets: [],
    winner: null,
    ended: false,
    startTime: Date.now(),
    lastUpdate: Date.now(),
    playerMeta: {
      [p1.id]: { 
        skin: p1.skin || "navicella2.png", 
        nickname: p1.nickname || "Player1",
        rating: getPlayerRating(p1.id)
      },
      [p2.id]: { 
        skin: p2.skin || "navicella2.png", 
        nickname: p2.nickname || "Player2",
        rating: getPlayerRating(p2.id)
      }
    },
    spectators: [],
    roundNumber: 1,
    bestOf: 3,
    roundWins: { [p1.id]: 0, [p2.id]: 0 }
  };
  
  duelRooms[roomId] = room;
  return roomId;
}

function getPlayerRating(playerId) {
  return playerProfiles[playerId]?.rating || 1000;
}

function updatePlayerRating(winnerId, loserId) {
  if (!playerProfiles[winnerId]) playerProfiles[winnerId] = { rating: 1000, wins: 0, losses: 0 };
  if (!playerProfiles[loserId]) playerProfiles[loserId] = { rating: 1000, wins: 0, losses: 0 };
  
  const winnerRating = playerProfiles[winnerId].rating;
  const loserRating = playerProfiles[loserId].rating;
  
  // Sistema ELO semplificato
  const K = 32;
  const expectedWin = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const newWinnerRating = Math.round(winnerRating + K * (1 - expectedWin));
  const newLoserRating = Math.round(loserRating + K * (0 - (1 - expectedWin)));
  
  playerProfiles[winnerId].rating = Math.max(100, newWinnerRating);
  playerProfiles[loserId].rating = Math.max(100, newLoserRating);
  playerProfiles[winnerId].wins++;
  playerProfiles[loserId].losses++;
}

function spawnDuelPowerup(room) {
  const duel = duelRooms[room];
  if (!duel || duel.powerups.length >= DUEL_CONFIG.MAX_POWERUPS) return;
  
  const powerupType = getRandomWeighted(POWERUP_TYPES);
  const powerup = {
    id: generateUniqueId(),
    type: powerupType.type,
    x: 100 + Math.random() * (DUEL_CONFIG.ARENA_WIDTH - 200),
    y: 100 + Math.random() * (DUEL_CONFIG.ARENA_HEIGHT - 200),
    effect: powerupType.effect,
    spawnTime: Date.now(),
    duration: 15000 // 15 secondi prima di sparire
  };
  
  duel.powerups.push(powerup);
}

function spawnDuelObstacle(room) {
  const duel = duelRooms[room];
  if (!duel || duel.obstacles.length >= DUEL_CONFIG.MAX_OBSTACLES) return;
  
  const obstacle = {
    id: generateUniqueId(),
    type: Math.random() < 0.7 ? 'asteroid' : 'debris',
    x: Math.random() * DUEL_CONFIG.ARENA_WIDTH,
    y: -50,
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 3,
    size: 25 + Math.random() * 40,
    angle: 0,
    spin: (Math.random() - 0.5) * 0.1,
    health: Math.random() < 0.3 ? 2 : 1 // Alcuni ostacoli più resistenti
  };
  
  duel.obstacles.push(obstacle);
}

function updateDuelRoom(room) {
  const duel = duelRooms[room];
  if (!duel || duel.ended) return;
  
  const now = Date.now();
  const deltaTime = (now - duel.lastUpdate) / 1000;
  duel.lastUpdate = now;
  
  // Timeout del round (3 minuti)
  if (now - duel.startTime > DUEL_CONFIG.ROUND_TIME_LIMIT) {
    endDuelByTimeout(room);
    return;
  }
  
  // Aggiorna energia dei giocatori
  [duel.p1.id, duel.p2.id].forEach(playerId => {
    const state = duel.states[playerId];
    if (state && state.energy < state.maxEnergy) {
      state.energy = Math.min(state.maxEnergy, state.energy + DUEL_CONFIG.ENERGY_REGEN_RATE * deltaTime);
    }
    
    // Aggiorna effetti temporanei
    if (state && state.effects) {
      Object.keys(state.effects).forEach(effect => {
        if (state.effects[effect] > 0) {
          state.effects[effect] -= deltaTime * 1000;
          if (state.effects[effect] <= 0) {
            delete state.effects[effect];
          }
        }
      });
    }
  });
  
  // Spawn powerups
  if (Math.random() < DUEL_CONFIG.POWERUP_SPAWN_RATE) {
    spawnDuelPowerup(room);
  }
  
  // Spawn obstacles
  if (Math.random() < DUEL_CONFIG.OBSTACLE_SPAWN_RATE) {
    spawnDuelObstacle(room);
  }
  
  // Aggiorna ostacoli
  duel.obstacles.forEach(obs => {
    obs.x += obs.vx * deltaTime * 60;
    obs.y += obs.vy * deltaTime * 60;
    obs.angle += obs.spin * deltaTime * 60;
  });
  
  // Rimuovi ostacoli fuori schermo
  duel.obstacles = duel.obstacles.filter(obs => 
    obs.y < DUEL_CONFIG.ARENA_HEIGHT + 100 && 
    obs.x > -100 && 
    obs.x < DUEL_CONFIG.ARENA_WIDTH + 100 &&
    obs.health > 0
  );
  
  // Rimuovi powerups scaduti
  duel.powerups = duel.powerups.filter(p => 
    now - p.spawnTime < p.duration
  );
  
  // Aggiorna bullets
  duel.bullets.forEach(bullet => {
    bullet.x += Math.cos(bullet.angle) * bullet.speed * deltaTime * 60;
    bullet.y += Math.sin(bullet.angle) * bullet.speed * deltaTime * 60;
  });
  
  // Rimuovi bullets fuori schermo
  duel.bullets = duel.bullets.filter(bullet =>
    bullet.x > -50 && bullet.x < DUEL_CONFIG.ARENA_WIDTH + 50 &&
    bullet.y > -50 && bullet.y < DUEL_CONFIG.ARENA_HEIGHT + 50
  );
}

function endDuelByTimeout(room) {
  const duel = duelRooms[room];
  if (!duel || duel.ended) return;
  
  duel.ended = true;
  const p1Health = duel.states[duel.p1.id]?.health || 0;
  const p2Health = duel.states[duel.p2.id]?.health || 0;
  
  let winner = "draw";
  if (p1Health > p2Health) winner = duel.p1.id;
  else if (p2Health > p1Health) winner = duel.p2.id;
  
  duel.winner = winner;
  
  // Aggiorna rating
  if (winner !== "draw") {
    const loserId = winner === duel.p1.id ? duel.p2.id : duel.p1.id;
    updatePlayerRating(winner, loserId);
  }
  
  io.to(duel.p1.id).emit('duel_end', { 
    winner, 
    reason: 'timeout',
    stats: duel.stats,
    newRating: playerProfiles[duel.p1.id]?.rating || 1000
  });
  io.to(duel.p2.id).emit('duel_end', { 
    winner, 
    reason: 'timeout',
    stats: duel.stats,
    newRating: playerProfiles[duel.p2.id]?.rating || 1000
  });
  
  updateLeaderboard(duel);
  setTimeout(() => delete duelRooms[room], 5000);
}

function updateLeaderboard(duel) {
  const p1Meta = duel.playerMeta[duel.p1.id];
  const p2Meta = duel.playerMeta[duel.p2.id];
  
  // Aggiorna o crea entries nella leaderboard
  let p1Entry = duelLeaderboard.find(entry => entry.id === duel.p1.id);
  let p2Entry = duelLeaderboard.find(entry => entry.id === duel.p2.id);
  
  if (!p1Entry) {
    p1Entry = {
      id: duel.p1.id,
      nickname: p1Meta.nickname,
      rating: getPlayerRating(duel.p1.id),
      wins: 0,
      losses: 0,
      totalDamage: 0,
      accuracy: 0
    };
    duelLeaderboard.push(p1Entry);
  }
  
  if (!p2Entry) {
    p2Entry = {
      id: duel.p2.id,
      nickname: p2Meta.nickname,
      rating: getPlayerRating(duel.p2.id),
      wins: 0,
      losses: 0,
      totalDamage: 0,
      accuracy: 0
    };
    duelLeaderboard.push(p2Entry);
  }
  
  // Aggiorna statistiche
  if (duel.winner === duel.p1.id) {
    p1Entry.wins++;
    p2Entry.losses++;
  } else if (duel.winner === duel.p2.id) {
    p2Entry.wins++;
    p1Entry.losses++;
  }
  
  p1Entry.rating = getPlayerRating(duel.p1.id);
  p2Entry.rating = getPlayerRating(duel.p2.id);
  p1Entry.totalDamage += duel.stats[duel.p1.id].damage;
  p2Entry.totalDamage += duel.stats[duel.p2.id].damage;
  
  // Calcola accuracy
  const p1Stats = duel.stats[duel.p1.id];
  const p2Stats = duel.stats[duel.p2.id];
  p1Entry.accuracy = p1Stats.shots > 0 ? (p1Stats.hits / p1Stats.shots * 100) : 0;
  p2Entry.accuracy = p2Stats.shots > 0 ? (p2Stats.hits / p2Stats.shots * 100) : 0;
  
  // Ordina leaderboard per rating
  duelLeaderboard.sort((a, b) => b.rating - a.rating);
  
  // Mantieni solo top 50
  if (duelLeaderboard.length > 50) {
    duelLeaderboard = duelLeaderboard.slice(0, 50);
  }
}

// === MATCHMAKING AVANZATO ===
function findDuelMatch(newPlayer) {
  if (duelQueue.length === 0) return null;
  
  const newPlayerRating = getPlayerRating(newPlayer.socket.id);
  
  // Cerca un avversario con rating simile (±200 punti)
  let bestMatch = null;
  let bestRatingDiff = Infinity;
  
  for (let i = 0; i < duelQueue.length; i++) {
    const candidate = duelQueue[i];
    const candidateRating = getPlayerRating(candidate.socket.id);
    const ratingDiff = Math.abs(newPlayerRating - candidateRating);
    
    if (ratingDiff < bestRatingDiff) {
      bestMatch = { player: candidate, index: i };
      bestRatingDiff = ratingDiff;
    }
  }
  
  // Se non trova match entro 200 punti, prende il primo disponibile
  if (bestRatingDiff > 200 && duelQueue.length > 0) {
    bestMatch = { player: duelQueue[0], index: 0 };
  }
  
  if (bestMatch) {
    duelQueue.splice(bestMatch.index, 1);
    return bestMatch.player;
  }
  
  return null;
}

// === DREAMLO LEADERBOARDS ===
function submitCoopTeamScore(teamName, score) {
  const dreamloKey = "5z7d7N8IBkSwrhJdyZAXxAYn3Jv1KyTEm6GJZoIALRBw";
  const tag = "coopraid";
  const url = `https://dreamlo.com/lb/${dreamloKey}/add/${encodeURIComponent(teamName)}/${score}/${tag}`;
  fetch(url)
    .then(() => console.log(`[Dreamlo] Co-op score inviato: ${teamName} - ${score}`))
    .catch(err => console.error("[Dreamlo] Errore invio co-op:", err));
}

function submitDuelScore(nickname, rating) {
  const dreamloKey = "5z7d7N8IBkSwrhJdyZAXxAYn3Jv1KyTEm6GJZoIALRBw";
  const tag = "duel1v1";
  const url = `https://dreamlo.com/lb/${dreamloKey}/add/${encodeURIComponent(nickname)}/${rating}/${tag}`;
  fetch(url)
    .then(() => console.log(`[Dreamlo] Duel score inviato: ${nickname} - ${rating}`))
    .catch(err => console.error("[Dreamlo] Errore invio duel:", err));
}

// === COOP OBSTACLES ===
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

// === MAIN GAME LOOP ===
let lastUpdate = Date.now();
setInterval(() => {
  const now = Date.now();
  let delta = (now - lastUpdate) / 1000;
  lastUpdate = now;
  delta = Math.max(0.02, Math.min(delta, 0.07));

  // === COOP MODE ===
  if (Object.keys(players).length > 0) {
    io.emit('otherPlayers', { players: Object.values(players) });
  }

  if (gameInProgress) {
    // Boss movement
    coopBoss.x += coopBoss.dir * BOSS_SPEED * (delta * 60);
    if (coopBoss.x < BOSS_X_MIN) { coopBoss.x = BOSS_X_MIN; coopBoss.dir = 1; }
    if (coopBoss.x > BOSS_X_MAX) { coopBoss.x = BOSS_X_MAX; coopBoss.dir = -1; }
    coopBoss.y += coopBoss.yDir * BOSS_Y_SPEED * (delta * 60);
    if (coopBoss.y < BOSS_Y_MIN) { coopBoss.y = BOSS_Y_MIN; coopBoss.yDir = 1; }
    if (coopBoss.y > BOSS_Y_MAX) { coopBoss.y = BOSS_Y_MAX; coopBoss.yDir = -1; }
    coopBoss.angle += 0.02 * (delta * 60);

    io.emit('bossUpdate', { ...coopBoss });

    // Boss attacks
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

  // === DUEL MODE - Enhanced Update Loop ===
  for (const [roomId, duel] of Object.entries(duelRooms)) {
    if (duel.ended) continue;
    
    updateDuelRoom(roomId);
    
    // Invia stati aggiornati ai giocatori
    [duel.p1, duel.p2].forEach(playerSocket => {
      if (!playerSocket.connected) return;
      
      const opponent = getOpponent(roomId, playerSocket.id);
      if (!opponent) return;
      
      const oppState = duel.states[opponent.id] || {};
      const oppMeta = duel.playerMeta[opponent.id] || {};
      const myState = duel.states[playerSocket.id] || {};
      
      playerSocket.emit('duel_state', {
        myState,
        opponent: { 
          ...oppState, 
          skin: oppMeta.skin, 
          nickname: oppMeta.nickname,
          rating: oppMeta.rating
        },
        powerups: duel.powerups,
        obstacles: duel.obstacles,
        bullets: duel.bullets,
        events: duel.events,
        timeRemaining: Math.max(0, DUEL_CONFIG.ROUND_TIME_LIMIT - (now - duel.startTime)),
        roundInfo: {
          current: duel.roundNumber,
          bestOf: duel.bestOf,
          wins: duel.roundWins
        }
      });
    });
    
    duel.events = []; // Reset eventi dopo l'invio
  }
}, 50);

// === SOCKET.IO CONNECTION HANDLERS ===
io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);
  
  // === COOP MODE HANDLERS ===
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

  // === ENHANCED 1v1 DUEL HANDLERS ===
  socket.on('duel_queue', (data) => {
    console.log(`[DUEL] ${data.nickname} entra in queue`);
    
    // Rimuovi da eventuali code precedenti
    duelQueue = duelQueue.filter(p => p.socket.id !== socket.id);
    
    const newPlayer = { 
      socket, 
      nickname: data.nickname || "Player", 
      skin: data.skin || "navicella2.png",
      queueTime: Date.now()
    };
    
    // Cerca un match
    const opponent = findDuelMatch(newPlayer);
    
    if (opponent) {
      // Match trovato!
      const roomId = createDuelRoom(newPlayer.socket, opponent.socket);
      const duel = duelRooms[roomId];
      
      newPlayer.socket.join(roomId);
      opponent.socket.join(roomId);
      
      const oppData1 = { 
        id: opponent.socket.id, 
        nickname: opponent.nickname, 
        skin: opponent.skin,
        rating: getPlayerRating(opponent.socket.id)
      };
      const oppData2 = { 
        id: newPlayer.socket.id, 
        nickname: newPlayer.nickname, 
        skin: newPlayer.skin,
        rating: getPlayerRating(newPlayer.socket.id)
      };
      
      newPlayer.socket.emit('duel_match_found', { 
        room: roomId, 
        opponent: oppData1,
        arenaConfig: DUEL_CONFIG
      });
      opponent.socket.emit('duel_match_found', { 
        room: roomId, 
        opponent: oppData2,
        arenaConfig: DUEL_CONFIG
      });
      
      console.log(`[DUEL] Match creato: ${newPlayer.nickname} vs ${opponent.nickname}`);
    } else {
      // Aggiungi alla queue
      duelQueue.push(newPlayer);
      socket.emit('duel_queue_joined', { 
        position: duelQueue.length,
        estimatedWait: duelQueue.length * 15 // stima: 15 sec per giocatore
      });
      console.log(`[DUEL] ${newPlayer.nickname} aggiunto alla queue (pos: ${duelQueue.length})`);
    }
  });

  socket.on('duel_cancel', () => {
    duelQueue = duelQueue.filter(p => p.socket.id !== socket.id);
    socket.emit('duel_queue_left');
    console.log(`[DUEL] ${socket.id} ha lasciato la queue`);
  });

  socket.on('duel_update', (data) => {
    const { room, player, action } = data;
    const duel = duelRooms[room];
    if (!duel || duel.ended) return;
    
    // Aggiorna stato del giocatore
    const currentState = duel.states[socket.id] || {};
    duel.states[socket.id] = { 
      ...currentState,
      ...player, 
      id: socket.id,
      lastUpdate: Date.now()
    };
    
    // Aggiorna metadati
    if (player.skin) duel.playerMeta[socket.id].skin = player.skin;
    if (player.nickname) duel.playerMeta[socket.id].nickname = player.nickname;
    
    // Gestisci azioni specifiche
    if (action === "shoot" && player.bulletData) {
      duel.stats[socket.id].shots++;
      
      // Aggiungi bullet al tracking server-side
      const bullet = {
        id: generateUniqueId(),
        x: player.bulletData.x,
        y: player.bulletData.y,
        angle: player.bulletData.angle,
        speed: player.bulletData.speed || 8,
        damage: player.bulletData.damage || 25,
        ownerId: socket.id,
        createdAt: Date.now()
      };
      duel.bullets.push(bullet);
      
      duel.events.push({ 
        type: "shoot", 
        player: socket.id, 
        bullet: bullet,
        timestamp: Date.now()
      });
    }
    
    // Controlla condizioni di vittoria
    checkDuelWinCondition(room);
  });

  socket.on('duel_hit_confirmed', (data) => {
    const { room, bulletId, damage, targetId } = data;
    const duel = duelRooms[room];
    if (!duel || duel.ended) return;
    
    // Verifica che il bullet esista e appartenga al giocatore giusto
    const bullet = duel.bullets.find(b => b.id === bulletId && b.ownerId === socket.id);
    if (!bullet) return;
    
    // Rimuovi bullet
    duel.bullets = duel.bullets.filter(b => b.id !== bulletId);
    
    // Applica danno
    const targetState = duel.states[targetId];
    if (targetState) {
      let actualDamage = damage;
      
      // Considera scudi
      if (targetState.shields > 0) {
        actualDamage *= 0.5; // Scudi riducono danno del 50%
      }
      
      // Considera effetti di damage boost
      if (duel.states[socket.id].effects?.damage) {
        actualDamage *= 1.5;
      }
      
      targetState.health = Math.max(0, targetState.health - actualDamage);
      
      // Aggiorna statistiche
      duel.stats[socket.id].hits++;
      duel.stats[socket.id].damage += actualDamage;
      
      duel.events.push({
        type: "hit",
        attacker: socket.id,
        target: targetId,
        damage: actualDamage,
        timestamp: Date.now()
      });
      
      console.log(`[DUEL] Hit confermato: ${actualDamage} danni da ${socket.id} a ${targetId}`);
    }
  });

  socket.on('duel_powerup_collected', (data) => {
    const { room, powerupId } = data;
    const duel = duelRooms[room];
    if (!duel || duel.ended) return;
    
    const powerupIndex = duel.powerups.findIndex(p => p.id === powerupId);
    if (powerupIndex === -1) return;
    
    const powerup = duel.powerups[powerupIndex];
    duel.powerups.splice(powerupIndex, 1);
    
    // Applica effetto powerup
    const playerState = duel.states[socket.id];
    if (playerState) {
      applyPowerupEffect(playerState, powerup);
      duel.stats[socket.id].powerupsCollected++;
      
      duel.events.push({
        type: "powerup_collected",
        player: socket.id,
        powerupType: powerup.type,
        timestamp: Date.now()
      });
      
      console.log(`[DUEL] Powerup ${powerup.type} raccolto da ${socket.id}`);
    }
  });

  socket.on('duel_obstacle_hit', (data) => {
    const { room, obstacleId } = data;
    const duel = duelRooms[room];
    if (!duel || duel.ended) return;
    
    const obstacle = duel.obstacles.find(o => o.id === obstacleId);
    if (obstacle) {
      obstacle.health--;
      if (obstacle.health <= 0) {
        duel.obstacles = duel.obstacles.filter(o => o.id !== obstacleId);
      }
      
      duel.events.push({
        type: "obstacle_destroyed",
        player: socket.id,
        obstacleId,
        timestamp: Date.now()
      });
    }
  });

  socket.on('get_duel_leaderboard', () => {
    socket.emit('duel_leaderboard', {
      leaderboard: duelLeaderboard.slice(0, 20), // Top 20
      yourRank: duelLeaderboard.findIndex(entry => entry.id === socket.id) + 1,
      totalPlayers: duelLeaderboard.length
    });
  });

  socket.on('get_player_stats', () => {
    const profile = playerProfiles[socket.id];
    socket.emit('player_stats', {
      rating: profile?.rating || 1000,
      wins: profile?.wins || 0,
      losses: profile?.losses || 0,
      winRate: profile ? (profile.wins / (profile.wins + profile.losses) * 100) : 0,
      rank: duelLeaderboard.findIndex(entry => entry.id === socket.id) + 1
    });
  });

  // === ENHANCED SPECTATOR SYSTEM ===
  socket.on('spectate_duel', (data) => {
    const { room } = data;
    const duel = duelRooms[room];
    if (!duel || duel.ended) return;
    
    if (!duel.spectators.includes(socket.id)) {
      duel.spectators.push(socket.id);
      socket.join(`${room}_spectators`);
      
      // Invia stato iniziale allo spettatore
      socket.emit('spectate_start', {
        room,
        players: {
          p1: { ...duel.states[duel.p1.id], ...duel.playerMeta[duel.p1.id] },
          p2: { ...duel.states[duel.p2.id], ...duel.playerMeta[duel.p2.id] }
        },
        powerups: duel.powerups,
        obstacles: duel.obstacles,
        roundInfo: {
          current: duel.roundNumber,
          bestOf: duel.bestOf,
          wins: duel.roundWins
        }
      });
      
      console.log(`[SPECTATE] ${socket.id} sta spettando il duello ${room}`);
    }
  });

  socket.on('stop_spectating', (data) => {
    const { room } = data;
    const duel = duelRooms[room];
    if (duel) {
      duel.spectators = duel.spectators.filter(id => id !== socket.id);
      socket.leave(`${room}_spectators`);
    }
  });

  // === CHAT SYSTEM AVANZATO ===
  socket.on('duel_chat', (data) => {
    const { room, message } = data;
    const duel = duelRooms[room];
    if (!duel || typeof message !== "string" || message.length > 100) return;
    
    const nickname = duel.playerMeta[socket.id]?.nickname || "Player";
    
    // Invia a entrambi i giocatori e spettatori
    io.to(duel.p1.id).emit('duel_chat_message', { nickname, message, timestamp: Date.now() });
    io.to(duel.p2.id).emit('duel_chat_message', { nickname, message, timestamp: Date.now() });
    io.to(`${room}_spectators`).emit('duel_chat_message', { nickname, message, timestamp: Date.now() });
  });

  // === TOURNAMENT SYSTEM (base) ===
  socket.on('create_tournament', (data) => {
    // TODO: Sistema di tornei - implementazione futura
    socket.emit('tournament_created', { message: "Sistema tornei in sviluppo!" });
  });

  // === DISCONNECTION HANDLER ===
  socket.on('disconnect', () => {
    console.log(`[DISCONNECT] ${socket.id}`);
    
    // COOP cleanup
    delete players[socket.id];
    delete playerVoiceStatus[socket.id];
    if (hostId === socket.id) {
      const ids = Object.keys(players);
      hostId = ids.length > 0 ? ids[0] : null;
      if (!hostId) gameInProgress = false;
    }
    inviaLobbyAggiornata();
    io.emit('voiceActive', { id: socket.id, active: false });

    // DUEL cleanup
    duelQueue = duelQueue.filter(p => p.socket.id !== socket.id);

    // Gestisci disconnessione durante duello
    for (const [roomId, duel] of Object.entries(duelRooms)) {
      if (duel.ended) continue;
      
      if (duel.p1.id === socket.id || duel.p2.id === socket.id) {
        duel.ended = true;
        const winner = (duel.p1.id === socket.id) ? duel.p2.id : duel.p1.id;
        const disconnectedId = socket.id;
        
        // Aggiorna rating (penalità per disconnect)
        if (!duel.winner) { // Solo se non era già finito
          updatePlayerRating(winner, disconnectedId);
          
          // Penalità extra per ragequit
          if (playerProfiles[disconnectedId]) {
            playerProfiles[disconnectedId].rating = Math.max(100, playerProfiles[disconnectedId].rating - 25);
          }
        }
        
        // Notifica avversario
        const opponent = winner === duel.p1.id ? duel.p1 : duel.p2;
        if (opponent && opponent.connected) {
          opponent.emit('duel_opponent_disconnected', {
            winner,
            reason: 'disconnect',
            stats: duel.stats,
            newRating: playerProfiles[winner]?.rating || 1000
          });
        }
        
        // Notifica spettatori
        io.to(`${roomId}_spectators`).emit('duel_ended_disconnect', {
          winner,
          disconnectedPlayer: duel.playerMeta[disconnectedId]?.nickname || "Player"
        });
        
        updateLeaderboard(duel);
        setTimeout(() => delete duelRooms[roomId], 3000);
      }
      
      // Rimuovi da spettatori
      duel.spectators = duel.spectators.filter(id => id !== socket.id);
    }
  });

  // === WebRTC Signaling (Voice Chat) ===
  socket.on('webrtc-offer', (data) =>
    socket.to(data.targetId).emit('webrtc-offer', { fromId: socket.id, sdp: data.sdp }));
  socket.on('webrtc-answer', (data) =>
    socket.to(data.targetId).emit('webrtc-answer', { fromId: socket.id, sdp: data.sdp }));
  socket.on('webrtc-ice', (data) =>
    socket.to(data.targetId).emit('webrtc-ice', { fromId: socket.id, candidate: data.candidate }));

  function inviaLobbyAggiornata() {
    io.emit('lobbyUpdate', { 
      players: Object.values(players),
      host: hostId,
      gameInProgress
    });
  }
});

// === HELPER FUNCTIONS ===
function getOpponent(room, playerId) {
  const duel = duelRooms[room];
  if (!duel) return null;
  return (duel.p1.id === playerId) ? duel.p2 : duel.p1;
}

function checkDuelWinCondition(room) {
  const duel = duelRooms[room];
  if (!duel || duel.ended) return;
  
  const p1State = duel.states[duel.p1.id];
  const p2State = duel.states[duel.p2.id];
  
  if (!p1State || !p2State) return;
  
  const p1Dead = p1State.health <= 0;
  const p2Dead = p2State.health <= 0;
  
  if (p1Dead || p2Dead) {
    let roundWinner = null;
    
    if (p1Dead && p2Dead) {
      // Pareggio - vince chi ha più vita
      roundWinner = p1State.health >= p2State.health ? duel.p1.id : duel.p2.id;
    } else if (p1Dead) {
      roundWinner = duel.p2.id;
    } else if (p2Dead) {
      roundWinner = duel.p1.id;
    }
    
    if (roundWinner) {
      duel.roundWins[roundWinner]++;
      
      // Controlla se qualcuno ha vinto la serie best-of-3
      const maxWins = Math.ceil(duel.bestOf / 2);
      if (duel.roundWins[roundWinner] >= maxWins) {
        // Serie vinta!
        endDuel(room, roundWinner, 'victory');
      } else {
        // Continua con il prossimo round
        startNextRound(room);
      }
    }
  }
}

function startNextRound(room) {
  const duel = duelRooms[room];
  if (!duel) return;
  
  duel.roundNumber++;
  
  // Reset posizioni e vita
  duel.states[duel.p1.id] = {
    x: 150, y: 300, angle: 0, health: 100, maxHealth: 100,
    energy: 100, maxEnergy: 100, shields: 0, effects: {}
  };
  duel.states[duel.p2.id] = {
    x: 650, y: 300, angle: Math.PI, health: 100, maxHealth: 100,
    energy: 100, maxEnergy: 100, shields: 0, effects: {}
  };
  
  // Pulisci arena
  duel.powerups = [];
  duel.obstacles = [];
  duel.bullets = [];
  duel.events = [];
  
  // Notifica nuovo round
  io.to(duel.p1.id).emit('duel_new_round', {
    roundNumber: duel.roundNumber,
    roundWins: duel.roundWins,
    countdown: 3
  });
  io.to(duel.p2.id).emit('duel_new_round', {
    roundNumber: duel.roundNumber,
    roundWins: duel.roundWins,
    countdown: 3
  });
  
  // Notifica spettatori
  io.to(`${room}_spectators`).emit('duel_new_round', {
    roundNumber: duel.roundNumber,
    roundWins: duel.roundWins,
    players: {
      p1: duel.playerMeta[duel.p1.id],
      p2: duel.playerMeta[duel.p2.id]
    }
  });
}

function endDuel(room, winner, reason) {
  const duel = duelRooms[room];
  if (!duel || duel.ended) return;
  
  duel.ended = true;
  duel.winner = winner;
  
  // Aggiorna rating solo se non è un pareggio
  if (winner !== "draw") {
    const loserId = winner === duel.p1.id ? duel.p2.id : duel.p1.id;
    updatePlayerRating(winner, loserId);
    
    // Invia score a Dreamlo
    const winnerNickname = duel.playerMeta[winner]?.nickname || "Winner";
    const newRating = playerProfiles[winner]?.rating || 1000;
    submitDuelScore(winnerNickname, newRating);
  }
  
  const endData = {
    winner,
    reason,
    stats: duel.stats,
    finalRoundWins: duel.roundWins,
    duration: Date.now() - duel.startTime,
    newRatings: {
      [duel.p1.id]: playerProfiles[duel.p1.id]?.rating || 1000,
      [duel.p2.id]: playerProfiles[duel.p2.id]?.rating || 1000
    }
  };
  
  // Notifica giocatori
  io.to(duel.p1.id).emit('duel_end', endData);
  io.to(duel.p2.id).emit('duel_end', endData);
  
  // Notifica spettatori
  io.to(`${room}_spectators`).emit('duel_ended', {
    ...endData,
    players: {
      p1: duel.playerMeta[duel.p1.id],
      p2: duel.playerMeta[duel.p2.id]
    }
  });
  
  updateLeaderboard(duel);
  
  console.log(`[DUEL] Duello terminato: ${duel.playerMeta[winner]?.nickname || winner} vince vs ${reason}`);
  
  // Cleanup dopo 5 secondi
  setTimeout(() => {
    if (duelRooms[room]) {
      // Rimuovi spettatori
      io.to(`${room}_spectators`).emit('spectate_ended');
      delete duelRooms[room];
    }
  }, 5000);
}

function applyPowerupEffect(playerState, powerup) {
  const effect = powerup.effect;
  
  switch (powerup.type) {
    case 'health':
      playerState.health = Math.min(playerState.maxHealth, playerState.health + effect.health);
      break;
    case 'energy':
      playerState.energy = Math.min(playerState.maxEnergy, playerState.energy + effect.energy);
      break;
    case 'shield':
      playerState.shields = effect.shield;
      break;
    case 'damage':
      playerState.effects.damage = effect.duration;
      break;
    case 'speed':
      playerState.effects.speed = effect.duration;
      break;
    case 'rapid':
      playerState.effects.rapidFire = effect.duration;
      break;
  }
}

// === ADMIN COMMANDS ===
function handleAdminCommand(socket, command, args) {
  // TODO: Sistema di amministrazione per moderare duelli
  console.log(`[ADMIN] ${socket.id}: ${command} ${args.join(' ')}`);
}

// === STATUS E MONITORING ===
setInterval(() => {
  const stats = {
    timestamp: Date.now(),
    coop: {
      players: Object.keys(players).length,
      gameInProgress,
      bossHealth: coopBoss.health
    },
    duel: {
      queueLength: duelQueue.length,
      activeRooms: Object.keys(duelRooms).length,
      totalSpectators: Object.values(duelRooms).reduce((sum, room) => sum + room.spectators.length, 0)
    },
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }
  };
  
  // Log stats ogni 30 secondi
  console.log(`[STATS] Coop: ${stats.coop.players} players | Duel: ${stats.duel.queueLength} in queue, ${stats.duel.activeRooms} active duels`);
}, 30000);

// === CLEANUP ROUTINE ===
setInterval(() => {
  const now = Date.now();
  
  // Pulisci stanze di duello abbandonate (oltre 10 minuti)
  Object.keys(duelRooms).forEach(roomId => {
    const duel = duelRooms[roomId];
    if (duel.ended && now - duel.lastUpdate > 600000) {
      delete duelRooms[roomId];
      console.log(`[CLEANUP] Rimossa stanza di duello abbandonata: ${roomId}`);
    }
  });
  
  // Pulisci queue di giocatori disconnessi
  duelQueue = duelQueue.filter(player => player.socket.connected);
  
  // Mantieni solo ultimi 1000 profili più attivi
  const profileEntries = Object.entries(playerProfiles);
  if (profileEntries.length > 1000) {
    const sortedProfiles = profileEntries.sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0));
    playerProfiles = Object.fromEntries(sortedProfiles.slice(0, 1000));
  }
}, 300000); // Ogni 5 minuti

// === ERROR HANDLING ===
process.on('uncaughtException', (error) => {
  console.error('[ERROR] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
});

// === GRACEFUL SHUTDOWN ===
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM ricevuto, chiusura graceful...');
  
  // Notifica tutti i giocatori della chiusura server
  io.emit('server_shutdown', { message: 'Server in manutenzione, riconnettiti tra qualche minuto.' });
  
  // Chiudi tutte le connessioni
  setTimeout(() => {
    server.close(() => {
      console.log('[SHUTDOWN] Server chiuso correttamente.');
      process.exit(0);
    });
  }, 2000);
});

// === START SERVER ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[START] Stellar Guardian Server avviato su porta ${PORT}`);
  console.log(`[INFO] Modalità: COOP + Enhanced 1v1 Duel`);
  console.log(`[INFO] Features: Rating System, Spectator Mode, Advanced Powerups, Tournament Ready`);
});
