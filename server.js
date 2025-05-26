const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const path = require("path")

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({
  server,
  perMessageDeflate: false, // Disable compression for better performance
})

// Middleware
app.use(express.static(__dirname))
app.use(express.json())

// Game storage
const gameRooms = new Map()
const playerConnections = new Map()
const messageThrottle = new Map()

// Configuration
const THROTTLE_LIMIT = 15 // messages per window
const THROTTLE_WINDOW = 1000 // 1 second
const INACTIVE_TIMEOUT = 15 * 60 * 1000 // 15 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes

const DIFFICULTIES = {
  easy: { name: "🧩 FACILE - Esploratore Spaziale", baseRange: 30, attempts: 10 },
  medium: { name: "⚔️ MEDIO - Guerriero Cosmico", baseRange: 60, attempts: 8 },
  hard: { name: "🔥 DIFFICILE - Maestro Galattico", baseRange: 150, attempts: 7 },
  hardcore: { name: "💀 HARDCORE - Leggenda Universale", baseRange: 300, attempts: 5 },
}

// WebSocket connection handling
wss.on("connection", (ws, req) => {
  console.log(`🔗 Nuovo client connesso da ${req.socket.remoteAddress}`)

  // Set connection properties
  ws.isAlive = true
  ws.lastActivity = Date.now()

  ws.on("pong", () => {
    ws.isAlive = true
    ws.lastActivity = Date.now()
  })

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message)

      // Update activity
      ws.lastActivity = Date.now()

      // Throttling check
      if (!checkThrottle(ws, req.socket.remoteAddress)) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Troppi messaggi, rallenta!",
          }),
        )
        return
      }

      handleWebSocketMessage(ws, data)
    } catch (error) {
      console.error("❌ Errore parsing messaggio:", error)
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Formato messaggio non valido",
        }),
      )
    }
  })

  ws.on("close", () => {
    console.log("🔌 Client disconnesso")
    cleanupPlayerConnection(ws)
  })

  ws.on("error", (error) => {
    console.error("❌ Errore WebSocket:", error)
    cleanupPlayerConnection(ws)
  })
})

function checkThrottle(ws, clientIP) {
  const now = Date.now()
  const key = clientIP || "unknown"

  if (!messageThrottle.has(key)) {
    messageThrottle.set(key, { count: 1, resetTime: now + THROTTLE_WINDOW })
    return true
  }

  const throttleData = messageThrottle.get(key)

  if (now > throttleData.resetTime) {
    throttleData.count = 1
    throttleData.resetTime = now + THROTTLE_WINDOW
    return true
  }

  if (throttleData.count >= THROTTLE_LIMIT) {
    return false
  }

  throttleData.count++
  return true
}

function handleWebSocketMessage(ws, data) {
  try {
    switch (data.type) {
      case "ping":
        ws.send(JSON.stringify({ type: "pong" }))
        break
      case "createGame":
        createGame(ws, data)
        break
      case "joinGame":
        joinGame(ws, data)
        break
      case "startGame":
        startGame(ws, data)
        break
      case "gameAction":
        handleGameAction(ws, data)
        break
      case "nextLevel":
        nextLevel(ws, data)
        break
      case "chatMessage":
        handleChatMessage(ws, data)
        break
      case "leaveGame":
        leaveGame(ws, data)
        break
      case "refreshState":
        refreshGameState(ws, data)
        break
      default:
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Tipo messaggio sconosciuto: " + data.type,
          }),
        )
    }
  } catch (error) {
    console.error("❌ Errore gestione messaggio:", error)
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Errore interno del server",
      }),
    )
  }
}

function createGame(ws, data) {
  const { roomCode, playerId, playerName, gameState } = data

  if (!roomCode || !playerId || !playerName || !gameState) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Dati mancanti per la creazione della stanza",
      }),
    )
    return
  }

  if (gameRooms.has(roomCode)) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Stazione già esistente!",
      }),
    )
    return
  }

  // Validate difficulty
  if (!DIFFICULTIES[gameState.difficulty]) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Difficoltà non valida",
      }),
    )
    return
  }

  const newGameState = {
    ...gameState,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  }

  gameRooms.set(roomCode, newGameState)
  playerConnections.set(playerId, { ws, roomCode, playerName })

  ws.send(
    JSON.stringify({
      type: "gameStateUpdate",
      roomCode: roomCode,
      gameState: newGameState,
    }),
  )

  console.log(`🚀 Stazione creata: ${roomCode} da ${playerName}`)
}

