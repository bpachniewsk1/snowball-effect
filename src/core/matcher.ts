import { editDistance, normalize, typoBudget } from './normalize';
import type { Answer, Category } from './types';

export type MatchResult =
  | { kind: 'match'; answer: Answer; typo: boolean }
  | { kind: 'miss'; input: string }
  | { kind: 'empty' };

interface Index {
  keys: Map<string, Answer>;
}

const indexCache = new WeakMap<Category, Index>();

function lastWord(name: string): string | null {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

/** Builds the lookup table: every display name + alias, plus surnames when the category allows it. */
export function buildIndex(cat: Category): Index {
  const cached = indexCache.get(cat);
  if (cached) return cached;

  const keys = new Map<string, Answer>();
  for (const a of cat.answers) {
    for (const name of [a.display, ...a.aliases]) {
      const k = normalize(name, cat.ignoreWords);
      if (k && !keys.has(k)) keys.set(k, a);
    }
  }

  if (cat.matchSurname) {
    // Surnames only count when exactly one answer owns them ("Bernoulli" yes, "Kaczyński" only if one).
    const owners = new Map<string, Set<Answer>>();
    for (const a of cat.answers) {
      for (const name of [a.display, ...a.aliases]) {
        const s = lastWord(name);
        if (!s) continue;
        const k = normalize(s, cat.ignoreWords);
        if (!k || keys.has(k)) continue;
        if (!owners.has(k)) owners.set(k, new Set());
        owners.get(k)!.add(a);
      }
    }
    for (const [k, set] of owners) if (set.size === 1) keys.set(k, [...set][0]);
  }

  const index = { keys };
  indexCache.set(cat, index);
  return index;
}

export function matchAnswer(cat: Category, raw: string): MatchResult {
  const input = normalize(raw, cat.ignoreWords);
  if (!input) return { kind: 'empty' };

  const { keys } = buildIndex(cat);
  const exact = keys.get(input);
  if (exact) return { kind: 'match', answer: exact, typo: false };

  // "404 not found" / "97 because it's big" -> try the leading number on its own.
  const lead = input.match(/^(\d+)\D/);
  if (lead && keys.has(lead[1])) return { kind: 'match', answer: keys.get(lead[1])!, typo: false };

  if (cat.exactOnly || /^\d+$/.test(input)) return { kind: 'miss', input: raw };

  const budget = typoBudget(input.length);
  if (budget === 0) return { kind: 'miss', input: raw };

  // Best fuzzy hit must be strictly closer than any hit for a *different* answer.
  let best: Answer | null = null;
  let bestD = Infinity;
  let runnerUpD = Infinity;
  for (const [k, a] of keys) {
    // Don't fuzz against very short keys ("Io" shouldn't match "Ion").
    if (typoBudget(k.length) === 0) continue;
    const d = editDistance(input, k, budget);
    if (d > budget) continue;
    if (d < bestD) {
      if (best && best !== a) runnerUpD = bestD;
      best = a;
      bestD = d;
    } else if (a !== best && d < runnerUpD) {
      runnerUpD = d;
    }
  }
  if (best && bestD < runnerUpD) return { kind: 'match', answer: best, typo: true };
  return { kind: 'miss', input: raw };
}

/** How similar a guess has to be (0..1) before we offer "Did you mean …?". */
export const SUGGEST_THRESHOLD = 0.75;

/**
 * A near miss: the answer the guess most likely meant, if it is clearly the closest one.
 * Similarity is 1 − edits / longer length; a long guess that is the start or end of an answer
 * ("szczes" → "Szczęsny") also counts. Only offered when one answer clearly wins.
 */
export function suggestAnswer(cat: Category, raw: string, threshold = SUGGEST_THRESHOLD): Answer | null {
  const input = normalize(raw, cat.ignoreWords);
  if (input.length < 4 || /^\d+$/.test(input)) return null;
  const { keys } = buildIndex(cat);
  let best: Answer | null = null;
  let bestS = 0;
  let runnerUpS = 0;
  for (const [k, a] of keys) {
    if (k.length < 3) continue;
    const longer = Math.max(input.length, k.length);
    const maxEdits = Math.floor(longer * (1 - threshold));
    let sim = 0;
    if (Math.abs(input.length - k.length) <= maxEdits) {
      const d = editDistance(input, k, maxEdits);
      if (d <= maxEdits) sim = 1 - d / longer;
    }
    // Most of the name, typed from its start or end.
    if (input.length >= 5 && input.length >= k.length * 0.6 && (k.startsWith(input) || k.endsWith(input))) {
      sim = Math.max(sim, 0.8);
    }
    if (sim < threshold) continue;
    if (sim > bestS) {
      if (best && best !== a) runnerUpS = Math.max(runnerUpS, bestS);
      best = a;
      bestS = sim;
    } else if (a !== best && sim > runnerUpS) {
      runnerUpS = sim;
    }
  }
  return best && bestS > runnerUpS ? best : null;
}
