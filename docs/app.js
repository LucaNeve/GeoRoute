import * as THREE from './vendor/three.module.min.js';

/* ==========================================================================
   1. DOM ELEMENTS
   ========================================================================== */
const canvas = document.getElementById('globeCanvas');
const currentBox = document.getElementById('currentBox');
const targetBox = document.getElementById('targetBox');
const statusLabel = document.getElementById('statusLabel');
const countryInput = document.getElementById('countryInput');
const suggestionsList = document.getElementById('suggestionsList');
const toggleSuggestions = document.getElementById('toggleSuggestions');
const submitButton = document.getElementById('submitButton');
const newGameButton = document.getElementById('newGameButton');
const menuButton = document.getElementById('menuButton');
const settingsMenu = document.getElementById('settingsMenu');
const closeSettingsButton = document.getElementById('closeSettingsButton');
const victoryOverlay = document.getElementById('victoryOverlay');
const victoryTitle = document.getElementById('victoryTitle');
const victoryMessage = document.getElementById('victoryMessage');
const victoryBadge = document.getElementById('victoryBadge');
const playAgainButton = document.getElementById('playAgainButton');
const closeVictoryButton = document.getElementById('closeVictoryButton');
const countryTooltip = document.getElementById('countryTooltip');
const timerDisplay = document.getElementById('timerDisplay');
const victoryStats = document.getElementById('victoryStats');
const statYourSteps = document.getElementById('statYourSteps');
const statShortestSteps = document.getElementById('statShortestSteps');
const victoryReviewActions = document.getElementById('victoryReviewActions');
const reviewMyPathButton = document.getElementById('reviewMyPathButton');
const reviewShortestPathButton = document.getElementById('reviewShortestPathButton');
const pathReviewBar = document.getElementById('pathReviewBar');
const pathReviewLabel = document.getElementById('pathReviewLabel');
const backToSummaryButton = document.getElementById('backToSummaryButton');
const pathComparison = document.getElementById('pathComparison');
const yourPathList = document.getElementById('yourPathList');
const shortestPathList = document.getElementById('shortestPathList');

/* ==========================================================================
   2. CONSTANTS & GLOBAL STATE
   ========================================================================== */
const COLOR_CURRENT = 'rgba(0, 200, 83, 0.98)';
const COLOR_TARGET = 'rgba(220, 20, 60, 0.98)';

const textureWidth = 4096;
const textureHeight = 2048;
const textureCanvas = document.createElement('canvas');
textureCanvas.width = textureWidth;
textureCanvas.height = textureHeight;

const textureContext = textureCanvas.getContext('2d');
textureContext.imageSmoothingEnabled = true;
textureContext.lineJoin = 'round';
textureContext.lineCap = 'round';

let scene, camera, renderer, globe, globeMaterial;
let countries = [];
let renderCountries = [];
let iso3Map = new Map();
let nameMap = new Map();
let nameMapCompact = new Map();
let featureByIso = new Map();
let game = null;
let gameType = 'route';        // 'route' (Collega i Paesi) | 'guess' (Guess the Country)
let guessGame = null;          // stato dedicato alla modalità Guess the Country
let hintHighlightCode = null;  // paese evidenziato temporaneamente da un indizio (solo route)
let isDragging = false;
let showSuggestions = false;
let overlayMode = 'setup';
let selectedGameMode = 'standard';
let speedrunTimer = null;
let speedrunTimeLeft = 60;
let speedrunDuration = 180;
let speedrunChallenges = 0;

let sphereRadius = 170;
let zoomMinZ = 320;
let zoomMaxZ = 900;
let baseFitDistance = null;
let viewAnim = null;
let islandConnections = [];
let lastPointerPos = null;

let keyboardOpen = false;
let savedCameraZ = null;

let previewState = null;

const activePointers = new Map();
let prevTouchDiff = -1;

const raycaster = new THREE.Raycaster();

/* ==========================================================================
   3. INITIALIZATION & CONTROLS SETUP
   ========================================================================== */
Promise.all([
  fetch('data/countries-110m.json').then(res => res.json()),
  fetch('data/countries.json').then(res => res.json())
]).then(initialize).catch(error => {
  statusLabel.textContent = 'Errore caricando i dati: ' + error.message;
});

function initialize([topology, countryData]) {
  const geo = topojson.feature(topology, topology.objects.countries);
  buildCountryMetadata(countryData, geo.features);
  initThree();
  setupControls();
  document.title = 'GeoRoute';
  animate();

  // Schermata iniziale: scelta tra i due giochi
  const gameSelectOverlay = document.getElementById('gameSelectOverlay');
  if (gameSelectOverlay) {
    gameSelectOverlay.querySelectorAll('[data-gametype]').forEach(btn => {
      btn.addEventListener('click', () => chooseGame(btn.dataset.gametype));
    });
    gameSelectOverlay.classList.remove('hidden');
  } else {
    chooseGame('route');
  }
}

// Selezione del gioco → adatta le impostazioni e mostra il tutorial dedicato
function chooseGame(type) {
  gameType = (type === 'guess') ? 'guess' : 'route';
  applyGameTypeToSettings();
  const sel = document.getElementById('gameSelectOverlay');
  if (sel) sel.classList.add('hidden');
  showTutorialFor(gameType);
}

function showTutorialFor(type) {
  const overlay = document.getElementById('tutorialOverlay');
  const titleEl = document.getElementById('tutorialTitle');
  const msgEl = document.getElementById('tutorialMessage');
  const closeBtn = document.getElementById('tutorialCloseBtn');
  if (!overlay || !closeBtn) { beginGame(); return; }

  if (titleEl) {
    titleEl.innerHTML = type === 'guess' ? '🎯 Guess the Country' : '🌍 Collega i Paesi';
  }
  if (msgEl) {
    msgEl.innerHTML = type === 'guess'
      ? 'Un paese si illumina di <span style="color:#dc143c;font-weight:bold;">rosso</span>: scrivi il suo nome per indovinarlo.<br />' +
        'Se ci prendi diventa <span style="color:#00c853;font-weight:bold;">verde</span>.<br />' +
        'Ogni paese che sbagli si colora comunque di verde, così vedi dov\'è.<br />' +
        'Hai <strong>3 tentativi</strong> e <strong>2 indizi</strong>!'
      : 'Parti dal <span style="color:#00c853;font-weight:bold;">pallino verde</span> e raggiungi il ' +
        '<span style="color:#dc143c;font-weight:bold;">pallino rosso</span>.<br />' +
        '<strong>Digita il nome di uno stato confinante</strong> per avanzare.<br />' +
        'Ogni paese visitato viene tracciato nella barra laterale.<br />' +
        'Trova il percorso più breve!';
  }

  overlay.classList.remove('hidden');

  // Ricreo il bottone per evitare listener accumulati tra un tutorial e l'altro
  const freshBtn = closeBtn.cloneNode(true);
  closeBtn.parentNode.replaceChild(freshBtn, closeBtn);
  freshBtn.addEventListener('click', () => {
    overlay.classList.add('hidden');
    beginGame();
  }, { once: true });
}

function beginGame() {
  if (countryInput) countryInput.disabled = false;
  if (submitButton) submitButton.disabled = false;
  startNewGame();
}

