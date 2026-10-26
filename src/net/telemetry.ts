// Anonymous gameplay stats, sent to Supabase (see supabase/schema.sql).
//
// Off unless the build has VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY, and always off when the player
// opted out (privacy page) or the browser sends Global Privacy Control. Raw IPs are never stored: the
// database hashes them with a secret salt + the date. Dev builds and ?test sessions are flagged as test.

import { TEST_MODE } from '../core/testmode';

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const PLAYER_KEY = 'snowball:v1:player-id';
const OPT_OUT_KEY = 'snowball:v1:no-stats';
const FLUSH_MS = 5000;

interface TrackEvent {
  kind: string;
  at: string;
  data?: Record<string, unknown>;
}

export interface PlayerSnapshot {
  name: string;
  avatar: string;
  progress: unknown;
  stats: unknown;
}

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const isStatsOptedOut = () => storageGet(OPT_OUT_KEY) === '1';
export function setStatsOptOut(out: boolean): void {
  storageSet(OPT_OUT_KEY, out ? '1' : null);
}

const gpc = () => typeof navigator !== 'undefined' && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

/** True when stats are actually being sent. */
export const telemetryEnabled = () => !!SB_URL && !!SB_KEY && !isStatsOptedOut() && !gpc();

/** Stable anonymous id for this browser. */
export function playerId(): string {
  let id = storageGet(PLAYER_KEY);
  if (!id) {
    id = uuid();
    storageSet(PLAYER_KEY, id);
  }
  return id;
}

const sessionId = uuid();
let queue: TrackEvent[] = [];
let timer: number | null = null;
let snapshot: () => PlayerSnapshot = () => ({ name: '', avatar: '', progress: null, stats: null });

function device(): string {
  const w = window.innerWidth;
  const touch = matchMedia('(pointer: coarse)').matches;
  return touch ? (w < 768 ? 'phone' : 'tablet') : 'desktop';
}

function flush(keepalive = false): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (!queue.length || !telemetryEnabled()) {
    queue = [];
    return;
  }
  const events = queue.splice(0, 100);
  const payload = {
    player: { id: playerId(), ...snapshot() },
    session: {
      id: sessionId,
      device: device(),
      lang: navigator.language,
      screen: `${screen.width}x${screen.height}`,
      referrer: document.referrer ? new URL(document.referrer).hostname : '',
      test: TEST_MODE || import.meta.env.DEV,
    },
    events,
  };
  void fetch(`${SB_URL}/rest/v1/rpc/track`, {
    method: 'POST',
    keepalive,
    headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  }).catch(() => {
    /* offline or blocked — stats are best-effort */
  });
}

/** Records an event; sent in small batches (and right away when the page is hidden). */
export function track(kind: string, data?: Record<string, unknown>): void {
  if (!telemetryEnabled()) return;
  queue.push({ kind, at: new Date().toISOString(), data });
  if (queue.length >= 20) flush();
  else if (timer === null) timer = window.setTimeout(() => flush(), FLUSH_MS);
}

/** Starts the session: a visit event, a heartbeat while the tab is visible, flush on hide. */
export function initTelemetry(getSnapshot: () => PlayerSnapshot): void {
  snapshot = getSnapshot;
  if (!telemetryEnabled()) return;
  track('visit', { path: location.pathname });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') track('ping');
  }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => flush(true));
}

export { uuid };
