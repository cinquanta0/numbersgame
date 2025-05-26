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

// Game state
const rooms = new Map()
const players = new Map()

// Utility functions
function generateRoomCode() {
  return "ROOM" + Math.random().toString(36).substr(2, 4).toUpperCase()
}

function generateSecretNumber() {
  return Math.floor(Math.random() * 100) + 1
}

function createRoom(playerId, playerName) {
  const roomCode = generateRoomCode()
  const room = {
    roomCode,
    players: [
      {
        id: playerId,
        name: playerName,
        score: 0,
        isHost: true,
      },
    ],
    gameStarted: false,
    secretNumber: null,
    chat: [],
    currentRound: 0,
    currentPlayerIndex: 0,
    turnTimeLimit: 30,
    turnStartTime: null,
    turnTimer: null,
    maxAttempts: 3,
    currentAttempts: 0,
  }

  rooms.set(roomCode, room)
  console.log(`✅ Stanza creata: ${roomCode}`)
  return room
}

function addPlayerToRoom(roomCode, playerId, playerName) {
  const room = rooms.get(roomCode)
  if (!room) return null

  // Controlla se il giocatore è già nella stanza
  const existingPlayer = room.players.find((p) => p.id === playerId)
  if (existingPlayer) {
    return room
  }

  // Aggiungi nuovo giocatore
  room.players.push({
    id: playerId,
    name: playerName,
    score: 0,
    isHost: false,
  })

  // Aggiungi messaggio di benvenuto alla chat
  room.chat.push({
    playerName: "Sistema",
    message: `🚀 ${playerName} si è unito alla battaglia!`,
    timestamp: Date.now(),
  })

  console.log(`✅ ${playerName} aggiunto alla stanza ${roomCode}`)
  return room
}

function broadcastToRoom(roomCode, message, excludePlayerId = null) {
  const room = rooms.get(roomCode)
  if (!room) return

  room.players.forEach((player) => {
    if (player.id !== excludePlayerId) {
      const ws = players.get(player.id)
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message))
        } catch (error) {
          console.error(`❌ Errore invio a ${player.name}:`, error)
        }
      }
    }
  })
}

function nextTurn(roomCode) {
  const room = rooms.get(roomCode)
  if (!room || !room.gameStarted || room.players.length === 0) return

  // Cancella il timer precedente
  if (room.turnTimer) {
    clearTimeout(room.turnTimer)
    room.turnTimer = null
  }

  // Passa al prossimo giocatore
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length
  room.currentAttempts = 0
  room.turnStartTime = Date.now()

  const currentPlayer = room.players[room.currentPlayerIndex]

  room.chat.push({
    playerName: "Sistema",
    message: `🎯 È il turno di ${currentPlayer.name}! (${room.turnTimeLimit}s, max ${room.maxAttempts} tentativi)`,
    timestamp: Date.now(),
  })

  // Imposta timer per il turno
  room.turnTimer = setTimeout(() => {
    const currentRoom = rooms.get(roomCode)
    if (currentRoom && currentRoom.gameStarted) {
      currentRoom.chat.push({
        playerName: "Sistema",
        message: `⏰ Tempo scaduto per ${currentPlayer.name}!`,
        timestamp: Date.now(),
      })

      nextTurn(roomCode)

      broadcastToRoom(roomCode, {
        type: "gameUpdate",
        gameData: currentRoom,
      })
    }
  }, room.turnTimeLimit * 1000)

  return currentPlayer
}

function startGame(roomCode) {
  const room = rooms.get(roomCode)
  if (!room) {
    console.log(`❌ Stanza ${roomCode} non trovata`)
    return { error: "Stanza non trovata" }
  }

  if (room.players.length < 2) {
    console.log(`❌ Non abbastanza giocatori: ${room.players.length}`)
    return { error: "Servono almeno 2 giocatori per iniziare!" }
  }

  if (room.gameStarted) {
    console.log(`⚠️ Gioco già iniziato`)
    return { error: "Il gioco è già iniziato!" }
  }

  console.log(`🚀 Avvio gioco per stanza ${roomCode}`)

  // Inizializza il gioco
  room.gameStarted = true
  room.secretNumber = generateSecretNumber()
  room.currentRound = 1
  room.currentPlayerIndex = 0
  room.currentAttempts = 0
  room.turnStartTime = Date.now()

  const currentPlayer = room.players[room.currentPlayerIndex]

  room.chat.push({
    playerName: "Sistema",
    message: `🎯 Battaglia iniziata! Numero segreto generato (1-100)`,
    timestamp: Date.now(),
  })

  room.chat.push({
    playerName: "Sistema",
    message: `🎮 È il turno di ${currentPlayer.name}! (${room.turnTimeLimit}s, max ${room.maxAttempts} tentativi)`,
    timestamp: Date.now(),
  })

  // Imposta timer per il primo turno
  room.turnTimer = setTimeout(() => {
    const currentRoom = rooms.get(roomCode)
    if (currentRoom && currentRoom.gameStarted) {
      currentRoom.chat.push({
        playerName: "Sistema",
        message: `⏰ Tempo scaduto per ${currentPlayer.name}!`,
        timestamp: Date.now(),
      })

      nextTurn(roomCode)

      broadcastToRoom(roomCode, {
        type: "gameUpdate",
        gameData: currentRoom,
      })
    }
  }, room.turnTimeLimit * 1000)

  console.log(`✅ Gioco avviato con successo`)
  return { success: true }
}

