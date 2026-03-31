let socket = null
let currentRoom = null
let playerName = ""
let isHost = false
let countdownTimer = null
let gameState = {
  players: [],
  currentPlayerIndex: 0,
  targetNumber: null,
  difficulty: "easy",
  gameStarted: false,
  gameEnded: false,
  history: [],
  currentLevel: 1,
  maxLevels: 10,
  scores: {},
  currentLevelInfo: null,
}

document.addEventListener("DOMContentLoaded", () => {
  initializeConnection()
  initializeParticles()
  setupEventListeners()
})

function setupEventListeners() {
  document.getElementById("create-game-btn").addEventListener("click", createRoom)
  document.getElementById("join-game-btn").addEventListener("click", joinRoom)

  document.getElementById("submitGuess").addEventListener("click", makeGuess)
  document.getElementById("send-chat").addEventListener("click", sendMessage)
  document.getElementById("start-game-btn").addEventListener("click", startGame)
  document.getElementById("next-level-btn").addEventListener("click", nextLevel)
  document.getElementById("leave-room-btn").addEventListener("click", leaveRoom)
  document.getElementById("new-game-btn").addEventListener("click", startNewGame)

  document.getElementById("play-again-btn").addEventListener("click", startNewGame)
  document.getElementById("back-to-lobby-btn").addEventListener("click", leaveRoom)

  document.getElementById("chat-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage()
  })

  document.getElementById("userGuess").addEventListener("keypress", (e) => {
    if (e.key === "Enter") makeGuess()
  })

  document.getElementById("room-code").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase()
  })
}

function initializeConnection() {
  updateConnectionStatus("connecting", "Connessione al server...")

  socket = io()

  socket.on("connect", () => {
    console.log("Connesso al server:", socket.id)
    updateConnectionStatus("online", "Connesso al server globale")
  })

  socket.on("disconnect", () => {
    console.log("Disconnesso dal server")
    updateConnectionStatus("offline", "Disconnesso dal server")
    stopCountdown()
  })

  socket.on("reconnect", () => {
    console.log("Riconnesso al server")
    updateConnectionStatus("online", "Riconnesso al server")
  })

  // Eventi del gioco
  socket.on("roomCreated", handleRoomCreated)
  socket.on("roomJoined", handleRoomJoined)
  socket.on("playerJoined", handlePlayerJoined)
  socket.on("playerLeft", handlePlayerLeft)
  socket.on("gameStarted", handleGameStarted)
  socket.on("levelStarted", handleLevelStarted)
  socket.on("guessResult", handleGuessResult)
  socket.on("levelCompleted", handleLevelCompleted)
  socket.on("gameCompleted", handleGameCompleted)
  socket.on("chatMessage", handleChatMessage)
  socket.on("error", handleError)
}

function updateConnectionStatus(status, text) {
  const indicator = document.getElementById("connectionStatus")
  const textEl = document.getElementById("connectionText")

  indicator.className = `status-indicator status-${status}`
  textEl.textContent = text

  const buttons = ["create-game-btn", "join-game-btn"]
  buttons.forEach((id) => {
    const btn = document.getElementById(id)
    if (btn) {
      btn.disabled = status !== "online"
    }
  })
}

function createRoom() {
  const name = document.getElementById("playerName").value.trim()
  const difficulty = document.getElementById("difficulty").value

  if (!name) {
    alert("Inserisci il tuo nome!")
    return
  }

  if (!socket || !socket.connected) {
    alert("Non connesso al server!")
    return
  }

  playerName = name
  isHost = true

  socket.emit("createRoom", {
    playerName: name,
    difficulty: difficulty,
  })

  updateConnectionStatus("connecting", "Creando stanza...")
}

