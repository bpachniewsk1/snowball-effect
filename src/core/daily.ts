import { hashString, mulberry32, shuffle } from './rng';
import type { Category, Pack } from './types';

export const PROMPTS_PER_DAY = 7;
/** Roll #1. */
export const LAUNCH_DATE = '2026-10-25';

/** Local calendar date as YYYY-MM-DD. */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function keyToUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function dayNumber(key: string): number {
  return Math.round((keyToUtc(key) - keyToUtc(LAUNCH_DATE)) / 86_400_000) + 1;
}

/**
 * One "cycle" uses every daily category once, interleaving packs so a single
 * day mixes topics. Days walk through cycles back to back, so a category
 * doesn't come back until the rest have had a turn.
 */
function buildCycle(packs: Pack[], cycle: number): Category[] {
  const rand = mulberry32(hashString(`cycle:${cycle}`));
  const queues = shuffle(packs, rand).map((p) => shuffle(p.categories, rand));
  const out: Category[] = [];
  while (queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
    }
  }
  return out;
}

export function pickDailyCategories(packs: Pack[], key: string, count = PROMPTS_PER_DAY): Category[] {
  const daily = packs.filter((p) => p.daily && p.categories.length);
  const total = daily.reduce((n, p) => n + p.categories.length, 0);
  if (total === 0) return [];
  const want = Math.min(count, total);

  const dayIndex = Math.max(0, dayNumber(key) - 1);
  const pos = dayIndex * want;
  let cycle = Math.floor(pos / total);
  let offset = pos % total;
  let order = buildCycle(daily, cycle);

  const picked: Category[] = [];
  const seen = new Set<string>();
  // A day that straddles two cycles could hit the same category twice — skip repeats.
  for (let guard = 0; picked.length < want && guard < total * 3; guard++) {
    if (offset >= order.length) {
      cycle++;
      offset = 0;
      order = buildCycle(daily, cycle);
    }
    const cat = order[offset++];
    if (!seen.has(cat.id)) {
      seen.add(cat.id);
      picked.push(cat);
    }
  }
  return picked;
}
