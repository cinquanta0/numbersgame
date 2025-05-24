const socket = io();

const lobby = document.getElementById("lobby");
const game = document.getElementById("game");
const createBtn = document.getElementById("create-game-btn");
const joinBtn = document.getElementById("join-game-btn");
const submitGuess = document.getElementById("submitGuess");

const playerNameInput = document.getElementById("playerName");
const roomCodeInput = document.getElementById("room-code");
const roomDisplay = document.getElementById("room-code-display");
const userGuessInput = document.getElementById("userGuess");

const difficultySelect = document.getElementById("difficulty");
const turnMessage = document.getElementById("turnMessage");
const message = document.getElementById("message");
const levelInfo = document.getElementById("level-info");
const tentativi = document.getElementById("tentativi");

// Recupera nome utente dalla sessione
let playerName = "";
const storedUser = localStorage.getItem("numeroquest_current_user");
if (storedUser) {
  playerName = JSON.parse(storedUser).username;
  if (playerNameInput) playerNameInput.value = playerName;
}

let roomCode = "";

createBtn.addEventListener("click", () => {
  const difficulty = difficultySelect.value;
  if (playerName && difficulty) {
    socket.emit("createRoom", playerName, difficulty);
  } else {
    alert("Inserisci un nome valido e scegli una difficoltà.");
  }
});

joinBtn.addEventListener("click", () => {
  roomCode = roomCodeInput.value.trim();
  if (playerName && roomCode) {
    socket.emit("joinRoom", { roomCode, playerName });
  } else {
    alert("Inserisci un nome valido e un codice stanza.");
  }
});

submitGuess.addEventListener("click", () => {
  const guess = parseInt(userGuessInput.value);
  if (!isNaN(guess)) {
    socket.emit("playerGuess", { roomCode, playerName, guess });
  }
});

socket.on("roomCreated", code => {
  roomCode = code;
  roomDisplay.textContent = code;
  lobby.style.display = "none";
  game.style.display = "block";
});

socket.on("joinedRoom", code => {
  roomCode = code;
  roomDisplay.textContent = code;
  lobby.style.display = "none";
  game.style.display = "block";
});

socket.on("updateGame", data => {
  levelInfo.textContent = data.level;
  turnMessage.textContent = data.turnMessage;
  tentativi.textContent = data.tentativi
    .map(player => `${player.name}: ${player.tentativi} tentativi`)
    .join(", ");
  message.textContent = data.feedback;
});

// Chat
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat');
const chatMessages = document.getElementById('chat-messages');

sendChatBtn.addEventListener('click', () => {
  const chatMessage = chatInput.value.trim();
  if (chatMessage) {
    socket.emit('chatMessage', chatMessage);
    chatInput.value = '';
  }
});

socket.on('chatMessage', ({ playerName, message }) => {
  const msgElement = document.createElement('p');
  msgElement.innerHTML = `<strong>${playerName}:</strong> ${message}`;
  chatMessages.appendChild(msgElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});
