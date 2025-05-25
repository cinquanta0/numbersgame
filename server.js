const express = require("express")
const http = require("http")
const socketIo = require("socket.io")

const app = express()
const server = http.createServer(app)
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
})

app.use(express.static("public"))

const rooms = new Map()
const players = new Map()

// Configurazioni base per difficoltà
const DIFFICULTY_CONFIG = {
  easy: { baseRange: 30, maxAttempts: 10 },
  medium: { baseRange: 60, maxAttempts: 8 },
  hard: { baseRange: 150, maxAttempts: 7 },
  hardcore: { baseRange: 300, maxAttempts: 5 },
}

class GameRoom {
  constructor(code, host, difficulty) {
    this.code = code
    this.host = host
    this.difficulty = difficulty
    this.players = new Map()
    this.gameStarted = false
    this.gameEnded = false
    this.currentLevel = 1
    this.maxLevels = 10
    this.targetNumber = null
    this.currentPlayerIndex = 0
    this.history = []
    this.scores = new Map()
    this.levelStartTime = null
    this.autoStartTimer = null
    this.createdAt = Date.now()

    this.addPlayer(host)
  }

  // Calcola il range per il livello corrente
  getCurrentRange() {
    const baseRange = DIFFICULTY_CONFIG[this.difficulty].baseRange
    return baseRange * this.currentLevel
  }

  addPlayer(playerData) {
    this.players.set(playerData.id, {
      ...playerData,
      attempts: 0,
      joinedAt: Date.now(),
    })
    this.scores.set(playerData.id, 0)

    if (this.players.size >= 2 && !this.gameStarted && !this.autoStartTimer) {
      this.scheduleAutoStart()
    }
  }

  scheduleAutoStart() {
    this.autoStartTimer = setTimeout(() => {
      if (this.players.size >= 2 && !this.gameStarted) {
        this.startGame()
      }
    }, 10000)
  }

  removePlayer(playerId) {
    this.players.delete(playerId)
    this.scores.delete(playerId)

    if (this.players.size < 2 && this.autoStartTimer) {
      clearTimeout(this.autoStartTimer)
      this.autoStartTimer = null
    }

    if (this.host.id === playerId && this.players.size > 0) {
      const newHost = Array.from(this.players.values())[0]
      this.host = newHost
      newHost.isHost = true
      return newHost
    }
    return null
  }

  startGame() {
    if (this.players.size < 2) return false

    if (this.autoStartTimer) {
      clearTimeout(this.autoStartTimer)
      this.autoStartTimer = null
    }

    this.gameStarted = true
    this.gameEnded = false
    this.currentLevel = 1
    this.startNewLevel()

    this.players.forEach((player) => {
      this.scores.set(player.id, 0)
    })

    console.log(`🎮 Partita iniziata nella stanza ${this.code}`)
    return true
  }

  startNewLevel() {
    const currentRange = this.getCurrentRange()
    this.targetNumber = Math.floor(Math.random() * currentRange) + 1
    this.currentPlayerIndex = 0
    this.history = []
    this.levelStartTime = Date.now()

    // Reset attempts per questo livello
    this.players.forEach((player) => (player.attempts = 0))

    console.log(`🎯 LIVELLO ${this.currentLevel} INIZIATO:`)
    console.log(`   Range: 1-${currentRange}`)
    console.log(`   Numero target: ${this.targetNumber}`)
    console.log(`   Stanza: ${this.code}`)
  }

  calculateScore(attempts, timeElapsed) {
    const maxAttempts = DIFFICULTY_CONFIG[this.difficulty].maxAttempts
    const maxPoints = 1000

    const attemptScore = Math.max(0, ((maxAttempts - attempts) / maxAttempts) * maxPoints)
    const timeBonus = Math.max(0, 200 - (timeElapsed / 1000) * 2)
    const levelBonus = this.currentLevel * 50

    return Math.max(100, Math.round(attemptScore + timeBonus + levelBonus))
  }

  makeGuess(playerId, guess) {
    if (!this.gameStarted || this.gameEnded) return null

    const playersArray = Array.from(this.players.values())
    const currentPlayer = playersArray[this.currentPlayerIndex]

    if (currentPlayer.id !== playerId) return null

    const player = this.players.get(playerId)
    player.attempts++

    let result
    if (guess === this.targetNumber) {
      result = "correct"

      const timeElapsed = Date.now() - this.levelStartTime
      const levelScore = this.calculateScore(player.attempts, timeElapsed)
      const currentScore = this.scores.get(playerId) || 0
      this.scores.set(playerId, currentScore + levelScore)

      if (this.currentLevel >= this.maxLevels) {
        this.gameEnded = true
      }
    } else if (guess < this.targetNumber) {
      result = "too_low"
    } else {
      result = "too_high"
    }

    const guessData = {
      player: player.name,
      playerId: playerId,
      guess: guess,
      result: result,
      timestamp: Date.now(),
    }

    this.history.push(guessData)

    if (result !== "correct") {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.size
    }

    return {
      ...guessData,
      targetNumber: result === "correct" ? this.targetNumber : null,
      gameEnded: this.gameEnded,
      currentPlayerIndex: this.currentPlayerIndex,
      levelScore: result === "correct" ? this.calculateScore(player.attempts, Date.now() - this.levelStartTime) : 0,
      levelCompleted: result === "correct",
    }
  }

