// server3.js - Stellar Guardian 2v2 Team Duel Server (PATCH: authoritative damage/collision)
//
// Avvio: node server3.js
// Richiede: npm install express socket.io
// Serve i file da ./public
// Gestisce matchmaking, room, sync e logica per la modalità 2v2

const express = require('express');
const path = require('path');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3003;

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

let queue2v2 = []; // [{ id, nickname, skin, elo }]
let activeRooms = {}; // roomId: { ... }
let roomCounter = 1;

function getNextRoomId() {
  return "2v2room" + (roomCounter++);
}
function findQueuedPlayer(socketId) {
  return queue2v2.find(p => p.id === socketId);
}
function broadcastLobbyUpdate() {
  const list = queue2v2.map(p => ({
    nickname: p.nickname,
    skin: p.skin,
    elo: p.elo,
    id: p.id
  }));
  io.emit('duel2v2_update', { players: list, count: list.length });
}
function assignTeams(fourPlayers) {
  const shuffled = fourPlayers.sort(() => Math.random() - 0.5);
  return {
    team1: [shuffled[0], shuffled[1]],
    team2: [shuffled[2], shuffled[3]],
  };
}

// PATCH: authoritative damage/collision
function processBullets(room) {
  // Copy bullets array (avoid mutation during loop)
  let bullets = Array.isArray(room.bullets) ? room.bullets.slice() : [];
  let newBullets = [];
  bullets.forEach(bullet => {
    let hit = false;
    // Team string: 'team1' or 'team2'
    const targetTeam = bullet.team === 'team1' ? room.team2 : room.team1;
    targetTeam.forEach(target => {
      if (target.health > 0) {
        const dist = Math.sqrt((bullet.x - target.x) ** 2 + (bullet.y - target.y) ** 2);
        if (dist < 32) {
          target.health = Math.max(0, target.health - (bullet.damage || 20));
          hit = true; // Mark for removal
        }
      }
    });
    if (!hit) newBullets.push(bullet);
  });
  room.bullets = newBullets;
}

