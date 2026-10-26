// Builds the Daily Roll schedule: src/data/daily-schedule.json, a fixed list of category ids per date.
//
//   npm run schedule            # keep every day up to today, (re)generate the next 365
//   npm run schedule -- 2027-03-01   # pretend "today" is that date (keeps days up to it)
//
// Rules for generated days:
//   * 7 prompts a day, at most 3 from the same pack (football, geography, …), in random order.
//   * Every category is used once before any category repeats ("fewest uses first"), and a category
//     never comes back within MIN_GAP days — so a question doesn't repeat until the whole pool has
//     had its turn (with ~100 categories that's about two weeks).
//   * Days up to and including today are NEVER changed: the archive and everyone's saved results keep
//     pointing at the same prompts. Re-run this after adding categories to work them into future days.

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CAT_DIR = join(ROOT, 'categories');
const OUT = join(ROOT, 'src', 'data', 'daily-schedule.json');
const PER_DAY = 7;
const MAX_PER_PACK = 3;
const MIN_GAP = 10;
const HORIZON = 365;

interface Schedule {
  launch: string;
  days: Record<string, string[]>;
}

// ---------- dates (local calendar days, like the game) ----------

const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (k: string, n: number) => {
  const d = parse(k);
  return key(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};

// ---------- deterministic randomness ----------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- categories ----------

const pack = new Map<string, string>(); // category id -> pack id
for (const dir of readdirSync(CAT_DIR, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const packFile = join(CAT_DIR, dir.name, '_pack.json');
  const meta = existsSync(packFile) ? JSON.parse(readFileSync(packFile, 'utf8')) : {};
  if (meta.daily === false) continue;
  for (const f of readdirSync(join(CAT_DIR, dir.name))) {
    if (!f.endsWith('.json') || f === '_pack.json') continue;
    const cat = JSON.parse(readFileSync(join(CAT_DIR, dir.name, f), 'utf8'));
    pack.set(cat.id, dir.name);
  }
}
const ids = [...pack.keys()].sort();

// ---------- build ----------

const today = process.argv[2] ?? key(new Date());
const existing: Schedule = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { launch: '2026-10-25', days: {} };
const days: Record<string, string[]> = {};
const uses = new Map<string, number>(ids.map((id) => [id, 0]));
const lastDay = new Map<string, number>();

// Keep history (launch .. today) exactly as it is.
let dayIdx = 0;
let date = existing.launch;
while (date <= today && existing.days[date]) {
  days[date] = existing.days[date];
  for (const id of days[date]) {
    uses.set(id, (uses.get(id) ?? 0) + 1);
    lastDay.set(id, dayIdx);
  }
  date = addDays(date, 1);
  dayIdx++;
}
const kept = dayIdx;

while (dayIdx < kept + HORIZON) {
  const rand = mulberry32(hashString(`daily:${date}`));
  const order = ids.map((id) => ({ id, r: rand() }));
  // Fewest uses first (so the whole pool is used before repeats), random within a tier.
  order.sort((a, b) => uses.get(a.id)! - uses.get(b.id)! || a.r - b.r);
  const picked: string[] = [];
  const perPack = new Map<string, number>();
  const take = (gap: number) => {
    for (const { id } of order) {
      if (picked.length >= PER_DAY) return;
      if (picked.includes(id)) continue;
      const p = pack.get(id)!;
      if ((perPack.get(p) ?? 0) >= MAX_PER_PACK) continue;
      const last = lastDay.get(id);
      if (last !== undefined && dayIdx - last < gap) continue;
      picked.push(id);
      perPack.set(p, (perPack.get(p) ?? 0) + 1);
    }
  };
  take(MIN_GAP);
  if (picked.length < PER_DAY) take(1); // tiny pools only: relax the gap rather than run short
  days[date] = picked;
  for (const id of picked) {
    uses.set(id, uses.get(id)! + 1);
    lastDay.set(id, dayIdx);
  }
  date = addDays(date, 1);
  dayIdx++;
}

mkdirSync(join(ROOT, 'src', 'data'), { recursive: true });
writeFileSync(OUT, JSON.stringify({ launch: existing.launch, days }, null, 0) + '\n');
console.log(`kept ${kept} past day(s) up to ${today}, generated ${dayIdx - kept} → ${Object.keys(days).length} days (${ids.length} categories)`);
