const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const path = require("path")

const app = express()
const server = http.createServer(app)

// Configurazione per produzione
const PORT = process.env.PORT || 3000
const NODE_ENV = process.env.NODE_ENV || 'development'

console.log(`🚀 Starting server in ${NODE_ENV} mode on port ${PORT}`)

// Middleware di sicurezza per produzione
if (NODE_ENV === 'production') {
  app.set('trust proxy', 1)
  
  // Headers di sicurezza
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-XSS-Protection', '1; mode=block')
    next()
  })
}

// Serve static files con cache per produzione
const staticOptions = NODE_ENV === 'production' 
  ? { maxAge: '1d', etag: true }
  : {}

app.use(express.static(path.join(__dirname), staticOptions))

// Health check endpoint per Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    rooms: rooms.size
  })
})

// Routes principali
app.get("/", (req, res) => {
  console.log("📱 Serving home page (cristo.html)")
  try {
    res.sendFile(path.join(__dirname, "cristo.html"))
  } catch (error) {
    console.error("❌ Error serving home page:", error)
    res.status(500).send("Errore nel caricamento della home page")
  }
})

app.get("/multiplayer", (req, res) => {
  console.log("🎮 Serving multiplayer arena (index.html)")
  try {
    res.sendFile(path.join(__dirname, "index.html"))
  } catch (error) {
    console.error("❌ Error serving multiplayer page:", error)
    res.status(500).send("Errore nel caricamento dell'arena multiplayer")
  }
})

// API endpoint per statistiche
app.get("/api/stats", (req, res) => {
  try {
    const stats = {
      totalRooms: rooms.size,
      totalPlayers: Array.from(rooms.values()).reduce((total, room) => total + room.players.length, 0),
      activeGames: Array.from(rooms.values()).filter(room => room.gameStarted && !room.gameEnded).length,
      serverUptime: process.uptime(),
      timestamp: new Date().toISOString()
    }
    res.json(stats)
  } catch (error) {
    console.error("❌ Error getting stats:", error)
    res.status(500).json({ error: "Errore nel recupero delle statistiche" })
  }
})

// Fallback per route non trovate
app.get("*", (req, res) => {
  console.log(`❓ Unknown route: ${req.path}, redirecting to home`)
  res.redirect("/")
})

// Error handler globale
app.use((error, req, res, next) => {
  console.error("❌ Global error handler:", error)
  res.status(500).send("Errore interno del server")
})

// WebSocket Server con gestione errori migliorata
const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: false,
  maxPayload: 1024 * 1024 // 1MB max payload
})

// Game state
const rooms = new Map()

// Configurazioni difficoltà
const difficultyConfigs = {
  easy: {
    name: "🌟 Modalità Principiante",
    maxNumber: 50,
    maxAttempts: 5,
    timeLimit: 45,
    levelMultiplier: 25,
  },
  normal: {
    name: "⚡ Modalità Guerriero",
    maxNumber: 100,
    maxAttempts: 3,
    timeLimit: 30,
    levelMultiplier: 50,
  },
  hard: {
    name: "🔥 Modalità Comandante",
    maxNumber: 200,
    maxAttempts: 2,
    timeLimit: 20,
    levelMultiplier: 75,
  },
  expert: {
    name: "💀 Modalità Leggenda",
    maxNumber: 500,
    maxAttempts: 1,
    timeLimit: 15,
    levelMultiplier: 100,
  },
}

// Utility functions
function generateRoomCode() {
  return "ROOM" + Math.random().toString(36).substr(2, 6).toUpperCase()
}

function generateTargetNumber(config, level) {
  const maxNum = config.maxNumber + (level - 1) * config.levelMultiplier
  return Math.floor(Math.random() * maxNum) + 1
}

function calculateScore(attempts, timeLeft, level, config) {
  const baseScore = 100
  const attemptsBonus = Math.max(0, (config.maxAttempts - attempts) * 20)
  const timeBonus = Math.max(0, Math.floor(timeLeft * 2))
  const levelBonus = level * 50

  return Math.max(0, baseScore + attemptsBonus + timeBonus + levelBonus)
}

function broadcastToRoom(roomCode, message) {
  const room = rooms.get(roomCode)
  if (!room) return

  const messageStr = JSON.stringify(message)
  
  room.players.forEach((player) => {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      try {
        player.ws.send(messageStr)
      } catch (error) {
        console.error(`❌ Error sending to player ${player.id}:`, error.message)
        // Rimuovi player disconnesso
        removePlayerFromRoom(roomCode, player.id)
      }
    }
  })
}

