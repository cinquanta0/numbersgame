const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let waitingPlayer = null;

io.on('connection', (socket) => {
  console.log(`Giocatore connesso: ${socket.id}`);

  if (waitingPlayer) {
    // Abbina due giocatori
    const room = `room-${waitingPlayer.id}-${socket.id}`;
    socket.join(room);
    waitingPlayer.join(room);

    io.to(room).emit('startMatch', { room });
    waitingPlayer = null;
  } else {
    // Attendi un secondo giocatore
    waitingPlayer = socket;
    socket.emit('waiting', 'In attesa di un avversario...');
  }

  socket.on('guessNumber', (data) => {
    // Invia il numero all'altro giocatore
    socket.to(data.room).emit('opponentGuess', data.guess);
  });

  socket.on('disconnect', () => {
    console.log(`Giocatore disconnesso: ${socket.id}`);
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }
  });
});

server.listen(3000, () => {
  console.log('Server attivo sulla porta 3000');
});
