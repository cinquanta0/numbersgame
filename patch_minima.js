// ============ PATCH MINIMA MULTIPLAYER ============
// Sicura da aggiungere in fondo: sovrascrive solo ciò che serve.
// Assicurati che socket, gameState ecc. esistano già nel tuo script principale.

// ---- 1. Throttle bossDamage ----
(function(){
  if (typeof window === 'undefined') return;
  let lastBossDamageSent = 0;
  window.coopShootBoss = function(damage){
    if (!window.socket) return;
    const now = Date.now();
    if (now - lastBossDamageSent < 65) return;
    lastBossDamageSent = now;
    window.socket.emit('bossDamage', { damage: Math.max(1, Math.round(damage)) });
  };
})();

// ---- 2. bossDefeated {team, score} ----
if (window.socket) {
  window.socket.off?.('bossDefeated'); // se socket.io v4: rimuove vecchio listener
  window.socket.on('bossDefeated', (payload)=>{
    const { team, score } = payload || {};
    if (typeof showNotification === 'function') {
      showNotification(`🎉 Team ${team || '???'} Victory! Score: ${score || 0}`, 'achievement');
    }
    const scoreEl = document.getElementById('victoryScore');
    if (scoreEl) scoreEl.textContent = score || 0;
    if (typeof showScreen === 'function') showScreen('victory');
  });
}

// ---- 3. otherPlayers listener aggiornato ----
if (window.socket) {
  window.socket.off?.('otherPlayers');
  window.socket.on('otherPlayers', data => {
    if (!window.otherPlayers) window.otherPlayers = {};
    const liveIds = new Set(data.players.map(pl => pl.id));
    Object.keys(window.otherPlayers).forEach(id => {
      if (!liveIds.has(id)) delete window.otherPlayers[id];
    });
    data.players.forEach(pl => {
      if (!window.otherPlayers[pl.id]) {
        window.otherPlayers[pl.id] = {
          id: pl.id,
            x: pl.x, y: pl.y,
            targetX: pl.x, targetY: pl.y,
            nickname: pl.nickname,
            dead: !!pl.dead,
            angle: pl.angle || 0
        };
      } else {
        const ref = window.otherPlayers[pl.id];
        ref.targetX = pl.x;
        ref.targetY = pl.y;
        ref.nickname = pl.nickname;
        ref.dead = !!pl.dead;
        ref.angle = pl.angle || 0;
      }
    });
  });
}

// ---- 4. Patch duel_update (rimuovere health se altrove lo rimetti) ----
// Se nel tuo codice hai una funzione che emette duel_update, questa wrapper sostituisce l’emit corretto:
window.emitDuelUpdate = function(extra={}) {
  if (!window.socket || !window.duelRoomId || !window.gameState) return;
  window.socket.emit('duel_update', {
    room: window.duelRoomId,
    player: {
      x: window.gameState.player.x,
      y: window.gameState.player.y,
      energy: window.gameState.player.energy,
      angle: window.gameState.player.angle
      // health rimosso
    },
    ...extra
  });
};

// ---- 5. duel_end con reason ----
if (window.socket) {
  window.socket.off?.('duel_end');
  window.socket.on('duel_end', ({ winner, stats, reason }) => {
    if (typeof window.duelGameActive !== 'undefined') window.duelGameActive = false;
    let title;
    if (reason === 'opponent_disconnect') title = '🏆 Opponent Disconnected – Victory!';
    else if (winner === window.socket.id) title = '🏆 VICTORY';
    else if (winner === 'draw') title = '🤝 DRAW';
    else title = '😵 DEFEAT';
    const titleEl = document.getElementById('duelEndTitle');
    if (titleEl) titleEl.textContent = title;
    const endScreen = document.getElementById('duelEndScreen');
    if (endScreen) endScreen.classList.remove('hidden');
  });
}

// ---- 6. Chat con rate limit (8 / 10s) ----
(function(){
  const chatTimestamps = [];
  window.sendChatMessage = function(){
    const input = document.getElementById('chatInput');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;
    const now = Date.now();
    while (chatTimestamps.length && now - chatTimestamps[0] > 10000) chatTimestamps.shift();
    if (chatTimestamps.length >= 8) {
      if (typeof showNotification === 'function')
        showNotification('⏱️ Chat rate limit: aspetta un attimo', 'info');
      return;
    }
    chatTimestamps.push(now);
    if (window.socket) window.socket.emit('chatMessage', { nickname: getPlayerName(), text: msg });
    input.value = '';
  };
})();

// ---- 7. Nickname sanitization + filtro ----
window.sanitizeNickname = function(raw){
  return (raw||'').replace(/[^A-Za-z0-9_ ]+/g,'').trim().substring(0,16);
};
window.filterBadWords = function(text){
  const bad=['fuck','shit','ass','dick','cock','pussy','nigger','faggot'];
  let t=text||'';
  bad.forEach(w=>{
    const r=new RegExp(w,'gi');
    t=t.replace(r,'***');
  });
  return t;
};
window.savePlayerName = function(){
  let val = document.getElementById('nicknameInput')?.value || '';
  val = sanitizeNickname(val);
  val = filterBadWords(val);
  if (val.length<2){
    if (typeof showNotification==='function') showNotification('Nickname too short!','info');
    return;
  }
  localStorage.setItem('playerName', val);
  if (typeof showNotification==='function') showNotification('Nickname updated!','info');
};
window.getPlayerName = function(){
  return localStorage.getItem('playerName') || 'Player';
};

// ---- 8. Avviso se nel rendering stai ancora usando p.health ----
// (Facoltativo: avvisa una sola volta)
(function(){
  let warned=false;
  setTimeout(()=>{
    if (window.otherPlayers && !warned){
      for (const id in otherPlayers){
        if (otherPlayers[id] && typeof otherPlayers[id].health !== 'undefined') {
          // Se il server non manda più health, qui non dovrebbero esserci valori
        }
      }
      // Se altrove provi a leggere p.health, non lo troverai: togli quella parte nel tuo render.
    }
  }, 4000);
})();

// ============ FINE PATCH MINIMA ============