// Re-tiers every category by real-world popularity (Wikipedia pageviews over the last 60 days),
// optionally expanding the answer list from Wikidata first.
//
//   npm run rank-answers                 # all categories with a "ranking" block
//   npm run rank-answers -- cocktails    # just one (by id)
//
// Quotas per category (N = answers):
//   Absolute Zero: 1 (N < 40) or 2 — the least-viewed answers
//   Slush: the 20% most viewed, between 2 and 15
//   the rest: 25% Snowflake, 30% Icefrost, 45% Brain Freeze
//
// Lookups are cached in scripts/.cache so re-runs are fast (delete it to refresh the numbers).

import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalize } from '../src/core/normalize.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const CAT_DIR = join(ROOT, 'categories');
const CACHE_DIR = join(ROOT, 'scripts', '.cache');
const CACHE_FILE = join(CACHE_DIR, 'pageviews.json');
const UA = `SnowballEffectGame/0.1 (${process.env.WIKI_CONTACT ?? 'local trivia game data build'})`;

const TIERS = ['slush', 'snowflake', 'icefrost', 'brainfreeze', 'absolutezero'] as const;
type Tier = (typeof TIERS)[number];

interface Ranking {
  /** Which Wikipedia's pageviews count (default "en"; Polish topics use "pl"). */
  wiki?: string;
  /** Disambiguation hints tried first: "Name (hint)". */
  hints?: string[];
  /** Title template, {name} or {lower}. */
  title?: string;
  /** Explicit display → article title. */
  titles?: Record<string, string>;
  /** Wikidata WHERE clause binding ?item — expands the answer list. */
  wikidata?: string;
  /** Keep at most this many answers (by pageviews). */
  max?: number;
  /** Don't fetch anything; rank by the file's current order. */
  manual?: boolean;
  /**
   * Regex (case-insensitive) the article's short description must match when we fall back to the
   * bare answer name — stops "Saturn" (cocktail) from borrowing the planet's pageviews.
   */
  expect?: string;
  /** Regex (case-insensitive): drop answers whose article description matches, e.g. "extinct|fossil". */
  reject?: string;
  /**
   * How much the hand-curated tier counts vs. pageviews (0..1, default 0.5). Pageviews follow the news
   * (Kazakhstan out-trends Italy), so curated answers are ranked half by data, half by judgement.
   * Answers that only came from Wikidata are ranked by pageviews alone.
   */
  blend?: number;
  /** Answers that must never end up as Absolute Zero (e.g. a team you want to be findable). */
  notRarest?: string[];
}

type Tiered = Partial<Record<Tier, string[]>>;

interface CategoryFile {
  id: string;
  prompt: string;
  /** Curated answers. Wikidata additions are merged on top each run. */
  handpicked?: Tiered;
  /** Generated, ranked answers — what the game plays with. */
  answers: Tiered;
  ranking?: Ranking;
  [k: string]: unknown;
}

interface Entry {
  display: string;
  aliases: string[];
  manualTier: Tier;
  order: number;
  pinned: boolean;
  /** Added from Wikidata (dropped again if we can't confirm its article). */
  fromWikidata?: boolean;
  title?: string;
  views?: number;
  /** 0 = most common … 1 = rarest. */
  score?: number;
  sitelinks?: number;
}

// ---------- http helpers ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Wikimedia asks unauthenticated clients to go slowly; one request at a time with a gap,
// honouring Retry-After. Set WIKI_CONTACT (your email or URL) to identify yourself politely.
let lastRequest = 0;
async function getJson(url: string, tries = 6): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const wait = lastRequest + (process.env.WIKI_CONTACT ? 350 : 1500) - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) {
      const retry = Number(res.headers.get('retry-after')) || 10 * (i + 1);
      console.log(`  (rate limited, waiting ${retry}s)`);
      await sleep(retry * 1000);
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`gave up: ${url}`);
}

// ---------- article lookup + pageviews (cached) ----------

interface Lookup {
  title: string;
  views: number;
  description: string;
}

mkdirSync(CACHE_DIR, { recursive: true });
const cache: Record<string, Lookup | null> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};
const saveCache = () => writeFileSync(CACHE_FILE, JSON.stringify(cache));

/**
 * For each candidate title: follows redirects, skips missing/disambiguation pages, and sums the
 * article's pageviews over the last 60 days. 50 titles per request (MediaWiki action API).
 */
