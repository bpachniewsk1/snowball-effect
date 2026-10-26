import { ALL_CATEGORIES, PACKS } from '../core/categories';
import { LAUNCH_DATE, dateKey, dayNumber, pickDailyCategories } from '../core/daily';
import { matchAnswer, suggestAnswer } from '../core/matcher';
import { TEST_MODE } from '../core/testmode';
import { uuid } from '../net/telemetry';
import { hashString, mulberry32, shuffle } from '../core/rng';
import { MISS_EMOJI, TIERS, formatAltitude } from '../core/tiers';
import type { Answer, Category } from '../core/types';
import { clearRoll, loadRoll, recordFinishedRoll, saveRoll, type RollMode, type RollSave, type RoundRecord } from './storage';
import { updateProgress } from './profile';

/** Timing of an answer, for the speed-based snowmen. */
export interface AnswerTiming {
  /** Seconds since the clock started. */
  elapsed: number;
  /** Seconds left on the clock. */
  left: number;
}

/** A day in the archive calendar. */
export interface CalendarDay {
  date: string;
  number: number;
  when: 'past' | 'today' | 'future';
}

export type SubmitOutcome =
  | { kind: 'empty' }
  /** Already guessed this wrong answer — no new penalty, just a nudge. */
  | { kind: 'repeat'; input: string }
  | { kind: 'wrong'; input: string }
  /** Not on the list, but very close to one answer: ask "Did you mean …?" (not counted as wrong). */
  | { kind: 'near'; input: string; suggestion: string }
  | { kind: 'scored'; record: RoundRecord; typo: boolean };

export interface Rank {
  name: string;
  /** Minimum points to reach this rank. */
  from: number;
  /** "As high as …" */
  like: string;
}

