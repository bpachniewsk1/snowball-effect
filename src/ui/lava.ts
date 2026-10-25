// Lava Bucket screens: setup, play (pass-and-play on one device), eruption and the winner.
import { ALL_CATEGORIES, packById } from '../core/categories';
import { TIERS } from '../core/tiers';
import type { Category } from '../core/types';
import { LavaGame, type LavaSettings } from '../game/lava';
import { AVATARS, NAME_MAX, avatarById, isAvatarUnlocked, loadProfile, loadProgress, displayName } from '../game/profile';
import { loadCustomSettings } from '../game/storage';
import { sfx } from '../audio/sfx';
import { LavaBucketView } from '../render/bucket';
import { $, esc, say } from './util';

export interface LavaHost {
  render(html: string): void;
  setEnter(fn: (() => void) | null): void;
  exit(): void;
  editCategories(): void;
}

interface SetupPlayer {
  name: string;
  avatar: string;
}

const PLAYERS_KEY = 'snowball:v1:lava-players';
const SPEEDS: Record<string, Pick<LavaSettings, 'startTime' | 'minTime'>> = {
  chill: { startTime: 16, minTime: 5 },
  normal: { startTime: 12, minTime: 3 },
  spicy: { startTime: 8, minTime: 2 },
};

export class LavaScreen {
  private game: LavaGame | null = null;
  private bucket: LavaBucketView | null = null;
  private clock: number | null = null;
  private players: SetupPlayer[] = [];
  private hearts = 3;
  private speed: keyof typeof SPEEDS = 'normal';

  constructor(private host: LavaHost) {}

  // ---------- setup ----------

