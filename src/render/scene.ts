import { hashString, mulberry32 } from '../core/rng';
import { ARTIFACTS, PENGUIN, POLAR_BEAR, spriteCanvas } from './sprites';

// The snowman pushes its snowball up an endless icy slope, Sisyphus-style. Points are metres
// climbed: the higher you get, the further the valley drops away — clouds, then stars, then space,
// where astronaut penguins float around the summit. Every roll ends with the ball slipping back down.

const TARGET_HEIGHT = 240;
const SLOPE = (17 * Math.PI) / 180;
const TAN = Math.tan(SLOPE);
const SIN = Math.sin(SLOPE);
const COS = Math.cos(SLOPE);
/** Vertical pixels per metre climbed. */
const PX_PER_M = 0.5;
/** Flat bit on top of the summit where the ball rests. */
const PLATEAU = 26;
/** Avatar PNGs are 64×64; the snowman's right edge sits ~56px in, feet on row 62. */
const AV_RIGHT = 56;
const AV_FEET = 62;
const SUMMIT_HOLD = 2;

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
const css = (c: RGB, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));

/** Sky by altitude: 0 = valley morning … 1 = space. */
const SKY: { at: number; top: RGB; bottom: RGB }[] = [
  { at: 0, top: [111, 183, 230], bottom: [216, 241, 255] },
  { at: 0.35, top: [74, 138, 214], bottom: [176, 214, 246] },
  { at: 0.6, top: [34, 56, 126], bottom: [118, 138, 206] },
  { at: 0.8, top: [10, 14, 40], bottom: [38, 50, 108] },
  { at: 1, top: [2, 3, 10], bottom: [10, 14, 34] },
];
function skyAt(a: number): { top: RGB; bottom: RGB } {
  for (let i = 1; i < SKY.length; i++) {
    if (a <= SKY[i].at) {
      const t = (a - SKY[i - 1].at) / (SKY[i].at - SKY[i - 1].at);
      return { top: mix(SKY[i - 1].top, SKY[i].top, t), bottom: mix(SKY[i - 1].bottom, SKY[i].bottom, t) };
    }
  }
  return SKY[SKY.length - 1];
}

const NIGHT: RGB = [8, 10, 34];
const SNOW = { top: [250, 252, 255] as RGB, body: [236, 244, 251] as RGB, shade: [205, 222, 236] as RGB };
const ICE = { top: [222, 248, 255] as RGB, body: [176, 226, 246] as RGB, shade: [128, 190, 226] as RGB };
/** The summit: black glacier ice, moonlit edges. */
const OBSIDIAN = { top: [104, 126, 196] as RGB, body: [16, 20, 44] as RGB, shade: [34, 44, 90] as RGB };
const GLOW_A: RGB = [127, 232, 255];
const GLOW_B: RGB = [184, 140, 255];

/** The Ice Crown that waits on the summit (one character = one pixel). */
const ICE_CROWN = [
  '........w........',
  '.......wcw.......',
  '..w....cbc....w..',
  '.wcw...cbc...wcw.',
  '.cbc..wcbcw..cbc.',
  '.cbc.wcbbbcw.cbc.',
  '.cbbccbbbbbccbbc.',
  '.cbbbbbgbgbbbbbc.',
  'occccccccccccccco',
  'owwwwwwwwwwwwwwwo',
  '.ooooooooooooooo.',
];
const ICE_CROWN_COLORS: Record<string, string> = {
  o: '#183260',
  c: '#7fe8ff',
  b: '#46a0dc',
  w: '#f0fcff',
  g: '#b88cff',
};

