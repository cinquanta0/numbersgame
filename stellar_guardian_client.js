// === STELLAR GUARDIAN CLIENT - Enhanced Edition ===
// Client JavaScript per modalità COOP + Enhanced 1v1 Duel
// (c) 2024-2025 Luka - Client Side

// === SOCKET.IO CONNECTION ===
(function() {
  const socket = io();

  
  // === GLOBAL CLIENT STATE ===
let gameMode = 'lobby'; // 'lobby', 'coop', 'duel', 'spectating'
let currentPlayer = {
  id: null,
  nickname: '',
  x: 400,
  y: 500,
  angle: 0,
  health: 100,
  maxHealth: 100,
  energy: 100,
  maxEnergy: 100,
  shields: 0,
  effects: {},
  skin: 'navicella2.png'
};

let otherPlayers = {};
let lobbyPlayers = {};
let isHost = false;
let gameInProgress = false;

// === DUEL STATE ===
let duelState = {
  inQueue: false,
  inDuel: false,
  room: null,
  opponent: null,
  myState: {},
  powerups: [],
  obstacles: [],
  bullets: [],
  events: [],
  timeRemaining: 0,
  roundInfo: {},
  spectating: false,
  spectatingRoom: null
};

// === COOP STATE ===
let coopBoss = {
  x: 500,
  y: 150,
  health: 25000,
  maxHealth: 25000,
  angle: 0
};

let coopObstacles = [];
let voiceConnections = {};
let chatMessages = [];

// === UI ELEMENTS (assumendo che esistano nel tuo HTML) ===
const lobbyDiv = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const duelDiv = document.getElementById('duel');
const chatDiv = document.getElementById('chat');
const leaderboardDiv = document.getElementById('leaderboard');

// === UTILITY FUNCTIONS ===
function updateUI() {
  // Aggiorna UI basandosi sul gameMode corrente
  if (gameMode === 'lobby') {
    showLobby();
  } else if (gameMode === 'coop') {
    showCoopGame();
  } else if (gameMode === 'duel') {
    showDuelGame();
  }
  
  updatePlayerHUD();
  updateChat();
}

function showLobby() {
  if (lobbyDiv) lobbyDiv.style.display = 'block';
  if (gameDiv) gameDiv.style.display = 'none';
  if (duelDiv) duelDiv.style.display = 'none';
  
  // Aggiorna lista giocatori in lobby
  updateLobbyPlayerList();
}

function showCoopGame() {
  if (lobbyDiv) lobbyDiv.style.display = 'none';
  if (gameDiv) gameDiv.style.display = 'block';
  if (duelDiv) duelDiv.style.display = 'none';
}

function showDuelGame() {
  if (lobbyDiv) lobbyDiv.style.display = 'none';
  if (gameDiv) gameDiv.style.display = 'none';
  if (duelDiv) duelDiv.style.display = 'block';
}

function updatePlayerHUD() {
  // Aggiorna barra vita, energia, effetti, ecc.
  const healthBar = document.getElementById('healthBar');
  const energyBar = document.getElementById('energyBar');
  const effectsDiv = document.getElementById('effects');
  
  if (healthBar) {
    const healthPercent = (currentPlayer.health / currentPlayer.maxHealth) * 100;
    healthBar.style.width = `${healthPercent}%`;
    healthBar.style.backgroundColor = healthPercent > 60 ? '#4CAF50' : 
                                     healthPercent > 30 ? '#FF9800' : '#F44336';
  }
  
  if (energyBar) {
    const energyPercent = (currentPlayer.energy / currentPlayer.maxEnergy) * 100;
    energyBar.style.width = `${energyPercent}%`;
  }
  
  if (effectsDiv) {
    effectsDiv.innerHTML = '';
    Object.entries(currentPlayer.effects || {}).forEach(([effect, timeLeft]) => {
      const effectEl = document.createElement('div');
      effectEl.className = `effect-${effect}`;
      effectEl.textContent = `${effect.toUpperCase()}: ${Math.ceil(timeLeft/1000)}s`;
      effectsDiv.appendChild(effectEl);
    });
  }
}

function updateLobbyPlayerList() {
  const playerList = document.getElementById('playerList');
  if (!playerList) return;
  
  playerList.innerHTML = '';
  Object.values(lobbyPlayers).forEach(player => {
    const playerEl = document.createElement('div');
    playerEl.className = 'lobby-player';
    if (player.id === currentPlayer.id) playerEl.classList.add('is-you');
    if (player.id === hostId) playerEl.classList.add('is-host');
    
    playerEl.innerHTML = `
      <span class="player-nickname">${player.nickname}</span>
      <span class="player-status">${player.id === hostId ? '👑 Host' : ''}</span>
    `;
    
    playerList.appendChild(playerEl);
  });
}

function updateChat() {
  const chatContainer = document.getElementById('chatMessages');
  if (!chatContainer) return;
  
  chatContainer.innerHTML = '';
  chatMessages.slice(-50).forEach(msg => { // Mostra solo ultimi 50 messaggi
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message';
    msgEl.innerHTML = `<strong>${msg.nickname}:</strong> ${msg.text}`;
    chatContainer.appendChild(msgEl);
  });
  
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// === COOP FUNCTIONS ===
function joinLobby() {
  const nickname = document.getElementById('nicknameInput')?.value || 'Player';
  currentPlayer.nickname = nickname;
  
  socket.emit('joinLobby', { 
    nickname: nickname,
    skin: currentPlayer.skin 
  });
  
  gameMode = 'lobby';
  updateUI();
}

function startCoopRaid() {
  if (isHost) {
    socket.emit('startCoopRaid');
  }
}

function sendChatMessage() {
  const chatInput = document.getElementById('chatInput');
  if (!chatInput || !chatInput.value.trim()) return;
  
  const message = chatInput.value.trim();
  
  if (gameMode === 'coop' || gameMode === 'lobby') {
    socket.emit('chatMessage', {
      nickname: currentPlayer.nickname,
      text: message
    });
  } else if (gameMode === 'duel' && duelState.room) {
    socket.emit('duel_chat', {
      room: duelState.room,
      message: message
    });
  }
  
  chatInput.value = '';
}

function shootBullet(targetX, targetY) {
  const angle = Math.atan2(targetY - currentPlayer.y, targetX - currentPlayer.x);
  
  if (gameMode === 'coop') {
    socket.emit('shoot', {
      playerId: currentPlayer.id,
      x: currentPlayer.x,
      y: currentPlayer.y,
      angle: angle,
      speed: 8,
      damage: 25
    });
  } else if (gameMode === 'duel' && duelState.room) {
    if (currentPlayer.energy >= 15) { // Costo energia per sparare
      currentPlayer.energy -= 15;
      
      socket.emit('duel_update', {
        room: duelState.room,
        player: { ...currentPlayer },
        action: 'shoot',
        bulletData: {
          x: currentPlayer.x,
          y: currentPlayer.y,
          angle: angle,
          speed: 8,
          damage: 25
        }
      });
    }
  }
}

function movePlayer(x, y, angle) {
  currentPlayer.x = x;
  currentPlayer.y = y;
  currentPlayer.angle = angle;
  
  if (gameMode === 'coop') {
    socket.emit('playerMove', {
      x: currentPlayer.x,
      y: currentPlayer.y,
      angle: currentPlayer.angle,
      nickname: currentPlayer.nickname
    });
  } else if (gameMode === 'duel' && duelState.room) {
    socket.emit('duel_update', {
      room: duelState.room,
      player: { ...currentPlayer }
    });
  }
}

function damageBoss(damage) {
  socket.emit('bossDamage', { damage: damage });
}

function hitObstacle(obstacleId) {
  if (gameMode === 'coop') {
    socket.emit('obstacleHit', obstacleId);
  } else if (gameMode === 'duel' && duelState.room) {
    socket.emit('duel_obstacle_hit', {
      room: duelState.room,
      obstacleId: obstacleId
    });
  }
}

// === DUEL FUNCTIONS ===
function joinDuelQueue() {
  if (duelState.inQueue || duelState.inDuel) return;
  
  const nickname = currentPlayer.nickname || 'Player';
  const skin = currentPlayer.skin || 'navicella2.png';
  
  socket.emit('duel_queue', { 
    nickname: nickname,
    skin: skin 
  });
  
  duelState.inQueue = true;
  showDuelQueueUI();
}

function cancelDuelQueue() {
  if (!duelState.inQueue) return;
  
  socket.emit('duel_cancel');
  duelState.inQueue = false;
  hideDuelQueueUI();
}

function collectPowerup(powerupId) {
  if (!duelState.room) return;
  
  socket.emit('duel_powerup_collected', {
    room: duelState.room,
    powerupId: powerupId
  });
}

function confirmHit(bulletId, damage, targetId) {
  if (!duelState.room) return;
  
  socket.emit('duel_hit_confirmed', {
    room: duelState.room,
    bulletId: bulletId,
    damage: damage,
    targetId: targetId
  });
}

function showDuelQueueUI() {
  const queueUI = document.getElementById('duelQueue');
  if (queueUI) {
    queueUI.style.display = 'block';
    queueUI.innerHTML = `
      <div class="queue-status">
        <h3>🔍 Cercando avversario...</h3>
        <div class="spinner"></div>
        <button onclick="cancelDuelQueue()">Annulla</button>
      </div>
    `;
  }
}

function hideDuelQueueUI() {
  const queueUI = document.getElementById('duelQueue');
  if (queueUI) queueUI.style.display = 'none';
}

function spectateRandomDuel() {
  // Trova un duello casuale da spettare
  socket.emit('get_active_duels');
}

function stopSpectating() {
  if (duelState.spectatingRoom) {
    socket.emit('stop_spectating', { room: duelState.spectatingRoom });
    duelState.spectating = false;
    duelState.spectatingRoom = null;
    gameMode = 'lobby';
    updateUI();
  }
}

function getLeaderboard() {
  socket.emit('get_duel_leaderboard');
}

function getPlayerStats() {
  socket.emit('get_player_stats');
}

// === VOICE CHAT FUNCTIONS ===
let isVoiceActive = false;
let localStream = null;
let peerConnections = {};

async function toggleVoiceChat() {
  if (!isVoiceActive) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      isVoiceActive = true;
      socket.emit('voiceActive', { active: true });
      updateVoiceButton();
    } catch (err) {
      console.error('Errore accesso microfono:', err);
      alert('Impossibile accedere al microfono');
    }
  } else {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    isVoiceActive = false;
    socket.emit('voiceActive', { active: false });
    updateVoiceButton();
    
    // Chiudi tutte le connessioni WebRTC
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
  }
}

function updateVoiceButton() {
  const voiceBtn = document.getElementById('voiceButton');
  if (voiceBtn) {
    voiceBtn.textContent = isVoiceActive ? '🔇 Disattiva Microfono' : '🎤 Attiva Microfono';
    voiceBtn.className = isVoiceActive ? 'voice-active' : 'voice-inactive';
  }
}

async function setupWebRTCConnection(targetId) {
  if (!localStream) return;
  
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  
  peerConnections[targetId] = pc;
  
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });
  
  pc.ontrack = (event) => {
    const audio = document.createElement('audio');
    audio.srcObject = event.streams[0];
    audio.autoplay = true;
    audio.id = `audio-${targetId}`;
    document.body.appendChild(audio);
  };
  
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice', {
        targetId: targetId,
        candidate: event.candidate
      });
    }
  };
  
  return pc;
}

