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

/** Replace an application address and let Next publish it, retaining this visit and other owners' state. */
export function replaceHistoryAddress(address: string): void {
  // Replaying Next's dispatch markers bypasses its URL integration. Its patched History API
  // copies its own private state for an application navigation instead.
  const state = { ...window.history.state };
  delete state.__NA;
  delete state._N;
  window.history.replaceState(state, '', address);
}