function handleGuess(roomCode, playerId, playerName, guess) {
  const room = rooms.get(roomCode)
  if (!room || !room.gameStarted) return null

  // Verifica se è il turno del giocatore
  const currentPlayer = room.players[room.currentPlayerIndex]
  if (!currentPlayer || currentPlayer.id !== playerId) {
    return {
      error: true,
      message: `❌ Non è il tuo turno! È il turno di ${currentPlayer ? currentPlayer.name : "qualcuno"}`,
    }
  }

  // Verifica se ha ancora tentativi
  if (room.currentAttempts >= room.maxAttempts) {
    return {
      error: true,
      message: `❌ Hai esaurito i tuoi ${room.maxAttempts} tentativi per questo turno!`,
    }
  }

  room.currentAttempts++

  const result = {
    playerId,
    playerName,
    guess,
    correct: false,
    hint: "",
    attemptsLeft: room.maxAttempts - room.currentAttempts,
  }

  if (guess === room.secretNumber) {
    result.correct = true
    result.hint = "🎉 CORRETTO!"

    // Cancella il timer del turno
    if (room.turnTimer) {
      clearTimeout(room.turnTimer)
      room.turnTimer = null
    }

    // Aggiungi punti al giocatore
    const bonusPoints = (room.maxAttempts - room.currentAttempts + 1) * 5
    const player = room.players.find((p) => p.id === playerId)
    if (player) {
      player.score += 10 + bonusPoints
    }

    room.chat.push({
      playerName: "Sistema",
      message: `🏆 ${playerName} ha indovinato il numero ${guess}! +${10 + bonusPoints} punti`,
      timestamp: Date.now(),
    })

    // Inizia nuovo round dopo 3 secondi
    setTimeout(() => {
      const currentRoom = rooms.get(roomCode)
      if (currentRoom) {
        currentRoom.secretNumber = generateSecretNumber()
        currentRoom.currentRound++
        currentRoom.currentPlayerIndex = 0
        currentRoom.currentAttempts = 0
        currentRoom.turnStartTime = Date.now()

        currentRoom.chat.push({
          playerName: "Sistema",
          message: `🔄 Round ${currentRoom.currentRound}! Nuovo numero segreto generato`,
          timestamp: Date.now(),
        })

        const newCurrentPlayer = currentRoom.players[0]
        currentRoom.chat.push({
          playerName: "Sistema",
          message: `🎮 È il turno di ${newCurrentPlayer.name}!`,
          timestamp: Date.now(),
        })

        // Nuovo timer
        currentRoom.turnTimer = setTimeout(() => {
          const roomForTimer = rooms.get(roomCode)
          if (roomForTimer && roomForTimer.gameStarted) {
            roomForTimer.chat.push({
              playerName: "Sistema",
              message: `⏰ Tempo scaduto per ${newCurrentPlayer.name}!`,
              timestamp: Date.now(),
            })

            nextTurn(roomCode)

            broadcastToRoom(roomCode, {
              type: "gameUpdate",
              gameData: roomForTimer,
            })
          }
        }, currentRoom.turnTimeLimit * 1000)

        broadcastToRoom(roomCode, {
          type: "gameUpdate",
          gameData: currentRoom,
        })
      }
    }, 3000)
  } else if (guess < room.secretNumber) {
    result.hint = "📈 Troppo basso!"
    room.chat.push({
      playerName: "Sistema",
      message: `${playerName}: ${guess} - Troppo basso! 📈 (${result.attemptsLeft} tentativi rimasti)`,
      timestamp: Date.now(),
    })
  } else {
    result.hint = "📉 Troppo alto!"
    room.chat.push({
      playerName: "Sistema",
      message: `${playerName}: ${guess} - Troppo alto! 📉 (${result.attemptsLeft} tentativi rimasti)`,
      timestamp: Date.now(),
    })
  }

  // Se ha esaurito i tentativi, passa al prossimo giocatore
  if (room.currentAttempts >= room.maxAttempts && !result.correct) {
    room.chat.push({
      playerName: "Sistema",
      message: `❌ ${playerName} ha esaurito i tentativi!`,
      timestamp: Date.now(),
    })

    setTimeout(() => {
      nextTurn(roomCode)
      broadcastToRoom(roomCode, {
        type: "gameUpdate",
        gameData: rooms.get(roomCode),
      })
    }, 1500)
  }

  return result
}