function joinRoom() {
  const name = document.getElementById("playerName").value.trim()
  const roomCode = document.getElementById("room-code").value.trim().toUpperCase()

  if (!name) {
    alert("Inserisci il tuo nome!")
    return
  }

  if (!roomCode) {
    alert("Inserisci il codice della stanza!")
    return
  }

  if (!socket || !socket.connected) {
    alert("Non connesso al server!")
    return
  }

  playerName = name
  isHost = false

  socket.emit("joinRoom", {
    playerName: name,
    roomCode: roomCode,
  })

  updateConnectionStatus("connecting", "Entrando nella stanza...")
}


function startGame() {
  if (!isHost) {
    alert("Solo l'host può iniziare la partita!")
    return
  }

  if (gameState.players.length < 2) {
    alert("Servono almeno 2 giocatori per iniziare!")
    return
  }

  socket.emit("startGame", { roomCode: currentRoom })
  stopCountdown()
}

function nextLevel() {
  if (!isHost) {
    alert("Solo l'host può passare al livello successivo!")
    return
  }

  socket.emit("nextLevel", { roomCode: currentRoom })
  hideLevelCompletedNotification()
}

function makeGuess() {
  const guess = Number.parseInt(document.getElementById("userGuess").value)

  if (isNaN(guess)) {
    alert("Inserisci un numero valido!")
    return
  }

  if (!gameState.gameStarted) {
    alert("La partita non è ancora iniziata!")
    return
  }

  if (gameState.gameEnded) {
    alert("La partita è già finita!")
    return
  }

  const currentPlayer = gameState.players[gameState.currentPlayerIndex]
  if (currentPlayer.name !== playerName) {
    alert("Non è il tuo turno!")
    return
  }

  socket.emit("makeGuess", {
    roomCode: currentRoom,
    guess: guess,
  })

  document.getElementById("userGuess").value = ""
  document.getElementById("submitGuess").disabled = true

  setTimeout(() => {
    document.getElementById("submitGuess").disabled = false
  }, 1000)
}

function sendMessage() {
  if (!currentRoom) return
  const input = document.getElementById("chat-input")
  const message = input.value.trim()

  if (!message) return

  socket.emit("sendMessage", {
    roomCode: currentRoom,
    message: message,
  })

  input.value = ""
}

function leaveRoom() {
  if (currentRoom) {
    socket.emit("leaveRoom", { roomCode: currentRoom })
  }

  currentRoom = null
  isHost = false
  stopCountdown()
  gameState = {
    players: [],
    currentPlayerIndex: 0,
    targetNumber: null,
    difficulty: "easy",
    gameStarted: false,
    gameEnded: false,
    history: [],
    currentLevel: 1,
    maxLevels: 10,
    scores: {},
    currentLevelInfo: null,
  }

  showScreen("lobby")
  updateConnectionStatus("online", "Connesso al server globale")
}

function startNewGame() {
  if (!isHost) {
    alert("Solo l'host può iniziare una nuova partita!")
    return
  }

  socket.emit("resetGame", { roomCode: currentRoom })
  showScreen("game")
}

function startCountdown() {
  let timeLeft = 10
  const countdownEl = document.getElementById("countdown")
  const notificationEl = document.getElementById("auto-start-notification")

  notificationEl.classList.remove("hidden")

  countdownTimer = setInterval(() => {
    timeLeft--
    countdownEl.textContent = timeLeft

    if (timeLeft <= 0) {
      stopCountdown()
    }
  }, 1000)
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }

  const notificationEl = document.getElementById("auto-start-notification")
  if (notificationEl) {
    notificationEl.classList.add("hidden")
  }
}

function showLevelCompletedNotification(winner, score) {
  const notification = document.getElementById("level-completed-notification")
  const winnerEl = document.getElementById("level-winner")
  const scoreEl = document.getElementById("level-score-info")

  winnerEl.textContent = `${winner} ha completato il livello!`
  scoreEl.textContent = `Punteggio guadagnato: ${score} punti`

  notification.classList.remove("hidden")

  if (isHost) {
    document.getElementById("next-level-btn").classList.remove("hidden")
  }
}

