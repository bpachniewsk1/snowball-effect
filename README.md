# Snowball Effect ☃️

A Krillion-style daily trivia game in a snowman universe. Your snowman pushes a snowball across the snow; the **colder (rarer) your answers, the bigger it grows**. Undertale-flavoured UI: black boxes, chunky borders, typewriter text.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # matcher + daily picker + category checks
npm run check-categories
```

## How it plays

- **Daily Roll**: 7 prompts per day, the same for everyone (picked from the date). 25 s per prompt; the clock starts once the prompt has typed itself out.
- **Daily Roll** rolls over at local midnight; an open menu refreshes itself, and the title shows a countdown once today's roll is done.
- **Archive**: every past Daily Roll since launch, **locked until you finish today's Daily Roll**. Archive rolls don't touch your streak.
- **Custom Roll**: pick which categories are on (the page shows how many answers each category has per tier), choose 3/5/7/10 prompts, play as often as you like. Custom rolls don't touch Daily stats.
- **Wrong answers don't end the round** — they buzz and you keep guessing until you're right or time runs out. Only a timeout scores 0. Wrong guesses can be suggested for the list.
- Every correct answer grows the snowball; growth roughly doubles per tier, so rare answers make big jumps. 1 point = 1 cm, starting from 10 cm; a perfect day (7 × Absolute Zero) is a **17.60 m** snowball.
- A correct answer gets a ~0.8 s drumroll (the snowball rolls on while the badge flicks through the tiers) before its tier is revealed. Each tier has its own sound, and the colder the answer, the darker the sky gets and the more stars come out: Icefrost brings a starry dusk, Brain Freeze adds shooting stars, Absolute Zero flashes into a full night with an aurora. The sky clears again for the next prompt.
- The day passes as you play: morning → sunset → aurora night.
- Closing the tab mid-prompt counts as a timeout (no rerolls).
- **Lava Bucket** (parked for the first public release: hidden from the menu, open `/?lava` to test it) (party mode, pass-and-play on one device, 2–8 players): a boiling bucket of lava goes round. Name an answer nobody has used yet to pass it on; every pass makes it boil faster (12 s → 3 s, or pick Chill/Spicy). Holding it when it erupts costs a heart; last snowman standing wins, cold answers earn party points as tiebreak. Rules live in `src/game/lava.ts` (pure logic, ready to run on a server for online rooms — see [docs/HOSTING.md](docs/HOSTING.md)).
- Click the penguin in the corner, or your snowman in the scene. The penguin waddles while idle and drops one of **1,005 fun facts** (geography, animals, plants, food, space, the body, Earth, history, languages) every ~40 s or when clicked — never while a prompt's clock is running. Facts live in `src/data/facts/*.json`.
- Quiet music-box music plays in the background (MUSIC toggle).

| Tier | Temp | +cm | How many per category |
| --- | --- | --- | --- |
| Slush | 0 °C | 10 | the 20% most popular, max 15 (Krillion's Plankton) |
| Snowflake | −15 °C | 30 | 25% of the rest (Schooler) |
| Icefrost | −40 °C | 60 | 30% of the rest (Rare) |
| Brain Freeze | −89 °C | 120 | 45% of the rest — lots of deep cuts (Deep Cut) |
| Absolute Zero | −273.15 °C | 250 | **only 1–2**: the least-viewed answers (Krillion) |

Snowball ranks: Snowpea → Snowball → Snowboulder → Avalanche → Snowmageddon → Glacier → Iceberg → Absolute Unit (perfect day).

## How rarity is decided

Tiers come from **real-world popularity blended with judgement**: `npm run rank-answers` looks up each answer's Wikipedia article (via the MediaWiki API, 50 at a time) and sums its pageviews over the last 60 days. Curated answers are then ranked **50% by pageviews, 50% by their hand-picked tier** (pageviews alone follow the news — Kazakhstan out-trended Italy); answers that only came from Wikidata are ranked by pageviews alone. Finally the quotas above assign tiers. Polish politics uses Polish Wikipedia. Where a category has a `wikidata` query, the answer list is expanded from Wikidata first (e.g. ~1000 programming languages and mathematicians, every moon with an article).

Each category's `ranking` block controls this:

| Field | Use |
| --- | --- |
| `wiki` | `"en"` (default) or `"pl"` |
| `hints` | Disambiguation suffixes tried first, e.g. `["(cocktail)"]` |
| `title` / `titles` | Title template (`"Województwo {lower}"`) or explicit name → article map |
| `expect` | Regex the article's short description must match when falling back to the bare name (stops "Saturn" the cocktail from borrowing the planet's views) |
| `wikidata` | WHERE clause binding `?item` to pull extra answers |
| `max` | Keep at most N answers |
| `reject` | Regex: drop answers whose article description matches (`"extinct|fossil"`) |
| `blend` | Weight of the hand-picked tier vs. pageviews, 0–1 (default 0.5) |
| `manual` | No lookups (git commands, HTTP codes…): your order in the file is the popularity order |

**Where to edit answers:** if a category file has a `handpicked` block, edit *that* (it's your curated list) and re-run the script; `answers` is generated from it. Otherwise edit `answers` directly — for categories without a `ranking` block nothing is generated at all.

Curated answers the script can't find are placed by their hand-picked tier; Wikidata answers it can't confirm are dropped. Wikidata labels that look like junk (provisional names, seasons, vandalised lowercase aliases) are filtered. Results are cached in `scripts/.cache` (delete it to refresh).

Wikimedia rate-limits anonymous clients to a few requests a minute. Identify yourself and it's ~20× faster:

```bash
WIKI_CONTACT="you@example.com" npm run rank-answers
```

The address only goes into the request's User-Agent so Wikimedia can contact you if the script misbehaves.

Why not Google? Google offers no API for result counts and its "about N results" figures are rough estimates; Wikipedia pageviews are real, free and reproducible. Even better long-term: count what players actually type (needs a server).

Tier names, temps, points, colors and share emoji live in [src/core/tiers.ts](src/core/tiers.ts); ranks in [src/game/dailyRoll.ts](src/game/dailyRoll.ts). `partyPoints` is reserved for multiplayer.

## Adding categories

Categories live in `categories/<pack>/<anything>.json`. Each folder is a **pack** and gets picked up automatically.

```json
{
  "id": "european-countries",
  "prompt": "Name a European country",
  "answers": {
    "slush":        ["France", "Poland|Polska"],
    "snowflake":    ["Czechia|Czech Republic|Czechy"],
    "icefrost":     ["Andorra"],
    "brainfreeze":  ["North Macedonia|Macedonia"],
    "absolutezero": ["San Marino"]
  }
}
```

- **`"Display|alias|alias"`**: the first name is shown. Aliases also count (other spellings, abbreviations, Polish names).
- Matching ignores case, accents (including `ł`), punctuation, spaces and a leading "the". It also forgives 1–2 typos, unless the typo could mean two different answers.

Optional fields:

| Field | Use |
| --- | --- |
| `timeLimit` | Seconds per prompt (default 25) |
| `ignoreWords` | Words dropped before matching, e.g. `["git"]` so "git rebase" = "rebase" |
| `matchSurname` | For people: "Gauss" matches "Carl Friedrich Gauss" (only if no other answer shares that surname) |
| `exactOnly` | No typo tolerance (shell commands, codes). Numbers are always exact. |

Pack settings go in `categories/<pack>/_pack.json`: `{ "name": "Polish Politics", "color": "#ef6f8e", "daily": true }`. Set `"daily": false` to keep a pack out of the Daily Roll.

After editing, run `npm run check-categories`. It catches duplicate ids, the same answer listed twice, unknown tier names and lists that are too short.

Players can press **Suggest it** on a rejected answer. Suggestions are stored in their browser and can be copied as JSON from the results screen.

> Adding or removing categories changes which prompts future days get. Days already played keep their saved results.

## Avatars, unlocks & sound

- Snowman avatars live in `public/avatars/*.png` (64×64, made from the `.pixil` files: soft brush edges snapped to crisp pixels, insides filled with snow white). Add one by dropping a PNG there and listing it in [src/game/profile.ts](src/game/profile.ts) with an unlock rule. The scene assumes the snowman's feet are on row 62 and its right edge ≈ column 56.
- Only **Buttons** is unlocked at first. The rest are earned and announced with a popup:

| Snowman | How to unlock |
| --- | --- |
| Buttons | start |
| Classic | finish your first roll |
| Meh | run out of time once |
| Winky | get an Icefrost answer |
| Pointy | get a Brain Freeze answer |
| Pirate | get an Absolute Zero answer |
| Beanie | get 10 Slush answers |
| Viking | get 5 Brain Freeze answers |
| King | get 3 Absolute Zero answers |
| Shades | answer correctly within 3 seconds |
| Ninja | answer correctly with 2 seconds or less left |
| Party | finish a roll with no wrong guesses and no timeouts |
| Cap | finish 3 custom rolls |
| Scholar | finish a roll from the archive |
| Top Hat | 3-day daily streak |
| Mustache | 7-day daily streak |
| Santa | finish 10 rolls |
| Tall Boi | roll a 5 m+ snowball |
| Melty | run out of time 5 times |

Tier unlocks need **exactly** that tier: an Absolute Zero doesn't unlock Winky (Icefrost).

- Lifetime progress (answers per tier, timeouts, rolls finished, best snowball, best streak) is kept in `localStorage` (`snowball:v2:progress`).
- Sound effects are synthesized with Web Audio in [src/audio/sfx.ts](src/audio/sfx.ts), so there are no audio files: text blips, typing ticks, button clicks, snow crunch, a sound per tier that gets bigger the colder it is (Slush splat → Snowflake chime → Icefrost crack → Brain Freeze whoomp → Absolute Zero fanfare), a buzzer for wrong guesses, ticking for the last 5 seconds, and a "wheee" for spins.
- Background music is an original music-box loop generated live in [src/audio/music.ts](src/audio/music.ts) (chords, arpeggio, melody are plain arrays — easy to rewrite). SFX and MUSIC toggles are separate and remembered.

## Dev tricks

- **CLEAR ALL DATA** (top-left, red) wipes localStorage and reloads. It shows on the dev server (`npm run dev`) or with `?dev`, never in a normal production build.
- `/?dev&date=2026-11-02` plays any day. On the results screen in dev mode there's a **reset this roll** button.

## Project layout

```
categories/           pack folders with category JSON
public/avatars/       snowman avatars
src/core/             game-agnostic logic (matching, tiers, daily picker), reused by multiplayer
src/game/             Roll (daily + custom) state, profile, localStorage
src/render/           canvas scene (snowscape, snowball, critters), pixel sprites
src/audio/            synthesized sound effects
src/ui/app.ts         DOM screens: title, prompt, reveal, results
tests/                vitest
```

## Hosting

See [docs/HOSTING.md](docs/HOSTING.md): Cloudflare Pages for the static game now (free), Workers + Durable Objects for online Lava Bucket rooms next.

## Roadmap

1. ~~Daily Roll~~
2. ~~Archive~~ + unlimited practice (any day / any pack)
3. ~~Lava Bucket, local pass-and-play~~
4. Online Lava Bucket rooms (Workers + Durable Objects, 4-letter room codes)
5. Leaderboards and rarity from real players' answers
