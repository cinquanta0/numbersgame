import random

# Gestione di un singolo gioco
class Game:
    def __init__(self, username):
        self.username = username  # Nome dell'utente
        self.secret_number = random.randint(1, 100)  # Numero segreto random
        self.attempts_left = 10  # Numero di tentativi iniziali
        self.game_over = False   # Stato del gioco (se finito o meno)

    def make_guess(self, guess):
        """
        Metodo per gestire il tentativo di un giocatore.
        Ritorna il risultato del tentativo, inclusi i tentativi rimanenti.
        """
        if self.game_over:
            return {"message": "Il gioco è già finito. Riprova a iniziare un nuovo gioco."}

        # Controlliamo se il numero è corretto
        if guess == self.secret_number:
            self.game_over = True
            return {"message": "Hai vinto! Congratulazioni!"}
        elif guess < self.secret_number:
            self.attempts_left -= 1
            if self.attempts_left <= 0:
                self.game_over = True
                return {"message": f"Hai perso! Il numero segreto era {self.secret_number}."}
            return {"message": f"Il numero è più alto! Tentativi rimasti: {self.attempts_left}"}
        else:
            self.attempts_left -= 1
            if self.attempts_left <= 0:
                self.game_over = True
                return {"message": f"Hai perso! Il numero segreto era {self.secret_number}."}
            return {"message": f"Il numero è più basso! Tentativi rimasti: {self.attempts_left}"}

# Funzione per avviare un nuovo gioco
def start_new_game(username):
    """
    Inizializza un nuovo gioco per un utente dato.
    """
    return Game(username)