// WebSocket connection handler
wss.on("connection", (ws) => {
  console.log("🔗 Nuova connessione WebSocket")

  ws.send(
    JSON.stringify({
      type: "connected",
      message: "Connesso al server!",
    }),
  )

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data)
      console.log(`📨 Messaggio: ${message.type}`)

      switch (message.type) {
        case "createRoom":
          {
            const { playerId, playerName } = message
            players.set(playerId, ws)

            const room = createRoom(playerId, playerName)

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
            const { playerId, playerName, roomCode } = message
            players.set(playerId, ws)

            const room = addPlayerToRoom(roomCode, playerId, playerName)

            if (room) {
              ws.send(
                JSON.stringify({
                  type: "roomJoined",
                  gameData: room,
                }),
              )

              broadcastToRoom(roomCode, {
                type: "gameUpdate",
                gameData: room,
              })
            } else {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Stanza non trovata!",
                }),
              )
            }
          }
          break

        case "startGame":
          {
            const { roomCode, playerId } = message
            const room = rooms.get(roomCode)

            if (!room) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Stanza non trovata!",
                }),
              )
              break
            }

            const player = room.players.find((p) => p.id === playerId)
            if (!player || !player.isHost) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Solo l'host può iniziare il gioco!",
                }),
              )
              break
            }

            const result = startGame(roomCode)

            if (result.success) {
              broadcastToRoom(roomCode, {
                type: "gameUpdate",
                gameData: room,
              })
              console.log(`✅ Gioco avviato per ${roomCode}`)
            } else {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: result.error,
                }),
              )
            }
          }
          break

        case "guess":
          {
            const { roomCode, playerId, playerName, guess } = message
            const result = handleGuess(roomCode, playerId, playerName, guess)

            if (result) {
              if (result.error) {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: result.message,
                  }),
                )
              } else {
                ws.send(
                  JSON.stringify({
                    type: "guessResult",
                    result: result,
                  }),
                )

                broadcastToRoom(roomCode, {
                  type: "gameUpdate",
                  gameData: rooms.get(roomCode),
                })
              }
            }
          }
          break

        case "chat":
          {
            const { roomCode, playerName, message: chatMessage } = message
            const room = rooms.get(roomCode)

            if (room) {
              room.chat.push({
                playerName,
                message: chatMessage,
                timestamp: Date.now(),
              })

              if (room.chat.length > 50) {
                room.chat = room.chat.slice(-50)
              }

              broadcastToRoom(roomCode, {
                type: "gameUpdate",
                gameData: room,
              })
            }
          }
          break

        case "ping":
          ws.send(JSON.stringify({ type: "pong" }))
          break
      }
    } catch (error) {
      console.error("❌ Errore:", error)
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Errore del server",
        }),
      )
    }
  })

  ws.on("close", () => {
    console.log("🔌 Connessione chiusa")

    // Cleanup
    for (const [playerId, playerWs] of players.entries()) {
      if (playerWs === ws) {
        players.delete(playerId)

        for (const [roomCode, room] of rooms.entries()) {
          const playerIndex = room.players.findIndex((p) => p.id === playerId)
          if (playerIndex !== -1) {
            const player = room.players[playerIndex]
            room.players.splice(playerIndex, 1)

            if (room.turnTimer) {
              clearTimeout(room.turnTimer)
              room.turnTimer = null
            }

            if (room.players.length === 0) {
              rooms.delete(roomCode)
            } else {
              if (player.isHost && room.players.length > 0) {
                room.players[0].isHost = true
              }

              if (room.gameStarted && room.players.length === 1) {
                room.gameStarted = false
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
    console.error("❌ Errore WebSocket:", error)
  })
})

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || "0.0.0.0"

server.listen(PORT, HOST, () => {
  console.log(`🚀 Server avviato su ${HOST}:${PORT}`)
})
