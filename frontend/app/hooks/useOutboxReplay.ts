'use client';

import { useEffect, useRef } from 'react';

import { replayOutbox } from '@/services/outboxReplay.client';

/**
 * Put queued offline edits back through the guard as soon as the connection
 * returns — and once on mount, because the browser may have come back while the
 * tab was closed.
 *
 * A queue nobody drains is not a safety net, it is a place where text goes to
 * die, so this must be mounted wherever guarded offline writes are possible.
 * Replaying is idempotent: an entry is removed only after it commits, kept when
 * the server is still unreachable, and marked `conflicted` (never re-sent) when
 * the document moved on.
 */
export function useOutboxReplay(uid: string | null | undefined) {
  const runningRef = useRef(false);

  useEffect(() => {
    if (!uid) return;

    const drain = async () => {
      // One drain at a time: overlapping runs would replay the same entry twice.
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        await replayOutbox(uid);
      } catch (error) {
        console.error('outbox replay failed', error);
      } finally {
        runningRef.current = false;
      }
    };

    void drain();
    window.addEventListener('online', drain);
    return () => window.removeEventListener('online', drain);
  }, [uid]);
}
