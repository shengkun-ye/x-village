/**
 * Audience Craft — pure logic: seeded RNG, audience tiers/analysis, and the
 * procedural voxel village generator. No DOM or three.js dependencies, so it
 * runs (and is testable) in plain Node.
 */

// ---------------------------------------------------------------------------
// Seeded RNG (xmur3 hash → mulberry32)
// ---------------------------------------------------------------------------
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rngFor = (seedStr) => mulberry32(xmur3(seedStr)());

// ---------------------------------------------------------------------------
// Audience tiers → village districts
// ---------------------------------------------------------------------------
export const TIERS = [
  { id: 'mega',  label: 'Mega (100K+)', min: 100000, color: 0xa78bfa, building: 'citadel' },
  { id: 'macro', label: 'Macro (10K+)', min: 10000,  color: 0xf87171, building: 'tower' },
  { id: 'mid',   label: 'Mid (1K+)',    min: 1000,   color: 0x60a5fa, building: 'house' },
  { id: 'micro', label: 'Micro (100+)', min: 100,    color: 0x4ade80, building: 'cottage' },
  { id: 'nano',  label: 'Nano (<100)',  min: 0,      color: 0xfbbf24, building: 'hut' },
];
export const tierOf = (followers) => TIERS.find((t) => followers >= t.min);

export const CURRENT_YEAR = new Date().getFullYear();
export const isActive = (f) => f.posts / Math.max(1, CURRENT_YEAR - f.createdYear + 1) >= 60;

// Wall palettes, young → old accounts (fresh plaster → weathered stone)
const WALL_PALETTES = [
  [0xf5e9d6, 0xefe0c8, 0xe8d7bd], // 2024+
  [0xd9cdb4, 0xcfc2a6, 0xc8b998], // 2021–2023
  [0xb8ab93, 0xaa9d85, 0x9c8f78], // 2016–2020
  [0x8d8474, 0x7e7668, 0x6f685c], // ≤2015 weathered stone
];
function wallPalette(year, rng) {
  const idx = year >= 2024 ? 0 : year >= 2021 ? 1 : year >= 2016 ? 2 : 3;
  const pal = WALL_PALETTES[idx];
  return pal[Math.floor(rng() * pal.length)];
}

export const fmt = (n) => {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
};

export const parseYear = (createdAt) => {
  const y = Number(String(createdAt || '').trim().split(' ').pop());
  return Number.isFinite(y) && y > 2000 ? y : CURRENT_YEAR;
};

export function normalizeFollower(raw) {
  return {
    screen_name: raw.screen_name,
    name: raw.name || raw.screen_name,
    followers: raw.followers_count || 0,
    following: raw.friends_count || 0,
    posts: raw.statuses_count || 0,
    blueVerified: Boolean(raw.blue_verified),
    location: (raw.location || '').trim(),
    createdYear: parseYear(raw.created_at),
    bio: raw.description || '',
  };
}

