import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================
// Room & player
// ============================================================
const params = new URLSearchParams(location.search);
let room = params.get('room');
if (!room) {
  room = Math.random().toString(36).slice(2, 8);
  params.set('room', room);
  location.search = params.toString();
}
document.getElementById('roomLabel').textContent = room;

const name = localStorage.getItem('dnd_name') || prompt('Твоё имя?') || 'Игрок';
localStorage.setItem('dnd_name', name);

const socket = io();

// ============================================================
// Three.js scene
// ============================================================
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.Fog(0x0b0d12, 40, 90);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 22, 22);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI / 2.2;
controls.minDistance = 8;
controls.maxDistance = 60;
controls.enableDamping = true;

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(10, 25, 10);
dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024);
dir.shadow.camera.left = -30;
dir.shadow.camera.right = 30;
dir.shadow.camera.top = 30;
dir.shadow.camera.bottom = -30;
scene.add(dir);

// Table
const TABLE_SIZE = 40;
const textureLoader = new THREE.TextureLoader();
const tableGeo = new THREE.PlaneGeometry(TABLE_SIZE, TABLE_SIZE);
const tableMat = new THREE.MeshStandardMaterial({ color: 0x1a1d26, roughness: 0.9 });
const table = new THREE.Mesh(tableGeo, tableMat);
table.rotation.x = -Math.PI / 2;
table.receiveShadow = true;
scene.add(table);

// Border
const borderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(TABLE_SIZE, 0.2, TABLE_SIZE));
const border = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({ color: 0x3b82f6 }));
border.position.y = 0.1;
scene.add(border);

// ============================================================
// Tokens
// ============================================================
const tokens = {};
const hittables = [];

function createTokenMesh(token) {
  const g = new THREE.Group();
  g.userData.tokenId = token.id;

  const isPlayer = token.type === 'player';
  const color = isPlayer ? 0x3b82f6 : 0xef4444;

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 0.15, 24),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
  );
  base.position.y = 0.075;
  base.castShadow = true;
  base.receiveShadow = true;
  base.userData.tokenId = token.id;
  g.add(base);

  const body = new THREE.Mesh(
    isPlayer
      ? new THREE.ConeGeometry(0.42, 1.3, 6)
      : new THREE.BoxGeometry(0.7, 1.0, 0.7),
    new THREE.MeshStandardMaterial({ color: isPlayer ? 0x60a5fa : 0xf87171, roughness: 0.6 })
  );
  body.position.y = isPlayer ? 0.8 : 0.65;
  body.castShadow = true;
  body.userData.tokenId = token.id;
  g.add(body);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.85, 32),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.visible = false;
  ring.userData.isRing = true;
  g.add(ring);

  g.position.set(token.x, 0, token.z);
  return g;
}

function addToken(token) {
  if (tokens[token.id]) return;
  const g = createTokenMesh(token);
  tokens[token.id] = g;
  scene.add(g);
  g.traverse(o => { if (o.isMesh && !o.userData.isRing) hittables.push(o); });
}

function removeToken(id) {
  const g = tokens[id];
  if (!g) return;
  g.traverse(o => {
    if (o.isMesh && hittables.includes(o)) {
      hittables.splice(hittables.indexOf(o), 1);
    }
  });
  scene.remove(g);
  delete tokens[id];
  if (selected === id) selected = null;
}

// ============================================================
// Selection
// ============================================================
let selected = null;

function setSelected(id) {
  if (selected && tokens[selected]) {
    tokens[selected].traverse(o => { if (o.userData.isRing) o.visible = false; });
  }
  selected = id;
  if (id && tokens[id]) {
    tokens[id].traverse(o => { if (o.userData.isRing) o.visible = true; });
  }
}

// ============================================================
// Drag
// ============================================================
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const dragOffset = new THREE.Vector3();
let dragging = null;
let lastEmit = 0;

function updatePointer(e) {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
}

function pointerOnTable() {
  raycaster.setFromCamera(pointer, camera);
  const p = new THREE.Vector3();
  raycaster.ray.intersectPlane(groundPlane, p);
  return p;
}

function findTokenIdFromObject(obj) {
  let o = obj;
  while (o) {
    if (o.userData && o.userData.tokenId) return o.userData.tokenId;
    o = o.parent;
  }
  return null;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(hittables, false);
  if (hits.length) {
    const id = findTokenIdFromObject(hits[0].object);
    if (!id || !tokens[id]) return;
    setSelected(id);
    dragging = id;
    controls.enabled = false;
    const p = pointerOnTable();
    dragOffset.copy(p).sub(tokens[id].position).setY(0);
    renderer.domElement.style.cursor = 'grabbing';
  } else {
    setSelected(null);
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  updatePointer(e);

  if (dragging && tokens[dragging]) {
    const p = pointerOnTable();
    const g = tokens[dragging];
    const nx = p.x - dragOffset.x;
    const nz = p.z - dragOffset.z;
    const half = TABLE_SIZE / 2 - 1;
    g.position.x = Math.max(-half, Math.min(half, nx));
    g.position.z = Math.max(-half, Math.min(half, nz));

    const now = performance.now();
    if (now - lastEmit > 40) {
      lastEmit = now;
      socket.emit('move', { id: dragging, x: g.position.x, z: g.position.z });
    }
    return;
  }

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(hittables, false);
  renderer.domElement.style.cursor = hits.length ? 'grab' : 'default';
});

