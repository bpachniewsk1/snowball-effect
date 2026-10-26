import { describe, expect, it } from 'vitest';
import { ALL_CATEGORIES, parseCategory } from '../src/core/categories';
import { matchAnswer, suggestAnswer } from '../src/core/matcher';

const cat = (answers: Record<string, string[]>, extra = {}) => parseCategory({ id: 't', prompt: 'p', answers, ...extra }, 'test');
const real = (id: string) => ALL_CATEGORIES.find((c) => c.id === id)!;

describe('did you mean', () => {
  const capitals = cat({ slush: ['Amsterdam', 'Ankara', 'Athens'], icefrost: ['Antananarivo', 'Asmara'] });

  it('offers the clearly closest answer for a near miss the matcher rejects', () => {
    expect(matchAnswer(capitals, 'Antanariv').kind).toBe('miss');
    expect(suggestAnswer(capitals, 'Antanariv')?.display).toBe('Antananarivo');
    expect(suggestAnswer(capitals, 'antanana')?.display).toBe('Antananarivo');
  });

  it('stays quiet for short, numeric, unrelated or ambiguous guesses', () => {
    expect(suggestAnswer(capitals, 'Ank')).toBeNull();
    expect(suggestAnswer(capitals, '1234')).toBeNull();
    expect(suggestAnswer(capitals, 'Berlin')).toBeNull();
    const twins = cat({ slush: ['Marta', 'Marty'] });
    expect(suggestAnswer(twins, 'Marti')).toBeNull();
  });

  it('works on real categories', () => {
    expect(suggestAnswer(real('goalkeepers-poland'), 'Szczes')?.display).toBe('Wojciech Szczęsny');
    expect(suggestAnswer(real('breaking-bad-characters'), 'Heisenbrg man')).toBeNull();
    expect(suggestAnswer(real('chemical-elements'), 'Plutonim')?.display).toBe('Plutonium');
  });
});