async function lookupTitles(wiki: string, titles: string[]): Promise<Map<string, Lookup | null>> {
  const out = new Map<string, Lookup | null>();
  const todo = [...new Set(titles)].filter((t) => {
    const hit = cache[`${wiki}|${t}`];
    if (hit !== undefined) out.set(t, hit);
    return hit === undefined;
  });
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const norm = new Map<string, string>();
    const redir = new Map<string, string>();
    const pages = new Map<string, { missing: boolean; disambig: boolean; views: number; description: string }>();
    let cont: Record<string, string> = {};
    for (let guard = 0; guard < 20; guard++) {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        redirects: '1',
        prop: 'pageprops|pageviews|description',
        ppprop: 'disambiguation',
        pvipdays: '60',
        titles: batch.join('|'),
        ...cont,
      });
      const j = await getJson(`https://${wiki}.wikipedia.org/w/api.php?${params}`);
      for (const n of j?.query?.normalized ?? []) norm.set(n.from, n.to);
      for (const r of j?.query?.redirects ?? []) redir.set(r.from, r.to);
      for (const p of Object.values<any>(j?.query?.pages ?? {})) {
        const prev = pages.get(p.title) ?? { missing: false, disambig: false, views: 0, description: '' };
        if (p.description) prev.description = p.description;
        prev.missing ||= 'missing' in p || 'invalid' in p;
        prev.disambig ||= !!p.pageprops && 'disambiguation' in p.pageprops;
        if (p.pageviews) prev.views = Math.max(prev.views, Object.values<number | null>(p.pageviews).reduce<number>((n, v) => n + (v ?? 0), 0));
        pages.set(p.title, prev);
      }
      if (!j?.continue) break;
      cont = j.continue;
    }
    for (const t of batch) {
      let cur = norm.get(t) ?? t;
      cur = (redir.get(cur) ?? cur).split('#')[0];
      const p = pages.get(cur);
      const res = p && !p.missing && !p.disambig ? { title: cur, views: p.views, description: p.description } : null;
      cache[`${wiki}|${t}`] = res;
      out.set(t, res);
    }
    saveCache();
    process.stdout.write(`  looked up ${Math.min(i + 50, todo.length)}/${todo.length} titles\r`);
  }
  if (todo.length) process.stdout.write('\n');
  return out;
}

// ---------- wikidata expansion ----------

interface WdItem {
  label: string;
  aliases: string[];
  title: string;
  /** How many Wikipedias have an article — a stable, global notability signal. */
  sitelinks: number;
}

