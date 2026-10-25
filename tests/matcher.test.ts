import { describe, expect, it } from 'vitest';
import { parseCategory } from '../src/core/categories';
import { matchAnswer } from '../src/core/matcher';
import { normalize } from '../src/core/normalize';
import type { CategoryFile } from '../src/core/types';

const make = (file: Partial<CategoryFile>) =>
  parseCategory({ id: 't', prompt: 'p', answers: {}, ...file } as CategoryFile, 'test');

const display = (cat: ReturnType<typeof make>, input: string) => {
  const r = matchAnswer(cat, input);
  return r.kind === 'match' ? r.answer.display : null;
};

describe('normalize', () => {
  it('strips Polish diacritics including ł', () => {
    expect(normalize('Łódź')).toBe('lodz');
    expect(normalize('Wałęsa')).toBe('walesa');
    expect(normalize('Świętokrzyskie')).toBe('swietokrzyskie');
  });

  it('drops case, punctuation, spaces and "the"', () => {
    expect(normalize('  The Merchant-of Venice! ')).toBe('merchantofvenice');
  });

  it('keeps C, C++ and C# apart', () => {
    expect(new Set([normalize('C'), normalize('C++'), normalize('C#')]).size).toBe(3);
  });

  it('honours ignore words but never empties the answer', () => {
    expect(normalize('git cherry-pick', ['git'])).toBe('cherrypick');
    expect(normalize('Penguin', ['penguin'])).toBe('penguin');
  });
});

describe('matchAnswer', () => {
  const countries = make({
    answers: {
      slush: ['France', 'Poland|Polska'],
      icefrost: ['Niger', 'Nigeria', 'Iran', 'Iraq'],
      absolutezero: ['San Marino'],
    },
  });

  it('matches display names and aliases', () => {
    expect(display(countries, 'france')).toBe('France');
    expect(display(countries, 'POLSKA')).toBe('Poland');
    expect(display(countries, 'sanmarino')).toBe('San Marino');
  });

  it('forgives small typos', () => {
    const r = matchAnswer(countries, 'San Marnio');
    expect(r.kind).toBe('match');
    expect(r.kind === 'match' && r.typo).toBe(true);
  });

  it('refuses typos that could mean two answers', () => {
    expect(display(countries, 'Irax')).toBeNull(); // Iran or Iraq?
  });

  it('prefers exact matches over close ones', () => {
    expect(display(countries, 'Niger')).toBe('Niger');
    expect(display(countries, 'Nigeria')).toBe('Nigeria');
  });

  it('rejects empty and unknown input', () => {
    expect(matchAnswer(countries, '   ').kind).toBe('empty');
    expect(matchAnswer(countries, 'Atlantis').kind).toBe('miss');
  });

  it('matches numbers exactly and reads a leading number', () => {
    const http = make({ answers: { slush: ['404|Not Found'], icefrost: ['405|Method Not Allowed'] } });
    expect(display(http, '404')).toBe('404');
    expect(display(http, '404 not found')).toBe('404');
    expect(display(http, '406')).toBeNull();
  });

  it('accepts unique surnames when matchSurname is on', () => {
    const people = make({
      matchSurname: true,
      answers: { slush: ['Lech Kaczyński', 'Jarosław Kaczyński', 'Donald Tusk'] },
    });
    expect(display(people, 'Tusk')).toBe('Donald Tusk');
    expect(display(people, 'Kaczynski')).toBeNull(); // ambiguous
    expect(display(people, 'Lech Kaczynski')).toBe('Lech Kaczyński');
  });

  it('respects exactOnly', () => {
    const cmds = make({ exactOnly: true, answers: { slush: ['commit', 'rebase'] } });
    expect(display(cmds, 'comit')).toBeNull();
    expect(display(cmds, 'commit')).toBe('commit');
  });
});