function endDrag() {
  if (dragging && tokens[dragging]) {
    const g = tokens[dragging];
    socket.emit('move', { id: dragging, x: g.position.x, z: g.position.z });
  }
  dragging = null;
  controls.enabled = true;
  renderer.domElement.style.cursor = 'default';
}
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointerleave', endDrag);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' && selected) {
    socket.emit('remove', selected);
    setSelected(null);
  }
});

// ============================================================
// Spawn
// ============================================================
document.querySelectorAll('[data-spawn]').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.spawn;
    const half = TABLE_SIZE / 2 - 4;
    const token = {
      id: crypto.randomUUID(),
      type,
      x: (Math.random() * 2 - 1) * half,
      z: (Math.random() * 2 - 1) * half
    };
    socket.emit('spawn', token);
  });
});

document.getElementById('delBtn').addEventListener('click', () => {
  if (selected) { socket.emit('remove', selected); setSelected(null); }
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); }
  catch { prompt('Скопируй ссылку:', location.href); }
});

// ============================================================
// Map
// ============================================================
const mapBtn = document.getElementById('mapBtn');
const mapInput = document.getElementById('mapInput');
const clearMapBtn = document.getElementById('clearMapBtn');

mapBtn.addEventListener('click', () => mapInput.click());

mapInput.addEventListener('change', async () => {
  const file = mapInput.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('map', file);
  try {
    const res = await fetch('/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('upload failed');
    const { url } = await res.json();
    socket.emit('map', url);
  } catch (err) {
    alert('Не удалось загрузить карту: ' + err.message);
  }
  mapInput.value = '';
});

clearMapBtn.addEventListener('click', () => {
  socket.emit('map', null);
});

function applyMap(url) {
  if (!url) {
    if (tableMat.map) {
      tableMat.map.dispose();
      tableMat.map = null;
    }
    tableMat.color.set(0x1a1d26);
    tableMat.needsUpdate = true;
    table.scale.set(1, 1, 1);
    return;
  }
  textureLoader.load(url, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (tableMat.map) tableMat.map.dispose();
    tableMat.map = tex;
    tableMat.color.set(0xffffff);
    tableMat.needsUpdate = true;

    // подгоняем пропорции карты в квадрат стола
    const aspect = tex.image.width / tex.image.height;
    if (aspect >= 1) {
      table.scale.set(1, 1 / aspect, 1);
    } else {
      table.scale.set(aspect, 1, 1);
    }
  });
}

// ============================================================
// Dice
// ============================================================
document.querySelectorAll('[data-dice]').forEach(btn => {
  btn.addEventListener('click', () => {
    const sides = +btn.dataset.dice;
    const result = 1 + Math.floor(Math.random() * sides);
    socket.emit('dice', { sides, result });
  });
});

function showFloatingText(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 112, 20);
  ctx.fill();
  ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 72px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 64);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(0, 4, 0);
  sprite.scale.set(5, 2.5, 1);
  scene.add(sprite);

  const start = performance.now();
  const anim = () => {
    const t = (performance.now() - start) / 1800;
    if (t > 1) { scene.remove(sprite); tex.dispose(); mat.dispose(); return; }
    sprite.position.y = 4 + t * 3;
    sprite.material.opacity = 1 - t * t;
    requestAnimationFrame(anim);
  };
  anim();
}

// ============================================================
// Chat
// ============================================================
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

function appendChat(html, cls = '') {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.innerHTML = html;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat', text);
  chatInput.value = '';
});

const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// ============================================================
// Socket events
// ============================================================
socket.on('connect', () => {
  socket.emit('join', { room, name });
});

socket.on('state', (state) => {
  for (const id in state.tokens) addToken(state.tokens[id]);
  if (state.mapUrl !== undefined) applyMap(state.mapUrl);
});

socket.on('token:add', (token) => addToken(token));

socket.on('token:move', ({ id, x, z }) => {
  const g = tokens[id];
  if (!g) return;
  g.userData.target = { x, z };
});

socket.on('token:remove', (id) => removeToken(id));

socket.on('chat', (msg) => {
  if (msg.system) appendChat(escapeHtml(msg.text), 'sys');
  else appendChat(`<b>${escapeHtml(msg.name)}:</b> ${escapeHtml(msg.text)}`);
});

socket.on('dice', ({ name: n, sides, result }) => {
  appendChat(`🎲 <b>${escapeHtml(n)}</b> кинул d${sides} → <span class="roll">${result}</span>`, '');
  showFloatingText(`d${sides}: ${result}`);
});

socket.on('map', (url) => applyMap(url));

// ============================================================
// Render loop
// ============================================================
function tick() {
  for (const id in tokens) {
    const g = tokens[id];
    if (g.userData.target) {
      g.position.x += (g.userData.target.x - g.position.x) * 0.25;
      g.position.z += (g.userData.target.z - g.position.z) * 0.25;
      if (Math.hypot(g.userData.target.x - g.position.x, g.userData.target.z - g.position.z) < 0.01) {
        g.position.x = g.userData.target.x;
        g.position.z = g.userData.target.z;
        delete g.userData.target;
      }
    }
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});