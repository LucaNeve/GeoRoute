import * as THREE from './vendor/three.module.min.js';

const canvas = document.getElementById('globeCanvas');
const currentBox = document.getElementById('currentBox');
const targetBox = document.getElementById('targetBox');
const statusLabel = document.getElementById('statusLabel');
const countryInput = document.getElementById('countryInput');
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
let overlayMode = 'victory'; // 'victory' | 'setup' — tracks which flow opened the overlay

// increase texture resolution for crisper country edges
const textureWidth = 4096;
const textureHeight = 2048;
const textureCanvas = document.createElement('canvas');
textureCanvas.width = textureWidth;
textureCanvas.height = textureHeight;
const textureContext = textureCanvas.getContext('2d');
// improve drawing quality
textureContext.imageSmoothingEnabled = true;
textureContext.lineJoin = 'round';
textureContext.lineCap = 'round';

let scene, camera, renderer, globe, globeMaterial;
let countries = [];
let renderCountries = []; // used for drawing the map: includes islands with no land borders
let iso3Map = new Map();
let nameMap = new Map();
let featureByIso = new Map();
let game = null;
let isDragging = false;
let lastX = 0;
let lastY = 0;
let rotationX = Math.PI * -0.18;
let rotationY = Math.PI * 0.14;
let sphereRadius = 170;
let zoomMinZ = 320;
let zoomMaxZ = 900;
let baseFitDistance = null; // reference fit distance to scale rotation sensitivity
let viewAnim = null; // { startQ, endQ, startZ, endZ, startTime, duration }
let islandConnections = []; // [{a: iso3, b: iso3}] sea-route links drawn like Risiko
const raycaster = new THREE.Raycaster();

function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

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
  // ensure inputs enabled
  if (countryInput) {
    countryInput.disabled = false;
  }
  if (submitButton) submitButton.disabled = false;
  document.title = 'GeoRoute';
  startNewGame();
  animate();
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

function setupControls() {
  document.querySelectorAll('[data-diff]').forEach(btn => {
    btn.addEventListener('click', () => setActiveDifficulty(btn.dataset.diff));
  });
  document.querySelectorAll('[data-cont]').forEach(btn => {
    btn.addEventListener('click', () => setActiveContinent(btn.dataset.cont));
  });
  setActiveDifficulty('medium');
  setActiveContinent('all');

  // menu toggle
  if (menuButton && settingsMenu) {
    menuButton.addEventListener('click', () => {
      settingsMenu.classList.toggle('hidden');
    });
    // click outside to close
    window.addEventListener('pointerdown', (e) => {
      if (!settingsMenu.contains(e.target) && e.target !== menuButton) settingsMenu.classList.add('hidden');
    });
  }

  // "+" apre il popup per scegliere difficoltà/continente prima di iniziare una nuova partita
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

  if (closeVictoryButton) {
    closeVictoryButton.addEventListener('click', hideVictoryOverlay);
  }

  const alignButton = document.getElementById('alignButton');
  if (alignButton) {
    alignButton.addEventListener('click', () => {
      // realign equator keeping current center
      if (!globe) return;
      const invQ = globe.quaternion.clone().invert();
      const localCenter = new THREE.Vector3(0,0,1).applyQuaternion(invQ);
      const ll = vectorToLatLon(localCenter);
      centerLonLatWithEquator(ll.lon, ll.lat);
    });
  }

  // manual start/target apply
  const applyStart = document.getElementById('applyManualStart');
  const applyTarget = document.getElementById('applyManualTarget');
  const manualStart = document.getElementById('manualStart');
  const manualTarget = document.getElementById('manualTarget');
  if (applyStart && manualStart) {
    applyStart.addEventListener('click', () => {
      const v = (manualStart.value || '').trim();
      const c = findCountryByName(v);
      if (c) {
        // set as start without resetting path
        game.start = c;
        game.current = c;
        game.visited = new Set([c.code]);
        game.path = [c.code];
        updateLabels();
        renderTexture();
        statusLabel.textContent = 'Partenza impostata.';
      } else {
        statusLabel.textContent = 'Nome start non trovato.';
      }
    });
  }
  if (applyTarget && manualTarget) {
    applyTarget.addEventListener('click', () => {
      const v = (manualTarget.value || '').trim();
      const c = findCountryByName(v);
      if (c) {
        game.target = c;
        updateLabels();
        renderTexture();
        statusLabel.textContent = 'Obiettivo impostato.';
      } else {
        statusLabel.textContent = 'Nome target non trovato.';
      }
    });
  }

  // clicking start/target boxes centers view but preserve current camera distance and tilt (bring country to front)
  if (currentBox) currentBox.addEventListener('click', () => { if (game && game.start) centerOnCountryKeepView(game.start); });
  if (targetBox) targetBox.addEventListener('click', () => { if (game && game.target) centerOnCountryKeepView(game.target); });

  // keyboard undo: Ctrl+Z or Alt+Left
  window.addEventListener('keydown', (e) => {
    if (!game) return;
    const undo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z';
    const altLeft = e.altKey && e.key === 'ArrowLeft';
    if (undo || altLeft) {
      doUndo();
    }
  });
}

