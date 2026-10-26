// Admin dashboard: logs in with a Supabase Auth user (listed in private.admins) and renders the
// numbers from public.admin_overview(). No dependencies — plain fetch against Supabase's REST APIs.

import './admin.css';
import { TIERS, isTierId } from '../core/tiers';

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const TOKEN_KEY = 'snowball:admin-token';

const root = document.getElementById('admin')!;
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (n: unknown) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en'));
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const secs = (ms: unknown) => (ms === null || ms === undefined ? '—' : `${(Number(ms) / 1000).toFixed(1)} s`);
const dur = (s: unknown) => {
  if (s === null || s === undefined) return '—';
  const v = Number(s);
  return v < 60 ? `${Math.round(v)} s` : `${Math.floor(v / 60)} min ${Math.round(v % 60)} s`;
};
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function token(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function setToken(t: string | null): void {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- screens ----------

function notConfigured(): void {
  root.innerHTML = `
    <section class="box narrow">
      <h1>SNOWBALL ADMIN</h1>
      <p>This build has no Supabase connection yet.</p>
      <p class="muted">Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>supabase/README.md</code>) and rebuild.</p>
    </section>`;
}

function login(message = ''): void {
  root.innerHTML = `
    <section class="box narrow">
      <h1>SNOWBALL ADMIN</h1>
      <form id="login" class="stack">
        <label>Email <input name="email" type="email" autocomplete="username" required /></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
        <button class="btn" type="submit">LOG IN</button>
        <p class="error">${esc(message)}</p>
      </form>
    </section>`;
  const form = document.getElementById('login') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SB_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) return login(body.error_description || body.msg || 'Login failed');
    setToken(body.access_token);
    void dashboard();
  });
}

let days = 30;
let includeTest = false;

async function dashboard(): Promise<void> {
  root.innerHTML = `<section class="box narrow"><p>Loading…</p></section>`;
  const res = await fetch(`${SB_URL}/rest/v1/rpc/admin_overview`, {
    method: 'POST',
    headers: { apikey: SB_KEY!, Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ days, include_test: includeTest }),
  });
  if (res.status === 401 || res.status === 403) {
    setToken(null);
    return login('Session expired — please log in again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const msg = data?.message ?? `Error ${res.status}`;
    if (/not an admin/i.test(msg)) {
      setToken(null);
      return login('This account is not in private.admins.');
    }
    root.innerHTML = `<section class="box narrow"><p class="error">${esc(msg)}</p></section>`;
    return;
  }
  render(data);
}

// ---------- suggestions ----------

interface Suggestion {
  id: number;
  category: string;
  input: string;
  times: number;
  players: number;
  firstSeen: string;
  lastSeen: string;
  status: string;
}

const isDemo = () => new URLSearchParams(location.search).has('demo');

async function rpc(name: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SB_KEY!, Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json();
}

