// Rarity tiers — Krillion's five (Plankton → Schooler → Rare → Deep Cut → Krillion), frozen:
// the rarer, the colder. Rename labels or tweak points here — everything else reads from this table.

export const TIER_IDS = ['slush', 'snowflake', 'icefrost', 'brainfreeze', 'absolutezero'] as const;
export type TierId = (typeof TIER_IDS)[number];

export interface TierInfo {
  id: TierId;
  label: string;
  /** Flavour temperature shown on the badge. */
  temp: string;
  blurb: string;
  /**
   * Snowball growth in cm. Roughly doubles per tier, so rare answers grow the ball far more than
   * common ones (a single Absolute Zero is worth 25 Slush).
   */
  points: number;
  /** Multiplayer points — reserved for the party mode. */
  partyPoints: number;
  color: string;
  emoji: string;
  /** 0 (most common) … 4 (rarest) — drives the reveal effects. */
  level: number;
}

export const TIERS: Record<TierId, TierInfo> = {
  slush: {
    id: 'slush',
    label: 'Slush',
    temp: '0 °C',
    blurb: 'Everyone stepped in this one. Still counts!',
    points: 10,
    partyPoints: 0,
    color: '#b9c7d3',
    emoji: '💧',
    level: 0,
  },
  snowflake: {
    id: 'snowflake',
    label: 'Snowflake',
    temp: '−15 °C',
    blurb: 'A solid answer most people know.',
    points: 30,
    partyPoints: 1,
    color: '#cfeeff',
    emoji: '❄️',
    level: 1,
  },
  icefrost: {
    id: 'icefrost',
    label: 'Icefrost',
    temp: '−40 °C',
    blurb: 'Sharp! Not many went there.',
    points: 60,
    partyPoints: 2,
    color: '#8fe3f0',
    emoji: '🧊',
    level: 2,
  },
  brainfreeze: {
    id: 'brainfreeze',
    label: 'Brain Freeze',
    temp: '−89 °C',
    blurb: "A deep cut. You froze everyone's brain.",
    points: 120,
    partyPoints: 3,
    color: '#f7a8cf',
    emoji: '🍧',
    level: 3,
  },
  absolutezero: {
    id: 'absolutezero',
    label: 'Absolute Zero',
    temp: '−273.15 °C',
    blurb: 'Nothing in the universe is colder than this answer.',
    points: 250,
    partyPoints: 4,
    color: '#e0d4ff',
    emoji: '🥶',
    level: 4,
  },
};

export const MISS_EMOJI = '🫠';
/** Snowball diameter before the first answer, in cm. */
export const START_CM = 10;
export const CM_PER_POINT = 1;
export const isTierId = (s: string): s is TierId => (TIER_IDS as readonly string[]).includes(s);

/** "85 cm" / "2.45 m" */
export function formatSize(points: number): string {
  const cm = START_CM + points * CM_PER_POINT;
  return cm < 100 ? `${Math.round(cm)} cm` : `${(cm / 100).toFixed(2)} m`;
}