function setupControls() {
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => setActiveMode(btn.dataset.mode));
  });
  document.querySelectorAll('[data-diff]').forEach(btn => {
    btn.addEventListener('click', () => setActiveDifficulty(btn.dataset.diff));
  });
  document.querySelectorAll('[data-cont]').forEach(btn => {
    btn.addEventListener('click', () => setActiveContinent(btn.dataset.cont));
  });
  document.querySelectorAll('[data-duration]').forEach(btn => {
    btn.addEventListener('click', () => setActiveDuration(btn.dataset.duration));
  });

  setActiveMode('standard');
  setActiveDifficulty('medium');
  setActiveContinent('all');
  setActiveDuration('180');

  if (toggleSuggestions) {
    toggleSuggestions.checked = showSuggestions;
    toggleSuggestions.addEventListener('change', (e) => {
      showSuggestions = e.target.checked;
      updateAutocompleteSuggestions();
    });
  }

  if (countryInput) {
    countryInput.addEventListener('input', updateAutocompleteSuggestions);
    countryInput.addEventListener('focus', () => {
      updateAutocompleteSuggestions();
      setTimeout(() => window.scrollTo(0, 0), 100);
    });
    countryInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (suggestionsList) suggestionsList.classList.add('hidden');
        window.scrollTo(0, 0);
      }, 150);
    });
  }

  const changeGameButton = document.getElementById('changeGameButton');
  if (changeGameButton) {
    changeGameButton.addEventListener('click', () => {
      if (settingsMenu) settingsMenu.classList.add('hidden');
      hideVictoryOverlay();
      const sel = document.getElementById('gameSelectOverlay');
      if (sel) sel.classList.remove('hidden');
    });
  }

  if (menuButton && settingsMenu) {
    menuButton.addEventListener('click', () => {
      applyGameTypeToSettings();
      settingsMenu.classList.toggle('hidden');
    });
    if (closeSettingsButton && settingsMenu) {
      closeSettingsButton.addEventListener('click', () => {
        settingsMenu.classList.add('hidden');
      });
    }
    window.addEventListener('pointerdown', (e) => {
      if (!settingsMenu.contains(e.target) && e.target !== menuButton) settingsMenu.classList.add('hidden');
    });
  }

  if (newGameButton) {
    newGameButton.addEventListener('click', () => {
      if (settingsMenu) settingsMenu.classList.add('hidden');
      hideVictoryOverlay();
      startNewGame();
    });
  }

  if (playAgainButton) {
    playAgainButton.addEventListener('click', () => {
      hideVictoryOverlay();
      startNewGame();
    });
  }

  if (closeVictoryButton) closeVictoryButton.addEventListener('click', hideVictoryOverlay);

  if (reviewMyPathButton) {
    reviewMyPathButton.addEventListener('click', () => startPathReview('mine'));
  }
  if (reviewShortestPathButton) {
    reviewShortestPathButton.addEventListener('click', () => startPathReview('shortest'));
  }
  if (backToSummaryButton) {
    backToSummaryButton.addEventListener('click', endPathReview);
  }

  const alignButton = document.getElementById('alignButton');
  if (alignButton) {
    alignButton.addEventListener('click', () => {
      if (!globe) return;
      const invQ = globe.quaternion.clone().invert();
      const localCenter = new THREE.Vector3(0, 0, 1).applyQuaternion(invQ);
      const ll = vectorToLatLon(localCenter);
      centerLonLatWithEquator(ll.lon, ll.lat);
    });
  }

  if (currentBox) currentBox.addEventListener('click', () => { if (game && game.start) centerOnCountryKeepView(game.start); });
  if (targetBox) targetBox.addEventListener('click', () => { if (game && game.target) centerOnCountryKeepView(game.target); });

  window.addEventListener('keydown', (e) => {
    const key = e.key;

    const undo = (e.ctrlKey || e.metaKey) && key.toLowerCase() === 'z';
    const altLeft = e.altKey && key === 'ArrowLeft';

    if (undo || altLeft) {
      if (gameType === 'route' && game && selectedGameMode !== 'hardcore') {
        doUndo();
      }
      return;
    }

    if (key === 'Escape') {
      if (settingsMenu && !settingsMenu.classList.contains('hidden')) {
        settingsMenu.classList.add('hidden');
        return;
      }
      if (previewState) {
        endPathReview();
        return;
      }
      hideVictoryOverlay();
      return;
    }

    if (key === ' ') {
      const activeEl = document.activeElement;
      const isTypingField = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.isContentEditable
      );

      if (isTypingField) return;

      e.preventDefault();
      if (globe) {
        const invQ = globe.quaternion.clone().invert();
        const localCenter = new THREE.Vector3(0,0,1).applyQuaternion(invQ);
        const ll = vectorToLatLon(localCenter);
        centerLonLatWithEquator(ll.lon, ll.lat);
      }
      return;
    }

    if (key === '/') {
      e.preventDefault();
      if (countryInput) countryInput.focus();
      return;
    }
  });
}

function setActiveMode(mode) {
  selectedGameMode = mode;
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const customContainer = document.getElementById('customGameOptions');
  if (customContainer) {
    customContainer.classList.toggle('hidden', mode !== 'custom');
  }

  const speedrunDurationGroup = document.getElementById('speedrunDurationGroup');
  if (speedrunDurationGroup) {
    speedrunDurationGroup.classList.toggle('hidden', mode !== 'speedrun');
  }

  const diffGroup = document.querySelector('[data-choice-group="difficulty"]')?.closest('.setting-group');
  const contGroup = document.querySelector('[data-choice-group="continent"]')?.closest('.setting-group');

  if (diffGroup && contGroup) {
    if (mode === 'custom') {
      diffGroup.classList.add('disabled-group');
      contGroup.classList.add('disabled-group');
    } else {
      diffGroup.classList.remove('disabled-group');
      contGroup.classList.remove('disabled-group');
    }
  }

  const suggestionGroup = document.getElementById('toggleSuggestions')?.closest('.setting-group');

  if (suggestionGroup) {
    if (mode === 'hardcore') {
      suggestionGroup.classList.add('disabled-group');
      if (toggleSuggestions) {
        toggleSuggestions.checked = false;
        showSuggestions = false;
      }
    } else {
      suggestionGroup.classList.remove('disabled-group');
    }
  }
}

function setActiveDifficulty(diff) {
  document.querySelectorAll('[data-diff]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.diff === diff);
  });
}

function setActiveContinent(continent) {
  document.querySelectorAll('[data-cont]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cont === continent);
  });
}

function setActiveDuration(durationSeconds) {
  const value = parseInt(durationSeconds, 10);
  if (!Number.isFinite(value) || value <= 0) return;
  speedrunDuration = value;
  document.querySelectorAll('[data-duration]').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.duration, 10) === value);
  });
}

function setStatus(text, isSuccess = false) {
  if (!statusLabel) return;
  statusLabel.textContent = text;
  statusLabel.classList.toggle('success', isSuccess);
}

function activeDiff() {
  return (document.querySelector('[data-choice-group="difficulty"] .active') || {}).dataset?.diff || 'medium';
}
function activeCont() {
  return (document.querySelector('[data-choice-group="continent"] .active') || {}).dataset?.cont || 'all';
}
function regionLabel(r) {
  const m = { Europe: 'Europa', Asia: 'Asia', Africa: 'Africa', Americas: 'Americhe', Oceania: 'Oceania', Antarctic: 'Antartide' };
  return m[r] || r || 'una regione sconosciuta';
}

// Nasconde/mostra le opzioni non valide per il gioco selezionato (Guess non ha Hardcore né Personalizzata)
function applyGameTypeToSettings() {
  const hardcoreBtn = document.querySelector('[data-mode="hardcore"]');
  const customBtn = document.querySelector('[data-mode="custom"]');

  if (gameType === 'guess') {
    hardcoreBtn?.classList.add('hidden');
    customBtn?.classList.add('hidden');
    if (selectedGameMode === 'hardcore' || selectedGameMode === 'custom') {
      setActiveMode('standard');
    }
    document.getElementById('customGameOptions')?.classList.add('hidden');
  } else {
    hardcoreBtn?.classList.remove('hidden');
    customBtn?.classList.remove('hidden');
  }
}

/* ==========================================================================
   4. GAME LOGIC & TIMER
   ========================================================================== */
function pickGamePair() {
  let start = null;
  let target = null;

  const diff = (document.querySelector('[data-choice-group="difficulty"] .active') || {}).dataset?.diff || 'medium';
  const continent = (document.querySelector('[data-choice-group="continent"] .active') || {}).dataset?.cont || 'all';

  if (selectedGameMode === 'custom') {
    const customStartInput = document.getElementById('customStartInput');
    const customTargetInput = document.getElementById('customTargetInput');

    const customStart = findCountryByName(customStartInput?.value);
    const customTarget = findCountryByName(customTargetInput?.value);

    if (!customStart || !customTarget) {
      setStatus('Seleziona due stati validi per la partita personalizzata.');
      return null;
    }

    if (customStart.code === customTarget.code) {
      setStatus('Partenza e destinazione non possono coincidere.');
      return null;
    }

    const distMap = computeReachableWithDistance(customStart);
    if (!distMap.has(customTarget.code)) {
      setStatus(`${customTarget.name} non è raggiungibile da ${customStart.name}.`);
      return null;
    }

    start = customStart;
    target = customTarget;
  } else {
    function candidatePool() {
      if (continent && continent !== 'all') {
        return countries.filter(c => c.region === continent);
      }
      return countries;
    }

    const pool = candidatePool();

    for (let attempt = 0; attempt < 500; attempt++) {
      const candidate = pool[Math.floor(Math.random() * pool.length)];
      if (!candidate) break;

      const distMap = computeReachableWithDistance(candidate);

      const targets = Array.from(distMap.entries()).filter(([code, d]) => {
        if (code === candidate.code) return false;
        const targetCountry = iso3Map.get(code);
        if (!targetCountry) return false;

        if (continent && continent !== 'all') {
          return targetCountry.region === continent;
        }
        return true;
      });

      if (!targets.length) continue;

      let filtered = targets;
      if (diff === 'easy') filtered = targets.filter(([code, d]) => d <= 3);
      else if (diff === 'medium') filtered = targets.filter(([code, d]) => d <= 7 && d >= 2);
      else if (diff === 'hard') filtered = targets.filter(([code, d]) => d >= 5);

      if (filtered.length === 0) continue;

      const [chosenCode] = filtered[Math.floor(Math.random() * filtered.length)];
      const chosen = iso3Map.get(chosenCode);

      if (chosen && chosen.code !== candidate.code) {
        start = candidate;
        target = chosen;
        break;
      }
    }
  }

  if (!start || !target) {
    start = countries[0];
    target = countries[1] || countries[0];
  }

  return { start, target };
}

