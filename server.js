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

console.log("🚀 Avvio server WebSocket...")

// Simple in-memory storage
const rooms = new Map()
const connections = new Map()

// WebSocket connection handling
wss.on("connection", (ws) => {
  console.log("✅ Client connesso")

  // Send immediate confirmation
  ws.send(JSON.stringify({ type: "connected" }))

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message)
      console.log("📨 Messaggio ricevuto:", data.type)

      switch (data.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong" }))
          break

        case "createRoom":
          const roomCode = "ROOM" + Math.random().toString(36).substr(2, 6).toUpperCase()
          const gameData = {
            roomCode,
            players: [
              {
                id: data.playerId,
                name: data.playerName,
                score: 0,
                isHost: true,
              },
            ],
            gameStarted: false,
            level: 1,
            targetNumber: Math.floor(Math.random() * 100) + 1,
            maxAttempts: 10,
            chat: [
              {
                id: Date.now(),
                playerName: "Sistema",
                message: `Stanza ${roomCode} creata!`,
                isSystem: true,
              },
            ],
          }

          rooms.set(roomCode, gameData)
          connections.set(data.playerId, ws)

          ws.send(
            JSON.stringify({
              type: "roomCreated",
              roomCode,
              gameData,
            }),
          )
          break

        case "joinRoom":
          const room = rooms.get(data.roomCode)
          if (room) {
            room.players.push({
              id: data.playerId,
              name: data.playerName,
              score: 0,
              isHost: false,
            })

            connections.set(data.playerId, ws)
            rooms.set(data.roomCode, room)

            // Notify all players
            room.players.forEach((player) => {
              const playerWs = connections.get(player.id)
              if (playerWs) {
                playerWs.send(
                  JSON.stringify({
                    type: "gameUpdate",
                    gameData: room,
                  }),
                )
              }
            })
          } else {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Stanza non trovata!",
              }),
            )
          }
          break

        case "startGame":
          const gameRoom = rooms.get(data.roomCode)
          if (gameRoom) {
            gameRoom.gameStarted = true
            rooms.set(data.roomCode, gameRoom)

            // Notify all players
            gameRoom.players.forEach((player) => {
              const playerWs = connections.get(player.id)
              if (playerWs) {
                playerWs.send(
                  JSON.stringify({
                    type: "gameUpdate",
                    gameData: gameRoom,
                  }),
                )
              }
            })
          }
          break

        case "guess":
          const guessRoom = rooms.get(data.roomCode)
          if (guessRoom) {
            let result = ""
            if (data.guess === guessRoom.targetNumber) {
              result = "🎉 CORRETTO!"
              // Add points to player
              const player = guessRoom.players.find((p) => p.id === data.playerId)
              if (player) player.score += 100
            } else if (data.guess < guessRoom.targetNumber) {
              result = "📈 Troppo basso!"
            } else {
              result = "📉 Troppo alto!"
            }

            // Add to chat
            guessRoom.chat.push({
              id: Date.now(),
              playerName: data.playerName,
              message: `Tentativo: ${data.guess} - ${result}`,
              isSystem: false,
            })

            rooms.set(data.roomCode, guessRoom)

            // Notify all players
            guessRoom.players.forEach((player) => {
              const playerWs = connections.get(player.id)
              if (playerWs) {
                playerWs.send(
                  JSON.stringify({
                    type: "gameUpdate",
                    gameData: guessRoom,
                  }),
                )
              }
            })
          }
          break

        case "chat":
          const chatRoom = rooms.get(data.roomCode)
          if (chatRoom) {
            chatRoom.chat.push({
              id: Date.now(),
              playerName: data.playerName,
              message: data.message,
              isSystem: false,
            })

            rooms.set(data.roomCode, chatRoom)

            // Notify all players
            chatRoom.players.forEach((player) => {
              const playerWs = connections.get(player.id)
              if (playerWs) {
                playerWs.send(
                  JSON.stringify({
                    type: "gameUpdate",
                    gameData: chatRoom,
                  }),
                )
              }
            })
          }
          break

        default:
          console.log("Tipo messaggio sconosciuto:", data.type)
      }
    } catch (error) {
      console.error("❌ Errore parsing messaggio:", error)
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Errore del server",
        }),
      )
    }
  })

  ws.on("close", () => {
    console.log("🔌 Client disconnesso")
    // Remove from connections
    for (const [playerId, connection] of connections.entries()) {
      if (connection === ws) {
        connections.delete(playerId)
        break
      }
    }
  })

  ws.on("error", (error) => {
    console.error("❌ Errore WebSocket:", error)
  })
})

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"))
})

app.get("/cristo", (req, res) => {
  res.sendFile(path.join(__dirname, "cristo.html"))
})

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    rooms: rooms.size,
    connections: connections.size,
  })
})

// Start server
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT}`)
  console.log(`🌐 Apri: http://localhost:${PORT}`)
})