function removePlayerFromRoom(roomCode, playerId) {
  const room = rooms.get(roomCode)
  if (!room) return

  const playerIndex = room.players.findIndex(p => p.id === playerId)
  if (playerIndex === -1) return

  const player = room.players[playerIndex]
  room.players.splice(playerIndex, 1)

  addChatMessage(roomCode, "Sistema", `👋 ${player.name} ha abbandonato la battaglia`)

  // Se la stanza è vuota, eliminala
  if (room.players.length === 0) {
    rooms.delete(roomCode)
    console.log(`🗑️ Room ${roomCode} deleted (empty)`)
    return
  }

  // Se l'host se n'è andato, nomina un nuovo host
  if (player.isHost && room.players.length > 0) {
    room.players[0].isHost = true
    addChatMessage(roomCode, "Sistema", `👑 ${room.players[0].name} è ora il comandante principale`)
  }

  // Aggiusta l'indice del giocatore corrente se necessario
  if (room.currentPlayerIndex >= room.players.length) {
    room.currentPlayerIndex = 0
  }

  broadcastToRoom(roomCode, {
    type: "gameUpdate",
    gameData: room,
  })
}

function addChatMessage(roomCode, playerName, message) {
  const room = rooms.get(roomCode)
  if (!room) return

  room.chat.push({
    playerName,
    message,
    timestamp: Date.now(),
  })

  // Mantieni solo gli ultimi 50 messaggi
  if (room.chat.length > 50) {
    room.chat = room.chat.slice(-50)
  }
}

function nextLevel(roomCode) {
  const room = rooms.get(roomCode)
  if (!room) return

  room.currentLevel++
  room.currentRound++
  room.currentPlayerIndex = 0
  room.currentAttempts = 0
  room.targetNumber = generateTargetNumber(room.config, room.currentLevel)

  addChatMessage(
    roomCode,
    "Sistema",
    `🎉 Livello ${room.currentLevel} iniziato! Range: 1-${room.config.maxNumber + (room.currentLevel - 1) * room.config.levelMultiplier}`,
  )

  if (room.currentLevel > 10) {
    endGame(roomCode)
    return
  }

  broadcastToRoom(roomCode, {
    type: "gameUpdate",
    gameData: room,
  })
}

function nextPlayer(roomCode) {
  const room = rooms.get(roomCode)
  if (!room) return

  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length
  room.currentAttempts = 0

  broadcastToRoom(roomCode, {
    type: "gameUpdate",
    gameData: room,
  })
}

function endGame(roomCode) {
  const room = rooms.get(roomCode)
  if (!room) return

  room.gameEnded = true

  // Trova il vincitore (punteggio più alto)
  const winner = room.players.reduce((prev, current) => 
    (prev.score > current.score ? prev : current)
  )

  room.winner = winner

  addChatMessage(
    roomCode,
    "Sistema",
    `🏆 BATTAGLIA COMPLETATA! Il vincitore è ${winner.name} con ${winner.score} punti!`,
  )

  broadcastToRoom(roomCode, {
    type: "gameUpdate",
    gameData: room,
  })
}

// WebSocket connection handling con gestione errori robusta
wss.on("connection", (ws, req) => {
  console.log(`🔗 New WebSocket connection from ${req.socket.remoteAddress}`)

  // Invia conferma connessione
  try {
    ws.send(JSON.stringify({ type: "connected" }))
  } catch (error) {
    console.error("❌ Error sending connection confirmation:", error.message)
    return
  }

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString())
      console.log(`📨 Received: ${data.type} from ${data.playerId || "unknown"}`)

      // Validazione base del messaggio
      if (!data.type) {
        ws.send(JSON.stringify({
          type: "error",
          message: "Tipo di messaggio mancante"
        }))
        return
      }

      switch (data.type) {
        case "createRoom":
          handleCreateRoom(ws, data)
          break

        case "joinRoom":
          handleJoinRoom(ws, data)
          break

        case "startGame":
          handleStartGame(ws, data)
          break

        case "guess":
          handleGuess(ws, data)
          break

        case "chat":
          handleChat(ws, data)
          break

        case "ping":
          try {
            ws.send(JSON.stringify({ type: "pong" }))
          } catch (error) {
            console.error("❌ Error sending pong:", error.message)
          }
          break

        default:
          console.log(`❓ Unknown message type: ${data.type}`)
          ws.send(JSON.stringify({
            type: "error",
            message: "Tipo di messaggio sconosciuto"
          }))
      }
    } catch (error) {
      console.error("❌ Error processing message:", error.message)
      try {
        ws.send(JSON.stringify({
          type: "error",
          message: "Errore nel processamento del messaggio"
        }))
      } catch (sendError) {
        console.error("❌ Error sending error message:", sendError.message)
      }
    }
  })

  ws.on("close", (code, reason) => {
    console.log(`🔌 WebSocket connection closed: ${code} ${reason}`)
    handleDisconnection(ws)
  })

  ws.on("error", (error) => {
    console.error("❌ WebSocket error:", error.message)
    handleDisconnection(ws)
  })
})