// === INPUT HANDLING ===
let keys = {};
let mouse = { x: 0, y: 0, down: false };

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  
  // Scorciatoie da tastiera
  if (e.code === 'Enter') {
    const chatInput = document.getElementById('chatInput');
    if (chatInput && chatInput === document.activeElement) {
      sendChatMessage();
    } else if (chatInput) {
      chatInput.focus();
    }
  } else if (e.code === 'Tab') {
    e.preventDefault();
    getLeaderboard();
  } else if (e.code === 'KeyV') {
    toggleVoiceChat();
  }
});

document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

document.addEventListener('mousemove', (e) => {
  const canvas = document.getElementById('gameCanvas');
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  }
});

document.addEventListener('mousedown', (e) => {
  mouse.down = true;
  if (gameMode === 'coop' || gameMode === 'duel') {
    shootBullet(mouse.x, mouse.y);
  }
});

document.addEventListener('mouseup', (e) => {
  mouse.down = false;
});

// === GAME LOOP ===
function gameLoop() {
  // Movement handling
  let newX = currentPlayer.x;
  let newY = currentPlayer.y;
  let newAngle = currentPlayer.angle;
  let moved = false;
  
  const speed = currentPlayer.effects?.speed ? 6 : 4;
  
  if (keys['KeyW'] || keys['ArrowUp']) {
    newY -= speed;
    moved = true;
  }
  if (keys['KeyS'] || keys['ArrowDown']) {
    newY += speed;
    moved = true;
  }
  if (keys['KeyA'] || keys['ArrowLeft']) {
    newX -= speed;
    moved = true;
  }
  if (keys['KeyD'] || keys['ArrowRight']) {
    newX += speed;
    moved = true;
  }
  
  // Calcola angolo verso mouse
  newAngle = Math.atan2(mouse.y - newY, mouse.x - newX);
  
  // Limiti schermo
  const bounds = getBounds();
  newX = Math.max(20, Math.min(bounds.width - 20, newX));
  newY = Math.max(20, Math.min(bounds.height - 20, newY));
  
  // Aggiorna posizione se cambiata
  if (moved || Math.abs(newAngle - currentPlayer.angle) > 0.1) {
    movePlayer(newX, newY, newAngle);
  }
  
  // Sparo automatico se mouse premuto
  if (mouse.down && (gameMode === 'coop' || gameMode === 'duel')) {
    shootBullet(mouse.x, mouse.y);
  }
  
  // Aggiorna effetti temporanei
  updatePlayerEffects();
  
  requestAnimationFrame(gameLoop);
}

