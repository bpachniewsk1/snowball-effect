import { describe, expect, it } from 'vitest';
import { AVATARS, STARTER, loadProgress, type Progress } from '../src/game/profile';

const fresh = (): Progress => loadProgress();
const byId = (id: string) => AVATARS.find((a) => a.id === id)!;

describe('snowman unlocks', () => {
  it('starts with Buttons only', () => {
    expect(STARTER.id).toBe('buttons');
    expect(AVATARS.filter((a) => a.isUnlocked(fresh())).map((a) => a.id)).toEqual(['buttons']);
  });

  it('needs exactly the named tier — colder answers do not count', () => {
    const p = fresh();
    p.tierCounts.absolutezero = 3;
    expect(byId('pirate').isUnlocked(p)).toBe(true);
    expect(byId('crown').isUnlocked(p)).toBe(true);
    expect(byId('winking').isUnlocked(p)).toBe(false);
    expect(byId('pointy').isUnlocked(p)).toBe(false);
    expect(byId("party").isUnlocked(p)).toBe(false);
    p.tierCounts.icefrost = 1;
    expect(byId('winking').isUnlocked(p)).toBe(true);
  });

  it('every avatar has a picture and a unique id', () => {
    expect(new Set(AVATARS.map((a) => a.id)).size).toBe(AVATARS.length);
    expect(AVATARS.length).toBe(20);
  });
});
