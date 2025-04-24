// Prendiamo gli elementi dalla pagina HTML
const guessInput = document.getElementById('guess_input');
const gameOutput = document.getElementById('game_output');
const startGameButton = document.querySelector('button[type="submit"]');

// Funzione per inviare il tentativo dell'utente al server
function sendGuess() {
  const guess = parseInt(guessInput.value);

  // Controlliamo se il campo è vuoto o non valido
  if (isNaN(guess) || guess < 1 || guess > 100) {
    gameOutput.textContent = "Per favore, inserisci un numero valido tra 1 e 100.";
    return;
  }

  // Invia il tentativo al server
  fetch('/make_guess', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ guess: guess })
  })
  .then(response => response.json())
  .then(data => {
    // Visualizza il messaggio di ritorno del server
    gameOutput.textContent = data.message;

    // Se il gioco è finito, disabilita il campo di input
    if (data.message.includes("Hai vinto!") || data.message.includes("Hai perso!")) {
      guessInput.disabled = true;
    }
  })
  .catch(error => {
    console.error('Errore:', error);
  });

  // Pulisci l'input per il prossimo tentativo
  guessInput.value = '';
}

// Funzione per iniziare il gioco
function startGame() {
  const username = prompt("Inserisci il tuo nome:");
  if (username) {
    // Avvia il gioco passando il nome dell'utente
    fetch('/start_game', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: username })
    })
    .then(response => response.json())
    .then(data => {
      // Mostra il messaggio di benvenuto
      gameOutput.textContent = `Benvenuto, ${data.username}! Inizia a indovinare il numero!`;

      // Attiva il campo di input per il tentativo
      guessInput.disabled = false;
    })
    .catch(error => {
      console.error('Errore:', error);
    });
  }
}

// Aggiungi un evento al bottone per l'inizio del gioco
startGameButton.addEventListener('click', (event) => {
  event.preventDefault(); // Evita che il form venga inviato
  startGame();
});
