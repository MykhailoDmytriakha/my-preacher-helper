import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { BibleAssetDeadlineError, BibleAssetHttpError } from '@/utils/fetchBibleJson';
import { reachableAgainCount, serverInReach, subscribeToReachableAgain } from '@/utils/reachableAgain';

/**
 * Coordinate cache-first reads made by one screen. A new scope can check the device immediately.
 * A failed read waits for the next reachable, visible period. If its request began in an older period,
 * it can retry as soon as it fails. A transient failure allows one delayed retry if the
 * server remains reachable.
 * Use the actual request start mark for shared reads, and report failures only for reads still wanted.
 */
export function useReadAgainWhenReachable(): {
  round: number;
  begin: (what: string) => void;
  due: (key?: string) => boolean;
  asking: (key?: string) => number;
  failed: (mark: number, key?: string, error?: unknown) => void;
} {
  const [round, again] = useReducer((count: number) => count + 1, 0);
  /** The reads that have failed and wait for the server, each with the mark it was begun at. */
  const waiting = useRef(new Map<string, number>());
  const lastPass = useRef<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const retried = useRef(new Map<string, number>());
  const retryReady = useRef(new Set<string>());

  const stopRetry = useCallback((key: string) => {
    clearTimeout(timers.current.get(key));
    timers.current.delete(key);
  }, []);

  const clearRetries = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    retried.current.clear();
    retryReady.current.clear();
  }, []);
  useEffect(() => clearRetries, [clearRetries]);

  useEffect(() => subscribeToReachableAgain(() => {
    if (waiting.current.size > 0) again();
  }), []);

  /** A pass begins. One that reads something else than the last is the person's own asking: nothing of the old one waits any more. */
  const begin = useCallback((what: string) => {
    if (lastPass.current === what) return;
    lastPass.current = what;
    waiting.current.clear();
    clearRetries();
  }, [clearRetries]);

  /** May this be read now? What does not wait — yes: the person's asking, or a pass React itself repeats. What waits — once for one return of the server, and only with the server in reach. */
  const due = useCallback((key = ''): boolean => {
    const mark = waiting.current.get(key);
    if (mark === undefined) return true;
    return serverInReach() && (mark !== reachableAgainCount() || retryReady.current.has(key));
  }, []);

  /** A read begins: it no longer waits. Gives the mark to hand to `failed`. */
  const asking = useCallback((key = ''): number => {
    waiting.current.delete(key);
    retryReady.current.delete(key);
    stopRetry(key);
    return reachableAgainCount();
  }, [stopRetry]);

  /** A read begun at `mark` has failed: it waits for the server's return — which has already happened if the count moved while it was on its way. */
  const failed = useCallback((mark: number, key = '', error?: unknown) => {
    waiting.current.set(key, mark);
    if (reachableAgainCount() !== mark) {
      again();
      return;
    }
    const canRetry = error instanceof TypeError || error instanceof BibleAssetDeadlineError ||
      (error instanceof BibleAssetHttpError && error.retryWhileReachable);
    if (!canRetry || !serverInReach() || retried.current.get(key) === mark) return;

    retried.current.set(key, mark);
    timers.current.set(key, setTimeout(() => {
      timers.current.delete(key);
      if (waiting.current.get(key) !== mark || reachableAgainCount() !== mark || !serverInReach()) return;
      retryReady.current.add(key);
      again();
    }, 500));
  }, []);

  return useMemo(() => ({ round, begin, due, asking, failed }), [round, begin, due, asking, failed]);
}
