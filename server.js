const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const path = require("path")

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

const PORT = process.env.PORT || 3000

// Serve static files
app.use(express.static(path.join(__dirname)))

// Routes
app.get("/", (req, res) => {
  console.log("📱 Serving home page (cristo.html)")
  res.sendFile(path.join(__dirname, "cristo.html"))
})

app.get("/multiplayer", (req, res) => {
  console.log("🎮 Serving multiplayer arena (index.html)")
  res.sendFile(path.join(__dirname, "index.html"))
})

// Fallback per altre route
app.get("*", (req, res) => {
  console.log(`❓ Unknown route: ${req.path}, redirecting to home`)
  res.redirect("/")
})

// Game state
const rooms = new Map()

// Difficulty configurations
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

function generateRoomCode() {
  return "ROOM" + Math.random().toString(36).substr(2, 6).toUpperCase()
}

function generateTargetNumber(config, level) {
  const maxNum = config.maxNumber + (level - 1) * config.levelMultiplier
  return Math.floor(Math.random() * maxNum) + 1
}

function calculateScore(attempts, timeLeft, level, config) {
  const baseScore = 100
  const attemptsBonus = (config.maxAttempts - attempts) * 20
  const timeBonus = Math.floor(timeLeft * 2)
  const levelBonus = level * 50

  return Math.max(0, baseScore + attemptsBonus + timeBonus + levelBonus)
}