function hideLevelCompletedNotification() {
  const notification = document.getElementById("level-completed-notification")
  notification.classList.add("hidden")
  document.getElementById("next-level-btn").classList.add("hidden")
}

// Event handlers
function handleRoomCreated(data) {
  console.log("Stanza creata:", data)
  currentRoom = data.roomCode
  gameState = data.gameState

  showScreen("game")
  updateGameUI()
  updateConnectionStatus("online", `Host della stanza ${data.roomCode}`)

  addChatMessage("Sistema", `Stanza ${data.roomCode} creata! Condividi il codice con i tuoi amici.`, true)
}

function handleRoomJoined(data) {
  console.log("Entrato nella stanza:", data)
  currentRoom = data.roomCode
  gameState = data.gameState

  showScreen("game")
  updateGameUI()
  updateConnectionStatus("online", `Nella stanza ${data.roomCode}`)

  addChatMessage("Sistema", `Ti sei unito alla stanza ${data.roomCode}!`, true)
}

function handlePlayerJoined(data) {
  console.log("Giocatore entrato:", data)
  gameState = data.gameState
  updateGameUI()
  addChatMessage("Sistema", `${data.player.name} si è unito alla partita!`, true)
}

function handlePlayerLeft(data) {
  console.log("Giocatore uscito:", data)
  gameState = data.gameState
  updateGameUI()
  addChatMessage("Sistema", `${data.player.name} ha lasciato la partita.`, true)

  if (data.newHost && data.newHost.id === socket.id) {
    isHost = true
    addChatMessage("Sistema", "Sei diventato il nuovo host!", true)
  }
}

function handleGameStarted(data) {
  console.log("🎮 Partita iniziata:", data)
  gameState = data.gameState
  updateGameUI()
  stopCountdown()

  const startType = data.manualStart ? "manualmente" : "automaticamente"
  addChatMessage("Sistema", `🎮 Partita iniziata ${startType}! 10 livelli vi aspettano!`, true)

  // Mostra il range del primo livello
  if (gameState.currentLevelInfo) {
    console.log(`🎯 LIVELLO 1 - Range: ${gameState.currentLevelInfo.range}`)
    addChatMessage("Sistema", `🎯 Livello 1 iniziato! Range: ${gameState.currentLevelInfo.range}`, true)
  }
}

function handleLevelStarted(data) {
  console.log("🎯 NUOVO LIVELLO:", data)
  gameState = data.gameState
  updateGameUI()
  hideLevelCompletedNotification()

  if (gameState.currentLevelInfo) {
    console.log(`🎯 LIVELLO ${gameState.currentLevel} - Range: ${gameState.currentLevelInfo.range}`)
    addChatMessage(
      "Sistema",
      `🎯 Livello ${gameState.currentLevel} iniziato! Nuovo range: ${gameState.currentLevelInfo.range}`,
      true,
    )
  }
}

function handleGuessResult(data) {
  console.log("Risultato tentativo:", data)
  gameState = data.gameState

  const lastGuess = gameState.history[gameState.history.length - 1]

  if (data.levelCompleted) {
    showConfetti()
    addChatMessage(
      "Sistema",
      `🎉 ${lastGuess.player} ha completato il livello ${gameState.currentLevel}! (+${data.levelScore} punti)`,
      true,
    )
  } else {
    updateGameUI()
    updateGameHistory()

    let resultText
    if (data.result === "too_low") {
      resultText = `⬆️ ${data.guess} è troppo basso! Prova con un numero più alto.`
    } else if (data.result === "too_high") {
      resultText = `⬇️ ${data.guess} è troppo alto! Prova con un numero più basso.`
    }

    document.getElementById("message").textContent = resultText

    const myPlayer = gameState.players.find((p) => p.name === playerName)
    document.getElementById("tentativi").textContent = myPlayer?.attempts || 0

    if (lastGuess.player === playerName) {
      const resultEmoji = data.result === "too_low" ? "⬆️" : "⬇️"
      addChatMessage("Tu", `Hai provato ${data.guess} ${resultEmoji}`, false)
    }
  }
}

