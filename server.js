const WebSocket = require("ws")
const http = require("http")
const fs = require("fs")
const path = require("path")

// Crea server HTTP con routing corretto
const server = http.createServer((req, res) => {
  console.log(`📡 Request: ${req.url}`)

  // Gestisci routing
  if (req.url === "/" || req.url === "/cristo.html") {
    // Serve la home page
    fs.readFile(path.join(__dirname, "cristo.html"), (err, data) => {
      if (err) {
        console.error("❌ Error reading cristo.html:", err)
        res.writeHead(404, { "Content-Type": "text/html" })
        res.end("<h1>404 - cristo.html not found</h1>")
        return
      }
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(data)
    })
  } else if (req.url === "/index.html" || req.url === "/multiplayer") {
    // Serve la pagina multiplayer
    fs.readFile(path.join(__dirname, "index.html"), (err, data) => {
      if (err) {
        console.error("❌ Error reading index.html:", err)
        res.writeHead(404, { "Content-Type": "text/html" })
        res.end("<h1>404 - index.html not found</h1>")
        return
      }
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(data)
    })
  } else {
    // 404 per tutto il resto
    console.log(`❌ 404 for: ${req.url}`)
    res.writeHead(404, { "Content-Type": "text/html" })
    res.end(`
      <h1>404 - Not Found</h1>
      <p>Available routes:</p>
      <ul>
        <li><a href="/cristo.html">Home (cristo.html)</a></li>
        <li><a href="/index.html">Multiplayer (index.html)</a></li>
      </ul>
    `)
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
    levelMultiplier: 5,
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
  const config = room.config
  const pointsNeeded = room.currentLevel * 100

  const levelWinner = room.players.find((player) => player.score >= pointsNeeded)

  if (levelWinner && room.currentLevel < config.levelsToWin) {
    room.currentLevel++
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

    return true
  }

  if (room.currentLevel >= config.levelsToWin) {
    const winner = room.players.reduce((prev, current) => (prev.score > current.score ? prev : current))
    room.gameEnded = true
    room.winner = winner

    room.chat.push({
      playerName: "Sistema",
      message: `🏆 VITTORIA EPICA! ${winner.name} è il COMANDANTE SUPREMO GALATTICO!`,
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
      console.log(`📨 Received: ${message.type}`)

      switch (message.type) {
        case "createRoom": {
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
                message: `🚀 Stazione ${roomCode} creata in modalità ${config.name}!`,
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

          ws.send(
            JSON.stringify({
              type: "roomCreated",
              gameData: room,
            }),
          )
          break
        }

        case "joinRoom": {
          const room = rooms.get(message.roomCode)
          if (!room) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "❌ Stazione non trovata!",
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
              message: `🚀 ${message.playerName} si è unito alla battaglia!`,
              timestamp: Date.now(),
            })
          }

          players.set(message.playerId, ws)

          ws.send(
            JSON.stringify({
              type: "roomJoined",
              gameData: room,
            }),
          )

          broadcastToRoom(message.roomCode, {
            type: "gameUpdate",
            gameData: room,
          })
          break
        }

        case "startGame": {
          const room = rooms.get(message.roomCode)
          if (!room) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "❌ Stanza non trovata!",
              }),
            )
            break
          }

          const player = room.players.find((p) => p.id === message.playerId)
          if (!player || !player.isHost) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "❌ Solo l'host può iniziare!",
              }),
            )
            break
          }

          if (room.players.length < 2) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "❌ Servono almeno 2 comandanti!",
              }),
            )
            break
          }

          room.gameStarted = true
          room.secretNumber = generateSecretNumber(room.config.maxNumber)
          room.currentLevel = 1
          room.currentRound = 1
          room.currentPlayerIndex = 0
          room.currentAttempts = 0

          room.chat.push({
            playerName: "Sistema",
            message: `⚔️ BATTAGLIA ${room.config.name.toUpperCase()} INIZIATA!`,
            timestamp: Date.now(),
          })

          broadcastToRoom(message.roomCode, {
            type: "gameUpdate",
            gameData: room,
          })
          break
        }

        case "guess": {
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
                message: `❌ Non è il tuo turno!`,
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
            hint = "🎉 VITTORIA GALATTICA!"

            const speedBonus = (room.config.maxAttempts - room.currentAttempts + 1) * room.config.pointsBonus
            const levelBonus = room.currentLevel * 10
            const totalPoints = room.config.pointsBase + speedBonus + levelBonus
            currentPlayer.score += totalPoints

            room.chat.push({
              playerName: "Sistema",
              message: `🏆 ${message.playerName} ha indovinato! +${totalPoints} punti`,
              timestamp: Date.now(),
            })

            setTimeout(() => {
              const levelChanged = checkLevelComplete(room)
              if (!room.gameEnded) {
                room.secretNumber = generateSecretNumber(getCurrentMaxNumber(room))
                room.currentRound++
                room.currentPlayerIndex = 0
                room.currentAttempts = 0
              }

              broadcastToRoom(message.roomCode, {
                type: "gameUpdate",
                gameData: room,
              })
            }, 2000)
          } else if (guess < room.secretNumber) {
            hint = "📈 Troppo basso!"
          } else {
            hint = "📉 Troppo alto!"
          }

          ws.send(
            JSON.stringify({
              type: "guessResult",
              result: { hint, correct },
            }),
          )

          if (room.currentAttempts >= room.config.maxAttempts && !correct) {
            setTimeout(() => {
              room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length
              room.currentAttempts = 0

              broadcastToRoom(message.roomCode, {
                type: "gameUpdate",
                gameData: room,
              })
            }, 1500)
          }

          broadcastToRoom(message.roomCode, {
            type: "gameUpdate",
            gameData: room,
          })
          break
        }

        case "chat": {
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
          break
        }

        case "ping":
          ws.send(JSON.stringify({ type: "pong" }))
          break
      }
    } catch (error) {
      console.error("❌ Error processing message:", error)
    }
  })

  ws.on("close", () => {
    console.log("🔌 Connection closed")
    // Cleanup logic here
  })
})

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || "0.0.0.0"

server.listen(PORT, HOST, () => {
  console.log(`🚀 Galactic Server running on ${HOST}:${PORT}`)
  console.log(`🏠 Home: http://localhost:${PORT}/cristo.html`)
  console.log(`🎮 Multiplayer: http://localhost:${PORT}/index.html`)
})
