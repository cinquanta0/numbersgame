<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io('http://localhost:3000');

function startMultiplayerGame(playerName) {
  socket.emit('join_game', playerName);

  socket.on('game_start', ({ room, players, number }) => {
    alert(`Sfida iniziata! Numero da indovinare da 1 a 100.`);
    // salva il room ID per future comunicazioni
    window.currentRoom = room;
    window.secretNumber = number;
  });

  document.getElementById("submitGuessBtn").onclick = () => {
    const guess = parseInt(document.getElementById("userGuess").value);
    if (!isNaN(guess)) {
      socket.emit('guess', { room: window.currentRoom, guess });
    }
  };

  socket.on('guess_feedback', msg => {
    document.getElementById("message").innerText = msg;
  });

  socket.on('game_result', ({ winner }) => {
    if (socket.id === winner) {
      alert("Hai vinto!");
    } else {
      alert("Hai perso!");
    }
  });
}
</script>
