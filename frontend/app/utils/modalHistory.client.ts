import { newHistoryEntryId } from './historyEntry';

const KEY = 'preacherModalHistory';
const POSITION = 'preacherHistoryPosition';
type Mark = { token: string; kind: 'base' | 'page'; first: boolean };
type Visit = { href: string; state: Record<string, unknown>; mark: Mark | null; position: number; nativePosition: number | null };
const record = (state: unknown): Record<string, unknown> => state !== null && typeof state === 'object' ? state as Record<string, unknown> : {};
const positionOf = (state: unknown): number | null => {
  const value = record(state)[POSITION];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
};
const markOf = (state: unknown): Mark | null => {
  const value = record(record(state)[KEY]);
  return typeof value.token === 'string' && (value.kind === 'base' || value.kind === 'page') && typeof value.first === 'boolean'
    ? value as Mark : null;
};

let installed = false;
let mutation = 0;
let requestClose: (() => void) | null = null;
let current: Visit | null = null;
let skipping: -1 | 1 | null = null;
let returning: { close: (() => void) | null } | null = null;
const consumed = new WeakSet<PopStateEvent>();

/** Native entry indices also distinguish fragment entries that deliberately retain null state. */
function nativePosition(): number | null {
  const navigation = (window as Window & { navigation?: { currentEntry?: { index: number } | null } }).navigation;
  const index = navigation?.currentEntry?.index;
  return typeof index === 'number' && index >= 0 ? index : null;
}

/** Transient copies retain their page's identity and never own a second scroll position. */
export const isModalHistoryMutation = (): boolean => mutation > 0;

/** A modal's extra entry does not create a previous page for a directly opened screen. */
export function canGoBackToPage(): boolean {
  const mark = markOf(window.history.state);
  return !mark?.first && window.history.length > 1;
}

function remember() {
  current = { href: window.location.href, state: { ...record(window.history.state) }, mark: markOf(window.history.state), position: positionOf(window.history.state) ?? 0, nativePosition: nativePosition() };
}

function transient(action: () => void) {
  mutation++;
  try { action(); } finally { mutation--; }
}

function arm() {
  if (!requestClose || skipping || returning) return;
  if (markOf(window.history.state)?.kind === 'page') { remember(); return; }
  const state = record(window.history.state);
  const position = positionOf(state) ?? 0;
  const mark: Mark = { token: newHistoryEntryId(), kind: 'base', first: markOf(state)?.first === true || window.history.length === 1 };
  transient(() => {
    window.history.replaceState({ ...state, [POSITION]: position, [KEY]: mark }, '');
    window.history.pushState({ ...state, [POSITION]: position + 1, [KEY]: { ...mark, kind: 'page' } }, '');
  });
  remember();
}

/** One global guard delegates window choice and close policy to the existing visual registry. */
export function syncModalHistory(close: (() => void) | null): void {
  installModalHistory();
  requestClose = close;
  arm();
}

function consume(event: PopStateEvent): void {
  consumed.add(event);
  event.stopImmediatePropagation();
}

function returnToCurrent(state: unknown): void {
  if (!current) return;
  const position = positionOf(state);
  const native = nativePosition();
  const target = markOf(state);
  const offset = current.nativePosition !== null && native !== null ? current.nativePosition - native
    : target?.kind === 'base' ? (target.token === current.mark?.token ? 1 : -1)
      : position === null ? 1 : current.position - position;
  // A zero delta means reload in History, never a safe way to retain a live window.
  window.history.go(offset || 1);
}

function completeReturn(event: PopStateEvent): void {
  if (!current || !returning) return;
  if (positionOf(event.state) !== current.position || window.location.href !== current.href) {
    returnToCurrent(event.state);
    return;
  }
  const close = returning.close;
  returning = null;
  remember();
  arm();
  // A newer route/window must not receive an older traversal's close request.
  if (close && close === requestClose) close();
}

function skipBase(target: Mark): void {
  if (!current) return;
  const direction = skipping ?? (target.first || current.mark?.token === target.token ? -1 : 1);
  if (direction === -1 && target.first) {
    // Retain the logical-first identity: history.length also includes the forward copy.
    skipping = null;
    remember();
    return;
  }
  skipping = direction;
  window.history.go(direction);
}

/** Native fragment links do not pass through pushState. They reveal text, not a close request. */
function synchronizeFragment(): boolean {
  if (!current || current.href === window.location.href) return false;
  const before = new URL(current.href);
  const after = new URL(window.location.href);
  before.hash = ''; after.hash = '';
  if (before.href !== after.href || positionOf(window.history.state) !== null) return false;
  if (requestClose) {
    // A native hash entry has no router state. Its new modal guard keeps the same page's
    // opaque context so a later traversal never turns it into a foreign-router reload.
    const state = { ...current.state };
    delete state[KEY];
    state[POSITION] = current.position + 1;
    transient(() => window.history.replaceState(state, ''));
    returning = null; skipping = null;
  }
  remember();
  arm();
  return true;
}

/** Called before the page-position owner or the router observes a history traversal. */
export function consumeModalHistoryPop(event: PopStateEvent): boolean {
  if (consumed.has(event)) return true;
  if (!installed || !current) return false;
  if (synchronizeFragment()) {
    if (requestClose) { consume(event); return true; }
    return false;
  }
  if (returning) {
    consume(event);
    completeReturn(event);
    return true;
  }
  if (requestClose) {
    consume(event);
    returning = { close: skipping ? null : requestClose };
    skipping = null;
    // Return to the existing entry before asking its window. A new push here would
    // truncate or reorder Forward history. Unmounting never initiates a traversal.
    completeReturn(event);
    return true;
  }
  const target = markOf(event.state);
  if (target?.kind === 'base') {
    consume(event);
    skipBase(target);
    return true;
  }
  skipping = null;
  remember();
  return false;
}

/** Root installation also recognizes retained pairs after reload; hook-only consumers install lazily. */
export function installModalHistory(): void {
  if (installed) return;
  installed = true;
  const history = window.history;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  remember();
  history.pushState = function (data: unknown, unused: string, url?: string | URL | null) {
    if (mutation) return originalPush.call(history, data, unused, url);
    const previousPosition = positionOf(history.state);
    let state = data;
    if (previousPosition !== null || markOf(data)) {
      const next: Record<string, unknown> = { ...record(data), ...(previousPosition !== null ? { [POSITION]: previousPosition + 1 } : {}) };
      delete next[KEY];
      state = next;
    }
    originalPush.call(history, state, unused, url);
    if (returning) returning.close = null;
    remember();
    arm();
  };
  history.replaceState = function (data: unknown, unused: string, url?: string | URL | null) {
    if (mutation) return originalReplace.call(history, data, unused, url);
    const mark = markOf(history.state);
    const position = positionOf(history.state);
    const state = mark || position !== null ? { ...record(data), ...(mark ? { [KEY]: mark } : {}), ...(position !== null ? { [POSITION]: position } : {}) } : data;
    const changedAddress = new URL(url ?? window.location.href, window.location.href).href !== current?.href;
    originalReplace.call(history, state, unused, url);
    if (returning && changedAddress) returning.close = null;
    remember();
    arm();
  };
  window.addEventListener('popstate', consumeModalHistoryPop, true);
  window.addEventListener('hashchange', () => { synchronizeFragment(); });
}
