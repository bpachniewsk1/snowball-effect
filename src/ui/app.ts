import { ALL_CATEGORIES, PACKS, packById } from '../core/categories';
import { dateKey } from '../core/daily';
import { MISS_EMOJI, TIERS, TIER_IDS, formatAltitude, type TierId } from '../core/tiers';
import type { Category } from '../core/types';
import { Roll, rankAt } from '../game/roll';
import {
  PROMPT_CHOICES,
  addSuggestion,
  clearAllSiteData,
  loadCustomSettings,
  loadStats,
  loadSuggestions,
  saveCustomSettings,
  type RoundRecord,
} from '../game/storage';
import { AVATARS, NAME_MAX, avatarById, displayName, isAvatarUnlocked, isUnlockAllOn, loadProfile, loadProgress, saveProfile, setUnlockAll, takeNewUnlocks, type Avatar } from '../game/profile';
import { isMuted, setMuted, setRollSound, sfx, unlockAudio } from '../audio/sfx';
import { initMusic, isMusicOff, setMusicOff } from '../audio/music';
import { PENGUIN, spriteCanvas } from '../render/sprites';
import { nextFact } from '../game/facts';
import { TEST_MODE } from '../core/testmode';
import type { Scene } from '../render/scene';
import { $, esc, say } from './util';
import { LavaScreen } from './lava';


const params = new URLSearchParams(location.search);
const DEV = params.has('dev');
/** Dev tools (clear-data button) show on the dev server or with ?dev. */
const DEV_TOOLS = DEV || import.meta.env.DEV;
/** Lava Bucket (party mode) is parked for the first public release — `?lava` brings it back for testing. */
const LAVA_ENABLED = params.has('lava');

function rollDate(): string {
  const d = params.get('date');
  return DEV && d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : dateKey();
}

const MASCOT_LINES = [
  'The penguin spins. It is not very effective.',
  'The penguin is filled with determination. And fish.',
  'You feel like you are going to have a cool time.',
  'The penguin judges your answers in silence.',
  'Waddle waddle.',
  'It is cold. The penguin approves.',
  'The penguin has seen a polar bear. It is fine. Probably.',
  'Brain freeze!',
];

export class App {
  private roll: Roll | null = null;
  private panel = $<HTMLElement>('#panel');
  private hud = $<HTMLElement>('#hud');
  private timer: number | null = null;
  /** performance.now() when the current prompt's clock started / will end. */
  private clockStart = 0;
  private clockEnd = 0;
  private typing: number | null = null;
  /** Which menu screen is up, so a new day can refresh it. */
  private screen: 'title' | 'archive' | 'other' = 'other';
  private day = rollDate();
  private spins = 0;
  private lava = new LavaScreen({
    render: (html) => this.render(html),
    setEnter: (fn) => (this.onEnter = fn),
    exit: () => {
      this.lava.stop();
      this.showTitle();
    },
    editCategories: () => this.openCategories('lava'),
  });
  /** Dev climb simulation timers. */
  private simTimers: number[] = [];
  /** Called by the global Enter handler on screens with a primary action. */
  private onEnter: (() => void) | null = null;