io.on('connection', socket => {
  console.log("Nuovo client:", socket.id);

  socket.on('duel2v2_queue', data => {
    if (findQueuedPlayer(socket.id)) return;
    queue2v2.push({
      id: socket.id,
      nickname: data.nickname || "NoName",
      skin: data.skin || "navicella1.png",
      elo: data.elo || 1000
    });
    broadcastLobbyUpdate();

    if (queue2v2.length >= 4) {
      const roomId = getNextRoomId();
      const selected = queue2v2.slice(0, 4);
      queue2v2 = queue2v2.slice(4);

      const teams = assignTeams(selected);
      activeRooms[roomId] = {
        team1: teams.team1.map(p => ({
          id: p.id,
          nickname: p.nickname,
          skin: p.skin,
          elo: p.elo,
          x: 100,
          y: 600,
          health: 400,
          energy: 100,
          angle: 0
        })),
        team2: teams.team2.map(p => ({
          id: p.id,
          nickname: p.nickname,
          skin: p.skin,
          elo: p.elo,
          x: 1180,
          y: 120,
          health: 400,
          energy: 100,
          angle: 0
        })),
        roomId,
        state: "playing",
        bullets: [],
        round: 1,
        scores: { team1: 0, team2: 0 }
      };

      teams.team1.forEach((p, i) => {
        const playerSocket = io.sockets.sockets.get(p.id);
        if (playerSocket) {
          playerSocket.join(roomId);
          playerSocket.emit('duel2v2_ready', {
            yourTeam: 'team1',
            yourId: p.id,
            players: [...activeRooms[roomId].team1, ...activeRooms[roomId].team2],
            teammate: activeRooms[roomId].team1[1-i],
            opponents: activeRooms[roomId].team2,
            roomId: roomId
          });
        }
      });
      teams.team2.forEach((p, i) => {
        const playerSocket = io.sockets.sockets.get(p.id);
        if (playerSocket) {
          playerSocket.join(roomId);
          playerSocket.emit('duel2v2_ready', {
            yourTeam: 'team2',
            yourId: p.id,
            players: [...activeRooms[roomId].team1, ...activeRooms[roomId].team2],
            teammate: activeRooms[roomId].team2[1-i],
            opponents: activeRooms[roomId].team1,
            roomId: roomId
          });
        }
      });
      broadcastLobbyUpdate();
    }
  });

  socket.on('duel2v2_cancel', () => {
    queue2v2 = queue2v2.filter(p => p.id !== socket.id);
    broadcastLobbyUpdate();
  });

  socket.on('duel2v2_update', data => {
    // Trova la room
    let room = Object.values(activeRooms).find(r =>
      r.team1.some(p => p.id === socket.id) || r.team2.some(p => p.id === socket.id)
    );
    if (!room) return;

    // Aggiorna posizione player
    let playerArr = room.team1.concat(room.team2);
    let playerObj = playerArr.find(p => p.id === socket.id);
    if (playerObj && data.player) {
      playerObj.x = data.player.x;
      playerObj.y = data.player.y;
      playerObj.energy = data.player.energy;
      playerObj.angle = data.player.angle;
      // PATCH: IGNORA health inviata dal client!
    }

    // PATCH: aggiungi solo nuovi proiettili (opzionale: qui accetti tutto per semplicità)
    if (Array.isArray(data.bullets)) {
      // PATCH: Se vuoi evitare duplicati, verifica id/owner
      room.bullets = data.bullets;
    }

    // PATCH: authoritative damage/collision!
    processBullets(room);

    io.to(room.roomId).emit('duel2v2_state', {
      team1: room.team1,
      team2: room.team2,
      bullets: room.bullets,
      round: room.round,
      scores: room.scores
    });

    // Fine partita
    const team1Alive = room.team1.some(p => p.health > 0);
    const team2Alive = room.team2.some(p => p.health > 0);
    if (!team1Alive || !team2Alive) {
      const winningTeam = team1Alive ? 'team1' : 'team2';
      end2v2Match(room, winningTeam);
    }
  });

  socket.on('duel2v2_victory', ({ roomId, winningTeam }) => {
    const room = activeRooms[roomId];
    if (!room) return;
    end2v2Match(room, winningTeam);
  });

  socket.on('disconnect', () => {
    console.log("Client disconnesso:", socket.id);
    queue2v2 = queue2v2.filter(p => p.id !== socket.id);

    Object.keys(activeRooms).forEach(roomId => {
      const room = activeRooms[roomId];
      const wasInTeam1 = room.team1.some(p => p.id === socket.id);
      const wasInTeam2 = room.team2.some(p => p.id === socket.id);

      if (wasInTeam1) {
        room.team1 = room.team1.filter(p => p.id !== socket.id);
      }
      if (wasInTeam2) {
        room.team2 = room.team2.filter(p => p.id !== socket.id);
      }
      if ((wasInTeam1 || wasInTeam2) && (room.team1.length === 0 || room.team2.length === 0)) {
        const winningTeam = room.team1.length > 0 ? 'team1' : 'team2';
        end2v2Match(room, winningTeam);
      }
    });

    broadcastLobbyUpdate();
  });
});

function end2v2Match(room, winningTeam) {
  if (!room || !room.roomId) return;
  const stats = {
    team1: {
      kills: room.team2.filter(p => p.health <= 0).length,
      survivors: room.team1.filter(p => p.health > 0).length
    },
    team2: {
      kills: room.team1.filter(p => p.health <= 0).length,
      survivors: room.team2.filter(p => p.health > 0).length
    }
  };
  io.to(room.roomId).emit('duel2v2_end', {
    winningTeam,
    stats,
    finalState: {
      team1: room.team1,
      team2: room.team2
    }
  });
  const allPlayers = [...room.team1, ...room.team2];
  allPlayers.forEach(p => {
    const playerSocket = io.sockets.sockets.get(p.id);
    if (playerSocket) {
      playerSocket.leave(room.roomId);
    }
  });
  delete activeRooms[room.roomId];
  console.log(`Room ${room.roomId} terminata. Vincitore: ${winningTeam}`);
}

http.listen(PORT, () => {
  console.log(`Stellar Guardian 2v2 Server PATCHED online on port ${PORT}`);
  console.log(`Apri http://localhost:${PORT} nel browser`);
  console.log(`File serviti da: ${path.join(__dirname, 'public')}`);
});