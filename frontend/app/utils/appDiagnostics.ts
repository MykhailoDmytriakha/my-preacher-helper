import { getDeviceStorageHealth, subscribeDeviceStorage, subscribeStorageRelease, type SilentStorage } from '@/utils/deviceStorage';

/**
 * Bounded, content-free device diagnostics. Never store raw errors, URLs or documents.
 *
 * The report exists to reproduce a bug (owner, 2026-10-10): where the person went, what they did,
 * what waited to be sent. So the path stays readable, a document is told apart from another by a
 * short fingerprint instead of its id, and routine events cannot push the path out.
 */
const STORAGE_KEY = 'preacher:diagnostics:v1';
const MAX_EVENTS = 150;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * The newest few of each routine kind. In twelve real reports swipe gestures took up to 49 of 80
 * places and pushed the path out; a kind not listed here is kept up to the overall bound.
 */
const PER_KIND: Partial<Record<EventName, number>> = {
  gesture: 12, focus: 12, visibility: 20, pageshow: 10, pagehide: 10, 'route-check': 10,
  'snapshot-cache': 10, 'snapshot-pending': 10, 'snapshot-server': 20, 'freshness-check': 10, edit: 30,
};
const SESSION = Date.now();
const EVENTS = [
  'sermon-read', 'structure-load', 'service-orders-read', 'owner-list-read', 'gesture',
  'boot', 'route', 'route-check', 'visibility', 'focus', 'online', 'offline', 'pageshow', 'pagehide',
  'worker-change', 'runtime-error', 'unhandled-rejection', 'auth',
  'freshness-start', 'freshness-stop', 'snapshot-cache', 'snapshot-pending', 'snapshot-server',
  'freshness-check', 'freshness-error', 'freshness-timeout', 'freshness-late-response', 'freshness-late-error',
  'freshness-deferred', 'storage-silent', 'storage-answered', 'storage-release',
  'edit', 'dictation', 'sync-trouble',
] as const;
type EventName = typeof EVENTS[number];
interface EventData {
  route?: string;
  /** Which document the route was about: eight hex characters of a hash, never the id itself. */
  doc?: string;
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


/**
 * Every static segment of the app's routes. A segment missing here reads as `:id` — in twelve real
 * reports that made 98 of 187 page visits unreadable. A test walks `app/(pages)` and fails when a
 * new section is added without being named here.
 */
const ROUTE_SEGMENTS = new Set([
  'admin', 'calendar', 'care', 'conduct', 'council', 'dashboard', 'groups', 'limits', 'manual', 'new',
  'notes', 'orders', 'plan', 'prayers', 'series', 'sermons', 'settings', 'share', 'share-links',
  'structure', 'studies', 'tags', 'templates', 'user',
]);

function routeParts(path: string): string[] {
  return path.split(/[?#]/)[0].split('/').filter(Boolean);
}

export function diagnosticRoute(path: string): string {
  return '/' + routeParts(path).map(part => ROUTE_SEGMENTS.has(part) ? part : ':id').join('/');
}

/** FNV-1a: the same id always gives the same eight characters; the id cannot be read back. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The document a route is about, as a fingerprint of its id segments; none on a list or a section. */
function routeDocument(path: string): string | undefined {
  const ids = routeParts(path).filter(part => !ROUTE_SEGMENTS.has(part) && part !== ':id');
  return ids.length ? fingerprint(ids.join('/')) : undefined;
}

function safeData(input: EventData): EventData {
  const output: EventData = {};
  if (typeof input.route === 'string') {
    output.route = diagnosticRoute(input.route);
    const doc = routeDocument(input.route) ?? (typeof input.doc === 'string' && /^[0-9a-f]{8}$/.test(input.doc) ? input.doc : undefined);
    if (doc) output.doc = doc;
  }
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
  memory = bounded([...merged.values()].filter(entry => entry.at >= Date.now() - MAX_AGE_MS));
  return memory.map(entry => ({ ...entry, data: { ...entry.data } }));
}

/** Newest first: each routine kind keeps its newest few, then the overall bound; oldest goes first. */
function bounded(events: DiagnosticEvent[]): DiagnosticEvent[] {
  // Ascending and stable, then walked from the end: events of the same millisecond keep the order
  // they arrived in, so the newest one is never mistaken for an older one.
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const seen = new Map<EventName, number>();
  const kept: DiagnosticEvent[] = [];
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const entry = ordered[index];
    if (kept.length >= MAX_EVENTS) break;
    const count = seen.get(entry.name) ?? 0;
    const cap = PER_KIND[entry.name];
    if (cap !== undefined && count >= cap) continue;
    seen.set(entry.name, count + 1);
    kept.push(entry);
  }
  return kept.reverse();
}

export function recordDiagnostic(name: EventName, data: EventData = {}) {
  const events = diagnosticEvents();
  const next = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, at: Date.now(), session: SESSION, name, data: safeData(data) };
  const last = events.at(-1);
  // Ignore repeated identical metadata, but retain actual checks and lifecycle events.
  if ((name === 'snapshot-cache' || name === 'snapshot-pending') && last?.name === name && next.at - last.at < 1000 && last.session === SESSION && JSON.stringify(last.data) === JSON.stringify(next.data)) return;
  memory = bounded([...events, next]);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(memory)); } catch { /* Best effort, never block editing. */ }
}

