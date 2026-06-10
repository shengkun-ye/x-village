/**
 * Audience Craft — visualize an X account's audience as a procedurally
 * generated voxel village. Data is read from X via monid.ai (TikHub
 * endpoints), either through the bundled server.js proxy or directly
 * from the browser with a monid API key.
 *
 * Village language:
 *  - every follower is one building; bigger audiences live closer to the plaza
 *  - building size/style = follower count tier (citadel → tower → house → cottage → hut)
 *  - roof color = tier district; gold rooftop beacon = verified (blue check)
 *  - lit windows = active poster; wall weathering = account age
 *  - the central keep is the account being analyzed
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEMO, demoFollowers } from './demo-data.js';
import { generateVillage, analyze, normalizeFollower, parseYear, fmt } from './village.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// ---------------------------------------------------------------------------
// Data layer: monid.ai
// ---------------------------------------------------------------------------
const MONID_DIRECT = 'https://api.monid.ai';
const PROVIDER = 'tikhub';
const EP_PROFILE = '/api/v1/twitter/web/fetch_user_profile';
const EP_FOLLOWERS = '/api/v1/twitter/web/fetch_user_followers';

const state = { proxy: { proxy: false, hasKey: false }, daylight: true, busy: false };

async function detectProxy() {
  try {
    const r = await fetch('/api/health');
    if (r.ok) return await r.json();
  } catch { /* static hosting — no proxy */ }
  return { proxy: false, hasKey: false };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function monidRun(endpoint, queryParams) {
  if (state.proxy.hasKey) {
    const r = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: PROVIDER, endpoint, input: { queryParams } }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `Proxy error (HTTP ${r.status})`);
    return j.output;
  }

  const key = document.getElementById('apikey').value.trim() || localStorage.getItem('monid_key') || '';
  if (!key) throw new Error('No monid.ai API key. Paste one in the top bar, or run server.js with MONID_API_KEY.');
  localStorage.setItem('monid_key', key);
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  let r;
  try {
    r = await fetch(`${MONID_DIRECT}/v1/run`, {
      method: 'POST', headers,
      body: JSON.stringify({ provider: PROVIDER, endpoint, input: { queryParams } }),
    });
  } catch {
    throw new Error('Could not reach api.monid.ai from the browser (CORS or network). Run "MONID_API_KEY=... node server.js" instead.');
  }
  let run = await r.json();
  if (!r.ok) throw new Error(run?.error?.message || `monid run failed (HTTP ${r.status})`);
  const deadline = Date.now() + 120000;
  while (run.status === 'RUNNING' || run.status === 'PENDING') {
    if (Date.now() > deadline) throw new Error('monid run timed out');
    await sleep(1500);
    const p = await fetch(`${MONID_DIRECT}/v1/runs/${encodeURIComponent(run.runId)}`, { headers });
    run = await p.json();
  }
  if (run.status !== 'COMPLETED') {
    throw new Error(run.providerResponse?.error?.detail?.message || `monid run ${run.status}`);
  }
  return run.output;
}

// TikHub occasionally returns transient 400s — retry with backoff.
async function monidRunRetry(endpoint, queryParams, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await monidRun(endpoint, queryParams); }
    catch (e) { err = e; await sleep(1200 * (i + 1)); }
  }
  throw err;
}

async function fetchAudience(handle, pages, onProgress) {
  onProgress(`Reading @${handle}'s profile via monid.ai…`);
  const prof = await monidRunRetry(EP_PROFILE, { screen_name: handle });
  if (!prof || !prof.profile) throw new Error(`Could not find @${handle} on X.`);
  const profile = {
    screen_name: prof.profile,
    name: prof.name || prof.profile,
    followers: prof.sub_count || 0,
    following: prof.friends || 0,
    posts: prof.statuses_count || 0,
    blueVerified: Boolean(prof.blue_verified),
    location: (prof.location || '').trim(),
    createdYear: parseYear(prof.created_at),
    bio: prof.desc || '',
    avatar: prof.avatar || '',
  };

  const followers = [];
  const seen = new Set();
  let cursor;
  for (let p = 1; p <= pages; p++) {
    onProgress(`Meeting the residents… follower page ${p}/${pages}`);
    const out = await monidRunRetry(EP_FOLLOWERS, cursor ? { screen_name: handle, cursor } : { screen_name: handle });
    for (const raw of out?.followers || []) {
      if (raw.screen_name && !seen.has(raw.screen_name)) {
        seen.add(raw.screen_name);
        followers.push(normalizeFollower(raw));
      }
    }
    cursor = out?.next_cursor;
    if (!out?.more_users || !cursor) break;
  }
  return { profile, followers };
}

