const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);

// Configurazione Socket.io per Render
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint per Render
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API stats endpoint
app.get('/api/stats', (req, res) => {
  res.json({
    rooms: rooms.size,
    players: players.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Game state
const rooms = new Map();
const players = new Map();

// Utility functions
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getDifficultySettings(difficulty) {
  const settings = {
    easy: { base: 30, attempts: 10 },
    medium: { base: 60, attempts: 8 },
    hard: { base: 150, attempts: 7 },
    hardcore: { base: 300, attempts: 5 }
  };
  return settings[difficulty] || settings.easy;
}

function calculatePoints(attempts, maxAttempts) {
  return Math.max(100 - (attempts - 1) * 10, 10);
}

function getGuessResult(guess, target) {
  if (guess === target) {
    return 'correct';
  } else if (Math.abs(guess - target) <= 5) {
    return 'very_close';
  } else if (Math.abs(guess - target) <= 15) {
    return 'close';
  } else {
    return 'far';
  }
}

function getGuessMessage(guess, target, result) {
  switch (result) {
    case 'correct':
      return '🎯 BERSAGLIO COLPITO! Perfetto!';
    case 'very_close':
      return guess < target ? '🔥 MOLTO VICINO! Prova più in alto' : '🔥 MOLTO VICINO! Prova più in basso';
    case 'close':
      return guess < target ? '🎯 VICINO! Prova più in alto' : '🎯 VICINO! Prova più in basso';
    case 'far':
      return guess < target ? '❄️ FREDDO! Molto più in alto' : '❄️ FREDDO! Molto più in basso';
    default:
      return 'Tentativo registrato';
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`🚀 Giocatore connesso: ${socket.id}`);

  // Create room
  socket.on('createRoom', (data) => {
    try {
      const { playerName, difficulty } = data;

      if (!playerName || !difficulty) {
        socket.emit('error', { message: 'Nome giocatore e difficoltà richiesti' });
        return;
      }

      const roomCode = generateRoomCode();
      const room = {
        code: roomCode,
        host: socket.id,
        difficulty: difficulty,
        players: {},
        gameState: {
          started: false,
          currentLevel: 1,
          maxLevel: 10,
          targetNumber: null,
          gameHistory: [],
          levelCompleted: false
        },
        createdAt: new Date()
      };

      // Add player to room
      room.players[socket.id] = {
        id: socket.id,
        name: playerName,
        score: 0,
        attempts: 0,
        isHost: true,
        joinedAt: new Date()
      };

      rooms.set(roomCode, room);
      players.set(socket.id, { roomCode, playerName });

      socket.join(roomCode);

      socket.emit('roomCreated', {
        roomCode: roomCode,
        players: room.players,
        difficulty: difficulty
      });

      console.log(`🏠 Stanza creata: ${roomCode} da ${playerName}`);
    } catch (error) {
      console.error('Errore creazione stanza:', error);
      socket.emit('error', { message: 'Errore nella creazione della stanza' });
    }
  });

  // Join room
  socket.on('joinRoom', (data) => {
    try {
      const { playerName, roomCode } = data;

      if (!playerName || !roomCode) {
        socket.emit('error', { message: 'Nome giocatore e codice stanza richiesti' });
        return;
      }

      const room = rooms.get(roomCode.toUpperCase());

      if (!room) {
        socket.emit('error', { message: 'Stanza non trovata' });
        return;
      }

      if (Object.keys(room.players).length >= 8) {
        socket.emit('error', { message: 'Stanza piena (massimo 8 giocatori)' });
        return;
      }

      // Add player to room
      room.players[socket.id] = {
        id: socket.id,
        name: playerName,
        score: 0,
        attempts: 0,
        isHost: false,
        joinedAt: new Date()
      };

      players.set(socket.id, { roomCode: roomCode.toUpperCase(), playerName });

      socket.join(roomCode.toUpperCase());

      // Notify all players
      io.to(roomCode.toUpperCase()).emit('playerJoined', {
        playerName: playerName,
        players: room.players
      });

      socket.emit('roomJoined', {
        roomCode: roomCode.toUpperCase(),
        players: room.players,
        difficulty: room.difficulty,
        isHost: false
      });

      console.log(`🚪 ${playerName} è entrato nella stanza ${roomCode.toUpperCase()}`);
    } catch (error) {
      console.error('Errore join stanza:', error);
      socket.emit('error', { message: 'Errore nell\'entrare nella stanza' });
    }
  });

  // Join random room
  socket.on('joinRandomRoom', (data) => {
    try {
      const { playerName } = data;

      if (!playerName) {
        socket.emit('error', { message: 'Nome giocatore richiesto' });
        return;
      }

      // Find available room
      let availableRoom = null;
      for (const [code, room] of rooms.entries()) {
        if (Object.keys(room.players).length < 8 && !room.gameState.started) {
          availableRoom = { code, room };
          break;
        }
      }

      if (!availableRoom) {
        socket.emit('error', { message: 'Nessuna stanza disponibile' });
        return;
      }

      // Join the room
      socket.emit('joinRoom', { playerName, roomCode: availableRoom.code });
    } catch (error) {
      console.error('Errore join random:', error);
      socket.emit('error', { message: 'Errore nel trovare una stanza casuale' });
    }
  });

  // Get public rooms
  socket.on('getPublicRooms', () => {
    try {
      const publicRooms = [];
      for (const [code, room] of rooms.entries()) {
        if (Object.keys(room.players).length < 8 && !room.gameState.started) {
          publicRooms.push({
            code: code,
            playerCount: Object.keys(room.players).length,
            difficulty: room.difficulty,
            createdAt: room.createdAt
          });
        }
      }

      socket.emit('publicRooms', { rooms: publicRooms });
    } catch (error) {
      console.error('Errore get public rooms:', error);
      socket.emit('error', { message: 'Errore nel recuperare le stanze pubbliche' });
    }
  });

  // Start game
  socket.on('startGame', (data) => {
    try {
      const { roomCode } = data;
      const room = rooms.get(roomCode);

      if (!room) {
        socket.emit('error', { message: 'Stanza non trovata' });
        return;
      }

      if (room.host !== socket.id) {
        socket.emit('error', { message: 'Solo il host può iniziare il gioco' });
        return;
      }

      if (room.gameState.started) {
        socket.emit('error', { message: 'Il gioco è già iniziato' });
        return;
      }

      // Initialize game
      const settings = getDifficultySettings(room.difficulty);
      const maxRange = settings.base * room.gameState.currentLevel;

      room.gameState.started = true;
      room.gameState.targetNumber = Math.floor(Math.random() * maxRange) + 1;
      room.gameState.range = { min: 1, max: maxRange };
      room.gameState.maxAttempts = settings.attempts;
      room.gameState.gameHistory = [];
      room.gameState.levelCompleted = false;

      // Reset player attempts for this level
      Object.keys(room.players).forEach((playerId) => {
        room.players[playerId].attempts = 0;
      });

      io.to(roomCode).emit('gameStarted', {
        level: room.gameState.currentLevel,
        targetNumber: room.gameState.targetNumber,
        range: room.gameState.range,
        maxAttempts: room.gameState.maxAttempts
      });

      console.log(`🚀 Gioco iniziato nella stanza ${roomCode}, livello ${room.gameState.currentLevel}`);
    } catch (error) {
      console.error('Errore start game:', error);
      socket.emit('error', { message: 'Errore nell\'iniziare il gioco' });
    }
  });

  // Make guess
  socket.on('makeGuess', (data) => {
    try {
      const { roomCode, guess } = data;
      const room = rooms.get(roomCode);

      if (!room || !room.gameState.started || room.gameState.levelCompleted) {
        socket.emit('error', { message: 'Gioco non valido o completato' });
        return;
      }

      const player = room.players[socket.id];
      if (!player) {
        socket.emit('error', { message: 'Giocatore non trovato' });
        return;
      }

      if (player.attempts >= room.gameState.maxAttempts) {
        socket.emit('error', { message: 'Hai esaurito i tentativi per questo livello' });
        return;
      }

      player.attempts++;

      const result = getGuessResult(guess, room.gameState.targetNumber);
      const message = getGuessMessage(guess, room.gameState.targetNumber, result);

      let points = 0;
      if (result === 'correct') {
        points = calculatePoints(player.attempts, room.gameState.maxAttempts);
        player.score += points;
        room.gameState.levelCompleted = true;
      }

      // Add to history
      room.gameState.gameHistory.unshift({
        playerId: socket.id,
        playerName: player.name,
        guess: guess,
        result: result,
        message: message.replace(/[🎯🔥❄️]/gu, '').trim(),
        attempts: player.attempts,
        timestamp: new Date()
      });

      // Get player scores
      const playerScores = {};
      Object.keys(room.players).forEach((playerId) => {
        playerScores[playerId] = room.players[playerId].score;
      });

      // Send result to all players
      io.to(roomCode).emit('guessResult', {
        playerId: socket.id,
        playerName: player.name,
        guess: guess,
        result: result,
        message: message,
        points: points,
        gameHistory: room.gameState.gameHistory.slice(0, 20),
        playerScores: playerScores
      });

      // Check if level completed
      if (result === 'correct') {
        setTimeout(() => {
          const finalScores = {};
          Object.keys(room.players).forEach((playerId) => {
            finalScores[playerId] = room.players[playerId].score;
          });

          io.to(roomCode).emit('levelCompleted', {
            winner: {
              id: socket.id,
              name: player.name,
              attempts: player.attempts,
              score: player.score
            },
            targetNumber: room.gameState.targetNumber,
            level: room.gameState.currentLevel,
            finalScores: finalScores
          });

          // Check if game completed
          if (room.gameState.currentLevel >= room.gameState.maxLevel) {
            setTimeout(() => {
              const finalLeaderboard = Object.values(room.players).sort((a, b) => b.score - a.score);

              io.to(roomCode).emit('gameCompleted', {
                finalLeaderboard: finalLeaderboard,
                gameStats: {
                  levelsCompleted: room.gameState.currentLevel,
                  totalAttempts: Object.values(room.players).reduce((sum, p) => sum + p.attempts, 0),
                  gameTime: Math.floor((new Date() - room.createdAt) / 1000 / 60) + ' minuti'
                }
              });
            }, 3000);
          }
        }, 1500);
      }

      console.log(`🎯 ${player.name} ha indovinato ${guess} (target: ${room.gameState.targetNumber}) - ${result}`);
    } catch (error) {
      console.error('Errore make guess:', error);
      socket.emit('error', { message: 'Errore nel processare il tentativo' });
    }
  });

  // Next level
  socket.on('nextLevel', (data) => {
    try {
      const { roomCode } = data;
      const room = rooms.get(roomCode);

      if (!room) {
        socket.emit('error', { message: 'Stanza non trovata' });
        return;
      }

      if (room.host !== socket.id) {
        socket.emit('error', { message: 'Solo il host può avanzare al livello successivo' });
        return;
      }

      if (!room.gameState.levelCompleted) {
        socket.emit('error', { message: 'Completa il livello corrente prima di avanzare' });
        return;
      }

      if (room.gameState.currentLevel >= room.gameState.maxLevel) {
        socket.emit('error', { message: 'Hai già completato tutti i livelli' });
        return;
      }

      // Advance to next level
      room.gameState.currentLevel++;
      const settings = getDifficultySettings(room.difficulty);
      const maxRange = settings.base * room.gameState.currentLevel;

      room.gameState.targetNumber = Math.floor(Math.random() * maxRange) + 1;
      room.gameState.range = { min: 1, max: maxRange };
      room.gameState.gameHistory = [];
      room.gameState.levelCompleted = false;

      // Reset player attempts for this level
      Object.keys(room.players).forEach((playerId) => {
        room.players[playerId].attempts = 0;
      });

      io.to(roomCode).emit('gameStarted', {
        level: room.gameState.currentLevel,
        targetNumber: room.gameState.targetNumber,
        range: room.gameState.range,
        maxAttempts: room.gameState.maxAttempts
      });

      console.log(`➡️ Livello ${room.gameState.currentLevel} iniziato nella stanza ${roomCode}`);
    } catch (error) {
      console.error('Errore next level:', error);
      socket.emit('error', { message: 'Errore nell\'avanzare al livello successivo' });
    }
  });

  // New game
  socket.on('newGame', (data) => {
    try {
      const { roomCode } = data;
      const room = rooms.get(roomCode);

      if (!room) {
        socket.emit('error', { message: 'Stanza non trovata' });
        return;
      }

      if (room.host !== socket.id) {
        socket.emit('error', { message: 'Solo il host può iniziare una nuova partita' });
        return;
      }

      // Reset game state
      room.gameState.currentLevel = 1;
      room.gameState.started = false;
      room.gameState.targetNumber = null;
      room.gameState.gameHistory = [];
      room.gameState.levelCompleted = false;

      // Reset all player scores and attempts
      Object.keys(room.players).forEach((playerId) => {
        room.players[playerId].score = 0;
        room.players[playerId].attempts = 0;
      });

      // Start new game immediately
      const settings = getDifficultySettings(room.difficulty);
      const maxRange = settings.base * room.gameState.currentLevel;

      room.gameState.started = true;
      room.gameState.targetNumber = Math.floor(Math.random() * maxRange) + 1;
      room.gameState.range = { min: 1, max: maxRange };
      room.gameState.maxAttempts = settings.attempts;

      io.to(roomCode).emit('gameStarted', {
        level: room.gameState.currentLevel,
        targetNumber: room.gameState.targetNumber,
        range: room.gameState.range,
        maxAttempts: room.gameState.maxAttempts
      });

      console.log(`🔄 Nuova partita iniziata nella stanza ${roomCode}`);
    } catch (error) {
      console.error('Errore new game:', error);
      socket.emit('error', { message: 'Errore nell\'iniziare una nuova partita' });
    }
  });

  // Chat message
  socket.on('chatMessage', (data) => {
    try {
      const { roomCode, message } = data;
      const room = rooms.get(roomCode);

      if (!room) {
        socket.emit('error', { message: 'Stanza non trovata' });
        return;
      }

      const player = room.players[socket.id];
      if (!player) {
        socket.emit('error', { message: 'Giocatore non trovato' });
        return;
      }

      if (!message || message.trim().length === 0) {
        return;
      }

      // Broadcast message to all players in room
      io.to(roomCode).emit('chatMessage', {
        playerId: socket.id,
        playerName: player.name,
        message: message.trim(),
        timestamp: new Date(),
        isOwn: false
      });

      // Send back to sender with isOwn flag
      socket.emit('chatMessage', {
        playerId: socket.id,
        playerName: player.name,
        message: message.trim(),
        timestamp: new Date(),
        isOwn: true
      });

      console.log(`💬 ${player.name}: ${message.trim()}`);
    } catch (error) {
      console.error('Errore chat message:', error);
      socket.emit('error', { message: 'Errore nell\'inviare il messaggio' });
    }
  });

  // Leave room
  socket.on('leaveRoom', (data) => {
    try {
      const { roomCode } = data;
      handlePlayerLeave(socket.id, roomCode);
    } catch (error) {
      console.error('Errore leave room:', error);
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    try {
      const playerData = players.get(socket.id);
      if (playerData) {
        handlePlayerLeave(socket.id, playerData.roomCode);
      }
      console.log(`🚪 Giocatore disconnesso: ${socket.id}`);
    } catch (error) {
      console.error('Errore disconnect:', error);
    }
  });

  // Handle player leave
  function handlePlayerLeave(playerId, roomCode) {
    try {
      const room = rooms.get(roomCode);
      if (!room) return;

      const player = room.players[playerId];
      if (!player) return;

      const playerName = player.name;
      const wasHost = player.isHost;

      // Remove player from room
      delete room.players[playerId];
      players.delete(playerId);

      // If room is empty, delete it
      if (Object.keys(room.players).length === 0) {
        rooms.delete(roomCode);
        console.log(`🗑️ Stanza ${roomCode} eliminata (vuota)`);
        return;
      }

      // If host left, assign new host
      if (wasHost) {
        const newHostId = Object.keys(room.players)[0];
        room.players[newHostId].isHost = true;
        room.host = newHostId;
        console.log(`👑 Nuovo host: ${room.players[newHostId].name}`);
      }

      // Notify remaining players
      io.to(roomCode).emit('playerLeft', {
        playerName: playerName,
        players: room.players
      });

      console.log(`🚪 ${playerName} ha abbandonato la stanza ${roomCode}`);
    } catch (error) {
      console.error('Errore handle player leave:', error);
    }
  }
});

// Cleanup empty rooms every 5 minutes
setInterval(() => {
  const now = new Date();
  for (const [code, room] of rooms.entries()) {
    // Remove rooms older than 2 hours with no players
    if (Object.keys(room.players).length === 0 && now - room.createdAt > 2 * 60 * 60 * 1000) {
      rooms.delete(code);
      console.log(`🧹 Stanza ${code} rimossa (inattiva)`);
    }
  }
}, 5 * 60 * 1000);

// Start server
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🌌 Server Numero Quest in ascolto sulla porta ${PORT}`);
  console.log(`🚀 Server pronto per Render!`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Server in chiusura...');
  httpServer.close(() => {
    console.log('✅ Server chiuso correttamente');
    process.exit(0);
  });
});

module.exports = httpServer;