function doUndo() {
  if (!game || !game.path || game.path.length <= 1) return;
  // remove last
  const removed = game.path.pop();
  game.visited.delete(removed);
  const last = game.path[game.path.length - 1];
  game.current = iso3Map.get(last);
  updateLabels();
  renderTexture();
}

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
      if (!nameMap.has(key)) {
        nameMap.set(key, item);
      }
    });
    // also ensure canonical name is mapped
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

  // collega ogni isola (nessun confine terrestre) al paese più vicino, come le rotte
  // marittime tratteggiate di Risiko: la rende sia visitabile che disegnabile sulla mappa
  connectIslandsToNearest();

  countries = Array.from(iso3Map.values()).filter(country => country.borders.length > 0 && country.feature);
  // renderCountries includes every country with valid map geometry, even islands with no land borders,
  // so they still appear on the globe (just not selectable as start/target for the walking game)
  renderCountries = Array.from(iso3Map.values()).filter(country => country.feature);

  // Special adjacency fixes: connect USA and RUS across Bering Strait so players can traverse
  try {
    const usa = iso3Map.get('USA');
    const rus = iso3Map.get('RUS');
    if (usa && rus) {
      if (!usa.borders.includes('RUS')) usa.borders.push('RUS');
      if (!rus.borders.includes('USA')) rus.borders.push('USA');
    }
  } catch (e) {
    // ignore if mapping not present
  }
}

function haversineDistance(p1, p2) {
  const R = 6371;
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLon = (p2.lon - p1.lon) * Math.PI / 180;
  const lat1 = p1.lat * Math.PI / 180;
  const lat2 = p2.lat * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
      // rotta marittima bidirezionale: rende l'isola raggiungibile come una "traversata"
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
      if (typeof alias === 'string' && alias.trim()) {
        aliases.push(alias);
      }
    });
  }
  // also include cca2/ccn3/cca3 codes
  if (country.cca2) aliases.push(country.cca2);
  if (country.ccn3) aliases.push(String(country.ccn3));
  if (country.cca3) aliases.push(country.cca3);
  return aliases;
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

function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x101010, 1);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  camera.position.set(0, 0, 480);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.95);
  directionalLight.position.set(1, 2, 1);
  scene.add(directionalLight);

  // slightly smaller globe for more UI space
  const sphereGeometry = new THREE.SphereGeometry(170, 64, 64);
  globeMaterial = new THREE.MeshPhongMaterial({
    map: new THREE.CanvasTexture(textureCanvas),
    shininess: 10,
    specular: 0x444444,
    flatShading: false
  });
  globe = new THREE.Mesh(sphereGeometry, globeMaterial);
  scene.add(globe);

  // initial camera: will be adjusted when a game starts to fit the globe
  camera.position.set(0, 0, 480);
  sphereRadius = sphereGeometry.parameters.radius;

  window.addEventListener('resize', resize);
  resize();
  // compute initial zoom limits based on fov and sphere radius
  const fovRad = (camera.fov * Math.PI) / 180;
  const fitDistance = (sphereRadius / Math.sin(fovRad / 2)) * 1.05;
  zoomMinZ = fitDistance * 0.45;
  zoomMaxZ = fitDistance * 3.5;
  baseFitDistance = fitDistance;

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointermove', onCanvasHover);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);
  canvas.addEventListener('pointerleave', hideTooltip);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  submitButton.addEventListener('click', submitMove);
  countryInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      submitMove();
    }
  });
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

