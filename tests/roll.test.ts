import { describe, expect, it } from 'vitest';
import { ALL_CATEGORIES } from '../src/core/categories';
import { Roll } from '../src/game/roll';

describe('Roll', () => {
  it('lets you keep guessing after a wrong answer', () => {
    const roll = Roll.daily('2026-10-24');
    const cat = roll.current!;
    expect(roll.submit('definitely not an answer xyz').kind).toBe('wrong');
    expect(roll.submit('Definitely not an answer XYZ').kind).toBe('repeat');
    expect(roll.roundIndex).toBe(0);

    const outcome = roll.submit(cat.answers[0].display);
    expect(outcome.kind).toBe('scored');
    if (outcome.kind === 'scored') expect(outcome.record.misses).toEqual(['definitely not an answer xyz']);
    expect(roll.roundIndex).toBe(1);
    expect(roll.misses).toEqual([]);
  });

  it('builds custom rolls from the given pool only', () => {
    const pool = ALL_CATEGORIES.filter((c) => c.pack === 'trivia');
    const roll = Roll.newCustom(pool, 3);
    expect(roll.categories).toHaveLength(3);
    expect(roll.categories.every((c) => c.pack === 'trivia')).toBe(true);
    expect(roll.mode).toBe('custom');
  });

  it('timeouts keep the wrong guesses', () => {
    const roll = Roll.daily('2026-10-25');
    roll.submit('nope nope');
    const rec = roll.timeout('half-typed');
    expect(rec.timedOut).toBe(true);
    expect(rec.points).toBe(0);
    expect(rec.misses).toEqual(['nope nope']);
  });

  it('plays past days as archive rolls', () => {
    const past = Roll.daily('2026-10-25', '2026-10-27');
    expect(past.archive).toBe(true);
    expect(past.label).toBe('Archive Roll #1');
    expect(Roll.daily('2026-10-27', '2026-10-27').archive).toBe(false);
    expect(Roll.archiveDates('2026-10-27')).toEqual(['2026-10-26', '2026-10-25']);
    expect(Roll.archiveDates('2026-10-25')).toEqual([]);
  });
});
