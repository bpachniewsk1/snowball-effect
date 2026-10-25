import { ALL_CATEGORIES, PACKS } from '../core/categories';
import { dateKey, dayNumber, pickDailyCategories } from '../core/daily';
import { matchAnswer } from '../core/matcher';
import { hashString, mulberry32, shuffle } from '../core/rng';
import { MISS_EMOJI, TIERS, formatSize } from '../core/tiers';
import type { Answer, Category } from '../core/types';
import { clearRoll, loadRoll, recordFinishedRoll, saveRoll, type RollMode, type RollSave, type RoundRecord } from './storage';
import { updateProgress } from './profile';

export type SubmitOutcome =
  | { kind: 'empty' }
  /** Already guessed this wrong answer — no new penalty, just a nudge. */
  | { kind: 'repeat'; input: string }
  | { kind: 'wrong'; input: string }
  | { kind: 'scored'; record: RoundRecord; typo: boolean };

export interface Rank {
  name: string;
  /** Minimum points to reach this rank. */
  from: number;
  /** "About the size of …" */
  like: string;
}

/** Snowball size classes, by points (cm of growth). */
export const RANKS: Rank[] = [
  { name: 'Snowpea', from: 0, like: 'a frozen pea' },
  { name: 'Snowball', from: 50, like: 'a beach ball' },
  { name: 'Snowboulder', from: 150, like: 'a small car' },
  { name: 'Avalanche', from: 300, like: 'a double-decker bus' },
  { name: 'Snowmageddon', from: 550, like: 'a house' },
  { name: 'Glacier', from: 900, like: 'a blue whale' },
  { name: 'Iceberg', from: 1300, like: 'a lighthouse' },
  { name: 'Absolute Unit', from: 1750, like: 'a small moon' },
];

export const rankAt = (points: number) => [...RANKS].reverse().find((r) => points >= r.from) ?? RANKS[0];

function yesterdayOf(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d - 1));
}

export class Roll {
  readonly mode: RollMode;
  readonly date: string;
  readonly number: number;
  readonly categories: Category[];
  private save: RollSave;

  private constructor(mode: RollMode, date: string, categories: Category[], save: RollSave) {
    this.mode = mode;
    this.date = date;
    this.number = dayNumber(date);
    this.categories = categories;
    this.save = save;

    // A round that was started and then abandoned (reload, closed tab) counts as running out of time.
    if (save.inProgress !== null && save.rounds.length === save.inProgress && this.current) {
      this.timeout('');
    }
  }

  /** Today's (or a dev-chosen day's) roll — the same for everyone. */
  static daily(date = dateKey()): Roll {
    const categories = pickDailyCategories(PACKS, date);
    const save = loadRoll('daily', date) ?? { mode: 'daily', date, rounds: [], inProgress: null, finished: false };
    return new Roll('daily', date, categories, save);
  }

  /** The custom roll in progress (or finished, still showing results), if any. */
  static resumeCustom(): Roll | null {
    const save = loadRoll('custom', '');
    if (!save?.categoryIds) return null;
    const categories = save.categoryIds
      .map((id) => ALL_CATEGORIES.find((c) => c.id === id))
      .filter((c): c is Category => !!c);
    if (categories.length === 0) return null;
    return new Roll('custom', save.date, categories, save);
  }

  /** A fresh custom roll with random prompts from the given categories. */
  static newCustom(pool: Category[], prompts: number): Roll {
    const rand = mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    const categories = shuffle(pool, rand).slice(0, Math.min(prompts, pool.length));
    const save: RollSave = {
      mode: 'custom',
      date: dateKey(),
      categoryIds: categories.map((c) => c.id),
      rounds: [],
      inProgress: null,
      finished: false,
    };
    saveRoll(save);
    return new Roll('custom', save.date, categories, save);
  }

