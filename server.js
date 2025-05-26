const WebSocket = require("ws")
const http = require("http")
const fs = require("fs")
const path = require("path")

// Crea server HTTP
const server = http.createServer((req, res) => {
  // Gestisci sia cristo.html che index.html
  if (req.url === "/" || req.url === "/cristo.html") {
    fs.readFile(path.join(__dirname, "cristo.html"), (err, data) => {
      if (err) {
        res.writeHead(404)
        res.end("File not found")
        return
      }
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(data)
    })
  } else if (req.url === "/index.html") {
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

// Game state
const rooms = new Map()
const players = new Map()

// Configurazioni difficoltà EPICHE! 🚀
const DIFFICULTY_CONFIGS = {
  easy: {
    name: "🌟 Principiante",
    maxNumber: 50,
    maxAttempts: 5,
    turnTimeLimit: 45,
    pointsBase: 5,
    pointsBonus: 3,
    levelsToWin: 10,
    levelMultiplier: 5, // Aumenta range di 5 per livello
  },
  normal: {
    name: "⚡ Guerriero",
    maxNumber: 100,
    maxAttempts: 3,
    turnTimeLimit: 30,
    pointsBase: 10,
    pointsBonus: 5,
    levelsToWin: 10,
    levelMultiplier: 10,
  },
  hard: {
    name: "🔥 Comandante",
    maxNumber: 200,
    maxAttempts: 2,
    turnTimeLimit: 20,
    pointsBase: 15,
    pointsBonus: 8,
    levelsToWin: 10,
    levelMultiplier: 20,
  },
  expert: {
    name: "💀 Leggenda",
    maxNumber: 500,
    maxAttempts: 1,
    turnTimeLimit: 15,
    pointsBase: 25,
    pointsBonus: 15,
    levelsToWin: 10,
    levelMultiplier: 50,
  },
}

function generateRoomCode() {
  return "ROOM" + Math.random().toString(36).substr(2, 4).toUpperCase()
}

function generateSecretNumber(maxNumber) {
  return Math.floor(Math.random() * maxNumber) + 1
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
      } catch (error) {
        console.error(`❌ Error sending to ${player.name}:`, error)
      }
    }
  })
}

function checkLevelComplete(room) {
  // Controlla se qualcuno ha raggiunto il punteggio per il prossimo livello
  const config = room.config
  const pointsNeeded = room.currentLevel * 100 // 100 punti per livello

  const levelWinner = room.players.find((player) => player.score >= pointsNeeded)

  if (levelWinner && room.currentLevel < config.levelsToWin) {
    room.currentLevel++

    // Aumenta difficoltà per il nuovo livello
    const newMaxNumber = config.maxNumber + (room.currentLevel - 1) * config.levelMultiplier
    room.secretNumber = generateSecretNumber(newMaxNumber)
    room.currentPlayerIndex = 0
    room.currentAttempts = 0
    room.currentRound = 1

    room.chat.push({
      playerName: "Sistema",
      message: `🎉 ${levelWinner.name} ha completato il livello ${room.currentLevel - 1}!`,
      timestamp: Date.now(),
    })

    room.chat.push({
      playerName: "Sistema",
      message: `🆙 LIVELLO ${room.currentLevel}! Nuovo numero segreto (1-${newMaxNumber})`,
      timestamp: Date.now(),
    })

    room.chat.push({
      playerName: "Sistema",
      message: `🎯 È il turno di ${room.players[0].name}! Difficoltà aumentata!`,
      timestamp: Date.now(),
    })

    return true
  }

  // Controlla vittoria finale
  if (room.currentLevel >= config.levelsToWin) {
    const winner = room.players.reduce((prev, current) => (prev.score > current.score ? prev : current))

    room.gameEnded = true
    room.winner = winner

    room.chat.push({
      playerName: "Sistema",
      message: `🏆 VITTORIA EPICA! ${winner.name} è il COMANDANTE SUPREMO GALATTICO!`,
      timestamp: Date.now(),
    })

    room.chat.push({
      playerName: "Sistema",
      message: `👑 Punteggio finale: ${winner.score} punti! Una leggenda è nata!`,
      timestamp: Date.now(),
    })

    return true
  }

  return false
}

function getCurrentMaxNumber(room) {
  return room.config.maxNumber + (room.currentLevel - 1) * room.config.levelMultiplier
}