function startNewGame(opts = {}) {
  if (gameType === 'guess') { startGuessGame(opts); return; }

  const { isSpeedrunAdvance = false } = opts;
  if (!countries.length) return;

  guessGame = null;
  hintHighlightCode = null;

  if (!isSpeedrunAdvance) {
    stopSpeedrunTimer();
    speedrunChallenges = 0;
    previewState = null;
    if (pathReviewBar) pathReviewBar.classList.add('hidden');
  }

  const pair = pickGamePair();
  if (!pair) return;
  const { start, target } = pair;

  game = {
    start,
    current: start,
    target,
    visited: new Set([start.code]),
    path: [start.code],
    shortestPath: computeShortestPathCodes(start, target),
    errors: 0,               // contatore errori
    maxErrors: selectedGameMode === 'hardcore' ? 0 : 3,  // vite disponibili
    hintsLeft: (selectedGameMode === 'standard' || selectedGameMode === 'speedrun') ? 2 : 0
  };

  if (countryInput) {
    countryInput.disabled = false;
    countryInput.value = '';
    countryInput.focus();
  }
  if (submitButton) submitButton.disabled = false;

  if (game.start && game.start.feature) {
    const c = computeFeatureCentroid(game.start.feature);
    centerLonLatWithEquator(c.lon, c.lat);
  }

  if (selectedGameMode === 'speedrun') {
    if (!isSpeedrunAdvance) startSpeedrunTimer();
  } else if (timerDisplay) {
    timerDisplay.classList.add('hidden');
  }

  updateLabels();
  updateErrorsIndicator();
  updateHintUI();
  if (!isSpeedrunAdvance) setStatus('🏁 Inserisci il nome di un paese confinante per raggiungere la meta!');
  renderTexture();
  hideVictoryOverlay();
}

function submitMove() {
  const text = (countryInput.value || '').trim();
  if (!text || !game) return;

  const next = findCountryByName(text);
  if (!next) {
    handleError('Stato non riconosciuto.');
    return;
  }

  if (next.code === game.current.code) {
    handleError('Sei già in questo stato.');
    return;
  }

  if (!game.current.borders.includes(next.code)) {
    handleError(`${next.name} non è confinante.`);
    return;
  }

  const path = game.path || [];
  const prevCode = path.length >= 2 ? path[path.length - 2] : null;
  if (game.visited.has(next.code) && next.code !== prevCode) {
    handleError('Hai già attraversato questo stato.');
    return;
  }

  // Mossa valida: azzera il contatore errori? No, manteniamo gli errori accumulati.
  // Procediamo con la mossa.
  if (next.code === prevCode) {
    const removed = path.pop();
    game.visited.delete(removed);
    game.current = iso3Map.get(prevCode);
  } else {
    game.current = next;
    game.visited.add(next.code);
    game.path.push(next.code);
  }

  updateLabels();
  renderTexture();
  countryInput.value = '';

  // Animazione di transizione: centra il paese appena raggiunto
  centerOnCountry(game.current);

  if (game.current.code === game.target.code) {
    if (selectedGameMode === 'speedrun') {
      speedrunChallenges++;
      setStatus(`Sfida ${speedrunChallenges} completata! Via alla prossima…`, true);
      setTimeout(() => {
        if (selectedGameMode === 'speedrun' && speedrunTimer) {
          startNewGame({ isSpeedrunAdvance: true });
        }
      }, 700);
    } else {
      stopSpeedrunTimer();
      setStatus('Obiettivo raggiunto!', true);
      openGameOverlay('victory');
    }
  } else {
    setStatus('');
  }
}

// Funzione per gestire gli errori (modello a "vite")
function handleError(message) {
  if (!game) return;
  game.errors++;
  updateErrorsIndicator();

  const remaining = game.maxErrors - game.errors;

  if (game.maxErrors === 0 || remaining < 0) {
    setStatus('Hai esaurito gli errori! Partita terminata.');
    openGameOverlay('defeat');
    return;
  }

  if (remaining === 0) {
    setStatus(`${message} (ultimo tentativo rimasto!)`);
  } else {
    setStatus(`${message} (${remaining} tentativ${remaining === 1 ? 'o' : 'i'} rimast${remaining === 1 ? 'o' : 'i'})`);
  }
}

/* ==========================================================================
   4ter. INDICATORE ERRORI, INDIZI & GUESS THE COUNTRY
   ========================================================================== */
function updateErrorsIndicator() {
  const el = document.getElementById('errorsIndicator');
  if (!el) return;
  const g = gameType === 'guess' ? guessGame : game;
  if (!g) { el.classList.add('hidden'); return; }

  el.classList.remove('hidden');
  const max = g.maxErrors || 0;

  if (max === 0) {
    el.textContent = '☠';
    el.title = 'Hardcore: nessun errore consentito';
    return;
  }

  const remaining = Math.max(0, max - (g.errors || 0));
  el.innerHTML = '';
  for (let i = 0; i < max; i++) {
    const heart = document.createElement('span');
    heart.className = 'err-heart' + (i < remaining ? '' : ' lost');
    heart.textContent = i < remaining ? '❤' : '🖤';
    el.appendChild(heart);
  }
  el.title = `${remaining} tentativ${remaining === 1 ? 'o' : 'i'} rimast${remaining === 1 ? 'o' : 'i'}`;
}

function updateHintUI() {
  const btn = document.getElementById('hintButton');
  if (!btn) return;
  const g = gameType === 'guess' ? guessGame : game;
  const allowed = (selectedGameMode === 'standard' || selectedGameMode === 'speedrun');
  const left = g ? (g.hintsLeft || 0) : 0;

  btn.classList.toggle('hidden', !allowed || !g);
  const cnt = document.getElementById('hintCount');
  if (cnt) cnt.textContent = String(left);
  btn.disabled = left <= 0;
}

function computeNextHopToward(from, to) {
  if (!from || !to) return null;
  const path = computeShortestPathCodes(from, to);
  if (!path || path.length < 2) return null;
  return iso3Map.get(path[1]);
}

function useHint() {
  const g = gameType === 'guess' ? guessGame : game;
  if (!g || (g.hintsLeft || 0) <= 0) return;

  if (gameType === 'guess') {
    const usedIdx = 2 - g.hintsLeft; // 0 = primo indizio, 1 = secondo
    const target = g.target;
    const name = (target.name || '').trim();
    if (usedIdx === 0) {
      setStatus(`💡 Indizio: il paese inizia con "${name.slice(0, 1).toUpperCase()}".`, true);
    } else {
      const twoLetters = name.slice(0, 1).toUpperCase() + name.slice(1, 2).toLowerCase();
      setStatus(`💡 Indizio: il paese inizia con "${twoLetters}".`, true);
    }
    g.hintsLeft--;
  } else {
    const next = computeNextHopToward(game.current, game.target);
    if (!next) { setStatus('Nessun indizio disponibile da qui.'); return; }
    g.hintsLeft--;
    setStatus(`💡 Indizio: prova con ${next.name}.`, true);
    hintHighlightCode = next.code;
    renderTexture();
    setTimeout(() => {
      if (hintHighlightCode === next.code) { hintHighlightCode = null; renderTexture(); }
    }, 3000);
  }
  updateHintUI();
}

function handleSubmit() {
  if (gameType === 'guess') submitGuess();
  else submitMove();
}

/* --- GUESS THE COUNTRY --- */
function pickGuessTarget() {
  const diff = activeDiff();
  const continent = activeCont();

  let pool = renderCountries.filter(c => c && c.name && c.feature);
  if (continent && continent !== 'all') {
    const filtered = pool.filter(c => c.region === continent);
    if (filtered.length) pool = filtered;
  }
  if (!pool.length) pool = renderCountries.slice();

  // Difficoltà per notorietà (proxy: popolazione), suddivisa in terzili
  const withPop = pool.filter(c => typeof c.population === 'number' && c.population > 0);
  if (withPop.length >= 6) {
    const sorted = withPop.slice().sort((a, b) => b.population - a.population);
    const third = Math.max(1, Math.floor(sorted.length / 3));
    let bucket = sorted;
    if (diff === 'easy') bucket = sorted.slice(0, third);
    else if (diff === 'hard') bucket = sorted.slice(-third);
    else {
      const mid = sorted.slice(third, sorted.length - third);
      bucket = mid.length ? mid : sorted;
    }
    if (bucket.length) pool = bucket;
  }

  return pool[Math.floor(Math.random() * pool.length)] || renderCountries[0];
}

function startGuessGame(opts = {}) {
  const { isSpeedrunAdvance = false } = opts;
  if (!renderCountries.length) return;

  game = null;
  hintHighlightCode = null;
  previewState = null;

  if (!isSpeedrunAdvance) {
    stopSpeedrunTimer();
    speedrunChallenges = 0;
    if (pathReviewBar) pathReviewBar.classList.add('hidden');
  }

  const target = pickGuessTarget();
  if (!target) return;

  guessGame = {
    target,
    found: false,
    greenCodes: new Set(),
    errors: 0,
    maxErrors: 3,
    hintsLeft: (selectedGameMode === 'standard' || selectedGameMode === 'speedrun') ? 2 : 0
  };

  if (countryInput) {
    countryInput.disabled = false;
    countryInput.value = '';
    countryInput.focus();
  }
  if (submitButton) submitButton.disabled = false;

  if (target.feature) {
    const c = computeFeatureCentroid(target.feature);
    centerLonLatWithEquator(c.lon, c.lat);
  }

  if (selectedGameMode === 'speedrun') {
    if (!isSpeedrunAdvance) startSpeedrunTimer();
  } else if (timerDisplay) {
    timerDisplay.classList.add('hidden');
  }

  updateGuessLabels();
  updateErrorsIndicator();
  updateHintUI();
  if (!isSpeedrunAdvance) setStatus('🔴 Indovina il paese evidenziato in rosso!');
  renderTexture();
  hideVictoryOverlay();
}