function getBounds() {
  if (gameMode === 'duel') {
    return { width: 800, height: 600 }; // DUEL_CONFIG.ARENA_WIDTH/HEIGHT
  }
  return { width: 1000, height: 700 }; // GAME_WIDTH/HEIGHT
}

function updatePlayerEffects() {
  const now = Date.now();
  const deltaTime = 16; // ~60fps
  
  // Rigenera energia
  if (currentPlayer.energy < currentPlayer.maxEnergy) {
    currentPlayer.energy = Math.min(currentPlayer.maxEnergy, 
                                   currentPlayer.energy + 1.5 * (deltaTime/1000));
  }
  
  // Aggiorna effetti temporanei
  Object.keys(currentPlayer.effects || {}).forEach(effect => {
    if (currentPlayer.effects[effect] > 0) {
      currentPlayer.effects[effect] -= deltaTime;
      if (currentPlayer.effects[effect] <= 0) {
        delete currentPlayer.effects[effect];
      }
    }
  });
}

// === SOCKET EVENT HANDLERS ===

// === LOBBY EVENTS ===
socket.on('lobbyUpdate', (data) => {
  lobbyPlayers = {};
  data.players.forEach(player => {
    lobbyPlayers[player.id] = player;
  });
  
  isHost = (data.host === socket.id);
  gameInProgress = data.gameInProgress;
  
  if (gameMode === 'lobby') {
    updateUI();
  }
  
  // Aggiorna pulsante start se sei host
  const startBtn = document.getElementById('startCoopButton');
  if (startBtn) {
    startBtn.style.display = isHost ? 'block' : 'none';
    startBtn.disabled = gameInProgress;
  }
});

socket.on('gameStart', (data) => {
  gameMode = 'coop';
  coopBoss = data.boss;
  gameInProgress = true;
  updateUI();
  console.log('Co-op raid iniziato!');
});

socket.on('otherPlayers', (data) => {
  otherPlayers = {};
  data.players.forEach(player => {
    if (player.id !== socket.id) {
      otherPlayers[player.id] = player;
    }
  });
});

// === COOP EVENTS ===
socket.on('bossUpdate', (data) => {
  coopBoss = data;
  updateBossDisplay();
});

socket.on('bossAttack', (data) => {
  handleBossAttack(data);
});

socket.on('bossDefeated', () => {
  gameInProgress = false;
  showVictoryScreen();
  console.log('Boss sconfitto! Victoria!');
});

socket.on('obstaclesUpdate', (data) => {
  coopObstacles = data;
  updateObstaclesDisplay();
});

socket.on('spawnBullet', (data) => {
  createBulletEffect(data);
});

// === DUEL EVENTS ===
socket.on('duel_queue_joined', (data) => {
  console.log(`In coda posizione ${data.position}, attesa stimata: ${data.estimatedWait}s`);
  updateQueueStatus(data);
});

socket.on('duel_queue_left', () => {
  duelState.inQueue = false;
  hideDuelQueueUI();
});