  nextLevel() {
    if (this.currentLevel < this.maxLevels) {
      this.currentLevel++
      this.startNewLevel()
      return true
    }
    return false
  }

  resetGame() {
    this.gameStarted = false
    this.gameEnded = false
    this.targetNumber = null
    this.currentPlayerIndex = 0
    this.history = []
    this.currentLevel = 1
    this.levelStartTime = null

    this.players.forEach((player) => {
      player.attempts = 0
      this.scores.set(player.id, 0)
    })

    if (this.players.size >= 2) {
      this.scheduleAutoStart()
    }
  }

  getFinalLeaderboard() {
    return Array.from(this.players.values())
      .map((player) => ({
        name: player.name,
        id: player.id,
        totalScore: this.scores.get(player.id) || 0,
        isHost: player.isHost,
      }))
      .sort((a, b) => b.totalScore - a.totalScore)
  }

  getGameState() {
    const currentRange = this.getCurrentRange()
    const maxAttempts = DIFFICULTY_CONFIG[this.difficulty].maxAttempts

    return {
      code: this.code,
      host: this.host,
      difficulty: this.difficulty,
      players: Array.from(this.players.values()),
      gameStarted: this.gameStarted,
      gameEnded: this.gameEnded,
      currentPlayerIndex: this.currentPlayerIndex,
      history: this.history,
      playersCount: this.players.size,
      autoStartTimer: this.autoStartTimer ? true : false,
      currentLevel: this.currentLevel,
      maxLevels: this.maxLevels,
      scores: Object.fromEntries(this.scores),
      leaderboard: this.getFinalLeaderboard(),
      // INFORMAZIONI LIVELLO CORRENTE
      currentLevelInfo: {
        level: this.currentLevel,
        maxLevel: this.maxLevels,
        range: `1-${currentRange}`,
        maxRange: currentRange,
        attempts: maxAttempts,
        difficulty: this.difficulty,
      },
    }
  }
}

function generateRoomCode() {
  let code
  do {
    code = "GAME" + Math.random().toString(36).substr(2, 4).toUpperCase()
  } while (rooms.has(code))
  return code
}

