# ⛏ Audience Craft

Drop in any X (Twitter) handle and watch your audience distribution get built as a
**procedurally generated voxel village**. Every follower becomes a building; the
account you analyze becomes the keep at the center of town. Audience data is read
from X via [monid.ai](https://monid.ai).

## Quick start

**Demo mode (zero setup):**

```bash
node server.js
# open http://localhost:8787
```

A bundled, real snapshot of @AnthropicAI's audience loads immediately so you can
explore the village without any API key.

**Live mode (craft a village for any handle):**

```bash
MONID_API_KEY=mk_your_key node server.js
# open http://localhost:8787, type a handle, hit "Craft village"
```

The key stays on the server; the browser talks to a local `/api/run` proxy.
Get a key at [monid.ai](https://monid.ai). Each fetch costs ~$0.0015 per call
(1 profile call + 1 call per follower page of ~70 followers).

You can also host `index.html` + the JS files on any static host — the app then
asks for a monid API key in the top bar and calls `api.monid.ai` directly from
the browser (the key is kept in `localStorage`).

## How to read the village

| Village feature | Audience meaning |
|---|---|
| Central keep | The account you analyzed (height scales with its follower count) |
| Distance from the plaza | Influence — bigger accounts get prime real estate |
| Building style + roof color | Follower tier: 🟣 citadel (100K+), 🔴 tower (10K+), 🔵 house (1K+), 🟢 cottage (100+), 🟡 hut (<100) |
| Gold rooftop beacon | Verified (blue check) |
| Lit windows / door lantern | Active poster (≥60 posts/year) |
| Weathered walls | Account age — veterans live in old stone, newcomers in fresh plaster |

The same handle always generates the same village (layout is seeded by the
handle), so your village is *yours*.

**Interactions:** drag to orbit, scroll to zoom, hover a building to meet its
resident, click to open their X profile, 🌙 toggles night mode (lit windows shine).

The side panel shows the underlying distribution: influence tiers, combined
reach, verified %, account vintage, and top follower locations.

## How it works

- `index.html` + `app.js` — the interactive artifact (Three.js, instanced voxel
  rendering, ~30K voxels at 60fps)
- `village.js` — pure logic: seeded RNG, audience analysis, procedural village
  generator (no DOM/three.js deps, runs in plain Node for testing)
- `server.js` — zero-dependency Node server: serves the app and proxies
  `POST /api/run` to monid.ai's REST API (`POST /v1/run`, poll `GET /v1/runs/:id`)
- `demo-data.js` — bundled real audience snapshot for instant demo mode

Data endpoints used (via monid.ai → TikHub):

- `/api/v1/twitter/web/fetch_user_profile` — profile of the analyzed handle
- `/api/v1/twitter/web/fetch_user_followers` — paginated follower list with
  per-follower counts, verification, location, bio, and account age
