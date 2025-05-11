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

const turnMessage = document.getElementById("turnMessage");
const message = document.getElementById("message");
const levelInfo = document.getElementById("level-info");
const tentativi = document.getElementById("tentativi");

let roomCode = "";
let playerName = "";

createBtn.addEventListener("click", () => {
    playerName = playerNameInput.value.trim();
    if (playerName) {
        socket.emit("createRoom", playerName);
    }
});

joinBtn.addEventListener("click", () => {
    playerName = playerNameInput.value.trim();
    roomCode = roomCodeInput.value.trim();
    if (playerName && roomCode) {
        socket.emit("joinRoom", { roomCode, playerName });
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
    levelInfo.textContent = `Livello: ${data.level}`;
    turnMessage.textContent = data.turnMessage;
    // Mostra tentativi per ogni giocatore
    tentativi.textContent = data.tentativi.map(player => `${player.name}: ${player.tentativi} tentativi`).join(", ");
    message.textContent = data.feedback;
});
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat');
const chatMessages = document.getElementById('chat-messages');

sendChatBtn.addEventListener('click', () => {
  const message = chatInput.value.trim();
  if (message) {
    socket.emit('chatMessage', message);
    chatInput.value = '';
  }
});

socket.on('chatMessage', ({ playerName, message }) => {
  const msgElement = document.createElement('p');
  msgElement.innerHTML = `<strong>${playerName}:</strong> ${message}`;
  chatMessages.appendChild(msgElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