io.on("connection", (socket) => {
  console.log(`Nuovo giocatore connesso: ${socket.id}`)

  socket.on("createRoom", (data) => {
    const roomCode = generateRoomCode()
    const playerData = {
      id: socket.id,
      name: data.playerName,
      isHost: true,
    }

    const room = new GameRoom(roomCode, playerData, data.difficulty)
    rooms.set(roomCode, room)
    players.set(socket.id, { roomCode, playerData })

    socket.join(roomCode)

    socket.emit("roomCreated", {
      roomCode: roomCode,
      gameState: room.getGameState(),
    })

    console.log(`Stanza ${roomCode} creata da ${data.playerName}`)
  })

  socket.on("joinRoom", (data) => {
    const room = rooms.get(data.roomCode)

    if (!room) {
      socket.emit("error", { message: "Stanza non trovata!" })
      return
    }

    if (room.players.size >= 6) {
      socket.emit("error", { message: "Stanza piena!" })
      return
    }

    const nameExists = Array.from(room.players.values()).some((p) => p.name === data.playerName)
    if (nameExists) {
      socket.emit("error", { message: "Nome già in uso in questa stanza!" })
      return
    }

    const playerData = {
      id: socket.id,
      name: data.playerName,
      isHost: false,
    }

    room.addPlayer(playerData)
    players.set(socket.id, { roomCode: data.roomCode, playerData })

    socket.join(data.roomCode)

    socket.emit("roomJoined", {
      roomCode: data.roomCode,
      gameState: room.getGameState(),
    })

    socket.to(data.roomCode).emit("playerJoined", {
      player: playerData,
      gameState: room.getGameState(),
    })

    if (room.autoStartTimer) {
      io.to(data.roomCode).emit("autoStartScheduled", {
        message: "La partita inizierà automaticamente tra 10 secondi...",
        gameState: room.getGameState(),
      })
    }

    console.log(`${data.playerName} si è unito alla stanza ${data.roomCode}`)
  })

  socket.on("startGame", (data) => {
    const playerInfo = players.get(socket.id)
    if (!playerInfo) return

    const room = rooms.get(playerInfo.roomCode)
    if (!room || !playerInfo.playerData.isHost) {
      socket.emit("error", { message: "Solo l'host può iniziare la partita!" })
      return
    }

    if (room.startGame()) {
      io.to(playerInfo.roomCode).emit("gameStarted", {
        gameState: room.getGameState(),
        manualStart: true,
      })
    } else {
      socket.emit("error", { message: "Servono almeno 2 giocatori per iniziare!" })
    }
  })

  socket.on("nextLevel", (data) => {
    const playerInfo = players.get(socket.id)
    if (!playerInfo) return

    const room = rooms.get(playerInfo.roomCode)
    if (!room || !playerInfo.playerData.isHost) {
      socket.emit("error", { message: "Solo l'host può passare al livello successivo!" })
      return
    }

    if (room.nextLevel()) {
      const newGameState = room.getGameState()
      io.to(playerInfo.roomCode).emit("levelStarted", {
        gameState: newGameState,
      })
      console.log(`🎯 LIVELLO ${room.currentLevel} INIZIATO - Range: 1-${room.getCurrentRange()}`)
    }
  })

  socket.on("makeGuess", (data) => {
    const playerInfo = players.get(socket.id)
    if (!playerInfo) return

    const room = rooms.get(playerInfo.roomCode)
    if (!room) return

    const result = room.makeGuess(socket.id, data.guess)
    if (!result) {
      socket.emit("error", { message: "Non è il tuo turno o la partita non è valida!" })
      return
    }

    io.to(playerInfo.roomCode).emit("guessResult", {
      ...result,
      gameState: room.getGameState(),
    })

    if (result.levelCompleted) {
      if (result.gameEnded) {
        io.to(playerInfo.roomCode).emit("gameCompleted", {
          winner: result.player,
          targetNumber: result.targetNumber,
          gameState: room.getGameState(),
          finalLeaderboard: room.getFinalLeaderboard(),
        })
      } else {
        io.to(playerInfo.roomCode).emit("levelCompleted", {
          winner: result.player,
          targetNumber: result.targetNumber,
          levelScore: result.levelScore,
          gameState: room.getGameState(),
        })
      }
    }
  })

  socket.on("resetGame", (data) => {
    const playerInfo = players.get(socket.id)
    if (!playerInfo) return

    const room = rooms.get(playerInfo.roomCode)
    if (!room || !playerInfo.playerData.isHost) {
      socket.emit("error", { message: "Solo l'host può resettare la partita!" })
      return
    }

    room.resetGame()

    io.to(playerInfo.roomCode).emit("roomState", {
      gameState: room.getGameState(),
    })
  })

  socket.on("sendMessage", (data) => {
    const playerInfo = players.get(socket.id)
    if (!playerInfo) return

    const messageData = {
      player: playerInfo.playerData.name,
      message: data.message,
      timestamp: Date.now(),
    }

    io.to(playerInfo.roomCode).emit("chatMessage", messageData)
  })

  socket.on("getPublicRooms", () => {
    const publicRooms = Array.from(rooms.values())
      .filter((room) => !room.gameStarted && room.players.size < 6)
      .slice(0, 10)
      .map((room) => ({
        code: room.code,
        host: room.host.name,
        difficulty: room.difficulty,
        players: room.players.size,
        maxPlayers: 6,
      }))

    socket.emit("publicRooms", { rooms: publicRooms })
  })

  socket.on("leaveRoom", (data) => {
    const playerInfo = players.get(socket.id)
    if (playerInfo) {
      const room = rooms.get(playerInfo.roomCode)
      if (room) {
        const newHost = room.removePlayer(socket.id)

        socket.to(playerInfo.roomCode).emit("playerLeft", {
          player: playerInfo.playerData,
          gameState: room.getGameState(),
          newHost: newHost,
        })

        socket.leave(playerInfo.roomCode)

        if (room.players.size === 0) {
          rooms.delete(playerInfo.roomCode)
        }
      }

      players.delete(socket.id)
    }
  })

  socket.on("disconnect", () => {
    const playerInfo = players.get(socket.id)
    if (playerInfo) {
      const room = rooms.get(playerInfo.roomCode)
      if (room) {
        const newHost = room.removePlayer(socket.id)

        socket.to(playerInfo.roomCode).emit("playerLeft", {
          player: playerInfo.playerData,
          gameState: room.getGameState(),
          newHost: newHost,
        })

        if (room.players.size === 0) {
          rooms.delete(playerInfo.roomCode)
        }
      }

      players.delete(socket.id)
    }

    console.log(`Giocatore disconnesso: ${socket.id}`)
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT}`)
  console.log(`📱 Apri http://localhost:${PORT}/multiplayer.html`)
})
