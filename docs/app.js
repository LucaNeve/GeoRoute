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
const victoryOverlay = document.getElementById('victoryOverlay');
const victoryTitle = document.getElementById('victoryTitle');
const victoryMessage = document.getElementById('victoryMessage');
const victoryBadge = document.getElementById('victoryBadge');
const playAgainButton = document.getElementById('playAgainButton');
const closeVictoryButton = document.getElementById('closeVictoryButton');
const countryTooltip = document.getElementById('countryTooltip');
const timerDisplay = document.getElementById('timerDisplay');

/* ==========================================================================
   2. CONSTANTS & GLOBAL STATE
   ========================================================================== */
const COLOR_CURRENT = 'rgba(0, 200, 83, 0.98)';
const COLOR_TARGET = 'rgba(220, 20, 60, 0.98)';
const MICROSTATE_ISO3 = new Set(['MCO', 'SMR', 'VAT', 'LIE', 'AND', 'MLT']);

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
let featureByIso = new Map();
let game = null;
let isDragging = false;
let showSuggestions = false;
let overlayMode = 'setup';
let selectedGameMode = 'standard';
let speedrunTimer = null;
let speedrunTimeLeft = 60;

let sphereRadius = 170;
let zoomMinZ = 320;
let zoomMaxZ = 900;
let baseFitDistance = null;
let viewAnim = null;
let islandConnections = [];
let trackStartVec = null;
let trackStartQuat = null;

// Gestione Touch & Pinch-to-Zoom
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
  if (countryInput) countryInput.disabled = false;
  if (submitButton) submitButton.disabled = false;
  document.title = 'GeoRoute';
  startNewGame();
  animate();
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

  setActiveMode('standard');
  setActiveDifficulty('medium');
  setActiveContinent('all');

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

  if (menuButton && settingsMenu) {
    menuButton.addEventListener('click', () => settingsMenu.classList.toggle('hidden'));
    window.addEventListener('pointerdown', (e) => {
      if (!settingsMenu.contains(e.target) && e.target !== menuButton) settingsMenu.classList.add('hidden');
    });
  }

  if (newGameButton) {
    newGameButton.addEventListener('click', () => {
      if (settingsMenu) settingsMenu.classList.add('hidden');
      openGameOverlay('setup');
    });
  }

  if (playAgainButton) {
    playAgainButton.addEventListener('click', () => {
      hideVictoryOverlay();
      startNewGame();
    });
  }

  if (closeVictoryButton) closeVictoryButton.addEventListener('click', hideVictoryOverlay);

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
    if (!game) return;
    const undo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z';
    const altLeft = e.altKey && e.key === 'ArrowLeft';
    if (undo || altLeft) doUndo();
  });
}