// ---------------------------------------------------------------------------
// Audience analysis (drives the stats panel)
// ---------------------------------------------------------------------------
export function analyze(profile, followers) {
  const tiers = TIERS.map((t) => ({ ...t, count: 0 }));
  let verified = 0, lit = 0, reach = 0;
  const locations = new Map();
  const vintage = [
    { label: '2024+ newcomers', min: 2024, count: 0 },
    { label: '2021–2023', min: 2021, count: 0 },
    { label: '2016–2020', min: 2016, count: 0 },
    { label: '2015 & earlier', min: 0, count: 0 },
  ];
  for (const f of followers) {
    tiers.find((t) => f.followers >= t.min).count++;
    if (f.blueVerified) verified++;
    if (isActive(f)) lit++;
    reach += f.followers;
    if (f.location) {
      const key = f.location.split(/[,|]/)[0].trim();
      if (key) locations.set(key, (locations.get(key) || 0) + 1);
    }
    vintage.find((v) => f.createdYear >= v.min).count++;
  }
  const topLocations = [...locations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { n: followers.length, tiers, verified, lit, reach, topLocations, vintage };
}

// ---------------------------------------------------------------------------
// Voxel village generation
// ---------------------------------------------------------------------------
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function generateVillage(profile, followers) {
  const rng = rngFor((profile.screen_name || 'village').toLowerCase());
  const voxels = [];    // { x, y, z, c, owner }
  const glows = [];     // emissive voxels (windows, beacons, lanterns)
  const buildings = []; // owner index → { resident, tier, bounds }
  const occupied = new Set();
  const cellKey = (x, z) => `${x},${z}`;

  const reserve = (cx, cz, half) => {
    for (let x = cx - half; x <= cx + half; x++)
      for (let z = cz - half; z <= cz + half; z++) occupied.add(cellKey(x, z));
  };
  const isFree = (cx, cz, half) => {
    for (let x = cx - half; x <= cx + half; x++)
      for (let z = cz - half; z <= cz + half; z++)
        if (occupied.has(cellKey(x, z))) return false;
    return true;
  };

  let maxR = 14;
  function trackBounds(owner, x, y, z) {
    if (owner < 0) return;
    const b = buildings[owner].bounds;
    b.min.x = Math.min(b.min.x, x); b.max.x = Math.max(b.max.x, x);
    b.min.y = Math.min(b.min.y, y); b.max.y = Math.max(b.max.y, y);
    b.min.z = Math.min(b.min.z, z); b.max.z = Math.max(b.max.z, z);
  }
  const push = (x, y, z, c, owner) => { voxels.push({ x, y, z, c, owner }); trackBounds(owner, x, y, z); };
  const pushGlow = (x, y, z, c, owner) => { glows.push({ x, y, z, c, owner }); trackBounds(owner, x, y, z); };
  const newBuilding = (resident, tier) => {
    buildings.push({
      resident, tier,
      bounds: { min: { x: 1e9, y: 1e9, z: 1e9 }, max: { x: -1e9, y: -1e9, z: -1e9 } },
    });
    return buildings.length - 1;
  };

  // --- shared construction pieces -----------------------------------------
  function shellStories(owner, cx, cz, half, stories, storyH, wall, win, winLit) {
    const h = stories * storyH;
    for (let y = 0; y < h; y++) {
      for (let x = -half; x <= half; x++) {
        for (let z = -half; z <= half; z++) {
          const edge = Math.abs(x) === half || Math.abs(z) === half;
          if (!edge && y > 0) continue; // hollow interior, solid floor
          let c = wall;
          const midStory = y % storyH === Math.floor(storyH / 2);
          const isCorner = Math.abs(x) === half && Math.abs(z) === half;
          if (edge && midStory && !isCorner && (x + z + y) % 2 === 0) {
            if (winLit) { pushGlow(cx + x, y, cz + z, win, owner); continue; }
            c = 0x2c3444; // dark, unlit window
          }
          push(cx + x, y, cz + z, c, owner);
        }
      }
    }
    return h;
  }

  function gabledRoof(owner, cx, cz, half, baseY, color) {
    for (let i = 0; i <= half; i++) {
      for (let x = -(half - i); x <= half - i; x++) {
        for (let z = -(half - i); z <= half - i; z++) {
          const edge = Math.abs(x) === half - i || Math.abs(z) === half - i;
          if (edge || i === half) push(cx + x, baseY + i, cz + z, color, owner);
        }
      }
    }
  }

  function battlements(owner, cx, cz, half, baseY, color) {
    for (let x = -half; x <= half; x++) {
      for (let z = -half; z <= half; z++) {
        const edge = Math.abs(x) === half || Math.abs(z) === half;
        push(cx + x, baseY, cz + z, color, owner);
        if (edge && (x + z) % 2 === 0) push(cx + x, baseY + 1, cz + z, color, owner);
      }
    }
  }

  function beacon(owner, cx, cz, topY) {
    push(cx, topY, cz, 0x8a6d1d, owner);
    push(cx, topY + 1, cz, 0x8a6d1d, owner);
    pushGlow(cx, topY + 2, cz, 0xffd34d, owner); // verified gold beacon
  }

  function door(owner, cx, cz, half, facing) {
    const [dx, dz] = facing;
    push(cx + dx * half, 0, cz + dz * half, 0x5a3d23, owner);
    push(cx + dx * half, 1, cz + dz * half, 0x5a3d23, owner);
  }

  // --- building styles per tier -------------------------------------------
  function construct(owner, f, tier, cx, cz, bRng) {
    const wall = wallPalette(f.createdYear, bRng);
    const roof = tier.color;
    const lit = isActive(f);
    const win = 0xffe9a3;
    const facing = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(bRng() * 4)];

    if (tier.building === 'citadel') {
      const half = 3, storyH = 3;
      const stories = 3 + Math.floor(bRng() * 2);
      const h = shellStories(owner, cx, cz, half, stories, storyH, wall, win, lit);
      battlements(owner, cx, cz, half, h, roof);
      for (const [tx, tz] of [[-half, -half], [-half, half], [half, -half], [half, half]]) {
        for (let y = h; y < h + 3; y++) push(cx + tx, y, cz + tz, wall, owner);
        push(cx + tx, h + 3, cz + tz, roof, owner);
      }
      door(owner, cx, cz, half, facing);
      if (f.blueVerified) beacon(owner, cx, cz, h + 1);
    } else if (tier.building === 'tower') {
      const half = 2, storyH = 3;
      const stories = 3 + Math.floor(bRng() * 2);
      const h = shellStories(owner, cx, cz, half, stories, storyH, wall, win, lit);
      gabledRoof(owner, cx, cz, half + 1, h, roof);
      door(owner, cx, cz, half, facing);
      if (f.blueVerified) beacon(owner, cx, cz, h + half + 2);
    } else if (tier.building === 'house') {
      const half = 2, storyH = 3;
      const stories = 1 + Math.floor(bRng() * 2);
      const h = shellStories(owner, cx, cz, half, stories, storyH, wall, win, lit);
      gabledRoof(owner, cx, cz, half, h, roof);
      door(owner, cx, cz, half, facing);
      if (f.blueVerified) beacon(owner, cx, cz, h + half + 1);
    } else if (tier.building === 'cottage') {
      const half = 1, storyH = 3;
      const h = shellStories(owner, cx, cz, half, 1, storyH, wall, win, lit);
      gabledRoof(owner, cx, cz, half + 1, h, roof);
      door(owner, cx, cz, half, facing);
      if (f.blueVerified) beacon(owner, cx, cz, h + half + 2);
    } else { // hut
      const half = 1;
      for (let x = -half; x <= half; x++)
        for (let z = -half; z <= half; z++) push(cx + x, 0, cz + z, wall, owner);
      gabledRoof(owner, cx, cz, half + 1, 1, roof);
      if (lit) pushGlow(cx, 0, cz + half + 1, 0xffc14d, owner); // lantern by the door
      if (f.blueVerified) beacon(owner, cx, cz, half + 3);
    }
  }

  // --- central keep: the analyzed account ----------------------------------
  {
    const owner = newBuilding(
      { ...profile, isLandmark: true },
      { id: 'you', label: 'The Keep', color: 0xffd34d, building: 'keep' }
    );
    const half = 4, storyH = 3;
    const stories = Math.min(7, Math.max(3, Math.round(Math.log10((profile.followers || 0) + 1) * 1.1)));
    const h = shellStories(owner, 0, 0, half, stories, storyH, 0xf0e6d2, 0xffe9a3, true);
    battlements(owner, 0, 0, half, h, 0xffd34d);
    for (let y = h; y < h + 4; y++) push(0, y, 0, 0xe3d5b8, owner);
    pushGlow(0, h + 4, 0, 0xffd34d, owner);
    door(owner, 0, 0, half, [0, 1]);
    reserve(0, 0, half + 3);
  }

  // --- follower buildings, influencers closest to the plaza ----------------
  const sorted = [...followers].sort((a, b) => b.followers - a.followers);
  const angle0 = rng() * Math.PI * 2;
  let t = 0;
  for (const f of sorted) {
    const tier = tierOf(f.followers);
    const half = tier.building === 'citadel' ? 3
      : tier.building === 'tower' || tier.building === 'house' ? 2 : 1;
    const margin = half + 3;
    let spot = null;
    while (!spot) {
      t += 1;
      const r = 12 + 1.55 * Math.sqrt(t * 16);
      const a = t * GOLDEN + angle0 + (rng() - 0.5) * 0.25;
      const cx = Math.round(Math.cos(a) * r);
      const cz = Math.round(Math.sin(a) * r);
      if (isFree(cx, cz, margin)) {
        spot = { cx, cz };
        reserve(cx, cz, margin - 1);
        maxR = Math.max(maxR, r + half + 4);
      }
    }
    const owner = newBuilding(f, tier);
    construct(owner, f, tier, spot.cx, spot.cz, rngFor(f.screen_name));
  }

  // --- trees in the gaps ----------------------------------------------------
  const treeCount = Math.min(140, Math.max(20, Math.round(followers.length * 0.7)));
  const leafGreens = [0x3e7d3a, 0x4c8f43, 0x5da050, 0x356e33];
  for (let i = 0; i < treeCount; i++) {
    const a = rng() * Math.PI * 2;
    const r = 13 + rng() * (maxR - 8);
    const cx = Math.round(Math.cos(a) * r), cz = Math.round(Math.sin(a) * r);
    if (!isFree(cx, cz, 2)) continue;
    reserve(cx, cz, 1);
    const trunkH = 1 + Math.floor(rng() * 2);
    const leaf = leafGreens[Math.floor(rng() * leafGreens.length)];
    for (let y = 0; y < trunkH; y++) push(cx, y, cz, 0x6b4a2b, -1);
    for (let x = -1; x <= 1; x++)
      for (let z = -1; z <= 1; z++)
        for (let y = 0; y <= 1; y++)
          if (Math.abs(x) + Math.abs(z) + y < 3) push(cx + x, trunkH + y, cz + z, leaf, -1);
    push(cx, trunkH + 2, cz, leaf, -1);
  }

  return { voxels, glows, buildings, maxR };
}