function handleLevelCompleted(data) {
  console.log("Livello completato:", data)
  gameState = data.gameState
  updateGameUI()
  showLevelCompletedNotification(data.winner, data.levelScore)
}

function handleGameCompleted(data) {
  console.log("Partita completata:", data)
  gameState = data.gameState
  showFinalLeaderboard(data.finalLeaderboard)
  showConfetti()
}

function handleChatMessage(data) {
  addChatMessage(data.player, data.message)
}


function handleError(data) {
  console.error("Errore:", data)
  alert(data.message)
  updateConnectionStatus("online", "Connesso al server globale")
}


// UI Functions
function showScreen(screenName) {
  const screens = ["lobby", "game", "final-leaderboard-screen"]
  screens.forEach((screen) => {
    document.getElementById(screen).classList.add("hidden")
  })
  document.getElementById(screenName).classList.remove("hidden")

  if (screenName !== "lobby") {
    document.getElementById("publicRoomsList").classList.add("hidden")
  }
}

function updateGameUI() {
  if (!gameState) return

  document.getElementById("room-code-display").textContent = currentRoom
  document.getElementById("current-level").textContent = gameState.currentLevel

  const myPlayerId = gameState.players.find((p) => p.name === playerName)?.id
  const myScore = gameState.scores[myPlayerId] || 0
  document.getElementById("my-score").textContent = myScore

  updateLiveLeaderboard()

  // AGGIORNA INFORMAZIONI LIVELLO
  if (gameState.currentLevelInfo) {
    const difficultyNames = {
      easy: "🧩 Facile",
      medium: "⚔️ Medio",
      hard: "🔥 Difficile",
      hardcore: "💀 Hardcore",
    }

    document.getElementById("level-info").textContent =
      `${difficultyNames[gameState.difficulty]} - Livello ${gameState.currentLevel}/${gameState.maxLevels}`

    // MOSTRA RANGE CORRENTE
    const levelRange = document.getElementById("level-range")
    const levelAttempts = document.getElementById("level-attempts")
    const maxAttemptsSpan = document.getElementById("max-attempts")

    if (levelRange) {
      levelRange.innerHTML = `Indovina un numero da ${gameState.currentLevelInfo.range}<br><small style="opacity: 0.7;">📈 Range aumenta ogni livello!</small>`
      console.log(`🎯 UI AGGIORNATA - Range mostrato: ${gameState.currentLevelInfo.range}`)
    }

    if (levelAttempts) {
      levelAttempts.textContent = `Tentativi massimi: ${gameState.currentLevelInfo.attempts}`
    }

    if (maxAttemptsSpan) {
      maxAttemptsSpan.textContent = ` / ${gameState.currentLevelInfo.attempts}`
    }

    // AGGIORNA PLACEHOLDER INPUT
    const userGuessInput = document.getElementById("userGuess")
    if (userGuessInput) {
      userGuessInput.placeholder = `Numero da ${gameState.currentLevelInfo.range}`
    }
  }

  // Aggiorna lista giocatori
  const playersList = document.getElementById("players-list")
  playersList.innerHTML = gameState.players
    .map(
      (player, index) => `
        <div class="player-item">
            <span>${player.name} ${player.isHost ? "👑" : ""}</span>
            <span>
                ${index === gameState.currentPlayerIndex && gameState.gameStarted ? "🎯" : ""}
                ${player.attempts || 0} tentativi
            </span>
        </div>
    `,
    )
    .join("")

  // Aggiorna stato del turno
  const startGameBtn = document.getElementById("start-game-btn")
  const newGameBtn = document.getElementById("new-game-btn")

  if (gameState.gameStarted && !gameState.gameEnded) {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex]
    const isMyTurn = currentPlayer.name === playerName

    document.getElementById("turnMessage").textContent = isMyTurn
      ? "🎯 È il tuo turno!"
      : `⏳ Turno di ${currentPlayer.name}`

    const currentRange = gameState.currentLevelInfo ? gameState.currentLevelInfo.range : "range sconosciuto"
    document.getElementById("gameInfo").textContent =
      `Livello ${gameState.currentLevel}/${gameState.maxLevels} • Range: ${currentRange} • ${gameState.history.length} tentativi`

    document.getElementById("submitGuess").disabled = !isMyTurn
    document.getElementById("userGuess").disabled = !isMyTurn

    startGameBtn.classList.add("hidden")
    newGameBtn.classList.add("hidden")

    const levelDisplay = document.getElementById("level-display")
    if (levelDisplay) {
      levelDisplay.style.display = "block"
    }
  } else if (!gameState.gameStarted) {
    document.getElementById("turnMessage").textContent = "⏳ In attesa che inizi la partita..."
    document.getElementById("gameInfo").textContent = `${gameState.players.length} giocatori connessi`
    document.getElementById("submitGuess").disabled = true
    document.getElementById("userGuess").disabled = true

    if (isHost && gameState.players.length >= 2) {
      startGameBtn.classList.remove("hidden")
    } else {
      startGameBtn.classList.add("hidden")
    }

    newGameBtn.classList.add("hidden")

    const levelDisplay = document.getElementById("level-display")
    if (levelDisplay) {
      levelDisplay.style.display = "none"
    }
  } else if (gameState.gameEnded) {
    if (isHost) {
      newGameBtn.classList.remove("hidden")
    } else {
      newGameBtn.classList.add("hidden")
    }
    startGameBtn.classList.add("hidden")
  }

  // Aggiorna contatore tentativi
  const myPlayer = gameState.players.find((p) => p.name === playerName)
  const myAttempts = myPlayer?.attempts || 0
  document.getElementById("tentativi").textContent = myAttempts

  // Mostra tentativi rimanenti
  const maxAttempts = gameState.currentLevelInfo?.attempts
  if (maxAttempts && gameState.gameStarted) {
    const remaining = maxAttempts - myAttempts
    const attemptsRemaining = document.getElementById("attempts-remaining")
    if (attemptsRemaining) {
      if (remaining > 0) {
        attemptsRemaining.textContent = `${remaining} tentativi rimasti`
        attemptsRemaining.style.color = remaining <= 2 ? "#ff6b6b" : "#ffd93d"
      } else {
        attemptsRemaining.textContent = "Nessun tentativo rimasto"
        attemptsRemaining.style.color = "#ff6b6b"
      }
    }
  }
}