// Handler functions per i messaggi WebSocket
function handleCreateRoom(ws, data) {
  try {
    const roomCode = generateRoomCode()
    const difficulty = data.difficulty || "normal"
    const config = difficultyConfigs[difficulty]

    if (!config) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Difficoltà non valida"
      }))
      return
    }

    const room = {
      roomCode,
      config,
      players: [
        {
          id: data.playerId,
          name: data.playerName || "Comandante Anonimo",
          ws: ws,
          score: 0,
          isHost: true,
        },
      ],
      gameStarted: false,
      gameEnded: false,
      currentLevel: 1,
      currentRound: 0,
      currentPlayerIndex: 0,
      currentAttempts: 0,
      targetNumber: generateTargetNumber(config, 1),
      chat: [],
      winner: null,
    }

    rooms.set(roomCode, room)

    addChatMessage(roomCode, "Sistema", `🚀 Stazione ${roomCode} creata! Modalità: ${config.name}`)

    ws.send(JSON.stringify({
      type: "roomCreated",
      gameData: room,
    }))

    console.log(`🏠 Room ${roomCode} created by ${data.playerName}`)
  } catch (error) {
    console.error("❌ Error creating room:", error.message)
    ws.send(JSON.stringify({
      type: "error",
      message: "Errore nella creazione della stanza"
    }))
  }
}

function handleJoinRoom(ws, data) {
  try {
    const targetRoom = rooms.get(data.roomCode)
    if (!targetRoom) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Stazione galattica non trovata!"
      }))
      return
    }

    if (targetRoom.players.length >= 6) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Stazione galattica piena! (max 6 comandanti)"
      }))
      return
    }

    if (targetRoom.gameStarted) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Battaglia già in corso!"
      }))
      return
    }

    // Controlla se il giocatore è già nella stanza
    const existingPlayer = targetRoom.players.find(p => p.id === data.playerId)
    if (existingPlayer) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Sei già in questa stanza!"
      }))
      return
    }

    targetRoom.players.push({
      id: data.playerId,
      name: data.playerName || "Comandante Anonimo",
      ws: ws,
      score: 0,
      isHost: false,
    })

    addChatMessage(data.roomCode, "Sistema", `👋 ${data.playerName} si è unito alla battaglia!`)

    ws.send(JSON.stringify({
      type: "roomJoined",
      gameData: targetRoom,
    }))

    broadcastToRoom(data.roomCode, {
      type: "gameUpdate",
      gameData: targetRoom,
    })

    console.log(`🚪 ${data.playerName} joined room ${data.roomCode}`)
  } catch (error) {
    console.error("❌ Error joining room:", error.message)
    ws.send(JSON.stringify({
      type: "error",
      message: "Errore nell'unirsi alla stanza"
    }))
  }
}

function handleStartGame(ws, data) {
  try {
    const gameRoom = rooms.get(data.roomCode)
    if (!gameRoom) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Stazione non trovata!"
      }))
      return
    }

    const player = gameRoom.players.find((p) => p.id === data.playerId)
    if (!player || !player.isHost) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Solo il comandante principale può iniziare!"
      }))
      return
    }

    if (gameRoom.players.length < 2) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Servono almeno 2 comandanti per iniziare!"
      }))
      return
    }

    gameRoom.gameStarted = true
    gameRoom.currentRound = 1

    addChatMessage(data.roomCode, "Sistema", "🎯 BATTAGLIA GALATTICA INIZIATA! Che la forza sia con voi!")

    broadcastToRoom(data.roomCode, {
      type: "gameUpdate",
      gameData: gameRoom,
    })

    console.log(`🎮 Game started in room ${data.roomCode}`)
  } catch (error) {
    console.error("❌ Error starting game:", error.message)
    ws.send(JSON.stringify({
      type: "error",
      message: "Errore nell'avvio del gioco"
    }))
  }
}