// Trackball/arcball style rotation
let trackStartVec = null;
let trackStartQuat = null;

function mapClientToSphere(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  // map to sphere
  const length2 = x * x + y * y;
  const z = length2 <= 1 ? Math.sqrt(1 - length2) : 0;
  return new THREE.Vector3(x, y, z).normalize();
}

function onPointerDown(event) {
  isDragging = true;
  hideTooltip();
  canvas.setPointerCapture(event.pointerId);
  trackStartVec = mapClientToSphere(event.clientX, event.clientY);
  trackStartQuat = globe.quaternion.clone();
}

function onPointerMove(event) {
  if (!isDragging || !trackStartVec) return;
  const currentVec = mapClientToSphere(event.clientX, event.clientY);

  // compute rotation between start and current
  const axis = new THREE.Vector3().crossVectors(trackStartVec, currentVec);
  const dot = Math.max(-1, Math.min(1, trackStartVec.dot(currentVec)));
  let angle = Math.acos(dot);
  if (axis.lengthSq() < 1e-8 || isNaN(angle)) return;
  axis.normalize();

  // scale rotation speed based on current zoom: when the camera is closer (smaller z)
  // reduce the rotation angle so dragging is not too fast when zoomed in.
  if (baseFitDistance && camera && camera.position && typeof camera.position.z === 'number') {
    // ratio <1 when zoomed in (camera.z < baseFitDistance) -> slower rotation
    let scale = camera.position.z / baseFitDistance;
    // clamp reasonable bounds
    scale = Math.max(0.15, Math.min(1.2, scale));
    angle = angle * scale;
  }

  const q = new THREE.Quaternion();
  q.setFromAxisAngle(axis, angle);

  globe.quaternion.copy(q.multiply(trackStartQuat));
}

function onPointerUp(event) {
  isDragging = false;
  trackStartVec = null;
  trackStartQuat = null;
}

// Restituisce i paesi "colorati" del percorso (partenza, tappe visitate, corrente, obiettivo)
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
  // porta il punto d'intersezione nello spazio locale (non ruotato) del globo
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

  if (found) {
    showTooltip(event.clientX, event.clientY, found.name);
  } else {
    hideTooltip();
  }
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

function onWheel(event) {
  // zoom camera by adjusting z position
  event.preventDefault();
  if (!camera) return;
  const delta = event.deltaY;
  const zoomSpeed = 0.45;
  camera.position.z += delta * zoomSpeed;
  camera.position.z = Math.max(zoomMinZ, Math.min(zoomMaxZ, camera.position.z));
}
function renderTexture() {
  textureContext.clearRect(0, 0, textureWidth, textureHeight);
  textureContext.fillStyle = '#202020';
  textureContext.fillRect(0, 0, textureWidth, textureHeight);

  // base stroke preferences
  textureContext.lineWidth = 1.0;
  textureContext.strokeStyle = 'rgba(255,255,255,1)';

  geoDrawAllCountries();
  // rotte marittime tratteggiate verso le isole, stile Risiko
  drawIslandConnections();
  // draw small country markers for microstates that would be invisible otherwise
  drawSmallCountryDots();


  if (globeMaterial && globeMaterial.map) globeMaterial.map.needsUpdate = true;
}

function geoDrawAllCountries() {
  const currentCode = game?.current.code;
  const targetCode = game?.target.code;

  // map visited path code -> index for gradient
  const pathIndex = new Map();
  if (game && Array.isArray(game.path)) {
    game.path.forEach((code, i) => pathIndex.set(code, i));
  }

  for (const country of renderCountries) {
    const feature = country.feature;
    if (!feature) continue;

    let fillStyle = '#3f3f3f';

    if (country.code === currentCode) {
      fillStyle = COLOR_CURRENT;
    } else if (country.code === targetCode) {
      fillStyle = COLOR_TARGET;
    } else if (pathIndex.has(country.code)) {
      // visited path color gradient
      const idx = pathIndex.get(country.code);
      const last = Math.max(1, (game.path.length - 1));
      const t = idx / last;
      // visited path gradient from light to vivid green
      fillStyle = lerpColorRGBA([200,255,180,0.98], [0,200,83,0.98], t);
    } else {
      fillStyle = '#2f2f2f';
    }

    drawGeoFeature(feature, fillStyle);
  }
}

