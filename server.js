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
  console.log(`✅ Stanza creata: ${roomCode}, giocatori: ${room.players.length}`)
  return room
}

function addPlayerToRoom(roomCode, playerId, playerName) {
  const room = rooms.get(roomCode)
  if (!room) {
    console.log(`❌ Stanza ${roomCode} non trovata`)
    return null
  }

  // Controlla se il giocatore è già nella stanza
  const existingPlayer = room.players.find((p) => p.id === playerId)
  if (existingPlayer) {
    console.log(`⚠️ Giocatore ${playerName} già nella stanza ${roomCode}`)
    return room
  }

  // Aggiungi nuovo giocatore
  room.players.push({
    id: playerId,
    name: playerName,
    score: 0,
    isHost: false,
  })

  console.log(`✅ ${playerName} aggiunto alla stanza ${roomCode}, totale giocatori: ${room.players.length}`)

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

  console.log(`📡 Broadcasting a stanza ${roomCode}, giocatori: ${room.players.length}`)

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

function startGame(roomCode) {
  console.log(`🎮 Tentativo di avvio gioco per stanza: ${roomCode}`)

  const room = rooms.get(roomCode)
  if (!room) {
    console.log(`❌ Stanza ${roomCode} non trovata per startGame`)
    return { error: "Stanza non trovata" }
  }

  console.log(`📊 Stanza ${roomCode} - Giocatori: ${room.players.length}, Già iniziato: ${room.gameStarted}`)

  if (room.players.length < 2) {
    console.log(`❌ Non abbastanza giocatori: ${room.players.length}`)
    return { error: "Servono almeno 2 giocatori per iniziare!" }
  }

  if (room.gameStarted) {
    console.log(`⚠️ Gioco già iniziato per stanza ${roomCode}`)
    return { error: "Il gioco è già iniziato!" }
  }

  try {
    console.log(`🚀 Avvio gioco per stanza ${roomCode}`)

    room.gameStarted = true
    room.secretNumber = generateSecretNumber()
    room.currentRound = 1
    room.currentPlayerIndex = 0
    room.currentAttempts = 0
    room.turnStartTime = Date.now()

    console.log(`🎯 Numero segreto generato: ${room.secretNumber}`)
    console.log(`👤 Primo giocatore: ${room.players[0].name}`)

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

    console.log(`✅ Gioco avviato con successo per stanza ${roomCode}`)
    return { success: true }
  } catch (error) {
    console.error(`❌ Errore in startGame per stanza ${roomCode}:`, error)
    return { error: "Errore interno del server: " + error.message }
  }
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
      console.log(`📨 Messaggio ricevuto: ${message.type}`, message)

      switch (message.type) {
        case "createRoom":
          {
            console.log(`🏠 Creazione stanza per ${message.playerName}`)
            const { playerId, playerName } = message
            players.set(playerId, ws)

            const room = createRoom(playerId, playerName)

            ws.send(
              JSON.stringify({
                type: "roomCreated",
                gameData: room,
              }),
            )

            console.log(`✅ Stanza ${room.roomCode} creata e inviata al client`)
          }
          break

        case "joinRoom":
          {
            console.log(`🚪 ${message.playerName} tenta di unirsi a ${message.roomCode}`)
            const { playerId, playerName, roomCode } = message
            players.set(playerId, ws)

            const room = addPlayerToRoom(roomCode, playerId, playerName)

            if (room) {
              console.log(`✅ ${playerName} unito a ${roomCode}`)

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

              console.log(`📡 Aggiornamenti inviati per stanza ${roomCode}`)
            } else {
              console.log(`❌ Impossibile unire ${playerName} a ${roomCode}`)
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
            console.log(`🎮 Richiesta avvio gioco da ${message.playerId} per stanza ${message.roomCode}`)

            const { roomCode, playerId } = message
            const room = rooms.get(roomCode)

            if (!room) {
              console.log(`❌ Stanza ${roomCode} non trovata per startGame`)
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Stanza non trovata!",
                }),
              )
              break
            }

            console.log(`📊 Stanza trovata: ${roomCode}, giocatori: ${room.players.length}`)

            const player = room.players.find((p) => p.id === playerId)
            if (!player) {
              console.log(`❌ Giocatore ${playerId} non trovato nella stanza`)
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Giocatore non trovato nella stanza!",
                }),
              )
              break
            }

            console.log(`👤 Giocatore trovato: ${player.name}, è host: ${player.isHost}`)

            if (!player.isHost) {
              console.log(`❌ ${player.name} non è l'host`)
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "❌ Solo l'host può iniziare il gioco!",
                }),
              )
              break
            }

            const result = startGame(roomCode)
            console.log(`🎮 Risultato startGame:`, result)

            if (result && result.success) {
              console.log(`✅ Gioco avviato, invio aggiornamenti...`)

              broadcastToRoom(roomCode, {
                type: "gameUpdate",
                gameData: room,
              })

              console.log(`📡 Aggiornamenti inviati per avvio gioco`)
            } else {
              console.log(`❌ Errore avvio gioco:`, result?.error)
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: result?.error || "❌ Errore nell'avvio del gioco",
                }),
              )
            }
          }
          break

        case "guess":
          {
            console.log(`🎯 Tentativo di ${message.playerName}: ${message.guess}`)
            // Implementazione guess...
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
          message: "Errore del server: " + error.message,
        }),
      )
    }
  })

  ws.on("close", () => {
    console.log("🔌 Connessione WebSocket chiusa")
    // Cleanup logic...
  })

  ws.on("error", (error) => {
    console.error("❌ Errore WebSocket:", error)
  })
})

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || "0.0.0.0"

server.listen(PORT, HOST, () => {
  console.log(`🚀 Server avviato su ${HOST}:${PORT}`)
  console.log(`🌐 Apri http://localhost:${PORT} per giocare`)
})
