import type { TierId } from './tiers';

/** Shape of a category JSON file as authored on disk. */
export interface CategoryFile {
  id: string;
  prompt: string;
  /** Seconds to answer. Defaults to 25. */
  timeLimit?: number;
  /** Words dropped from input and answers before matching, e.g. ["git"] or ["penguin"]. */
  ignoreWords?: string[];
  /** For people: also accept just the last name ("Gauss" for "Carl Friedrich Gauss"). */
  matchSurname?: boolean;
  /** Turn off typo tolerance (useful for numbers, short codes). */
  exactOnly?: boolean;
  /** Tier -> answers. Each answer is "Display name|alias|alias...". */
  answers: Partial<Record<TierId, string[]>>;
}

export interface PackFile {
  name: string;
  color?: string;
  /** Set false to keep a pack out of the Daily Roll rotation. */
  daily?: boolean;
}

export interface Answer {
  /** Stable id inside its category (normalized display name) — used to lock answers in the multiplayer mode. */
  key: string;
  display: string;
  aliases: string[];
  tier: TierId;
}

export interface Category {
  id: string;
  pack: string;
  prompt: string;
  timeLimit: number;
  ignoreWords: string[];
  matchSurname: boolean;
  exactOnly: boolean;
  answers: Answer[];
}

export interface Pack {
  id: string;
  name: string;
  color: string;
  daily: boolean;
  categories: Category[];
}