  get rounds(): readonly RoundRecord[] {
    return this.save.rounds;
  }
  get finished(): boolean {
    return this.save.finished;
  }
  get started(): boolean {
    return this.save.rounds.length > 0 || this.save.inProgress !== null;
  }
  get roundIndex(): number {
    return this.save.rounds.length;
  }
  get current(): Category | null {
    return this.finished ? null : this.categories[this.roundIndex] ?? null;
  }
  get points(): number {
    return this.save.rounds.reduce((n, r) => n + r.points, 0);
  }
  get maxPoints(): number {
    return this.categories.length * TIERS.absolutezero.points;
  }
  /** 0..1 — how far through the prompts we are (drives time of day). */
  get progress(): number {
    return this.categories.length ? this.roundIndex / this.categories.length : 0;
  }
  /** Wrong guesses in the current round. */
  get misses(): readonly string[] {
    return this.save.pendingMisses ?? [];
  }
  get label(): string {
    return this.mode === 'daily' ? `Daily Roll #${this.number}` : 'Custom Roll';
  }

  /** Call when the prompt appears and the timer starts. */
  beginRound(): void {
    if (this.finished) return;
    this.save.inProgress = this.roundIndex;
    saveRoll(this.save);
  }

  /** Wrong answers don't end the round — keep guessing until right or out of time. */
  submit(input: string): SubmitOutcome {
    const cat = this.current;
    if (!cat) return { kind: 'empty' };
    const result = matchAnswer(cat, input);
    if (result.kind === 'empty') return { kind: 'empty' };

    if (result.kind === 'miss') {
      const guess = input.trim();
      const misses = (this.save.pendingMisses ??= []);
      if (misses.some((m) => m.toLowerCase() === guess.toLowerCase())) return { kind: 'repeat', input: guess };
      misses.push(guess);
      saveRoll(this.save);
      updateProgress((p) => p.wrongGuesses++);
      return { kind: 'wrong', input: guess };
    }

    const tier = TIERS[result.answer.tier];
    const record: RoundRecord = {
      categoryId: cat.id,
      input,
      answerKey: result.answer.key,
      answerDisplay: result.answer.display,
      tier: tier.id,
      points: tier.points,
      timedOut: false,
      misses: [...this.misses],
    };
    this.commit(record);
    return { kind: 'scored', record, typo: result.typo };
  }

  timeout(input = ''): RoundRecord {
    const record: RoundRecord = {
      categoryId: this.current!.id,
      input,
      answerKey: null,
      answerDisplay: null,
      tier: null,
      points: 0,
      timedOut: true,
      misses: [...this.misses],
    };
    this.commit(record);
    return record;
  }

  /** A few of the coldest answers the player didn't give, for the reveal screen. */
  colderAnswers(cat: Category, exclude: string | null, count = 3): Answer[] {
    const pool = cat.answers.filter(
      (a) => (a.tier === 'absolutezero' || a.tier === 'brainfreeze') && a.key !== exclude,
    );
    return shuffle(pool, mulberry32(hashString(`${this.date}:${cat.id}`))).slice(0, count);
  }

  shareText(): string {
    const marks = this.save.rounds.map((r) => (r.tier ? TIERS[r.tier].emoji : MISS_EMOJI)).join('');
    const title = this.mode === 'daily' ? `Snowball Effect #${this.number}` : 'Snowball Effect (custom)';
    return `${title} ☃️\n${formatSize(this.points)} · ${rankAt(this.points).name}\n${marks}`;
  }

  categoryFor(record: RoundRecord): Category | undefined {
    return ALL_CATEGORIES.find((c) => c.id === record.categoryId);
  }

  /** Dev: forget this roll's progress. */
  reset(): void {
    clearRoll(this.mode, this.date);
  }

  private commit(record: RoundRecord): void {
    this.save.rounds.push(record);
    this.save.inProgress = null;
    this.save.pendingMisses = [];
    const finishing = this.save.rounds.length >= this.categories.length && !this.save.finished;
    let streak = 0;
    if (finishing) {
      this.save.finished = true;
      if (this.mode === 'daily') streak = recordFinishedRoll(this.date, this.points, yesterdayOf(this.date)).bestStreak;
    }
    saveRoll(this.save);

    // Lifetime progress (unlocks snowmen).
    updateProgress((p) => {
      if (record.tier) p.tierCounts[record.tier]++;
      if (record.timedOut) p.timeouts++;
      p.bestPoints = Math.max(p.bestPoints, this.points);
      if (finishing) {
        p.rollsFinished++;
        if (this.mode === 'custom') p.customFinished++;
        p.bestStreak = Math.max(p.bestStreak, streak);
      }
    });
  }
}