function drawIslandConnections() {
  if (!islandConnections.length) return;
  textureContext.save();
  textureContext.setLineDash([6, 7]);
  textureContext.lineWidth = 1.8;
  textureContext.strokeStyle = 'rgba(255,255,255,0.55)';
  islandConnections.forEach(({ a, b }) => {
    const ca = iso3Map.get(a);
    const cb = iso3Map.get(b);
    if (!ca?.feature || !cb?.feature) return;
    const p1 = computeFeatureCentroid(ca.feature);
    const p2 = computeFeatureCentroid(cb.feature);
    // evita di attraversare l'intera mappa quando la coppia è a cavallo dell'antimeridiano
    let lon2 = p2.lon;
    if (Math.abs(lon2 - p1.lon) > 180) {
      lon2 += (lon2 < p1.lon) ? 360 : -360;
    }
    const [x1, y1] = projectPoint([p1.lon, p1.lat]);
    const [x2, y2] = projectPoint([lon2, p2.lat]);
    textureContext.beginPath();
    textureContext.moveTo(x1, y1);
    textureContext.lineTo(x2, y2);
    textureContext.stroke();
  });
  textureContext.restore();
}

function lerpColorRGBA(a, b, t) {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  const alpha = (a[3] + (b[3] - a[3]) * t);
  return `rgba(${r},${g},${bl},${alpha})`;
}

function drawGeoFeature(feature, fillStyle) {
  const geometry = feature.geometry;
  const rings = [];
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach(ring => rings.push(ring));
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(polygon => polygon.forEach(ring => rings.push(ring)));
  }

  // se il contorno attraversa l'antimeridiano (es. Russia, Fiji, ecc.), lo "srotoliamo"
  // in una sequenza di longitudini continua e lo ridisegniamo anche traslato di ±360°,
  // cosi la parte che uscirebbe da un lato della texture riappare correttamente dall'altro
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
  // fill
  textureContext.fillStyle = fillStyle;
  textureContext.fill();
  // stroke twice for contrast: darker thicker understroke, then bright thin stroke
  textureContext.save();
  textureContext.lineWidth = 3.0; // thicker darker outline
  textureContext.strokeStyle = 'rgba(0,0,0,0.6)';
  textureContext.stroke();
  textureContext.lineWidth = 1.2; // bright inner stroke
  textureContext.strokeStyle = 'rgba(255,255,255,1)';
  textureContext.stroke();
  textureContext.restore();
}

// converte le longitudini di un ring in una sequenza continua (non normalizzata a -180..180),
// cosi due punti consecutivi non "saltano" mai di più di 180°: elimina lo strappo sull'antimeridiano
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
  // ensure ring path is closed to avoid stray connecting strokes
  try { textureContext.closePath(); } catch (e) {}
}

// Known microstates (always show marker when target)
const MICROSTATE_ISO3 = new Set(['MCO','SMR','VAT','LIE','AND','MLT']);

// Detect tiny countries and draw a marker so they're visible even when too small to see:
// green if it's where ti trovi ora (partenza/posizione corrente), red if è l'obiettivo
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
  // if bounds missing, bail
  if (!bounds) return;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  // threshold for small on the high-res texture
  const pixelThreshold = 12; // slightly larger to catch small cases
  const isMicro = MICROSTATE_ISO3.has(code);
  if (isMicro || Math.max(w, h) <= pixelThreshold) {
    const c = computeFeatureCentroid(country.feature);
    const [cx, cy] = projectPoint([c.lon, c.lat]);

    // alone esterno semi-trasparente, per farlo notare anche a zoom lontano
    textureContext.beginPath();
    textureContext.arc(cx, cy, 34, 0, Math.PI * 2);
    textureContext.fillStyle = color.replace(/,[\d.]+\)$/, ',0.28)');
    textureContext.fill();

    // pallino pieno ben visibile
    textureContext.beginPath();
    const r = 20; // marker grande e leggibile sulla texture 4096px
    textureContext.arc(cx, cy, r, 0, Math.PI * 2);
    textureContext.fillStyle = color;
    textureContext.fill();
    // bordo bianco netto
    textureContext.lineWidth = 3;
    textureContext.strokeStyle = 'rgba(255,255,255,0.98)';
    textureContext.stroke();
  }
}