function updateLiveLeaderboard() {
  const leaderboard = document.getElementById("live-leaderboard")

  if (!gameState.leaderboard || gameState.leaderboard.length === 0) {
    leaderboard.innerHTML = '<div style="text-align: center; opacity: 0.6;">Nessun punteggio ancora...</div>'
    return
  }

  leaderboard.innerHTML = gameState.leaderboard
    .map((player, index) => {
      let className = "leaderboard-item"
      let medal = ""

      if (index === 0) {
        className += " first"
        medal = "🥇 "
      } else if (index === 1) {
        className += " second"
        medal = "🥈 "
      } else if (index === 2) {
        className += " third"
        medal = "🥉 "
      }

      return `
        <div class="${className}">
          <span>${medal}${player.name} ${player.isHost ? "👑" : ""}</span>
          <span style="font-weight: bold;">${player.totalScore} pts</span>
        </div>
      `
    })
    .join("")
}

function updateGameHistory() {
  const historyList = document.getElementById("history-list")

  if (gameState.history.length === 0) {
    historyList.innerHTML = '<div style="text-align: center; opacity: 0.6;">Nessun tentativo ancora...</div>'
    return
  }

  historyList.innerHTML = gameState.history
    .map((entry) => {
      let resultIcon
      if (entry.result === "correct") resultIcon = "🎉"
      else if (entry.result === "too_low") resultIcon = "⬆️"
      else if (entry.result === "too_high") resultIcon = "⬇️"

      return `
            <div class="history-item">
                <span>${entry.player}: ${entry.guess}</span>
                <span>${resultIcon}</span>
            </div>
        `
    })
    .join("")

  historyList.scrollTop = historyList.scrollHeight
}

