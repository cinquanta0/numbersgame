const WebSocket = require("ws")
const http = require("http")
const fs = require("fs")
const path = require("path")

// Crea server HTTP
const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    fs.readFile(path.join(__dirname, "index.html"), (err, data) => {
      if (err) {
        res.writeHead(404)
        res.end("File not found")
        return
      }
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(data)
    })
  } else {
    res.writeHead(404)
    res.end("Not found")
  }
})

// Crea WebSocket server
const wss = new WebSocket.Server({ server })

// Game state - SEMPLIFICATO
const rooms = new Map()
const players = new Map()

function generateRoomCode() {
  return "ROOM" + Math.random().toString(36).substr(2, 4).toUpperCase()
}

function generateSecretNumber() {
  return Math.floor(Math.random() * 100) + 1
}

function broadcastToRoom(roomCode, message) {
  const room = rooms.get(roomCode)
  if (!room) return

  console.log(`📡 Broadcasting to room ${roomCode}:`, message.type)

  room.players.forEach((player) => {
    const ws = players.get(player.id)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message))
        console.log(`✅ Sent to ${player.name}`)
      } catch (error) {
        console.error(`❌ Error sending to ${player.name}:`, error)
      }
    } else {
      console.log(`⚠️ Player ${player.name} not connected`)
    }
  })
}

