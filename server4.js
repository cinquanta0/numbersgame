// ============= SERVER CLICK REACTION MULTIPLAYER =============
// Salva questo file come: server_reaction.js
// Avvia con: node server_reaction.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
  cors: { 
    origin: "*",
    methods: ["GET", "POST"]
  } 
});


// ===== CONFIGURA EXPRESS PER SERVIRE FILE STATICI =====
// Serve tutti i file dalla directory corrente (dove sono i tuoi HTML, CSS, JS)
app.use(express.static(__dirname));

// Route per la pagina principale - serve index.html o il tuo file HTML principale
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html')); // Cambia 'index.html' con il nome del tuo file HTML principale
});



// ===== STRUTTURA DATI =====
let gameRooms = {};
// Esempio struttura room:
// {
//   "room123": {
//     players: [{id, nickname, score, ready}],
//     gameActive: false,
//     currentRound: 0,
//     maxRounds: 10,
//     targetPosition: {x, y},
//     roundWinner: null,
//     clickTimes: {},
//     gameMode: 'reaction'
//   }
// }

// ===== HELPER FUNCTIONS =====
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRoom(roomCode) {
  return gameRooms[roomCode];
}

function removePlayerFromAllRooms(socketId) {
  Object.keys(gameRooms).forEach(roomCode => {
    const room = gameRooms[roomCode];
    room.players = room.players.filter(p => p.id !== socketId);
    
    // Se la room è vuota, eliminala
    if (room.players.length === 0) {
      delete gameRooms[roomCode];
      console.log(`[Room ${roomCode}] Eliminata (vuota)`);
    } else {
      // Notifica gli altri giocatori
      io.to(roomCode).emit('reaction_player_left', { 
        playerId: socketId,
        playersCount: room.players.length 
      });
    }
  });
}