  showSetup(): void {
    this.stop();
    if (!this.players.length) this.players = this.loadPlayers();
    const unlocked = AVATARS.filter((a) => isAvatarUnlocked(a, loadProgress()));
    const pool = this.pool();

    const rows = this.players
      .map(
        (p, i) => `
        <div class="lava-setup-row">
          <button type="button" class="avatar-cycle" data-i="${i}" title="Change snowman" data-silent>
            <img src="${avatarById(p.avatar).src}" alt="" width="48" height="48" />
          </button>
          <input type="text" class="lava-name" data-i="${i}" maxlength="${NAME_MAX}" value="${esc(p.name)}" aria-label="Player ${i + 1} name" />
          ${this.players.length > 2 ? `<button type="button" class="link remove" data-i="${i}" aria-label="Remove player">✕</button>` : ''}
        </div>`,
      )
      .join('');

    this.host.render(`
      <div class="stack">
        <h2 class="center">LAVA BUCKET</h2>
        ${say("Pass the boiling bucket! Name an answer nobody has used yet, then it's the next snowman's turn. Every pass makes it boil faster. Holding it when it erupts costs a heart.")}
        <div class="lava-setup">${rows}</div>
        <div class="row center-row">
          ${this.players.length < 8 ? '<button class="menu small" id="add-player">+ ADD PLAYER</button>' : ''}
        </div>
        <div class="row spread">
          <div class="row"><span>Hearts:</span>${[1, 2, 3, 5].map((n) => `<button class="menu small ${n === this.hearts ? 'picked' : ''}" data-hearts="${n}">${n}</button>`).join('')}</div>
          <div class="row"><span>Heat:</span>${Object.keys(SPEEDS).map((k) => `<button class="menu small ${k === this.speed ? 'picked' : ''}" data-speed="${k}">${k.toUpperCase()}</button>`).join('')}</div>
        </div>
        <p class="muted">Categories: your Custom Roll picks (<span class="num">${pool.length}</span> on). <button class="link" id="lava-cats">change</button></p>
        <p class="muted small">Pass-and-play on one device — hand it over when the bucket moves. Online rooms are next.</p>
        <div class="row center-row">
          <button class="menu big" id="lava-go" data-silent ${pool.length ? '' : 'disabled'}>LIGHT IT UP</button>
          <button class="menu" id="lava-back">BACK</button>
        </div>
      </div>`);

    document.querySelectorAll<HTMLButtonElement>('.avatar-cycle').forEach((b) =>
      b.addEventListener('click', () => {
        const p = this.players[Number(b.dataset.i)];
        const at = unlocked.findIndex((a) => a.id === p.avatar);
        p.avatar = unlocked[(at + 1) % unlocked.length].id;
        sfx.squeak();
        this.showSetup();
      }),
    );
    document.querySelectorAll<HTMLInputElement>('.lava-name').forEach((inp) =>
      inp.addEventListener('input', () => (this.players[Number(inp.dataset.i)].name = inp.value)),
    );
    document.querySelectorAll<HTMLButtonElement>('.remove').forEach((b) =>
      b.addEventListener('click', () => {
        this.players.splice(Number(b.dataset.i), 1);
        this.showSetup();
      }),
    );
    $('#add-player')?.addEventListener('click', () => {
      const n = this.players.length + 1;
      this.players.push({ name: `Player ${n}`, avatar: unlocked[(n - 1) % unlocked.length].id });
      this.showSetup();
    });
    document.querySelectorAll<HTMLButtonElement>('[data-hearts]').forEach((b) =>
      b.addEventListener('click', () => {
        this.hearts = Number(b.dataset.hearts);
        this.showSetup();
      }),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) =>
      b.addEventListener('click', () => {
        this.speed = b.dataset.speed as keyof typeof SPEEDS;
        this.showSetup();
      }),
    );
    $('#lava-cats').addEventListener('click', () => this.host.editCategories());
    $('#lava-back').addEventListener('click', () => this.host.exit());
    const go = () => this.start();
    $('#lava-go').addEventListener('click', go);
    this.host.setEnter(go);
  }

  /** Re-render the setup after categories change. */
  refreshSetup(): void {
    if (!this.game) this.showSetup();
  }

  private pool(): Category[] {
    const off = new Set(loadCustomSettings().disabled);
    return ALL_CATEGORIES.filter((c) => !off.has(c.id));
  }

  private loadPlayers(): SetupPlayer[] {
    try {
      const saved = JSON.parse(localStorage.getItem(PLAYERS_KEY) ?? 'null') as SetupPlayer[] | null;
      if (saved && saved.length >= 2) {
        return saved.map((p) => ({ name: p.name, avatar: isAvatarUnlocked(avatarById(p.avatar)) ? p.avatar : AVATARS[0].id }));
      }
    } catch {
      /* fall through */
    }
    const me = loadProfile();
    return [
      { name: displayName(me), avatar: me.avatar },
      { name: 'Player 2', avatar: me.avatar },
    ];
  }

  // ---------- play ----------

  private start(): void {
    const pool = this.pool();
    if (!pool.length) return;
    this.players.forEach((p, i) => (p.name = p.name.trim() || `Player ${i + 1}`));
    try {
      localStorage.setItem(PLAYERS_KEY, JSON.stringify(this.players));
    } catch {
      /* ignore */
    }
    this.game = new LavaGame(this.players, pool, { hearts: this.hearts, ...SPEEDS[this.speed] });
    sfx.crunch();
    this.nextCategory();
  }

  private nextCategory(): void {
    const g = this.game!;
    g.newCategory();
    this.renderPlay();
    this.startTurn();
  }

  private renderPlay(): void {
    const g = this.game!;
    const cat = g.category!;
    const pack = packById(cat.pack);
    this.host.render(`
      <div class="lava-players" id="lava-players"></div>
      <div class="lava-main">
        <canvas class="bucket" id="bucket" aria-hidden="true"></canvas>
        <div class="lava-side">
          <span class="chip" style="--chip:${pack?.color ?? ''}">${esc(pack?.name ?? cat.pack)}</span>
          <p class="prompt">* ${esc(cat.prompt)}</p>
          <p class="holder" id="holder"></p>
        </div>
      </div>
      <div class="timer heat" id="timer">
        <span>HEAT</span>
        <div class="timer-track"><div class="timer-fill" id="timer-fill"></div></div>
        <span class="timer-secs" id="timer-secs"></span>
      </div>
      <form class="answer-form" id="lava-form" autocomplete="off">
        <input id="lava-answer" type="text" maxlength="80" placeholder="unused answer…" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Your answer" />
        <button type="submit" class="menu" data-silent>PASS!</button>
      </form>
      <div class="feedback" id="lava-feedback" aria-live="assertive"></div>
      <p class="tries" id="lava-used"></p>`);
    this.bucket?.destroy();
    this.bucket = new LavaBucketView($<HTMLCanvasElement>('#bucket'));

    const input = $<HTMLInputElement>('#lava-answer');
    input.addEventListener('keydown', (e) => {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) sfx.key();
    });
    $<HTMLFormElement>('#lava-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit(input.value);
    });
    this.host.setEnter(null);
    this.paintPlayers();
  }

  private paintPlayers(): void {
    const g = this.game!;
    $('#lava-players').innerHTML = g.players
      .map(
        (p, i) => `
        <div class="lava-player ${i === g.current ? 'holding' : ''} ${p.hearts === 0 ? 'out' : ''}">
          <img src="${avatarById(p.avatar).src}" alt="" width="40" height="40" />
          <b>${esc(p.name)}</b>
          <span class="hearts">${'♥'.repeat(p.hearts)}<span class="lost">${'♥'.repeat(g.settings.hearts - p.hearts)}</span></span>
          <span class="num pts">${p.points}</span>
        </div>`,
      )
      .join('');
    const holder = g.players[g.current];
    $('#holder').innerHTML = `${esc(holder.name)} is holding the bucket!`;
    $('#lava-used').innerHTML = g.history.length
      ? `Used: ${g.history.map((h) => `<span style="color:${TIERS[h.tier].color}">${esc(h.display)}</span>`).join(' · ')}`
      : '';
  }

  private startTurn(): void {
    const g = this.game!;
    this.stopClock();
    const total = g.turnTime * 1000;
    const end = performance.now() + total;
    const fill = $<HTMLElement>('#timer-fill');
    const secs = $<HTMLElement>('#timer-secs');
    const box = $<HTMLElement>('#timer');
    let nextBoil = 0;
    let lastSec = -1;
    const input = $<HTMLInputElement>('#lava-answer');
    input.value = '';
    input.focus({ preventScroll: true });

    const tick = () => {
      const now = performance.now();
      const left = Math.max(0, end - now);
      const heat = 1 - left / total;
      fill.style.width = `${(left / total) * 100}%`;
      const sec = Math.ceil(left / 1000);
      secs.textContent = String(sec);
      box.classList.toggle('low', left < 2500);
      this.bucket?.setHeat(heat);
      if (now >= nextBoil) {
        sfx.boil(heat);
        nextBoil = now + 520 - heat * 420;
      }
      if (sec !== lastSec && sec > 0 && sec <= 3) sfx.tick(sec <= 1);
      lastSec = sec;
      if (left <= 0) this.erupt();
    };
    tick();
    this.clock = window.setInterval(tick, 50);
  }

  private submit(raw: string): void {
    const g = this.game;
    if (!g || this.clock === null) return;
    const fb = $<HTMLElement>('#lava-feedback');
    const form = $<HTMLFormElement>('#lava-form');
    const input = $<HTMLInputElement>('#lava-answer');
    const shake = () => {
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
    };
    const r = g.submit(raw);
    switch (r.kind) {
      case 'empty':
        sfx.nope();
        shake();
        return;
      case 'wrong':
        sfx.wrong();
        shake();
        fb.innerHTML = say(`“${esc(r.input)}” isn't on the list. Quick, try again!`);
        input.select();
        return;
      case 'used':
        sfx.nope();
        shake();
        fb.innerHTML = say(`${esc(r.display)} was already used!`);
        input.select();
        return;
      case 'ok': {
        sfx.pass();
        const t = TIERS[r.tier];
        fb.innerHTML = say(`${esc(r.display)} — <span style="color:${t.color}">${esc(t.label)}</span>${r.partyPoints ? ` <span class="num">+${r.partyPoints}</span>` : ''}. Pass it to <b>${esc(g.players[r.passedTo].name)}</b>!`);
        this.paintPlayers();
        this.startTurn();
      }
    }
  }

  private erupt(): void {
    const g = this.game!;
    this.stopClock();
    this.bucket?.erupt();
    sfx.explode();
    const e = g.explode();
    const victim = g.players[e.victim];
    this.paintPlayers();
    $<HTMLInputElement>('#lava-answer').disabled = true;
    const fb = $<HTMLElement>('#lava-feedback');
    fb.innerHTML =
      say(`<b class="kaboom">KABOOM!</b> ${esc(victim.name)} got lava'd and loses a heart.`) +
      (e.eliminated ? say(`${esc(victim.name)} is out!`) : '') +
      (e.winner === null ? '<div class="center"><button class="menu" id="lava-next">NEXT CATEGORY</button></div>' : '');
    if (e.winner !== null) {
      window.setTimeout(() => this.showWinner(), 1800);
      return;
    }
    const next = () => this.nextCategory();
    $('#lava-next').addEventListener('click', next);
    window.setTimeout(() => {
      this.host.setEnter(next);
      $<HTMLButtonElement>('#lava-next')?.focus({ preventScroll: true });
    }, 600);
  }

  private showWinner(): void {
    const g = this.game!;
    const order = g.standings();
    const w = g.players[order[0]];
    sfx.victory();
    this.host.render(`
      <div class="stack center">
        <h2>${esc(w.name)} WINS!</h2>
        <img class="winner" src="${avatarById(w.avatar).src}" alt="" width="128" height="128" />
        ${say('The lava cools. The snowmen are mostly fine.')}
        <ol class="standings">
          ${order
            .map((i) => {
              const p = g.players[i];
              return `<li><img src="${avatarById(p.avatar).src}" alt="" width="32" height="32" /><b>${esc(p.name)}</b>
                <span class="hearts">${'♥'.repeat(p.hearts) || '—'}</span>
                <span class="muted"><span class="num">${p.points}</span> pts · <span class="num">${p.answers}</span> answers</span></li>`;
            })
            .join('')}
        </ol>
        <div class="row center-row">
          <button class="menu big" id="lava-again" data-silent>PLAY AGAIN</button>
          <button class="menu" id="lava-setup">PLAYERS</button>
          <button class="menu" id="lava-menu">MENU</button>
        </div>
      </div>`);
    this.game = null;
    const again = () => this.start();
    $('#lava-again').addEventListener('click', again);
    $('#lava-setup').addEventListener('click', () => this.showSetup());
    $('#lava-menu').addEventListener('click', () => this.host.exit());
    this.host.setEnter(again);
  }

  // ---------- cleanup ----------

  private stopClock(): void {
    if (this.clock !== null) window.clearInterval(this.clock);
    this.clock = null;
  }

  stop(): void {
    this.stopClock();
    this.bucket?.destroy();
    this.bucket = null;
    this.game = null;
  }

  get active(): boolean {
    return this.clock !== null;
  }
}
