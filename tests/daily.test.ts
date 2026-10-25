import { describe, expect, it } from 'vitest';
import { PACKS } from '../src/core/categories';
import { LAUNCH_DATE, PROMPTS_PER_DAY, dateKey, dayNumber, pickDailyCategories } from '../src/core/daily';

describe('daily roll', () => {
  it('numbers rolls from launch day', () => {
    expect(dayNumber(LAUNCH_DATE)).toBe(1);
    expect(dayNumber('2026-10-26')).toBe(2);
    expect(dayNumber('2026-11-24')).toBe(31);
  });

  it('formats local dates', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('is deterministic and has no repeats within a day', () => {
    for (let d = 0; d < 60; d++) {
      const key = dateKey(new Date(2026, 9, 24 + d));
      const a = pickDailyCategories(PACKS, key).map((c) => c.id);
      const b = pickDailyCategories(PACKS, key).map((c) => c.id);
      expect(a).toEqual(b);
      expect(a).toHaveLength(PROMPTS_PER_DAY);
      expect(new Set(a).size).toBe(a.length);
    }
  });

  it('mixes packs within a day', () => {
    const packs = new Set(pickDailyCategories(PACKS, LAUNCH_DATE).map((c) => c.pack));
    expect(packs.size).toBeGreaterThanOrEqual(Math.min(4, PACKS.length));
  });
});
