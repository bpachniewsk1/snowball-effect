# Hosting plan

## TL;DR

| Phase | What | Where | Cost |
| --- | --- | --- | --- |
| 1 | The game as it is today (Daily Roll, Custom Roll, local Lava Bucket) | **Cloudflare Pages** (static site) | $0 |
| 2 | Online Lava Bucket rooms | **Cloudflare Workers + Durable Objects** (one object per room) | $0 to start, $5/mo if it grows |
| 3 | Leaderboards + rarity from real players' answers | Cloudflare D1 (SQLite) or KV | $0 to start |
| — | Your own domain (optional) | Cloudflare Registrar (at cost) | ~$10/year |

Everything on one platform, one account, no servers to babysit.

## Phase 1 — static site (ready now)

The game is a static Vite build: `npm run build` → `dist/` (HTML + JS + avatars, ~120 KB of gzipped JS).
No backend is needed: daily prompts are picked from the date, progress lives in `localStorage`.

**Cloudflare Pages (recommended)** — free, unlimited bandwidth, global CDN, a preview URL for every branch.

1. Put the project on GitHub (private is fine):
   ```bash
   git init && git add -A && git commit -m "Snowball Effect"
   gh repo create snowball-effect --private --source=. --push
   ```
2. Cloudflare dashboard → *Workers & Pages* → *Create* → *Pages* → *Connect to Git* → pick the repo.
3. Build command `npm run build`, output directory `dist`. Deploy.
4. Live at `https://snowball-effect.pages.dev`. Every push to `main` redeploys; other branches get preview URLs.
5. (Optional) *Custom domains* → add e.g. `snowballeffect.app`.

Alternatives that work the same way: Netlify, Vercel, or GitHub Pages (`vite.config.ts` uses `base: './'`, so sub-folder hosting works).

Before going public:
- Turn off dev tools: the **CLEAR ALL DATA** button only appears with `npm run dev` or `?dev` — production builds hide it. ✔
- The fonts come from Google Fonts. For full privacy (e.g. GDPR) self-host them later.
- Re-run `WIKI_CONTACT=… npm run rank-answers` occasionally to refresh popularity; commit the updated category files.

## Phase 2 — online Lava Bucket

The rules already live in `src/game/lava.ts` as pure logic (no DOM, no timers), so the **server can run the exact same code**.

```
 browser A ─┐                       ┌───────────────────────────────┐
 browser B ─┼── WebSocket ────────► │ Worker  /room/ABCD            │
 browser C ─┘   wss://…/room/ABCD   │   └─ Durable Object "ABCD"     │
                                    │        LavaGame (shared code)  │
                                    │        owns the clock/alarms   │
                                    │        broadcasts state        │
                                    └───────────────────────────────┘
```

- **Rooms**: `POST /room` creates a Durable Object with a 4-letter code; friends join via `snowball…/lava/ABCD`.
- **Authoritative server**: clients only send `{ type: "answer", text }`; the room validates with `matchAnswer`, advances the bucket, runs the boil timer and broadcasts the new state. Nobody can cheat their own timer.
- **Latency**: allow ~300 ms grace after the deadline for answers already in flight (Krillion's Puffer Party warns about this too).
- **Hibernation**: Durable Objects' WebSocket hibernation means idle rooms cost nothing.
- **Lobby**: host picks hearts/heat/categories; players pick name + unlocked snowman (sent along with join).
- **Reconnects**: players rejoin by code + a random player token kept in `localStorage`.
- Local pass-and-play stays as an offline option.

Work items: `server/` Worker + Durable Object (wrangler), a small message protocol (`join`, `start`, `answer`, `state`, `erupt`, `winner`), a lobby screen, and a "connection lost" overlay. Roughly the same size as the current Lava Bucket UI.

## Phase 3 — data from real players

- **Leaderboards**: daily best snowballs (D1 table keyed by day + anonymous player id).
- **Real rarity** (the long-term best signal, better than Wikipedia pageviews): count which answers players actually give per category, then blend those counts into `rank-answers` the same way pageviews are blended with hand-picked tiers today.
- Store only answer text + category + day, no personal data.

## What I need from you

1. A GitHub account (to hold the code) and a free Cloudflare account.
2. A name for the URL (`snowball-effect.pages.dev` is free; a custom domain is optional).
3. Then I can set up the repo and the deploy, and start Phase 2.