// WebSocket connection handler
wss.on("connection", (ws) => {
  console.log("🔗 New WebSocket connection")

  ws.send(
    JSON.stringify({
      type: "connected",
      message: "Connected to server!",
    }),
  )

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data)
      console.log(`📨 Received: ${message.type}`, message)

      switch (message.type) {
        case "createRoom":
          {
            console.log(`🏠 Creating room for ${message.playerName}`)

            const roomCode = generateRoomCode()
            const room = {
              roomCode,
              players: [
                {
                  id: message.playerId,
                  name: message.playerName,
                  score: 0,
                  isHost: true,
                },
              ],
              gameStarted: false,
              secretNumber: null,
              chat: [
                {
                  playerName: "Sistema",
                  message: `🚀 Stanza ${roomCode} creata!`,
                  timestamp: Date.now(),
                },
              ],
              currentRound: 0,
              currentPlayerIndex: 0,
              maxAttempts: 3,
              currentAttempts: 0,
              turnTimeLimit: 30,
            }

            rooms.set(roomCode, room)
            players.set(message.playerId, ws)

            console.log(`✅ Room ${roomCode} created`)

            ws.send(
              JSON.stringify({
                type: "roomCreated",
                gameData: room,
              }),
            )
          }
          break

        case "joinRoom":
          {
            console.log(`🚪 ${message.playerName} joining ${message.roomCode}`)

            const room = rooms.get(message.roomCode)
            if (!room) {
              console.log(`❌ Room ${message.roomCode} not found`)
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Stanza non trovata!",
                }),
              )
              break
            }

            // Check if player already exists
            const existingPlayer = room.players.find((p) => p.id === message.playerId)
            if (!existingPlayer) {
              room.players.push({
                id: message.playerId,
                name: message.playerName,
                score: 0,
                isHost: false,
              })

              room.chat.push({
                playerName: "Sistema",
                message: `🚀 ${message.playerName} si è unito!`,
                timestamp: Date.now(),
              })
            }

            players.set(message.playerId, ws)

            console.log(`✅ ${message.playerName} joined room ${message.roomCode}`)

            // Send to joiner
            ws.send(
              JSON.stringify({
                type: "roomJoined",
                gameData: room,
              }),
            )

            // Broadcast to all
            broadcastToRoom(message.roomCode, {
              type: "gameUpdate",
              gameData: room,
            })
          }
          break

        case "startGame":
          {
            console.log(`🎮 Start game request for room ${message.roomCode}`)

            const room = rooms.get(message.roomCode)
            if (!room) {
              console.log(`❌ Room not found: ${message.roomCode}`)
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Stanza non trovata!",
                }),
              )
              break
            }

            console.log(`📊 Room state: players=${room.players.length}, started=${room.gameStarted}`)

            const player = room.players.find((p) => p.id === message.playerId)
            if (!player) {
              console.log(`❌ Player not found: ${message.playerId}`)
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Giocatore non trovato!",
                }),
              )
              break
            }

            if (!player.isHost) {
              console.log(`❌ Player ${player.name} is not host`)
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Solo l'host può iniziare!",
                }),
              )
              break
            }

            if (room.players.length < 2) {
              console.log(`❌ Not enough players: ${room.players.length}`)
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Servono almeno 2 giocatori!",
                }),
              )
              break
            }

            if (room.gameStarted) {
              console.log(`⚠️ Game already started`)
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Gioco già iniziato!",
                }),
              )
              break
            }

            // START THE GAME!
            console.log(`🚀 Starting game for room ${message.roomCode}`)

            room.gameStarted = true
            room.secretNumber = generateSecretNumber()
            room.currentRound = 1
            room.currentPlayerIndex = 0
            room.currentAttempts = 0

            room.chat.push({
              playerName: "Sistema",
              message: `🎯 Battaglia iniziata! Indovinate il numero (1-100)`,
              timestamp: Date.now(),
            })

            room.chat.push({
              playerName: "Sistema",
              message: `🎮 È il turno di ${room.players[0].name}!`,
              timestamp: Date.now(),
            })

            console.log(`✅ Game started! Secret number: ${room.secretNumber}`)

            // Broadcast to all players
            broadcastToRoom(message.roomCode, {
              type: "gameUpdate",
              gameData: room,
            })

            console.log(`📡 Game start broadcasted to all players`)
          }
          break

        case "guess":
          {
            console.log(`🎯 Guess from ${message.playerName}: ${message.guess}`)

            const room = rooms.get(message.roomCode)
            if (!room || !room.gameStarted) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Gioco non attivo!",
                }),
              )
              break
            }

            const currentPlayer = room.players[room.currentPlayerIndex]
            if (!currentPlayer || currentPlayer.id !== message.playerId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `❌ Non è il tuo turno! È il turno di ${currentPlayer?.name || "qualcuno"}`,
                }),
              )
              break
            }

            if (room.currentAttempts >= room.maxAttempts) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Hai esaurito i tentativi!",
                }),
              )
              break
            }

            room.currentAttempts++
            const guess = Number.parseInt(message.guess)
            let hint = ""
            let correct = false

            if (guess === room.secretNumber) {
              correct = true
              hint = "🎉 CORRETTO!"

              // Add points
              currentPlayer.score += 10

              room.chat.push({
                playerName: "Sistema",
                message: `🏆 ${message.playerName} ha indovinato ${guess}! +10 punti`,
                timestamp: Date.now(),
              })

              // New round
              setTimeout(() => {
                room.secretNumber = generateSecretNumber()
                room.currentRound++
                room.currentPlayerIndex = 0
                room.currentAttempts = 0

                room.chat.push({
                  playerName: "Sistema",
                  message: `🔄 Round ${room.currentRound}! Nuovo numero generato`,
                  timestamp: Date.now(),
                })

                broadcastToRoom(message.roomCode, {
                  type: "gameUpdate",
                  gameData: room,
                })
              }, 2000)
            } else if (guess < room.secretNumber) {
              hint = "📈 Troppo basso!"
              room.chat.push({
                playerName: "Sistema",
                message: `${message.playerName}: ${guess} - Troppo basso!`,
                timestamp: Date.now(),
              })
            } else {
              hint = "📉 Troppo alto!"
              room.chat.push({
                playerName: "Sistema",
                message: `${message.playerName}: ${guess} - Troppo alto!`,
                timestamp: Date.now(),
              })
            }

            // Send result to guesser
            ws.send(
              JSON.stringify({
                type: "guessResult",
                result: { hint, correct, attemptsLeft: room.maxAttempts - room.currentAttempts },
              }),
            )

            // Next turn if attempts exhausted and not correct
            if (room.currentAttempts >= room.maxAttempts && !correct) {
              room.chat.push({
                playerName: "Sistema",
                message: `❌ ${message.playerName} ha esaurito i tentativi!`,
                timestamp: Date.now(),
              })

              setTimeout(() => {
                room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length
                room.currentAttempts = 0

                room.chat.push({
                  playerName: "Sistema",
                  message: `🎯 È il turno di ${room.players[room.currentPlayerIndex].name}!`,
                  timestamp: Date.now(),
                })

                broadcastToRoom(message.roomCode, {
                  type: "gameUpdate",
                  gameData: room,
                })
              }, 1500)
            }

            // Broadcast update
            broadcastToRoom(message.roomCode, {
              type: "gameUpdate",
              gameData: room,
            })
          }
          break

        case "chat":
          {
            const room = rooms.get(message.roomCode)
            if (room) {
              room.chat.push({
                playerName: message.playerName,
                message: message.message,
                timestamp: Date.now(),
              })

              broadcastToRoom(message.roomCode, {
                type: "gameUpdate",
                gameData: room,
              })
            }
          }
          break

        case "ping":
          ws.send(JSON.stringify({ type: "pong" }))
          break

        default:
          console.log(`❓ Unknown message type: ${message.type}`)
      }
    } catch (error) {
      console.error("❌ Error processing message:", error)
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Server error: " + error.message,
        }),
      )
    }
  })

  ws.on("close", () => {
    console.log("🔌 Connection closed")

    // Cleanup
    for (const [playerId, playerWs] of players.entries()) {
      if (playerWs === ws) {
        players.delete(playerId)

        // Remove from rooms
        for (const [roomCode, room] of rooms.entries()) {
          const playerIndex = room.players.findIndex((p) => p.id === playerId)
          if (playerIndex !== -1) {
            const player = room.players[playerIndex]
            room.players.splice(playerIndex, 1)

            if (room.players.length === 0) {
              rooms.delete(roomCode)
              console.log(`🗑️ Room ${roomCode} deleted (empty)`)
            } else {
              if (player.isHost && room.players.length > 0) {
                room.players[0].isHost = true
              }

              broadcastToRoom(roomCode, {
                type: "gameUpdate",
                gameData: room,
              })
            }
            break
          }
        }
        break
      }
    }
  })

  ws.on("error", (error) => {
    console.error("❌ WebSocket error:", error)
  })
})

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || "0.0.0.0"

server.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`)
  console.log(`🌐 Open http://localhost:${PORT} to play`)
})