function submitGuess() {
  const text = (countryInput.value || '').trim();
  if (!text || !guessGame || guessGame.found) return;

  const guess = findCountryByName(text);
  if (!guess) { handleGuessError('Stato non riconosciuto.'); return; }

  if (guess.code === guessGame.target.code) {
    guessGame.found = true;
    guessGame.greenCodes.add(guess.code);
    countryInput.value = '';
    updateGuessLabels();
    renderTexture();
    centerOnCountry(guessGame.target);

    if (selectedGameMode === 'speedrun') {
      speedrunChallenges++;
      setStatus(`✅ ${guess.name}! Sfida ${speedrunChallenges} completata!`, true);
      setTimeout(() => {
        if (selectedGameMode === 'speedrun' && speedrunTimer) {
          startGuessGame({ isSpeedrunAdvance: true });
        }
      }, 800);
    } else {
      stopSpeedrunTimer();
      setStatus('Indovinato!', true);
      openGameOverlay('guess-victory');
    }
    return;
  }

  // Guess errato
  if (guessGame.greenCodes.has(guess.code)) {
    setStatus('Hai già nominato questo stato.');
    countryInput.value = '';
    return;
  }
  guessGame.greenCodes.add(guess.code);
  countryInput.value = '';
  updateGuessLabels();
  renderTexture();
  centerOnCountry(guess);
  handleGuessError(`${guess.name} non è il paese cercato.`);
}

function handleGuessError(message) {
  if (!guessGame) return;
  guessGame.errors++;
  updateErrorsIndicator();

  const remaining = guessGame.maxErrors - guessGame.errors;
  if (remaining < 0) {
    setStatus(`Tentativi esauriti! Il paese era ${guessGame.target.name}.`);
    stopSpeedrunTimer();
    openGameOverlay('guess-defeat');
    return;
  }

  if (remaining === 0) {
    setStatus(`${message} (ultimo tentativo rimasto!)`);
  } else {
    setStatus(`${message} (${remaining} tentativ${remaining === 1 ? 'o' : 'i'} rimast${remaining === 1 ? 'o' : 'i'})`);
  }
}

function updateGuessLabels() {
  if (!guessGame) return;

  if (currentBox) {
    currentBox.textContent = '🔴';
    currentBox.style.background = COLOR_TARGET;
  }
  if (targetBox) {
    targetBox.textContent = guessGame.found ? guessGame.target.name : '?';
    targetBox.style.background = guessGame.found ? COLOR_CURRENT : 'rgba(15,23,42,0.85)';
  }

  const sidebar = document.getElementById('timelineSidebar');
  if (sidebar) {
    sidebar.classList.remove('hidden');
    sidebar.innerHTML = '';
    Array.from(guessGame.greenCodes).forEach(code => {
      const c = iso3Map.get(code);
      const item = document.createElement('div');
      item.className = 'timeline-item';
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.style.background = code === guessGame.target.code ? COLOR_CURRENT : 'rgba(72,187,120,0.9)';
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = c ? c.name : code;
      item.appendChild(dot);
      item.appendChild(label);
      item.addEventListener('click', () => { if (c && c.feature) centerOnCountry(c); });
      sidebar.appendChild(item);
    });
  }

  updateAutocompleteSuggestions();
}

function geoDrawGuessCountries() {
  if (!guessGame) return;
  const targetCode = guessGame.target.code;

  for (const country of renderCountries) {
    const feature = country.feature;
    if (!feature) continue;

    let fillStyle = '#2d3748';
    if (guessGame.greenCodes.has(country.code)) {
      fillStyle = COLOR_CURRENT;
    } else if (country.code === targetCode) {
      fillStyle = guessGame.found ? COLOR_CURRENT : COLOR_TARGET;
    }

    drawGeoFeature(feature, fillStyle, true, false);
  }
}

function doUndo() {
  if (!game || !game.path || game.path.length <= 1) return;
  const removed = game.path.pop();
  game.visited.delete(removed);
  const last = game.path[game.path.length - 1];
  game.current = iso3Map.get(last);
  updateLabels();
  renderTexture();
  // Centra sul paese dopo l'undo
  centerOnCountry(game.current);
}

function formatTimerText(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const minsStr = mins < 10 ? '0' + mins : String(mins);
  const secsStr = secs < 10 ? '0' + secs : String(secs);
  return `⏱ ${minsStr}:${secsStr}`;
}

function startSpeedrunTimer() {
  stopSpeedrunTimer();
  speedrunTimeLeft = speedrunDuration;
  if (timerDisplay) {
    timerDisplay.classList.remove('hidden', 'warning');
    timerDisplay.textContent = formatTimerText(speedrunTimeLeft);
  }

  speedrunTimer = setInterval(() => {
    speedrunTimeLeft--;
    if (timerDisplay) {
      timerDisplay.textContent = formatTimerText(Math.max(0, speedrunTimeLeft));
      if (speedrunTimeLeft <= 10) timerDisplay.classList.add('warning');
    }

    if (speedrunTimeLeft <= 0) {
      stopSpeedrunTimer();
      openGameOverlay('speedrun-summary');
    }
  }, 1000);
}

function stopSpeedrunTimer() {
  if (speedrunTimer) {
    clearInterval(speedrunTimer);
    speedrunTimer = null;
  }
}

function fillPathList(listEl, codes) {
  if (!listEl) return;
  listEl.innerHTML = '';
  (codes || []).forEach(code => {
    const c = iso3Map.get(code);
    const li = document.createElement('li');
    li.textContent = c ? c.name : code;
    listEl.appendChild(li);
  });
}

function openGameOverlay(mode) {
  if (!victoryOverlay) return;
  overlayMode = mode;

  if (victoryStats) victoryStats.classList.add('hidden');
  if (victoryReviewActions) victoryReviewActions.classList.add('hidden');
  if (pathComparison) pathComparison.classList.add('hidden');

  if (mode === 'victory') {
    const startName = game?.start?.name || 'Partenza';
    const targetName = game?.target?.name || 'Obiettivo';
    if (victoryBadge) victoryBadge.textContent = '🏆';
    if (victoryTitle) victoryTitle.textContent = 'Hai vinto!';
    if (victoryMessage) victoryMessage.textContent = `Hai raggiunto ${targetName} partendo da ${startName}. Vuoi giocare un'altra sfida?`;
    if (playAgainButton) playAgainButton.textContent = 'Gioca ancora';
    if (closeVictoryButton) closeVictoryButton.textContent = 'Chiudi';

    const yourSteps = game && Array.isArray(game.path) ? game.path.length - 1 : null;
    const shortestSteps = game && Array.isArray(game.shortestPath) ? game.shortestPath.length - 1 : null;

    if (yourSteps !== null && shortestSteps !== null && victoryStats) {
      if (statYourSteps) statYourSteps.textContent = String(yourSteps);
      if (statShortestSteps) statShortestSteps.textContent = String(shortestSteps);
      victoryStats.classList.remove('hidden');

      if (victoryReviewActions) {
        victoryReviewActions.classList.remove('hidden');
        if (reviewShortestPathButton) {
          reviewShortestPathButton.classList.toggle('hidden', yourSteps <= shortestSteps);
        }
      }

      if (pathComparison && game.path && game.shortestPath) {
        fillPathList(yourPathList, game.path);
        fillPathList(shortestPathList, game.shortestPath);
        pathComparison.classList.remove('hidden');
      }
    }
  } else if (mode === 'speedrun-summary') {
    const durationLabel = formatTimerText(speedrunDuration).replace('⏱ ', '');
    if (victoryBadge) victoryBadge.textContent = '🏁';
    if (victoryTitle) victoryTitle.textContent = 'Tempo scaduto!';
    if (victoryMessage) {
      victoryMessage.textContent = speedrunChallenges > 0
        ? `Hai completato ${speedrunChallenges} sfid${speedrunChallenges === 1 ? 'a' : 'e'} in ${durationLabel}. Vuoi riprovare?`
        : `Tempo scaduto senza completare nessuna sfida in ${durationLabel}. Vuoi riprovare?`;
    }
    if (playAgainButton) playAgainButton.textContent = 'Rigioca';
    if (closeVictoryButton) closeVictoryButton.textContent = 'Chiudi';
  } else if (mode === 'defeat') {
    // Modalità sconfitta
    const modeName = selectedGameMode === 'hardcore' ? 'Hardcore' : selectedGameMode === 'speedrun' ? 'Speedrun' : 'Standard';
    if (victoryBadge) victoryBadge.textContent = '💥';
    if (victoryTitle) victoryTitle.textContent = 'Hai perso!';
    if (victoryMessage) {
      victoryMessage.textContent = `Hai esaurito gli errori in modalità ${modeName}. Vuoi riprovare?`;
    }
    if (playAgainButton) playAgainButton.textContent = 'Riprova';
    if (closeVictoryButton) closeVictoryButton.textContent = 'Chiudi';
  } else if (mode === 'guess-victory') {
    const t = guessGame?.target?.name || 'il paese';
    if (victoryBadge) victoryBadge.textContent = '🎯';
    if (victoryTitle) victoryTitle.textContent = 'Indovinato!';
    if (victoryMessage) victoryMessage.textContent = `Hai riconosciuto ${t}. Vuoi un'altra sfida?`;
    if (playAgainButton) playAgainButton.textContent = 'Gioca ancora';
    if (closeVictoryButton) closeVictoryButton.textContent = 'Chiudi';
  } else if (mode === 'guess-defeat') {
    const t = guessGame?.target?.name || '';
    if (victoryBadge) victoryBadge.textContent = '💥';
    if (victoryTitle) victoryTitle.textContent = 'Peccato!';
    if (victoryMessage) victoryMessage.textContent = `Hai esaurito i tentativi. Il paese era ${t}. Riprovi?`;
    if (playAgainButton) playAgainButton.textContent = 'Riprova';
    if (closeVictoryButton) closeVictoryButton.textContent = 'Chiudi';
  } else {
    // Modalità default (setup)
    if (victoryBadge) victoryBadge.textContent = '🌍';
    if (victoryTitle) victoryTitle.textContent = 'Nuova partita';
    if (victoryMessage) victoryMessage.textContent = 'Scegli la modalità, difficoltà e continente, poi inizia la sfida.';
    if (playAgainButton) playAgainButton.textContent = 'Inizia';
    if (closeVictoryButton) closeVictoryButton.textContent = 'Annulla';
  }
  victoryOverlay.classList.remove('hidden');
  if (countryInput) countryInput.blur();
  if (submitButton) submitButton.blur();
}