async function wikidata(where: string, lang: string): Promise<WdItem[]> {
  const q = `
    SELECT ?item ?label ?title ?links (GROUP_CONCAT(DISTINCT ?alias; separator="\\u001f") AS ?aliases) WHERE {
      ${where}
      ?item wikibase:sitelinks ?links .
      ?article schema:about ?item ; schema:isPartOf <https://${lang}.wikipedia.org/> ; schema:name ?title .
      ?item rdfs:label ?label . FILTER(LANG(?label) = "${lang}")
      OPTIONAL { ?item skos:altLabel ?alias . FILTER(LANG(?alias) = "${lang}") }
    } GROUP BY ?item ?label ?title ?links`;
  const j = await getJson('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q));
  return (j?.results?.bindings ?? []).map((b: any) => ({
    label: b.label.value,
    title: b.title.value,
    sitelinks: Number(b.links?.value ?? 0),
    aliases: b.aliases?.value ? b.aliases.value.split('\u001f') : [],
  }));
}

// ---------- tiering ----------

function quotas(n: number): Record<Tier, number> {
  const absolutezero = n >= 40 ? 2 : 1;
  const slush = Math.max(2, Math.min(15, Math.round(n * 0.2)));
  const rest = Math.max(0, n - absolutezero - slush);
  const snowflake = Math.round(rest * 0.25);
  const icefrost = Math.round(rest * 0.3);
  return { slush, snowflake, icefrost, brainfreeze: rest - snowflake - icefrost, absolutezero };
}

/** "Hanky-Panky (cocktail)" → "Hanky-Panky". */
const stripParens = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim();

/** Wikidata labels we never want as answers: provisional designations, seasons, events. */
const badLabel = (s: string) => !s || /^Q\d+$/.test(s) || s.includes('/') || /\b(1[5-9]|20)\d\d\b/.test(s);

/**
 * Wikidata aliases are crowd-edited and sometimes vandalised ("drinks", "drinl"). Keep reasonable
 * lengths and drop lowercase single words unless the whole category is lowercase (shell commands).
 */
const goodAlias = (a: string, lowercaseOk: boolean) =>
  a.length >= 3 && a.length <= 48 && !/[:/]/.test(a) && (lowercaseOk || !/^[a-z][a-z-]*$/.test(a));

function formatTier(items: string[]): string {
  if (!items.length) return '[]';
  const lines: string[] = [];
  let line = '';
  for (const it of items.map((s) => JSON.stringify(s))) {
    if (line && line.length + it.length + 2 > 96) {
      lines.push(line);
      line = '';
    }
    line += (line ? ', ' : '') + it;
  }
  lines.push(line);
  return `[\n      ${lines.join(',\n      ')}\n    ]`;
}

const formatTiers = (t: Tiered, indent = '  ') =>
  `{\n${TIERS.filter((k) => t[k]?.length)
    .map((k) => `${indent}  "${k}": ${formatTier(t[k]!)}`)
    .join(',\n')}\n${indent}}`;

function serialize(file: CategoryFile): string {
  const { answers, handpicked, ...rest } = file;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  const hp = handpicked ? `,\n  "handpicked": ${formatTiers(handpicked)}` : '';
  return `${head}${hp},\n  "answers": ${formatTiers(answers)}\n}\n`;
}

// ---------- main ----------

interface Candidate {
  title: string;
  /** "trusted": hint/template/explicit titles. "wikidata": the item's own article. "bare": just the name. */
  kind: 'trusted' | 'wikidata' | 'bare';
}

interface Prepared {
  path: string;
  file: CategoryFile;
  cfg: Ranking;
  wiki: string;
  key: (s: string) => string;
  /** Curated answers, before Wikidata expansion — saved back as `handpicked`. */
  base: Entry[];
  entries: Entry[];
  candidates: Map<Entry, Candidate[]>;
  expect: RegExp | null;
  reject: RegExp | null;
}

function readTiered(t: Tiered, start = 0): Entry[] {
  const out: Entry[] = [];
  let order = start;
  for (const tier of TIERS) {
    for (const raw of t[tier] ?? []) {
      const [display, ...aliases] = raw.split('|').map((s) => s.trim());
      out.push({ display, aliases, manualTier: tier, order: order++, pinned: false });
    }
  }
  return out;
}

/** Reads a category, expands it from Wikidata, and lists the article titles to try per answer. */
async function prepare(path: string): Promise<Prepared | null> {
  const file = JSON.parse(readFileSync(path, 'utf8')) as CategoryFile;
  const cfg = file.ranking;
  if (!cfg) return null;
  const wiki = cfg.wiki ?? 'en';
  const ignore = (file.ignoreWords as string[] | undefined) ?? [];
  const key = (s: string) => normalize(s, ignore);
  const lowercaseOk = !!file.exactOnly;

  let base = readTiered(file.handpicked ?? file.answers);
  const candidates = new Map<Entry, Candidate[]>();
  let entries = base;

  if (!cfg.manual && cfg.wikidata) {
    const raw = await wikidata(cfg.wikidata, wiki);
    // First run (no `handpicked` yet): answers still contain last run's Wikidata additions — strip them
    // so only the curated answers become `handpicked`.
    if (!file.handpicked) {
      const wdKeys = new Set(raw.map((it) => key(it.label)));
      base = base
        .filter((e) => e.pinned || !wdKeys.has(key(e.display)))
        .map((e) => ({ ...e, aliases: e.aliases.filter((a) => goodAlias(a, lowercaseOk)) }));
    }
    entries = base.map((e) => ({ ...e, aliases: [...e.aliases] }));
    const byKey = new Map<string, Entry>();
    for (const e of entries) for (const n of [e.display, ...e.aliases]) byKey.set(key(n), e);
    let order = entries.length;
    let added = 0;
    for (const it of raw) {
      const label = stripParens(it.label);
      if (badLabel(label)) continue;
      const aliases = it.aliases.map(stripParens).filter((a) => !badLabel(a) && goodAlias(a, lowercaseOk));
      const names = [label, ...aliases];
      const hit = names.map((n) => byKey.get(key(n))).find(Boolean);
      if (hit) {
        hit.title ??= it.title;
        hit.sitelinks = Math.max(hit.sitelinks ?? 0, it.sitelinks);
        for (const a of names) if (!byKey.has(key(a))) hit.aliases.push(a), byKey.set(key(a), hit);
      } else {
        const display = lowercaseOk || !/^[a-z]/.test(label) ? label : label[0].toUpperCase() + label.slice(1);
        const e: Entry = { display, aliases: [], manualTier: 'brainfreeze', order: order++, pinned: false, fromWikidata: true, title: it.title, sitelinks: it.sitelinks };
        for (const a of aliases) if (!byKey.has(key(a)) && key(a) !== key(label)) e.aliases.push(a);
        byKey.set(key(label), e);
        for (const a of e.aliases) byKey.set(key(a), e);
        entries.push(e);
        added++;
      }
    }
    console.log(`${file.id}: wikidata ${raw.length} items, ${added} new answers`);
  }

  if (!cfg.manual) {
    for (const e of entries) {
      const c: Candidate[] = [];
      if (e.title) c.push({ title: e.title, kind: 'wikidata' });
      if (cfg.titles?.[e.display]) c.push({ title: cfg.titles[e.display], kind: 'trusted' });
      if (cfg.title) c.push({ title: cfg.title.replace('{name}', e.display).replace('{lower}', e.display.toLowerCase()), kind: 'trusted' });
      for (const h of cfg.hints ?? []) c.push({ title: `${e.display} ${h}`, kind: 'trusted' });
      c.push({ title: e.display, kind: 'bare' });
      for (const a of e.aliases.slice(0, 2)) c.push({ title: a, kind: 'bare' });
      candidates.set(e, c);
      e.title = undefined;
      e.views = undefined;
    }
  }
  return {
    path,
    file,
    cfg,
    wiki,
    key,
    base,
    entries,
    candidates,
    expect: cfg.expect ? new RegExp(cfg.expect, 'i') : null,
    reject: cfg.reject ? new RegExp(cfg.reject, 'i') : null,
  };
}

/** Does this article plausibly belong to the category? */
function fits(p: Prepared, c: Candidate, description: string): boolean {
  if (p.reject && description && p.reject.test(description)) return false;
  if (!p.expect || c.kind === 'trusted') return true;
  if (c.kind === 'wikidata') return !description || p.expect.test(description);
  return p.expect.test(description);
}

/**
 * Finds every answer's article and pageviews. Candidates are tried round by round, and each round is
 * pooled across ALL categories (50 titles per request), which matters a lot under Wikimedia's rate limits.
 */
async function resolveAll(preps: Prepared[]): Promise<void> {
  for (let round = 0; round < 8; round++) {
    for (const wiki of new Set(preps.map((p) => p.wiki))) {
      const pending: [Prepared, Entry, Candidate][] = [];
      for (const p of preps) {
        if (p.wiki !== wiki) continue;
        for (const [e, c] of p.candidates) if (e.title === undefined && c[round]) pending.push([p, e, c[round]]);
      }
      if (!pending.length) continue;
      console.log(`round ${round + 1} (${wiki}): ${pending.length} answers to look up`);
      const found = await lookupTitles(wiki, pending.map(([, , c]) => c.title));
      for (const [p, e, c] of pending) {
        const hit = found.get(c.title);
        if (!hit || !fits(p, c, hit.description)) continue;
        e.title = hit.title;
        e.views = hit.views;
      }
    }
  }
  for (const p of preps) {
    // Wikidata additions we couldn't confirm (wrong kind of article, extinct, etc.) are dropped.
    p.entries = p.entries.filter((e) => !e.fromWikidata || e.title);
    // Answers that land on the same article (e.g. all HTTP codes → one list page) can't be told apart.
    const counts = new Map<string, number>();
    for (const e of p.entries) if (e.title) counts.set(e.title, (counts.get(e.title) ?? 0) + 1);
    for (const e of p.entries) {
      if (e.title && counts.get(e.title)! > 1) {
        e.title = undefined;
        e.views = undefined;
      }
    }
  }
}

/** Sorts by popularity, applies the tier quotas and writes the file back. */
function finish({ path, file, cfg, wiki, key, entries, base }: Prepared): void {
  const resolvedShare = entries.filter((e) => e.views !== undefined).length / entries.length;
  const useViews = !cfg.manual && resolvedShare >= 0.6;

  // Score = average of the signals we have, each as a 0 (most common) … 1 (rarest) percentile:
  //  - pageviews (what people look up right now),
  //  - sitelinks (how many Wikipedias cover it — stable, dampens news spikes),
  //  - the hand-picked tier, placed in the middle of that tier's band for THIS category's quotas.
  if (useViews) {
    const w = cfg.blend ?? 0.5;
    const pctOf = (xs: Entry[], val: (e: Entry) => number) => {
      const sorted = [...xs].sort((x, y) => val(y) - val(x));
      return new Map(sorted.map((e, i) => [e, sorted.length > 1 ? i / (sorted.length - 1) : 0]));
    };
    const viewPct = pctOf(entries.filter((e) => e.views !== undefined), (e) => e.views!);
    const linkPct = pctOf(entries.filter((e) => e.sitelinks !== undefined), (e) => e.sitelinks!);
    const n = entries.filter((e) => !e.pinned).length;
    const q = quotas(Math.min(n, cfg.max ?? n));
    const bands: [Tier, number][] = [['slush', q.slush], ['snowflake', q.snowflake], ['icefrost', q.icefrost], ['brainfreeze', q.brainfreeze], ['absolutezero', q.absolutezero]];
    const prior = new Map<Tier, number>();
    let start = 0;
    const total = bands.reduce((s2, [, c]) => s2 + c, 0) || 1;
    for (const [t, c] of bands) {
      prior.set(t, (start + c / 2) / total);
      start += c;
    }
    for (const e of entries) {
      const data = [viewPct.get(e), linkPct.get(e)].filter((x): x is number => x !== undefined);
      const dataScore = data.length ? data.reduce((a2, b2) => a2 + b2, 0) / data.length : undefined;
      const p = e.fromWikidata ? undefined : prior.get(e.manualTier);
      e.score = dataScore === undefined ? (p ?? 0.8) : p === undefined ? dataScore : (1 - w) * dataScore + w * p;
    }
  }

  // Drop duplicate answers (same normalized name), keeping the more popular one.
  const sortKey = (e: Entry) => (useViews ? e.score! : e.order);
  entries.sort((a, b) => sortKey(a) - sortKey(b) || a.order - b.order);
  const seen = new Set<string>();
  const kept: Entry[] = [];
  for (const e of entries) {
    const k = key(e.display);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    e.aliases = [...new Set(e.aliases)].filter((a) => {
      const ak = key(a);
      if (!ak || seen.has(ak)) return false;
      seen.add(ak);
      return true;
    });
    kept.push(e);
  }

  let ranked = kept.filter((e) => !e.pinned);
  if (cfg.max && ranked.length > cfg.max) ranked = ranked.slice(0, cfg.max);
  const q = quotas(ranked.length);
  // Swap protected answers out of the Absolute Zero slots with the next rarest unprotected ones.
  if (cfg.notRarest?.length) {
    const keep = new Set(cfg.notRarest.map(key));
    const azStart = ranked.length - q.absolutezero;
    for (let i = azStart; i < ranked.length; i++) {
      if (!keep.has(key(ranked[i].display))) continue;
      for (let j = azStart - 1; j >= 0; j--) {
        if (!keep.has(key(ranked[j].display))) {
          [ranked[i], ranked[j]] = [ranked[j], ranked[i]];
          break;
        }
      }
    }
  }
  const out: Tiered = {};
  const push = (t: Tier, e: Entry) => (out[t] ??= []).push([e.display, ...e.aliases].join('|'));
  let i = 0;
  for (const t of TIERS) {
    for (let n = 0; n < q[t]; n++, i++) push(t, ranked[i]);
  }
  const pins = kept.filter((e) => e.pinned);

  // Wikidata-expanded categories keep the curated list separately, so re-runs start from it.
  if (cfg.wikidata && !cfg.manual) {
    const hp: Tiered = {};
    for (const e of base) (hp[e.manualTier] ??= []).push([e.display, ...e.aliases].join('|'));
    file.handpicked = hp;
  }
  file.answers = out;
  file.ranked = {
    by: useViews ? `${wiki}.wikipedia pageviews, 60 days to ${new Date().toISOString().slice(0, 10)}` : 'hand-picked order',
    answers: ranked.length + pins.length,
    ...(useViews ? { coverage: `${Math.round(resolvedShare * 100)}%` } : {}),
  };
  writeFileSync(path, serialize(file));
  const az = out.absolutezero?.map((s) => s.split('|')[0]).join(', ');
  console.log(`${file.id}: ${ranked.length + pins.length} answers · coverage ${Math.round(resolvedShare * 100)}% · absolute zero: ${az}`);
}

const only = process.argv[2];
const preps: Prepared[] = [];
for (const pack of readdirSync(CAT_DIR)) {
  for (const f of readdirSync(join(CAT_DIR, pack))) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const path = join(CAT_DIR, pack, f);
    const id = JSON.parse(readFileSync(path, 'utf8')).id;
    if (only && id !== only) continue;
    try {
      const p = await prepare(path);
      if (p) preps.push(p);
    } catch (e) {
      console.log(`${id}: FAILED to prepare: ${(e as Error).message}`);
    }
  }
}
await resolveAll(preps);
for (const p of preps) {
  try {
    finish(p);
  } catch (e) {
    console.log(`${p.file.id}: FAILED: ${(e as Error).message}`);
  }
}
console.log('done');