  constructor(private scene: Scene) {
    this.scene.setAvatar(avatarById(loadProfile().avatar).src);
    this.scene.onRoll = (level, size) => setRollSound(level, size);
    this.scene.onSummit = () => sfx.summit();
    this.scene.onSlip = () => sfx.slip();
    this.buildHowTo();
    this.buildToggles();
    this.buildMascot();
    this.buildDevTools();
    this.tickHud();
    this.watchDay();
    initMusic();

    // Audio can only start after a user gesture.
    document.addEventListener('pointerdown', unlockAudio, { capture: true });
    document.addEventListener('keydown', unlockAudio, { capture: true });
    // Every button clicks, unless it plays its own sound.
    document.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (btn && !btn.hasAttribute('data-silent')) sfx.click();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !this.onEnter) return;
      if ((e.target as HTMLElement).tagName === 'INPUT' || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      this.onEnter();
    });

    // Click the snowman in the scene to make it spin.
    const canvas = $<HTMLCanvasElement>('#scene');
    canvas.addEventListener('click', (e) => {
      if (!this.scene.isOnSnowman(e.clientX, e.clientY)) return;
      this.scene.spinSnowman();
      sfx.spin();
    });
    canvas.addEventListener('mousemove', (e) => {
      canvas.style.cursor = this.scene.isOnSnowman(e.clientX, e.clientY) ? 'pointer' : '';
    });
  }

  start(): void {
    this.showTitle();
  }

  // ---------- screens ----------

  private showTitle(): void {
    this.stopSim();
    this.stopTimer();
    this.lava.stop();
    this.roll = null;
    this.hud.classList.add('hidden');
    this.scene.setState(0, 700, true);
    this.scene.setRolling(false);
    this.scene.setMood(null);

    this.screen = 'title';
    const stats = loadStats();
    const daily = Roll.daily(rollDate());
    const archiveOpen = daily.finished || isUnlockAllOn();
    const custom = Roll.resumeCustom();
    const dailyLabel = daily.finished
      ? "TODAY'S RESULT"
      : daily.started
        ? `CONTINUE DAILY · ${daily.roundIndex}/${daily.categories.length}`
        : `DAILY ROLL #${daily.number}`;
    const customOpen = custom && custom.started && !custom.finished;

    this.render(`
      <div class="stack center">
        <h1>SNOWBALL EFFECT</h1>
        ${TEST_MODE ? '<p class="test-badge">TEST MODE · separate saves · <a href="./">leave</a></p>' : ''}
        ${say('Answer prompts. The <em>colder</em> (rarer) your answer, the higher your snowman pushes its snowball up the mountain. Wrong? Keep trying until time runs out.')}
        <div class="title-grid">
          ${this.profileChip()}
          <div class="menu-list">
            <button class="menu big" id="daily" data-silent>${dailyLabel}</button>
            <button class="menu big" id="custom">CUSTOM ROLL</button>
            <button class="menu big${archiveOpen ? '' : ' locked'}" id="archive" data-silent>${archiveOpen ? 'ARCHIVE' : '🔒 ARCHIVE'}</button>
            ${LAVA_ENABLED ? '<button class="menu big lava-btn" id="lava">LAVA BUCKET</button>' : ''}
            ${customOpen ? `<button class="menu" id="continue-custom" data-silent>CONTINUE CUSTOM · ${custom.roundIndex}/${custom.categories.length}</button>` : ''}
          </div>
        </div>
        <div class="row center-row">
          <button class="link" id="how">How to play</button>
          ${stats.played ? `<span class="muted">streak ${stats.streak} · highest ${formatAltitude(stats.bestPoints)}</span>` : ''}
        </div>
        ${daily.finished ? `<p class="muted small">Next daily roll in <span id="countdown" class="num">${this.countdown()}</span></p>` : ''}
      </div>`);
    this.runCountdown();

    $('#daily').addEventListener('click', () => this.play(daily));
    $('#custom').addEventListener('click', () => this.openCategories());
    $('#archive').addEventListener('click', () => {
      if (archiveOpen) {
        sfx.click();
        this.showArchive();
      } else {
        sfx.nope();
        this.toast("Finish today's Daily Roll to unlock the archive");
      }
    });
    document.querySelector('#lava')?.addEventListener('click', () => {
      this.screen = 'other';
      this.hud.classList.add('hidden');
      this.lava.showSetup();
    });
    $('#continue-custom')?.addEventListener('click', () => custom && this.play(custom));
    $('#how').addEventListener('click', () => $<HTMLDialogElement>('#howto').showModal());
    $('#profile-chip').addEventListener('click', () => this.openProfile(() => this.showTitle()));
    this.onEnter = () => this.play(daily);
    $<HTMLButtonElement>('#daily').focus({ preventScroll: true });
  }

  /** Past days' rolls. Opens once today's Daily Roll is done. */
  private showArchive(): void {
    this.screen = 'archive';
    this.onEnter = null;
    const today = rollDate();
    const days = Roll.archiveDates(today);
    const rows = days
      .map((date) => {
        const r = Roll.daily(date, today);
        const status = r.finished
          ? `<span class="num">${formatAltitude(r.points)}</span> ${r.rounds.map((x) => (x.tier ? TIERS[x.tier].emoji : MISS_EMOJI)).join('')}`
          : r.started
            ? `<span class="muted">in progress · ${r.roundIndex}/${r.categories.length}</span>`
            : '<span class="muted">not played</span>';
        return `<li><button class="archive-day" data-date="${date}" data-silent>
            <span class="num">#${r.number}</span><span>${esc(this.prettyDate(date))}</span><span class="archive-status">${status}</span>
          </button></li>`;
      })
      .join('');
    this.render(`
      <div class="stack">
        <h2 class="center">ARCHIVE</h2>
        ${say(days.length ? "Every past Daily Roll. Playing one doesn't touch your streak." : "Nothing here yet — each Daily Roll lands in the archive the day after. Come back tomorrow!")}
        ${days.length ? `<ul class="archive-list">${rows}</ul>` : ''}
        <div class="row center-row"><button class="menu big" id="back">BACK</button></div>
      </div>`);
    this.panel.querySelectorAll<HTMLButtonElement>('.archive-day').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.crunch();
        this.play(Roll.daily(b.dataset.date!, today));
      }),
    );
    $('#back').addEventListener('click', () => this.showTitle());
    this.onEnter = () => this.showTitle();
  }

  /** A new day while the menu is open: refresh it so the new Daily Roll shows up. */
  private watchDay(): void {
    const check = () => {
      const now = rollDate();
      if (now === this.day) return;
      this.day = now;
      if (document.querySelector('dialog[open]')) return;
      if (this.screen === 'title') this.showTitle();
      else if (this.screen === 'archive') this.showArchive();
    };
    window.setInterval(check, 15_000);
    document.addEventListener('visibilitychange', () => !document.hidden && check());
  }

  private runCountdown(): void {
    const cd = window.setInterval(() => {
      const el = document.getElementById('countdown');
      if (!el) return window.clearInterval(cd);
      const left = this.countdown();
      el.textContent = left;
      if (left === '00:00:00') {
        window.clearInterval(cd);
        el.parentElement!.innerHTML = 'A new Daily Roll is out! <button class="link" id="go-new">play it</button>';
        document.getElementById('go-new')?.addEventListener('click', () => this.showTitle());
      }
    }, 1000);
  }

  /** Enter a roll: finished ones show results, others continue at the current prompt. */
  private play(roll: Roll): void {
    this.screen = 'other';
    this.onEnter = null;
    this.roll = roll;
    this.hud.classList.remove('hidden');
    this.scene.setState(roll.points, roll.maxPoints, true);
    if (roll.finished) return this.showResults();
    this.render('');
    if (!roll.started) sfx.crunch();
    else sfx.click();
    window.setTimeout(() => this.startRound(), roll.started ? 150 : 500);
  }

  private startRound(): void {
    this.scene.setMood(null);
    const roll = this.roll!;
    const cat = roll.current;
    if (!cat) return this.showResults(true);
    this.onEnter = null;
    roll.beginRound();
    const pack = packById(cat.pack);

    this.render(`
      <div class="row spread">
        <span class="chip" style="--chip:${pack?.color ?? ''}">${esc(pack?.name ?? cat.pack)}</span>
        <span class="muted num">${roll.roundIndex + 1} / ${roll.categories.length}</span>
      </div>
      <p class="prompt" id="prompt" aria-label="${esc(cat.prompt)}">*&nbsp;</p>
      <div class="timer" id="timer">
        <span>TIME</span>
        <div class="timer-track"><div class="timer-fill" id="timer-fill"></div></div>
        <span class="timer-secs" id="timer-secs">${cat.timeLimit}</span>
      </div>
      <form class="answer-form" id="answer-form" autocomplete="off">
        <input id="answer" type="text" maxlength="80" placeholder="your answer…"
          autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Your answer" />
        <button type="submit" class="menu" data-silent>ROLL</button>
      </form>
      <div class="feedback" id="feedback" aria-live="assertive">${this.triesHtml(roll.misses)}</div>
      ${
        TEST_MODE
          ? `<div class="test-bar"><span>TEST</span>${TIER_IDS.map((id) => `<button type="button" class="test-tier" data-tier="${id}" style="--tier:${TIERS[id].color}">${esc(TIERS[id].label)}</button>`).join('')}<button type="button" class="test-tier" data-tier="timeout">Time out</button></div>`
          : ''
      }`);

    const input = $<HTMLInputElement>('#answer');
    const form = $<HTMLFormElement>('#answer-form');
    const feedback = $<HTMLElement>('#feedback');
    input.focus({ preventScroll: true });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (input.value) sfx.backspace();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        sfx.key();
      }
    });

    const shake = () => {
      form.classList.remove('shake');
      void form.offsetWidth; // restart the animation
      form.classList.add('shake');
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const now = performance.now();
      const timing = this.timer !== null ? { elapsed: (now - this.clockStart) / 1000, left: (this.clockEnd - now) / 1000 } : undefined;
      const outcome = roll.submit(input.value, timing);
      switch (outcome.kind) {
        case 'empty':
          sfx.nope();
          shake();
          break;
        case 'repeat':
          sfx.nope();
          shake();
          feedback.innerHTML = say(`You already tried “${esc(outcome.input)}”.`) + this.triesHtml(roll.misses);
          input.select();
          break;
        case 'wrong': {
          sfx.wrong();
          shake();
          feedback.innerHTML =
            say(`“${esc(outcome.input)}” isn't on the list. Keep trying! <button type="button" class="link" id="suggest-now">suggest it</button>`) +
            this.triesHtml(roll.misses);
          $('#suggest-now')?.addEventListener('click', (ev) => {
            addSuggestion({ categoryId: cat.id, input: outcome.input, date: roll.date });
            (ev.target as HTMLElement).replaceWith(document.createTextNode('(noted!)'));
            input.focus({ preventScroll: true });
          });
          input.select();
          break;
        }
        case 'scored':
          this.stopTimer();
          this.showSuspense(cat, outcome.record, outcome.typo);
          return;
      }
      input.focus({ preventScroll: true });
    });

    // Test mode: answer with any tier (a real answer from the list) or force a timeout.
    this.panel.querySelectorAll<HTMLButtonElement>('.test-tier').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.tier === 'timeout') {
          this.stopTimer();
          this.showReveal(cat, roll.timeout(input.value), false);
          return;
        }
        const pool = cat.answers.filter((a) => a.tier === b.dataset.tier);
        if (!pool.length) return this.toast('No answer of that tier here');
        input.value = pool[Math.floor(Math.random() * pool.length)].display;
        form.requestSubmit();
      }),
    );

    // The clock starts once the prompt has finished typing itself out.
    this.typeOut($('#prompt'), cat.prompt, () =>
      this.runTimer(cat.timeLimit, () => {
        const record = roll.timeout(input.value);
        this.showReveal(cat, record, false);
      }),
    );
  }

  private triesHtml(misses: readonly string[]): string {
    return misses.length ? `<p class="tries">Tried: ${misses.map((m) => `<s>${esc(m)}</s>`).join(' · ')}</p>` : '';
  }

  /** Short (≈0.8 s) drumroll while the badge flicks through tiers, then the real reveal. */
  private showSuspense(cat: Category, record: RoundRecord, typo: boolean): void {
    this.onEnter = null;
    sfx.hype();
    this.scene.setRolling(true);
    this.render(`
      <div class="stack center">
        <p class="prompt muted small">${esc(cat.prompt)}</p>
        ${say(`You said <b>${esc(record.answerDisplay ?? record.input)}</b>…`)}
        <div class="tier-badge rolling" id="roulette"><span>?</span><small>measuring…</small></div>
      </div>`);
    const badge = $<HTMLElement>('#roulette');
    let i = 0;
    const flick = window.setInterval(() => {
      const t = TIERS[TIER_IDS[i++ % TIER_IDS.length]];
      badge.style.setProperty('--tier', t.color);
      badge.innerHTML = `<span>${esc(t.label)}</span><small>${esc(t.temp)}</small>`;
    }, 70);
    window.setTimeout(() => {
      window.clearInterval(flick);
      this.showReveal(cat, record, typo);
    }, 800);
  }

  private showReveal(cat: Category, record: RoundRecord, typo: boolean): void {
    const roll = this.roll!;
    this.stopTyping();
    this.scene.setRolling(false);
    this.scene.setState(roll.points, roll.maxPoints);
    const tier = record.tier ? TIERS[record.tier] : null;
    this.scene.setMood(tier ? tier.level : null, tier?.color);
    if (tier) {
      this.scene.celebrate(tier.color, 10 + tier.points / 2);
      sfx.tier(tier.id);
    } else {
      this.scene.puff();
      this.scene.wobble();
      sfx.timeout();
    }

    const misses = record.misses ?? [];
    let head: string;
    if (tier) {
      head = `
        <div class="tier-badge ${tier.id}" style="--tier:${tier.color}">
          <span>${esc(tier.label)}</span><small>${esc(tier.temp)}</small>
        </div>
        <div class="points">+${tier.points} m</div>
        ${say(`You said <b>${esc(record.answerDisplay ?? '')}</b>.${typo ? ` <span class="muted">(you typed “${esc(record.input)}”)</span>` : ''}${misses.length ? ` <span class="muted">(after ${misses.length} wrong ${misses.length === 1 ? 'guess' : 'guesses'})</span>` : ''}`)}
        ${say(esc(tier.blurb))}
        ${say(`The snowball climbs to <b class="num">${formatAltitude(roll.points)}</b>.`)}`;
    } else {
      head = `
        <div class="tier-badge miss">TIME'S UP</div>
        ${say("Your snowman froze mid-thought. The snowball didn't grow.")}
        ${
          misses.length
            ? say(
                `Should one of these count? ${misses
                  .slice(-4)
                  .map((m, i) => `<button class="link suggest" data-i="${i}">${esc(m)}</button>`)
                  .join(' ')}`,
              )
            : ''
        }`;
    }

    const colder = roll.colderAnswers(cat, record.answerKey);
    const isLast = roll.finished;
    this.render(`
      <div class="stack center">
        <p class="prompt muted small">${esc(cat.prompt)}</p>
        ${head}
        ${
          colder.length
            ? `<div class="colder"><span class="muted">${record.tier === 'absolutezero' ? 'Other deep cuts:' : 'Colder answers:'}</span><ul>${colder
                .map((a) => `<li style="--tier:${TIERS[a.tier].color}">${esc(a.display)}</li>`)
                .join('')}</ul></div>`
            : ''
        }
        <div><button class="menu big" id="next">${isLast ? 'SEE RESULTS' : 'NEXT PROMPT'}</button></div>
      </div>`);

    this.announceUnlocks();
    const shown = misses.slice(-4);
    this.panel.querySelectorAll<HTMLButtonElement>('.suggest').forEach((btn) =>
      btn.addEventListener('click', () => {
        const guess = shown[Number(btn.dataset.i)];
        addSuggestion({ categoryId: cat.id, input: guess, date: roll.date });
        btn.replaceWith(document.createTextNode(`${guess} (noted!)`));
      }),
    );
    const next = () => (isLast ? this.showResults(true) : this.startRound());
    $('#next').addEventListener('click', next);
    // Short delay so a double-tapped Enter doesn't skip the reveal.
    this.onEnter = null;
    window.setTimeout(() => {
      this.onEnter = next;
      $<HTMLButtonElement>('#next')?.focus({ preventScroll: true });
    }, 400);
  }

  private showResults(fresh = false): void {
    const r = this.roll!;
    this.screen = 'other';
    // Every roll ends like Sisyphus: the ball slips back to the valley (after a summit moment at 700 m).
    if (fresh) {
      this.scene.setState(r.points, r.maxPoints);
      this.scene.slip(() => this.mascotSay('One must imagine the snowman happy.', 5000));
    } else {
      this.scene.setState(r.points, r.maxPoints, true);
    }
    this.scene.setMood(null);
    if (fresh) sfx.results();
    const stats = loadStats();
    const rank = rankAt(r.points);
    const suggestions = loadSuggestions();

    const rows = r.rounds
      .map((rec) => {
        const cat = r.categoryFor(rec);
        const tier = rec.tier ? TIERS[rec.tier] : null;
        const answer = rec.answerDisplay ?? '—';
        const wrong = rec.misses?.length ? ` <span class="muted small">(+${rec.misses.length} wrong)</span>` : '';
        const tag = tier
          ? `<span class="t" style="--tier:${tier.color}">${esc(tier.label)} +${tier.points}</span>`
          : `<span class="t miss">TIME'S UP</span>`;
        return `<li><span class="q">${esc(cat?.prompt ?? rec.categoryId)}</span><span class="a">${esc(answer)}${wrong}</span>${tag}</li>`;
      })
      .join('');

    const statsHtml =
      r.mode === 'daily' && !r.archive
        ? `<div class="stats">
            <div><b>${stats.played}</b><span>played</span></div>
            <div><b>${stats.streak}</b><span>streak</span></div>
            <div><b>${stats.bestStreak}</b><span>best streak</span></div>
            <div><b>${formatAltitude(stats.bestPoints)}</b><span>highest</span></div>
          </div>`
        : '';

    this.render(`
      <div class="stack">
        <div class="center stack">
          ${this.profileChip()}
          <p class="muted">${esc(r.label)}${r.mode === 'daily' ? ` · ${esc(this.prettyDate(r.date))}` : ''}</p>
          <div class="result-size">${formatAltitude(r.points)}</div>
          <h2>${esc(rank.name)}</h2>
          ${say(`As high as ${esc(rank.like)}. (<span class="num">${r.points} / ${r.maxPoints}</span> m climbed)`)}
        </div>
        <ul class="rounds">${rows}</ul>
        ${statsHtml}
        <div class="center stack">
          <div class="row center-row">
            <button class="menu big" id="share" data-silent>SHARE</button>
            ${r.mode === 'custom' ? '<button class="menu big" id="again" data-silent>ROLL AGAIN</button>' : ''}
            ${r.archive ? '<button class="menu big" id="to-archive">ARCHIVE</button>' : ''}
            <button class="menu big" id="menu">MENU</button>
          </div>
          ${r.mode === 'daily' && !r.archive ? `<p class="muted">Next daily roll in <span id="countdown" class="num">${this.countdown()}</span></p>` : ''}
          <div class="row center-row">
            <button class="link" id="how">How to play</button>
            ${suggestions.length ? `<button class="link" id="sugg">Copy ${suggestions.length} suggested answer(s)</button>` : ''}
            ${DEV || TEST_MODE ? '<button class="link" id="reset">[test] reset this roll</button>' : ''}
          </div>
        </div>
      </div>`);

    $('#share').addEventListener('click', () => this.share());
    $('#menu').addEventListener('click', () => this.showTitle());
    $('#again')?.addEventListener('click', () => this.startCustom());
    $('#to-archive')?.addEventListener('click', () => this.showArchive());
    $('#how').addEventListener('click', () => $<HTMLDialogElement>('#howto').showModal());
    $('#profile-chip').addEventListener('click', () => this.openProfile(() => this.showResults()));
    $('#sugg')?.addEventListener('click', () => this.copy(JSON.stringify(loadSuggestions(), null, 2), 'Copied suggestions'));
    $('#reset')?.addEventListener('click', () => {
      r.reset();
      location.reload();
    });
    this.onEnter = () => this.share();
    this.announceUnlocks();

    if (r.mode === 'daily' && !r.archive) this.runCountdown();
  }

  // ---------- custom mode ----------

  private enabledCategories(): Category[] {
    const off = new Set(loadCustomSettings().disabled);
    return ALL_CATEGORIES.filter((c) => !off.has(c.id));
  }

  private startCustom(): void {
    const pool = this.enabledCategories();
    if (!pool.length) return this.openCategories();
    this.play(Roll.newCustom(pool, loadCustomSettings().prompts));
  }

  /** Category browser: enable/disable categories, see how big each answer base is, start a custom roll. */
  private openCategories(mode: 'custom' | 'lava' = 'custom'): void {
    const dlg = $<HTMLDialogElement>('#categories');
    if (mode === 'lava') dlg.addEventListener('close', () => this.lava.refreshSetup(), { once: true });
    const settings = loadCustomSettings();
    const off = new Set(settings.disabled);
    let prompts = settings.prompts;

    const tierCells = (cats: Category[]) =>
      TIER_IDS.map((id) => {
        const n = cats.reduce((sum, c) => sum + c.answers.filter((a) => a.tier === id).length, 0);
        return `<span class="tc num" style="--tier:${TIERS[id].color}" title="${esc(TIERS[id].label)}">${n}</span>`;
      }).join('');

    const persist = () => saveCustomSettings({ disabled: [...off], prompts });

    const paint = () => {
      const scroll = dlg.querySelector('.cat-list')?.scrollTop ?? 0;
      const enabled = ALL_CATEGORIES.filter((c) => !off.has(c.id));
      const answers = enabled.reduce((n, c) => n + c.answers.length, 0);

      const packsHtml = PACKS.map((p) => {
        const on = p.categories.filter((c) => !off.has(c.id));
        const state = on.length === 0 ? 'none' : on.length === p.categories.length ? 'all' : 'some';
        const rows = p.categories
          .map(
            (c) => `
            <label class="cat-row ${off.has(c.id) ? 'off' : ''}">
              <input type="checkbox" class="heart" data-cat="${c.id}" ${off.has(c.id) ? '' : 'checked'} />
              <span class="cat-name">${esc(c.prompt)}</span>
              <span class="cat-total num">${c.answers.length}</span>
              <span class="tier-cells">${tierCells([c])}</span>
            </label>`,
          )
          .join('');
        return `
          <section class="pack">
            <label class="pack-head">
              <input type="checkbox" class="heart" data-pack="${p.id}" ${state === 'all' ? 'checked' : ''} data-some="${state === 'some'}" />
              <span class="chip" style="--chip:${p.color}">${esc(p.name)}</span>
              <span class="muted">${on.length}/${p.categories.length} on</span>
              <span class="cat-total num">${p.categories.reduce((n, c) => n + c.answers.length, 0)}</span>
              <span class="tier-cells">${tierCells(p.categories)}</span>
            </label>
            ${rows}
          </section>`;
      }).join('');

      dlg.innerHTML = `
        <div class="cat-dialog">
          <div class="cat-top">
            <h2>${mode === 'lava' ? 'Lava Bucket categories' : 'Custom Roll'}</h2>
            ${say('Prompts are drawn at random from enabled categories. Coloured numbers = answers per tier.')}
            <div class="row spread">
              <div class="row ${mode === 'lava' ? 'hidden' : ''}">
                <span>Prompts:</span>
                ${PROMPT_CHOICES.map((n) => `<button class="menu small ${n === prompts ? 'picked' : ''}" data-prompts="${n}">${n}</button>`).join('')}
              </div>
              <div class="row">
                <button class="link" id="all-on">all on</button>
                <button class="link" id="all-off">all off</button>
              </div>
            </div>
            <div class="legend">
              ${TIER_IDS.map((id) => `<span class="tc" style="--tier:${TIERS[id].color}">${esc(TIERS[id].label)}</span>`).join('')}
            </div>
          </div>
          <div class="cat-list">${packsHtml}</div>
          <div class="cat-bottom">
            <p class="summary"><b class="num">${enabled.length}</b> of <span class="num">${ALL_CATEGORIES.length}</span> categories · <b class="num">${answers}</b> answers</p>
            <div class="row center-row">
              ${
                mode === 'lava'
                  ? ''
                  : `<button class="menu big" id="go-custom" data-silent ${enabled.length ? '' : 'disabled'}>START · ${Math.min(prompts, enabled.length)} PROMPTS</button>`
              }
              <button class="menu" id="close-cat">${mode === 'lava' ? 'DONE' : 'CLOSE'}</button>
            </div>
          </div>
        </div>`;

      dlg.querySelectorAll<HTMLInputElement>('input[data-some="true"]').forEach((i) => (i.indeterminate = true));
      const list = dlg.querySelector('.cat-list')!;
      list.scrollTop = scroll;

      list.addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement;
        if (input.dataset.cat) {
          if (input.checked) off.delete(input.dataset.cat);
          else off.add(input.dataset.cat);
        } else if (input.dataset.pack) {
          const pack = PACKS.find((p) => p.id === input.dataset.pack)!;
          const turnOn = pack.categories.some((c) => off.has(c.id));
          pack.categories.forEach((c) => (turnOn ? off.delete(c.id) : off.add(c.id)));
        }
        sfx.squeak();
        persist();
        paint();
      });
      dlg.querySelectorAll<HTMLButtonElement>('[data-prompts]').forEach((b) =>
        b.addEventListener('click', () => {
          prompts = Number(b.dataset.prompts);
          persist();
          paint();
        }),
      );
      dlg.querySelector('#all-on')!.addEventListener('click', () => {
        off.clear();
        persist();
        paint();
      });
      dlg.querySelector('#all-off')!.addEventListener('click', () => {
        ALL_CATEGORIES.forEach((c) => off.add(c.id));
        persist();
        paint();
      });
      dlg.querySelector('#close-cat')!.addEventListener('click', () => dlg.close());
      dlg.querySelector('#go-custom')?.addEventListener('click', () => {
        persist();
        dlg.close();
        this.startCustom();
      });
    };

    paint();
    dlg.showModal();
  }

  // ---------- unlocks ----------

  private unlockQueue: Avatar[] = [];
  private unlockShowing = false;

  /** Shows a popup (one at a time) for every snowman unlocked since the last check. */
  private announceUnlocks(): void {
    this.unlockQueue.push(...takeNewUnlocks());
    if (!this.unlockShowing) this.showNextUnlock();
  }

  private showNextUnlock(): void {
    const a = this.unlockQueue.shift();
    const box = $<HTMLElement>('#unlock');
    if (!a) {
      this.unlockShowing = false;
      box.classList.remove('show');
      return;
    }
    this.unlockShowing = true;
    box.innerHTML = `
      <img src="${a.src}" alt="" width="64" height="64" />
      <div><b>NEW SNOWMAN!</b><p>* You unlocked <em>${esc(a.name)}</em>.</p><small>${esc(a.hint)}</small></div>`;
    box.classList.add('show');
    sfx.unlock();
    window.setTimeout(() => {
      box.classList.remove('show');
      window.setTimeout(() => this.showNextUnlock(), 400);
    }, 3200);
  }

  // ---------- profile, toggles, mascot, dev ----------

  private profileChip(): string {
    const p = loadProfile();
    const a = avatarById(p.avatar);
    return `
      <button class="profile-chip" id="profile-chip" aria-label="Change your snowman">
        <img class="avatar" src="${a.src}" alt="${esc(a.name)} snowman" width="96" height="96" />
        <span><b>${esc(displayName(p))}</b><small>change snowman</small></span>
      </button>`;
  }

  /** Avatar + nickname picker. `onDone` re-renders whatever screen opened it. */
  private openProfile(onDone: () => void): void {
    const dlg = $<HTMLDialogElement>('#profile');
    const p = loadProfile();
    const progress = loadProgress();
    const unlockedCount = AVATARS.filter((a) => isAvatarUnlocked(a, progress)).length;
    let chosen = p.avatar;
    dlg.innerHTML = `
      <form method="dialog" class="stack" id="profile-form">
        <h2>Pick your snowman</h2>
        <p class="muted">Unlocked <span class="num">${unlockedCount}/${AVATARS.length}</span> — play to earn the rest.</p>
        <div class="avatar-grid" role="radiogroup" aria-label="Snowman">
          ${AVATARS.map((a) => {
            const open = isAvatarUnlocked(a, progress);
            return `<button type="button" class="avatar-opt ${open ? '' : 'locked'}" role="radio" data-silent data-id="${a.id}"
              aria-checked="${a.id === chosen}" ${open ? '' : 'aria-disabled="true"'} title="${esc(open ? a.name : `Locked: ${a.hint}`)}">
              <img src="${a.src}" alt="${esc(open ? a.name : 'Locked snowman')}" width="64" height="64" />
              <span>${esc(open ? a.name : '???')}</span>
              ${open ? '' : `<small class="hint">🔒 ${esc(a.hint)}</small>`}
            </button>`;
          }).join('')}
        </div>
        <label class="name-field">Nickname
          <input id="nick" type="text" maxlength="${NAME_MAX}" value="${esc(p.name)}" placeholder="Nameless snowman" autocomplete="off" spellcheck="false" />
        </label>
        <div class="center"><button type="submit" class="menu" data-silent>SAVE</button></div>
      </form>`;

    dlg.querySelectorAll<HTMLButtonElement>('.avatar-opt').forEach((btn) =>
      btn.addEventListener('click', () => {
        if (btn.classList.contains('locked')) {
          sfx.nope();
          return;
        }
        chosen = btn.dataset.id!;
        dlg.querySelectorAll('.avatar-opt').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
        this.scene.setAvatar(avatarById(chosen).src);
        sfx.squeak();
      }),
    );
    const nick = dlg.querySelector<HTMLInputElement>('#nick')!;
    nick.addEventListener('keydown', (e) => {
      if (e.key.length === 1) sfx.key();
    });
    dlg.addEventListener(
      'close',
      () => this.scene.setAvatar(avatarById(loadProfile().avatar).src), // cancelled with Esc → revert preview
      { once: true },
    );
    dlg.querySelector('#profile-form')!.addEventListener('submit', () => {
      saveProfile({ avatar: chosen, name: nick.value });
      sfx.ding();
      onDone();
    });
    dlg.showModal();
  }

  private buildToggles(): void {
    const sfxBtn = $<HTMLButtonElement>('#toggle-sfx');
    const musicBtn = $<HTMLButtonElement>('#toggle-music');
    const paint = () => {
      sfxBtn.textContent = isMuted() ? 'SFX OFF' : 'SFX ON';
      sfxBtn.setAttribute('aria-pressed', String(!isMuted()));
      musicBtn.textContent = isMusicOff() ? 'MUSIC OFF' : 'MUSIC ON';
      musicBtn.setAttribute('aria-pressed', String(!isMusicOff()));
    };
    sfxBtn.addEventListener('click', () => {
      setMuted(!isMuted());
      paint();
      sfx.click();
    });
    musicBtn.addEventListener('click', () => {
      setMusicOff(!isMusicOff());
      paint();
    });
    paint();
  }

  /** Clickable penguin in the corner: idles, spins when clicked, and drops fun facts now and then. */
  private buildMascot(): void {
    const btn = $<HTMLButtonElement>('#mascot');
    $<HTMLImageElement>('#mascot-img').src = spriteCanvas(PENGUIN[0]).toDataURL();
    btn.addEventListener('click', () => {
      this.spins++;
      btn.classList.remove('spinning');
      void btn.offsetWidth; // restart the animation
      btn.classList.add('spinning');
      sfx.spin();
      if (this.spins % 10 === 0) this.mascotSay(`The penguin has spun ${this.spins} times. It is dizzy.`, 3000);
      else if (Math.random() < 0.7) this.mascotSay(`Fun fact: ${nextFact()}`, 8000);
      else this.mascotSay(MASCOT_LINES[Math.floor(Math.random() * MASCOT_LINES.length)], 3000);
    });

    // Every so often, a fun fact — but never while a prompt's clock is running.
    const schedule = () =>
      window.setTimeout(() => {
        const busy = this.timer !== null || this.typing !== null || this.lava.active || document.querySelector('dialog[open]');
        if (!busy && !document.hidden) {
          this.mascotSay(`Fun fact: ${nextFact()}`, 8000);
          btn.classList.add('hop');
          window.setTimeout(() => btn.classList.remove('hop'), 600);
          sfx.blip();
        }
        schedule();
      }, 35000 + Math.random() * 20000);
    schedule();
  }

  private bubbleHide: number | null = null;
  private mascotSay(text: string, ms: number): void {
    const bubble = $<HTMLElement>('#mascot-say');
    bubble.textContent = `* ${text}`;
    bubble.classList.remove('hidden');
    if (this.bubbleHide) window.clearTimeout(this.bubbleHide);
    this.bubbleHide = window.setTimeout(() => bubble.classList.add('hidden'), ms);
  }

  private buildDevTools(): void {
    if (!DEV_TOOLS) return;
    $('#dev-tools').classList.remove('hidden');
    $('#dev-clear').addEventListener('click', () => {
      clearAllSiteData();
      location.reload();
    });

    const unlockBtn = $<HTMLButtonElement>('#dev-unlock');
    const paint = () => {
      unlockBtn.textContent = isUnlockAllOn() ? 'UNLOCK ALL: ON' : 'UNLOCK ALL: OFF';
      unlockBtn.setAttribute('aria-pressed', String(isUnlockAllOn()));
    };
    unlockBtn.addEventListener('click', () => {
      setUnlockAll(!isUnlockAllOn());
      paint();
      // Turning it off can make the current snowman locked again — fall back to the starter.
      this.scene.setAvatar(avatarById(loadProfile().avatar).src);
      const chip = document.querySelector<HTMLImageElement>('#profile-chip img');
      if (chip) chip.src = avatarById(loadProfile().avatar).src;
      const dlg = $<HTMLDialogElement>('#profile');
      if (dlg.open) {
        dlg.close();
        this.openProfile(() => (this.roll ? this.showResults() : this.showTitle()));
      }
      this.toast(isUnlockAllOn() ? 'All snowmen unlocked' : 'Back to earned snowmen');
    });
    paint();

    $('#dev-sim700').addEventListener('click', () => this.devSimulate(Array(7).fill('absolutezero')));
    $('#dev-simrand').addEventListener('click', () =>
      this.devSimulate(Array.from({ length: 7 }, () => TIER_IDS[Math.floor(Math.random() * TIER_IDS.length)])),
    );
  }

  /** Dev: play a whole climb in the scene — drumroll, push, mood — then the slip. Touches no saves. */
  private devSimulate(tiers: TierId[]): void {
    this.stopSim();
    this.stopTimer();
    this.roll = null;
    this.onEnter = null;
    this.hud.classList.add('hidden');
    this.render(`
      <div class="stack center">
        ${say(`Simulating a climb: ${tiers.map((t) => TIERS[t].emoji).join('')} = <b class="num">${tiers.reduce((n, t) => n + TIERS[t].points, 0)} m</b>`)}
        <button class="menu" id="sim-stop">MENU</button>
      </div>`);
    $('#sim-stop').addEventListener('click', () => this.showTitle());
    const summit = tiers.length * 100;
    this.scene.setState(0, summit, true);
    this.scene.setMood(null);
    const STEP = 2400;
    let pts = 0;
    tiers.forEach((id, i) => {
      this.simTimers.push(
        window.setTimeout(() => {
          this.scene.setMood(null);
          this.scene.setRolling(true);
          sfx.hype();
        }, i * STEP),
        window.setTimeout(() => {
          const t = TIERS[id];
          pts += t.points;
          this.scene.setRolling(false);
          this.scene.setState(pts, summit);
          this.scene.setMood(t.level, t.color);
          this.scene.celebrate(t.color, 10 + t.points / 2);
          sfx.tier(id);
        }, i * STEP + 800),
      );
    });
    this.simTimers.push(
      window.setTimeout(() => {
        this.scene.setMood(null);
        sfx.results();
        this.scene.slip(() => this.mascotSay('One must imagine the snowman happy.', 5000));
      }, tiers.length * STEP + 700),
    );
  }

  private stopSim(): void {
    this.simTimers.forEach((id) => window.clearTimeout(id));
    this.simTimers = [];
  }

  // ---------- helpers ----------

  private render(html: string): void {
    this.stopTyping();
    this.panel.innerHTML = html;
    this.panel.scrollTop = 0;
  }

  /** Types text into an element letter by letter with Undertale-style blips. */
  private typeOut(el: HTMLElement, text: string, onDone: () => void): void {
    this.stopTyping();
    let i = 0;
    const step = () => {
      i++;
      el.textContent = `* ${text.slice(0, i)}`;
      const ch = text[i - 1];
      if (ch && ch !== ' ' && i % 2 === 1) sfx.blip();
      if (i >= text.length) {
        this.typing = null;
        onDone();
        return;
      }
      this.typing = window.setTimeout(step, /[.,?!]/.test(ch ?? '') ? 140 : 28);
    };
    step();
  }

  private stopTyping(): void {
    if (this.typing !== null) window.clearTimeout(this.typing);
    this.typing = null;
  }

  private runTimer(seconds: number, onDone: () => void): void {
    this.stopTimer();
    const end = performance.now() + seconds * 1000;
    this.clockStart = performance.now();
    this.clockEnd = end;
    const fill = $<HTMLElement>('#timer-fill');
    const secs = $<HTMLElement>('#timer-secs');
    const box = $<HTMLElement>('#timer');
    if (!fill) return;
    let lastSec = Math.ceil(seconds);
    const tick = () => {
      const left = Math.max(0, end - performance.now());
      const sec = Math.ceil(left / 1000);
      fill.style.width = `${(left / (seconds * 1000)) * 100}%`;
      secs.textContent = String(sec);
      box.classList.toggle('low', left < 5000);
      if (sec !== lastSec && sec > 0 && sec <= 5) sfx.tick(sec <= 2);
      lastSec = sec;
      if (left <= 0) {
        this.stopTimer();
        onDone();
      }
    };
    tick();
    this.timer = window.setInterval(tick, 100);
  }

  private stopTimer(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private tickHud(): void {
    const dayEl = $<HTMLElement>('#hud-day');
    const sizeEl = $<HTMLElement>('#hud-size');
    const rankEl = $<HTMLElement>('#hud-rank');
    const loop = () => {
      const roll = this.roll;
      if (roll) {
        // Once a roll is done the ball slips back down, but the HUD keeps the height you reached.
        const pts = roll.finished ? roll.points : this.scene.displayPoints;
        const round = Math.min(roll.roundIndex + (roll.finished ? 0 : 1), roll.categories.length);
        const label = roll.mode === 'custom' ? 'CUSTOM' : `${roll.archive ? 'ARCHIVE' : 'DAILY'} #${roll.number}`;
        dayEl.textContent = `${label} · ${round}/${roll.categories.length}`;
        sizeEl.textContent = formatAltitude(pts);
        rankEl.textContent = rankAt(pts).name.toUpperCase();
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  private async share(): Promise<void> {
    const text = this.roll!.shareText();
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ text });
        sfx.ding();
        return;
      } catch {
        /* fall back to copying */
      }
    }
    this.copy(text, 'Copied to clipboard!');
  }

  private async copy(text: string, msg: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      sfx.ding();
      this.toast(msg);
    } catch {
      window.prompt('Copy this:', text);
    }
  }

  private toast(msg: string): void {
    const t = $<HTMLElement>('#toast');
    t.textContent = msg;
    t.classList.add('show');
    window.setTimeout(() => t.classList.remove('show'), 1800);
  }

  private countdown(): string {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const s = Math.max(0, Math.floor((midnight.getTime() - now.getTime()) / 1000));
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  }

  private prettyDate(key: string): string {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  private buildHowTo(): void {
    const rows = TIER_IDS.map((id) => {
      const t = TIERS[id];
      return `<tr><td><span class="swatch" style="--tier:${t.color}">${esc(t.label)}</span><small>${esc(t.temp)}</small></td>
        <td>${esc(t.blurb)}</td><td class="pts">+${t.points} m</td></tr>`;
    }).join('');
    const dlg = $<HTMLDialogElement>('#howto');
    dlg.innerHTML = `
      <div class="stack">
        <h2>How to play</h2>
        ${say('<b>Daily Roll</b>: 7 prompts a day, the same for everyone. <b>Custom Roll</b>: you pick the categories, play as often as you like.')}
        ${say('Type an answer before time runs out (25 s). Wrong answers just buzz — keep trying until you get one or the clock hits zero.')}
        ${say('Every right answer pushes your snowball up the mountain, and <b>rarer (colder) answers push it further</b>: up to 100 m for an Absolute Zero (only 1–2 exist per category!). Seven perfect answers reach <b>700 m — space</b>. Like Sisyphus, the ball always slips back down at the end. One must imagine the snowman happy.')}
        <table class="tier-table">${rows}</table>
        ${say('Small typos are fine. Click the penguin. Click your snowman. You know you want to.', 'muted')}
        <div class="center"><button class="menu" id="close-howto">GOT IT</button></div>
      </div>`;
    dlg.querySelector('#close-howto')!.addEventListener('click', () => dlg.close());
  }
}