function hideVictoryOverlay() {
  if (!victoryOverlay) return;
  victoryOverlay.classList.add('hidden');
}

/* ==========================================================================
   4bis. REVISIONE PERCORSO
   ========================================================================== */
function startPathReview(mode) {
  if (!game) return;
  const codes = mode === 'shortest' ? game.shortestPath : game.path;
  if (!Array.isArray(codes) || codes.length === 0) return;

  previewState = { codes, mode };

  if (victoryOverlay) victoryOverlay.classList.add('hidden');
  if (pathReviewBar) pathReviewBar.classList.remove('hidden');
  if (pathReviewLabel) {
    pathReviewLabel.textContent = mode === 'shortest'
      ? 'Anteprima: percorso più breve'
      : 'Anteprima: il tuo percorso';
  }

  renderTexture();
  fitViewToPath(codes);
}

function endPathReview() {
  previewState = null;
  if (pathReviewBar) pathReviewBar.classList.add('hidden');
  renderTexture();
  openGameOverlay('victory');
}

function fitViewToPath(codes) {
  if (!globe || !camera) return;
  const points = codes
    .map(code => iso3Map.get(code))
    .filter(c => c && c.feature)
    .map(c => computeFeatureCentroid(c.feature));
  if (!points.length) return;

  let vx = 0, vy = 0, vz = 0;
  const vecs = points.map(p => latLonToVector(p.lon, p.lat));
  vecs.forEach(v => { vx += v.x; vy += v.y; vz += v.z; });
  const avg = new THREE.Vector3(vx / vecs.length, vy / vecs.length, vz / vecs.length);
  if (avg.lengthSq() < 1e-6) avg.set(0, 0, 1);
  avg.normalize();

  let maxAngle = 0;
  vecs.forEach(v => {
    const angle = avg.angleTo(v);
    if (angle > maxAngle) maxAngle = angle;
  });

  const avgLL = vectorToLatLon(avg);
  const v = latLonToVector(avgLL.lon, avgLL.lat);
  const q = new THREE.Quaternion().setFromUnitVectors(v, new THREE.Vector3(0, 0, 1));

  const northVec = latLonToVector(0, 90);
  const northRotated = northVec.clone().applyQuaternion(q);
  let phi = 0;
  if (Math.hypot(northRotated.x, northRotated.y) > 1e-6) phi = Math.atan2(northRotated.x, northRotated.y);
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), phi);
  const qf = qz.multiply(q);

  let targetZ = baseFitDistance || camera.position.z;
  if (baseFitDistance && camera.fov) {
    const fovRad = (camera.fov * Math.PI) / 180;
    const paddedAngle = Math.max(maxAngle * 1.7, 0.22);
    targetZ = (sphereRadius * Math.sin(Math.min(paddedAngle, Math.PI * 0.48))) / Math.sin(fovRad / 2);
    targetZ = Math.max(zoomMinZ, Math.min(zoomMaxZ, targetZ));
  }

  startViewAnimation(qf, targetZ, 700);
}

/* ==========================================================================
   5. UI UPDATES & AUTOCOMPLETE
   ========================================================================== */
function updateLabels() {
  if (!game) return;
  if (currentBox) {
    currentBox.textContent = game.start.name || 'Partenza';
    currentBox.style.background = COLOR_CURRENT;
  }
  if (targetBox) {
    targetBox.textContent = game.target.name || 'Obiettivo';
    targetBox.style.background = COLOR_TARGET;
  }

  const sidebar = document.getElementById('timelineSidebar');

  if (sidebar) {
    if (selectedGameMode === 'hardcore') {
      sidebar.classList.add('hidden');
      return;
    }

    sidebar.classList.remove('hidden');
    sidebar.innerHTML = '';
    (game.path || []).forEach((code, idx) => {
      const c = iso3Map.get(code);
      const item = document.createElement('div');
      item.className = 'timeline-item';
      const dot = document.createElement('div');
      dot.className = 'dot';
      if (idx === 0) dot.style.background = COLOR_CURRENT;
      else if (code === game.target.code) dot.style.background = COLOR_TARGET;
      else dot.style.background = 'rgba(255,255,255,0.15)';
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = c ? c.name : code;
      item.appendChild(dot);
      item.appendChild(label);
      item.addEventListener('click', () => {
        if (c && c.feature) centerOnCountry(c);
      });
      sidebar.appendChild(item);
    });
  }

  updateAutocompleteSuggestions();
}

function nameMatchesQuery(name, query, queryCompact) {
  const normName = normalizeName(name);
  if (normName.includes(query)) return true;
  return normName.replace(/\s+/g, '').includes(queryCompact);
}

function updateAutocompleteSuggestions() {
  if (!suggestionsList || !countryInput) return;

  const query = normalizeName(countryInput.value);
  if (!showSuggestions || selectedGameMode === 'hardcore' || !query) {
    suggestionsList.innerHTML = '';
    suggestionsList.classList.add('hidden');
    return;
  }
  const queryCompact = query.replace(/\s+/g, '');

  suggestionsList.innerHTML = '';
  const candidates = [];
  const added = new Set();

  if (gameType !== 'guess' && game && game.current && Array.isArray(game.current.borders)) {
    game.current.borders.forEach(borderCode => {
      const borderCountry = iso3Map.get(borderCode);
      if (borderCountry && !added.has(borderCountry.name)) {
        if (nameMatchesQuery(borderCountry.name, query, queryCompact)) {
          candidates.push(borderCountry);
          added.add(borderCountry.name);
        }
      }
    });
  }

  countries.forEach(c => {
    if (!added.has(c.name) && nameMatchesQuery(c.name, query, queryCompact)) {
      candidates.push(c);
      added.add(c.name);
    }
  });

  if (candidates.length === 0) {
    suggestionsList.classList.add('hidden');
    return;
  }

  candidates.slice(0, 5).forEach(c => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.textContent = c.name;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      countryInput.value = c.name;
      suggestionsList.classList.add('hidden');
      handleSubmit();
    });
    suggestionsList.appendChild(item);
  });

  suggestionsList.classList.remove('hidden');
}

function showTooltip(x, y, text) {
  if (!countryTooltip) return;
  countryTooltip.textContent = text;
  countryTooltip.style.left = `${x}px`;
  countryTooltip.style.top = `${y}px`;
  countryTooltip.classList.remove('hidden');
}

function hideTooltip() {
  if (!countryTooltip) return;
  countryTooltip.classList.add('hidden');
}

/* ==========================================================================
   6. THREE.JS SCENE, CAMERA & VIEW ANIMATIONS
   ========================================================================== */
function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x06090e, 1);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  camera.position.set(0, 0, 480);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.95);
  directionalLight.position.set(1, 2, 1);
  scene.add(directionalLight);

  const sphereGeometry = new THREE.SphereGeometry(170, 64, 64);
  globeMaterial = new THREE.MeshPhongMaterial({
    map: new THREE.CanvasTexture(textureCanvas),
    shininess: 12,
    specular: 0x333333,
    flatShading: false
  });
  globe = new THREE.Mesh(sphereGeometry, globeMaterial);
  scene.add(globe);

  sphereRadius = sphereGeometry.parameters.radius;

  window.addEventListener('resize', resize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const viewportHeight = window.visualViewport.height;
      const windowHeight = window.innerHeight;

      if (viewportHeight < windowHeight * 0.8) {
        keyboardOpen = true;
        if (camera) {
          savedCameraZ = camera.position.z;
        }
        return;
      }

      if (keyboardOpen) {
        keyboardOpen = false;
        resize();
        if (camera && savedCameraZ !== null) {
          camera.position.z = savedCameraZ;
        }
        savedCameraZ = null;
        return;
      }

      resize();
    });
  }
  resize();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointermove', onCanvasHover);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);
  canvas.addEventListener('pointerleave', hideTooltip);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  submitButton.addEventListener('click', handleSubmit);
  countryInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') handleSubmit();
  });

  const hintButton = document.getElementById('hintButton');
  if (hintButton) hintButton.addEventListener('click', useHint);
}