// ---------------------------------------------------------------------------
// Three.js scene
// ---------------------------------------------------------------------------
const sceneEl = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
sceneEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 2000);
camera.position.set(70, 70, 70);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI / 2.05;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.6;
renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; });

const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5c7a4a, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3d6, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const ambient = new THREE.AmbientLight(0xffffff, 0.25);
scene.add(ambient);

let villageGroup = null;
let mainMesh = null;
let buildingsRef = [];
let ownerByInstance = [];

const highlight = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false })
);
highlight.visible = false;
scene.add(highlight);

// drifting clouds
const cloudGroup = new THREE.Group();
{
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  let cseed = 12345;
  const crng = () => { cseed = (cseed * 16807) % 2147483647; return cseed / 2147483647; };
  for (let i = 0; i < 9; i++) {
    const cluster = new THREE.Group();
    const blobs = 3 + Math.floor(crng() * 4);
    for (let b = 0; b < blobs; b++) {
      const w = 6 + crng() * 10;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 2.5, 4 + crng() * 6), cloudMat);
      mesh.position.set((crng() - 0.5) * 14, (crng() - 0.5) * 2, (crng() - 0.5) * 8);
      cluster.add(mesh);
    }
    cluster.position.set((crng() - 0.5) * 360, 65 + crng() * 25, (crng() - 0.5) * 360);
    cluster.userData.speed = 0.6 + crng() * 0.9;
    cloudGroup.add(cluster);
  }
}
scene.add(cloudGroup);

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });
  scene.remove(group);
}

function buildScene(village) {
  if (villageGroup) disposeGroup(villageGroup);
  villageGroup = new THREE.Group();
  buildingsRef = village.buildings;
  const { voxels, glows, maxR } = village;

  const box = new THREE.BoxGeometry(1, 1, 1);
  const color = new THREE.Color();
  const m = new THREE.Matrix4();

  mainMesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), voxels.length);
  ownerByInstance = new Array(voxels.length);
  voxels.forEach((v, i) => {
    m.setPosition(v.x, v.y + 0.5, v.z);
    mainMesh.setMatrixAt(i, m);
    mainMesh.setColorAt(i, color.setHex(v.c));
    ownerByInstance[i] = v.owner;
  });
  mainMesh.castShadow = true;
  mainMesh.receiveShadow = true;
  villageGroup.add(mainMesh);

  if (glows.length) {
    const glowMesh = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), glows.length);
    glows.forEach((v, i) => {
      m.setPosition(v.x, v.y + 0.5, v.z);
      glowMesh.setMatrixAt(i, m);
      glowMesh.setColorAt(i, color.setHex(v.c));
    });
    villageGroup.add(glowMesh);
  }

  // ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(maxR + 26, 64),
    new THREE.MeshLambertMaterial({ color: 0x6d9b4f })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  villageGroup.add(ground);
  const outerGround = new THREE.Mesh(
    new THREE.CircleGeometry(maxR + 120, 64),
    new THREE.MeshLambertMaterial({ color: 0x55803f })
  );
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.y = -0.08;
  villageGroup.add(outerGround);

  // plaza + radial paths
  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(10.5, 10.5, 0.3, 32),
    new THREE.MeshLambertMaterial({ color: 0xb9b2a0 })
  );
  plaza.position.y = 0.08;
  plaza.receiveShadow = true;
  villageGroup.add(plaza);
  const pathMat = new THREE.MeshLambertMaterial({ color: 0xa89f8a });
  for (let i = 0; i < 6; i++) {
    const len = maxR + 8;
    const path = new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 2.4), pathMat);
    const a = (i / 6) * Math.PI * 2 + 0.26;
    path.position.set(Math.cos(a) * (len / 2 + 9), 0.05, Math.sin(a) * (len / 2 + 9));
    path.rotation.y = -a;
    villageGroup.add(path);
  }

  scene.add(villageGroup);

  // frame the camera and the sun on the new village
  const d = maxR * 1.45 + 30;
  camera.position.set(d * 0.8, d * 0.62, d * 0.8);
  controls.target.set(0, 6, 0);
  controls.autoRotate = true;
  sun.position.set(maxR + 60, maxR + 90, maxR + 30);
  const s = maxR + 30;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.camera.far = 600;
  sun.shadow.camera.updateProjectionMatrix();
  applyDaylight();
}

