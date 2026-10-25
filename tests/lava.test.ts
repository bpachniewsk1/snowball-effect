import { describe, expect, it } from 'vitest';
import { parseCategory } from '../src/core/categories';
import { LavaGame } from '../src/game/lava';

const colors = parseCategory(
  { id: 'c', prompt: 'Name a colour', answers: { slush: ['Red', 'Blue', 'Green'], icefrost: ['Teal'], absolutezero: ['Vermilion'] } },
  'test',
);
const players = [
  { name: 'A', avatar: 'winking' },
  { name: 'B', avatar: 'winking' },
  { name: 'C', avatar: 'winking' },
];

describe('LavaGame', () => {
  it('passes the bucket on a valid, unused answer and speeds up', () => {
    const g = new LavaGame(players, [colors], { hearts: 2 }, 1);
    g.newCategory();
    const first = g.current;
    const t0 = g.turnTime;
    const r = g.submit('red');
    expect(r.kind).toBe('ok');
    expect(g.current).toBe((first + 1) % 3);
    expect(g.turnTime).toBeLessThan(t0);
  });

  it('rejects wrong and already-used answers without passing', () => {
    const g = new LavaGame(players, [colors], {}, 2);
    g.newCategory();
    g.submit('blue');
    const holder = g.current;
    expect(g.submit('purple').kind).toBe('wrong');
    expect(g.submit('Blue').kind).toBe('used');
    expect(g.current).toBe(holder);
  });

  it('awards party points for cold answers', () => {
    const g = new LavaGame(players, [colors], {}, 3);
    g.newCategory();
    const p = g.current;
    g.submit('vermilion');
    expect(g.players[p].points).toBe(4);
  });

  it('eruptions cost hearts, eliminate, and crown a winner', () => {
    const g = new LavaGame(players.slice(0, 2), [colors], { hearts: 1 }, 4);
    g.newCategory();
    const victim = g.current;
    const e = g.explode();
    expect(e.victim).toBe(victim);
    expect(e.eliminated).toBe(true);
    expect(e.winner).toBe(1 - victim);
  });

  it('skips eliminated players', () => {
    const g = new LavaGame(players, [colors], { hearts: 1 }, 5);
    g.newCategory();
    const victim = g.current;
    g.explode();
    for (let i = 0; i < 4; i++) {
      expect(g.current).not.toBe(victim);
      g.submit(['red', 'blue', 'green', 'teal'][i]);
    }
  });
});
