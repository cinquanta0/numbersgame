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
    const level = document.getElementById("difficulty-select").value;
    if (playerName) {
        socket.emit("createRoom", playerName, level);
    }
});

joinBtn.addEventListener("click", () => {
    playerName = playerNameInput.value.trim();
    roomCode = roomCodeInput.value.trim();
    const level = document.getElementById("difficulty-select").value;
    if (playerName && roomCode) {
        socket.emit("joinRoom", { roomCode, playerName, level });
    }
});

submitGuess.addEventListener("click", () => {
    const guess = parseInt(userGuessInput.value);
    if (!isNaN(guess)) {
        socket.emit("playerGuess", { roomCode, playerName, guess });
    }
});

// Gestione invio dei messaggi
const sendChatButton = document.getElementById("send-chat");
const chatInput = document.getElementById("chat-input");
const chatMessages = document.getElementById("chat-messages");

sendChatButton.addEventListener("click", () => {
    const message = chatInput.value.trim();
    if (message) {
        socket.emit("sendMessage", message); // Invia il messaggio al server
        chatInput.value = ""; // Pulisce il campo di input
    }
});

// Ricezione dei messaggi e visualizzazione nella chat
socket.on("receiveMessage", ({ playerName, message }) => {
    const messageElement = document.createElement("p");
    messageElement.innerHTML = `<strong>${playerName}:</strong> ${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Scrolla verso il basso per il nuovo messaggio
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
    tentativi.textContent = data.tentativi.map(player => `${player.name}: ${player.tentativi} tentativi`).join(", ");
    message.textContent = data.feedback;
});
