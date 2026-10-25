// Run with `npm run check-categories` after editing anything in /categories.
import { describe, expect, it } from 'vitest';
import { ALL_CATEGORIES, PACKS } from '../src/core/categories';
import { normalize } from '../src/core/normalize';
import { TIER_IDS } from '../src/core/tiers';

const MIN_ANSWERS = 8;

describe('category files', () => {
  it('loads at least one pack', () => {
    expect(PACKS.length).toBeGreaterThan(0);
  });

  it('has unique category ids', () => {
    const ids = ALL_CATEGORIES.map((c) => c.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `duplicate ids: ${dupes.join(', ')}`).toEqual([]);
  });

  for (const cat of ALL_CATEGORIES) {
    describe(`${cat.pack}/${cat.id}`, () => {
      it(`has a prompt and at least ${MIN_ANSWERS} answers`, () => {
        expect(cat.prompt.trim()).not.toBe('');
        expect(cat.answers.length).toBeGreaterThanOrEqual(MIN_ANSWERS);
      });

      it('uses at least 3 different tiers', () => {
        const used = new Set(cat.answers.map((a) => a.tier));
        expect(used.size, `tiers used: ${[...used].join(', ')} of ${TIER_IDS.join(', ')}`).toBeGreaterThanOrEqual(3);
      });

      it('never lists the same answer or alias twice', () => {
        const owner = new Map<string, string>();
        const clashes: string[] = [];
        for (const a of cat.answers) {
          for (const name of new Set([a.display, ...a.aliases].map((n) => normalize(n, cat.ignoreWords)))) {
            const prev = owner.get(name);
            if (prev && prev !== a.display) clashes.push(`"${name}" in both "${prev}" and "${a.display}"`);
            owner.set(name, a.display);
          }
        }
        expect(clashes).toEqual([]);
      });

      it('keeps Absolute Zero truly rare (1–2) and Slush to at most 15', () => {
        const count = (t: string) => cat.answers.filter((a) => a.tier === t).length;
        expect(count('absolutezero')).toBeGreaterThanOrEqual(1);
        expect(count('absolutezero')).toBeLessThanOrEqual(2);
        expect(count('slush')).toBeLessThanOrEqual(15);
      });

      it('has a sensible time limit', () => {
        expect(cat.timeLimit).toBeGreaterThanOrEqual(5);
        expect(cat.timeLimit).toBeLessThanOrEqual(120);
      });
    });
  }
});
