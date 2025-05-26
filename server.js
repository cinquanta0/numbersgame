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
    currentPlayerIndex: 0, // Indice del giocatore corrente
    turnTimeLimit: 30, // 30 secondi per turno
    turnStartTime: null,
    turnTimer: null,
    maxAttempts: 3, // Massimo 3 tentativi per turno
    currentAttempts: 0,
  }

  rooms.set(roomCode, room)
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

  return room
}

function broadcastToRoom(roomCode, message, excludePlayerId = null) {
  const room = rooms.get(roomCode)
  if (!room) return

  room.players.forEach((player) => {
    if (player.id !== excludePlayerId) {
      const ws = players.get(player.id)
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message))
      }
    }
  })
}

function nextTurn(roomCode) {
  const room = rooms.get(roomCode)
  if (!room || !room.gameStarted) return

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
    room.chat.push({
      playerName: "Sistema",
      message: `⏰ Tempo scaduto per ${currentPlayer.name}!`,
      timestamp: Date.now(),
    })

    nextTurn(roomCode)

    broadcastToRoom(roomCode, {
      type: "gameUpdate",
      gameData: room,
    })
  }, room.turnTimeLimit * 1000)

  return currentPlayer
}

function startGame(roomCode) {
  const room = rooms.get(roomCode)
  if (!room) return false

  if (room.players.length < 2) {
    return { error: "Servono almeno 2 giocatori per iniziare!" }
  }

  room.gameStarted = true
  room.secretNumber = generateSecretNumber()
  room.currentRound++
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
    room.chat.push({
      playerName: "Sistema",
      message: `⏰ Tempo scaduto per ${currentPlayer.name}!`,
      timestamp: Date.now(),
    })

    nextTurn(roomCode)

    broadcastToRoom(roomCode, {
      type: "gameUpdate",
      gameData: room,
    })
  }, room.turnTimeLimit * 1000)

  return { success: true }
}

function handleGuess(roomCode, playerId, playerName, guess) {
  const room = rooms.get(roomCode)
  if (!room || !room.gameStarted) return null

  // Verifica se è il turno del giocatore
  const currentPlayer = room.players[room.currentPlayerIndex]
  if (currentPlayer.id !== playerId) {
    return {
      error: true,
      message: `❌ Non è il tuo turno! È il turno di ${currentPlayer.name}`,
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

    // Aggiungi punti al giocatore (più punti se indovina con meno tentativi)
    const bonusPoints = (room.maxAttempts - room.currentAttempts + 1) * 5
    const player = room.players.find((p) => p.id === playerId)
    if (player) {
      player.score += 10 + bonusPoints
    }

    // Aggiungi messaggio alla chat
    room.chat.push({
      playerName: "Sistema",
      message: `🏆 ${playerName} ha indovinato il numero ${guess} in ${room.currentAttempts} tentativ${room.currentAttempts === 1 ? "o" : "i"}! +${10 + bonusPoints} punti`,
      timestamp: Date.now(),
    })

    // Inizia nuovo round dopo 3 secondi
    setTimeout(() => {
      room.secretNumber = generateSecretNumber()
      room.currentRound++
      room.currentPlayerIndex = 0
      room.currentAttempts = 0

      room.chat.push({
        playerName: "Sistema",
        message: `🔄 Round ${room.currentRound}! Nuovo numero segreto generato`,
        timestamp: Date.now(),
      })

      const newCurrentPlayer = room.players[room.currentPlayerIndex]
      room.chat.push({
        playerName: "Sistema",
        message: `🎮 È il turno di ${newCurrentPlayer.name}!`,
        timestamp: Date.now(),
      })

      room.turnStartTime = Date.now()

      // Nuovo timer per il nuovo round
      room.turnTimer = setTimeout(() => {
        room.chat.push({
          playerName: "Sistema",
          message: `⏰ Tempo scaduto per ${newCurrentPlayer.name}!`,
          timestamp: Date.now(),
        })

        nextTurn(roomCode)

        broadcastToRoom(roomCode, {
          type: "gameUpdate",
          gameData: room,
        })
      }, room.turnTimeLimit * 1000)

      broadcastToRoom(roomCode, {
        type: "gameUpdate",
        gameData: room,
      })
    }, 3000)
  } else if (guess < room.secretNumber) {
    result.hint = "📈 Troppo basso!"
    room.chat.push({
      playerName: "Sistema",
      message: `${playerName}: ${guess} - Troppo basso! 📈 (${result.attemptsLeft} tentativ${result.attemptsLeft === 1 ? "o" : "i"} rimast${result.attemptsLeft === 1 ? "o" : "i"})`,
      timestamp: Date.now(),
    })
  } else {
    result.hint = "📉 Troppo alto!"
    room.chat.push({
      playerName: "Sistema",
      message: `${playerName}: ${guess} - Troppo alto! 📉 (${result.attemptsLeft} tentativ${result.attemptsLeft === 1 ? "o" : "i"} rimast${result.attemptsLeft === 1 ? "o" : "i"})`,
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
        gameData: room,
      })
    }, 1500)
  }

  return result
}

