import { currentHistoryEntryId, HISTORY_ENTRY_KEY, newHistoryEntryId } from './historyEntry';
import { resolveOfflineShellRoute } from './offlineShellRoutes';

type Position = { x: number; y: number };
type SavedPosition = Position & { entry: string; href: string };
type Visit = { id: string | null; href: string; position: Position };

const STORAGE_KEY = 'navigation:window-positions:v1';
const MAX_SAVED_VISITS = 100;
const SETTLED_FRAMES = 4;
const stateRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
const entryId = (value: unknown): string | null => {
  const id = stateRecord(value)[HISTORY_ENTRY_KEY];
  return typeof id === 'string' ? id : null;
};
const measure = (): Position => ({ x: Math.max(0, window.scrollX), y: Math.max(0, window.scrollY) });
const ownsWindowPosition = (href: string): boolean => resolveOfflineShellRoute(new URL(href).pathname) !== 'bible';

function isSavedPosition(value: unknown): value is SavedPosition {
  const record = stateRecord(value);
  return typeof record.entry === 'string' && typeof record.href === 'string'
    && ['x', 'y'].every(key => typeof record[key] === 'number' && Number.isFinite(record[key]) && record[key] >= 0);
}

function readSavedPositions(): Map<string, SavedPosition> {
  try {
    const saved: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    return new Map(Array.isArray(saved)
      ? saved.filter(isSavedPosition).slice(-MAX_SAVED_VISITS).map(value => [value.entry, value])
      : []);
  } catch { return new Map(); }
}

/** Restore only a traversed visit, after its readable document geometry returns.
 * New routes keep the router's ordinary landing. Bible/pane readers retain their own owners.
 */
export function installWindowHistoryPosition(): () => void {
  const history = window.history;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const saved = readSavedPositions();
  let active = true;
  let current: Visit = { id: currentHistoryEntryId(), href: window.location.href, position: measure() };
  let pending: SavedPosition | null = null;
  let frame = 0;
  let stableHeight = -1;
  let stableFrames = 0;
  let applied = false;

  function capture() {
    if (!pending && window.location.href === current.href && !document.querySelector('[data-page-loading]')) {
      current.position = measure();
    }
  }

  function save() {
    if (pending || !current.id || !ownsWindowPosition(current.href)) return;
    saved.delete(current.id);
    saved.set(current.id, { entry: current.id, href: current.href, ...current.position });
    while (saved.size > MAX_SAVED_VISITS) saved.delete(saved.keys().next().value!);
    try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...saved.values()])); }
    catch { /* The in-document map remains usable when device storage refuses the convenience. */ }
  }

  function cancel() {
    pending = null;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    current.position = measure();
  }

  function schedule() {
    if (active && pending && !frame) frame = window.requestAnimationFrame(check);
  }

  function check() {
    frame = 0;
    if (!pending || !document.body || document.querySelector('[data-page-loading]')) return;
    if (window.location.href !== current.href || entryId(history.state) !== current.id) { cancel(); return; }
    const height = document.documentElement.scrollHeight;
    if (height !== stableHeight) { stableHeight = height; stableFrames = 0; }
    if (++stableFrames < SETTLED_FRAMES) { schedule(); return; }
    // A short fallback cannot yet represent this reading offset. Do not clamp it to zero.
    const viewport = document.documentElement;
    const maxY = Math.max(0, height - (viewport.clientHeight || window.innerHeight));
    const maxX = Math.max(0, viewport.scrollWidth - (viewport.clientWidth || window.innerWidth));
    if (maxY + 1 < pending.y || maxX + 1 < pending.x) return;
    if (Math.abs(window.scrollY - pending.y) > 1 || Math.abs(window.scrollX - pending.x) > 1) {
      window.scrollTo({ top: pending.y, left: pending.x, behavior: 'instant' });
      applied = true;
      stableFrames = 0;
      schedule();
      return;
    }
    // Its own scroll can collapse a header. Settle that geometry before giving up ownership.
    if (!applied) { applied = true; stableFrames = 0; schedule(); return; }
    pending = null;
    current.position = measure();
  }

  function begin() {
    stableHeight = -1; stableFrames = 0; applied = false;
    const position = current.id ? saved.get(current.id) : undefined;
    pending = position?.href === current.href && ownsWindowPosition(current.href) ? position : null;
    schedule();
  }

  const push: History['pushState'] = function (data: unknown, unused: string, url?: string | URL | null) {
    if (!active) return originalPush.call(history, data, unused, url);
    capture(); save(); cancel();
    const supplied = entryId(data);
    const id = supplied && supplied !== current.id ? supplied : newHistoryEntryId();
    originalPush.call(history, { ...stateRecord(data), [HISTORY_ENTRY_KEY]: id }, unused, url);
    current = { id, href: window.location.href, position: measure() };
  };
  const replace: History['replaceState'] = function (data: unknown, unused: string, url?: string | URL | null) {
    if (!active) return originalReplace.call(history, data, unused, url);
    const nextHref = new URL(url ?? window.location.href, window.location.href).href;
    if (nextHref !== current.href) { capture(); save(); cancel(); }
    // A native fragment entry without app state must stay native, including null state.
    originalReplace.call(history, current.id ? { ...stateRecord(data), [HISTORY_ENTRY_KEY]: current.id } : data, unused, url);
    current.href = window.location.href;
  };
  history.pushState = push;
  history.replaceState = replace;

  function traverse(state: unknown) {
    save();
    const previous = current;
    cancel();
    current = { id: entryId(state), href: window.location.href, position: measure() };
    if (current.id && current.id === previous.id && current.href !== previous.href) {
      current.id = newHistoryEntryId();
      originalReplace.call(history, { ...stateRecord(state), [HISTORY_ENTRY_KEY]: current.id }, '');
    }
    begin();
  }
  // Capture the event's state before the router starts replacing the current entry.
  const onPopState = (event: PopStateEvent) => traverse(event.state);
  const onHashChange = () => { if (current.href !== window.location.href) traverse(history.state); };
  const onPageHide = () => { capture(); save(); };
  const onVisibility = () => { if (document.visibilityState === 'hidden') onPageHide(); };
  const onInput = () => { if (pending) cancel(); };
  window.addEventListener('popstate', onPopState, true);
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('scroll', capture, { passive: true });
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibility);
  const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  for (const type of inputEvents) window.addEventListener(type, onInput, { capture: true, passive: true });
  const mutations = new MutationObserver(schedule);
  mutations.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'data-page-loading'] });
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  resize?.observe(document.documentElement);
  if (document.body) resize?.observe(document.body);
  const navigation = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (navigation?.type === 'back_forward' || navigation?.type === 'reload') begin();

  return () => {
    if (!active) return;
    capture(); save(); cancel(); active = false;
    mutations.disconnect(); resize?.disconnect();
    window.removeEventListener('popstate', onPopState, true);
    window.removeEventListener('hashchange', onHashChange);
    window.removeEventListener('scroll', capture);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibility);
    for (const type of inputEvents) window.removeEventListener(type, onInput, true);
    // A later router wrapper may retain ours. It becomes an inert delegate after cleanup.
    if (history.pushState === push) history.pushState = originalPush;
    if (history.replaceState === replace) history.replaceState = originalReplace;
  };
}