// WebSocket connection handler
wss.on("connection", (ws) => {
  console.log("🔗 New WebSocket connection")

  ws.send(
    JSON.stringify({
      type: "connected",
      message: "Connected to Galactic Server!",
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
            const difficulty = message.difficulty || "normal"
            const config = DIFFICULTY_CONFIGS[difficulty]

            const room = {
              roomCode,
              difficulty,
              config,
              players: [
                {
                  id: message.playerId,
                  name: message.playerName,
                  score: 0,
                  isHost: true,
                },
              ],
              gameStarted: false,
              gameEnded: false,
              winner: null,
              secretNumber: null,
              chat: [
                {
                  playerName: "Sistema",
                  message: `🚀 Stazione Galattica ${roomCode} creata in modalità ${config.name}!`,
                  timestamp: Date.now(),
                },
                {
                  playerName: "Sistema",
                  message: `⚔️ Preparatevi per 10 livelli di battaglia epica!`,
                  timestamp: Date.now(),
                },
              ],
              currentLevel: 1,
              currentRound: 0,
              currentPlayerIndex: 0,
              maxAttempts: config.maxAttempts,
              currentAttempts: 0,
              turnTimeLimit: config.turnTimeLimit,
            }

            rooms.set(roomCode, room)
            players.set(message.playerId, ws)

            console.log(`✅ Room ${roomCode} created with difficulty ${difficulty}`)

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
                  message: "❌ Stazione Galattica non trovata!",
                }),
              )
              break
            }

            if (room.gameStarted) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Battaglia già in corso! Aspetta la prossima!",
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
                message: `🚀 Comandante ${message.playerName} si è unito alla battaglia ${room.config.name}!`,
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
                  message: "❌ Stazione non trovata!",
                }),
              )
              break
            }

            const player = room.players.find((p) => p.id === message.playerId)
            if (!player || !player.isHost) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Solo il comandante principale può iniziare!",
                }),
              )
              break
            }

            if (room.players.length < 2) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Servono almeno 2 comandanti per la battaglia!",
                }),
              )
              break
            }

            if (room.gameStarted) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Battaglia già in corso!",
                }),
              )
              break
            }

            // START THE EPIC BATTLE! 🚀
            console.log(`🚀 Starting EPIC battle for room ${message.roomCode}`)

            room.gameStarted = true
            room.secretNumber = generateSecretNumber(room.config.maxNumber)
            room.currentLevel = 1
            room.currentRound = 1
            room.currentPlayerIndex = 0
            room.currentAttempts = 0

            room.chat.push({
              playerName: "Sistema",
              message: `⚔️ BATTAGLIA GALATTICA ${room.config.name.toUpperCase()} INIZIATA!`,
              timestamp: Date.now(),
            })

            room.chat.push({
              playerName: "Sistema",
              message: `🎯 LIVELLO 1 - Indovinate il numero segreto (1-${room.config.maxNumber})`,
              timestamp: Date.now(),
            })

            room.chat.push({
              playerName: "Sistema",
              message: `🎮 È il turno del comandante ${room.players[0].name}! (${room.config.maxAttempts} tentativi, ${room.config.turnTimeLimit}s)`,
              timestamp: Date.now(),
            })

            console.log(`✅ Epic battle started! Secret number: ${room.secretNumber}`)

            // Broadcast to all players
            broadcastToRoom(message.roomCode, {
              type: "gameUpdate",
              gameData: room,
            })
          }
          break

        case "guess":
          {
            console.log(`🎯 Guess from ${message.playerName}: ${message.guess}`)

            const room = rooms.get(message.roomCode)
            if (!room || !room.gameStarted || room.gameEnded) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Battaglia non attiva!",
                }),
              )
              break
            }

            const currentPlayer = room.players[room.currentPlayerIndex]
            if (!currentPlayer || currentPlayer.id !== message.playerId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `❌ Non è il tuo turno! È il turno del comandante ${currentPlayer?.name || "sconosciuto"}`,
                }),
              )
              break
            }

            if (room.currentAttempts >= room.config.maxAttempts) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Hai esaurito i tuoi tentativi!",
                }),
              )
              break
            }

            room.currentAttempts++
            const guess = Number.parseInt(message.guess)
            const currentMaxNumber = getCurrentMaxNumber(room)
            let hint = ""
            let correct = false

            if (guess === room.secretNumber) {
              correct = true
              hint = "🎉 VITTORIA GALATTICA!"

              // Calcola punti con bonus epici
              const speedBonus = (room.config.maxAttempts - room.currentAttempts + 1) * room.config.pointsBonus
              const levelBonus = room.currentLevel * 10
              const totalPoints = room.config.pointsBase + speedBonus + levelBonus
              currentPlayer.score += totalPoints

              room.chat.push({
                playerName: "Sistema",
                message: `🏆 EPICO! ${message.playerName} ha indovinato ${guess}! +${totalPoints} punti (Livello ${room.currentLevel})`,
                timestamp: Date.now(),
              })

              // Controlla se il livello è completato
              setTimeout(() => {
                const levelChanged = checkLevelComplete(room)

                if (!room.gameEnded) {
                  if (levelChanged) {
                    // Nuovo livello - ricomincia dal primo giocatore
                    room.chat.push({
                      playerName: "Sistema",
                      message: `🎮 È il turno del comandante ${room.players[0].name}! Nuova sfida!`,
                      timestamp: Date.now(),
                    })
                  } else {
                    // Nuovo round stesso livello
                    room.secretNumber = generateSecretNumber(currentMaxNumber)
                    room.currentRound++
                    room.currentPlayerIndex = 0
                    room.currentAttempts = 0

                    room.chat.push({
                      playerName: "Sistema",
                      message: `🔄 Round ${room.currentRound} - Livello ${room.currentLevel}! Nuovo numero generato!`,
                      timestamp: Date.now(),
                    })

                    room.chat.push({
                      playerName: "Sistema",
                      message: `🎯 È il turno del comandante ${room.players[0].name}!`,
                      timestamp: Date.now(),
                    })
                  }
                }

                broadcastToRoom(message.roomCode, {
                  type: "gameUpdate",
                  gameData: room,
                })
              }, 3000)
            } else if (guess < room.secretNumber) {
              hint = "📈 Troppo basso, comandante!"
              room.chat.push({
                playerName: "Sistema",
                message: `${message.playerName}: ${guess} - Troppo basso! 📈 (${room.config.maxAttempts - room.currentAttempts} tentativi rimasti)`,
                timestamp: Date.now(),
              })
            } else {
              hint = "📉 Troppo alto, comandante!"
              room.chat.push({
                playerName: "Sistema",
                message: `${message.playerName}: ${guess} - Troppo alto! 📉 (${room.config.maxAttempts - room.currentAttempts} tentativi rimasti)`,
                timestamp: Date.now(),
              })
            }

            // Send result to guesser
            ws.send(
              JSON.stringify({
                type: "guessResult",
                result: { hint, correct, attemptsLeft: room.config.maxAttempts - room.currentAttempts },
              }),
            )

            // Next turn if attempts exhausted and not correct
            if (room.currentAttempts >= room.config.maxAttempts && !correct) {
              room.chat.push({
                playerName: "Sistema",
                message: `❌ Il comandante ${message.playerName} ha esaurito i tentativi!`,
                timestamp: Date.now(),
              })

              setTimeout(() => {
                room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length
                room.currentAttempts = 0

                room.chat.push({
                  playerName: "Sistema",
                  message: `🎯 È il turno del comandante ${room.players[room.currentPlayerIndex].name}!`,
                  timestamp: Date.now(),
                })

                broadcastToRoom(message.roomCode, {
                  type: "gameUpdate",
                  gameData: room,
                })
              }, 2000)
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

              // Keep only last 50 messages
              if (room.chat.length > 50) {
                room.chat = room.chat.slice(-50)
              }

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
          message: "Errore del server: " + error.message,
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

            room.chat.push({
              playerName: "Sistema",
              message: `👋 Il comandante ${player.name} ha abbandonato la stazione`,
              timestamp: Date.now(),
            })

            if (room.players.length === 0) {
              rooms.delete(roomCode)
              console.log(`🗑️ Room ${roomCode} deleted (empty)`)
            } else {
              if (player.isHost && room.players.length > 0) {
                room.players[0].isHost = true
                room.chat.push({
                  playerName: "Sistema",
                  message: `👑 ${room.players[0].name} è ora il nuovo comandante principale`,
                  timestamp: Date.now(),
                })
              }

              if (room.gameStarted && room.players.length === 1) {
                room.gameStarted = false
                room.gameEnded = true
                room.chat.push({
                  playerName: "Sistema",
                  message: `⏸️ Battaglia sospesa - Serve almeno 2 comandanti`,
                  timestamp: Date.now(),
                })
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

// Cleanup periodico delle stanze vuote
setInterval(() => {
  for (const [roomCode, room] of rooms.entries()) {
    if (room.players.length === 0) {
      rooms.delete(roomCode)
      console.log(`🧹 Pulizia stanza vuota: ${roomCode}`)
    }
  }
}, 300000) // Ogni 5 minuti

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || "0.0.0.0"

server.listen(PORT, HOST, () => {
  console.log(`🚀 Galactic Server running on ${HOST}:${PORT}`)
  console.log(`🌐 Open http://localhost:${PORT}/cristo.html for home`)
  console.log(`🎮 Open http://localhost:${PORT}/index.html for multiplayer`)
})