function joinGame(ws, data) {
  const { roomCode, playerId, playerName } = data

  if (!roomCode || !playerId || !playerName) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Dati mancanti per l'accesso alla stazione",
      }),
    )
    return
  }

  const gameState = gameRooms.get(roomCode)
  if (!gameState) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Stazione non trovata!",
      }),
    )
    return
  }

  // Check if player already exists
  const existingPlayerIndex = gameState.players.findIndex((p) => p.name === playerName)
  if (existingPlayerIndex !== -1) {
    // Reconnect existing player
    gameState.players[existingPlayerIndex].isOnline = true
    gameState.players[existingPlayerIndex].lastSeen = Date.now()
    gameState.players[existingPlayerIndex].id = playerId
  } else {
    // Add new player
    gameState.players.push({
      id: playerId,
      name: playerName,
      score: 0,
      isHost: false,
      isOnline: true,
      lastSeen: Date.now(),
    })
  }

  // Add welcome message
  gameState.chat.push({
    id: "join_" + Date.now(),
    playerId: "system",
    playerName: "Sistema Galattico",
    message: `🚪 ${playerName} è entrato nella stazione!`,
    timestamp: Date.now(),
    isSystem: true,
  })

  gameState.lastActivity = Date.now()
  playerConnections.set(playerId, { ws, roomCode, playerName })
  gameRooms.set(roomCode, gameState)

  // Broadcast to all players in room
  broadcastToRoom(roomCode, {
    type: "gameStateUpdate",
    roomCode: roomCode,
    gameState: gameState,
  })

  console.log(`👥 ${playerName} si è unito alla stazione: ${roomCode}`)
}

function startGame(ws, data) {
  const { roomCode, playerId, gameState } = data

  if (!roomCode || !playerId || !gameState) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Dati mancanti per l'avvio del gioco",
      }),
    )
    return
  }

  // Verify host permissions
  const currentGameState = gameRooms.get(roomCode)
  if (!currentGameState) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Stazione non trovata",
      }),
    )
    return
  }

  const player = currentGameState.players.find((p) => p.id === playerId)
  if (!player || !player.isHost) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Solo l'host può iniziare la battaglia",
      }),
    )
    return
  }

  gameState.lastActivity = Date.now()
  gameRooms.set(roomCode, gameState)

  broadcastToRoom(roomCode, {
    type: "gameStateUpdate",
    roomCode: roomCode,
    gameState: gameState,
  })

  console.log(`🎮 Gioco iniziato nella stanza: ${roomCode}`)
}

function handleGameAction(ws, data) {
  const { roomCode, playerId, gameState } = data

  if (!roomCode || !playerId || !gameState) {
    return
  }

  gameState.lastActivity = Date.now()
  gameRooms.set(roomCode, gameState)

  broadcastToRoom(roomCode, {
    type: "gameStateUpdate",
    roomCode: roomCode,
    gameState: gameState,
  })
}

function nextLevel(ws, data) {
  const { roomCode, playerId, gameState } = data

  if (!roomCode || !playerId || !gameState) {
    return
  }

  // Verify host permissions
  const currentGameState = gameRooms.get(roomCode)
  if (!currentGameState) return

  const player = currentGameState.players.find((p) => p.id === playerId)
  if (!player || !player.isHost) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Solo l'host può avanzare al livello successivo",
      }),
    )
    return
  }

  gameState.lastActivity = Date.now()
  gameRooms.set(roomCode, gameState)

  broadcastToRoom(roomCode, {
    type: "gameStateUpdate",
    roomCode: roomCode,
    gameState: gameState,
  })

  console.log(`⬆️ Livello successivo nella stanza: ${roomCode}, Livello: ${gameState.level}`)
}

function handleChatMessage(ws, data) {
  const { roomCode, playerId, message } = data

  if (!roomCode || !playerId || !message) {
    return
  }

  const gameState = gameRooms.get(roomCode)
  if (!gameState) return

  // Validate message length
  if (message.message && message.message.length > 200) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Messaggio troppo lungo",
      }),
    )
    return
  }

  gameState.chat.push(message)
  gameState.lastActivity = Date.now()
  gameRooms.set(roomCode, gameState)

  broadcastToRoom(roomCode, {
    type: "gameStateUpdate",
    roomCode: roomCode,
    gameState: gameState,
  })
}

function leaveGame(ws, data) {
  const { roomCode, playerId, playerName } = data

  const gameState = gameRooms.get(roomCode)
  if (gameState) {
    const player = gameState.players.find((p) => p.id === playerId)
    if (player) {
      player.isOnline = false
    }

    gameState.chat.push({
      id: "leave_" + Date.now(),
      playerId: "system",
      playerName: "Sistema Galattico",
      message: `🚪 ${playerName} ha abbandonato la stazione`,
      timestamp: Date.now(),
      isSystem: true,
    })

    gameState.lastActivity = Date.now()
    gameRooms.set(roomCode, gameState)

    broadcastToRoom(
      roomCode,
      {
        type: "gameStateUpdate",
        roomCode: roomCode,
        gameState: gameState,
      },
      playerId,
    )
  }

  playerConnections.delete(playerId)
  console.log(`👋 ${playerName} ha lasciato la stanza: ${roomCode}`)
}

