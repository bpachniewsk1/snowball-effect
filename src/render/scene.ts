import { hashString, mulberry32 } from '../core/rng';
import { PENGUIN, POLAR_BEAR, spriteCanvas } from './sprites';

const TARGET_HEIGHT = 240;
/** 7 × Absolute Zero. */
const MAX_POINTS = 1750;
/** Avatar PNGs are 64×64; the snowman's right edge sits ~56px in, feet on row 62. */
const AV_RIGHT = 56;
const AV_FEET = 62;

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
const css = (c: RGB, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

interface Look {
  at: number;
  skyTop: RGB;
  skyBottom: RGB;
  ground: RGB;
  groundShade: RGB;
  mountain: RGB;
  mountainDark: RGB;
  hill: RGB;
  hillEdge: RGB;
}

// Morning → sunset → aurora night, driven by how far through the day's prompts we are.
const LOOKS: Look[] = [
  {
    at: 0,
    skyTop: [111, 183, 230],
    skyBottom: [216, 241, 255],
    ground: [244, 248, 252],
    groundShade: [205, 222, 236],
    mountain: [169, 195, 221],
    mountainDark: [138, 166, 196],
    hill: [228, 240, 249],
    hillEdge: [186, 208, 228],
  },
  {
    at: 0.55,
    skyTop: [92, 98, 168],
    skyBottom: [250, 186, 166],
    ground: [246, 232, 238],
    groundShade: [214, 196, 214],
    mountain: [160, 146, 186],
    mountainDark: [128, 116, 160],
    hill: [236, 218, 230],
    hillEdge: [196, 172, 196],
  },
  {
    at: 1,
    skyTop: [10, 16, 44],
    skyBottom: [38, 58, 104],
    ground: [158, 178, 214],
    groundShade: [118, 138, 180],
    mountain: [52, 68, 108],
    mountainDark: [38, 50, 86],
    hill: [104, 124, 168],
    hillEdge: [76, 94, 138],
  },
];

function lookAt(p: number): Look {
  for (let i = 1; i < LOOKS.length; i++) {
    const a = LOOKS[i - 1];
    const b = LOOKS[i];
    if (p <= b.at) {
      const t = (p - a.at) / (b.at - a.at);
      const out = { at: p } as Look;
      for (const k of Object.keys(a) as (keyof Look)[]) {
        if (k !== 'at') (out[k] as RGB) = mix(a[k] as RGB, b[k] as RGB, t);
      }
      return out;
    }
  }
  return LOOKS[LOOKS.length - 1];
}

const NIGHT: RGB = [8, 10, 34];
function dimLook(l: Look, t: number): Look {
  const d = (c: RGB) => mix(c, NIGHT, t);
  return {
    ...l,
    ground: d(l.ground),
    groundShade: d(l.groundShade),
    mountain: d(l.mountain),
    mountainDark: d(l.mountainDark),
    hill: d(l.hill),
    hillEdge: d(l.hillEdge),
  };
}

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

interface Shooter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface Flake {
  x: number;
  y: number;
  speed: number;
  drift: number;
  size: number;
}

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private W = 160;
  private H = TARGET_HEIGHT;
  private scale = 3;
  private t = 0;
  private last = 0;

  private targetPoints = 0;
  private shownPoints = 0;
  private targetProgress = 0;
  private shownProgress = 0;
  private targetDist = 0;
  private dist = 0;
  private rollSpeed = 0;

  private avatar: HTMLImageElement | null = null;
  /** Seconds left in the snowman's spin (0 = not spinning). */
  private spin = 0;
  private avatarBox = { x: 0, y: 0, w: 0, h: 0 };
  private particles: Particle[] = [];
  private flakes: Flake[] = [];
  private stars: { x: number; y: number; tw: number }[] = [];
  /** Extra stars that come out for rare answers — more of them the colder the tier. */
  private moodStars: { x: number; y: number; tw: number; big: boolean; tint: boolean }[] = [];
  private shooters: Shooter[] = [];
  /** 0 = normal sky … 1 = Absolute Zero darkness. */
  private mood = 0;
  private targetMood = 0;
  private moodLevel = -1;
  private moodTint: RGB = [255, 255, 255];
  private flash = 0;
  private rolling = false;
  private ballCache = new Map<number, HTMLCanvasElement>();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    const rand = mulberry32(hashString('snow'));
    for (let i = 0; i < 90; i++) {
      this.flakes.push({ x: rand(), y: rand(), speed: 0.03 + rand() * 0.06, drift: rand() * 6, size: rand() < 0.2 ? 2 : 1 });
    }
    for (let i = 0; i < 70; i++) this.stars.push({ x: rand(), y: rand() * 0.8, tw: rand() * 6 });
    for (let i = 0; i < 280; i++) {
      this.moodStars.push({ x: rand(), y: rand() * 0.9, tw: rand() * 6, big: rand() < 0.15, tint: rand() < 0.3 });
    }
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

  /** Points decide the snowball size; progress (0..1) decides the time of day. */
  setState(points: number, progress: number, instant = false): void {
    const gained = Math.max(0, points - this.targetPoints);
    if (progress > this.targetProgress) this.targetDist += 26 + gained * 1.3;
    this.targetPoints = points;
    this.targetProgress = progress;
    if (instant) {
      this.targetDist = progress * 7 * 26 + points * 1.3;
      this.dist = this.targetDist;
      this.shownPoints = points;
      this.shownProgress = progress;
    }
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

  /** Keep the snowball rolling in place (the drumroll before a reveal). */
  setRolling(on: boolean): void {
    this.rolling = on;
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

  private get groundY(): number {
    return Math.round(this.H * 0.42);
  }

  /** Radius grows linearly with diameter in cm — big answers make visibly big jumps. */
  private radiusFor(points: number): number {
    const rMin = 4;
    const rMax = Math.floor(Math.min(this.H * 0.4, this.W * 0.3));
    return rMin + (rMax - rMin) * clamp01(points / MAX_POINTS);
  }

  private ballGeometry(): { cx: number; cy: number; r: number } {
    const r = Math.round(this.radiusFor(this.shownPoints));
    const cx = Math.max(Math.round(this.W * 0.56), Math.round(r * 0.7) + AV_RIGHT);
    return { cx, cy: this.groundY + 2 - r, r };
  }

  // ---------- update ----------

  private update(dt: number): void {
    this.t += dt;
    this.spin = Math.max(0, this.spin - dt);
    this.flash = Math.max(0, this.flash - dt * 1.6);
    // Darkness falls quickly and lifts slowly.
    const mk = this.targetMood > this.mood ? 2.5 : 1.2;
    this.mood += (this.targetMood - this.mood) * (1 - Math.exp(-dt * mk));
    if (this.rolling) {
      this.targetDist += dt * 80;
      if (Math.random() < dt * 30) {
        const { cx, r } = this.ballGeometry();
        this.particles.push({
          x: cx - r * 0.6 + Math.random() * r * 0.4,
          y: this.groundY + 1,
          vx: -20 - Math.random() * 30,
          vy: -15 - Math.random() * 25,
          life: 0.5,
          color: Math.random() < 0.5 ? '#ffffff' : '#c5d6e6',
          gravity: 80,
        });
      }
    }
    // Shooting stars for Brain Freeze (now and then) and Absolute Zero (often).
    const rate = this.moodLevel >= 4 ? 2.2 : this.moodLevel === 3 ? 0.6 : 0;
    if (rate && Math.random() < dt * rate * this.mood) {
      this.shooters.push({ x: Math.random() * this.W * 0.9 + this.W * 0.1, y: Math.random() * this.groundY * 0.4, vx: -90 - Math.random() * 60, vy: 35 + Math.random() * 25, life: 0.7 });
    }
    for (const sh of this.shooters) {
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      sh.life -= dt;
    }
    this.shooters = this.shooters.filter((sh) => sh.life > 0);
    const k = 1 - Math.exp(-dt * 1.8);
    this.shownPoints += (this.targetPoints - this.shownPoints) * k;
    this.shownProgress += (this.targetProgress - this.shownProgress) * (1 - Math.exp(-dt * 0.8));
    const before = this.dist;
    this.dist += (this.targetDist - this.dist) * k;
    if (Math.abs(this.targetDist - this.dist) < 0.05) this.dist = this.targetDist;
    this.rollSpeed = (this.dist - before) / Math.max(dt, 1e-3);

    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.95;
      p.vy += p.gravity * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    const dDist = this.dist - before;
    for (const f of this.flakes) {
      f.y += f.speed * dt;
      f.x += (Math.sin(this.t + f.drift) * 0.004 - dDist / this.W) * (f.size === 2 ? 1.3 : 0.8);
      if (f.y > 1) f.y -= 1;
      f.x = ((f.x % 1) + 1) % 1;
    }
  }

  // ---------- draw ----------

  private draw(): void {
    const look = lookAt(clamp01(this.shownProgress));
    this.drawSky(look);
    this.drawCelestial();
    this.drawMoodSky();
    // The land dims too, but less than the sky so the snowman stays readable.
    const land = this.mood > 0.01 ? dimLook(look, this.mood * 0.5) : look;
    this.drawMountains(land);
    this.drawHills(land);
    this.drawGround(land);
    this.drawRoller();
    this.drawParticles();
    this.drawSnowfall();
    if (this.flash > 0) {
      this.ctx.fillStyle = `rgba(235,228,255,${this.flash * 0.55})`;
      this.ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  /** Rare-answer night: darker sky, more (and brighter) stars, shooting stars, aurora for Absolute Zero. */
  private drawMoodSky(): void {
    const m = this.mood;
    if (m < 0.01) return;
    const { ctx, W } = this;
    const gy = this.groundY;
    ctx.fillStyle = `rgba(6,8,30,${m * 0.85})`;
    ctx.fillRect(0, 0, W, gy);

    const count = Math.floor(this.moodStars.length * m);
    for (let i = 0; i < count; i++) {
      const s = this.moodStars[i];
      const a = clamp01(m * 1.6) * (0.6 + 0.4 * Math.sin(this.t * (2 + m * 2) + s.tw));
      if (a <= 0.02) continue;
      const x = Math.round(s.x * W);
      const y = Math.round(s.y * gy * 0.85);
      ctx.fillStyle = s.tint ? css(this.moodTint, a) : `rgba(255,255,255,${a})`;
      ctx.fillRect(x, y, 1, 1);
      if (s.big && m > 0.3) {
        // Twinkle cross on the big stars; arms grow longer the colder the answer.
        const arm = m > 0.9 && a > 0.75 ? 2 : 1;
        ctx.fillStyle = s.tint ? css(this.moodTint, a * 0.7) : `rgba(255,255,255,${a * 0.7})`;
        ctx.fillRect(x - arm, y, arm * 2 + 1, 1);
        ctx.fillRect(x, y - arm, 1, arm * 2 + 1);
      }
    }

    for (const sh of this.shooters) {
      const a = clamp01(sh.life / 0.7);
      const len = 8;
      for (let i = 0; i < len; i++) {
        const k = i / len;
        ctx.fillStyle = `rgba(255,255,255,${a * (1 - k)})`;
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

  private drawSky(look: Look): void {
    const { ctx, W } = this;
    const gy = this.groundY;
    const BAND = 5;
    let prev: string | null = null;
    for (let y = 0; y < gy; y++) {
      const band = Math.floor(y / BAND);
      const color = css(mix(look.skyTop, look.skyBottom, (band * BAND) / gy));
      ctx.fillStyle = color;
      ctx.fillRect(0, y, W, 1);
      if (prev && color !== prev && y % BAND === 0) {
        ctx.fillStyle = prev;
        for (let x = y & 1; x < W; x += 2) ctx.fillRect(x, y, 1, 1);
      }
      prev = color;
    }
  }

  private drawCelestial(): void {
    const { ctx, W } = this;
    const gy = this.groundY;
    const p = this.shownProgress;

    // Stars + aurora come out at night.
    const night = clamp01((p - 0.55) * 2.5);
    if (night > 0) {
      for (const s of this.stars) {
        const a = night * (0.5 + 0.5 * Math.sin(this.t * 2 + s.tw));
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fillRect(Math.round(s.x * W), Math.round(s.y * gy * 0.8), 1, 1);
      }
    }
    const aurora = clamp01((p - 0.7) * 3.5);
    if (aurora > 0) {
      for (let x = 0; x < W; x++) {
        const y = Math.round(gy * 0.18 + Math.sin(x * 0.03 + this.t * 0.4) * 8 + Math.sin(x * 0.011 - this.t * 0.25) * 6);
        const c: RGB = mix([125, 255, 176], [190, 140, 255], x / W);
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = css(c, aurora * (0.32 - i * 0.07));
          ctx.fillRect(x, y + i * 5, 1, 5);
        }
      }
    }

    // Sun sinks through the day; the moon rises at night.
    const sunY = Math.round(gy * 0.18 + p * gy * 1.0);
    if (sunY < gy + 8) {
      const sun: RGB = mix([255, 244, 194], [255, 160, 110], clamp01(p * 1.6));
      fillCircle(ctx, Math.round(W * 0.78), sunY, 9, css(sun));
    }
    if (night > 0) {
      const mx = Math.round(W * 0.2);
      const my = Math.round(gy * 0.25);
      fillCircle(ctx, mx, my, 7, `rgba(244,248,252,${night})`);
      fillCircle(ctx, mx + 3, my - 2, 6, css(mix(LOOKS[2].skyTop, LOOKS[2].skyBottom, 0.25), night));
    }
  }

  private drawMountains(look: Look): void {
    const { ctx, W } = this;
    const gy = this.groundY;
    const off = this.dist * 0.1;
    const h = (x: number) =>
      26 + 14 * Math.sin(x * 0.021 + 1) + 9 * Math.sin(x * 0.057 + 2) + 7 * Math.abs(Math.sin(x * 0.13));
    for (let x = 0; x < W; x++) {
      const wx = x + off;
      const hx = h(wx);
      const top = Math.round(gy - 10 - hx);
      const rising = h(wx + 1) > hx;
      ctx.fillStyle = css(rising ? look.mountain : look.mountainDark);
      ctx.fillRect(x, top, 1, gy - top);
      if (hx > 32) {
        ctx.fillStyle = css(mix(look.ground, look.mountain, rising ? 0 : 0.25));
        ctx.fillRect(x, top, 1, Math.round((hx - 32) * 0.7) + 2);
      }
    }
  }

  private hillTop(wx: number): number {
    return Math.round(this.groundY - 6 - (12 + 6 * Math.sin(wx * 0.03) + 4 * Math.sin(wx * 0.071 + 1.3)));
  }

  private drawHills(look: Look): void {
    const { ctx, W } = this;
    const gy = this.groundY;
    const off = this.dist * 0.35;
    for (let x = 0; x < W; x++) {
      const top = this.hillTop(x + off);
      ctx.fillStyle = css(look.hill);
      ctx.fillRect(x, top, 1, gy - top);
      ctx.fillStyle = css(look.hillEdge);
      ctx.fillRect(x, top, 1, 1);
    }

    // Trees, igloos, penguins and polar bears live on the hills, generated per 60px segment.
    const SEG = 60;
    const first = Math.floor(off / SEG) - 1;
    const lastSeg = Math.floor((off + W) / SEG) + 1;
    for (let seg = first; seg <= lastSeg; seg++) {
      const rand = mulberry32(hashString(`seg:${seg}`));
      const trees = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < trees; i++) {
        const wx = seg * SEG + rand() * SEG;
        this.drawPine(Math.round(wx - off), this.hillTop(wx) + 2, 14 + Math.floor(rand() * 12), look);
      }
      const roll = rand();
      const wx = seg * SEG + 10 + rand() * (SEG - 20);
      if (roll < 0.3) {
        const n = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i++) {
          const px = wx + i * 11 + Math.sin(this.t * 0.6 + seg + i) * 3;
          const frame = Math.floor(this.t * 3 + i) % 2;
          const img = spriteCanvas(PENGUIN[frame]);
          ctx.drawImage(img, Math.round(px - off), this.hillTop(px) - img.height + 1);
        }
      } else if (roll < 0.5) {
        const walk = Math.sin(this.t * 0.15 + seg) * 18;
        const facingRight = Math.cos(this.t * 0.15 + seg) > 0;
        const bx = wx + walk;
        const img = spriteCanvas(POLAR_BEAR[Math.floor(this.t * 3) % 2], !facingRight);
        ctx.drawImage(img, Math.round(bx - off), this.hillTop(bx + 10) - img.height + 1);
      } else if (roll < 0.62) {
        this.drawIgloo(Math.round(wx - off), this.hillTop(wx) + 1, look);
      }
    }
  }

  private drawPine(x: number, baseY: number, h: number, look: Look): void {
    const { ctx } = this;
    const dim = this.shownProgress;
    const green = css(mix([45, 91, 75], [24, 44, 52], dim));
    const greenDark = css(mix([36, 74, 61], [18, 34, 42], dim));
    const snow = css(look.ground);
    ctx.fillStyle = css(mix([107, 74, 58], [60, 44, 44], dim));
    ctx.fillRect(x - 1, baseY - 3, 2, 3);
    const tierH = Math.round(h / 2);
    for (let k = 0; k < 3; k++) {
      const top = baseY - 3 - h + Math.round((k * h) / 4);
      for (let j = 0; j < tierH; j++) {
        const half = Math.floor(j * 0.55) + 1;
        const y = top + j;
        const snowy = j === tierH - 1 || j === 0;
        ctx.fillStyle = snowy ? snow : green;
        ctx.fillRect(x - half, y, half, 1);
        ctx.fillStyle = snowy ? snow : greenDark;
        ctx.fillRect(x, y, half, 1);
      }
    }
  }

  private drawIgloo(x: number, baseY: number, look: Look): void {
    const { ctx } = this;
    const r = 9;
    const dome = { cx: x, cy: baseY - r, r: r * 2 };
    fillCircle(ctx, x, baseY, r, css(look.hillEdge), dome);
    fillCircle(ctx, x, baseY, r - 1, css(look.ground), dome);
    ctx.fillStyle = css(look.hillEdge);
    for (const dy of [3, 6]) ctx.fillRect(x - r + 2, baseY - dy, 2 * r - 3, 1);
    fillCircle(ctx, x + 3, baseY, 3, css(mix([40, 56, 90], [10, 14, 30], this.shownProgress)));
    ctx.fillStyle = css(look.hill);
    ctx.fillRect(x - r - 1, baseY + 1, 2 * r + 3, 3);
  }

  private drawGround(look: Look): void {
    const { ctx, W, H } = this;
    const gy = this.groundY;
    ctx.fillStyle = css(look.ground);
    ctx.fillRect(0, gy, W, H - gy);
    ctx.fillStyle = css(look.groundShade);
    ctx.fillRect(0, gy, W, 1);
    // Speckles scroll with the ground so you can feel the roll.
    for (let x = 0; x < W; x++) {
      const h = hashString(`g${Math.floor(x + this.dist)}`);
      if (h % 19 !== 0) continue;
      const y = gy + 4 + ((h >>> 8) % Math.max(1, H - gy - 6));
      ctx.fillRect(x, y, (h >>> 4) % 3 === 0 ? 2 : 1, 1);
    }
    // Packed-snow track behind the ball.
    const { cx } = this.ballGeometry();
    ctx.fillStyle = css(mix(look.groundShade, look.ground, 0.4));
    ctx.fillRect(0, gy + 1, cx, 2);
  }

  private drawRoller(): void {
    const { ctx } = this;
    const gy = this.groundY;
    const { cx, cy, r } = this.ballGeometry();

    ctx.fillStyle = 'rgba(40,60,100,0.15)';
    ctx.fillRect(cx - Math.round(r * 0.8), gy + 2, Math.round(r * 1.6), 2);

    // Snowman pushes from the left with its arms (≈26px above its feet), bobbing while rolling.
    if (this.avatar) {
      const bob = this.rollSpeed > 4 ? Math.floor(this.t * 10) % 2 : 0;
      const contactY = Math.max(gy - 26, cy);
      const reach = Math.floor(Math.sqrt(Math.max(0, r * r - (contactY - cy) ** 2)));
      const x = cx - reach - AV_RIGHT + 2;
      const y = gy + 3 - AV_FEET - bob;
      this.avatarBox = { x: x + 4, y, w: AV_RIGHT, h: AV_FEET };
      if (this.spin > 0) {
        // Two full turns around the vertical axis: squash horizontally by cos(angle), mirror when facing away.
        const angle = (1 - this.spin / 0.7) * Math.PI * 4;
        const sx = Math.cos(angle);
        const mid = x + 32;
        ctx.save();
        ctx.translate(mid, 0);
        ctx.scale(Math.abs(sx) < 0.08 ? 0.08 * Math.sign(sx || 1) : sx, 1);
        ctx.drawImage(this.avatar, -32, y - Math.round(Math.sin((this.spin / 0.7) * Math.PI) * 6));
        ctx.restore();
      } else {
        ctx.drawImage(this.avatar, x, y);
      }
    }

    ctx.drawImage(this.ballCanvas(r), cx - r - 1, cy - r - 1);

    // Specks rotate with the distance rolled, so the ball visibly turns.
    const angle = this.dist / Math.max(r, 2);
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

  private drawSnowfall(): void {
    const { ctx, W, H } = this;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const f of this.flakes) ctx.fillRect(Math.round(f.x * W), Math.round(f.y * H), f.size, f.size);
  }
}