/** Draws a filled pixel circle, optionally clipped to another circle. */
function fillCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  within?: { cx: number; cy: number; r: number },
): void {
  ctx.fillStyle = color;
  const R = Math.max(0, r);
  for (let dy = -Math.floor(R); dy <= Math.floor(R); dy++) {
    const half = Math.floor(Math.sqrt(R * R - dy * dy));
    let x0 = cx - half;
    let x1 = cx + half;
    if (within) {
      const wy = cy + dy - within.cy;
      if (Math.abs(wy) > within.r) continue;
      const wh = Math.floor(Math.sqrt(within.r * within.r - wy * wy));
      x0 = Math.max(x0, within.cx - wh);
      x1 = Math.min(x1, within.cx + wh);
      if (x1 < x0) continue;
    }
    ctx.fillRect(x0, cy + dy, x1 - x0 + 1, 1);
  }
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  gravity: number;
}
interface Flake {
  x: number;
  y: number;
  speed: number;
  drift: number;
  size: number;
  /** Behind the mountain (small, slow) or in front. */
  back: boolean;
}
interface Shooter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/** End-of-roll sequence: (summit hold →) teeter → fall → burst → fade back to the valley. */
type Phase = 'wait' | 'summit' | 'teeter' | 'fall' | 'burst' | 'fade';

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private W = 160;
  private H = TARGET_HEIGHT;
  private scale = 3;
  private t = 0;
  private last = 0;

  /** Points = metres. The summit is the roll's maximum (700 for a daily). */
  private summit = 700;
  private targetPoints = 0;
  private shownPoints = 0;
  /** Ball contact point, world x (world y is up, in px). */
  private ballX = 6;
  private tween: { p0: number; p1: number; x0: number; x1: number; t: number; dur: number } | null = null;
  private vx = 0;
  private rolled = 0;
  private lastBallX = 6;
  private camX = 0;
  private camY = 0;

  private strain = false;
  private wobbleT = -1;
  private seq: { phase: Phase; t: number; summit: boolean; manX: number; onDone?: () => void } | null = null;
  private ballHidden = false;
  private flagRise = 0;
  private fade = 0;
  private faceLeft = false;
  /** 0 = Ice Crown hovering over the summit … 1 = on the snowman's head. */
  private crownLand = 0;
  private jumped = false;

  private avatar: HTMLImageElement | null = null;
  private spin = 0;
  private avatarBox = { x: 0, y: 0, w: 0, h: 0 };
  private particles: Particle[] = [];
  private flakes: Flake[] = [];
  private stars: { x: number; y: number; tw: number; big: boolean }[] = [];
  private clouds: { alt: number; x: number; w: number }[] = [];
  private ballCache = new Map<number, HTMLCanvasElement>();
  private nebula: HTMLCanvasElement;
  /** Rocks, dirt and sand embedded in the mountain, regenerated when the summit height changes. */
  private features: { summit: number; list: { x: number; kind: 'rock' | 'dirt' | 'pebbles' | 'sand'; size: number; depth: number; seed: number }[] } | null = null;

  // Rarity mood (rare answers darken the sky and bring out stars).
  private moodStars: { x: number; y: number; tw: number; big: boolean; tint: boolean }[] = [];
  private shooters: Shooter[] = [];
  private mood = 0;
  private targetMood = 0;
  private moodLevel = -1;
  private moodTint: RGB = [255, 255, 255];
  private flash = 0;

  /** Rolling noise: level 0..1 (speed), size 0..1. */
  onRoll: ((level: number, size: number) => void) | null = null;
  /** The ball reached the summit (play the fanfare). */
  onSummit: (() => void) | null = null;
  /** The ball started slipping back down. */
  onSlip: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    const rand = mulberry32(hashString('snow'));
    for (let i = 0; i < 520; i++) {
      const back = i % 2 === 0;
      this.flakes.push({ x: rand(), y: rand(), speed: 0.03 + rand() * 0.06, drift: rand() * 6, size: !back && rand() < 0.25 ? 2 : 1, back });
    }
    this.nebula = this.makeNebula(rand);
    for (let i = 0; i < 160; i++) this.stars.push({ x: rand(), y: rand() * 0.9, tw: rand() * 6, big: rand() < 0.1 });
    for (let i = 0; i < 280; i++) {
      this.moodStars.push({ x: rand(), y: rand() * 0.9, tw: rand() * 6, big: rand() < 0.15, tint: rand() < 0.3 });
    }
    for (let i = 0; i < 9; i++) this.clouds.push({ alt: 0.28 + rand() * 0.32, x: rand() * 600, w: 22 + rand() * 30 });
    this.placeBall(0, true);
  }

  /** Points currently shown by the animation (for the HUD counter). */
  get displayPoints(): number {
    return Math.round(this.shownPoints);
  }

  setAvatar(src: string): void {
    const img = new Image();
    img.onload = () => (this.avatar = img);
    img.src = src;
  }

  /** Points = metres climbed; `summit` is the roll's maximum. `instant` jumps without animating. */
  setState(points: number, summit = this.summit, instant = false): void {
    this.summit = Math.max(100, summit);
    if (instant) {
      this.seq = null;
      this.ballHidden = false;
      this.fade = 0;
      this.flagRise = 0;
      this.crownLand = 0;
      this.faceLeft = false;
      this.wobbleT = -1;
      this.placeBall(points, true);
      return;
    }
    if (points === this.targetPoints && !this.tween) return;
    const gain = Math.abs(points - this.shownPoints);
    this.tween = {
      p0: this.shownPoints,
      p1: points,
      x0: this.ballX,
      x1: this.ballXFor(points),
      t: 0,
      dur: 0.7 + Math.min(1.9, (gain / 100) * 1.5),
    };
    this.targetPoints = points;
  }

  /** Snowflake burst around the ball, tinted by tier. */
  celebrate(color: string, amount = 24): void {
    const { cx, cy, r } = this.ballGeometry();
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 25 + Math.random() * 55;
      this.particles.push({
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 20,
        life: 1.2,
        color: Math.random() < 0.5 ? color : '#ffffff',
        gravity: 40,
      });
    }
  }

  /** Sad little puff of snow (miss / timeout). */
  puff(): void {
    const { cx, cy, r } = this.ballGeometry();
    for (let i = 0; i < 18; i++) {
      this.particles.push({
        x: cx + (Math.random() - 0.5) * r * 2,
        y: cy + r - 1,
        vx: (Math.random() - 0.5) * 40,
        vy: -10 - Math.random() * 30,
        life: 0.8,
        color: '#c5d6e6',
        gravity: 60,
      });
    }
  }

  /** Time ran out: the ball slides back a little before the snowman catches it. */
  wobble(): void {
    this.wobbleT = 0;
  }

  /** Keep straining against the ball (the drumroll before a reveal). */
  setRolling(on: boolean): void {
    this.strain = on;
  }

  /**
   * End of a roll: the ball slips back to the valley (after a 2 s summit moment if it got to the top),
   * bursts, and everything starts again. Waits for any running push to finish first.
   */
  slip(onDone?: () => void): void {
    this.seq = { phase: 'wait', t: 0, summit: false, manX: 0, onDone };
  }

  /**
   * Rarity mood after a reveal: level 0 (most common) … 4 (rarest) darkens the sky and brings out stars;
   * null clears it. `color` tints some of the stars.
   */
  setMood(level: number | null, color = '#ffffff'): void {
    this.moodLevel = level ?? -1;
    this.targetMood = level === null ? 0 : [0, 0.25, 0.5, 0.75, 1][Math.max(0, Math.min(4, level))];
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
    if (m) this.moodTint = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    if (level === 4) this.flash = 1;
  }

  /** True if a page coordinate is on the snowman. */
  isOnSnowman(clientX: number, clientY: number): boolean {
    const x = clientX / this.scale;
    const y = clientY / this.scale;
    const b = this.avatarBox;
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  }

  /** Spin the snowman around its vertical axis. */
  spinSnowman(): void {
    this.spin = 0.7;
  }

  start(): void {
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
      this.last = now;
      this.update(dt);
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---------- world ----------

  private get topPx(): number {
    return this.summit * PX_PER_M;
  }
  private get summitX(): number {
    return this.topPx / TAN;
  }
  private altToX(m: number): number {
    return (Math.min(m, this.summit) * PX_PER_M) / TAN;
  }
  /** Where the ball rests for a score: on the slope, or the middle of the summit plateau. */
  private ballXFor(points: number): number {
    return points >= this.summit ? this.summitX + PLATEAU / 2 : Math.max(6, this.altToX(points));
  }
  /** Ground height (px, up) at world x. */
  private groundAt(wx: number): number {
    const xs = this.summitX;
    if (wx <= 0) return 0;
    if (wx <= xs) return wx * TAN;
    if (wx <= xs + PLATEAU) return this.topPx;
    return Math.max(0, this.topPx - (wx - xs - PLATEAU) * 1.4);
  }
  private isFlat(wx: number): boolean {
    return wx <= 0 || (wx > this.summitX && wx <= this.summitX + PLATEAU);
  }

  private placeBall(points: number, snapCamera: boolean): void {
    this.tween = null;
    this.targetPoints = points;
    this.shownPoints = points;
    this.ballX = this.ballXFor(points);
    this.lastBallX = this.ballX;
    this.vx = 0;
    if (snapCamera) {
      this.camX = this.ballX;
      this.camY = this.groundAt(this.ballX);
    }
  }

  // ---------- layout ----------

  private resize(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.scale = Math.max(1, Math.round(Math.min(vh / TARGET_HEIGHT, vw / 160)));
    this.W = Math.ceil(vw / this.scale);
    this.H = Math.ceil(vh / this.scale);
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.canvas.style.width = `${this.W * this.scale}px`;
    this.canvas.style.height = `${this.H * this.scale}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  private get rMax(): number {
    return Math.floor(Math.min(this.H * 0.17, this.W * 0.2));
  }
  /** Grows a little faster than linearly, so late big answers still make big jumps. */
  private radiusFor(points: number): number {
    return 4 + (this.rMax - 4) * Math.pow(clamp01(points / this.summit), 1.25);
  }
  private get anchorX(): number {
    return Math.max(Math.round(this.W * 0.56), Math.round(this.rMax * 1.6) + AV_RIGHT);
  }
  private get anchorY(): number {
    return Math.round(this.H * 0.42);
  }
  private sx(wx: number): number {
    return Math.round(wx - this.camX + this.anchorX);
  }
  private sy(wy: number): number {
    return Math.round(this.anchorY - (wy - this.camY));
  }
  /** Camera altitude as a share of the summit (0 valley … 1 space). */
  private get alt01(): number {
    return clamp01(this.camY / this.topPx);
  }

  private ballGeometry(): { cx: number; cy: number; r: number } {
    const r = Math.round(this.radiusFor(this.shownPoints));
    const flat = this.isFlat(this.ballX);
    const wcx = this.ballX - (flat ? 0 : r * SIN);
    const wcy = this.groundAt(this.ballX) + (flat ? r : r * COS);
    return { cx: this.sx(wcx), cy: this.sy(wcy), r };
  }

  // ---------- update ----------

  private update(dt: number): void {
    this.t += dt;
    this.spin = Math.max(0, this.spin - dt);
    this.flash = Math.max(0, this.flash - dt * 1.6);
    const mk = this.targetMood > this.mood ? 2.5 : 1.2;
    this.mood += (this.targetMood - this.mood) * (1 - Math.exp(-dt * mk));

    let rollLevel = 0;

    // Pushing up: eased tween of both the score and the ball's position.
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt;
      const k = easeInOut(tw.t / tw.dur);
      this.shownPoints = tw.p0 + (tw.p1 - tw.p0) * k;
      this.ballX = tw.x0 + (tw.x1 - tw.x0) * k;
      rollLevel = Math.sin(Math.PI * clamp01(tw.t / tw.dur)) * clamp01(Math.abs(tw.x1 - tw.x0) / 60);
      if (tw.t >= tw.dur) {
        this.shownPoints = tw.p1;
        this.ballX = tw.x1;
        this.tween = null;
      }
      if (Math.random() < dt * 25) this.kickSnow(-1);
    }

    this.updateSequence(dt);
    if (this.seq?.phase === 'fall') rollLevel = clamp01(Math.abs(this.vx) / 260);
    if (this.strain && !this.seq) rollLevel = Math.max(rollLevel, 0.18);

    // Distance rolled turns the ball (specks); direction matters.
    const dx = this.ballX - this.lastBallX;
    this.rolled += dx / (this.isFlat(this.ballX) ? 1 : COS);
    this.lastBallX = this.ballX;

    // Camera follows the ball with a little lag (more when it's falling fast).
    const lag = this.seq?.phase === 'fall' ? 3.2 : 4.5;
    const k = 1 - Math.exp(-dt * lag);
    this.camX += (this.ballX - this.camX) * k;
    this.camY += (this.groundAt(this.ballX) - this.camY) * k;

    if (this.wobbleT >= 0) {
      this.wobbleT += dt;
      if (this.wobbleT > 0.9) this.wobbleT = -1;
    }
    if (this.strain && Math.random() < dt * 20) this.kickSnow(-1);

    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.95;
      p.vy += p.gravity * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    // Snow: the wind picks up with altitude; the back layer is slower (parallax).
    const alt = this.alt01;
    for (const f of this.flakes) {
      const depth = f.back ? 0.55 : f.size === 2 ? 1.3 : 1;
      f.y += f.speed * dt * depth * (1 + alt * 0.8);
      f.x += (Math.sin(this.t + f.drift) * 0.004 - (0.006 + alt * 0.05) * dt - (dx / this.W) * 0.8) * depth;
      if (f.y > 1) f.y -= 1;
      f.x = ((f.x % 1) + 1) % 1;
    }
    // Faint glowing motes rise around the summit.
    if (alt > 0.8 && Math.random() < dt * 14 * smooth(0.8, 0.95, alt)) {
      this.particles.push({
        x: Math.random() * this.W,
        y: this.anchorY + 10 + Math.random() * 30,
        vx: (Math.random() - 0.5) * 6,
        vy: -6 - Math.random() * 10,
        life: 2.5 + Math.random() * 1.5,
        color: Math.random() < 0.5 ? css(GLOW_A) : css(GLOW_B),
        gravity: -1,
      });
    }

    const rate = this.moodLevel >= 4 ? 2.2 : this.moodLevel === 3 ? 0.6 : 0;
    if (rate && Math.random() < dt * rate * this.mood) {
      this.shooters.push({ x: Math.random() * this.W * 0.9 + this.W * 0.1, y: Math.random() * this.anchorY * 0.4, vx: -90 - Math.random() * 60, vy: 35 + Math.random() * 25, life: 0.7 });
    }
    for (const sh of this.shooters) {
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      sh.life -= dt;
    }
    this.shooters = this.shooters.filter((sh) => sh.life > 0);

    this.onRoll?.(this.ballHidden ? 0 : rollLevel, this.radiusFor(this.shownPoints) / this.rMax);
  }

  private updateSequence(dt: number): void {
    const s = this.seq;
    if (!s) return;
    s.t += dt;
    switch (s.phase) {
      case 'wait':
        // Let the last push finish, then take a breath.
        if (this.tween) s.t = 0;
        else if (s.t > 0.9) {
          s.summit = this.shownPoints >= this.summit;
          s.manX = this.manX();
          if (s.summit) {
            this.go('summit');
            this.celebrate('#ffe27a', 50);
            this.onSummit?.();
          } else this.go('teeter');
        }
        break;
      case 'summit':
        this.flagRise = clamp01(s.t / 0.6);
        this.crownLand = clamp01((s.t - 0.2) / 1.3);
        if (s.t > SUMMIT_HOLD) this.go('teeter');
        break;
      case 'teeter':
        if (s.t > 0.8) {
          this.jumped = false;
          this.vx = s.summit ? -30 : -10;
          this.go('fall');
          this.onSlip?.();
        }
        break;
      case 'fall': {
        // Gravity along the slope, friction on the flat; capped so the camera keeps up.
        const flat = this.isFlat(this.ballX);
        const ax = flat ? (this.ballX <= 0 ? 90 : -40) : -520 * SIN * COS;
        this.vx = Math.max(-430, Math.min(0, this.vx + ax * dt));
        this.ballX += this.vx * dt;
        if (s.t > 0.35) this.faceLeft = true;
        const man = s.manX + 32;
        if (this.spin <= 0 && Math.abs(this.ballX - man) < this.radiusFor(this.shownPoints) + 6 && !this.jumped) {
          this.spin = 0.7;
          this.jumped = true;
        }
        if (Math.random() < dt * 40) this.kickSnow(1);
        if ((this.ballX < -30 && this.vx > -35) || this.ballX < -170) {
          this.puffAtBall(40);
          this.ballHidden = true;
          this.go('burst');
        }
        break;
      }
      case 'burst':
        if (s.t > 0.45) this.go('fade');
        break;
      case 'fade':
        this.fade = s.t < 0.45 ? s.t / 0.45 : Math.max(0, 1 - (s.t - 0.45) / 0.55);
        if (s.t >= 0.45 && this.ballHidden) {
          // Back to the valley with a fresh little snowball.
          this.ballHidden = false;
          this.flagRise = 0;
          this.crownLand = 0;
          this.faceLeft = false;
          this.mood = this.targetMood = 0;
          this.placeBall(0, true);
        }
        if (s.t > 1) {
          this.fade = 0;
          const done = s.onDone;
          this.seq = null;
          this.spin = 0.7;
          done?.();
        }
        break;
    }
  }

  private go(phase: Phase): void {
    if (this.seq) {
      this.seq.phase = phase;
      this.seq.t = 0;
    }
  }

  private kickSnow(dir: number): void {
    const { cx, cy, r } = this.ballGeometry();
    this.particles.push({
      x: cx - dir * r * 0.5 + (Math.random() - 0.5) * r * 0.4,
      y: cy + r - 1,
      vx: dir * (20 + Math.random() * 30),
      vy: -15 - Math.random() * 25,
      life: 0.5,
      color: Math.random() < 0.5 ? '#ffffff' : '#c5d6e6',
      gravity: 80,
    });
  }

  private puffAtBall(n: number): void {
    const { cx, cy, r } = this.ballGeometry();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 20 + Math.random() * 70;
      this.particles.push({
        x: cx + Math.cos(a) * r * Math.random(),
        y: cy + Math.sin(a) * r * Math.random(),
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 30,
        life: 0.9 + Math.random() * 0.4,
        color: Math.random() < 0.6 ? '#ffffff' : '#c5d6e6',
        gravity: 90,
      });
    }
  }

  /** Snowman's feet (world x, left edge of the sprite): just behind the ball, or where it was left standing. */
  private manX(): number {
    const s = this.seq;
    if (s && (s.phase === 'fall' || s.phase === 'burst' || (s.phase === 'fade' && this.ballHidden))) return s.manX;
    const r = this.radiusFor(this.shownPoints);
    return this.ballX - r * 0.85 - AV_RIGHT + 3 + this.wobbleOffset();
  }

  /** Forward lean while pushing up the slope, as pixels of shift per pixel of height (0 = upright). */
  private leanFor(feetWX: number): number {
    const falling = this.seq && ['fall', 'burst', 'fade'].includes(this.seq.phase);
    return this.isFlat(feetWX) || falling ? 0 : 0.07;
  }

  /** How high the snowman is off the ground: a small hop when clicked, a big leap out of a runaway ball's way. */
  private hop(): number {
    if (this.spin <= 0) return 0;
    const falling = this.seq && ['fall', 'burst', 'fade'].includes(this.seq.phase);
    const height = falling && this.jumped ? this.radiusFor(this.shownPoints) + 14 : 6;
    return Math.round(Math.sin((this.spin / 0.7) * Math.PI) * height);
  }

  /** Ball slides back and gets caught (timeout), or teeters on the edge before falling. */
  private wobbleOffset(): number {
    if (this.wobbleT >= 0) return -10 * Math.sin(Math.PI * (this.wobbleT / 0.9));
    if (this.seq?.phase === 'teeter') return Math.sin(this.seq.t * 16) * Math.min(3, this.seq.t * 6);
    if (this.strain && !this.seq) return Math.sin(this.t * 18) * 1.2;
    return 0;
  }

  // ---------- draw ----------

  private draw(): void {
    const a = this.alt01;
    this.drawSky(a);
    this.drawCelestial(a);
    this.drawMoodSky();
    this.drawRidges(a);
    this.drawClouds();
    this.drawSnowfall(a, true);
    this.drawTerrain();
    this.drawTerrainFeatures();
    this.drawBaseCamp();
    this.drawFlags();
    this.drawSpacePenguins(a);
    this.drawMist(a);
    this.drawRoller();
    this.drawCrown();
    this.drawParticles();
    this.drawSnowfall(a, false);
    this.drawVignette(a);
    const { ctx, W, H } = this;
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(235,228,255,${this.flash * 0.55})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(232,242,255,${this.fade})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  private dim(c: RGB): string {
    return css(mix(c, NIGHT, this.mood * 0.5));
  }

  private drawSky(a: number): void {
    const { ctx, W, H } = this;
    const sky = skyAt(a);
    const BAND = 5;
    let prev: string | null = null;
    for (let y = 0; y < H; y++) {
      const band = Math.floor(y / BAND);
      const color = css(mix(sky.top, sky.bottom, clamp01((band * BAND) / (H * 0.6))));
      ctx.fillStyle = color;
      ctx.fillRect(0, y, W, 1);
      if (prev && color !== prev && y % BAND === 0) {
        ctx.fillStyle = prev;
        for (let x = y & 1; x < W; x += 2) ctx.fillRect(x, y, 1, 1);
      }
      prev = color;
    }
  }

  private drawCelestial(a: number): void {
    const { ctx, W, H } = this;
    // Stars come out as the air thins.
    const night = smooth(0.42, 0.8, a);
    if (night > 0) {
      for (const s of this.stars) {
        const al = night * (0.55 + 0.45 * Math.sin(this.t * 2 + s.tw));
        const x = Math.round(s.x * W);
        const y = Math.round(s.y * H * 0.7);
        ctx.fillStyle = `rgba(255,255,255,${al})`;
        ctx.fillRect(x, y, 1, 1);
        if (s.big && night > 0.6) {
          ctx.fillStyle = `rgba(255,255,255,${al * 0.5})`;
          ctx.fillRect(x - 1, y, 3, 1);
          ctx.fillRect(x, y - 1, 1, 3);
        }
      }
    }
    // Aurora on the way up to space.
    const aurora = smooth(0.62, 0.8, a) * (1 - smooth(0.92, 1, a) * 0.6);
    if (aurora > 0) {
      for (let x = 0; x < W; x++) {
        const y = Math.round(H * 0.1 + Math.sin(x * 0.03 + this.t * 0.4) * 8 + Math.sin(x * 0.011 - this.t * 0.25) * 6);
        const c: RGB = mix([125, 255, 176], [190, 140, 255], x / W);
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = css(c, aurora * (0.3 - i * 0.065));
          ctx.fillRect(x, y + i * 5, 1, 5);
        }
      }
    }
    // A dim nebula hangs over the top of the world.
    const neb = smooth(0.7, 0.95, a);
    if (neb > 0) {
      ctx.globalAlpha = neb * 0.75;
      ctx.drawImage(this.nebula, Math.round(W * 0.5 - this.nebula.width / 2), Math.round(H * 0.02));
      ctx.globalAlpha = 1;
    }
    // Sun in the valley; the moon grows as you climb.
    const sunA = 1 - smooth(0.3, 0.6, a);
    if (sunA > 0) fillCircle(ctx, Math.round(W * 0.2), Math.round(H * 0.12), 9, css([255, 244, 194], sunA));
    const moonA = smooth(0.3, 0.6, a);
    if (moonA > 0) {
      const r = Math.round(5 + smooth(0.3, 1, a) * 19);
      const mx = Math.round(W * 0.8);
      const my = Math.round(H * 0.06 + r);
      fillCircle(ctx, mx, my, r, css([236, 240, 248], moonA));
      const crater = css([196, 204, 220], moonA);
      fillCircle(ctx, mx - Math.round(r * 0.35), my - Math.round(r * 0.2), Math.max(1, r * 0.22), crater);
      fillCircle(ctx, mx + Math.round(r * 0.3), my + Math.round(r * 0.3), Math.max(1, r * 0.16), crater);
      fillCircle(ctx, mx + Math.round(r * 0.1), my - Math.round(r * 0.5), Math.max(1, r * 0.1), crater);
    }
  }

  /** Rare-answer night: darker sky, more (and brighter) stars, shooting stars, aurora for Absolute Zero. */
  private drawMoodSky(): void {
    const m = this.mood;
    if (m < 0.01) return;
    const { ctx, W, H } = this;
    const gy = this.anchorY;
    ctx.fillStyle = `rgba(6,8,30,${m * 0.85})`;
    ctx.fillRect(0, 0, W, H);

    const count = Math.floor(this.moodStars.length * m);
    for (let i = 0; i < count; i++) {
      const s = this.moodStars[i];
      const al = clamp01(m * 1.6) * (0.6 + 0.4 * Math.sin(this.t * (2 + m * 2) + s.tw));
      if (al <= 0.02) continue;
      const x = Math.round(s.x * W);
      const y = Math.round(s.y * gy * 0.85);
      ctx.fillStyle = s.tint ? css(this.moodTint, al) : `rgba(255,255,255,${al})`;
      ctx.fillRect(x, y, 1, 1);
      if (s.big && m > 0.3) {
        const arm = m > 0.9 && al > 0.75 ? 2 : 1;
        ctx.fillStyle = s.tint ? css(this.moodTint, al * 0.7) : `rgba(255,255,255,${al * 0.7})`;
        ctx.fillRect(x - arm, y, arm * 2 + 1, 1);
        ctx.fillRect(x, y - arm, 1, arm * 2 + 1);
      }
    }

    for (const sh of this.shooters) {
      const al = clamp01(sh.life / 0.7);
      for (let i = 0; i < 8; i++) {
        const k = i / 8;
        ctx.fillStyle = `rgba(255,255,255,${al * (1 - k)})`;
        ctx.fillRect(Math.round(sh.x - sh.vx * k * 0.08), Math.round(sh.y - sh.vy * k * 0.08), 1, 1);
      }
    }

    const aurora = clamp01((m - 0.8) * 5);
    if (aurora > 0) {
      for (let x = 0; x < W; x++) {
        const y = Math.round(gy * 0.12 + Math.sin(x * 0.04 + this.t * 0.7) * 9 + Math.sin(x * 0.013 - this.t * 0.4) * 7);
        const c: RGB = mix([190, 140, 255], [125, 255, 176], (Math.sin(x * 0.02 + this.t) + 1) / 2);
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = css(c, aurora * (0.4 - i * 0.07));
          ctx.fillRect(x, y + i * 5, 1, 5);
        }
      }
    }
  }

  /** Far-away mountains sink below you as you climb. */
  private drawRidges(a: number): void {
    const { ctx, W, H } = this;
    const sky = skyAt(a).bottom;
    const layers: { par: number; amp: number; base: number; col: RGB; seed: number }[] = [
      { par: 0.05, amp: 0.2, base: 0.02, col: [169, 195, 221], seed: 1 },
      { par: 0.12, amp: 0.13, base: 0.06, col: [138, 166, 196], seed: 2 },
    ];
    for (const L of layers) {
      const baseY = this.anchorY + H * L.base + a * H * 1.1;
      if (baseY - H * L.amp > H) continue;
      ctx.fillStyle = this.dim(mix(L.col, sky, 0.35));
      for (let x = 0; x < W; x++) {
        const wx = x + this.camX * L.par + L.seed * 1000;
        const h = H * L.amp * (0.55 + 0.25 * Math.sin(wx * 0.021) + 0.15 * Math.sin(wx * 0.057 + L.seed) + 0.05 * Math.sin(wx * 0.13));
        const top = Math.round(baseY - h);
        ctx.fillRect(x, top, 1, Math.max(0, H - top));
      }
    }
  }

  /** You climb through a cloud layer between ~30% and ~60% of the way up. */
  private drawClouds(): void {
    const { ctx, W } = this;
    for (const c of this.clouds) {
      const y = this.sy(c.alt * this.topPx);
      if (y < -20 || y > this.H + 20) continue;
      const span = W + 120;
      const x = Math.round((((c.x - this.camX * 0.7) % span) + span) % span) - 60;
      const w = Math.round(c.w);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(x, y, w, 4);
      ctx.fillRect(x + 4, y - 3, w - 10, 3);
      ctx.fillRect(x + Math.round(w * 0.3), y - 6, Math.round(w * 0.35), 3);
      ctx.fillStyle = 'rgba(205,222,236,0.8)';
      ctx.fillRect(x + 2, y + 4, w - 4, 1);
    }
  }

  /**
   * The Ice Crown hovers over the summit, glowing. When the ball makes it to the top it floats down
   * onto the snowman's head (the Ice Crown skin is the reward for 7/7 Absolute Zeros).
   */
  private drawCrown(): void {
    const { ctx } = this;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 1.6);
    // Resting spot: high above the summit, clear of even the biggest snowball.
    const restX = this.sx(this.summitX + PLATEAU / 2);
    // Kept on screen so it reads as the goal while you push the last stretch.
    const restY = Math.max(18, this.sy(this.topPx + this.rMax * 2 + 22)) + Math.round(Math.sin(this.t * 1.2) * 3);
    // On the head: the snowman's head top, following its lean.
    const feetWX = this.manX() + 32;
    const feetX = this.sx(feetWX);
    const feetY = this.sy(this.groundAt(feetWX));
    const headX = feetX + Math.round(50 * this.leanFor(feetWX)) * (this.faceLeft ? -1 : 1);
    const headY = feetY - 50 - this.hop();
    const k = easeInOut(this.crownLand);
    const cx = Math.round(restX + (headX - restX) * k);
    const cy = Math.round(restY + (headY - restY) * k);
    if (cx < -20 || cx > this.W + 20 || cy < -20 || cy > this.H + 20) return;
    // Cold halo.
    for (let r = 13; r >= 3; r -= 3) fillCircle(ctx, cx, cy - 5, r, css(GLOW_A, (0.04 + 0.05 * pulse) * (1 - r / 16)));
    const w = ICE_CROWN[0].length;
    const h = ICE_CROWN.length;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = ICE_CROWN_COLORS[ICE_CROWN[y][x]];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(cx - (w >> 1) + x, cy - h + y, 1, 1);
      }
    }
    // A glint that travels along the spikes.
    const gx = cx - (w >> 1) + Math.floor(((this.t * 6) % (w + 10))) - 5;
    if (gx >= cx - (w >> 1) && gx < cx + (w >> 1)) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(gx, cy - h + 4, 1, 3);
    }
    if (Math.random() < 0.15) {
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 18,
        y: cy - 6 + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 8,
        vy: -4 - Math.random() * 6,
        life: 0.9,
        color: Math.random() < 0.5 ? '#ffffff' : css(GLOW_A),
        gravity: 0,
      });
    }
  }

  private drawTerrain(): void {
    const { ctx, W, H } = this;
    const top = this.topPx;
    for (let x = 0; x < W; x++) {
      const wx = x - this.anchorX + this.camX;
      const h = this.groundAt(wx);
      const y = this.sy(h);
      if (y >= H) continue;
      // Snow → blue ice → black glacier ice near the summit.
      const ice = smooth(0.5, 0.8, h / top);
      const ob = smooth(0.8, 0.96, h / top);
      const tone = (k: 'top' | 'body' | 'shade') => this.dim(mix(mix(SNOW[k], ICE[k], ice), OBSIDIAN[k], ob));
      ctx.fillStyle = tone('top');
      ctx.fillRect(x, y, 1, 2);
      ctx.fillStyle = tone('body');
      ctx.fillRect(x, y + 2, 1, H - y - 2);
      // Shading speckles and cracks fixed to the world, so they scroll with it.
      const wxi = Math.floor(wx);
      ctx.fillStyle = tone('shade');
      for (let d = 7 + ((((wxi * 7) % 5) + 5) % 5); d < H - y; d += 9) {
        if (((wxi + d) & 3) === 0) ctx.fillRect(x, y + d, 1, 1);
      }
      // Frozen layers: faint bands that follow the slope through the ice.
      if (ice > 0.25) {
        ctx.fillStyle = this.dim(mix(mix(SNOW.shade, ICE.shade, ice), OBSIDIAN.shade, ob));
        for (const depth of [12, 27, 45]) {
          const wob = Math.round(Math.sin(wx * 0.045 + depth) * 2 + Math.sin(wx * 0.013) * 3);
          if (((wxi + depth) % 9) !== 0) ctx.fillRect(x, y + depth + wob, 1, 1);
        }
      }
      if (ob > 0.3 && (wxi % 17 === 0 || wxi % 29 === 0 || wxi % 41 === 0)) {
        // Glowing fissures in the black ice.
        const glow = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(this.t * 1.4 + wxi * 0.7));
        ctx.fillStyle = css(wxi % 2 ? GLOW_A : GLOW_B, glow * ob);
        const len = 3 + (Math.abs(wxi) % 7);
        ctx.fillRect(x, y + 3, 1, len);
        ctx.fillRect(x + (wxi % 3 === 0 ? 1 : -1), y + 3 + len, 1, 3);
      } else if (ice > 0.4 && ob < 0.5 && (wxi % 23 === 0 || wxi % 37 === 0)) {
        ctx.fillStyle = this.dim([110, 170, 210]);
        ctx.fillRect(x, y + 3, 1, 5);
      }
    }
  }

  private terrainFeatures() {
    if (this.features?.summit === this.summit) return this.features.list;
    const rand = mulberry32(hashString(`rocks:${this.summit}`));
    const list: { x: number; kind: 'rock' | 'dirt' | 'pebbles' | 'sand'; size: number; depth: number; seed: number }[] = [];
    for (let x = -220; x < this.summitX + 160; x += 16 + Math.floor(rand() * 34)) {
      const r = rand();
      const kind = r < 0.32 ? 'rock' : r < 0.55 ? 'dirt' : r < 0.8 ? 'pebbles' : 'sand';
      const exposed = kind === 'rock' && rand() < 0.45;
      list.push({ x, kind, size: 3 + Math.floor(rand() * 6), depth: exposed ? -2 : 3 + Math.floor(rand() * 16), seed: Math.floor(rand() * 1e6) });
    }
    this.features = { summit: this.summit, list };
    return list;
  }

  /** Irregular bits in the snow and ice: rocks (some poking out), dirt, pebbles, streaks of sand. */
  private drawTerrainFeatures(): void {
    const { ctx } = this;
    const top = this.topPx;
    for (const f of this.terrainFeatures()) {
      const X = this.sx(f.x);
      if (X < -20 || X > this.W + 20) continue;
      const h = this.groundAt(f.x);
      const Y = this.sy(h) + f.depth;
      if (Y > this.H) continue;
      const rand = mulberry32(f.seed);
      // Higher up everything is darker and frostier.
      const cold = smooth(0.55, 0.95, h / top);
      const tint = (c: RGB) => this.dim(mix(c, [70, 90, 130], cold * 0.6));
      if (f.kind === 'rock') {
        const r = f.size;
        for (let dy = -r; dy <= r; dy++) {
          const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)) * (0.85 + rand() * 0.3));
          for (let dx = -half; dx <= half; dx++) {
            const edge = dx === -half || dx === half || dy === -r || dy === r;
            const lit = dy < -r * 0.3 && dx < 0;
            ctx.fillStyle = tint(edge ? [78, 82, 94] : lit ? [176, 180, 190] : (dx + dy) & 1 ? [124, 128, 140] : [138, 142, 152]);
            ctx.fillRect(X + dx, Y + dy, 1, 1);
          }
        }
        // A cap of snow on rocks that stick out.
        if (f.depth < 0) {
          ctx.fillStyle = this.dim(mix(SNOW.top, ICE.top, cold));
          ctx.fillRect(X - Math.floor(r * 0.6), Y - r, Math.floor(r * 1.2) + 1, 1);
        }
      } else if (f.kind === 'dirt') {
        const w = f.size * 2 + 4;
        for (let n = 0; n < f.size * 5; n++) {
          const dx = Math.round((rand() - 0.5) * w);
          const dy = Math.round((rand() - 0.5) * (f.size * 0.8 + 2));
          ctx.fillStyle = tint(rand() < 0.5 ? [120, 92, 64] : [96, 72, 50]);
          ctx.fillRect(X + dx, Y + dy, 1 + (rand() < 0.2 ? 1 : 0), 1);
        }
      } else if (f.kind === 'pebbles') {
        for (let n = 0; n < f.size; n++) {
          ctx.fillStyle = tint(rand() < 0.5 ? [110, 114, 126] : [132, 104, 80]);
          const sz = rand() < 0.3 ? 2 : 1;
          ctx.fillRect(X + Math.round((rand() - 0.5) * 16), Y + Math.round(rand() * 5), sz, sz);
        }
      } else {
        // A streak of sand following the slope.
        const len = 14 + f.size * 4;
        for (let dx = 0; dx < len; dx++) {
          if (rand() < 0.25) continue;
          const wx = f.x + dx;
          ctx.fillStyle = tint(rand() < 0.6 ? [214, 196, 150] : [190, 168, 120]);
          ctx.fillRect(this.sx(wx), this.sy(this.groundAt(wx)) + f.depth + Math.round(Math.sin(dx * 0.3) * 0.6), 1, 1);
        }
      }
    }
  }

  private drawBaseCamp(): void {
    const { ctx } = this;
    if (this.sx(260) < -40) return;
    // Igloo.
    const ix = this.sx(-70);
    const iy = this.sy(0);
    fillCircle(ctx, ix, iy, 12, this.dim([186, 208, 228]));
    fillCircle(ctx, ix, iy, 11, this.dim([244, 248, 252]));
    ctx.fillStyle = this.dim([186, 208, 228]);
    for (const dy of [-4, -8]) ctx.fillRect(ix - 10, iy + dy, 21, 1);
    ctx.fillStyle = this.dim([60, 70, 96]);
    ctx.fillRect(ix + 5, iy - 5, 5, 5);
    // A polar bear strolls the valley.
    const bx = -125 + Math.sin(this.t * 0.15) * 40;
    const goingLeft = Math.cos(this.t * 0.15) < 0;
    const bear = spriteCanvas(POLAR_BEAR[Math.floor(this.t * 4) % 2], goingLeft);
    ctx.drawImage(bear, this.sx(bx), this.sy(0) - bear.height + 1);
    // Pines on the lower slope.
    const rand = mulberry32(5);
    for (let wx = -170; wx < this.altToX(Math.min(160, this.summit * 0.25)); wx += 26 + Math.floor(rand() * 24)) {
      const h = 12 + Math.floor(rand() * 10);
      if (wx > -100 && wx < -40) continue;
      this.drawPine(this.sx(wx), this.sy(this.groundAt(wx)) + 1, h);
    }
  }

  private drawPine(x: number, baseY: number, h: number): void {
    if (x < -12 || x > this.W + 12) return;
    const { ctx } = this;
    ctx.fillStyle = this.dim([96, 70, 52]);
    ctx.fillRect(x, baseY - 3, 2, 3);
    for (let i = 0; i < h; i++) {
      const w = Math.max(1, Math.round(((i + 1) / h) * (h * 0.45)));
      ctx.fillStyle = i < h * 0.3 || i % 4 === 0 ? this.dim([238, 246, 252]) : this.dim([46, 98, 86]);
      ctx.fillRect(x + 1 - w, baseY - 3 - h + i, w * 2, 1);
    }
  }

  /** A pennant every 100 m (the most one answer can climb), with penguins cheering. */
  private drawFlags(): void {
    const { ctx } = this;
    const colors = ['#cfeeff', '#8fe3f0', '#f7a8cf', '#e0d4ff', '#ffe27a'];
    for (let m = 100, i = 0; m < this.summit; m += 100, i++) {
      const wx = this.altToX(m);
      const X = this.sx(wx);
      if (X < -20 || X > this.W + 20) continue;
      const Y = this.sy(this.groundAt(wx));
      ctx.fillStyle = '#5a4a3a';
      ctx.fillRect(X, Y - 13, 1, 13);
      ctx.fillStyle = colors[i % colors.length];
      const wave = Math.round(Math.sin(this.t * 4 + i));
      for (let r = 0; r < 4; r++) ctx.fillRect(X + 1, Y - 13 + r, Math.round(6 - r * 1.5) + wave, 1);
      // Spectator penguin hops when the ball rolls by.
      const near = Math.abs(this.ballX - wx) < 50 && !this.ballHidden;
      const hop = near ? Math.round(Math.abs(Math.sin(this.t * 9 + i)) * 3) : 0;
      const p = spriteCanvas(PENGUIN[Math.floor(this.t * 3 + i) % 2]);
      ctx.drawImage(p, X + 6, this.sy(this.groundAt(wx + 10)) - p.height - hop + 1);
      // Something odd left on the mountain every 100 m (boot, dead tree, winking flower, …).
      const art = spriteCanvas(ARTIFACTS[i % ARTIFACTS.length]);
      const ax = wx - 26;
      const sway = i % ARTIFACTS.length === 2 ? Math.round(Math.sin(this.t * 2 + i)) : 0; // the flower sways
      const bob = i % ARTIFACTS.length === 4 ? Math.floor(this.t * 2) % 2 : 0; // Caesar shifts its weight
      ctx.drawImage(art, this.sx(ax) - (art.width >> 1) + sway, this.sy(this.groundAt(ax)) - art.height + 2 - bob);
    }
    // The snowman's own flag on the summit.
    if (this.flagRise > 0) {
      const X = this.sx(this.summitX + PLATEAU - 5);
      const Y = this.sy(this.topPx);
      const h = Math.round(20 * this.flagRise);
      ctx.fillStyle = '#5a4a3a';
      ctx.fillRect(X, Y - h, 1, h);
      ctx.fillStyle = '#e04f5f';
      const wave = Math.round(Math.sin(this.t * 6) * 1.5);
      for (let r = 0; r < 6; r++) ctx.fillRect(X + 1, Y - h + r, 9 - r + wave, 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(X + 3, Y - h + 2, 2, 2);
    }
  }

  /** Penguins in fishbowl helmets drifting around the top of the world. */
  private drawSpacePenguins(a: number): void {
    const show = smooth(0.72, 0.9, a);
    if (show <= 0) return;
    const { ctx } = this;
    const xs = this.summitX;
    const spots: [number, number][] = [
      [-70, 70],
      [30, 100],
      [110, 58],
      [-150, 40],
    ];
    const cheer = this.seq?.phase === 'summit' ? 2.5 : 1;
    spots.forEach(([dx, dy], i) => {
      const bob = Math.sin(this.t * 1.1 * cheer + i * 1.7) * 4;
      const X = this.sx(xs + dx + Math.sin(this.t * 0.3 + i) * 6);
      const Y = this.sy(this.topPx + dy + bob);
      if (X < -20 || X > this.W + 20) return;
      ctx.save();
      ctx.globalAlpha = show * 0.7;
      ctx.translate(X, Y);
      ctx.rotate(Math.sin(this.t * 0.5 + i) * 0.5 + i);
      ctx.scale(2, 2);
      ctx.drawImage(spriteCanvas(PENGUIN[0], i % 2 === 1), -4.5, -4.5);
      ctx.restore();
      // Fishbowl helmet.
      ctx.globalAlpha = show * 0.15;
      fillCircle(ctx, X, Y - 3, 9, '#9fb8ff');
      ctx.globalAlpha = show * 0.55;
      ctx.strokeStyle = '#e8f8ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(X + 0.5, Y - 2.5, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(X - 5, Y - 9, 2, 1);
      ctx.globalAlpha = 1;
    });
  }

  private drawRoller(): void {
    const { ctx } = this;
    const { cx: bcx, cy: bcy, r } = this.ballGeometry();
    const off = this.seq && this.seq.phase !== 'teeter' ? 0 : this.wobbleOffset();
    const cx = bcx + Math.round(off * COS);
    const cy = bcy - Math.round(off * SIN);

    // Snowman leans into the slope, bobbing while it pushes.
    if (this.avatar) {
      const feetWX = this.manX() + 32;
      const feetX = this.sx(feetWX);
      const feetY = this.sy(this.groundAt(feetWX));
      const pushing = !!this.tween || (this.strain && !this.seq);
      const bob = pushing ? Math.floor(this.t * (this.tween ? 10 : 16)) % 2 : 0;
      const lean = this.leanFor(feetWX);
      this.avatarBox = { x: feetX - 28, y: feetY - AV_FEET - bob, w: AV_RIGHT, h: AV_FEET };
      ctx.save();
      ctx.translate(feetX, feetY);
      let sxScale = this.faceLeft ? -1 : 1;
      const hop = this.hop();
      if (this.spin > 0) {
        const angle = (1 - this.spin / 0.7) * Math.PI * 4;
        const c = Math.cos(angle);
        sxScale *= Math.abs(c) < 0.08 ? 0.08 * Math.sign(c || 1) : c;
      }
      ctx.scale(sxScale, 1);
      if (lean === 0) {
        ctx.drawImage(this.avatar, -32, -AV_FEET - bob - hop);
      } else {
        // Lean forward into the push by shifting whole pixel rows (a shear), never rotating —
        // rotating pixel art smears it (the eye used to blur on the slope).
        const top = -AV_FEET - bob - hop;
        for (let row = 0; row < this.avatar.height; row++) {
          const shift = Math.round((AV_FEET - row) * lean);
          ctx.drawImage(this.avatar, 0, row, this.avatar.width, 1, -32 + shift, top + row, this.avatar.width, 1);
        }
      }
      ctx.restore();
      // Sweat once the ball is bigger than it.
      if (pushing && r > 22 && Math.random() < 0.04) {
        this.particles.push({ x: feetX + 8, y: feetY - AV_FEET + 10, vx: 10 + Math.random() * 10, vy: -20, life: 0.6, color: '#63aaea', gravity: 120 });
      }
    }
    if (this.ballHidden) return;

    ctx.fillStyle = 'rgba(40,60,100,0.15)';
    ctx.fillRect(cx - Math.round(r * 0.8), cy + r, Math.round(r * 1.6), 2);
    ctx.drawImage(this.ballCanvas(r), cx - r - 1, cy - r - 1);

    // Specks rotate with the distance rolled, so the ball visibly turns.
    const angle = this.rolled / Math.max(r, 2);
    const rand = mulberry32(7);
    const specks = 5 + Math.floor(r / 3);
    for (let i = 0; i < specks; i++) {
      const rho = (0.2 + rand() * 0.65) * r;
      const th = rand() * Math.PI * 2 + angle;
      ctx.fillStyle = i % 3 === 0 ? '#8aa1b8' : '#c5d6e6';
      const size = r > 24 && i % 2 === 0 ? 2 : 1;
      ctx.fillRect(Math.round(cx + Math.cos(th) * rho), Math.round(cy + Math.sin(th) * rho), size, size);
    }
  }

  private ballCanvas(r: number): HTMLCanvasElement {
    const hit = this.ballCache.get(r);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = c.height = r * 2 + 3;
    const g = c.getContext('2d')!;
    const o = r + 1;
    const ball = { cx: o, cy: o, r: r - 1 };
    fillCircle(g, o, o, r, '#5f7a96');
    fillCircle(g, o, o, r - 1, '#c5d6e6');
    fillCircle(g, o - Math.round(r * 0.12), o - Math.round(r * 0.12), r * 0.86, '#f4f8fc', ball);
    fillCircle(g, o - Math.round(r * 0.4), o - Math.round(r * 0.42), Math.max(1, r * 0.22), '#ffffff', ball);
    this.ballCache.set(r, c);
    return c;
  }

  private drawParticles(): void {
    const { ctx } = this;
    for (const p of this.particles) {
      ctx.globalAlpha = clamp01(p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  /** Snow thickens the higher you climb: a light dusting in the valley, a blizzard at the summit. */
  private drawSnowfall(a: number, back: boolean): void {
    const { ctx, W, H } = this;
    const share = 0.06 + 0.94 * smooth(0.05, 0.85, a);
    const count = Math.floor(this.flakes.length * share);
    const tint = mix([255, 255, 255], [196, 220, 255], smooth(0.75, 1, a));
    ctx.fillStyle = css(tint, back ? 0.5 : 0.9);
    // Higher up the wind drives the flakes sideways into short streaks.
    const streak = !back && a > 0.55 ? 1 + Math.round(smooth(0.55, 1, a) * 2) : 0;
    for (let i = 0; i < count; i++) {
      const f = this.flakes[i];
      if (f.back !== back) continue;
      const x = Math.round(f.x * W);
      const y = Math.round(f.y * H);
      ctx.fillRect(x, y, f.size + (f.size === 2 ? streak : 0), f.size);
      if (streak && f.size === 1 && i % 3 === 0) ctx.fillRect(x + 1, y, streak, 1);
    }
  }

  /** Slow mist bands drifting across the top of the world. */
  private drawMist(a: number): void {
    const m = smooth(0.8, 0.97, a);
    if (m <= 0) return;
    const { ctx, W } = this;
    for (let k = 0; k < 4; k++) {
      const y = Math.round(this.anchorY - 34 + k * 13 + Math.sin(this.t * 0.35 + k) * 3);
      const off = (this.t * (6 + k * 3) + k * 57) % 140;
      ctx.fillStyle = css([150, 160, 230], m * (0.04 + 0.02 * k));
      // Wisps of uneven length, so it reads as drifting fog rather than lines.
      for (let x = -140 + off, n = 0; x < W; x += 140, n++) {
        const len = 40 + ((n * 37 + k * 23) % 60);
        ctx.fillRect(Math.round(x), y, len, 2);
        ctx.fillRect(Math.round(x) + 8, y - 1, Math.max(0, len - 20), 1);
      }
    }
  }

  /** The edges of the screen darken near the summit. */
  private drawVignette(a: number): void {
    const v = smooth(0.75, 1, a);
    if (v <= 0) return;
    const { ctx, W, H } = this;
    const g = ctx.createRadialGradient(W * 0.5, H * 0.3, Math.min(W, H) * 0.25, W * 0.5, H * 0.3, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(2,3,12,0)');
    g.addColorStop(1, `rgba(2,3,12,${0.6 * v})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /** Dithered purple/teal clouds of the nebula, built once. */
  private makeNebula(rand: () => number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 110;
    const g = c.getContext('2d')!;
    const blobs: [number, number, number, RGB][] = [
      [70, 50, 48, [96, 52, 150]],
      [150, 40, 56, [34, 96, 130]],
      [200, 70, 36, [120, 60, 160]],
      [110, 75, 30, [40, 120, 150]],
    ];
    for (const [bx, by, br, col] of blobs) {
      for (let y = by - br; y < by + br; y++) {
        for (let x = bx - br; x < bx + br; x++) {
          const d = Math.hypot(x - bx, (y - by) * 1.6) / br;
          if (d > 1) continue;
          // Ordered dither: denser in the middle, speckled at the edges.
          if (((x * 7 + y * 13) % 10) / 10 > (1 - d) * 0.9 || ((x + y) & 1) === 1) continue;
          g.fillStyle = css(col, 0.35 + 0.3 * (1 - d));
          g.fillRect(x, y, 1, 1);
        }
      }
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(220,230,255,${0.3 + rand() * 0.5})`;
      g.fillRect(Math.floor(rand() * 240), Math.floor(rand() * 110), 1, 1);
    }
    return c;
  }
}