function setActiveMode(mode) {
  selectedGameMode = mode;
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Gestione visibilità Custom Match Options
  const customContainer = document.getElementById('customGameOptions');
  if (customContainer) {
    customContainer.classList.toggle('hidden', mode !== 'custom');
  }

  // Disabilita Difficoltà e Continente se in modalità Personalizzata
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

/* ==========================================================================
   4. GAME LOGIC & TIMER
   ========================================================================== */
function startNewGame() {
  if (!countries.length) return;

  stopSpeedrunTimer();

  let start = null;
  let target = null;

  const diff = (document.querySelector('[data-choice-group="difficulty"] .active') || {}).dataset?.diff || 'medium';
  const continent = (document.querySelector('[data-choice-group="continent"] .active') || {}).dataset?.cont || 'all';

  /* ==========================================================================
     1. MODALITÀ PERSONALIZZATA (CUSTOM)
     ========================================================================== */
  if (selectedGameMode === 'custom') {
    const customStartInput = document.getElementById('customStartInput');
    const customTargetInput = document.getElementById('customTargetInput');

    const customStart = findCountryByName(customStartInput?.value);
    const customTarget = findCountryByName(customTargetInput?.value);

    if (!customStart || !customTarget) {
      statusLabel.textContent = 'Seleziona due stati validi per la partita personalizzata.';
      return;
    }

    if (customStart.code === customTarget.code) {
      statusLabel.textContent = 'Partenza e destinazione non possono coincidere.';
      return;
    }

    const distMap = computeReachableWithDistance(customStart);
    if (!distMap.has(customTarget.code)) {
      statusLabel.textContent = `${customTarget.name} non è raggiungibile da ${customStart.name}.`;
      return;
    }

    start = customStart;
    target = customTarget;
  } else {
    /* ==========================================================================
       2. MODALITÀ STANDARD / SPEEDRUN / HARDCORE / FOG (Partenza + Arrivo nello stesso continente)
       ========================================================================== */
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

      // Filtra i target raggiungibili garantendo che anche l'arrivo sia nello STESSO continente
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

  game = {
    start,
    current: start,
    target,
    visited: new Set([start.code]),
    path: [start.code]
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
    startSpeedrunTimer();
  } else if (timerDisplay) {
    timerDisplay.classList.add('hidden');
  }

  updateLabels();
  statusLabel.textContent = '';
  renderTexture();
  hideVictoryOverlay();
}

function submitMove() {
  const text = (countryInput.value || '').trim();
  if (!text || !game) return;

  const next = findCountryByName(text);
  if (!next) {
    statusLabel.textContent = 'Stato non riconosciuto.';
    return;
  }

  if (next.code === game.current.code) {
    statusLabel.textContent = 'Sei già in questo stato.';
    return;
  }

  if (!game.current.borders.includes(next.code)) {
    statusLabel.textContent = `${next.name} non è confinante.`;
    return;
  }

  const path = game.path || [];
  const prevCode = path.length >= 2 ? path[path.length - 2] : null;
  if (game.visited.has(next.code) && next.code !== prevCode) {
    statusLabel.textContent = 'Hai già attraversato questo stato.';
    return;
  }

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

  if (game.current.code === game.target.code) {
    stopSpeedrunTimer();
    statusLabel.textContent = 'Obiettivo raggiunto!';
    openGameOverlay('victory');
  } else {
    statusLabel.textContent = '';
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
}

function startSpeedrunTimer() {
  stopSpeedrunTimer();
  speedrunTimeLeft = 60;
  if (timerDisplay) {
    timerDisplay.classList.remove('hidden', 'warning');
    timerDisplay.textContent = '⏱ 01:00';
  }

  speedrunTimer = setInterval(() => {
    speedrunTimeLeft--;
    if (timerDisplay) {
      const secs = speedrunTimeLeft % 60;
      const secsStr = secs < 10 ? '0' + secs : secs;
      timerDisplay.textContent = `⏱ 00:${secsStr}`;

      if (speedrunTimeLeft <= 10) timerDisplay.classList.add('warning');
    }

    if (speedrunTimeLeft <= 0) {
      stopSpeedrunTimer();
      statusLabel.textContent = 'Tempo scaduto!';
      openGameOverlay('defeat');
    }
  }, 1000);
}

function stopSpeedrunTimer() {
  if (speedrunTimer) {
    clearInterval(speedrunTimer);
    speedrunTimer = null;
  }
}

function openGameOverlay(mode) {
  if (!victoryOverlay) return;
  overlayMode = mode;
  if (mode === 'victory') {
    const startName = game?.start?.name || 'Partenza';
    const targetName = game?.target?.name || 'Obiettivo';
    if (victoryBadge) victoryBadge.textContent = '🏆';
    if (victoryTitle) victoryTitle.textContent = 'Hai vinto!';
    if (victoryMessage) victoryMessage.textContent = `Hai raggiunto ${targetName} partendo da ${startName}. Vuoi giocare un'altra sfida?`;
    if (playAgainButton) playAgainButton.textContent = 'Gioca ancora';
    if (closeVictoryButton) closeVictoryButton.textContent = 'Chiudi';
  } else if (mode === 'defeat') {
    if (victoryBadge) victoryBadge.textContent = '⏱️';
    if (victoryTitle) victoryTitle.textContent = 'Tempo Scaduto!';
    if (victoryMessage) victoryMessage.textContent = 'Non sei riuscito a raggiungere la destinazione in tempo. Riprova!';
    if (playAgainButton) playAgainButton.textContent = 'Riprova';
    if (closeVictoryButton) closeVictoryButton.textContent = 'Chiudi';
  } else {
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

function updateAutocompleteSuggestions() {
  if (!suggestionsList || !countryInput) return;

  const query = normalizeName(countryInput.value);
  if (!showSuggestions || selectedGameMode === 'hardcore' || !query) {
    suggestionsList.innerHTML = '';
    suggestionsList.classList.add('hidden');
    return;
  }

  suggestionsList.innerHTML = '';
  const candidates = [];
  const added = new Set();

  if (game && game.current && Array.isArray(game.current.borders)) {
    game.current.borders.forEach(borderCode => {
      const borderCountry = iso3Map.get(borderCode);
      if (borderCountry && !added.has(borderCountry.name)) {
        if (normalizeName(borderCountry.name).includes(query)) {
          candidates.push(borderCountry);
          added.add(borderCountry.name);
        }
      }
    });
  }

  countries.forEach(c => {
    if (!added.has(c.name) && normalizeName(c.name).includes(query)) {
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
      submitMove();
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
    window.visualViewport.addEventListener('resize', resize);
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

  submitButton.addEventListener('click', submitMove);
  countryInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') submitMove();
  });
}

function resize() {
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
function mapClientToSphere(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  const length2 = x * x + y * y;
  const z = length2 <= 1 ? Math.sqrt(1 - length2) : 0;
  return new THREE.Vector3(x, y, z).normalize();
}

function onPointerDown(event) {
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size === 1) {
    isDragging = true;
    hideTooltip();
    try { canvas.setPointerCapture(event.pointerId); } catch (e) {}
    trackStartVec = mapClientToSphere(event.clientX, event.clientY);
    trackStartQuat = globe.quaternion.clone();
  }
}

function onPointerMove(event) {
  if (activePointers.has(event.pointerId)) {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  if (activePointers.size === 2) {
    isDragging = false;
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

  if (!isDragging || !trackStartVec) return;
  const currentVec = mapClientToSphere(event.clientX, event.clientY);

  const axis = new THREE.Vector3().crossVectors(trackStartVec, currentVec);
  const dot = Math.max(-1, Math.min(1, trackStartVec.dot(currentVec)));
  let angle = Math.acos(dot);
  if (axis.lengthSq() < 1e-8 || isNaN(angle)) return;
  axis.normalize();

  if (baseFitDistance && camera && camera.position) {
    let scale = camera.position.z / baseFitDistance;
    scale = Math.max(0.15, Math.min(1.2, scale));
    angle = angle * scale;
  }

  const q = new THREE.Quaternion();
  q.setFromAxisAngle(axis, angle);
  globe.quaternion.copy(q.multiply(trackStartQuat));
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
    trackStartVec = null;
    trackStartQuat = null;
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

function onCanvasHover(event) {
  if (isDragging || !game || !globe || !camera) {
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

  const candidates = getColoredCountries();
  let found = null;
  for (const country of candidates) {
    if (pointInFeatureLatLon(ll.lon, ll.lat, country.feature)) {
      found = country;
      break;
    }
  }

  if (found) showTooltip(event.clientX, event.clientY, found.name);
  else hideTooltip();
}

function getColoredCountries() {
  if (!game) return [];
  const codes = new Set(game.path || []);
  if (game.target) codes.add(game.target.code);
  const list = [];
  codes.forEach(code => {
    const c = iso3Map.get(code);
    if (c && c.feature) list.push(c);
  });
  return list;
}

/* ==========================================================================
   8. TEXTURE RENDERING & CANVAS DRAWING
   ========================================================================== */
function renderTexture() {
  textureContext.clearRect(0, 0, textureWidth, textureHeight);
  
  textureContext.fillStyle = '#090d16';
  textureContext.fillRect(0, 0, textureWidth, textureHeight);

  geoDrawAllCountries();
  drawIslandConnections();
  drawSmallCountryDots();

  if (globeMaterial && globeMaterial.map) globeMaterial.map.needsUpdate = true;
}

function geoDrawAllCountries() {
  const currentCode = game?.current?.code;
  const targetCode = game?.target?.code;

  const pathIndex = new Map();
  if (game && Array.isArray(game.path)) {
    game.path.forEach((code, i) => pathIndex.set(code, i));
  }

  for (const country of renderCountries) {
    const feature = country.feature;
    if (!feature) continue;

    const isCurrent = country.code === currentCode;
    const isTarget = country.code === targetCode;
    const isVisited = pathIndex.has(country.code);

    if (selectedGameMode === 'fog' && !isCurrent && !isTarget && !isVisited) {
      continue;
    }

    let fillStyle = '#2d3748';
    let drawBorder = selectedGameMode !== 'hardcore' && selectedGameMode !== 'fog';

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
    }

    drawGeoFeature(feature, fillStyle, drawBorder);
  }
}

function drawGeoFeature(feature, fillStyle, drawBorder = true) {
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
    textureContext.lineWidth = 2.5;
    textureContext.strokeStyle = 'rgba(0,0,0,0.5)';
    textureContext.stroke();
    textureContext.lineWidth = 1.0;
    textureContext.strokeStyle = 'rgba(255,255,255,0.7)';
    textureContext.stroke();
    textureContext.restore();
  } else {
    textureContext.save();
    textureContext.lineWidth = 2.0;
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
  textureContext.save();
  textureContext.setLineDash([6, 7]);
  textureContext.lineWidth = 1.8;
  textureContext.strokeStyle = 'rgba(255,255,255,0.45)';
  
  islandConnections.forEach(({ a, b }) => {
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

function drawSmallCountryDots() {
  if (!game) return;
  const currentCode = game.current?.code;
  const targetCode = game.target?.code;
  if (currentCode) drawMicroMarkerIfNeeded(currentCode, COLOR_CURRENT);
  if (targetCode && targetCode !== currentCode) drawMicroMarkerIfNeeded(targetCode, COLOR_TARGET);
}

function drawMicroMarkerIfNeeded(code, color) {
  const country = iso3Map.get(code);
  if (!country || !country.feature) return;
  const bounds = computeFeaturePixelBounds(country.feature);
  if (!bounds) return;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const pixelThreshold = 12;
  const isMicro = MICROSTATE_ISO3.has(code);
  if (isMicro || Math.max(w, h) <= pixelThreshold) {
    const c = computeFeatureCentroid(country.feature);
    const [cx, cy] = projectPoint([c.lon, c.lat]);

    textureContext.beginPath();
    textureContext.arc(cx, cy, 34, 0, Math.PI * 2);
    textureContext.fillStyle = color.replace(/,[\d.]+\)$/, ',0.28)');
    textureContext.fill();

    textureContext.beginPath();
    const r = 20;
    textureContext.arc(cx, cy, r, 0, Math.PI * 2);
    textureContext.fillStyle = color;
    textureContext.fill();
    textureContext.lineWidth = 3;
    textureContext.strokeStyle = 'rgba(255,255,255,0.98)';
    textureContext.stroke();
  }
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
      feature: null
    };
    iso3Map.set(iso3, item);
    item.altNames.forEach(alias => {
      const key = normalizeName(alias);
      if (!nameMap.has(key)) nameMap.set(key, item);
    });
    nameMap.set(normalizeName(item.name), item);
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

  if (nameMap.has(key)) return nameMap.get(key);

  const parts = key.split(' ');
  for (const [name, country] of nameMap) {
    for (const p of parts) {
      if (name === p) return country;
    }
  }

  let best = null;
  let bestLen = 0;
  for (const [name, country] of nameMap) {
    if (name.includes(key) || key.includes(name)) {
      if (name.length > bestLen) {
        best = country;
        bestLen = name.length;
      }
    }
  }
  return best;
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