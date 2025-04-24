from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import random
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.secret_key = 'secret_key'  # Cambia questa chiave segreta per maggiore sicurezza
socketio = SocketIO(app)

# Variabili globali per il gioco
game_data = {}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/start_game', methods=['POST'])
def start_game():
    username = request.form.get('username')
    if username:
        session['username'] = username
        return jsonify({'success': True})
    else:
        return jsonify({'success': False, 'error': 'Per favore, inserisci un nome utente!'})

@app.route('/play')
def play():
    if 'username' not in session:
        return redirect(url_for('index'))
    return render_template('play.html', username=session['username'])

@socketio.on('start_game')
def start_game_socket():
    username = session.get('username')
    if username:
        secret_number = random.randint(1, 100)
        game_data[username] = {
            'secret_number': secret_number,
            'attempts_left': 10
        }
        emit('game_started', {'message': f'Benvenuto {username}, inizia il gioco!'}, broadcast=True)
    else:
        emit('error', {'message': 'Non sei autenticato!'})

@socketio.on('guess')
def make_guess(data):
    username = session.get('username')
    if username in game_data:
        guess = int(data['guess'])
        secret_number = game_data[username]['secret_number']
        attempts_left = game_data[username]['attempts_left']
        if guess == secret_number:
            emit('result', {'message': 'Hai vinto! Congratulazioni!'})
            game_data[username]['attempts_left'] = 0
        else:
            attempts_left -= 1
            game_data[username]['attempts_left'] = attempts_left
            if guess < secret_number:
                emit('result', {'message': 'Il numero è più alto! Tentativi rimasti: ' + str(attempts_left)})
            else:
                emit('result', {'message': 'Il numero è più basso! Tentativi rimasti: ' + str(attempts_left)})
            if attempts_left == 0:
                emit('result', {'message': 'Hai perso! Il numero segreto era ' + str(secret_number)})
                game_data[username]['attempts_left'] = 0
    else:
        emit('error', {'message': 'Errore nel gioco. Riprova!'})

if __name__ == '__main__':
    socketio.run(app, debug=True)
# Importa i moduli necessari
from flask import Flask, render_template
from flask_socketio import SocketIO, emit
import random

app = Flask(__name__)
socketio = SocketIO(app)

# Dizionario per tenere traccia dei punteggi dei giocatori
scores = {}

# Funzione che gestisce la previsione dei giocatori
@socketio.on('player_guess')
def player_guess(data):
    guess = int(data['guess'])
    number = data['number']
    player = data['player']
    
    if player not in scores:
        scores[player] = 0
    
    if guess == number:
        scores[player] += 10  # Aggiungi 10 punti per risposta corretta
        emit('correct_guess', {'message': f"{player} ha indovinato! Punteggio: {scores[player]}"}, broadcast=True)
    else:
        scores[player] -= 2  # Deduci 2 punti per risposta errata
        emit('wrong_guess', {'message': f"{player} ha sbagliato. Punteggio: {scores[player]}"}, broadcast=True)
    
    # Invia la classifica aggiornata a tutti i client
    emit('score_update', {'scores': scores}, broadcast=True)

# Funzione che gestisce l'inizio del gioco
@socketio.on('start_game')
def start_game():
    number = random.randint(1, 100)  # Numero segreto random
    emit('game_started', {'message': 'Il gioco è iniziato!'}, broadcast=True)
    emit('new_number', {'number': number}, broadcast=True)

if __name__ == '__main__':
    socketio.run(app, debug=True)
