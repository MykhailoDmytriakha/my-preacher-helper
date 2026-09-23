import { useCallback, useMemo } from 'react';

import { useDataDocument } from '@/data-engine/react.client';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

import type { Sermon } from '@/models/models';

/**
 * The same shape `useSermon` gives a screen, read from the engine document. Render inside the
 * sermon's DataDocumentProvider so the screen and its writer share one editor.
 *
 * `setSermon` does nothing on purpose: an engine write changes the draft at once, and that draft
 * is what the screen renders, so a legacy optimistic mirror would only be a second, stale copy.
 */
export function useEngineSermonSource(sermonId: string) {
  const document = useDataDocument({ collection: 'sermons', id: sermonId });
  const isOnline = useOnlineStatus();
  const sermon = useMemo(() => document.data
    ? ({ ...document.data, id: sermonId, thoughts: document.data.thoughts ?? [] } as unknown as Sermon)
    : null, [document.data, sermonId]);
  const setSermon = useCallback(async (_updater: unknown) => undefined, []);
  const refreshSermon = useCallback(async () => { await document.retry().catch(() => undefined); }, [document]);
  const error = useMemo(() => document.error ? new Error(document.error) : null, [document.error]);
  return {
    sermon, setSermon, loading: document.loading, error, isOnline,
    awaitingFirstAnswer: document.loading, refreshSermon,
    getSortedThoughts: () => [...(sermon?.thoughts ?? [])],
    document,
  };
}
