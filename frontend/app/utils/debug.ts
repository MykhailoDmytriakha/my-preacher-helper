/*
 * Client-side dev logger. Posts log entries to `/api/dev/log` which appends
 * them to the active `.logs/<session>/frontend.log` for offline grep.
 *
 * Console mirror is gated on the existing `debugMode` user toggle
 * (`localStorage.debugModeEnabled` / `window.__DEBUG_MODE__`) — same toggle
 * `debugLog` (`utils/debugMode.ts`) uses — so users who muted dev noise stay
 * muted while the file stream keeps flowing for empirical debugging.
 *
 * Throttling: keystroke-driven actions (updateText / updateHeader) can fire
 * the reducer 5-10× per second, and React Strict Mode doubles each dispatch.
 * Without back-pressure the bridge endpoint sees 50+ beacons/sec. We bucket
 * by `${scope}/${level}/${message}` and emit at most once per 200 ms,
 * last-write-wins — same shape, latest payload.
 *
 * Production guard: in `NODE_ENV !== 'development'` everything is a no-op.
 */

import { isDebugModeEnabled } from './debugMode';

type Level = 'log' | 'info' | 'warn' | 'error';

// Strictly `development` — not `!== production` — so the test environment
// (NODE_ENV=test) doesn't trigger network calls via the bridge endpoint.
// IMPORTANT: do NOT guard this with `typeof process !== 'undefined'`. Webpack's
// DefinePlugin replaces the literal `process.env.NODE_ENV` expression with a
// string constant at build time; wrapping it in a runtime `typeof` check
// stops the substitution and leaves `process.env.NODE_ENV` evaluating to
// `undefined` in the browser bundle — which silently breaks the logger.
const IS_DEV = process.env.NODE_ENV === 'development';

const THROTTLE_WINDOW_MS = 200;

interface DebugPayload {
  scope: string;
  level: Level;
  message: string;
  args: unknown[];
  url?: string;
}

function safeStringifyArgs(args: unknown[]): unknown[] {
  return args.map((value) => {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    return value;
  });
}

function sendBeaconNow(payload: DebugPayload): void {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/dev/log', blob);
      return;
    }
    void fetch('/api/dev/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
  } catch {
    /* never let logging break the caller */
  }
}

// Last-write-wins throttle. Each bucket holds a pending payload; the timer
// flushes it after the window expires. A burst (e.g. fast typing) collapses
// to one beacon per ~200ms per scope/level/message bucket.
interface PendingEntry {
  payload: DebugPayload;
  timer: ReturnType<typeof setTimeout>;
}
const pending = new Map<string, PendingEntry>();

function scheduleBeacon(payload: DebugPayload): void {
  if (typeof window === 'undefined') return;
  const key = `${payload.scope}|${payload.level}|${payload.message}`;
  const existing = pending.get(key);
  if (existing) {
    existing.payload = payload;
    return;
  }
  const timer = setTimeout(() => {
    const entry = pending.get(key);
    pending.delete(key);
    if (entry) sendBeaconNow(entry.payload);
  }, THROTTLE_WINDOW_MS);
  pending.set(key, { payload, timer });
}

export interface DebugLogger {
  log(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const CONSOLE_METHODS: Record<Level, (message?: unknown, ...args: unknown[]) => void> = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

function emit(scope: string, level: Level, message: string, args: unknown[]): void {
  if (!IS_DEV) return;
  const safeArgs = safeStringifyArgs(args);
  // Console mirror respects the user's debug toggle. File logging always
  // flows so a developer can grep .logs/ even when the console is muted.
  if (isDebugModeEnabled()) {
    CONSOLE_METHODS[level](`[${scope}] ${message}`, ...args);
  }
  scheduleBeacon({
    scope,
    level,
    message,
    args: safeArgs,
    url: typeof window !== 'undefined' ? window.location.pathname + window.location.search : undefined,
  });
}

export function createDebug(scope: string): DebugLogger {
  return {
    log: (message, ...args) => emit(scope, 'log', message, args),
    info: (message, ...args) => emit(scope, 'info', message, args),
    warn: (message, ...args) => emit(scope, 'warn', message, args),
    error: (message, ...args) => emit(scope, 'error', message, args),
  };
}
