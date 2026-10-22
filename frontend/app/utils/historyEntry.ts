/** Keep the established field so existing Bible history entries remain readable. */
export const HISTORY_ENTRY_KEY = 'bibleEntry';

export const newHistoryEntryId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Identify this visit without replacing the router or other owners' history state. */
export function currentHistoryEntryId(): string {
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  const existing = state[HISTORY_ENTRY_KEY];
  if (typeof existing === 'string') return existing;
  const id = newHistoryEntryId();
  window.history.replaceState({ ...state, [HISTORY_ENTRY_KEY]: id }, '');
  return id;
}
