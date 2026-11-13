import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { reachableAgainCount, serverInReach, subscribeToReachableAgain } from '@/utils/reachableAgain';

/**
 * ASK AGAIN WHEN THE SERVER IS BACK IN REACH — for a read a screen makes in an effect and that can fail
 * for want of the server: a file of the Bible (a book's text, its cross references).
 *
 * The effect puts `round` among its dependencies and passes one gate before it reads:
 *
 *     begin(what);   if (!due(key)) — do not read;   const mark = asking(key);   …   failed(mark, key)
 *
 * `what` names everything the pass reads (the book, the translation, the person's "Retry"). A pass whose
 * `what` differs from the last one is the person's own asking: nothing waits any more, so every read of
 * it is due — the device may hold the file, whatever the server. A pass that reads the same as the last
 * one is not the person's asking: React repeated it (Strict Mode), or `round` began it — and `round`
 * moves in two cases only:
 *
 *   - the server comes back into reach (`utils/reachableAgain`) while a read of this screen has failed;
 *   - a read fails after the server came back while it was on its way: that failure says nothing about
 *     now (a request frozen by a sleeping phone, or hung on a dead connection, reports its death late).
 *
 * In such a pass a read that never failed is due, and one that has failed is `due` only if it has not
 * been asked for since the server's last return and the server is in reach at the moment the pass runs —
 * between the return and the pass the connection may be lost again, and the read then waits for the
 * next return. So nothing that has been read is read again, nothing asks in a circle, and the server's
 * return costs one request for each read that waits; what the person asks for is read whenever they
 * ask. A screen with several reads tells `failed` only of a read it still wants: the late death of one
 * it has dropped must not keep the screen waking for nothing.
 *
 * Why a read failed is not asked: in production the service worker answers a file the network did not
 * give with a 503 (`app/sw.ts`), which no page can tell from the server's own
 * (BUG-20261112-link-texts-stay-dots-after-reconnect). The engine keeps the same rule for its own
 * documents (`engine.onceReachable`), bound to its instance; this one is for reads it does not own.
 */
export function useReadAgainWhenReachable(): {
  round: number;
  begin: (what: string) => void;
  due: (key?: string) => boolean;
  asking: (key?: string) => number;
  failed: (mark: number, key?: string) => void;
} {
  const [round, again] = useReducer((count: number) => count + 1, 0);
  /** The reads that have failed and wait for the server, each with the mark it was begun at. */
  const waiting = useRef(new Map<string, number>());
  const lastPass = useRef<string | null>(null);

  useEffect(() => subscribeToReachableAgain(() => {
    if (waiting.current.size > 0) again();
  }), []);

  /** A pass begins. One that reads something else than the last is the person's own asking: nothing of the old one waits any more. */
  const begin = useCallback((what: string) => {
    if (lastPass.current === what) return;
    lastPass.current = what;
    waiting.current.clear();
  }, []);

  /** May this be read now? What does not wait — yes: the person's asking, or a pass React itself repeats. What waits — once for one return of the server, and only with the server in reach. */
  const due = useCallback((key = ''): boolean => {
    const mark = waiting.current.get(key);
    if (mark === undefined) return true;
    return mark !== reachableAgainCount() && serverInReach();
  }, []);

  /** A read begins: it no longer waits. Gives the mark to hand to `failed`. */
  const asking = useCallback((key = ''): number => {
    waiting.current.delete(key);
    return reachableAgainCount();
  }, []);

  /** A read begun at `mark` has failed: it waits for the server's return — which has already happened if the count moved while it was on its way. */
  const failed = useCallback((mark: number, key = '') => {
    waiting.current.set(key, mark);
    if (reachableAgainCount() !== mark) again();
  }, []);

  return useMemo(() => ({ round, begin, due, asking, failed }), [round, begin, due, asking, failed]);
}
