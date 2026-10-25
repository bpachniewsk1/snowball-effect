// Tiny Web Audio synth for clicky, cartoony sound effects — no audio files needed.
import type { TierId } from '../core/tiers';

const MUTE_KEY = 'snowball:v1:muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();

const unlockListeners: (() => void)[] = [];

/** Browsers only allow audio after a user gesture; call this from one. */
export function unlockAudio(): void {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(ctx.destination);
    unlockListeners.forEach((fn) => fn());
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

/** Shared audio context (null until the first user gesture). */
export const audioContext = () => ctx;
export const onAudioUnlocked = (fn: () => void) => (ctx ? fn() : unlockListeners.push(fn));

export const isMuted = () => muted;
export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    /* ignore */
  }
}

interface ToneOpts {
  freq: number;
  to?: number; // slide to this frequency
  type?: OscillatorType;
  dur?: number;
  vol?: number;
  delay?: number;
  vibrato?: number; // Hz of wobble
}

function tone({ freq, to, type = 'square', dur = 0.08, vol = 0.5, delay = 0, vibrato }: ToneOpts): void {
  if (muted || !ctx || !master) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  if (vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = vibrato;
    depth.gain.value = freq * 0.08;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(t0 + dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, vol: number, filter: number, delay = 0, sweepTo?: number): void {
  if (muted || !ctx || !master) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(filter, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

const NOTE = (semi: number) => 440 * Math.pow(2, semi / 12);
const C5 = NOTE(3);

export const sfx = {
  /** Generic UI button. */
  click: () => tone({ freq: 880, to: 660, dur: 0.05, vol: 0.25 }),

  /** Typing in the answer box — a slightly random typewriter tick. */
  key: () => {
    tone({ freq: 1400 + Math.random() * 500, type: 'triangle', dur: 0.025, vol: 0.18 });
    noise(0.015, 0.06, 4000);
  },
  backspace: () => tone({ freq: 500, to: 380, type: 'triangle', dur: 0.04, vol: 0.18 }),

  /** Tried to submit nothing. */
  nope: () => {
    tone({ freq: 220, dur: 0.07, vol: 0.3 });
    tone({ freq: 180, dur: 0.09, vol: 0.3, delay: 0.08 });
  },

  /** Undertale-style text blip, one per typed-out letter. */
  blip: () => tone({ freq: 520 + Math.random() * 40, type: 'square', dur: 0.03, vol: 0.12 }),

  /** Last seconds on the clock. */
  tick: (urgent: boolean) => tone({ freq: urgent ? 1320 : 990, type: 'square', dur: 0.03, vol: 0.2 }),

  /** First shove of the snowball — crunchy snow. */
  crunch: () => {
    for (let i = 0; i < 4; i++) noise(0.07, 0.35, 1800 - i * 250, i * 0.09, 400);
    tone({ freq: 140, to: 90, type: 'triangle', dur: 0.3, vol: 0.25 });
  },

  /** ~0.8 s build-up before the tier is revealed: accelerating snare roll + rising tone. */
  hype: () => {
    let t = 0;
    let gap = 0.09;
    while (t < 0.72) {
      noise(0.04, 0.22, 3200, t);
      t += gap;
      gap = Math.max(0.03, gap * 0.86);
    }
    tone({ freq: 220, to: 880, type: 'triangle', dur: 0.78, vol: 0.14 });
    tone({ freq: 330, to: 1320, type: 'square', dur: 0.78, vol: 0.05 });
  },

  /** Answer scored — the rarer, the bigger the jingle. */
  tier: (tier: TierId) => {
    switch (tier) {
      case 'slush':
        // Wet little splat.
        tone({ freq: 320, to: 110, type: 'sine', dur: 0.16, vol: 0.32 });
        noise(0.08, 0.18, 1200, 0.02);
        tone({ freq: C5, dur: 0.08, vol: 0.22, delay: 0.14 });
        break;
      case 'snowflake':
        // Soft bell chime.
        [0, 4, 7].forEach((s2, i) => tone({ freq: NOTE(15 + s2), type: 'sine', dur: 0.35, vol: 0.22, delay: i * 0.08 }));
        break;
      case 'icefrost':
        // Crystal crack + glassy rising run.
        noise(0.05, 0.3, 6000);
        [0, 4, 7, 11, 14].forEach((s2, i) => tone({ freq: NOTE(15 + s2), type: 'triangle', dur: 0.18, vol: 0.24, delay: 0.04 + i * 0.06 }));
        tone({ freq: NOTE(31), type: 'sine', dur: 0.4, vol: 0.1, delay: 0.34 });
        break;
      case 'brainfreeze':
        // Deep freeze "whoomp", then a cold minor run with shimmer.
        tone({ freq: 110, to: 55, type: 'sine', dur: 0.5, vol: 0.4 });
        [0, 3, 7, 10, 15, 19].forEach((s2, i) => tone({ freq: NOTE(3 + s2), type: 'triangle', dur: 0.16, vol: 0.3, delay: 0.12 + i * 0.065 }));
        for (let i = 0; i < 4; i++) tone({ freq: 2200 + Math.random() * 1400, type: 'sine', dur: 0.08, vol: 0.1, delay: 0.5 + i * 0.07 });
        break;
      case 'absolutezero':
        // Full fanfare: sub-bass hit, big arpeggio, held chord, long sparkle.
        tone({ freq: 70, to: 40, type: 'sine', dur: 0.9, vol: 0.45 });
        [0, 4, 7, 12, 16, 19, 24].forEach((s2, i) => tone({ freq: NOTE(3 + s2), dur: 0.12, vol: 0.26, delay: i * 0.06 }));
        [12, 16, 19].forEach((s2) => tone({ freq: NOTE(3 + s2), type: 'triangle', dur: 1.1, vol: 0.16, delay: 0.45 }));
        for (let i = 0; i < 10; i++) tone({ freq: 2400 + Math.random() * 2000, type: 'sine', dur: 0.06, vol: 0.11, delay: 0.45 + i * 0.07 });
        break;
    }
  },

  /** Not on the list — cartoon bonk. */
  miss: () => {
    tone({ freq: 160, to: 70, type: 'square', dur: 0.25, vol: 0.35 });
    noise(0.08, 0.3, 900);
  },

  /** Time's up — the snowball melts a little. */
  timeout: () => {
    [0, 0.13, 0.26, 0.39].forEach((d, i) => tone({ freq: 700 - i * 110, to: 900 - i * 110, type: 'sine', dur: 0.1, vol: 0.3, delay: d }));
    tone({ freq: 300, to: 90, type: 'triangle', dur: 0.5, vol: 0.25, delay: 0.5 });
  },

  /** Day complete. */
  results: () => {
    const seq = [0, 4, 7, 4, 7, 12];
    seq.forEach((s, i) => tone({ freq: NOTE(s - 2), type: i === seq.length - 1 ? 'triangle' : 'square', dur: i === seq.length - 1 ? 0.4 : 0.1, vol: 0.25, delay: i * 0.1 }));
  },

  /** Wrong answer — keep trying. A short two-note "eh-eh" buzzer. */
  wrong: () => {
    tone({ freq: 260, type: 'sawtooth', dur: 0.09, vol: 0.22 });
    tone({ freq: 185, type: 'sawtooth', dur: 0.16, vol: 0.22, delay: 0.1 });
  },

  /** Mascot spin — "wheee!" with a little honk at random. */
  spin: () => {
    tone({ freq: 380, to: 1500, type: 'sine', dur: 0.32, vol: 0.28 });
    tone({ freq: 1500, to: 1100, type: 'sine', dur: 0.18, vol: 0.2, delay: 0.32 });
    if (Math.random() < 0.35) tone({ freq: 620, to: 520, type: 'square', dur: 0.12, vol: 0.18, delay: 0.52, vibrato: 30 });
  },

  /** New snowman unlocked — little fanfare. */
  unlock: () => {
    [0, 4, 7, 12].forEach((st, i) => tone({ freq: NOTE(3 + st), type: 'square', dur: 0.1, vol: 0.22, delay: i * 0.08 }));
    tone({ freq: NOTE(3 + 16), type: 'triangle', dur: 0.45, vol: 0.28, delay: 0.34 });
    for (let i = 0; i < 4; i++) tone({ freq: 2400 + Math.random() * 1500, type: 'sine', dur: 0.05, vol: 0.1, delay: 0.5 + i * 0.06 });
  },

  /** Lava bubbling — call repeatedly; hotter = higher and busier. */
  boil: (heat: number) => {
    tone({ freq: 120 + heat * 260 + Math.random() * 60, to: 60 + heat * 100, type: 'sine', dur: 0.08, vol: 0.12 + heat * 0.12 });
  },

  /** Bucket passed on — quick whoosh. */
  pass: () => {
    noise(0.18, 0.25, 3000, 0, 600);
    tone({ freq: 500, to: 1100, type: 'triangle', dur: 0.14, vol: 0.18 });
  },

  /** KABOOM. */
  explode: () => {
    noise(1.1, 0.7, 1800, 0, 120);
    tone({ freq: 160, to: 35, type: 'sawtooth', dur: 0.9, vol: 0.35 });
    tone({ freq: 90, to: 30, type: 'square', dur: 0.7, vol: 0.25, delay: 0.05 });
  },

  /** Somebody won the party. */
  victory: () => {
    [0, 4, 7, 12, 7, 12, 16].forEach((st, i) => tone({ freq: NOTE(st), type: i % 2 ? 'triangle' : 'square', dur: 0.14, vol: 0.24, delay: i * 0.11 }));
    tone({ freq: NOTE(19), type: 'triangle', dur: 0.6, vol: 0.28, delay: 0.8 });
  },

  /** Picked an avatar — squeaky snow. */
  squeak: () => tone({ freq: 700, to: 1800, type: 'sine', dur: 0.12, vol: 0.3 }),

  /** Copied / shared. */
  ding: () => {
    tone({ freq: NOTE(15), type: 'sine', dur: 0.25, vol: 0.3 });
    tone({ freq: NOTE(22), type: 'sine', dur: 0.35, vol: 0.2, delay: 0.06 });
  },
};