function applyDaylight() {
  const day = state.daylight;
  scene.background = new THREE.Color(day ? 0x9ed1f2 : 0x0d1326);
  scene.fog = new THREE.Fog(day ? 0x9ed1f2 : 0x0d1326, 160, 460);
  sun.intensity = day ? 1.6 : 0.12;
  sun.color.setHex(day ? 0xfff3d6 : 0x8aa3ff);
  hemi.intensity = day ? 0.9 : 0.25;
  ambient.intensity = day ? 0.25 : 0.1;
  document.getElementById('daynight').textContent = day ? '🌙' : '☀️';
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------
// Hover / click interaction
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');
let hoveredOwner = -1;

function pickOwner(ev) {
  if (!mainMesh) return -1;
  pointer.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(mainMesh)[0];
  if (!hit || hit.instanceId === undefined) return -1;
  const owner = ownerByInstance[hit.instanceId];
  return owner === undefined ? -1 : owner;
}

renderer.domElement.addEventListener('pointermove', (ev) => {
  const owner = pickOwner(ev);
  if (owner !== hoveredOwner) {
    hoveredOwner = owner;
    if (owner >= 0) {
      const b = buildingsRef[owner];
      const { min, max } = b.bounds;
      highlight.position.set((min.x + max.x) / 2, (min.y + max.y) / 2 + 0.5, (min.z + max.z) / 2);
      highlight.scale.set(max.x - min.x + 1.8, max.y - min.y + 1.8, max.z - min.z + 1.8);
      highlight.visible = true;
      const f = b.resident;
      const tierTag = f.isLandmark
        ? '<span class="tt-tier" style="background:#ffd34d;color:#1a1405">★ THE KEEP — THIS IS YOU</span>'
        : `<span class="tt-tier" style="background:#${b.tier.color.toString(16).padStart(6, '0')};color:#10131c">${b.tier.label.toUpperCase()}</span>`;
      tooltip.innerHTML = `
        <div class="tt-name">${esc(f.name)} ${f.blueVerified ? '✔️' : ''}</div>
        <div class="tt-handle">@${esc(f.screen_name)}</div>
        <div class="tt-meta">${fmt(f.followers)} followers · ${fmt(f.posts)} posts · est. ${f.createdYear}${f.location ? ' · ' + esc(f.location) : ''}</div>
        ${f.bio ? `<div class="tt-bio">${esc(f.bio.slice(0, 140))}</div>` : ''}
        ${tierTag}`;
      tooltip.style.display = 'block';
    } else {
      highlight.visible = false;
      tooltip.style.display = 'none';
    }
    renderer.domElement.style.cursor = owner >= 0 ? 'pointer' : 'grab';
  }
  if (tooltip.style.display === 'block') {
    tooltip.style.left = Math.min(ev.clientX, innerWidth - tooltip.offsetWidth - 30) + 'px';
    tooltip.style.top = Math.min(ev.clientY, innerHeight - tooltip.offsetHeight - 30) + 'px';
  }
});

renderer.domElement.addEventListener('click', (ev) => {
  const owner = pickOwner(ev);
  if (owner >= 0) {
    window.open(`https://x.com/${encodeURIComponent(buildingsRef[owner].resident.screen_name)}`, '_blank', 'noopener');
  }
});

// ---------------------------------------------------------------------------
// Stats panel
// ---------------------------------------------------------------------------
function renderStats(profile, followers, sampleNote) {
  const a = analyze(profile, followers);
  const el = document.getElementById('stats');
  const tierBars = a.tiers.map((t) => {
    const pct = Math.round((t.count / Math.max(1, a.n)) * 100);
    const hex = '#' + t.color.toString(16).padStart(6, '0');
    return `<div class="bar-row">
      <span><span class="swatch" style="background:${hex}"></span>${t.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${hex}"></div></div>
      <span class="pct">${t.count}</span></div>`;
  }).join('');
  const vintageBars = a.vintage.map((v) => {
    const pct = Math.round((v.count / Math.max(1, a.n)) * 100);
    return `<div class="bar-row">
      <span>${v.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:#8b9bb8"></div></div>
      <span class="pct">${v.count}</span></div>`;
  }).join('');
  const locs = a.topLocations.length
    ? a.topLocations.map(([loc, c]) => `<div class="loc-row"><span>${esc(loc)}</span><span>${c}</span></div>`).join('')
    : '<div class="loc-row"><span>No locations declared</span></div>';

  el.innerHTML = `
    <h2>${esc(profile.name)} ${profile.blueVerified ? '✔️' : ''}</h2>
    <div class="handle-line">@${esc(profile.screen_name)} · ${fmt(profile.followers)} followers total · ${sampleNote}</div>
    <div class="bigstat">
      <div><b>${a.n}</b><span>residents</span></div>
      <div><b>${fmt(a.reach)}</b><span>combined reach</span></div>
      <div><b>${Math.round((a.verified / Math.max(1, a.n)) * 100)}%</b><span>verified</span></div>
      <div><b>${Math.round((a.lit / Math.max(1, a.n)) * 100)}%</b><span>windows lit</span></div>
    </div>
    <div class="section-title">Influence districts</div>${tierBars}
    <div class="section-title">Account vintage</div>${vintageBars}
    <div class="section-title">Top locations</div>${locs}
    <div class="section-title">How to read the village</div>
    <div id="legend">
      <b>Distance from the keep</b> = influence (big accounts get prime real estate) ·
      <b>building style & roof color</b> = follower tier ·
      <b>gold beacon</b> = verified ·
      <b>lit windows</b> = active poster ·
      <b>weathered walls</b> = veteran account ·
      <b>the central keep</b> = ${esc('@' + profile.screen_name)}
    </div>`;
  el.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
const overlay = document.getElementById('overlay');
const overlayMsg = document.getElementById('overlay-msg');
const errorEl = document.getElementById('error');
const generateBtn = document.getElementById('generate');

function setBusy(busy, msg) {
  state.busy = busy;
  generateBtn.disabled = busy;
  overlay.style.display = busy ? 'flex' : 'none';
  if (msg) overlayMsg.textContent = msg;
}
function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
  clearTimeout(showError._t);
  showError._t = setTimeout(() => { errorEl.style.display = 'none'; }, 9000);
}

function craft(profile, followers, sampleNote) {
  buildScene(generateVillage(profile, followers));
  renderStats(profile, followers, sampleNote);
}

function loadDemo() {
  const followers = demoFollowers();
  craft(DEMO.profile, followers, `bundled demo sample (${followers.length})`);
}

async function generate() {
  if (state.busy) return;
  const handle = document.getElementById('handle').value.trim().replace(/^@/, '');
  if (!handle) { showError('Type an X handle first — or hit Demo.'); return; }
  const pages = Number(document.getElementById('depth').value);
  setBusy(true, `Surveying the land for @${handle}…`);
  try {
    const { profile, followers } = await fetchAudience(handle, pages, (msg) => setBusy(true, msg));
    if (!followers.length) {
      craft(profile, [], 'no followers visible (protected account?)');
      showError('No followers could be read — the village is just the keep.');
    } else {
      craft(profile, followers, `sample of ${followers.length} recent followers`);
    }
    const url = new URL(location.href);
    url.searchParams.set('handle', handle);
    history.replaceState(null, '', url);
  } catch (e) {
    showError(String(e.message || e));
  } finally {
    setBusy(false);
  }
}

generateBtn.addEventListener('click', generate);
document.getElementById('handle').addEventListener('keydown', (e) => { if (e.key === 'Enter') generate(); });
document.getElementById('demo').addEventListener('click', loadDemo);
document.getElementById('daynight').addEventListener('click', () => {
  state.daylight = !state.daylight;
  applyDaylight();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  state.proxy = await detectProxy();
  if (!state.proxy.hasKey) {
    document.getElementById('keyrow').classList.remove('hidden');
    const saved = localStorage.getItem('monid_key');
    if (saved) document.getElementById('apikey').value = saved;
  }
  loadDemo();
  const urlHandle = new URLSearchParams(location.search).get('handle');
  if (urlHandle) document.getElementById('handle').value = urlHandle;

  const clock = new THREE.Clock();
  (function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    controls.update();
    for (const c of cloudGroup.children) {
      c.position.x += c.userData.speed * dt * 2;
      if (c.position.x > 220) c.position.x = -220;
    }
    renderer.render(scene, camera);
  })();
})();
