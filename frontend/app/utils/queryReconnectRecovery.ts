import { focusManager, isCancelledError, onlineManager, type Query, type QueryClient } from '@tanstack/react-query';

type RecoveryQuery = Pick<Query<unknown, unknown>, 'queryHash' | 'state' | 'isActive' | 'isStale'>;
type Failure = { updates: number; cycles: number; retryAt: number };
const RETRY_PAUSE_MS = 30_000;
const MAX_RETRY_PAUSE_MS = 120_000;

/** Defer a requested reconnect; a terminal error alone never starts another read cycle. */
export function createQueryReconnectRecovery() {
  const failures = new WeakMap<RecoveryQuery, Failure>();
  const pending = new Map<RecoveryQuery, ReturnType<typeof setTimeout> | null>();
  let client: QueryClient | undefined;

  const cancel = (query: RecoveryQuery) => {
    const timer = pending.get(query);
    if (timer != null) clearTimeout(timer);
    pending.delete(query);
  };
  const current = (query: RecoveryQuery) => client?.getQueryCache().get(query.queryHash) === query && query.isActive();
  const rememberFailure = (query: RecoveryQuery): Failure | undefined => {
    const previous = failures.get(query);
    if (query.state.status !== 'error' || query.state.fetchStatus !== 'idle') return previous;
    if (isCancelledError(query.state.error) || (query.state.error instanceof Error && query.state.error.name === 'AbortError')) return previous;
    if (previous?.updates === query.state.errorUpdateCount) return previous;
    const cycles = previous && query.state.errorUpdateCount > previous.updates ? previous.cycles + 1 : 1;
    const failure = { updates: query.state.errorUpdateCount, cycles,
      retryAt: query.state.errorUpdatedAt + Math.min(MAX_RETRY_PAUSE_MS, RETRY_PAUSE_MS * 2 ** Math.min(cycles - 1, 16)) };
    failures.set(query, failure);
    return failure;
  };
  const deliver = (query: RecoveryQuery) => {
    if (!pending.has(query)) return;
    if (!current(query)) { cancel(query); return; }
    if (query.state.fetchStatus !== 'idle') return;
    const failure = rememberFailure(query);
    if (!failure) { cancel(query); return; }
    const remaining = failure.retryAt - Date.now();
    if (remaining > 0) {
      if (pending.get(query) != null) return;
      pending.set(query, setTimeout(() => { pending.set(query, null); deliver(query); }, remaining));
      return;
    }
    if (!onlineManager.isOnline() || !focusManager.isFocused()) return;
    cancel(query);
    // An optimistic cache patch can make the copy fresh without completing the failed server read.
    // Only an actual successful fetch retires this already-requested reconnect.
    void client!.refetchQueries({ type: 'active', predicate: candidate => candidate === query }, { cancelRefetch: false }).catch(() => undefined);
  };
  const flush = () => { for (const query of pending.keys()) deliver(query); };

  const refetchOnReconnect = (query: RecoveryQuery): boolean => {
    if (!client || !current(query)) return true;
    if (query.state.fetchStatus !== 'idle') {
      // The existing retryer continues. Keep its reconnect intent if its last attempt later fails.
      if (query.state.fetchFailureCount > 0 && !pending.has(query)) pending.set(query, null);
      return true;
    }
    const failure = rememberFailure(query);
    if (!failure || failure.retryAt <= Date.now()) return true;
    if (query.isStale()) {
      if (!pending.has(query)) pending.set(query, null);
      deliver(query);
    }
    return false;
  };

  const connect = (next: QueryClient): (() => void) => {
    client = next;
    const stopCache = next.getQueryCache().subscribe(event => {
      const query = event.query;
      if (event.type === 'removed') { cancel(query); failures.delete(query); return; }
      if (event.type === 'updated') {
        if (event.action.type === 'success' && !event.action.manual) {
          cancel(query); failures.delete(query); return;
        }
        // An explicit fetch or a new mount supersedes the deferred reconnect; retry continuation
        // does not dispatch another fetch action, so its latched intent survives until its outcome.
        if (event.action.type === 'fetch') cancel(query);
        if (event.action.type === 'error') {
          if (isCancelledError(event.action.error) || (event.action.error instanceof Error && event.action.error.name === 'AbortError')) cancel(query);
          else rememberFailure(query);
        }
      }
      if (pending.has(query)) deliver(query);
    });
    const stopOnline = onlineManager.subscribe(online => { if (online) flush(); });
    const stopFocus = focusManager.subscribe(focused => { if (focused) flush(); });
    return () => {
      stopCache(); stopOnline(); stopFocus();
      for (const query of pending.keys()) cancel(query);
      client = undefined;
    };
  };
  return { refetchOnReconnect, connect };
}
