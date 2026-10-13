import { useCallback, useMemo } from 'react';

import { usePublishShellTitle } from '@/components/navigation/shellTitles';
import { useDataDocument } from '@/data-engine/react.client';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

import type { Sermon } from '@/models/models';

/**
 * The sermon a plan screen shows, read from the engine document. Render inside the sermon's
 * DataDocumentProvider so the screen and its writer share one editor.
 *
 * There is no setter: an engine write changes the draft at once, and that draft is what the
 * screen renders, so a screen-side mirror would only be a second, stale copy.
 */
export function useEngineSermonSource(sermonId: string) {
  const document = useDataDocument({ collection: 'sermons', id: sermonId });
  usePublishShellTitle('sermons', sermonId, document.data);
  const isOnline = useOnlineStatus();
  const sermon = useMemo(() => document.data
    ? ({ ...document.data, id: sermonId, thoughts: document.data.thoughts ?? [] } as unknown as Sermon)
    : null, [document.data, sermonId]);
  const refreshSermon = useCallback(async () => { await document.retry().catch(() => undefined); }, [document]);
  // `error` means "could not load". A sermon on the screen has loaded; the
  // document's own later failures (a save, a refusal) are said by DataSyncStatus above the page, and
  // must not turn the page into an error screen (BUG-20260927-engine-background-error-sticks-on-every-screen).
  const error = useMemo(() => document.error && !sermon ? new Error(document.error) : null, [document.error, sermon]);
  return {
    sermon, loading: document.loading, error, isOnline,
    awaitingFirstAnswer: document.loading, refreshSermon,
    getSortedThoughts: () => [...(sermon?.thoughts ?? [])],
    document,
  };
}