function computeFeaturePixelBounds(feature) {
  if (!feature || !feature.geometry) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const geom = feature.geometry;
  function addPoint(lon, lat) {
    // normalize lon
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

function projectPoint([lon, lat]) {
  return [
    ((lon + 180) / 360) * textureWidth,
    ((90 - lat) / 180) * textureHeight
  ];
}

function randomCountry() {
  return countries[Math.floor(Math.random() * countries.length)];
}

function collectReachable(start) {
  const reachable = [];
  const seen = new Set([start.code]);
  const queue = [start];

  while (queue.length) {
    const current = queue.shift();
    reachable.push(current);
    for (const border of current.borders) {
      const neighbor = iso3Map.get(border);
      if (neighbor && !seen.has(neighbor.code)) {
        seen.add(neighbor.code);
        queue.push(neighbor);
      }
    }
  }
  return reachable;
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
  return dist; // map code -> distance
}

function computeFeatureCentroid(feature) {
  // Prefer centroid of the largest polygon (outer ring) to better locate microstates and exclaves
  if (!feature || !feature.geometry) return { lon: 0, lat: 0 };
  const geom = feature.geometry;

  function polygonOuterCentroid(ring) {
    // compute simple average of points in outer ring
    let sx = 0, sy = 0, n = 0;
    ring.forEach(([lon, lat]) => {
      if (lon > 180) lon -= 360;
      if (lon < -180) lon += 360;
      sx += lon; sy += lat; n += 1;
    });
    if (n === 0) return null;
    return { lon: sx / n, lat: sy / n };
  }

  function polygonArea(ring) {
    // approximate area on equirectangular projection using shoelace on lon/lat
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      let ax = x1, bx = x2;
      // normalize lon for area calc
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
    bestCentroid = polygonOuterCentroid(outer);
  } else if (geom.type === 'MultiPolygon') {
    for (const polygon of geom.coordinates) {
      const outer = polygon[0] || [];
      const a = polygonArea(outer);
      if (a > bestArea) {
        bestArea = a;
        bestCentroid = polygonOuterCentroid(outer);
      }
    }
  }

  if (!bestCentroid) return { lon: 0, lat: 0 };
  // normalize
  let lon = bestCentroid.lon;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lon, lat: bestCentroid.lat };
}

function latLonToVector(lonDeg, latDeg) {
  // convert lon/lat to a unit vector compatible with the sphere's orientation used in texture mapping
  const phi = (90 - latDeg) * Math.PI / 180; // polar angle
  const theta = (lonDeg + 180) * Math.PI / 180; // azimuthal
  const x = -Math.sin(phi) * Math.cos(theta);
  const z = Math.sin(phi) * Math.sin(theta);
  const y = Math.cos(phi);
  return new THREE.Vector3(x, y, z).normalize();
}

function startNewGame() {
  if (!countries.length) return;

  let start = null;
  let target = null;

  const diff = (document.querySelector('[data-choice-group="difficulty"] .small.active') || {}).dataset?.diff || 'medium';
  const continent = (document.querySelector('[data-choice-group="continent"] .small.active') || {}).dataset?.cont || 'all';

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
    const targets = Array.from(distMap.entries()).filter(([code, d]) => code !== candidate.code);
    if (!targets.length) continue;
    // choose based on difficulty
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
  // ensure input enabled and focused
  if (countryInput) {
    countryInput.disabled = false;
    countryInput.removeAttribute('disabled');
    countryInput.style.pointerEvents = 'auto';
    countryInput.value = '';
    countryInput.focus();
  }
  if (submitButton) { submitButton.disabled = false; submitButton.removeAttribute('disabled'); submitButton.style.pointerEvents = 'auto'; }

  // center initial view on starting country and set camera to fit the planet
  if (game.start && game.start.feature) {
    const c = computeFeatureCentroid(game.start.feature);
    const lonRad = (c.lon * Math.PI) / 180;
    const latRad = (c.lat * Math.PI) / 180;

    // compute 3D unit vector for country centroid on sphere
    // compute vector using consistent lat/lon mapping and rotate it to +Z
    // center with equator horizontal
    centerLonLatWithEquator(c.lon, c.lat);
    // update zoom limits (centerLonLatWithEquator sets camera.position.z already)
    const fovRad = (camera.fov * Math.PI) / 180;
    const fitDistance = (sphereRadius / Math.sin(fovRad / 2)) * 1.02;
    zoomMinZ = fitDistance * 0.45;
    zoomMaxZ = fitDistance * 3.5;
    baseFitDistance = fitDistance;
  }

  updateLabels();
  statusLabel.textContent = '';
  renderTexture();
}

function centerLonLatWithEquator(lon, lat) {
  if (typeof lon !== 'number' || typeof lat !== 'number') return;
  const v = latLonToVector(lon, lat);
  const q = new THREE.Quaternion().setFromUnitVectors(v, new THREE.Vector3(0, 0, 1));

  // ensure equator is horizontal: rotate around +Z so that geographic north points up (+Y)
  const northVec = latLonToVector(0, 90);
  const northRotated = northVec.clone().applyQuaternion(q);
  const projX = northRotated.x;
  const projY = northRotated.y;
  let phi = 0;
  if (Math.hypot(projX, projY) > 1e-6) {
    phi = Math.atan2(projX, projY);
  }
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), phi); // positive rotation to align north up
  const qf = qz.multiply(q);

  // adjust camera to fit; compute target fit distance
  const fovRad = (camera.fov * Math.PI) / 180;
  const fitDistance = (sphereRadius / Math.sin(fovRad / 2)) * 1.02;
  // determine desired target camera z to avoid being too close for tiny countries
  const targetZ = Math.max(camera.position.z || fitDistance, fitDistance * 0.7);

  // animate view to new orientation and targetZ
  startViewAnimation(qf, targetZ, 650);
}

