const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public")); // per servire HTML + JS

const rooms = {}; // { roomCode: { players: [], ... } }

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// Funzione per ottenere i tentativi in base alla difficoltà
function getTentativiPerModalita(difficulty) {
    switch (difficulty) {
        case 'easy': return 10;
        case 'medium': return 9;
        case 'hard': return 8;
        case 'hardcore': return 12;
        default: return 10;
    }
}

// Calcolo del numero casuale per il livello e la difficoltà
function getRandomNumber(level, difficulty) {
    let increment;
    switch (difficulty) {
        case 'easy': increment = 30; break;
        case 'medium': increment = 60; break;
        case 'hard': increment = 150; break;
        case 'hardcore': increment = 300; break;
        default: increment = 30;
    }

    const min = increment * (level - 1);
    const max = min + increment;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

io.on("connection", socket => {
    let roomCode = null;
    let playerName = null;

    // Creazione stanza
    socket.on("createRoom", (playerNameParam, difficulty = 'easy') => {
        playerName = playerNameParam;
        const roomCodeGenerated = generateRoomCode();
        roomCode = roomCodeGenerated;

        const tentativi = getTentativiPerModalita(difficulty);

        rooms[roomCode] = {
            players: [{
                id: socket.id,
                name: playerName,
                tentativi
            }],
            currentTurn: 0,
            numberToGuess: getRandomNumber(1, difficulty),
            level: 1,
            difficulty
        };

        socket.join(roomCode);
        socket.emit("roomCreated", roomCode);
    });

    // Join stanza esistente
    socket.on("joinRoom", ({ roomCode: enteredRoomCode, playerName: enteredPlayerName }) => {
        const room = rooms[enteredRoomCode];
        if (room && room.players.length < 2) {
            playerName = enteredPlayerName;
            roomCode = enteredRoomCode;

            const tentativi = getTentativiPerModalita(room.difficulty);

            room.players.push({
                id: socket.id,
                name: playerName,
                tentativi
            });

            socket.join(roomCode);
            io.to(roomCode).emit("joinedRoom", roomCode);
            updateGameState(roomCode);
        } else {
            socket.emit("error", "Stanza piena o non esistente");
        }
    });

    // Gestione tentativo
    socket.on("playerGuess", ({ roomCode, playerName, guess }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const currentPlayer = room.players[room.currentTurn];
        if (socket.id !== currentPlayer.id) return;

        let feedback = "";
        if (guess === room.numberToGuess) {
            feedback = `Bravo ${currentPlayer.name}! Hai indovinato!`;
            room.level++;
            room.numberToGuess = getRandomNumber(room.level, room.difficulty);

            const tentativi = getTentativiPerModalita(room.difficulty);
            room.players.forEach(player => player.tentativi = tentativi);
        } else {
            currentPlayer.tentativi--;
            feedback = guess < room.numberToGuess ? "Troppo basso!" : "Troppo alto!";

            if (currentPlayer.tentativi <= 0) {
                feedback = `Game over! Era ${room.numberToGuess}`;
                const tentativi = getTentativiPerModalita(room.difficulty);
                room.players.forEach(player => player.tentativi = tentativi);
                room.numberToGuess = getRandomNumber(1, room.difficulty);
                room.level = 1;
            }
        }

        room.currentTurn = (room.currentTurn + 1) % room.players.length;
        updateGameState(roomCode, feedback);
    });

    // Chat
    socket.on('chatMessage', (message) => {
        if (roomCode) {
            io.to(roomCode).emit('chatMessage', {
                playerName: playerName,
                message
            });
        }
    });

    // Disconnessione
    socket.on('disconnect', () => {
        if (roomCode) {
            const room = rooms[roomCode];
            if (room) {
                room.players = room.players.filter(player => player.id !== socket.id);
                if (room.players.length === 0) {
                    delete rooms[roomCode];
                }
            }
        }
    });
});

// Funzione di aggiornamento stato del gioco
function updateGameState(roomCode, feedback = "") {
    const room = rooms[roomCode];
    if (!room) return;

    const currentPlayer = room.players[room.currentTurn];

    let rangeMax;
    switch (room.difficulty) {
        case 'easy': rangeMax = 30; break;
        case 'medium': rangeMax = 60; break;
        case 'hard': rangeMax = 150; break;
        case 'hardcore': rangeMax = 300; break;
        default: rangeMax = 30;
    }

    const min = rangeMax * (room.level - 1);
    const max = min + rangeMax;

    io.to(roomCode).emit("updateGame", {
        level: `Livello ${room.level}: Indovina un numero tra ${min} e ${max}`,
        tentativi: room.players.map(player => ({ name: player.name, tentativi: player.tentativi })),
        turnMessage: `Turno di ${currentPlayer.name}`,
        feedback
    });
}

server.listen(3000, () => {
    console.log("Server avviato su http://localhost:3000");
});

