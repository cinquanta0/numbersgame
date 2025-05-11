const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {}; // { roomCode: { players: [], ... } }

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getRandomNumber(level) {
    const max = level * 10;
    return Math.floor(Math.random() * (max + 1));
}

io.on("connection", socket => {
    let roomCode = null;
    let playerName = null;

    // Creazione stanza
    socket.on("createRoom", (playerNameParam, levelParam) => {
        playerName = playerNameParam;
        const level = parseInt(levelParam) || 1;
        roomCode = generateRoomCode();

        rooms[roomCode] = {
            players: [{
                id: socket.id,
                name: playerName,
                tentativi: 5,
            }],
            currentTurn: 0,
            numberToGuess: getRandomNumber(level),
            level: level,
        };

        socket.join(roomCode);
        socket.emit("roomCreated", roomCode);
    });

    // Entrata in stanza
    socket.on("joinRoom", ({ roomCode: enteredRoomCode, playerName: enteredPlayerName, level: levelParam }) => {
        const room = rooms[enteredRoomCode];
        if (room && room.players.length < 2) {
            playerName = enteredPlayerName;
            roomCode = enteredRoomCode;

            room.players.push({
                id: socket.id,
                name: playerName,
                tentativi: 5,
            });

            socket.join(roomCode);
            io.to(roomCode).emit("joinedRoom", roomCode);
            updateGameState(roomCode);
        } else {
            socket.emit("error", "Stanza piena o non esistente");
        }
    });

    // Tentativi
    socket.on("playerGuess", ({ roomCode, playerName, guess }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const currentPlayer = room.players[room.currentTurn];
        if (socket.id !== currentPlayer.id) return;

        let feedback = "";
        if (guess === room.numberToGuess) {
            feedback = `Bravo ${currentPlayer.name}! Hai indovinato!`;
            room.level++;
            room.numberToGuess = getRandomNumber(room.level);
            room.players.forEach(player => player.tentativi = 5);
        } else {
            currentPlayer.tentativi--;
            feedback = guess < room.numberToGuess ? "Troppo basso!" : "Troppo alto!";
            if (currentPlayer.tentativi <= 0) {
                feedback = `Game over! Era ${room.numberToGuess}`;
                room.level = 1;
                room.numberToGuess = getRandomNumber(room.level);
                room.players.forEach(player => player.tentativi = 5);
            }
        }

        room.currentTurn = (room.currentTurn + 1) % room.players.length;
        updateGameState(roomCode, feedback);
    });

    // Chat
    socket.on("sendMessage", (message) => {
        if (roomCode) {
            io.to(roomCode).emit("receiveMessage", {
                playerName,
                message
            });
        }
    });

    // Disconnessione
    socket.on("disconnect", () => {
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

// Funzione per aggiornare lo stato del gioco
function updateGameState(roomCode, feedback = "") {
    const room = rooms[roomCode];
    if (!room) return;

    const currentPlayer = room.players[room.currentTurn];

    io.to(roomCode).emit("updateGame", {
        level: `Livello ${room.level}: Indovina un numero tra 0 e ${room.level * 10}`,
        tentativi: room.players.map(player => ({ name: player.name, tentativi: player.tentativi })),
        turnMessage: `Turno di ${currentPlayer.name}`,
        feedback,
    });
}

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Server avviato sulla porta ${port}`);
});
