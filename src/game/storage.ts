import { TEST_MODE } from '../core/testmode';
import type { TierId } from '../core/tiers';

// v2: five-tier rarity (saves from the old six-tier system don't carry over).
const PREFIX = TEST_MODE ? 'snowball:test:' : 'snowball:v2:';

export interface RoundRecord {
  categoryId: string;
  /** The accepted answer as typed, or what was in the box when time ran out. */
  input: string;
  answerKey: string | null;
  answerDisplay: string | null;
  tier: TierId | null;
  points: number;
  timedOut: boolean;
  /** Wrong guesses made before answering / running out of time. */
  misses?: string[];
}

export type RollMode = 'daily' | 'custom';

export interface RollSave {
  mode?: RollMode;
  date: string;
  /** Custom rolls store their (random) categories; daily ones are derived from the date. */
  categoryIds?: string[];
  rounds: RoundRecord[];
  /** Index of a round whose timer started but wasn't answered — counts as a timeout on reload. */
  inProgress: number | null;
  /** Wrong guesses in the current round, so a reload doesn't forget them. */
  pendingMisses?: string[];
  finished: boolean;
}

export interface Stats {
  played: number;
  streak: number;
  bestStreak: number;
  bestPoints: number;
  lastDate: string | null;
  history: Record<string, number>;
}

export interface Suggestion {
  categoryId: string;
  input: string;
  date: string;
}

export interface CustomSettings {
  /** Category ids switched off. Stored as "off" so new categories start enabled. */
  disabled: string[];
  prompts: number;
}

// Storage can be unavailable (private mode, blocked cookies) — the game still runs, it just forgets.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

const saveKey = (mode: RollMode, date: string) => (mode === 'custom' ? 'custom' : `daily:${date}`);
export const loadRoll = (mode: RollMode, date: string) => read<RollSave | null>(saveKey(mode, date), null);
export const saveRoll = (save: RollSave) => write(saveKey(save.mode ?? 'daily', save.date), save);
export const clearRoll = (mode: RollMode, date: string) => remove(saveKey(mode, date));

const EMPTY_STATS: Stats = { played: 0, streak: 0, bestStreak: 0, bestPoints: 0, lastDate: null, history: {} };
export function loadStats(): Stats {
  const s = { ...EMPTY_STATS, ...read<Partial<Stats>>('stats', {}) };
  // Older saves used a bigger points scale; a daily tops out at 700 m now.
  s.bestPoints = Math.min(s.bestPoints, 700);
  return s;
}

export function recordFinishedRoll(date: string, points: number, previousDate: string): Stats {
  const stats = loadStats();
  if (stats.history[date] !== undefined) return stats;
  stats.history[date] = points;
  stats.played += 1;
  stats.streak = stats.lastDate === previousDate ? stats.streak + 1 : 1;
  stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  stats.bestPoints = Math.max(stats.bestPoints, points);
  stats.lastDate = date;
  write('stats', stats);
  return stats;
}

export const loadSuggestions = () => read<Suggestion[]>('suggestions', []);
export function addSuggestion(s: Suggestion): void {
  const all = loadSuggestions();
  if (!all.some((x) => x.categoryId === s.categoryId && x.input === s.input)) {
    all.push(s);
    write('suggestions', all);
  }
}

export const PROMPT_CHOICES = [3, 5, 7, 10] as const;
export function loadCustomSettings(): CustomSettings {
  const s = read<Partial<CustomSettings>>('custom-settings', {});
  return {
    disabled: Array.isArray(s.disabled) ? s.disabled : [],
    prompts: PROMPT_CHOICES.includes(s.prompts as never) ? (s.prompts as number) : 7,
  };
}
export const saveCustomSettings = (s: CustomSettings) => write('custom-settings', s);

/** Dev helper: wipe everything this site stored. */
export function clearAllSiteData(): void {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
}