function resize() {
  if (keyboardOpen) return;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  const fovRad = (camera.fov * Math.PI) / 180;
  let fitDistance = (sphereRadius / Math.sin(fovRad / 2)) * 1.05;
  
  if (camera.aspect < 1) {
    fitDistance /= camera.aspect;
  }

  zoomMinZ = fitDistance * 0.40;
  zoomMaxZ = fitDistance * 3.5;
  baseFitDistance = fitDistance;

  if (camera.position.z < fitDistance) {
    camera.position.z = fitDistance;
  }
}

function animate() {
  requestAnimationFrame(animate);

  if (viewAnim) {
    const now = performance.now();
    const t = Math.min(1, (now - viewAnim.startTime) / viewAnim.duration);
    const eased = easeInOutCubic(t);
    globe.quaternion.copy(viewAnim.startQ).slerp(viewAnim.endQ, eased);
    camera.position.z = viewAnim.startZ + (viewAnim.endZ - viewAnim.startZ) * eased;
    if (t >= 1) {
      globe.quaternion.copy(viewAnim.endQ);
      camera.position.z = viewAnim.endZ;
      viewAnim = null;
    }
  }

  renderer.render(scene, camera);
}

function centerLonLatWithEquator(lon, lat) {
  if (typeof lon !== 'number' || typeof lat !== 'number') return;
  const v = latLonToVector(lon, lat);
  const q = new THREE.Quaternion().setFromUnitVectors(v, new THREE.Vector3(0, 0, 1));

  const northVec = latLonToVector(0, 90);
  const northRotated = northVec.clone().applyQuaternion(q);
  const projX = northRotated.x;
  const projY = northRotated.y;
  let phi = 0;
  if (Math.hypot(projX, projY) > 1e-6) phi = Math.atan2(projX, projY);
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), phi);
  const qf = qz.multiply(q);

  const targetZ = Math.max(camera.position.z || baseFitDistance, baseFitDistance * 0.7);

  startViewAnimation(qf, targetZ, 650);
}

function centerOnCountry(country) {
  if (!country || !country.feature) return;
  const c = computeFeatureCentroid(country.feature);
  centerLonLatWithEquator(c.lon, c.lat);
}

function centerOnCountryKeepView(country) {
  if (!country || !country.feature || !globe) return;
  const c = computeFeatureCentroid(country.feature);
  const v = latLonToVector(c.lon, c.lat);
  const qAlign = new THREE.Quaternion().setFromUnitVectors(v, new THREE.Vector3(0, 0, 1));

  const northVec = latLonToVector(0, 90);
  const northAfter = northVec.clone().applyQuaternion(qAlign);
  const angleAfter = Math.atan2(northAfter.x, northAfter.y);

  const northCurrent = northVec.clone().applyQuaternion(globe.quaternion);
  const currentAngle = Math.atan2(northCurrent.x, northCurrent.y);

  const delta = currentAngle - angleAfter;
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), delta);
  const qFinal = qz.multiply(qAlign);

  startViewAnimation(qFinal, camera.position.z, 600);
}

function startViewAnimation(endQ, endZ, duration = 600) {
  if (!globe || !camera) {
    if (globe && endQ) globe.quaternion.copy(endQ);
    if (camera && typeof endZ === 'number') camera.position.z = endZ;
    return;
  }
  const startQ = globe.quaternion.clone();
  const startZ = camera.position.z;
  viewAnim = {
    startQ,
    endQ: endQ.clone(),
    startZ,
    endZ: (typeof endZ === 'number') ? endZ : startZ,
    startTime: performance.now(),
    duration
  };
}

/* ==========================================================================
   7. INTERACTION & POINTER EVENT HANDLERS
   ========================================================================== */
function onPointerDown(event) {
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size === 1) {
    isDragging = true;
    canvas.classList.add('dragging');
    hideTooltip();
    try { canvas.setPointerCapture(event.pointerId); } catch (e) {}
    lastPointerPos = { x: event.clientX, y: event.clientY };
  }
}

function onPointerMove(event) {
  if (activePointers.has(event.pointerId)) {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  if (activePointers.size === 2) {
    isDragging = false;
    canvas.classList.remove('dragging');
    const pts = Array.from(activePointers.values());
    const curDiff = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);

    if (prevTouchDiff > 0) {
      const delta = prevTouchDiff - curDiff;
      camera.position.z += delta * 1.4;
      camera.position.z = Math.max(zoomMinZ, Math.min(zoomMaxZ, camera.position.z));
    }
    prevTouchDiff = curDiff;
    return;
  }

  if (!isDragging || !lastPointerPos || !globe) return;

  const dx = event.clientX - lastPointerPos.x;
  const dy = event.clientY - lastPointerPos.y;
  lastPointerPos = { x: event.clientX, y: event.clientY };

  if (dx === 0 && dy === 0) return;

  const rect = canvas.getBoundingClientRect();
  const refDimension = Math.min(rect.width, rect.height) || 1;

  let zoomScale = 1;
  if (baseFitDistance && camera && camera.position) {
    zoomScale = camera.position.z / baseFitDistance;
    zoomScale = Math.max(0.35, Math.min(1.6, zoomScale));
  }

  const rotSpeed = (Math.PI / refDimension) * 0.55 * zoomScale;
  const yaw = dx * rotSpeed;
  const pitch = dy * rotSpeed;

  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);

  globe.quaternion.premultiply(qYaw).premultiply(qPitch);
}

function onPointerUp(event) {
  activePointers.delete(event.pointerId);
  if (activePointers.size < 2) {
    prevTouchDiff = -1;
  }
  if (activePointers.size === 0) {
    if (event && event.pointerId) {
      try { canvas.releasePointerCapture(event.pointerId); } catch (e) {}
    }
    isDragging = false;
    canvas.classList.remove('dragging');
    lastPointerPos = null;
  }
}

function onWheel(event) {
  event.preventDefault();
  if (!camera) return;
  const delta = event.deltaY;
  const zoomSpeed = 0.45;
  camera.position.z += delta * zoomSpeed;
  camera.position.z = Math.max(zoomMinZ, Math.min(zoomMaxZ, camera.position.z));
}