function refreshGameState(ws, data) {
  const { roomCode, playerId } = data

  if (!roomCode || !playerId) return

  const gameState = gameRooms.get(roomCode)
  if (gameState) {
    ws.send(
      JSON.stringify({
        type: "gameStateUpdate",
        roomCode: roomCode,
        gameState: gameState,
      }),
    )
  }
}

function broadcastToRoom(roomCode, message, excludePlayerId = null) {
  const gameState = gameRooms.get(roomCode)
  if (!gameState) return

  const activePlayers = gameState.players.filter((player) => player.id !== excludePlayerId && player.isOnline)

  activePlayers.forEach((player) => {
    const connection = playerConnections.get(player.id)
    if (connection && connection.ws && connection.ws.readyState === WebSocket.OPEN) {
      try {
        connection.ws.send(JSON.stringify(message))
      } catch (error) {
        console.error(`❌ Errore invio messaggio a ${player.name}:`, error)
        // Mark player as offline if send fails
        player.isOnline = false
        playerConnections.delete(player.id)
      }
    } else {
      // Remove dead connections
      player.isOnline = false
      playerConnections.delete(player.id)
    }
  })
}

function cleanupPlayerConnection(ws) {
  for (const [playerId, connection] of playerConnections.entries()) {
    if (connection.ws === ws) {
      playerConnections.delete(playerId)

      // Mark player as offline in all rooms
      for (const [roomCode, gameState] of gameRooms.entries()) {
        const player = gameState.players.find((p) => p.id === playerId)
        if (player) {
          player.isOnline = false

          // Notify other players
          broadcastToRoom(
            roomCode,
            {
              type: "gameStateUpdate",
              roomCode: roomCode,
              gameState: gameState,
            },
            playerId,
          )
        }
      }
      break
    }
  }
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    rooms: gameRooms.size,
    connections: playerConnections.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
  })
})

app.get("/api/stats", (req, res) => {
  const stats = {
    totalRooms: gameRooms.size,
    activeConnections: playerConnections.size,
    totalPlayers: 0,
    activeRooms: 0,
    gameStates: {},
  }

  for (const [roomCode, gameState] of gameRooms.entries()) {
    stats.totalPlayers += gameState.players.length
    if (gameState.players.some((p) => p.isOnline)) {
      stats.activeRooms++
    }

    stats.gameStates[roomCode] = {
      players: gameState.players.length,
      level: gameState.level,
      started: gameState.gameStarted,
      completed: gameState.gameCompleted,
    }
  }

  res.json(stats)
})

// Main routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"))
})

app.get("/cristo", (req, res) => {
  res.sendFile(path.join(__dirname, "cristo.html"))
})

// 404 handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "index.html"))
})

// Heartbeat to detect broken connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log("🔌 Terminando connessione inattiva")
      return ws.terminate()
    }

    ws.isAlive = false
    ws.ping()
  })
}, 30000)

// Cleanup inactive rooms and connections
const cleanup = setInterval(() => {
  const now = Date.now()

  // Clean up rooms
  for (const [roomCode, gameState] of gameRooms.entries()) {
    const hasActivePlayers = gameState.players.some(
      (player) => player.isOnline && now - player.lastSeen < INACTIVE_TIMEOUT,
    )

    if (!hasActivePlayers || now - gameState.lastActivity > INACTIVE_TIMEOUT) {
      gameRooms.delete(roomCode)
      console.log(`🧹 Stanza inattiva rimossa: ${roomCode}`)
    }
  }

  // Clean up throttle map
  messageThrottle.clear()

  // Clean up dead connections
  for (const [playerId, connection] of playerConnections.entries()) {
    if (!connection.ws || connection.ws.readyState !== WebSocket.OPEN) {
      playerConnections.delete(playerId)
    }
  }

  console.log(`🧹 Cleanup completato - Stanze: ${gameRooms.size}, Connessioni: ${playerConnections.size}`)
}, CLEANUP_INTERVAL)

// Server startup
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`🚀 Battaglia Galattica Server avviato sulla porta ${PORT}`)
  console.log(`🌐 WebSocket server pronto per battaglie multiplayer!`)
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`)
  console.log(`📁 Servendo file da: ${__dirname}`)
})

// Graceful shutdown
const gracefulShutdown = () => {
  console.log("🛑 Avvio shutdown graceful...")

  // Stop accepting new connections
  server.close(() => {
    console.log("✅ HTTP server chiuso")
  })

  // Close all WebSocket connections
  wss.clients.forEach((ws) => {
    ws.close(1000, "Server shutdown")
  })

  // Clear intervals
  clearInterval(heartbeat)
  clearInterval(cleanup)

  // Clear data structures
  gameRooms.clear()
  playerConnections.clear()
  messageThrottle.clear()

  console.log("✅ Shutdown completato")
  process.exit(0)
}

process.on("SIGTERM", gracefulShutdown)
process.on("SIGINT", gracefulShutdown)

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error)
  gracefulShutdown()
})

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason)
  gracefulShutdown()
})
