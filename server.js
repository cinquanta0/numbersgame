const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const path = require("path")

const app = express()
const server = http.createServer(app)

// Middleware
app.use(express.static(__dirname))
app.use(express.json())

// WebSocket Server
const wss = new WebSocket.Server({ server })

// Game storage
const gameRooms = new Map()
const playerConnections = new Map()

// Configuration
const DIFFICULTIES = {
  easy: { name: "🧩 FACILE - Esploratore Spaziale", baseRange: 30, attempts: 10 },
  medium: { name: "⚔️ MEDIO - Guerriero Cosmico", baseRange: 60, attempts: 8 },
  hard: { name: "🔥 DIFFICILE - Maestro Galattico", baseRange: 150, attempts: 7 },
  hardcore: { name: "💀 HARDCORE - Leggenda Universale", baseRange: 300, attempts: 5 },
}

// WebSocket connection handling
wss.on("connection", (ws) => {
  console.log("🔗 Nuovo client connesso")

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message)
      handleWebSocketMessage(ws, data)
    } catch (error) {
      console.error("❌ Errore parsing messaggio:", error)
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
    default:
      console.log("Tipo messaggio sconosciuto:", data.type)
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

  gameRooms.set(roomCode, gameState)
  playerConnections.set(playerId, ws)

  ws.send(
    JSON.stringify({
      type: "gameStateUpdate",
      roomCode: roomCode,
      gameState: gameState,
    }),
  )

  console.log(`🚀 Stazione creata: ${roomCode}`)
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

  // Add player if not exists
  const existingPlayer = gameState.players.find((p) => p.name === playerName)
  if (!existingPlayer) {
    gameState.players.push({
      id: playerId,
      name: playerName,
      score: 0,
      isHost: false,
      isOnline: true,
      attempts: 0,
      isEliminated: false,
    })

    // Add to turn order
    if (!gameState.turnOrder) {
      gameState.turnOrder = [gameState.players[0].id]
    }
    gameState.turnOrder.push(playerId)
  }

  playerConnections.set(playerId, ws)
  gameRooms.set(roomCode, gameState)

  // Broadcast to all players
  broadcastToRoom(roomCode, {
    type: "gameStateUpdate",
    roomCode: roomCode,
    gameState: gameState,
  })

  console.log(`👥 ${playerName} si è unito alla stazione: ${roomCode}`)
}

function startGame(ws, data) {
  const { roomCode, gameState } = data

  // Set first player turn
  const activePlayers = gameState.players.filter((p) => p.isOnline)
  if (activePlayers.length > 0) {
    gameState.currentPlayerTurn = activePlayers[0].id
  }

  gameRooms.set(roomCode, gameState)

  broadcastToRoom(roomCode, {
    type: "gameStateUpdate",
    roomCode: roomCode,
    gameState: gameState,
  })

  console.log(`🎮 Gioco iniziato: ${roomCode}`)
}

function handleGameAction(ws, data) {
  const { roomCode, gameState } = data

  gameRooms.set(roomCode, gameState)

  broadcastToRoom(roomCode, {
    type: "gameStateUpdate",
    roomCode: roomCode,
    gameState: gameState,
  })
}

function nextLevel(ws, data) {
  const { roomCode, gameState } = data

  gameRooms.set(roomCode, gameState)

  broadcastToRoom(roomCode, {
    type: "gameStateUpdate",
    roomCode: roomCode,
    gameState: gameState,
  })
}

function handleChatMessage(ws, data) {
  const { roomCode, message } = data

  const gameState = gameRooms.get(roomCode)
  if (gameState) {
    gameState.chat.push(message)
    gameRooms.set(roomCode, gameState)

    broadcastToRoom(roomCode, {
      type: "gameStateUpdate",
      roomCode: roomCode,
      gameState: gameState,
    })
  }
}

function leaveGame(ws, data) {
  const { roomCode, playerId, playerName } = data

  const gameState = gameRooms.get(roomCode)
  if (gameState) {
    const player = gameState.players.find((p) => p.id === playerId)
    if (player) {
      player.isOnline = false
    }

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
  console.log(`👋 ${playerName} ha lasciato: ${roomCode}`)
}

function broadcastToRoom(roomCode, message, excludePlayerId = null) {
  const gameState = gameRooms.get(roomCode)
  if (!gameState) return

  gameState.players.forEach((player) => {
    if (player.id !== excludePlayerId && player.isOnline) {
      const ws = playerConnections.get(player.id)
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message))
        } catch (error) {
          console.error(`Errore invio a ${player.name}:`, error)
        }
      }
    }
  })
}

function cleanupPlayerConnection(ws) {
  for (const [playerId, connection] of playerConnections.entries()) {
    if (connection === ws) {
      playerConnections.delete(playerId)
      break
    }
  }
}

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"))
})

app.get("/cristo", (req, res) => {
  res.sendFile(path.join(__dirname, "cristo.html"))
})

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    rooms: gameRooms.size,
    connections: playerConnections.size,
  })
})

// Start server
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT}`)
  console.log(`🌐 WebSocket server pronto!`)
})
