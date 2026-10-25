// ~1000 fun facts for the penguin mascot, shown in a shuffled order that doesn't repeat until all are seen.
import { mulberry32, shuffle } from '../core/rng';

const modules = import.meta.glob('/src/data/facts/*.json', { eager: true, import: 'default' }) as Record<string, string[]>;
export const FACTS: string[] = Object.values(modules).flat();

const KEY = 'snowball:v1:facts';

interface FactState {
  seed: number;
  next: number;
}

function load(): FactState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as FactState | null;
    if (s && typeof s.seed === 'number' && typeof s.next === 'number') return s;
  } catch {
    /* fall through */
  }
  return { seed: (Math.random() * 2 ** 31) >>> 0, next: 0 };
}

/** Returns the next unseen fact; reshuffles once every fact has been shown. */
export function nextFact(): string {
  if (!FACTS.length) return '';
  let s = load();
  if (s.next >= FACTS.length) s = { seed: (Math.random() * 2 ** 31) >>> 0, next: 0 };
  const order = shuffle(FACTS.map((_, i) => i), mulberry32(s.seed));
  const fact = FACTS[order[s.next]];
  try {
    localStorage.setItem(KEY, JSON.stringify({ seed: s.seed, next: s.next + 1 }));
  } catch {
    /* ignore */
  }
  return fact;
}
