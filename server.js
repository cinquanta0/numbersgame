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

// Funzione per determinare il range in base al livello
function getRange(level) {
    if (level === "easy") return { max: 30, increment: 30 };
    if (level === "medium") return { max: 70, increment: 60 };
    if (level === "hard") return { max: 150, increment: 150 };
    if (level === "hardcore") return { max: 300, increment: 300 };
    return { max: 30, increment: 30 }; // Default facile
}

// Funzione per determinare il numero casuale in base al livello
function getRandomNumber(level) {
    const { max } = getRange(level);
    return Math.floor(Math.random() * (max + 1)); // Numero casuale tra 0 e max
}

// Funzione per determinare i tentativi in base al livello
function getAttempts(level) {
    if (level === "easy") return 10;
    if (level === "medium") return 10;
    if (level === "hard") return 10;
    if (level === "hardcore") return 10;
    return 10; // Default facile
}

io.on("connection", socket => {
    let roomCode = null;
    let playerName = null;
    let level = "easy"; // Default level is easy

    // Gestione creazione della stanza
    socket.on("createRoom", (playerNameParam, levelParam) => {
        playerName = playerNameParam; // Salva il nome del giocatore
        level = levelParam || "easy"; // Salva il livello selezionato
        const roomCodeGenerated = generateRoomCode();
        roomCode = roomCodeGenerated; // Assegna il codice della stanza al socket
        rooms[roomCode] = {
            players: [{
                id: socket.id,
                name: playerName,
                tentativi: getAttempts(level), // Imposta i tentativi in base al livello
            }],
            currentTurn: 0,
            numberToGuess: getRandomNumber(level),
            level: level,
        };
        socket.join(roomCode); // Unisce il giocatore alla stanza appena creata
        socket.emit("roomCreated", roomCode); // Invia il codice della stanza al client
    });

    // Gestione ingresso in una stanza esistente
    socket.on("joinRoom", ({ roomCode: enteredRoomCode, playerName: enteredPlayerName, levelParam }) => {
        const room = rooms[enteredRoomCode];
        if (room && room.players.length < 2) {
            playerName = enteredPlayerName;
            roomCode = enteredRoomCode;
            level = levelParam || "easy"; // Imposta il livello scelto
            room.players.push({
                id: socket.id,
                name: playerName,
                tentativi: getAttempts(level), // Imposta i tentativi in base al livello
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
            room.level = nextLevel(room.level); // Passa al livello successivo
            const { increment } = getRange(room.level);
            room.numberToGuess = getRandomNumber(room.level); // Nuovo numero da indovinare
            room.players.forEach(player => player.tentativi = getAttempts(room.level)); // Reset tentativi per tutti
        } else {
            currentPlayer.tentativi--; // Riduci i tentativi solo per il giocatore corrente
            feedback = guess < room.numberToGuess ? "Troppo basso!" : "Troppo alto!";
            if (currentPlayer.tentativi <= 0) {
                feedback = `Game over! Era ${room.numberToGuess}`;
                room.players.forEach(player => player.tentativi = getAttempts(room.level)); // Reset tentativi per tutti
                const { increment } = getRange(room.level);
                room.numberToGuess = getRandomNumber(room.level); // Nuovo numero per il livello successivo
                room.level = "easy"; // Reset livello
            }
        }

        room.currentTurn = (room.currentTurn + 1) % room.players.length; // Passa al prossimo giocatore
        updateGameState(roomCode, feedback);
    });

    // Funzione per determinare il prossimo livello
    function nextLevel(currentLevel) {
        if (currentLevel === "easy") return "medium";
        if (currentLevel === "medium") return "hard";
        if (currentLevel === "hard") return "hardcore";
        return "hardcore"; // Se è già hardcore, rimane hardcore
    }

    // Funzione per aggiornare lo stato del gioco per tutti i giocatori nella stanza
    function updateGameState(roomCode, feedback = "") {
        const room = rooms[roomCode];
        if (!room) return;

        const currentPlayer = room.players[room.currentTurn];

        io.to(roomCode).emit("updateGame", {
            level: `Livello ${room.level.toUpperCase()}: Indovina un numero tra 0 e ${getRange(room.level).max}`,
            tentativi: room.players.map(player => ({ name: player.name, tentativi: player.tentativi })),
            turnMessage: `Turno di ${currentPlayer.name}`,
            feedback,
        });
    }

    // Gestione della chat
    socket.on("sendMessage", (message) => {
        const room = rooms[roomCode];
        if (!room) return;

        // Invia il messaggio a tutti i giocatori nella stanza
        io.to(roomCode).emit("receiveMessage", {
            playerName: playerName,
            message: message
        });
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

server.listen(3000, () => {
    console.log("Server avviato su http://localhost:3000");
});