// Funzione che restituisce i paesi attualmente colorati (percorso, corrente, obiettivo, vicini)
function getColoredCountries() {
  if (gameType === 'guess') {
    if (!guessGame) return [];
    const list = [];
    // Mostro il nome solo dei paesi già verdi (il target resta anonimo finché non lo indovini)
    guessGame.greenCodes.forEach(code => {
      const c = iso3Map.get(code);
      if (c && c.feature) list.push(c);
    });
    return list;
  }

  if (!game) return [];

  if (previewState && Array.isArray(previewState.codes)) {
    const codes = new Set(previewState.codes);
    const list = [];
    codes.forEach(code => {
      const c = iso3Map.get(code);
      if (c && c.feature) list.push(c);
    });
    return list;
  }

  const codes = new Set(game.path || []);
  if (game.target) codes.add(game.target.code);
  // NON aggiungiamo più i vicini
  const list = [];
  codes.forEach(code => {
    const c = iso3Map.get(code);
    if (c && c.feature) list.push(c);
  });
  return list;
}
function onCanvasHover(event) {
  if (isDragging || !globe || !camera) {
    hideTooltip();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
  const hits = raycaster.intersectObject(globe);
  if (!hits.length) {
    hideTooltip();
    return;
  }
  const worldPoint = hits[0].point.clone().normalize();
  const invQ = globe.quaternion.clone().invert();
  const localPoint = worldPoint.applyQuaternion(invQ);
  const ll = vectorToLatLon(localPoint);

  const colored = getColoredCountries();
  let found = null;
  for (const country of colored) {
    if (country.feature && pointInFeatureLatLon(ll.lon, ll.lat, country.feature)) {
      found = country;
      break;
    }
  }

  if (found) showTooltip(event.clientX, event.clientY, found.name);
  else hideTooltip();
}

/* ==========================================================================
   8. TEXTURE RENDERING & CANVAS DRAWING
   ========================================================================== */
function renderTexture() {
  textureContext.clearRect(0, 0, textureWidth, textureHeight);
  
  textureContext.fillStyle = '#090d16';
  textureContext.fillRect(0, 0, textureWidth, textureHeight);

  if (previewState) {
    geoDrawPathPreview(previewState);
  } else if (gameType === 'guess') {
    geoDrawGuessCountries();
    drawIslandConnections();
  } else {
    geoDrawAllCountries();
    drawIslandConnections();
    // drawSmallCountryDots() rimosso
  }

  if (globeMaterial && globeMaterial.map) globeMaterial.map.needsUpdate = true;
}

function geoDrawPathPreview(preview) {
  const codes = preview.codes;
  const codeSet = new Set(codes);
  const indexOf = new Map();
  codes.forEach((code, i) => indexOf.set(code, i));

  const fromColor = preview.mode === 'shortest' ? [56, 189, 248, 0.95] : [200, 255, 180, 0.98];
  const toColor = preview.mode === 'shortest' ? [124, 58, 237, 0.95] : [0, 200, 83, 0.98];
  const lineColor = preview.mode === 'shortest' ? 'rgba(56, 189, 248, 0.85)' : 'rgba(0, 200, 83, 0.85)';

  for (const country of renderCountries) {
    if (!country.feature || codeSet.has(country.code)) continue;
    drawGeoFeature(country.feature, '#1b2433', true);
  }

  const lastIdx = Math.max(1, codes.length - 1);
  codes.forEach(code => {
    const country = iso3Map.get(code);
    if (!country || !country.feature) return;
    const t = indexOf.get(code) / lastIdx;
    const fillStyle = lerpColorRGBA(fromColor, toColor, t);
    drawGeoFeature(country.feature, fillStyle, true);
  });

  drawIslandConnections();

  textureContext.save();
  textureContext.lineWidth = 3;
  textureContext.strokeStyle = lineColor;
  textureContext.setLineDash([]);
  for (let i = 0; i < codes.length - 1; i++) {
    const a = iso3Map.get(codes[i]);
    const b = iso3Map.get(codes[i + 1]);
    if (!a?.feature || !b?.feature) continue;
    const p1 = computeFeatureCentroid(a.feature);
    let p2 = computeFeatureCentroid(b.feature);
    let lon2 = p2.lon;
    const dLon = lon2 - p1.lon;
    if (dLon > 180) lon2 -= 360;
    if (dLon < -180) lon2 += 360;

    [0, -360, 360].forEach(offset => {
      const [x1, y1] = projectPoint([p1.lon + offset, p1.lat]);
      const [x2, y2] = projectPoint([lon2 + offset, p2.lat]);
      textureContext.beginPath();
      textureContext.moveTo(x1, y1);
      textureContext.lineTo(x2, y2);
      textureContext.stroke();
    });
  }
  textureContext.restore();

  // Rimosso disegno dei pin di inizio/fine
}

function geoDrawAllCountries() {
  const currentCode = game?.current?.code;
  const targetCode = game?.target?.code;

  const pathIndex = new Map();
  if (game && Array.isArray(game.path)) {
    game.path.forEach((code, i) => pathIndex.set(code, i));
  }

  const neighborCodes = new Set();
  if (
    selectedGameMode !== 'hardcore' &&
    game?.current &&
    Array.isArray(game.current.borders)
  ) {
    game.current.borders.forEach(code => neighborCodes.add(code));
  }

  for (const country of renderCountries) {
    const feature = country.feature;
    if (!feature) continue;

    const isCurrent = country.code === currentCode;
    const isTarget = country.code === targetCode;
    const isVisited = pathIndex.has(country.code);
    const isHint = !isCurrent && !isTarget && !isVisited && country.code === hintHighlightCode;
    const isNeighbor = !isCurrent && !isTarget && !isVisited && !isHint && neighborCodes.has(country.code);

    if (selectedGameMode === 'hardcore' && !isVisited && !isTarget) {
      continue;
    }

    let fillStyle = '#2d3748';
    let drawBorder = selectedGameMode !== 'hardcore';
    let neighborHighlight = false;

    if (isCurrent) {
      fillStyle = COLOR_CURRENT;
      drawBorder = true;
    } else if (isTarget) {
      fillStyle = COLOR_TARGET;
      drawBorder = true;
    } else if (isVisited) {
      const idx = pathIndex.get(country.code);
      const last = Math.max(1, (game.path.length - 1));
      const t = idx / last;
      fillStyle = lerpColorRGBA([200, 255, 180, 0.98], [0, 200, 83, 0.98], t);
      drawBorder = true;
    } else if (isHint) {
      fillStyle = 'rgba(255, 179, 0, 0.9)';
      drawBorder = true;
    } else if (isNeighbor) {
      fillStyle = 'rgba(56, 189, 248, 0.30)';
      drawBorder = true;
      neighborHighlight = true;
    }

    drawGeoFeature(feature, fillStyle, drawBorder, neighborHighlight);
  }
}

function drawGeoFeature(feature, fillStyle, drawBorder = true, neighborHighlight = false) {
  const geometry = feature.geometry;
  const rings = [];
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach(ring => rings.push(ring));
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(polygon => polygon.forEach(ring => rings.push(ring)));
  }

  const unwrappedRings = rings.map(unwrapRingLongitudes);
  const needsWrap = unwrappedRings.some(pts => {
    const lons = pts.map(p => p[0]);
    return Math.min(...lons) < -180 || Math.max(...lons) > 180;
  });
  const lonOffsets = needsWrap ? [-360, 0, 360] : [0];

  textureContext.beginPath();
  lonOffsets.forEach(offset => {
    unwrappedRings.forEach(pts => drawRing(pts, offset));
  });
  textureContext.fillStyle = fillStyle;
  textureContext.fill();

  if (drawBorder) {
    textureContext.save();
    textureContext.shadowBlur = 0;

    textureContext.lineWidth = 2.5;
    textureContext.strokeStyle = 'rgba(0,0,0,0.5)';
    textureContext.stroke();

    textureContext.lineWidth = 1;
    textureContext.strokeStyle = neighborHighlight ? 'rgba(125, 211, 252, 0.9)' : 'rgba(255,255,255,0.7)';
    textureContext.stroke();

    textureContext.restore();
  } else {
    textureContext.save();
    textureContext.lineWidth = 2;
    textureContext.strokeStyle = fillStyle;
    textureContext.stroke();
    textureContext.restore();
  }
}

function unwrapRingLongitudes(ring) {
  if (!ring || !ring.length) return [];
  const out = [];
  let prevLon = null;
  let offset = 0;
  for (let i = 0; i < ring.length; i++) {
    let [lon, lat] = ring[i];
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    if (prevLon !== null) {
      const diff = lon - prevLon;
      if (diff > 180) offset -= 360;
      else if (diff < -180) offset += 360;
    }
    out.push([lon + offset, lat]);
    prevLon = lon;
  }
  return out;
}

function drawRing(points, lonOffset = 0) {
  if (!points || points.length === 0) return;
  let started = false;
  for (let i = 0; i < points.length; i++) {
    const [lon, lat] = points[i];
    const [x, y] = projectPoint([lon + lonOffset, lat]);
    if (!started) {
      textureContext.moveTo(x, y);
      started = true;
    } else {
      textureContext.lineTo(x, y);
    }
  }
  try { textureContext.closePath(); } catch (e) {}
}

function drawIslandConnections() {
  if (!islandConnections.length) return;

  const visitedCodes = new Set(game?.path || []);
  const targetCode = game?.target?.code;

  textureContext.save();
  textureContext.setLineDash([6, 7]);
  textureContext.lineWidth = 1.8;
  textureContext.strokeStyle = 'rgba(255,255,255,0.45)';
  
  islandConnections.forEach(({ a, b }) => {
    if (selectedGameMode === 'hardcore') {
      const aVisible = visitedCodes.has(a) || a === targetCode;
      const bVisible = visitedCodes.has(b) || b === targetCode;
      if (!aVisible || !bVisible) return;
    }

    const ca = iso3Map.get(a);
    const cb = iso3Map.get(b);
    if (!ca?.feature || !cb?.feature) return;
    const p1 = computeFeatureCentroid(ca.feature);
    const p2 = computeFeatureCentroid(cb.feature);
    
    let lon2 = p2.lon;
    let dLon = lon2 - p1.lon;
    if (dLon > 180) lon2 -= 360;
    if (dLon < -180) lon2 += 360;

    const offsets = [0, -360, 360];
    offsets.forEach(offset => {
      const [x1, y1] = projectPoint([p1.lon + offset, p1.lat]);
      const [x2, y2] = projectPoint([lon2 + offset, p2.lat]);
      textureContext.beginPath();
      textureContext.moveTo(x1, y1);
      textureContext.lineTo(x2, y2);
      textureContext.stroke();
    });
  });
  textureContext.restore();
}

/* ==========================================================================
   9. DATA METADATA, SEARCH & GEO MATH UTILITIES
   ========================================================================== */
function buildCountryMetadata(countryData, geoFeatures) {
  countryData.forEach(country => {
    if (!country.cca3 || !country.ccn3) return;
    const iso3 = country.cca3;
    const numericId = Number(country.ccn3);
    const region = country.region || (Array.isArray(country.continents) ? country.continents[0] : 'Unknown');
    const item = {
      name: country.name && country.name.common ? country.name.common : iso3,
      code: iso3,
      borders: country.borders || [],
      altNames: buildAliases(country),
      numericId,
      region,
      population: typeof country.population === 'number' ? country.population : null,
      area: typeof country.area === 'number' ? country.area : null,
      feature: null
    };
    iso3Map.set(iso3, item);
    item.altNames.forEach(alias => {
      const key = normalizeName(alias);
      const keyCompact = key.replace(/\s+/g, '');
      if (!nameMap.has(key)) nameMap.set(key, item);
      if (keyCompact && !nameMapCompact.has(keyCompact)) nameMapCompact.set(keyCompact, item);
    });
    const primaryKey = normalizeName(item.name);
    const primaryKeyCompact = primaryKey.replace(/\s+/g, '');
    nameMap.set(primaryKey, item);
    nameMapCompact.set(primaryKeyCompact, item);
  });

  geoFeatures.forEach(feature => {
    const id = Number(feature.id);
    if (!Number.isFinite(id)) return;
    for (const country of iso3Map.values()) {
      if (country.numericId === id) {
        country.feature = feature;
        featureByIso.set(country.code, feature);
        break;
      }
    }
  });

  connectIslandsToNearest();
  countries = Array.from(iso3Map.values()).filter(country => country.borders.length > 0 && country.feature);
  renderCountries = Array.from(iso3Map.values()).filter(country => country.feature);
}

