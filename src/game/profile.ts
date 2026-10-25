// Player profile: snowman avatar + nickname, plus lifetime progress used to unlock more snowmen.
import type { TierId } from '../core/tiers';

export interface Progress {
  tierCounts: Record<TierId, number>;
  timeouts: number;
  wrongGuesses: number;
  rollsFinished: number;
  customFinished: number;
  /** Best snowball in any mode, in points. */
  bestPoints: number;
  /** Best daily streak ever. */
  bestStreak: number;
  /** Avatars already announced as unlocked. */
  unlocked: string[];
}

export interface Avatar {
  id: string;
  name: string;
  src: string;
  /** How to earn it ("" = unlocked from the start). */
  hint: string;
  isUnlocked: (p: Progress) => boolean;
}

const base = import.meta.env.BASE_URL;
const colder = (p: Progress, from: TierId) => {
  const order: TierId[] = ['icefrost', 'brainfreeze', 'absolutezero'];
  return order.slice(order.indexOf(from)).reduce((n, t) => n + p.tierCounts[t], 0);
};

export const AVATARS: Avatar[] = [
  { id: 'winking', name: 'Winky', hint: '', isUnlocked: () => true },
  { id: 'classic', name: 'Classic', hint: 'Finish your first roll', isUnlocked: (p: Progress) => p.rollsFinished >= 1 },
  { id: 'meh', name: 'Meh', hint: 'Run out of time once', isUnlocked: (p: Progress) => p.timeouts >= 1 },
  { id: 'buttons', name: 'Buttons', hint: 'Get an Icefrost (or colder) answer', isUnlocked: (p: Progress) => colder(p, 'icefrost') >= 1 },
  { id: 'cap', name: 'Cap', hint: 'Finish 3 custom rolls', isUnlocked: (p: Progress) => p.customFinished >= 3 },
  { id: 'tophat', name: 'Top Hat', hint: 'Reach a 3-day daily streak', isUnlocked: (p: Progress) => p.bestStreak >= 3 },
  { id: 'pointy', name: 'Pointy', hint: 'Get a Brain Freeze (or colder) answer', isUnlocked: (p: Progress) => colder(p, 'brainfreeze') >= 1 },
  { id: 'tallboi', name: 'Tall Boi', hint: 'Roll a snowball of 5 m or more', isUnlocked: (p: Progress) => p.bestPoints >= 490 },
  { id: 'melty', name: 'Melty', hint: 'Run out of time 5 times', isUnlocked: (p: Progress) => p.timeouts >= 5 },
  { id: 'mustache', name: 'Mustache', hint: 'Reach a 7-day daily streak', isUnlocked: (p: Progress) => p.bestStreak >= 7 },
  { id: 'pirate', name: 'Pirate', hint: 'Get an Absolute Zero answer', isUnlocked: (p: Progress) => colder(p, 'absolutezero') >= 1 },
].map((a) => ({ ...a, src: `${base}avatars/${a.id}.png` }));

export const STARTER = AVATARS[0];

// ---------- storage ----------

const PROFILE_KEY = 'snowball:v1:profile';
const PROGRESS_KEY = 'snowball:v2:progress';

function read<T>(key: string): Partial<T> | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<T> | null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const EMPTY_COUNTS: Record<TierId, number> = { slush: 0, snowflake: 0, icefrost: 0, brainfreeze: 0, absolutezero: 0 };

export function loadProgress(): Progress {
  const p = read<Progress>(PROGRESS_KEY) ?? {};
  return {
    tierCounts: { ...EMPTY_COUNTS, ...(p.tierCounts ?? {}) },
    timeouts: p.timeouts ?? 0,
    wrongGuesses: p.wrongGuesses ?? 0,
    rollsFinished: p.rollsFinished ?? 0,
    customFinished: p.customFinished ?? 0,
    bestPoints: p.bestPoints ?? 0,
    bestStreak: p.bestStreak ?? 0,
    unlocked: p.unlocked ?? [STARTER.id],
  };
}

/** Applies a change to lifetime progress and saves it. */
export function updateProgress(fn: (p: Progress) => void): void {
  const p = loadProgress();
  fn(p);
  write(PROGRESS_KEY, p);
}

// Dev toggle: treat every snowman as unlocked without touching real progress.
const UNLOCK_ALL_KEY = 'snowball:v1:dev-unlock-all';
export function isUnlockAllOn(): boolean {
  try {
    return localStorage.getItem(UNLOCK_ALL_KEY) === '1';
  } catch {
    return false;
  }
}
export function setUnlockAll(on: boolean): void {
  try {
    if (on) localStorage.setItem(UNLOCK_ALL_KEY, '1');
    else localStorage.removeItem(UNLOCK_ALL_KEY);
  } catch {
    /* ignore */
  }
}

export const isAvatarUnlocked = (a: Avatar, p = loadProgress()) => isUnlockAllOn() || a.isUnlocked(p);

/** Avatars that became available since we last checked (and marks them as announced). */
export function takeNewUnlocks(): Avatar[] {
  const p = loadProgress();
  const fresh = AVATARS.filter((a) => a.isUnlocked(p) && !p.unlocked.includes(a.id));
  if (fresh.length) {
    p.unlocked.push(...fresh.map((a) => a.id));
    write(PROGRESS_KEY, p);
  }
  return fresh;
}

// ---------- profile ----------

export interface Profile {
  avatar: string;
  name: string;
}

export const NAME_MAX = 16;

export const avatarById = (id: string) => AVATARS.find((a) => a.id === id) ?? STARTER;

export function loadProfile(): Profile {
  const p = read<Profile>(PROFILE_KEY);
  const wanted = avatarById(p?.avatar ?? '');
  // A saved avatar that's (no longer) unlocked falls back to the starter.
  const avatar = isAvatarUnlocked(wanted) ? wanted.id : STARTER.id;
  return { avatar, name: (p?.name ?? '').slice(0, NAME_MAX) };
}

export function saveProfile(p: Profile): void {
  write(PROFILE_KEY, { avatar: p.avatar, name: p.name.trim().slice(0, NAME_MAX) });
}

export const displayName = (p: Profile) => p.name.trim() || 'Nameless snowman';
