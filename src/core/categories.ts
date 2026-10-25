import { normalize } from './normalize';
import { TIER_IDS, isTierId } from './tiers';
import type { Answer, Category, CategoryFile, Pack, PackFile } from './types';

export const DEFAULT_TIME_LIMIT = 25;

/** Turns a raw category file into the runtime shape. Throws with a readable message on bad data. */
export function parseCategory(file: CategoryFile, pack: string, source = file.id): Category {
  if (!file.id || typeof file.id !== 'string') throw new Error(`${source}: missing "id"`);
  if (!file.prompt) throw new Error(`${source}: missing "prompt"`);
  if (!file.answers || typeof file.answers !== 'object') throw new Error(`${source}: missing "answers"`);

  const ignoreWords = file.ignoreWords ?? [];
  const answers: Answer[] = [];
  for (const [tier, list] of Object.entries(file.answers)) {
    if (!isTierId(tier)) {
      throw new Error(`${source}: unknown tier "${tier}" (use one of ${TIER_IDS.join(', ')})`);
    }
    for (const entry of list ?? []) {
      const [display, ...aliases] = entry.split('|').map((s) => s.trim()).filter(Boolean);
      if (!display) throw new Error(`${source}: empty answer in tier "${tier}"`);
      answers.push({ key: normalize(display, ignoreWords), display, aliases, tier });
    }
  }

  return {
    id: file.id,
    pack,
    prompt: file.prompt,
    timeLimit: file.timeLimit ?? DEFAULT_TIME_LIMIT,
    ignoreWords,
    matchSurname: file.matchSurname ?? false,
    exactOnly: file.exactOnly ?? false,
    answers,
  };
}

/** Builds packs from a path -> module map, e.g. the result of import.meta.glob. */
export function buildPacks(modules: Record<string, unknown>): Pack[] {
  const packs = new Map<string, Pack>();
  const getPack = (id: string) => {
    if (!packs.has(id)) packs.set(id, { id, name: id, color: '#5fb7e8', daily: true, categories: [] });
    return packs.get(id)!;
  };

  for (const [path, mod] of Object.entries(modules)) {
    const m = path.match(/categories\/([^/]+)\/([^/]+)\.json$/);
    if (!m) continue;
    const [, packId, fileName] = m;
    const data = ((mod as { default?: unknown }).default ?? mod) as CategoryFile | PackFile;
    const pack = getPack(packId);
    if (fileName === '_pack') {
      const p = data as PackFile;
      pack.name = p.name ?? packId;
      pack.color = p.color ?? pack.color;
      pack.daily = p.daily ?? true;
    } else {
      pack.categories.push(parseCategory(data as CategoryFile, packId, path));
    }
  }

  return [...packs.values()]
    .filter((p) => p.categories.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}

const modules = import.meta.glob('/categories/*/*.json', { eager: true });
export const PACKS: Pack[] = buildPacks(modules);
export const ALL_CATEGORIES: Category[] = PACKS.flatMap((p) => p.categories);
export const packById = (id: string) => PACKS.find((p) => p.id === id);