function connectIslandsToNearest() {
  islandConnections = [];
  const withFeature = Array.from(iso3Map.values()).filter(c => c.feature);
  const islands = withFeature.filter(c => c.borders.length === 0);
  islands.forEach(island => {
    const centroidA = computeFeatureCentroid(island.feature);
    let best = null;
    let bestDist = Infinity;
    withFeature.forEach(other => {
      if (other.code === island.code) return;
      const centroidB = computeFeatureCentroid(other.feature);
      const d = haversineDistance(centroidA, centroidB);
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    });
    if (best) {
      if (!island.borders.includes(best.code)) island.borders.push(best.code);
      if (!best.borders.includes(island.code)) best.borders.push(island.code);
      islandConnections.push({ a: island.code, b: best.code });
    }
  });
}

function buildAliases(country) {
  const aliases = [];
  if (country.name && country.name.common) aliases.push(country.name.common);
  if (country.name && country.name.official && country.name.official !== country.name.common) aliases.push(country.name.official);
  if (country.translations && country.translations.ita) {
    const t = country.translations.ita;
    if (t.common) aliases.push(t.common);
    if (t.official && t.official !== t.common) aliases.push(t.official);
  }
  if (Array.isArray(country.altSpellings)) {
    country.altSpellings.forEach(alias => {
      if (typeof alias === 'string' && alias.trim()) aliases.push(alias);
    });
  }
  if (country.cca2) aliases.push(country.cca2);
  if (country.ccn3) aliases.push(String(country.ccn3));
  if (country.cca3) aliases.push(country.cca3);
  return aliases;
}

function findCountryByName(value) {
  const raw = (value || '').trim();
  const key = normalizeName(raw);
  if (!key) return null;
  const keyCompact = key.replace(/\s+/g, '');
  if (!keyCompact) return null;

  if (nameMap.has(key)) return nameMap.get(key);
  if (nameMapCompact.has(keyCompact)) return nameMapCompact.get(keyCompact);

  if (keyCompact.length >= 4) {
    let prefixBest = null;
    let prefixBestLen = Infinity;
    for (const [name, country] of nameMapCompact) {
      if (name.length >= 4 && name.startsWith(keyCompact) && name.length < prefixBestLen) {
        prefixBest = country;
        prefixBestLen = name.length;
      }
    }
    if (prefixBest) return prefixBest;
  }

  if (keyCompact.length >= 5) {
    let best = null;
    let bestLen = 0;
    for (const [name, country] of nameMapCompact) {
      if (name.length < 5) continue;
      if (name.includes(keyCompact) || keyCompact.includes(name)) {
        if (name.length > bestLen) {
          best = country;
          bestLen = name.length;
        }
      }
    }
    if (best) return best;
  }

  return null;
}

function normalizeName(str) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/["'‘’‚,\.\-\/\(\)]/g, '')
    .replace(/\s+/g, ' ');
}

function haversineDistance(p1, p2) {
  const R = 6371;
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  let dLonDeg = p2.lon - p1.lon;
  while (dLonDeg > 180) dLonDeg -= 360;
  while (dLonDeg < -180) dLonDeg += 360;
  const dLon = dLonDeg * Math.PI / 180;
  const lat1 = p1.lat * Math.PI / 180;
  const lat2 = p2.lat * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeShortestPathCodes(start, target) {
  if (!start || !target) return null;
  if (start.code === target.code) return [start.code];

  const parent = new Map();
  const visited = new Set([start.code]);
  const queue = [start];

  while (queue.length) {
    const cur = queue.shift();
    if (cur.code === target.code) break;
    for (const b of cur.borders) {
      const neigh = iso3Map.get(b);
      if (!neigh || visited.has(neigh.code)) continue;
      visited.add(neigh.code);
      parent.set(neigh.code, cur.code);
      queue.push(neigh);
    }
  }

  if (!visited.has(target.code)) return null;

  const path = [target.code];
  let cur = target.code;
  while (cur !== start.code) {
    cur = parent.get(cur);
    if (!cur) return null;
    path.push(cur);
  }
  path.reverse();
  return path;
}

function computeReachableWithDistance(start) {
  const dist = new Map();
  const queue = [start];
  dist.set(start.code, 0);
  while (queue.length) {
    const cur = queue.shift();
    const d = dist.get(cur.code);
    for (const b of cur.borders) {
      const neigh = iso3Map.get(b);
      if (!neigh) continue;
      if (!dist.has(neigh.code)) {
        dist.set(neigh.code, d + 1);
        queue.push(neigh);
      }
    }
  }
  return dist;
}

function computeFeaturePixelBounds(feature) {
  if (!feature || !feature.geometry) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const geom = feature.geometry;
  function addPoint(lon, lat) {
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;
    const [x, y] = projectPoint([lon, lat]);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (geom.type === 'Polygon') {
    geom.coordinates.forEach(ring => ring.forEach(([lon, lat]) => addPoint(lon, lat)));
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates.forEach(polygon => polygon.forEach(ring => ring.forEach(([lon, lat]) => addPoint(lon, lat))));
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function computeFeatureCentroid(feature) {
  if (!feature || !feature.geometry) return { lon: 0, lat: 0 };
  const geom = feature.geometry;

  function ringCentroid3D(ring) {
    let x = 0, y = 0, z = 0, n = 0;
    ring.forEach(([lon, lat]) => {
      const radLon = (lon * Math.PI) / 180;
      const radLat = (lat * Math.PI) / 180;
      x += Math.cos(radLat) * Math.cos(radLon);
      y += Math.cos(radLat) * Math.sin(radLon);
      z += Math.sin(radLat);
      n++;
    });
    if (n === 0) return null;
    x /= n; y /= n; z /= n;
    const hyp = Math.sqrt(x * x + y * y);
    const lon = Math.atan2(y, x) * (180 / Math.PI);
    const lat = Math.atan2(z, hyp) * (180 / Math.PI);
    return { lon, lat };
  }

  function polygonArea(ring) {
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      let ax = x1, bx = x2;
      if (ax > 180) ax -= 360;
      if (bx > 180) bx -= 360;
      area += (ax * y2 - bx * y1);
    }
    return Math.abs(area) / 2;
  }

  let bestCentroid = null;
  let bestArea = -1;

  if (geom.type === 'Polygon') {
    const outer = geom.coordinates[0] || [];
    bestArea = polygonArea(outer);
    bestCentroid = ringCentroid3D(outer);
  } else if (geom.type === 'MultiPolygon') {
    for (const polygon of geom.coordinates) {
      const outer = polygon[0] || [];
      const a = polygonArea(outer);
      if (a > bestArea) {
        bestArea = a;
        bestCentroid = ringCentroid3D(outer);
      }
    }
  }

  if (!bestCentroid) return { lon: 0, lat: 0 };
  return bestCentroid;
}

function projectPoint([lon, lat]) {
  return [
    ((lon + 180) / 360) * textureWidth,
    ((90 - lat) / 180) * textureHeight
  ];
}

function latLonToVector(lonDeg, latDeg) {
  const phi = (90 - latDeg) * Math.PI / 180;
  const theta = (lonDeg + 180) * Math.PI / 180;
  const x = -Math.sin(phi) * Math.cos(theta);
  const z = Math.sin(phi) * Math.sin(theta);
  const y = Math.cos(phi);
  return new THREE.Vector3(x, y, z).normalize();
}

function vectorToLatLon(v) {
  const x = v.x, y = v.y, z = v.z;
  const phi = Math.acos(y);
  const theta = Math.atan2(z, -x);
  const lat = 90 - (phi * 180 / Math.PI);
  let lon = (theta * 180 / Math.PI) - 180;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lon, lat };
}

function pointInFeatureLatLon(lon, lat, feature) {
  const geom = feature.geometry;
  if (geom.type === 'Polygon') {
    return polygonContains(geom.coordinates, lon, lat);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      if (polygonContains(poly, lon, lat)) return true;
    }
  }
  return false;
}

function polygonContains(rings, lon, lat) {
  if (!rings || rings.length === 0) return false;
  const point = [lon, lat];
  const outer = rings[0];
  if (!ringContains(outer, point)) return false;
  for (let i = 1; i < rings.length; i++) {
    if (ringContains(rings[i], point)) return false;
  }
  return true;
}

function ringContains(ring, point) {
  const px = point[0];
  const py = point[1];
  let sum = 0;
  for (const p of ring) { sum += p[0]; }
  const avg = sum / ring.length;
  let shift = 0;
  let diff = px - avg;
  if (diff > 180) shift = 360;
  else if (diff < -180) shift = -360;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    let xi = ring[i][0] + shift, yi = ring[i][1];
    let xj = ring[j][0] + shift, yj = ring[j][1];
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi + 0.0) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerpColorRGBA(a, b, t) {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  const alpha = (a[3] + (b[3] - a[3]) * t);
  return `rgba(${r},${g},${bl},${alpha})`;
}