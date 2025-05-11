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
    return Math.floor(Math.random() * (max + 1)); // Numero casuale tra 0 e livello*10
}

io.on("connection", socket => {
    let roomCode = null;
    let playerName = null;

    // Gestione creazione della stanza
    socket.on("createRoom", playerNameParam => {
        playerName = playerNameParam; // Salva il nome del giocatore
        const roomCodeGenerated = generateRoomCode();
        roomCode = roomCodeGenerated; // Assegna il codice della stanza al socket
        rooms[roomCode] = {
            players: [{
                id: socket.id,
                name: playerName,
                tentativi: 5, // Ogni giocatore ha i suoi tentativi
            }],
            currentTurn: 0,
            numberToGuess: getRandomNumber(1),
            level: 1,
        };
        socket.join(roomCode); // Unisce il giocatore alla stanza appena creata
        socket.emit("roomCreated", roomCode); // Invia il codice della stanza al client
    });

    // Gestione ingresso in una stanza esistente
    socket.on("joinRoom", ({ roomCode: enteredRoomCode, playerName: enteredPlayerName }) => {
        const room = rooms[enteredRoomCode];
        if (room && room.players.length < 2) {
            playerName = enteredPlayerName;
            roomCode = enteredRoomCode;
            room.players.push({
                id: socket.id,
                name: playerName,
                tentativi: 5, // Ogni nuovo giocatore ha i suoi tentativi
            });
            socket.join(roomCode); // Unisce il giocatore alla stanza
            io.to(roomCode).emit("joinedRoom", roomCode); // Avvisa gli altri giocatori
            updateGameState(roomCode);
        } else {
            socket.emit("error", "Stanza piena o non esistente");
        }
    });

    // Gestione del tentativo di un giocatore
    socket.on("playerGuess", ({ roomCode, playerName, guess }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const currentPlayer = room.players[room.currentTurn];
        if (socket.id !== currentPlayer.id) return;

        let feedback = "";
        if (guess === room.numberToGuess) {
            feedback = `Bravo ${currentPlayer.name}! Hai indovinato!`;
            room.level++;
            room.numberToGuess = getRandomNumber(room.level); // Nuovo numero per il livello successivo
            room.players.forEach(player => player.tentativi = 5); // Reset dei tentativi per tutti i giocatori
        } else {
            currentPlayer.tentativi--; // Riduci i tentativi solo per il giocatore corrente
            feedback = guess < room.numberToGuess ? "Troppo basso!" : "Troppo alto!";
            if (currentPlayer.tentativi <= 0) {
                feedback = `Game over! Era ${room.numberToGuess}`;
                room.players.forEach(player => player.tentativi = 5); // Reset tentativi per tutti
                room.numberToGuess = getRandomNumber(room.level); // Nuovo numero per il livello successivo
                room.level = 1; // Reset del livello
            }
        }

        room.currentTurn = (room.currentTurn + 1) % room.players.length; // Passa al prossimo giocatore
        updateGameState(roomCode, feedback);
    });

    // Gestione chat
    socket.on('chatMessage', (message) => {
        if (roomCode) { // Verifica che il giocatore sia in una stanza
            io.to(roomCode).emit('chatMessage', {
                playerName: playerName, // Invia il nome del giocatore
                message
            });
        }
    });

    // Quando il giocatore si disconnette, rimuoviamo la stanza se non ci sono più giocatori
    socket.on('disconnect', () => {
        if (roomCode) {
            const room = rooms[roomCode];
            if (room) {
                room.players = room.players.filter(player => player.id !== socket.id);
                if (room.players.length === 0) {
                    delete rooms[roomCode]; // Rimuove la stanza se non ci sono più giocatori
                }
            }
        }
    });
});

// Funzione per aggiornare lo stato del gioco per tutti i giocatori nella stanza
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

server.listen(3000, () => {
    console.log("Server avviato su http://localhost:3000");
});