function handleGuess(ws, data) {
  try {
    const guessRoom = rooms.get(data.roomCode)
    if (!guessRoom || !guessRoom.gameStarted || guessRoom.gameEnded) {
      return
    }

    const currentPlayer = guessRoom.players[guessRoom.currentPlayerIndex]
    if (!currentPlayer || currentPlayer.id !== data.playerId) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Non è il tuo turno!"
      }))
      return
    }

    guessRoom.currentAttempts++
    const guess = Number.parseInt(data.guess)
    const target = guessRoom.targetNumber

    if (isNaN(guess)) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Numero non valido!"
      }))
      return
    }

    const result = {
      correct: false,
      hint: "",
      guess: guess,
      target: target,
    }

    if (guess === target) {
      result.correct = true
      result.hint = "🎉 NUMERO CORRETTO! Avanzamento al livello successivo!"

      const timeLeft = Math.max(0, guessRoom.config.timeLimit - 5)
      const score = calculateScore(guessRoom.currentAttempts, timeLeft, guessRoom.currentLevel, guessRoom.config)
      currentPlayer.score += score

      addChatMessage(data.roomCode, "Sistema", `🎯 ${data.playerName} ha indovinato ${target}! +${score} punti!`)

      setTimeout(() => {
        nextLevel(data.roomCode)
      }, 2000)
    } else if (guessRoom.currentAttempts >= guessRoom.config.maxAttempts) {
      result.hint = `❌ Tentativi esauriti! Il numero era ${target}. Turno successivo!`
      addChatMessage(
        data.roomCode,
        "Sistema",
        `💥 ${data.playerName} ha esaurito i tentativi! Il numero era ${target}`
      )

      setTimeout(() => {
        nextPlayer(data.roomCode)
      }, 2000)
    } else {
      if (guess < target) {
        result.hint = `⬆️ Troppo basso! Tentativi rimasti: ${guessRoom.config.maxAttempts - guessRoom.currentAttempts}`
      } else {
        result.hint = `⬇️ Troppo alto! Tentativi rimasti: ${guessRoom.config.maxAttempts - guessRoom.currentAttempts}`
      }
      addChatMessage(data.roomCode, data.playerName, `Tentativo: ${guess} ${result.hint}`)
    }

    ws.send(JSON.stringify({
      type: "guessResult",
      result: result,
    }))

    broadcastToRoom(data.roomCode, {
      type: "gameUpdate",
      gameData: guessRoom,
    })
  } catch (error) {
    console.error("❌ Error handling guess:", error.message)
    ws.send(JSON.stringify({
      type: "error",
      message: "Errore nel processamento della risposta"
    }))
  }
}

function handleChat(ws, data) {
  try {
    const chatRoom = rooms.get(data.roomCode)
    if (chatRoom && data.message && data.message.trim()) {
      const sanitizedMessage = data.message.trim().substring(0, 200) // Limita lunghezza
      addChatMessage(data.roomCode, data.playerName, sanitizedMessage)

      broadcastToRoom(data.roomCode, {
        type: "gameUpdate",
        gameData: chatRoom,
      })
    }
  } catch (error) {
    console.error("❌ Error handling chat:", error.message)
  }
}

function handleDisconnection(ws) {
  // Rimuovi il giocatore da tutte le stanze
  rooms.forEach((room, roomCode) => {
    const playerIndex = room.players.findIndex((p) => p.ws === ws)
    if (playerIndex > -1) {
      const player = room.players[playerIndex]
      removePlayerFromRoom(roomCode, player.id)
    }
  })
}

// Cleanup periodico delle stanze vuote
setInterval(() => {
  const emptyRooms = []
  rooms.forEach((room, roomCode) => {
    if (room.players.length === 0) {
      emptyRooms.push(roomCode)
    }
  })
  
  emptyRooms.forEach(roomCode => {
    rooms.delete(roomCode)
    console.log(`🧹 Cleaned up empty room: ${roomCode}`)
  })
}, 300000) // Ogni 5 minuti

// Gestione graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down gracefully")
  
  // Chiudi tutte le connessioni WebSocket
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, "Server shutdown")
    }
  })
  
  server.close(() => {
    console.log("✅ Server closed")
    process.exit(0)
  })
})

process.on("SIGINT", () => {
  console.log("🛑 SIGINT received, shutting down gracefully")
  process.exit(0)
})

// Gestione errori non catturati
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason)
})

// Avvio server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`🏠 Home: http://localhost:${PORT}/`)
  console.log(`🎮 Multiplayer: http://localhost:${PORT}/multiplayer`)
  console.log(`📊 Health: http://localhost:${PORT}/health`)
  console.log(`📈 Stats: http://localhost:${PORT}/api/stats`)
  console.log(`🌐 Environment: ${NODE_ENV}`)
  console.log(`💾 Active rooms: ${rooms.size}`)
})