function centerOnCountry(country) {
  if (!country || !country.feature) return;
  const c = computeFeatureCentroid(country.feature);
  centerLonLatWithEquator(c.lon, c.lat);
}

// Center a country while preserving the current camera distance and the globe's "tilt" (rotation around view Z)
function centerOnCountryKeepView(country) {
  if (!country || !country.feature || !globe) return;
  const c = computeFeatureCentroid(country.feature);
  const v = latLonToVector(c.lon, c.lat);
  // quaternion that brings v to +Z
  const qAlign = new THREE.Quaternion().setFromUnitVectors(v, new THREE.Vector3(0,0,1));

  // compute north vector after qAlign
  const northVec = latLonToVector(0,90);
  const northAfter = northVec.clone().applyQuaternion(qAlign);
  const angleAfter = Math.atan2(northAfter.x, northAfter.y);

  // compute current north angle under existing globe quaternion
  const northCurrent = northVec.clone().applyQuaternion(globe.quaternion);
  const currentAngle = Math.atan2(northCurrent.x, northCurrent.y);

  const delta = currentAngle - angleAfter;
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), delta);
  const qFinal = qz.multiply(qAlign);

  // animate to the final quaternion, keeping camera z the same (preserve current distance)
  startViewAnimation(qFinal, camera.position.z, 600);
}