// WebSocket connection handler
wss.on("connection", (ws) => {
  console.log("🔗 Nuova connessione WebSocket")

  // Invia conferma di connessione
  ws.send(
    JSON.stringify({
      type: "connected",
      message: "Connesso al server!",
    }),
  )

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data)
      console.log("📨 Messaggio ricevuto:", message.type, message)

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

            console.log(`🏠 Stanza creata: ${room.roomCode} da ${playerName}`)
          }
          break

        case "joinRoom":
          {
            const { playerId, playerName, roomCode } = message
            players.set(playerId, ws)

            const room = addPlayerToRoom(roomCode, playerId, playerName)

            if (room) {
              // Invia aggiornamento al giocatore che si è unito
              ws.send(
                JSON.stringify({
                  type: "roomJoined",
                  gameData: room,
                }),
              )

              // Invia aggiornamento a tutti i giocatori nella stanza
              broadcastToRoom(roomCode, {
                type: "gameUpdate",
                gameData: room,
              })

              console.log(`🚪 ${playerName} si è unito alla stanza ${roomCode}`)
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

            if (room) {
              const player = room.players.find((p) => p.id === playerId)
              if (player && player.isHost) {
                const result = startGame(roomCode)

                if (result.error) {
                  ws.send(
                    JSON.stringify({
                      type: "error",
                      message: result.error,
                    }),
                  )
                } else {
                  broadcastToRoom(roomCode, {
                    type: "gameUpdate",
                    gameData: room,
                  })
                  console.log(`🎮 Gioco iniziato nella stanza ${roomCode}`)
                }
              } else {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "❌ Solo l'host può iniziare il gioco!",
                  }),
                )
              }
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
                const room = rooms.get(roomCode)

                // Invia risultato al giocatore
                ws.send(
                  JSON.stringify({
                    type: "guessResult",
                    result: result,
                  }),
                )

                // Aggiorna tutti i giocatori
                broadcastToRoom(roomCode, {
                  type: "gameUpdate",
                  gameData: room,
                })

                console.log(`🎯 ${playerName} ha provato ${guess} nella stanza ${roomCode}`)
              }
            }
          }
          break

        case "chat":
          {
            const { roomCode, playerId, playerName, message: chatMessage } = message
            const room = rooms.get(roomCode)

            if (room) {
              room.chat.push({
                playerName,
                message: chatMessage,
                timestamp: Date.now(),
              })

              // Mantieni solo gli ultimi 50 messaggi
              if (room.chat.length > 50) {
                room.chat = room.chat.slice(-50)
              }

              broadcastToRoom(roomCode, {
                type: "gameUpdate",
                gameData: room,
              })

              console.log(`💬 ${playerName}: ${chatMessage}`)
            }
          }
          break

        case "ping":
          ws.send(JSON.stringify({ type: "pong" }))
          break

        default:
          console.log("❓ Tipo messaggio sconosciuto:", message.type)
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
    console.log("🔌 Connessione WebSocket chiusa")

    // Rimuovi giocatore dalle mappe
    for (const [playerId, playerWs] of players.entries()) {
      if (playerWs === ws) {
        players.delete(playerId)

        // Rimuovi giocatore dalle stanze
        for (const [roomCode, room] of rooms.entries()) {
          const playerIndex = room.players.findIndex((p) => p.id === playerId)
          if (playerIndex !== -1) {
            const player = room.players[playerIndex]
            room.players.splice(playerIndex, 1)

            // Cancella timer se era il turno del giocatore disconnesso
            if (room.gameStarted && room.currentPlayerIndex === playerIndex && room.turnTimer) {
              clearTimeout(room.turnTimer)
              room.turnTimer = null
            }

            // Aggiusta l'indice del giocatore corrente se necessario
            if (room.gameStarted && room.currentPlayerIndex >= room.players.length && room.players.length > 0) {
              room.currentPlayerIndex = 0
            }

            room.chat.push({
              playerName: "Sistema",
              message: `👋 ${player.name} ha lasciato la battaglia`,
              timestamp: Date.now(),
            })

            // Se era l'host, assegna a qualcun altro
            if (player.isHost && room.players.length > 0) {
              room.players[0].isHost = true
            }

            // Se non ci sono più giocatori, elimina la stanza
            if (room.players.length === 0) {
              if (room.turnTimer) {
                clearTimeout(room.turnTimer)
              }
              rooms.delete(roomCode)
              console.log(`🗑️ Stanza ${roomCode} eliminata (vuota)`)
            } else {
              // Se il gioco era iniziato e c'è solo 1 giocatore rimasto, fermalo
              if (room.gameStarted && room.players.length === 1) {
                room.gameStarted = false
                if (room.turnTimer) {
                  clearTimeout(room.turnTimer)
                  room.turnTimer = null
                }
                room.chat.push({
                  playerName: "Sistema",
                  message: `⏸️ Gioco sospeso - Serve almeno 2 giocatori`,
                  timestamp: Date.now(),
                })
              }

              // Aggiorna i giocatori rimanenti
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

// Cleanup periodico delle stanze vuote
setInterval(() => {
  for (const [roomCode, room] of rooms.entries()) {
    if (room.players.length === 0) {
      if (room.turnTimer) {
        clearTimeout(room.turnTimer)
      }
      rooms.delete(roomCode)
      console.log(`🧹 Pulizia stanza vuota: ${roomCode}`)
    }
  }
}, 60000) // Ogni minuto

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || "0.0.0.0"

server.listen(PORT, HOST, () => {
  console.log(`🚀 Server avviato su ${HOST}:${PORT}`)
  console.log(`🌐 Apri http://localhost:${PORT} per giocare`)
})