/** Ranks by metres climbed (a perfect daily is 700 m — space). */
export const RANKS: Rank[] = [
  { name: 'Snowpea', from: 0, like: 'a molehill' },
  { name: 'Snowball', from: 35, like: 'a ten-storey building' },
  { name: 'Snowboulder', from: 100, like: 'Big Ben' },
  { name: 'Avalanche', from: 200, like: 'a skyscraper' },
  { name: 'Snowmageddon', from: 320, like: 'the Eiffel Tower' },
  { name: 'Glacier', from: 440, like: 'the Empire State Building' },
  { name: 'Iceberg', from: 560, like: 'the CN Tower' },
  { name: 'Absolute Unit', from: 700, like: 'outer space (snowman physics)' },
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
  /** A past day's daily roll, played from the archive — doesn't touch the streak. */
  readonly archive: boolean;
  private save: RollSave;

  private constructor(mode: RollMode, date: string, categories: Category[], save: RollSave, archive = false) {
    this.mode = mode;
    this.date = date;
    this.archive = archive;
    this.number = dayNumber(date);
    this.categories = categories;
    this.save = save;
    // Points come from the tier table, so older saves follow any rescoring.
    for (const r of save.rounds) r.points = r.tier ? TIERS[r.tier].points : 0;

    // A round that was started and then abandoned (reload, closed tab) counts as running out of time.
    if (save.inProgress !== null && save.rounds.length === save.inProgress && this.current) {
      this.timeout('');
    }
  }

  /** A day's roll — the same for everyone. Days before `today` are archive rolls. */
  static daily(date = dateKey(), today = date): Roll {
    const categories = pickDailyCategories(PACKS, date);
    const save = loadRoll('daily', date) ?? { mode: 'daily', date, rounds: [], inProgress: null, finished: false };
    return new Roll('daily', date, categories, save, date < today);
  }

  /** Past days that have a roll (newest first), from launch day up to the day before `today`. */
  static archiveDates(today: string, limit = 90): string[] {
    const out: string[] = [];
    const [y, m, d] = today.split('-').map(Number);
    for (let i = 1; out.length < limit; i++) {
      const key = dateKey(new Date(y, m - 1, d - i));
      if (dayNumber(key) < 1) break;
      out.push(key);
    }
    return out;
  }

  /** Every Daily Roll from launch day (#1) to `ahead` days after today, oldest first. */
  static calendar(today: string, ahead = 7): CalendarDay[] {
    const out: CalendarDay[] = [];
    const [y, m, d] = LAUNCH_DATE.split('-').map(Number);
    for (let i = 0; ; i++) {
      const date = dateKey(new Date(y, m - 1, d + i));
      const when = date < today ? 'past' : date === today ? 'today' : 'future';
      if (when === 'future' && dayNumber(date) > dayNumber(today) + ahead) break;
      out.push({ date, number: dayNumber(date), when });
      if (i > 20000) break;
    }
    return out;
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

  /** Stable random id for this roll (created on first use). */
  get id(): string {
    if (!this.save.id) {
      this.save.id = uuid();
      saveRoll(this.save);
    }
    return this.save.id;
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
    if (this.mode === 'custom') return 'Custom Roll';
    return this.archive ? `Archive Roll #${this.number}` : `Daily Roll #${this.number}`;
  }

  /** Call when the prompt appears and the timer starts. */
  beginRound(): void {
    if (this.finished) return;
    this.save.inProgress = this.roundIndex;
    saveRoll(this.save);
  }

  /** Wrong answers don't end the round — keep guessing until right or out of time. */
  submit(input: string, timing?: AnswerTiming, allowSuggest = true): SubmitOutcome {
    const cat = this.current;
    if (!cat) return { kind: 'empty' };
    const result = matchAnswer(cat, input);
    if (result.kind === 'empty') return { kind: 'empty' };

    if (result.kind === 'miss') {
      const guess = input.trim();
      const near = allowSuggest ? suggestAnswer(cat, input) : null;
      if (near) return { kind: 'near', input: guess, suggestion: near.display };
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
    this.commit(record, cat, timing);
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
    const title =
      this.mode === 'custom'
        ? 'Snowball Effect (custom)'
        : `Snowball Effect #${this.number}${this.archive ? ' (archive)' : ''}`;
    return `${title}${TEST_MODE ? ' [TEST]' : ''} ☃️\n${formatAltitude(this.points)} · ${rankAt(this.points).name}\n${marks}`;
  }

  categoryFor(record: RoundRecord): Category | undefined {
    return ALL_CATEGORIES.find((c) => c.id === record.categoryId);
  }

  /** Dev: forget this roll's progress. */
  reset(): void {
    clearRoll(this.mode, this.date);
  }

  private commit(record: RoundRecord, cat?: Category, timing?: AnswerTiming): void {
    this.save.rounds.push(record);
    this.save.inProgress = null;
    this.save.pendingMisses = [];
    const finishing = this.save.rounds.length >= this.categories.length && !this.save.finished;
    let streak = 0;
    if (finishing) {
      this.save.finished = true;
      if (this.mode === 'daily' && !this.archive) {
        streak = recordFinishedRoll(this.date, this.points, yesterdayOf(this.date)).bestStreak;
      }
    }
    saveRoll(this.save);

    // Lifetime progress (unlocks snowmen).
    updateProgress((p) => {
      if (record.tier) {
        p.tierCounts[record.tier]++;
        if (cat) {
          const pack = (p.packTiers[cat.pack] ??= {});
          pack[record.tier] = (pack[record.tier] ?? 0) + 1;
        }
      }
      if (timing && record.tier) {
        if (timing.elapsed <= 3) p.fastAnswers++;
        if (timing.left <= 2) p.clutchAnswers++;
      }
      if (record.timedOut) p.timeouts++;
      p.bestPoints = Math.max(p.bestPoints, this.points);
      if (finishing) {
        p.rollsFinished++;
        if (this.mode === 'custom') p.customFinished++;
        if (this.archive) p.archiveFinished++;
        if (this.save.rounds.every((r) => !r.timedOut && !r.misses?.length)) p.cleanRolls++;
        if (this.save.rounds.length >= 7 && this.save.rounds.every((r) => r.tier === 'absolutezero')) p.perfectRolls++;
        p.bestStreak = Math.max(p.bestStreak, streak);
      }
    });
  }
}
