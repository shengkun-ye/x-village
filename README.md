# ⛏ Audience Craft — @shengkun_ye's voxel kingdom

An interactive artifact that turns a real X audience into a procedurally
generated voxel kingdom. **Zero dependencies, one file** — just open it:

```bash
open index.html          # or: python3 -m http.server & open http://localhost:8000
```

Everything in it is real data, pulled live on **2026-06-10** via
[monid.ai](https://monid.ai) (provider: TikHub). Total data cost: **$0.0090**.

## What you'll see

1. **The build** — the island generates block-by-block while a live ticker
   replays every API call the survey made, with its real price ($0.0015/call,
   failed calls free).
2. **The kingdom** — 1,638 followers set the island size (Barony class,
   radius 24 blocks). The central keep is @shengkun_ye; its beacon is the blue
   check, its height the follower count.
3. **Eight districts**, sized by each role's real share of the 79 people who
   engaged the last 9 posts: Founders' Keep (51%), Engineers' Forge, Design
   Commons, Growth Bazaar, Crypto Docks, the **Bot Quarter** (4 literal AI
   agents — Boardy, Agent Hansa & co. — engage this account), VC Overlook (on a
   hill, obviously) and the Athenaeum. Hover any building to meet its real
   citizen — bio, followers, district; click to open their profile. Accounts
   over 10K followers get gold "whale caps".
4. **Game stats** — Level 11 from 1,233 real engagements (XP), the title
   *Baron of the Algorithm* from the 2.25 follower∶following ratio, a ×99
   reach multiplier (162,717 views vs 1,638 followers), 157,723 court reach,
   and a 10,000-gold treasury (real monid agent-transaction milestone).
5. **10 achievements**, all earned from real patterns: surviving an account
   hack, being discovered by an investor's AI agent, four 10K+ whales in the
   replies, YC founders from four batches, 13 regions on the voxel atlas,
   1.4 posts/day for 729 days, and the kingdom's 2nd birthday on June 11.
6. **🖼 Export Kingdom Card** — renders a shareable 1200×675 PNG.

Controls: drag to pan · scroll to zoom · `N` night · `R` rebuild · `E` export
card · `L` toggle the cost log. URL flags: `?ff` skips the build animation,
`?night` starts at night.

## Data provenance

| Call (via monid.ai → TikHub) | Result | Cost |
|---|---|---|
| `discover` + `inspect` ×3 | endpoint schemas | free |
| `GET /twitter/web/fetch_user_profile` | profile of @shengkun_ye | $0.0015 |
| `GET /twitter/web/fetch_user_post_tweet` (screen_name) | 400 | $0 |
| `GET /twitter/web/fetch_user_post_tweet` (rest_id) | 18 recent posts | $0.0015 |
| `GET /twitter/web/fetch_post_comments` ×4 | 128 replies → 79 unique engagers (bios, follower counts) | $0.0060 |
| **Total** | | **$0.0090** |

Engager roles and regions were classified from bios; locations come from bio
text and affiliations, so the atlas is a best-effort map (37 of 79 pinned).
The kingdom layout is seeded — the same data always builds the same kingdom.