// ===== SOCKET CONNECTION =====
io.on('connection', (socket) => {
  console.log(`[Connect] Nuovo giocatore: ${socket.id}`);

  // === 1. CREA ROOM ===
  socket.on('reaction_create_room', ({ nickname }) => {
    const roomCode = generateRoomCode();
    
    // Crea la room
    gameRooms[roomCode] = {
      players: [{
        id: socket.id,
        nickname: nickname || 'Player',
        score: 0,
        ready: false,
        reactionTime: null
      }],
      gameActive: false,
      currentRound: 0,
      maxRounds: 10,
      targetPosition: null,
      roundWinner: null,
      clickTimes: {},
      gameMode: 'reaction',
      createdAt: Date.now()
    };
    
    socket.join(roomCode);
    
    console.log(`[Room ${roomCode}] Creata da ${nickname}`);
    
    socket.emit('reaction_room_created', {
      roomCode,
      players: gameRooms[roomCode].players
    });
  });

  // === 2. ENTRA IN ROOM ===
  socket.on('reaction_join_room', ({ roomCode, nickname }) => {
    const room = getRoom(roomCode);
    
    if (!room) {
      socket.emit('reaction_error', { message: 'Room non trovata!' });
      return;
    }
    
    if (room.players.length >= 4) {
      socket.emit('reaction_error', { message: 'Room piena (max 4 giocatori)!' });
      return;
    }
    
    if (room.gameActive) {
      socket.emit('reaction_error', { message: 'Partita già in corso!' });
      return;
    }
    
    // Aggiungi il giocatore
    const player = {
      id: socket.id,
      nickname: nickname || 'Player',
      score: 0,
      ready: false,
      reactionTime: null
    };
    
    room.players.push(player);
    socket.join(roomCode);
    
    console.log(`[Room ${roomCode}] ${nickname} è entrato (${room.players.length}/4)`);
    
    // Conferma al giocatore che si è unito con successo
    socket.emit('reaction_room_joined', { 
      roomCode: roomCode, 
      players: room.players 
    });
    
    // Notifica tutti gli altri nella room
    socket.to(roomCode).emit('reaction_player_joined', {
      player,
      players: room.players
    });
  });

  // === 3. PLAYER READY ===
  socket.on('reaction_player_ready', ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    
    player.ready = !player.ready;
    
    // Notifica tutti
    io.to(roomCode).emit('reaction_ready_update', {
      players: room.players
    });
    
    // Se tutti sono pronti e sono almeno 2, inizia!
    const allReady = room.players.every(p => p.ready);
    if (allReady && room.players.length >= 2) {
      startGame(roomCode);
    }
  });

  // === 4. START GAME ===
  function startGame(roomCode) {
    const room = getRoom(roomCode);
    if (!room) return;
    
    room.gameActive = true;
    room.currentRound = 0;
    room.players.forEach(p => {
      p.score = 0;
      p.reactionTime = null;
    });
    
    console.log(`[Room ${roomCode}] GAME START!`);
    
    io.to(roomCode).emit('reaction_game_start', {
      message: 'La partita inizia!',
      maxRounds: room.maxRounds
    });
    
    // Inizia il primo round dopo 2 secondi
    setTimeout(() => startRound(roomCode), 2000);
  }

  // === 5. START ROUND ===
  function startRound(roomCode) {
    const room = getRoom(roomCode);
    if (!room || !room.gameActive) return;
    
    room.currentRound++;
    room.clickTimes = {};
    room.roundWinner = null;
    
    if (room.currentRound > room.maxRounds) {
      endGame(roomCode);
      return;
    }
    
    // Genera posizione casuale per il target
    room.targetPosition = {
      x: Math.floor(Math.random() * 80 + 10), // 10-90% dello schermo
      y: Math.floor(Math.random() * 60 + 20), // 20-80% dello schermo
      appearTime: Date.now() + (1500 + Math.random() * 3000) // Appare tra 1.5-4.5 secondi
    };
    
    console.log(`[Room ${roomCode}] Round ${room.currentRound}/${room.maxRounds}`);
    
    // Notifica inizio round
    io.to(roomCode).emit('reaction_round_prepare', {
      round: room.currentRound,
      maxRounds: room.maxRounds,
      message: `Round ${room.currentRound} - Preparati!`
    });
    
    // Mostra il target dopo il delay
    const delay = room.targetPosition.appearTime - Date.now();
    setTimeout(() => {
      if (!room.gameActive) return;
      
      room.targetPosition.startTime = Date.now();
      
      io.to(roomCode).emit('reaction_show_target', {
        x: room.targetPosition.x,
        y: room.targetPosition.y,
        round: room.currentRound
      });
    }, delay);
  }

  // === 6. PLAYER CLICK ===
  socket.on('reaction_click', ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room || !room.gameActive || !room.targetPosition) return;
    
    // Se questo giocatore ha già cliccato in questo round, ignora
    if (room.clickTimes[socket.id]) return;
    
    const reactionTime = Date.now() - room.targetPosition.startTime;
    room.clickTimes[socket.id] = reactionTime;
    
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    
    player.reactionTime = reactionTime;
    
    console.log(`[Room ${roomCode}] ${player.nickname} ha cliccato in ${reactionTime}ms`);
    
    // Se è il primo a cliccare, vince il round
    if (!room.roundWinner) {
      room.roundWinner = socket.id;
      player.score++;
      
      // Notifica vittoria round
      io.to(roomCode).emit('reaction_round_winner', {
        winner: {
          id: socket.id,
          nickname: player.nickname,
          time: reactionTime
        },
        scores: room.players.map(p => ({
          id: p.id,
          nickname: p.nickname,
          score: p.score,
          lastTime: p.reactionTime
        }))
      });
      
      // Prossimo round dopo 2 secondi
      setTimeout(() => startRound(roomCode), 2000);
    }
  });

  // === 7. END GAME ===
  function endGame(roomCode) {
    const room = getRoom(roomCode);
    if (!room) return;
    
    room.gameActive = false;
    
    // Calcola il vincitore
    const sortedPlayers = room.players.sort((a, b) => b.score - a.score);
    const winner = sortedPlayers[0];
    
    console.log(`[Room ${roomCode}] GAME OVER! Vincitore: ${winner.nickname}`);
    
    // Calcola statistiche
    const stats = room.players.map(p => ({
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      avgTime: p.reactionTime ? Math.round(p.reactionTime) : null,
      rank: sortedPlayers.indexOf(p) + 1
    }));
    
    io.to(roomCode).emit('reaction_game_over', {
      winner: {
        id: winner.id,
        nickname: winner.nickname,
        score: winner.score
      },
      stats,
      message: `🏆 ${winner.nickname} ha vinto con ${winner.score} punti!`
    });
    
    // Reset ready status per rematch
    room.players.forEach(p => p.ready = false);
  }

  // === 8. REMATCH ===
  socket.on('reaction_rematch', ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    
    player.ready = true;
    
    io.to(roomCode).emit('reaction_ready_update', {
      players: room.players
    });
    
    const allReady = room.players.every(p => p.ready);
    if (allReady) {
      startGame(roomCode);
    }
  });

  // === 9. LEAVE ROOM ===
  socket.on('reaction_leave_room', () => {
    removePlayerFromAllRooms(socket.id);
  });

  // === 10. DISCONNECT ===
  socket.on('disconnect', () => {
    console.log(`[Disconnect] Giocatore disconnesso: ${socket.id}`);
    removePlayerFromAllRooms(socket.id);
  });

  // === 11. CHAT (BONUS) ===
  socket.on('reaction_chat', ({ roomCode, message, nickname }) => {
    io.to(roomCode).emit('reaction_chat_message', {
      nickname,
      message,
      timestamp: Date.now()
    });
  });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3200;
server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   CLICK REACTION MULTIPLAYER SERVER   ║
  ╠═══════════════════════════════════════╣
  ║   Server running on port ${PORT}         ║
  ║   http://localhost:${PORT}                ║
  ╚═══════════════════════════════════════╝
  `);
});

// === PULIZIA ROOMS VECCHIE (ogni 10 minuti) ===
setInterval(() => {
  const now = Date.now();
  Object.keys(gameRooms).forEach(roomCode => {
    const room = gameRooms[roomCode];
    // Elimina rooms vuote o inattive da più di 30 minuti
    if (room.players.length === 0 || (now - room.createdAt > 30 * 60 * 1000)) {
      delete gameRooms[roomCode];
      console.log(`[Cleanup] Room ${roomCode} eliminata`);
    }
  });

}, 10 * 60 * 1000);