/*
 * DEVICE STORAGE IN THE REPORT (BUG-20260927-engine-open-hangs-on-silent-device-storage). The owner's
 * report of a blank council said where he went and when he was offline, but not what the screen was
 * waiting for; that took reading the code. Now the log keeps when a database went silent and how long
 * it stayed so, and the report says which one is silent at the moment it is sent.
 */
let silentBefore: SilentStorage[] = [];
subscribeDeviceStorage(() => {
  const { silent } = getDeviceStorageHealth();
  const now = Date.now();
  for (const entry of silent) {
    if (!silentBefore.some(previous => previous.database === entry.database)) recordDiagnostic('storage-silent', { source: entry.database });
  }
  for (const entry of silentBefore) {
    if (!silent.some(current => current.database === entry.database)) recordDiagnostic('storage-answered', { source: entry.database, elapsedMs: now - entry.since });
  }
  silentBefore = silent;
});
// And whether the layer asked Safari to let go of a database a frozen page held, and what came of it.
subscribeStorageRelease(event => recordDiagnostic('storage-release', { source: event.source, result: event.result }));

export function diagnosticErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = typeof error.code === 'string' ? error.code.replace(/^firestore\//, '') : '';
  return /^[a-z-]{1,40}$/.test(code) ? code : undefined;
}

/** One edit waiting on this device, as the queue knows it — never its document or its words. */
export interface PendingEditSummary {
  collection: string;
  state: string;
  createdAt: number;
}

let readEditQueue: (() => PendingEditSummary[]) | null = null;

/** The data engine says what its queue holds; `null` when no engine runs (signed out, tests). */
export function setEditQueueReader(reader: (() => PendingEditSummary[]) | null) {
  readEditQueue = reader;
}

function editQueueSummary() {
  if (!readEditQueue) return null;
  let entries: PendingEditSummary[];
  try { entries = readEditQueue(); } catch { return null; }
  const word = (value: string) => (/^[a-zA-Z-]{1,40}$/.test(value) ? value : 'other');
  const byState: Record<string, number> = {};
  const byCollection: Record<string, number> = {};
  let oldest = Infinity;
  for (const entry of entries) {
    byState[word(entry.state)] = (byState[word(entry.state)] ?? 0) + 1;
    byCollection[word(entry.collection)] = (byCollection[word(entry.collection)] ?? 0) + 1;
    if (Number.isFinite(entry.createdAt)) oldest = Math.min(oldest, entry.createdAt);
  }
  return {
    // Waiting to be SENT: an acknowledged entry is only awaiting local cleanup.
    pending: entries.filter(entry => entry.state !== 'acknowledged').length,
    byState,
    byCollection,
    oldestAgeMs: Number.isFinite(oldest) ? Math.max(0, Date.now() - oldest) : null,
  };
}

export function buildDiagnosticReport() {
  const path = window.location.pathname;
  const doc = routeDocument(path);
  return {
    schema: 2,
    capturedAt: new Date().toISOString(),
    sessionStartedAt: new Date(SESSION).toISOString(),
    runningVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev',
    route: diagnosticRoute(path),
    ...(doc ? { doc } : {}),
    environment: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      online: navigator.onLine,
      visibility: document.visibilityState,
      standalone: window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
      maxTouchPoints: navigator.maxTouchPoints,
      viewportScale: window.visualViewport?.scale ?? 1,
      viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
      serviceWorker: 'serviceWorker' in navigator ? navigator.serviceWorker.controller?.state ?? 'uncontrolled' : 'unsupported',
    },
    retention: { maxEvents: MAX_EVENTS, hours: 24, perKind: PER_KIND },
    storage: { silent: getDeviceStorageHealth().silent.map(({ database, since }) => ({ database, silentForMs: Math.max(0, Date.now() - since) })) },
    edits: editQueueSummary(),
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