async function loadSuggestions(): Promise<void> {
  const box = document.getElementById('sugg-box');
  if (!box) return;
  let list: Suggestion[];
  try {
    list = isDemo()
      ? [
          { id: 1, category: 'football-clubs-b', input: 'Werder Bremen', times: 14, players: 11, firstSeen: '', lastSeen: new Date().toISOString(), status: 'pending' },
          { id: 2, category: 'oil-types', input: 'Snake oil', times: 6, players: 6, firstSeen: '', lastSeen: new Date().toISOString(), status: 'pending' },
          { id: 3, category: 'csgo-pros', input: 'donk', times: 5, players: 4, firstSeen: '', lastSeen: new Date().toISOString(), status: 'pending' },
        ]
      : ((await rpc('admin_suggestions', { only_status: 'pending' })) as Suggestion[]);
  } catch (e) {
    box.innerHTML = `<h2>Suggestions</h2><p class="error">${esc(String(e))} — re-run supabase/schema.sql?</p>`;
    return;
  }
  const render = () => {
    box.innerHTML = `
      <div class="top"><h2>Suggestions · ${list.length} pending</h2>
        <button class="btn small" id="sugg-dl" ${list.length ? '' : 'disabled'}>DOWNLOAD JSON</button></div>
      <p class="muted">Answers players asked to add ("suggest it" after a wrong guess), most-requested first. Duplicates are merged.</p>
      ${table(
        ['category', 'suggestion', 'players', 'times', 'last', ''],
        list.map((x) => [
          esc(x.category),
          `<b>${esc(x.input)}</b>`,
          num(x.players),
          num(x.times),
          x.lastSeen ? esc(when(x.lastSeen)) : '—',
          `<button class="btn small" data-act="added" data-id="${x.id}">ADD</button> <button class="btn small ghost" data-act="rejected" data-id="${x.id}">REJECT</button>`,
        ]),
      )}`;
    document.getElementById('sugg-dl')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `snowball-suggestions-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    box.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = Number(b.dataset.id);
        try {
          if (!isDemo()) await rpc('admin_set_suggestions', { ids: [id], new_status: b.dataset.act });
          list = list.filter((x) => x.id !== id);
          render();
        } catch (e) {
          alert(String(e));
        }
      }),
    );
  };
  render();
}

// ---------- rendering ----------

interface Overview {
  since: string;
  totals: Record<string, number | null>;
  perDay: { day: string; visits: number; uniqueVisitors: number; players: number; rollsStarted: number; rollsFinished: number; dailyFinished: number; avgPoints: number | null }[];
  modes: { mode: string; started: number; finished: number }[];
  tiers: { tier: string; count: number }[];
  devices: { device: string; count: number }[];
  countries: { country: string; count: number }[];
  categories: { category: string; plays: number; avgPoints: number; timeoutRate: number; avgMs: number | null; wrongGuesses: number }[];
  topWrongGuesses: { category: string; guess: string; count: number }[];
  topAnswers: { category: string; answer: string; tier: string; count: number }[];
  unlocks: { skin: string; count: number }[];
  recentPlayers: { name: string | null; avatar: string; firstSeen: string; lastSeen: string; rolls: number; best: number | null; streak: number | null }[];
}

function card(label: string, value: string, sub = ''): string {
  return `<div class="card"><b>${value}</b><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
}

function bars(rows: { label: string; value: number; color?: string }[], unit = ''): string {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="bars">${rows
    .map(
      (r) => `<div class="bar-row"><span class="bar-label">${esc(r.label)}</span>
        <span class="bar"><i style="width:${(100 * r.value) / max}%;${r.color ? `background:${r.color}` : ''}"></i></span>
        <span class="bar-val">${num(r.value)}${unit}</span></div>`,
    )
    .join('')}</div>`;
}

/** Per-day column chart (two series side by side). */
function dayChart(perDay: Overview['perDay']): string {
  if (!perDay.length) return '<p class="muted">No days yet.</p>';
  const W = 760;
  const H = 180;
  const max = Math.max(1, ...perDay.map((d) => Math.max(d.visits, d.uniqueVisitors, d.rollsFinished)));
  const bw = W / perDay.length;
  const col = (v: number, i: number, k: number, color: string) => {
    const h = Math.round((v / max) * (H - 20));
    const w = Math.max(1, bw / 3 - 1);
    return `<rect x="${(i * bw + k * (bw / 3)).toFixed(1)}" y="${H - h}" width="${w.toFixed(1)}" height="${h}" fill="${color}"><title>${v}</title></rect>`;
  };
  const labels = perDay
    .map((d, i) => (perDay.length <= 14 || i % Math.ceil(perDay.length / 10) === 0 ? `<text x="${(i * bw + 2).toFixed(1)}" y="${H + 14}">${d.day.slice(5)}</text>` : ''))
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H + 20}" preserveAspectRatio="none">
      ${perDay.map((d, i) => col(d.visits, i, 0, '#ff9b29') + col(d.uniqueVisitors, i, 1, '#8fe3f0') + col(d.rollsFinished, i, 2, '#e0d4ff')).join('')}
      ${labels}
    </svg>
    <p class="legend"><i style="background:#ff9b29"></i>visits <i style="background:#8fe3f0"></i>unique visitors <i style="background:#e0d4ff"></i>rolls finished</p>`;
}

function table(head: string[], rows: string[][]): string {
  if (!rows.length) return '<p class="muted">Nothing yet.</p>';
  return `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

function render(d: Overview): void {
  const t = d.totals;
  const started = Number(t.rollsStarted ?? 0);
  const finished = Number(t.rollsFinished ?? 0);
  const answers = Number(t.answers ?? 0);
  const timeouts = Number(t.timeouts ?? 0);
  const tierColor = (id: string) => (isTierId(id) ? TIERS[id].color : '#666');
  const tierLabel = (id: string) => (isTierId(id) ? TIERS[id].label : id === 'timeout' ? "Time's up" : id);

  root.innerHTML = `
    <header class="top">
      <h1>SNOWBALL ADMIN</h1>
      <div class="controls">
        <select id="days">${[1, 7, 30, 90, 365].map((n) => `<option value="${n}" ${n === days ? 'selected' : ''}>last ${n} day${n > 1 ? 's' : ''}</option>`).join('')}</select>
        <label><input type="checkbox" id="test" ${includeTest ? 'checked' : ''}/> include test traffic</label>
        <button class="btn small" id="refresh">REFRESH</button>
        <button class="btn small ghost" id="logout">LOG OUT</button>
      </div>
    </header>
    <p class="muted">Since ${esc(when(d.since))}. Unique visitors use a salted IP hash that changes every day, so they are counted per day.</p>

    <section class="cards">
      ${card('visits', num(t.visits))}
      ${card('unique visitor-days', num(t.uniqueVisitorDays))}
      ${card('players active', num(t.players), `${num(t.newPlayers)} new · ${num(t.allTimePlayers)} all-time`)}
      ${card('rolls finished', num(finished), `${num(started)} started · ${pct(finished, started)} finish`)}
      ${card('daily rolls finished', num(t.dailyRollsFinished))}
      ${card('average score', t.avgPoints === null ? '—' : `${num(t.avgPoints)} m`)}
      ${card('perfect rolls', num(t.perfectRolls))}
      ${card('answers', num(answers), `${num(timeouts)} timeouts · ${pct(timeouts, answers + timeouts)}`)}
      ${card('avg answer time', secs(t.avgAnswerMs))}
      ${card('wrong guesses', num(t.wrongGuesses))}
      ${card('avg session', dur(t.avgSessionSec))}
    </section>

    <section class="box" id="sugg-box"><h2>Suggestions</h2><p class="muted">Loading…</p></section>

    <section class="box"><h2>Per day</h2>${dayChart(d.perDay)}</section>

    <div class="grid">
      <section class="box"><h2>Tiers</h2>${bars(d.tiers.map((x) => ({ label: tierLabel(x.tier), value: x.count, color: tierColor(x.tier) })))}</section>
      <section class="box"><h2>Modes</h2>${table(['mode', 'started', 'finished', 'finish rate'], d.modes.map((m) => [esc(m.mode), num(m.started), num(m.finished), pct(m.finished, m.started)]))}</section>
      <section class="box"><h2>Devices</h2>${bars(d.devices.map((x) => ({ label: x.device, value: x.count })))}</section>
      <section class="box"><h2>Countries</h2>${bars(d.countries.map((x) => ({ label: x.country, value: x.count })))}</section>
    </div>

    <section class="box"><h2>Categories</h2>${table(
      ['category', 'plays', 'avg m', 'timeouts', 'avg time', 'wrong guesses'],
      d.categories.map((c) => [esc(c.category), num(c.plays), num(c.avgPoints), `${c.timeoutRate}%`, secs(c.avgMs), num(c.wrongGuesses)]),
    )}</section>

    <div class="grid">
      <section class="box"><h2>Most common wrong guesses</h2><p class="muted">Candidates for new answers.</p>${table(
        ['category', 'guess', 'times'],
        d.topWrongGuesses.map((w) => [esc(w.category), `<b>${esc(w.guess)}</b>`, num(w.count)]),
      )}</section>
      <section class="box"><h2>Most given answers</h2>${table(
        ['category', 'answer', 'tier', 'times'],
        d.topAnswers.map((a) => [esc(a.category), esc(a.answer), `<span class="tier" style="--tier:${tierColor(a.tier)}">${esc(tierLabel(a.tier))}</span>`, num(a.count)]),
      )}</section>
    </div>

    <div class="grid">
      <section class="box"><h2>Snowmen unlocked</h2>${bars(d.unlocks.map((u) => ({ label: u.skin, value: u.count })))}</section>
      <section class="box"><h2>Recent players</h2>${table(
        ['name', 'snowman', 'rolls', 'best', 'streak', 'last seen'],
        d.recentPlayers.map((p) => [esc(p.name || 'Nameless snowman'), esc(p.avatar), num(p.rolls), p.best === null ? '—' : `${num(p.best)} m`, num(p.streak), esc(when(p.lastSeen))]),
      )}</section>
    </div>`;

  document.getElementById('days')!.addEventListener('change', (e) => {
    days = Number((e.target as HTMLSelectElement).value);
    void dashboard();
  });
  document.getElementById('test')!.addEventListener('change', (e) => {
    includeTest = (e.target as HTMLInputElement).checked;
    void dashboard();
  });
  document.getElementById('refresh')!.addEventListener('click', () => void dashboard());
  void loadSuggestions();
  document.getElementById('logout')!.addEventListener('click', () => {
    setToken(null);
    login();
  });
}

/** `admin.html?demo`: made-up numbers, to preview the dashboard without a database. */
function demo(): Overview {
  const r = (a: number, b: number) => Math.round(a + Math.random() * (b - a));
  const perDay = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10);
    const visits = r(20, 140);
    return { day: d, visits, uniqueVisitors: Math.round(visits * 0.7), players: Math.round(visits * 0.6), rollsStarted: r(10, 90), rollsFinished: r(8, 70), dailyFinished: r(5, 50), avgPoints: r(180, 420) };
  });
  const cats = ['capitals-a', 'football-clubs-b', 'movies', 'oil-types', 'gk-poland', 'cocktails', 'mathematicians', 'csgo-pros'];
  return {
    since: new Date(Date.now() - 30 * 864e5).toISOString(),
    totals: { visits: 2480, uniqueVisitorDays: 1730, players: 690, newPlayers: 410, allTimePlayers: 1210, rollsStarted: 1320, rollsFinished: 1040, dailyRollsFinished: 780, avgPoints: 312, perfectRolls: 2, answers: 7020, timeouts: 860, avgAnswerMs: 9400, wrongGuesses: 5120, avgSessionSec: 412 },
    perDay,
    modes: [{ mode: 'daily', started: 980, finished: 790 }, { mode: 'custom', started: 260, finished: 190 }, { mode: 'archive', started: 80, finished: 60 }],
    tiers: [{ tier: 'slush', count: 2900 }, { tier: 'snowflake', count: 1800 }, { tier: 'icefrost', count: 1200 }, { tier: 'brainfreeze', count: 980 }, { tier: 'timeout', count: 860 }, { tier: 'absolutezero', count: 140 }],
    devices: [{ device: 'phone', count: 1400 }, { device: 'desktop', count: 960 }, { device: 'tablet', count: 120 }],
    countries: [{ country: 'PL', count: 1100 }, { country: 'DE', count: 640 }, { country: 'US', count: 210 }, { country: 'GB', count: 160 }, { country: 'TW', count: 90 }],
    categories: cats.map((c) => ({ category: c, plays: r(80, 400), avgPoints: r(20, 70), timeoutRate: r(3, 25), avgMs: r(5000, 15000), wrongGuesses: r(40, 300) })),
    topWrongGuesses: [['football-clubs-b', 'bremen', 41], ['oil-types', 'motor', 33], ['capitals-a', 'australia', 29], ['movies', 'the godfather 4', 12]].map(([category, guess, count]) => ({ category: String(category), guess: String(guess), count: Number(count) })),
    topAnswers: [['capitals-a', 'Amsterdam', 'slush', 210], ['movies', 'Titanic', 'slush', 180], ['gk-poland', 'Wojciech Szczęsny', 'slush', 150], ['csgo-pros', 's1mple', 'slush', 120]].map(([category, answer, tier, count]) => ({ category: String(category), answer: String(answer), tier: String(tier), count: Number(count) })),
    unlocks: [{ skin: 'classic', count: 610 }, { skin: 'meh', count: 300 }, { skin: 'winking', count: 280 }, { skin: 'pirate', count: 90 }, { skin: 'icecrown', count: 2 }],
    recentPlayers: [{ name: 'Bartek', avatar: 'icecrown', firstSeen: perDay[0].day, lastSeen: new Date().toISOString(), rolls: 24, best: 700, streak: 9 }, { name: null, avatar: 'buttons', firstSeen: perDay[20].day, lastSeen: new Date().toISOString(), rolls: 3, best: 285, streak: 1 }],
  };
}

if (new URLSearchParams(location.search).has('demo')) render(demo());
else if (!SB_URL || !SB_KEY) notConfigured();
else if (token()) void dashboard();
else login();