socket.on('duel_match_found', (data) => {
  console.log('Match trovato!', data);
  
  duelState.inQueue = false;
  duelState.inDuel = true;
  duelState.room = data.room;
  duelState.opponent = data.opponent;
  
  gameMode = 'duel';
  updateUI();
  
  // Reset player per duello
  currentPlayer.x = 150; // o 650 se sei p2
  currentPlayer.y = 300;
  currentPlayer.health = 100;
  currentPlayer.maxHealth = 100;
  currentPlayer.energy = 100;
  currentPlayer.maxEnergy = 100;
  currentPlayer.shields = 0;
  currentPlayer.effects = {};
  
  showDuelStartScreen(data);
});

socket.on('duel_state', (data) => {
  if (!duelState.inDuel) return;
  
  // Aggiorna stati
  duelState.myState = data.myState;
  duelState.opponent = { ...duelState.opponent, ...data.opponent };
  duelState.powerups = data.powerups;
  duelState.obstacles = data.obstacles;
  duelState.bullets = data.bullets;
  duelState.events = data.events;
  duelState.timeRemaining = data.timeRemaining;
  duelState.roundInfo = data.roundInfo;
  
  // Aggiorna currentPlayer con dati server
  currentPlayer = { ...currentPlayer, ...data.myState };
  
  // Processa eventi
  data.events.forEach(event => handleDuelEvent(event));
  
  updateDuelDisplay();
});

socket.on('duel_new_round', (data) => {
  console.log(`Nuovo round ${data.roundNumber}!`);
  showRoundTransition(data);
});

socket.on('duel_end', (data) => {
  console.log('Duello terminato:', data);
  
  duelState.inDuel = false;
  duelState.room = null;
  
  showDuelEndScreen(data);
  
  setTimeout(() => {
    gameMode = 'lobby';
    updateUI();
  }, 5000);
});

socket.on('duel_opponent_disconnected', (data) => {
  console.log('Avversario disconnesso:', data);
  showDisconnectWin(data);
  
  duelState.inDuel = false;
  duelState.room = null;
  
  setTimeout(() => {
    gameMode = 'lobby';
    updateUI();
  }, 3000);
});

socket.on('duel_leaderboard', (data) => {
  showLeaderboard(data);
});

socket.on('player_stats', (data) => {
  showPlayerStats(data);
});

socket.on('duel_chat_message', (data) => {
  addDuelChatMessage(data);
});

// === SPECTATOR EVENTS ===
socket.on('spectate_start', (data) => {
  console.log('Inizio spettatore:', data);
  
  duelState.spectating = true;
  duelState.spectatingRoom = data.room;
  gameMode = 'duel';
  
  // Setup visualizzazione spettatore
  setupSpectatorView(data);
  updateUI();
});

socket.on('spectate_ended', () => {
  stopSpectating();
});

// === VOICE CHAT EVENTS ===
socket.on('voiceActive', (data) => {
  const { id, active } = data;
  
  if (active && id !== socket.id && isVoiceActive) {
    // Inizia connessione WebRTC
    setupWebRTCConnection(id);
  } else if (!active && peerConnections[id]) {
    // Chiudi connessione
    peerConnections[id].close();
    delete peerConnections[id];
    
    const audio = document.getElementById(`audio-${id}`);
    if (audio) audio.remove();
  }
});