// vivid colors
const COLOR_CURRENT = 'rgba(0,200,83,0.98)'; // vivid green for path/current
const COLOR_TARGET = 'rgba(220,20,60,0.98)'; // vivid red for target

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
  // vertical sidebar timeline
  const sidebar = document.getElementById('timelineSidebar');
  if (sidebar) {
    sidebar.innerHTML = '';
    (game.path || []).forEach((code, idx) => {
      const c = iso3Map.get(code);
      const item = document.createElement('div');
      item.className = 'timeline-item';
      const dot = document.createElement('div');
      dot.className = 'dot';
      // special color for start/target
      if (idx === 0) dot.style.background = COLOR_CURRENT;
      else if (code === game.target.code) dot.style.background = COLOR_TARGET;
      else dot.style.background = 'rgba(255,255,255,0.08)';
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = c ? c.name : code;
      item.appendChild(dot);
      item.appendChild(label);
      // click on timeline item centers country (avoid accidental re-centering on hover)
      item.addEventListener('click', () => {
        if (c && c.feature) centerOnCountry(c);
      });
      sidebar.appendChild(item);
    });
  }
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

  // allow backtracking to the immediate previous country
  const path = game.path || [];
  const prevCode = path.length >= 2 ? path[path.length - 2] : null;
  if (game.visited.has(next.code) && next.code !== prevCode) {
    statusLabel.textContent = 'Hai già attraversato questo stato.';
    return;
  }

  if (next.code === prevCode) {
    // backtrack: remove last from path and visited
    const removed = path.pop();
    game.visited.delete(removed);
    game.current = iso3Map.get(prevCode);
  } else {
    // normal forward move
    game.current = next;
    game.visited.add(next.code);
    game.path.push(next.code);
  }

  updateLabels();
  renderTexture();
  countryInput.value = '';

  if (game.current.code === game.target.code) {
    statusLabel.textContent = 'Obiettivo raggiunto!';
    openGameOverlay('victory');
  } else {
    statusLabel.textContent = '';
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
  } else {
    // 'setup': avvio di una nuova partita dal pulsante "+"
    if (victoryBadge) victoryBadge.textContent = '🌍';
    if (victoryTitle) victoryTitle.textContent = 'Nuova partita';
    if (victoryMessage) victoryMessage.textContent = 'Scegli difficoltà e continente, poi inizia la sfida.';
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

function findCountryByName(value) {
  const raw = (value || '').trim();
  const key = normalizeName(raw);
  if (!key) return null;

  // exact normalized match
  if (nameMap.has(key)) return nameMap.get(key);

  // try word-by-word match (prefer exact word matches)
  const parts = key.split(' ');
  for (const [name, country] of nameMap) {
    for (const p of parts) {
      if (name === p) return country;
    }
  }

  // try contains but prefer longer matches
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

function animate() {
  requestAnimationFrame(animate);

  // update view animation if active
  if (viewAnim) {
    const now = performance.now();
    const t = Math.min(1, (now - viewAnim.startTime) / viewAnim.duration);
    const eased = easeInOutCubic(t);
    // slerp quaternion (use instance slerp for compatibility)
    globe.quaternion.copy(viewAnim.startQ).slerp(viewAnim.endQ, eased);
    // lerp camera z
    camera.position.z = viewAnim.startZ + (viewAnim.endZ - viewAnim.startZ) * eased;
    if (t >= 1) {
      // finish
      globe.quaternion.copy(viewAnim.endQ);
      camera.position.z = viewAnim.endZ;
      viewAnim = null;
    }
  }

  renderer.render(scene, camera);
}

function startViewAnimation(endQ, endZ, duration = 600) {
  if (!globe || !camera) {
    // fallback: immediate
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

function vectorToLatLon(v) {
  // inverse of latLonToVector
  // v is unit vector in scene coordinates; derive lon/lat in degrees used by features
  // Using inverse of our latLonToVector mapping:
  const x = v.x, y = v.y, z = v.z;
  const phi = Math.acos(y); // polar
  const theta = Math.atan2(z, -x); // azimuth
  const lat = 90 - (phi * 180 / Math.PI);
  let lon = (theta * 180 / Math.PI) - 180;
  // normalize lon
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lon, lat };
}

function pointInFeatureLatLon(lon, lat, feature) {
  // point-in-polygon on equirectangular lon/lat; handle multipolygons
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
  // rings: array of rings (outer + holes). return true if inside outer and not in hole
  if (!rings || rings.length === 0) return false;
  const point = [lon, lat];
  const outer = rings[0];
  if (!ringContains(outer, point)) return false;
  // holes: if point in any hole -> false
  for (let i = 1; i < rings.length; i++) {
    if (ringContains(rings[i], point)) return false;
  }
  return true;
}

function ringContains(ring, point) {
  // ray-casting algorithm; handle antimeridian by shifting ring longitudes
  const px = point[0];
  const py = point[1];
  // compute average lon of ring to choose shift that keeps longitudes near point
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
