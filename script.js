const socket = io();

// Elementi DOM
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

const chatInput = document.getElementById("chat-input");
const sendChatBtn = document.getElementById("send-chat");
const chatMessages = document.getElementById("chat-messages");

let roomCode = "";
let playerName = "";

// Creazione stanza
createBtn?.addEventListener("click", () => {
    playerName = playerNameInput.value.trim();
    if (playerName) {
        socket.emit("createRoom", playerName);
    }
});

// Unirsi stanza
joinBtn?.addEventListener("click", () => {
    playerName = playerNameInput.value.trim();
    roomCode = roomCodeInput.value.trim();
    if (playerName && roomCode) {
        socket.emit("joinRoom", { roomCode, playerName });
    }
});

// Invio tentativo
submitGuess?.addEventListener("click", () => {
    const guess = parseInt(userGuessInput.value);
    if (!isNaN(guess)) {
        socket.emit("playerGuess", { roomCode, playerName, guess });
        userGuessInput.value = ""; // Pulisci campo input
    }
});

// Ricezione info gioco
socket.on("updateGame", data => {
    levelInfo.textContent = data.level;
    turnMessage.textContent = data.turnMessage;
    tentativi.textContent = data.tentativi.map(player => `${player.name}: ${player.tentativi} tentativi`).join(", ");
    message.textContent = data.feedback;
});

// Mostra interfaccia gioco
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

// Invio messaggio chat
sendChatBtn?.addEventListener("click", () => {
    const msg = chatInput.value.trim();
    if (msg) {
        socket.emit("chatMessage", msg);
        chatInput.value = "";
    }
});

// Ricezione messaggio chat
socket.on("chatMessage", ({ playerName, message }) => {
    const msgEl = document.createElement("p");
    msgEl.innerHTML = `<strong>${playerName}:</strong> ${message}`;
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});