socket.on('webrtc-offer', async (data) => {
  if (!isVoiceActive) return;
  
  const pc = await setupWebRTCConnection(data.fromId);
  await pc.setRemoteDescription(data.sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  
  socket.emit('webrtc-answer', {
    targetId: data.fromId,
    sdp: answer
  });
});

socket.on('webrtc-answer', async (data) => {
  const pc = peerConnections[data.fromId];
  if (pc) {
    await pc.setRemoteDescription(data.sdp);
  }
});

socket.on('webrtc-ice', async (data) => {
  const pc = peerConnections[data.fromId];
  if (pc) {
    await pc.addIceCandidate(data.candidate);
  }
});

// === CHAT EVENTS ===
socket.on('chatMessage', (data) => {
  chatMessages.push({
    nickname: data.nickname,
    text: data.text,
    timestamp: Date.now()
  });
  updateChat();
});

// === SERVER EVENTS ===
socket.on('server_shutdown', (data) => {
  alert(data.message);
});

// === DISPLAY FUNCTIONS ===
function updateBossDisplay() {
  // Aggiorna visualizzazione boss nel canvas o UI
  const bossHealthBar = document.getElementById('bossHealthBar');
  if (bossHealthBar) {
    const healthPercent = (coopBoss.health / coopBoss.maxHealth) * 100;
    bossHealthBar.style.width = `${healthPercent}%`;
  }
  
  const bossInfo = document.getElementById('bossInfo');
  if (bossInfo) {
    bossInfo.textContent = `Boss: ${coopBoss.health}/${coopBoss.maxHealth} HP`;
  }
}

function updateObstaclesDisplay() {
  // Questa funzione sarà chiamata dal tuo codice di rendering canvas
  // coopObstacles contiene tutti gli ostacoli da disegnare
}

function createBulletEffect(bulletData) {
  // Crea effetto visuale per il bullet
  // Implementa nel tuo sistema di rendering
}

function handleBossAttack(attackData) {
  console.log(`Boss attacco: ${attackData.pattern} a (${attackData.x}, ${attackData.y})`);
  // Implementa logica specifica per ogni pattern di attacco
  
  switch(attackData.pattern) {
    case 'basic':
      // Singolo proiettile verso giocatori
      break;
    case 'spread':
      // Ventaglio di proiettili
      break;
    case 'tracking':
      // Proiettili che seguono i giocatori
      break;
    case 'wave':
      // Onda di proiettili
      break;
    case 'laser':
      // Laser continuo
      break;
    case 'swarm':
      // Sciame di mini-proiettili
      break;
    case 'spiral':
      // Spirale di proiettili
      break;
    case 'chaos':
      // Attacco caotico
      break;
    case 'ultimate':
      // Attacco finale devastante
      break;
  }
}

function handleDuelEvent(event) {
  switch(event.type) {
    case 'shoot':
      createDuelBulletEffect(event.bullet);
      break;
    case 'hit':
      showHitEffect(event.target, event.damage);
      break;
    case 'powerup_collected':
      showPowerupEffect(event.player, event.powerupType);
      break;
    case 'obstacle_destroyed':
      showObstacleDestroyEffect(event.obstacleId);
      break;
  }
}

function createDuelBulletEffect(bulletData) {
  // Crea effetto visuale per bullet nel duello
  // Il bullet sarà tracciato server-side per hit detection
}

function showHitEffect(targetId, damage) {
  // Mostra numero di danno e effetto hit
  console.log(`Hit: ${damage} danni a ${targetId}`);
}

function showPowerupEffect(playerId, powerupType) {
  // Mostra effetto raccolta powerup
  console.log(`${playerId} ha raccolto ${powerupType}`);
}

function showObstacleDestroyEffect(obstacleId) {
  // Effetto distruzione ostacolo
}

function updateDuelDisplay() {
  // Aggiorna UI specifica del duello
  const opponentInfo = document.getElementById('opponentInfo');
  if (opponentInfo && duelState.opponent) {
    const opp = duelState.opponent;
    opponentInfo.innerHTML = `
      <div class="opponent-card">
        <span class="opponent-name">${opp.nickname}</span>
        <span class="opponent-rating">⭐ ${opp.rating}</span>
        <div class="opponent-health">
          <div class="health-bar" style="width: ${(opp.health/opp.maxHealth)*100}%"></div>
        </div>
      </div>
    `;
  }
  
  const timeDisplay = document.getElementById('timeRemaining');
  if (timeDisplay) {
    const minutes = Math.floor(duelState.timeRemaining / 60000);
    const seconds = Math.floor((duelState.timeRemaining % 60000) / 1000);
    timeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  
  const roundDisplay = document.getElementById('roundInfo');
  if (roundDisplay && duelState.roundInfo) {
    roundDisplay.innerHTML = `
      <div class="round-info">
        <span>Round ${duelState.roundInfo.current}/${duelState.roundInfo.bestOf}</span>
        <div class="wins-display">
          <span class="p1-wins">${duelState.roundInfo.wins[Object.keys(duelState.roundInfo.wins)[0]] || 0}</span>
          <span class="separator">-</span>
          <span class="p2-wins">${duelState.roundInfo.wins[Object.keys(duelState.roundInfo.wins)[1]] || 0}</span>
        </div>
      </div>
    `;
  }
  
  // Aggiorna powerups display
  updatePowerupsDisplay();
}

function updatePowerupsDisplay() {
  const powerupsContainer = document.getElementById('powerupsContainer');
  if (!powerupsContainer || !duelState.powerups) return;
  
  powerupsContainer.innerHTML = '';
  duelState.powerups.forEach(powerup => {
    const powerupEl = document.createElement('div');
    powerupEl.className = `powerup powerup-${powerup.type}`;
    powerupEl.style.left = `${powerup.x}px`;
    powerupEl.style.top = `${powerup.y}px`;
    powerupEl.onclick = () => collectPowerup(powerup.id);
    
    const icon = getPowerupIcon(powerup.type);
    powerupEl.innerHTML = `<span class="powerup-icon">${icon}</span>`;
    
    powerupsContainer.appendChild(powerupEl);
  });
}

function getPowerupIcon(type) {
  const icons = {
    'health': '❤️',
    'energy': '⚡',
    'shield': '🛡️',
    'damage': '💥',
    'speed': '💨',
    'rapid': '🔥'
  };
  return icons[type] || '❓';
}

function updateQueueStatus(data) {
  const queueUI = document.getElementById('duelQueue');
  if (queueUI) {
    queueUI.innerHTML = `
      <div class="queue-status">
        <h3>🔍 Cercando avversario...</h3>
        <p>Posizione in coda: ${data.position}</p>
        <p>Attesa stimata: ${Math.ceil(data.estimatedWait/1000)}s</p>
        <div class="spinner"></div>
        <button onclick="cancelDuelQueue()">Annulla</button>
      </div>
    `;
  }
}

function showDuelStartScreen(matchData) {
  const startScreen = document.getElementById('duelStartScreen');
  if (startScreen) {
    startScreen.style.display = 'block';
    startScreen.innerHTML = `
      <div class="duel-vs-screen">
        <div class="player-card">
          <h3>${currentPlayer.nickname}</h3>
          <p>⭐ ${getPlayerRating(socket.id)}</p>
        </div>
        <div class="vs-divider">VS</div>
        <div class="player-card">
          <h3>${matchData.opponent.nickname}</h3>
          <p>⭐ ${matchData.opponent.rating}</p>
        </div>
        <div class="countdown" id="duelCountdown">3</div>
      </div>
    `;
    
    // Countdown 3-2-1-GO
    let count = 3;
    const countdownEl = document.getElementById('duelCountdown');
    const countdownInterval = setInterval(() => {
      count--;
      if (countdownEl) {
        countdownEl.textContent = count > 0 ? count : 'GO!';
      }
      
      if (count <= 0) {
        clearInterval(countdownInterval);
        setTimeout(() => {
          if (startScreen) startScreen.style.display = 'none';
        }, 500);
      }
    }, 1000);
  }
}

function showRoundTransition(data) {
  const transitionScreen = document.getElementById('roundTransition');
  if (transitionScreen) {
    transitionScreen.style.display = 'block';
    transitionScreen.innerHTML = `
      <div class="round-transition">
        <h2>Round ${data.roundNumber}</h2>
        <div class="round-score">
          <span>${data.roundWins[Object.keys(data.roundWins)[0]] || 0}</span>
          <span>-</span>
          <span>${data.roundWins[Object.keys(data.roundWins)[1]] || 0}</span>
        </div>
        <div class="countdown" id="roundCountdown">3</div>
      </div>
    `;
    
    let count = 3;
    const countdownEl = document.getElementById('roundCountdown');
    const countdownInterval = setInterval(() => {
      count--;
      if (countdownEl) {
        countdownEl.textContent = count > 0 ? count : 'FIGHT!';
      }
      
      if (count <= 0) {
        clearInterval(countdownInterval);
        setTimeout(() => {
          if (transitionScreen) transitionScreen.style.display = 'none';
        }, 500);
      }
    }, 1000);
  }
}

function showDuelEndScreen(data) {
  const endScreen = document.getElementById('duelEndScreen');
  if (endScreen) {
    endScreen.style.display = 'block';
    
    const isWinner = data.winner === socket.id;
    const isDraw = data.winner === 'draw';
    
    let resultText = '';
    let resultClass = '';
    
    if (isDraw) {
      resultText = 'PAREGGIO!';
      resultClass = 'draw';
    } else if (isWinner) {
      resultText = 'VITTORIA!';
      resultClass = 'victory';
    } else {
      resultText = 'SCONFITTA';
      resultClass = 'defeat';
    }
    
    const myStats = data.stats[socket.id] || {};
    const oppId = Object.keys(data.stats).find(id => id !== socket.id);
    const oppStats = data.stats[oppId] || {};
    
    endScreen.innerHTML = `
      <div class="duel-end-screen ${resultClass}">
        <h2 class="result-title">${resultText}</h2>
        
        <div class="final-score">
          <span>${data.finalRoundWins[socket.id] || 0}</span>
          <span>-</span>
          <span>${data.finalRoundWins[oppId] || 0}</span>
        </div>
        
        <div class="stats-comparison">
          <div class="my-stats">
            <h4>Le tue statistiche</h4>
            <p>Danni inflitti: ${Math.round(myStats.damage || 0)}</p>
            <p>Precisione: ${myStats.shots > 0 ? Math.round((myStats.hits/myStats.shots)*100) : 0}%</p>
            <p>Powerup raccolti: ${myStats.powerupsCollected || 0}</p>
            <p>Nuovo rating: ⭐ ${data.newRatings[socket.id]}</p>
          </div>
          
          <div class="opp-stats">
            <h4>Avversario</h4>
            <p>Danni inflitti: ${Math.round(oppStats.damage || 0)}</p>
            <p>Precisione: ${oppStats.shots > 0 ? Math.round((oppStats.hits/oppStats.shots)*100) : 0}%</p>
            <p>Powerup raccolti: ${oppStats.powerupsCollected || 0}</p>
            <p>Nuovo rating: ⭐ ${data.newRatings[oppId]}</p>
          </div>
        </div>
        
        <div class="end-actions">
          <button onclick="joinDuelQueue()">Nuovo Duello</button>
          <button onclick="getLeaderboard()">Classifica</button>
          <button onclick="backToLobby()">Lobby</button>
        </div>
      </div>
    `;
  }
}

function showDisconnectWin(data) {
  const endScreen = document.getElementById('duelEndScreen');
  if (endScreen) {
    endScreen.style.display = 'block';
    endScreen.innerHTML = `
      <div class="duel-end-screen victory">
        <h2>VITTORIA PER ABBANDONO!</h2>
        <p>Il tuo avversario si è disconnesso</p>
        <p>Nuovo rating: ⭐ ${data.newRating}</p>
        <div class="end-actions">
          <button onclick="joinDuelQueue()">Nuovo Duello</button>
          <button onclick="backToLobby()">Lobby</button>
        </div>
      </div>
    `;
  }
}

function showVictoryScreen() {
  const victoryScreen = document.getElementById('victoryScreen');
  if (victoryScreen) {
    victoryScreen.style.display = 'block';
    victoryScreen.innerHTML = `
      <div class="victory-screen">
        <h1>🎉 BOSS SCONFITTO! 🎉</h1>
        <p>Congratulazioni al team!</p>
        <button onclick="backToLobby()">Torna alla Lobby</button>
      </div>
    `;
  }
}

function showLeaderboard(data) {
  const leaderboardModal = document.getElementById('leaderboardModal');
  if (leaderboardModal) {
    leaderboardModal.style.display = 'block';
    
    let leaderboardHTML = `
      <div class="leaderboard-content">
        <h2>🏆 Classifica Duelli</h2>
        <div class="your-rank">
          Il tuo rank: ${data.yourRank > 0 ? `#${data.yourRank}` : 'Non classificato'} 
          su ${data.totalPlayers} giocatori
        </div>
        <div class="leaderboard-list">
    `;
    
    data.leaderboard.forEach((entry, index) => {
      const isYou = entry.id === socket.id;
      leaderboardHTML += `
        <div class="leaderboard-entry ${isYou ? 'is-you' : ''}">
          <span class="rank">#${index + 1}</span>
          <span class="nickname">${entry.nickname}${isYou ? ' (Tu)' : ''}</span>
          <span class="rating">⭐ ${entry.rating}</span>
          <span class="record">${entry.wins}W-${entry.losses}L</span>
          <span class="accuracy">${Math.round(entry.accuracy)}%</span>
        </div>
      `;
    });
    
    leaderboardHTML += `
        </div>
        <button onclick="closeLeaderboard()">Chiudi</button>
      </div>
    `;
    
    leaderboardModal.innerHTML = leaderboardHTML;
  }
}

function showPlayerStats(data) {
  const statsModal = document.getElementById('statsModal');
  if (statsModal) {
    statsModal.style.display = 'block';
    statsModal.innerHTML = `
      <div class="stats-content">
        <h2>📊 Le tue statistiche</h2>
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">Rating</span>
            <span class="stat-value">⭐ ${data.rating}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Rank</span>
            <span class="stat-value">#${data.rank > 0 ? data.rank : 'N/A'}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Vittorie</span>
            <span class="stat-value">${data.wins}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Sconfitte</span>
            <span class="stat-value">${data.losses}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Win Rate</span>
            <span class="stat-value">${Math.round(data.winRate)}%</span>
          </div>
        </div>
        <button onclick="closeStats()">Chiudi</button>
      </div>
    `;
  }
}

function setupSpectatorView(data) {
  const spectatorUI = document.getElementById('spectatorUI');
  if (spectatorUI) {
    spectatorUI.style.display = 'block';
    spectatorUI.innerHTML = `
      <div class="spectator-hud">
        <h3>👁️ Modalità Spettatore</h3>
        <div class="spectator-players">
          <div class="spec-player">
            <span>${data.players.p1.nickname}</span>
            <span>⭐ ${data.players.p1.rating}</span>
          </div>
          <span class="vs">VS</span>
          <div class="spec-player">
            <span>${data.players.p2.nickname}</span>
            <span>⭐ ${data.players.p2.rating}</span>
          </div>
        </div>
        <button onclick="stopSpectating()">Smetti di Spettare</button>
      </div>
    `;
  }
}

function addDuelChatMessage(data) {
  const duelChat = document.getElementById('duelChat');
  if (duelChat) {
    const msgEl = document.createElement('div');
    msgEl.className = 'duel-chat-message';
    msgEl.innerHTML = `<strong>${data.nickname}:</strong> ${data.message}`;
    duelChat.appendChild(msgEl);
    
    // Mantieni solo ultimi 20 messaggi
    while (duelChat.children.length > 20) {
      duelChat.removeChild(duelChat.firstChild);
    }
    
    duelChat.scrollTop = duelChat.scrollHeight;
  }
}

// === UI ACTION FUNCTIONS ===
function backToLobby() {
  gameMode = 'lobby';
  duelState = {
    inQueue: false,
    inDuel: false,
    room: null,
    opponent: null,
    spectating: false,
    spectatingRoom: null
  };
  
  // Nascondi tutti i modal/screen
  hideAllModals();
  updateUI();
}

function closeLeaderboard() {
  const leaderboardModal = document.getElementById('leaderboardModal');
  if (leaderboardModal) leaderboardModal.style.display = 'none';
}

function closeStats() {
  const statsModal = document.getElementById('statsModal');
  if (statsModal) statsModal.style.display = 'none';
}

function hideAllModals() {
  const modals = [
    'leaderboardModal', 'statsModal', 'duelEndScreen', 
    'duelStartScreen', 'roundTransition', 'victoryScreen', 'spectatorUI'
  ];
  
  modals.forEach(modalId => {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
  });
}

// === POWERUP COLLECTION LOGIC ===
function checkPowerupCollisions() {
  if (!duelState.powerups || !duelState.inDuel) return;
  
  duelState.powerups.forEach(powerup => {
    const distance = Math.sqrt(
      Math.pow(currentPlayer.x - powerup.x, 2) + 
      Math.pow(currentPlayer.y - powerup.y, 2)
    );
    
    if (distance < 30) { // Raggio di raccolta
      collectPowerup(powerup.id);
    }
  });
}

// === COLLISION DETECTION ===
function checkBulletCollisions() {
  if (!duelState.bullets || !duelState.inDuel) return;
  
  duelState.bullets.forEach(bullet => {
    // Controlla collision con il nostro player
    if (bullet.ownerId !== socket.id) {
      const distance = Math.sqrt(
        Math.pow(currentPlayer.x - bullet.x, 2) + 
        Math.pow(currentPlayer.y - bullet.y, 2)
      );
      
      if (distance < 25) { // Hit!
        confirmHit(bullet.id, bullet.damage, socket.id);
        
        // Applica danno localmente per feedback immediato
        let actualDamage = bullet.damage;
        if (currentPlayer.shields > 0) {
          actualDamage *= 0.5;
        }
        
        currentPlayer.health = Math.max(0, currentPlayer.health - actualDamage);
        showLocalHitEffect(actualDamage);
      }
    }
    
    // Controlla collision con ostacoli
    duelState.obstacles.forEach(obstacle => {
      const distance = Math.sqrt(
        Math.pow(obstacle.x - bullet.x, 2) + 
        Math.pow(obstacle.y - bullet.y, 2)
      );
      
      if (distance < obstacle.size) {
        hitObstacle(obstacle.id);
      }
    });
  });
}

function showLocalHitEffect(damage) {
  // Effetto visuale quando veniamo colpiti
  const canvas = document.getElementById('gameCanvas');
  if (canvas) {
    canvas.style.filter = 'hue-rotate(0deg) brightness(1.5)';
    setTimeout(() => {
      canvas.style.filter = '';
    }, 200);
  }
  
  // Mostra numero danno
  const damageEl = document.createElement('div');
  damageEl.className = 'damage-number';
  damageEl.textContent = `-${Math.round(damage)}`;
  damageEl.style.left = `${currentPlayer.x}px`;
  damageEl.style.top = `${currentPlayer.y - 30}px`;
  document.body.appendChild(damageEl);
  
  setTimeout(() => damageEl.remove(), 1000);
}

// === ENHANCED GAME LOOP ===
function enhancedGameLoop() {
  // Logica base movimento (già presente nel gameLoop originale)
  gameLoop();
  
  // Controlli specifici per modalità duello
  if (gameMode === 'duel' && duelState.inDuel) {
    checkPowerupCollisions();
    checkBulletCollisions();
    updateDuelEffects();
  }
  
  requestAnimationFrame(enhancedGameLoop);
}

function updateDuelEffects() {
  // Aggiorna effetti visivi per powerup attivi
  const playerShip = document.getElementById('playerShip');
  if (playerShip) {
    playerShip.className = 'player-ship';
    
    if (currentPlayer.effects?.shield) {
      playerShip.classList.add('shielded');
    }
    if (currentPlayer.effects?.speed) {
      playerShip.classList.add('speed-boost');
    }
    if (currentPlayer.effects?.damage) {
      playerShip.classList.add('damage-boost');
    }
    if (currentPlayer.effects?.rapidFire) {
      playerShip.classList.add('rapid-fire');
    }
  }
}

// === TOURNAMENT FUNCTIONS (Future) ===
function createTournament() {
  socket.emit('create_tournament', {
    name: 'Tournament Test',
    maxPlayers: 8,
    format: 'single_elimination'
  });
}

// === ADMIN FUNCTIONS ===
function sendAdminCommand(command, ...args) {
  socket.emit('admin_command', { command, args });
}

// === INITIALIZATION ===
function initializeClient() {
  console.log('Stellar Guardian Client initialized');
  
  // Setup event listeners
  setupEventListeners();
  
  // Avvia game loop
  enhancedGameLoop();
  
  // Auto-join lobby se nickname già impostato
  const savedNickname = localStorage.getItem('stellarGuardianNickname');
  if (savedNickname) {
    currentPlayer.nickname = savedNickname;
    const nicknameInput = document.getElementById('nicknameInput');
    if (nicknameInput) nicknameInput.value = savedNickname;
  }
}

function setupEventListeners() {
  // Enter key per chat
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendChatMessage();
      }
    });
  }
  
  // Salva nickname quando cambia
  const nicknameInput = document.getElementById('nicknameInput');
  if (nicknameInput) {
    nicknameInput.addEventListener('change', (e) => {
      currentPlayer.nickname = e.target.value;
      localStorage.setItem('stellarGuardianNickname', e.target.value);
    });
  }
  
  // Gestione tab/window close
  window.addEventListener('beforeunload', () => {
    if (duelState.inDuel || duelState.inQueue) {
      return 'Sei in un duello o in coda. Sei sicuro di voler uscire?';
    }
  });
  
  // Gestione focus/blur per pause
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && gameMode === 'duel') {
      // Pausa input quando tab non è attiva
      keys = {};
      mouse.down = false;
    }
  });
}

// === HELPER FUNCTIONS ===
function getPlayerRating(playerId) {
  // Fallback per rating locale (viene sovrascritto dal server)
  return 1000;
}

function formatTime(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// === EXPORT FUNCTIONS (se necessario per il tuo sistema) ===
window.stellarGuardian = {
  // Core functions
  joinLobby,
  startCoopRaid,
  joinDuelQueue,
  cancelDuelQueue,
  spectateRandomDuel,
  stopSpectating,
  
  // Chat & Social
  sendChatMessage,
  toggleVoiceChat,
  getLeaderboard,
  getPlayerStats,
  
  // Game actions
  shootBullet,
  movePlayer,
  damageBoss,
  hitObstacle,
  collectPowerup,
  
  // Utility
  backToLobby,
  showNotification,
  
  // State access
  getCurrentPlayer: () => currentPlayer,
  getDuelState: () => duelState,
  getGameMode: () => gameMode,
  getBoss: () => coopBoss,
  getObstacles: () => coopObstacles
};

// === AUTO-INITIALIZATION ===
document.addEventListener('DOMContentLoaded', () => {
  initializeClient();
});

// === CONNECTION STATUS ===
socket.on('connect', () => {
  console.log('Connesso al server Stellar Guardian');
  showNotification('Connesso al server!', 'success');
  currentPlayer.id = socket.id;
});

socket.on('disconnect', (reason) => {
  console.log('Disconnesso dal server:', reason);
  showNotification('Disconnesso dal server', 'error');
  
  // Reset stati
  gameMode = 'lobby';
  duelState.inQueue = false;
  duelState.inDuel = false;
  isVoiceActive = false;
  
  // Chiudi connessioni WebRTC
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};
});

socket.on('reconnect', () => {
  console.log('Riconnesso al server');
  showNotification('Riconnesso!', 'success');
  
  // Re-join lobby se avevamo un nickname
  if (currentPlayer.nickname) {
    joinLobby();
  }
});

// === ERROR HANDLING ===
socket.on('connect_error', (error) => {
  console.error('Errore connessione:', error);
  showNotification('Errore di connessione', 'error');
});

socket.on('error', (error) => {
  console.error('Errore socket:', error);
  showNotification('Errore di rete', 'error');
});

// === DEBUG FUNCTIONS (rimuovi in produzione) ===
window.debugStellar = {
  getSocket: () => socket,
  getCurrentState: () => ({
    gameMode,
    currentPlayer,
    duelState,
    coopBoss,
    otherPlayers
  }),
  forceGameMode: (mode) => {
    gameMode = mode;
    updateUI();
  },
  simulateHit: (damage) => showLocalHitEffect(damage),
  testNotification: (msg, type) => showNotification(msg, type)
};

console.log('🚀 Stellar Guardian Client caricato!');
console.log('💡 Usa debugStellar per debugging (rimuovi in produzione)');
console.log('🎮 Comandi: WASD/Frecce=movimento, Mouse=mira, Click=sparo, V=voice, Tab=classifica, Enter=chat');

window.stellarGuardian = {
    joinDuelQueue,
    // altre funzioni
  };

})(); // <--- questa chiude la funzione!