function addChatMessage(player, message, isSystem = false) {
  const chatMessages = document.getElementById("chat-messages")
  const messageDiv = document.createElement("div")
  messageDiv.className = "chat-message"

  if (isSystem) {
    messageDiv.style.background = "rgba(255, 217, 61, 0.2)"
    messageDiv.style.borderLeft = "3px solid #ffd93d"
  }

  const time = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
  messageDiv.innerHTML = `<strong>${player}:</strong> ${message} <small style="opacity: 0.6;">${time}</small>`

  chatMessages.appendChild(messageDiv)
  chatMessages.scrollTop = chatMessages.scrollHeight
}

function showFinalLeaderboard(leaderboard) {
  showScreen("final-leaderboard-screen")

  const finalLeaderboardEl = document.getElementById("final-leaderboard")
  const gameStatsEl = document.getElementById("game-stats")

  finalLeaderboardEl.innerHTML = leaderboard
    .map((player, index) => {
      let className = "leaderboard-item"
      let medal = ""

      if (index === 0) {
        className += " first"
        medal = "🥇 "
      } else if (index === 1) {
        className += " second"
        medal = "🥈 "
      } else if (index === 2) {
        className += " third"
        medal = "🥉 "
      }

      return `
        <div class="${className}">
          <span>${medal}${player.name} ${player.isHost ? "👑" : ""}</span>
          <span style="font-weight: bold;">${player.totalScore} punti</span>
        </div>
      `
    })
    .join("")

  const winner = leaderboard[0]
  const totalLevels = gameState.maxLevels
  const myStats = leaderboard.find((p) => p.name === playerName)
  const myPosition = leaderboard.findIndex((p) => p.name === playerName) + 1

  gameStatsEl.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
      <span>🏆 Vincitore:</span>
      <span><strong>${winner.name}</strong></span>
    </div>
    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
      <span>🎯 Livelli completati:</span>
      <span><strong>${totalLevels}/10</strong></span>
    </div>
    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
      <span>📊 La tua posizione:</span>
      <span><strong>${myPosition}° posto</strong></span>
    </div>
    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
      <span>🎖️ Il tuo punteggio:</span>
      <span><strong>${myStats?.totalScore || 0} punti</strong></span>
    </div>
  `

  if (isHost) {
    document.getElementById("play-again-btn").classList.remove("hidden")
  } else {
    document.getElementById("play-again-btn").classList.add("hidden")
  }
}


function showConfetti() {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
  })
}

function initializeParticles() {
  particlesJS("particles-js", {
    particles: {
      number: { value: 80, density: { enable: true, value_area: 800 } },
      color: { value: "#ffffff" },
      shape: { type: "circle" },
      opacity: { value: 0.5, random: true },
      size: { value: 3, random: true },
      line_linked: {
        enable: true,
        distance: 150,
        color: "#ffffff",
        opacity: 0.4,
        width: 1,
      },
      move: {
        enable: true,
        speed: 2,
        direction: "none",
        random: true,
        straight: false,
        out_mode: "out",
        bounce: false,
      },
    },
    interactivity: {
      detect_on: "canvas",
      events: {
        onhover: { enable: true, mode: "repulse" },
        onclick: { enable: true, mode: "push" },
        resize: true,
      },
      modes: {
        repulse: { distance: 100, duration: 0.4 },
        push: { particles_nb: 4 },
      },
    },
    retina_detect: true,
  })
}

window.addEventListener("beforeunload", () => {
  if (currentRoom && socket) {
    socket.emit("leaveRoom", { roomCode: currentRoom })
  }
})
