/** Bounded, content-free device diagnostics. Never store raw errors, URLs or documents. */
const STORAGE_KEY = 'preacher:diagnostics:v1';
const MAX_EVENTS = 80;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SESSION = Date.now();
const EVENTS = [
  'sermon-read', 'structure-load', 'service-orders-read', 'owner-list-read',
  'boot', 'route', 'route-check', 'visibility', 'focus', 'online', 'offline', 'pageshow', 'pagehide',
  'worker-change', 'runtime-error', 'unhandled-rejection', 'auth',
  'freshness-start', 'freshness-stop', 'snapshot-cache', 'snapshot-pending', 'snapshot-server',
  'freshness-check', 'freshness-error', 'freshness-timeout', 'freshness-late-response', 'freshness-late-error',
] as const;
type EventName = typeof EVENTS[number];
interface EventData {
  route?: string;
  source?: string;
  code?: string;
  collection?: string;
  result?: string;
  visible?: boolean;
  online?: boolean;
  persisted?: boolean;
  authenticated?: boolean;
  loading?: boolean;
  elapsedMs?: number;
}
interface DiagnosticEvent {
  id: string;
  at: number;
  session: number;
  name: EventName;
  data: EventData;
}
let memory: DiagnosticEvent[] = [];


export function diagnosticRoute(path: string): string {
  const fixed = new Set(['dashboard', 'sermons', 'studies', 'groups', 'prayers', 'series', 'settings', 'calendar', 'plan', 'structure', 'manual', 'new', 'share-links']);
  return '/' + path.split(/[?#]/)[0].split('/').filter(Boolean)
    .map(part => fixed.has(part) ? part : ':id').join('/');
}

function safeData(input: EventData): EventData {
  const output: EventData = {};
  if (typeof input.route === 'string') output.route = diagnosticRoute(input.route);
  for (const key of ['source', 'code', 'collection', 'result'] as const) {
    const value = input[key];
    if (typeof value === 'string' && /^[a-zA-Z-]{1,40}$/.test(value)) output[key] = value;
  }
  for (const key of ['visible', 'online', 'persisted', 'authenticated', 'loading'] as const) {
    if (typeof input[key] === 'boolean') output[key] = input[key];
  }
  if (typeof input.elapsedMs === 'number' && Number.isFinite(input.elapsedMs)) output.elapsedMs = Math.max(0, Math.round(input.elapsedMs));
  return output;
}

export function diagnosticEvents(): DiagnosticEvent[] {
  let stored: DiagnosticEvent[] = [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (Array.isArray(raw)) stored = raw.slice(-MAX_EVENTS).flatMap((entry, index) => {
      if (!entry || !EVENTS.includes(entry.name) || !Number.isFinite(entry.at) || !Number.isFinite(entry.session)) return [];
      const id = typeof entry.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(entry.id)
        ? entry.id : `legacy-${entry.session}-${entry.at}-${index}`;
      return [{ id, at: entry.at, session: entry.session, name: entry.name, data: safeData(entry.data ?? {}) }];
    });
  } catch { /* Storage can be unavailable; the current session still has a report. */ }
  // Re-read before every append so another tab's newly persisted events survive.
  const merged = new Map([...memory, ...stored].map(entry => [entry.id, entry]));
  memory = [...merged.values()].filter(entry => entry.at >= Date.now() - MAX_AGE_MS)
    .sort((a, b) => a.at - b.at).slice(-MAX_EVENTS);
  return memory.map(entry => ({ ...entry, data: { ...entry.data } }));
}

export function recordDiagnostic(name: EventName, data: EventData = {}) {
  const events = diagnosticEvents();
  const next = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, at: Date.now(), session: SESSION, name, data: safeData(data) };
  const last = events.at(-1);
  // Ignore repeated identical metadata, but retain actual checks and lifecycle events.
  if ((name === 'snapshot-cache' || name === 'snapshot-pending') && last?.name === name && next.at - last.at < 1000 && last.session === SESSION && JSON.stringify(last.data) === JSON.stringify(next.data)) return;
  memory = [...events, next].slice(-MAX_EVENTS);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(memory)); } catch { /* Best effort, never block editing. */ }
}

export function diagnosticErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = typeof error.code === 'string' ? error.code.replace(/^firestore\//, '') : '';
  return /^[a-z-]{1,40}$/.test(code) ? code : undefined;
}

export function buildDiagnosticReport() {
  return {
    schema: 1,
    capturedAt: new Date().toISOString(),
    sessionStartedAt: new Date(SESSION).toISOString(),
    runningVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev',
    route: diagnosticRoute(window.location.pathname),
    environment: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      online: navigator.onLine,
      visibility: document.visibilityState,
      standalone: window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
      viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
      serviceWorker: 'serviceWorker' in navigator ? navigator.serviceWorker.controller?.state ?? 'uncontrolled' : 'unsupported',
    },
    retention: { maxEvents: MAX_EVENTS, hours: 24 },
    events: diagnosticEvents(),
  };
}

/** Only checks the existing app health endpoint; it does not validate Firestore or saves. */
export async function diagnosticServerVersion() {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<{ status: string; version: null }>(resolve => {
    timer = setTimeout(() => { resolve({ status: 'timeout', version: null }); controller.abort(); }, 5000);
  });
  const request = (async () => {
    try {
      const response = await fetch(`/api/health?diagnostic=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return { status: `http-${response.status}`, version: null };
      const data = await response.json();
      const version = typeof data.version === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(data.version) ? data.version : null;
      return { status: version ? 'answered' : 'invalid-response', version };
    } catch { return { status: 'unavailable', version: null }; }
  })();
  try { return await Promise.race([request, timeout]); } finally { clearTimeout(timer!); }
}
