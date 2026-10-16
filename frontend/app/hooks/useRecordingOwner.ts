import { useEffect, useMemo, useRef } from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { deleteRecordingDraft } from '@/utils/recordingDraftStore';

/** Recorder callbacks retain their account and screen; late answers cannot update another owner. */
export function useRecordingOwner(contextId: string) {
  const { user, loading } = useAuth();
  const ownerId = loading ? undefined : user?.uid;
  const ownership = useMemo(() => ({ ownerId, contextId, sources: new Map<string, string>() }), [ownerId, contextId]);
  const current = useRef(ownership); current.current = ownership;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return {
    ownerId: ownerId ?? '',
    key: JSON.stringify([ownerId, contextId]),
    isCurrent: () => mounted.current && current.current === ownership,
    remember: (slot: string, id: string) => { ownership.sources.set(slot, id); },
    discard: async (slot: string) => {
      const id = ownership.sources.get(slot);
      if (!id || !ownerId) return;
      await deleteRecordingDraft(id, ownerId);
      if (ownership.sources.get(slot) === id) ownership.sources.delete(slot);
    },
  };
}
