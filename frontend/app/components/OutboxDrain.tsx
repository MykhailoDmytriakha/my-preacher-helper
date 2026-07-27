'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { replayOutbox } from '@/services/outboxReplay.client';
import { replayMembershipOutbox } from '@/services/seriesMembership.client';

/** Fired after every drain so any visible conflict UI can re-read the queue. */
export const OUTBOX_CHANGED_EVENT = 'outbox:changed';

/**
 * The worker that puts queued offline edits back through the guard. Renders nothing.
 *
 * WHY IT IS SEPARATE FROM THE BANNER. The drain used to live inside the visible
 * conflict banner, which the layout hides on the preaching-plan screen — so on the
 * one screen a preacher keeps open for an hour, queued writes had NO worker at all:
 * they simply waited, and the person had no way to know. A queue nobody drains is
 * not a safety net, it is where text goes to die. This mounts unconditionally; the
 * banner stays where it can be seen and only listens.
 *
 * Draining is idempotent: an entry is removed only after it commits, kept while the
 * server is unreachable, and marked `conflicted` — never silently re-sent — when the
 * document has moved on.
 */
export function OutboxDrain() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const runningRef = useRef(false);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;

    const drain = async () => {
      // One at a time: overlapping runs would replay the same entry twice.
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const [outbox] = await Promise.allSettled([
          replayOutbox(uid),
          replayMembershipOutbox(uid),
        ]);
        // Refresh what the replay actually WROTE. Without this the person's own
        // queued edit lands on the server while the screen still holds the old
        // value, and the freshness listener reports it as "changed on another
        // device" — an unexplained warning about their own save.
        if (outbox.status === 'fulfilled' && outbox.value.replayed > 0) {
          // ONLY the touched collections. A blanket `invalidateQueries()` refetched
          // every open query — a read spike on the person's own quota, and a visible
          // stall on a slow link, all to refresh one sermon.
          const collections = new Set(outbox.value.touched.map((entry) => entry.collection));
          await Promise.all(
            [...collections].map((collection) =>
              queryClient.invalidateQueries({
                predicate: (query) =>
                  query.queryKey.some(
                    (part) =>
                      typeof part === 'string' &&
                      part.toLowerCase().includes(collection.slice(0, -1))
                  ),
              })
            )
          );
        }
      } catch (error) {
        console.error('outbox drain failed', error);
      } finally {
        runningRef.current = false;
        window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
      }
    };

    void drain();
    const onEvent = () => void drain();
    window.addEventListener('online', onEvent);
    // `online` does not fire when a captive portal starts working, and does not
    // fire at all if connectivity returned while the tab was hidden. A slow
    // heartbeat is what keeps a queued edit from waiting forever.
    const timer = window.setInterval(onEvent, 60_000);
    return () => {
      window.removeEventListener('online', onEvent);
      window.clearInterval(timer);
    };
  }, [user?.uid, queryClient]);

  return null;
}
