// Quiet ambient music-box loop, synthesized live (an original tune in a cosy snowy-town mood).
import { audioContext, onAudioUnlocked } from './sfx';

const KEY = 'snowball:v1:music-off';
const EIGHTH = 0.32; // seconds — about 94 bpm
const VOLUME = 0.32;

// Semitones relative to A4. Progression: Bm – G – D – A, twice (second pass carries the melody).
const CHORDS: { root: number; minor: boolean }[] = [
  { root: -10, minor: true }, // Bm
  { root: -14, minor: false }, // G
  { root: -7, minor: false }, // D
  { root: -12, minor: false }, // A
];
// Quarter-note melody over 8 bars (semitones from A4, null = rest).
const MELODY: (number | null)[] = [
  9, null, 7, 5, // Bm
  7, null, 2, null, // G
  5, 9, 12, 9, // D
  7, null, null, null, // A
  9, 10, 9, 7, // Bm
  5, null, 7, 9, // G
  12, 9, 5, 7, // D
  4, null, null, null, // A
];
const freq = (semi: number) => 440 * Math.pow(2, semi / 12);

let off = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
let gain: GainNode | null = null;
let timer: number | null = null;
let step = 0;
let nextTime = 0;

function note(ctx: AudioContext, out: AudioNode, f: number, t: number, dur: number, vol: number, type: OscillatorType): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function schedule(): void {
  const ctx = audioContext();
  if (!ctx || !gain) return;
  while (nextTime < ctx.currentTime + 0.3) {
    const bar = Math.floor(step / 8) % 8;
    const inBar = step % 8;
    const { root, minor } = CHORDS[bar % 4];
    const third = minor ? 3 : 4;
    const t = nextTime;

    // Music-box arpeggio on every eighth.
    const arp = [0, 7, 12, 12 + third, 19, 12, 7, third];
    note(ctx, gain, freq(root + arp[inBar] + 12), t, 0.9, 0.05, 'sine');
    // Soft bass on beats 1 and 3.
    if (inBar === 0 || inBar === 4) note(ctx, gain, freq(root - 12 + (inBar === 4 ? 7 : 0)), t, 1.3, 0.09, 'triangle');
    // Melody on quarter notes.
    if (inBar % 2 === 0) {
      const m = MELODY[bar * 4 + inBar / 2];
      if (m !== null) note(ctx, gain, freq(m), t, 1.1, 0.045, 'triangle');
    }

    step = (step + 1) % 64;
    nextTime += EIGHTH;
  }
}

function start(): void {
  const ctx = audioContext();
  if (!ctx || timer !== null || off || document.hidden) return;
  if (!gain) {
    gain = ctx.createGain();
    gain.gain.value = VOLUME;
    gain.connect(ctx.destination);
  }
  nextTime = ctx.currentTime + 0.1;
  timer = window.setInterval(schedule, 80);
}

function stop(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

/** Starts the loop as soon as audio is allowed, and pauses it while the tab is hidden. */
export function initMusic(): void {
  onAudioUnlocked(start);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
}

export const isMusicOff = () => off;
export function setMusicOff(value: boolean): void {
  off = value;
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (off) stop();
  else start();
}
