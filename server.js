const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = {};

io.on('connection', (socket) => {
  console.log('Un giocatore si è connesso:', socket.id);

  socket.on('join_game', (playerName) => {
    // Trova o crea una stanza con 1 solo giocatore
    let room = Object.keys(rooms).find(r => rooms[r].length === 1);
    if (!room) {
      room = `room_${socket.id}`;
      rooms[room] = [];
    }

    rooms[room].push({ id: socket.id, name: playerName });
    socket.join(room);

    console.log(`${playerName} è entrato nella ${room}`);

    if (rooms[room].length === 2) {
      // Inizia la sfida
      const secretNumber = Math.floor(Math.random() * 100) + 1;
      io.to(room).emit('game_start', {
        room,
        players: rooms[room].map(p => p.name),
        number: secretNumber
      });
    }
  });

  socket.on('guess', ({ room, guess }) => {
    const target = parseInt(rooms[room]?.target);
    if (!target) return;

    if (guess === target) {
      io.to(room).emit('game_result', {
        winner: socket.id
      });
      delete rooms[room]; // reset room
    } else {
      socket.emit('guess_feedback', guess < target ? 'Troppo basso' : 'Troppo alto');
    }
  });

  socket.on('disconnect', () => {
    for (const room in rooms) {
      rooms[room] = rooms[room].filter(p => p.id !== socket.id);
      if (rooms[room].length === 0) delete rooms[room];
    }
  });
});

server.listen(3000, () => {
  console.log('Server multiplayer attivo su http://localhost:3000');
});
