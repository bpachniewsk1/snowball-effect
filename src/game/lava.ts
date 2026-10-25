// Lava Bucket — the party mode (our take on hot potato / Krillion's Puffer Party).
//
// A bucket of lava is passed around. On your turn, type a valid answer for the current category that
// nobody has used yet. Each pass makes the bucket boil faster (shorter turns). If the timer runs out
// while you're holding it, it erupts: you lose a heart and a new category starts with the next player.
// Last snowman with hearts wins; cold answers earn party points as a tiebreaker.
//
// This module is pure game logic (no DOM, no timers) so the same rules can later run on a server
// for online rooms — the caller owns the clock and calls `timeLeft`/`explode`.

import { matchAnswer } from '../core/matcher';
import { mulberry32, shuffle } from '../core/rng';
import { TIERS, type TierId } from '../core/tiers';
import type { Category } from '../core/types';

export interface LavaPlayer {
  name: string;
  avatar: string;
  hearts: number;
  points: number;
  /** Answers given (for the end screen). */
  answers: number;
}

export interface LavaSettings {
  hearts: number;
  /** First turn of each category, seconds. */
  startTime: number;
  /** Turns never get shorter than this, seconds. */
  minTime: number;
  /** Each pass multiplies the turn time by this. */
  speedUp: number;
}

export const DEFAULT_LAVA: LavaSettings = { hearts: 3, startTime: 12, minTime: 3, speedUp: 0.88 };

export type LavaSubmit =
  | { kind: 'empty' }
  | { kind: 'wrong'; input: string }
  | { kind: 'used'; input: string; display: string }
  | { kind: 'ok'; display: string; tier: TierId; partyPoints: number; passedTo: number };

export interface Eruption {
  victim: number;
  eliminated: boolean;
  winner: number | null;
}

export class LavaGame {
  readonly players: LavaPlayer[];
  readonly settings: LavaSettings;
  current = 0;
  category: Category | null = null;
  /** Normalized keys of answers already used this category. */
  used = new Set<string>();
  /** Recently accepted answers this category, newest first. */
  history: { player: number; display: string; tier: TierId }[] = [];
  turnTime: number;
  round = 0;
  private pool: Category[];
  private queue: Category[] = [];
  private rand: () => number;

  constructor(players: { name: string; avatar: string }[], pool: Category[], settings: Partial<LavaSettings> = {}, seed = Date.now()) {
    if (players.length < 2) throw new Error('Lava Bucket needs at least 2 players');
    if (!pool.length) throw new Error('No categories to play with');
    this.settings = { ...DEFAULT_LAVA, ...settings };
    this.players = players.map((p) => ({ ...p, hearts: this.settings.hearts, points: 0, answers: 0 }));
    this.pool = pool;
    this.rand = mulberry32(seed >>> 0);
    this.turnTime = this.settings.startTime;
    this.current = Math.floor(this.rand() * players.length);
  }

  get alive(): number[] {
    return this.players.map((p, i) => (p.hearts > 0 ? i : -1)).filter((i) => i >= 0);
  }

  get winner(): number | null {
    const a = this.alive;
    return a.length === 1 ? a[0] : null;
  }

  /** Starts a new category (call at the beginning and after each eruption). */
  newCategory(): Category {
    if (!this.queue.length) this.queue = shuffle(this.pool, this.rand);
    this.category = this.queue.shift()!;
    this.used.clear();
    this.history = [];
    this.turnTime = this.settings.startTime;
    this.round++;
    return this.category;
  }

  submit(input: string): LavaSubmit {
    const cat = this.category;
    if (!cat) return { kind: 'empty' };
    const result = matchAnswer(cat, input);
    if (result.kind === 'empty') return { kind: 'empty' };
    if (result.kind === 'miss') return { kind: 'wrong', input: input.trim() };
    const a = result.answer;
    if (this.used.has(a.key)) return { kind: 'used', input: input.trim(), display: a.display };

    this.used.add(a.key);
    const p = this.players[this.current];
    const partyPoints = TIERS[a.tier].partyPoints;
    p.points += partyPoints;
    p.answers++;
    this.history.unshift({ player: this.current, display: a.display, tier: a.tier });
    this.current = this.nextAlive(this.current);
    this.turnTime = Math.max(this.settings.minTime, this.turnTime * this.settings.speedUp);
    return { kind: 'ok', display: a.display, tier: a.tier, partyPoints, passedTo: this.current };
  }

  /** Time ran out: the holder loses a heart; the next category starts with the next player. */
  explode(): Eruption {
    const victim = this.current;
    const p = this.players[victim];
    p.hearts = Math.max(0, p.hearts - 1);
    const eliminated = p.hearts === 0;
    const winner = this.winner;
    if (winner === null) this.current = this.nextAlive(victim);
    return { victim, eliminated, winner };
  }

  /** Final standings: survivors first, then by party points. */
  standings(): number[] {
    return this.players
      .map((_, i) => i)
      .sort((a, b) => this.players[b].hearts - this.players[a].hearts || this.players[b].points - this.players[a].points);
  }

  private nextAlive(from: number): number {
    for (let step = 1; step <= this.players.length; step++) {
      const i = (from + step) % this.players.length;
      if (this.players[i].hearts > 0) return i;
    }
    return from;
  }
}
