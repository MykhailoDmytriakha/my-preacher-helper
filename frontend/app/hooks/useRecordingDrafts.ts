import { useCallback, useEffect, useState } from 'react';

import {
  deleteRecordingDraft,
  listRecordingDrafts,
  pruneExpiredDrafts,
  saveRecordingDraft,
  type RecordingDraft,
  type RecordingDraftContext,
} from '@/utils/recordingDraftStore';

/**
 * Reads/writes the durable recording-draft store scoped to one page context
 * (e.g. a study or sermon). On mount it prunes expired drafts, then loads the
 * ones for this context/contextId. Mutations update local state optimistically
 * and persist to IndexedDB in the background. SSR-safe: the store functions
 * no-op when IndexedDB is unavailable.
 */
export function useRecordingDrafts(context: RecordingDraftContext, contextId?: string) {
  const [drafts, setDrafts] = useState<RecordingDraft[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const loaded = await listRecordingDrafts({ context, contextId });
    setDrafts(loaded);
    return loaded;
  }, [context, contextId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      await pruneExpiredDrafts();
      const loaded = await listRecordingDrafts({ context, contextId });
      if (!cancelled) {
        setDrafts(loaded);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context, contextId]);

  const saveDraft = useCallback(
    async (input: { blob: Blob; mimeType: string; id?: string }): Promise<string> => {
      const id = await saveRecordingDraft({ ...input, context, contextId });
      // Reconcile from the store so createdAt/sizeBytes/order match persisted state.
      await refresh();
      return id;
    },
    [context, contextId, refresh]
  );

  const removeDraft = useCallback(async (id: string): Promise<void> => {
    setDrafts((prev) => prev.filter((d) => d.id !== id)); // optimistic
    await deleteRecordingDraft(id);
  }, []);

  return { drafts, loading, saveDraft, removeDraft, refresh };
}
