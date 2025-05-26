const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const path = require("path")

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

// Middleware per servire file statici dalla root
app.use(express.static(__dirname))
app.use(express.json())

// Storage in memoria per le stanze di gioco
const gameRooms = new Map()
const playerConnections = new Map()

// Configurazione difficoltà
const DIFFICULTIES = {
  easy: { name: "🧩 FACILE - Esploratore Spaziale", baseRange: 30, attempts: 10 },
  medium: { name: "⚔️ MEDIO - Guerriero Cosmico", baseRange: 60, attempts: 8 },
  hard: { name: "🔥 DIFFICILE - Maestro Galattico", baseRange: 150, attempts: 7 },
  hardcore: { name: "💀 HARDCORE - Leggenda Universale", baseRange: 300, attempts: 5 },
}

// Gestione connessioni WebSocket
wss.on("connection", (ws) => {
  console.log("🔗 Nuovo client connesso")

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message)
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
  })
})

function handleWebSocketMessage(ws, data) {
  switch (data.type) {
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
    default:
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Tipo messaggio sconosciuto",
        }),
      )
  }
}

function createGame(ws, data) {
  const { roomCode, playerId, playerName, gameState } = data

  if (gameRooms.has(roomCode)) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Stazione già esistente!",
      }),
    )
    return
  }

  // Crea nuovo stato di gioco
  const newGameState = {
    ...gameState,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  }

  gameRooms.set(roomCode, newGameState)
  playerConnections.set(playerId, ws)

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

  // Controlla se il giocatore esiste già
  const existingPlayerIndex = gameState.players.findIndex((p) => p.name === playerName)
  if (existingPlayerIndex !== -1) {
    // Riconnetti giocatore esistente
    gameState.players[existingPlayerIndex].isOnline = true
    gameState.players[existingPlayerIndex].lastSeen = Date.now()
    gameState.players[existingPlayerIndex].id = playerId
  } else {
    // Aggiungi nuovo giocatore
    gameState.players.push({
      id: playerId,
      name: playerName,
      score: 0,
      isHost: false,
      isOnline: true,
      lastSeen: Date.now(),
    })
  }

  // Aggiungi messaggio di benvenuto
  gameState.chat.push({
    id: "join_" + Date.now(),
    playerId: "system",
    playerName: "Sistema Galattico",
    message: `🚪 ${playerName} è entrato nella stazione!`,
    timestamp: Date.now(),
    isSystem: true,
  })

  gameState.lastActivity = Date.now()
  playerConnections.set(playerId, ws)
  gameRooms.set(roomCode, gameState)

  // Invia stato aggiornato a tutti i giocatori
  broadcastToRoom(roomCode, {
    type: "gameStateUpdate",
    roomCode: roomCode,
    gameState: gameState,
  })

  console.log(`👥 ${playerName} si è unito alla stazione: ${roomCode}`)
}

function startGame(ws, data) {
  const { roomCode, playerId, gameState } = data

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

  const gameState = gameRooms.get(roomCode)
  if (!gameState) return

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

    broadcastToRoom(roomCode, {
      type: "playerLeft",
      roomCode: roomCode,
      playerId: playerId,
      playerName: playerName,
    })
  }

  playerConnections.delete(playerId)
  console.log(`👋 ${playerName} ha lasciato la stanza: ${roomCode}`)
}

function broadcastToRoom(roomCode, message, excludePlayerId = null) {
  const gameState = gameRooms.get(roomCode)
  if (!gameState) return

  gameState.players.forEach((player) => {
    if (player.id !== excludePlayerId && player.isOnline) {
      const connection = playerConnections.get(player.id)
      if (connection && connection.readyState === WebSocket.OPEN) {
        try {
          connection.send(JSON.stringify(message))
        } catch (error) {
          console.error("❌ Errore invio messaggio:", error)
        }
      }
    }
  })
}

function cleanupPlayerConnection(ws) {
  for (const [playerId, connection] of playerConnections.entries()) {
    if (connection === ws) {
      playerConnections.delete(playerId)

      // Segna il giocatore come offline in tutte le stanze
      for (const [roomCode, gameState] of gameRooms.entries()) {
        const player = gameState.players.find((p) => p.id === playerId)
        if (player) {
          player.isOnline = false
          broadcastToRoom(roomCode, {
            type: "playerLeft",
            roomCode: roomCode,
            playerId: playerId,
            playerName: player.name,
          })
        }
      }
      break
    }
  }
}

// Routes API REST
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    rooms: gameRooms.size,
    connections: playerConnections.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

app.get("/api/stats", (req, res) => {
  const stats = {
    totalRooms: gameRooms.size,
    activeConnections: playerConnections.size,
    totalPlayers: 0,
    activeRooms: 0,
  }

  for (const [roomCode, gameState] of gameRooms.entries()) {
    stats.totalPlayers += gameState.players.length
    if (gameState.players.some((p) => p.isOnline)) {
      stats.activeRooms++
    }
  }

  res.json(stats)
})

// Route principale - serve index.html per il multiplayer
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"))
})

// Route per cristo.html - single player
app.get("/cristo", (req, res) => {
  res.sendFile(path.join(__dirname, "cristo.html"))
})

// Gestione errori 404 - serve index.html come fallback
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "index.html"))
})

// Pulizia automatica stanze inattive ogni 30 minuti
setInterval(
  () => {
    const now = Date.now()
    const INACTIVE_TIMEOUT = 30 * 60 * 1000 // 30 minuti

    for (const [roomCode, gameState] of gameRooms.entries()) {
      const hasActivePlayers = gameState.players.some(
        (player) => player.isOnline && now - player.lastSeen < INACTIVE_TIMEOUT,
      )

      if (!hasActivePlayers || now - gameState.lastActivity > INACTIVE_TIMEOUT) {
        gameRooms.delete(roomCode)
        console.log(`🧹 Stanza inattiva rimossa: ${roomCode}`)
      }
    }
  },
  30 * 60 * 1000,
)

// Avvio server
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`🚀 Battaglia Galattica Server avviato sulla porta ${PORT}`)
  console.log(`🌐 WebSocket server pronto per battaglie multiplayer!`)
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`)
  console.log(`📁 Servendo file da: ${__dirname}`)
})

// Gestione graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 Ricevuto SIGTERM, chiusura server...")
  server.close(() => {
    console.log("✅ Server chiuso correttamente")
    process.exit(0)
  })
})

process.on("SIGINT", () => {
  console.log("🛑 Ricevuto SIGINT, chiusura server...")
  server.close(() => {
    console.log("✅ Server chiuso correttamente")
    process.exit(0)
  })
})
