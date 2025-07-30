// --- Stellar Guardian Multiplayer Server ---
// Compatibile con Render, Heroku, Vercel

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path'); // ⬅️ necessario per servire file statici dalla root

const app = express();
const server = http.createServer(app);

// ✅ Serve file statici dalla root del progetto
app.use(express.static(__dirname));

// ✅ Quando accedi a '/', mostra index.html dalla root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Inizializza Socket.io (CORS: accetta tutti per semplicità)
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

// --- Loop movimento boss + sync giocatori ogni 40ms ---
setInterval(() => {
  if (gameInProgress) {
    coopBoss.x += coopBoss.dir * BOSS_SPEED;
    if (coopBoss.x < BOSS_X_MIN) { coopBoss.x = BOSS_X_MIN; coopBoss.dir = 1; }
    if (coopBoss.x > BOSS_X_MAX) { coopBoss.x = BOSS_X_MAX; coopBoss.dir = -1; }

    coopBoss.y += coopBoss.yDir * BOSS_Y_SPEED;
    if (coopBoss.y < BOSS_Y_MIN) { coopBoss.y = BOSS_Y_MIN; coopBoss.yDir = 1; }
    if (coopBoss.y > BOSS_Y_MAX) { coopBoss.y = BOSS_Y_MAX; coopBoss.yDir = -1; }

    coopBoss.angle += 0.02;

    io.emit('bossUpdate', { ...coopBoss });
    io.emit('otherPlayers', { players: Object.values(players) });
  }
}, 40);

// --- Gestione socket.io ---
io.on('connection', (socket) => {
  console.log('Nuovo player:', socket.id);

  socket.on('joinLobby', (data) => {
    players[socket.id] = {
      id: socket.id,
      x: 200 + Math.random() * 400,
      y: 400 + Math.random() * 120,
      nickname: data.nickname || 'Player',
      angle: 0
    };
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
    io.emit('gameStart', {
      boss: { ...coopBoss },
      players: Object.values(players)
    });
  });

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

  socket.on('disconnect', () => {
    delete players[socket.id];
    if (hostId === socket.id) {
      const ids = Object.keys(players);
      hostId = ids.length > 0 ? ids[0] : null;
      if (!hostId) gameInProgress = false;
    }
    inviaLobbyAggiornata();
  });

  function inviaLobbyAggiornata() {
    io.emit('lobbyUpdate', { players: Object.values(players) });
  }
});

// --- Porta dinamica per Render/Heroku ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server listening on :' + PORT);
});