function broadcastToRoom(roomCode, message) {
  const room = rooms.get(roomCode)
  if (!room) return

  room.players.forEach((player) => {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      try {
        player.ws.send(JSON.stringify(message))
      } catch (error) {
        console.error(`❌ Error sending to player ${player.id}:`, error)
      }
    }
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

  // Keep only last 50 messages
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

  // Find winner (highest score)
  const winner = room.players.reduce((prev, current) => (prev.score > current.score ? prev : current))

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

// WebSocket connection handling
wss.on("connection", (ws) => {
  console.log("🔗 New WebSocket connection")

  ws.send(JSON.stringify({ type: "connected" }))

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message)
      console.log(`📨 Received: ${data.type} from ${data.playerId || "unknown"}`)

      switch (data.type) {
        case "createRoom":
          const roomCode = generateRoomCode()
          const difficulty = data.difficulty || "normal"
          const config = difficultyConfigs[difficulty]

          const room = {
            roomCode,
            config,
            players: [
              {
                id: data.playerId,
                name: data.playerName,
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

          ws.send(
            JSON.stringify({
              type: "roomCreated",
              gameData: room,
            }),
          )

          console.log(`🏠 Room ${roomCode} created by ${data.playerName}`)
          break

        case "joinRoom":
          const targetRoom = rooms.get(data.roomCode)
          if (!targetRoom) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Stazione galattica non trovata!",
              }),
            )
            break
          }

          if (targetRoom.players.length >= 6) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Stazione galattica piena! (max 6 comandanti)",
              }),
            )
            break
          }

          if (targetRoom.gameStarted) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Battaglia già in corso!",
              }),
            )
            break
          }

          targetRoom.players.push({
            id: data.playerId,
            name: data.playerName,
            ws: ws,
            score: 0,
            isHost: false,
          })

          addChatMessage(data.roomCode, "Sistema", `👋 ${data.playerName} si è unito alla battaglia!`)

          ws.send(
            JSON.stringify({
              type: "roomJoined",
              gameData: targetRoom,
            }),
          )

          broadcastToRoom(data.roomCode, {
            type: "gameUpdate",
            gameData: targetRoom,
          })

          console.log(`🚪 ${data.playerName} joined room ${data.roomCode}`)
          break

        case "startGame":
          const gameRoom = rooms.get(data.roomCode)
          if (!gameRoom) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Stazione non trovata!",
              }),
            )
            break
          }

          const player = gameRoom.players.find((p) => p.id === data.playerId)
          if (!player || !player.isHost) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Solo il comandante principale può iniziare!",
              }),
            )
            break
          }

          if (gameRoom.players.length < 2) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Servono almeno 2 comandanti per iniziare!",
              }),
            )
            break
          }

          gameRoom.gameStarted = true
          gameRoom.currentRound = 1

          addChatMessage(data.roomCode, "Sistema", "🎯 BATTAGLIA GALATTICA INIZIATA! Che la forza sia con voi!")

          broadcastToRoom(data.roomCode, {
            type: "gameUpdate",
            gameData: gameRoom,
          })

          console.log(`🎮 Game started in room ${data.roomCode}`)
          break

        case "guess":
          const guessRoom = rooms.get(data.roomCode)
          if (!guessRoom || !guessRoom.gameStarted || guessRoom.gameEnded) {
            break
          }

          const currentPlayer = guessRoom.players[guessRoom.currentPlayerIndex]
          if (!currentPlayer || currentPlayer.id !== data.playerId) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Non è il tuo turno!",
              }),
            )
            break
          }

          guessRoom.currentAttempts++
          const guess = Number.parseInt(data.guess)
          const target = guessRoom.targetNumber

          const result = {
            correct: false,
            hint: "",
            guess: guess,
            target: target,
          }

          if (guess === target) {
            result.correct = true
            result.hint = "🎉 NUMERO CORRETTO! Avanzamento al livello successivo!"

            const timeLeft = guessRoom.config.timeLimit - 5 // Simulated time
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
              `💥 ${data.playerName} ha esaurito i tentativi! Il numero era ${target}`,
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

          ws.send(
            JSON.stringify({
              type: "guessResult",
              result: result,
            }),
          )

          broadcastToRoom(data.roomCode, {
            type: "gameUpdate",
            gameData: guessRoom,
          })

          break

        case "chat":
          const chatRoom = rooms.get(data.roomCode)
          if (chatRoom) {
            addChatMessage(data.roomCode, data.playerName, data.message)

            broadcastToRoom(data.roomCode, {
              type: "gameUpdate",
              gameData: chatRoom,
            })
          }
          break

        case "ping":
          ws.send(JSON.stringify({ type: "pong" }))
          break

        default:
          console.log(`❓ Unknown message type: ${data.type}`)
      }
    } catch (error) {
      console.error("❌ Error processing message:", error)
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Errore del server",
        }),
      )
    }
  })

  ws.on("close", () => {
    console.log("🔌 WebSocket connection closed")

    // Remove player from all rooms
    rooms.forEach((room, roomCode) => {
      const playerIndex = room.players.findIndex((p) => p.ws === ws)
      if (playerIndex > -1) {
        const player = room.players[playerIndex]
        room.players.splice(playerIndex, 1)

        addChatMessage(roomCode, "Sistema", `👋 ${player.name} ha abbandonato la battaglia`)

        // If room is empty, delete it
        if (room.players.length === 0) {
          rooms.delete(roomCode)
          console.log(`🗑️ Room ${roomCode} deleted (empty)`)
        } else {
          // If host left, make first player the new host
          if (player.isHost && room.players.length > 0) {
            room.players[0].isHost = true
            addChatMessage(roomCode, "Sistema", `👑 ${room.players[0].name} è ora il comandante principale`)
          }

          // Adjust current player index if needed
          if (room.currentPlayerIndex >= room.players.length) {
            room.currentPlayerIndex = 0
          }

          broadcastToRoom(roomCode, {
            type: "gameUpdate",
            gameData: room,
          })
        }
      }
    })
  })

  ws.on("error", (error) => {
    console.error("❌ WebSocket error:", error)
  })
})

// Cleanup empty rooms periodically
setInterval(() => {
  rooms.forEach((room, roomCode) => {
    if (room.players.length === 0) {
      rooms.delete(roomCode)
      console.log(`🧹 Cleaned up empty room: ${roomCode}`)
    }
  })
}, 300000) // Every 5 minutes

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`🏠 Home: http://localhost:${PORT}/`)
  console.log(`🎮 Multiplayer: http://localhost:${PORT}/multiplayer`)
  console.log(`📊 Active rooms: ${rooms.size}`)
})

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down gracefully")
  server.close(() => {
    console.log("✅ Server closed")
    process.exit(0)
  })
})
