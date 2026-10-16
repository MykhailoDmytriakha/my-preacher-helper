import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/providers/AuthProvider';
import {
  adoptLegacyRecordingDrafts,
  deleteRecordingDraft,
  listRecordingDrafts,
  saveRecordingDraft,
  subscribeRecordingDrafts,
  type RecordingDraft,
  type RecordingDraftContext,
} from '@/utils/recordingDraftStore';

const EMPTY_SOURCE_IDS: readonly string[] = [];

/** Each loaded list belongs to one account/destination; delayed reads cannot cross that boundary. */
export function useRecordingDrafts(context: RecordingDraftContext, contextId?: string, sourceOwnerId?: string, linkedSourceIds: readonly string[] = EMPTY_SOURCE_IDS) {
  const { user, loading: authLoading } = useAuth();
  const ownerId = authLoading ? null : user?.uid ?? null;
  const linkedKey = JSON.stringify(linkedSourceIds);
  const linkedIds = useMemo<readonly string[]>(() => JSON.parse(linkedKey), [linkedKey]);
  const identity = useMemo(() => ({ ownerId, context, contextId, linkedKey, readVersion: 0 }), [ownerId, context, contextId, linkedKey]);
  const current = useRef(identity);
  current.current = identity;
  const mounted = useRef(false);
  const [state, setState] = useState<{
    identity: typeof identity;
    drafts: RecordingDraft[];
    loading: boolean;
    error: unknown;
  } | null>(null);
  const isCurrent = useCallback(() => mounted.current && current.current === identity, [identity]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const version = ++identity.readVersion;
    const isLatest = () => isCurrent() && identity.readVersion === version;
    if (!ownerId) {
      if (isLatest()) setState({ identity, drafts: [], loading: false, error: null });
      return [];
    }
    try {
      if (contextId && sourceOwnerId === ownerId) {
        await adoptLegacyRecordingDrafts({ ownerId, sourceOwnerId, context, contextId });
      }
      const drafts = await listRecordingDrafts({ ownerId, context, contextId, linkedSourceIds: linkedIds });
      if (isLatest()) setState({ identity, drafts, loading: false, error: null });
      return drafts;
    } catch (error) {
      if (isLatest()) setState(previous => ({
        identity, drafts: previous?.identity === identity ? previous.drafts : [], loading: false, error,
      }));
      return [];
    }
  }, [ownerId, context, contextId, sourceOwnerId, identity, isCurrent, linkedIds]);

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeRecordingDrafts(() => { void refresh(); });
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const saveDraft = useCallback(async (input: { blob: Blob; mimeType: string; id?: string }) => {
    if (!ownerId || !contextId) throw new Error('Recording owner and destination are required');
    const id = await saveRecordingDraft({ ...input, ownerId, context, contextId });
    await refresh();
    return id;
  }, [ownerId, context, contextId, refresh]);

  const removeDraft = useCallback(async (id: string) => {
    if (!ownerId) throw new Error('Recording owner is required');
    // The card is useful until storage accepted the deletion; a refusal must leave it visible.
    await deleteRecordingDraft(id, ownerId);
    if (isCurrent()) {
      void refresh();
      setState(previous => previous?.identity === identity
        ? { ...previous, drafts: previous.drafts.filter(draft => draft.id !== id) } : previous);
    }
  }, [ownerId, identity, isCurrent, refresh]);

  const shown = state?.identity === identity ? state : null;
  return { drafts: shown?.drafts ?? [], loading: Boolean(ownerId) && (shown?.loading ?? true),
    error: shown?.error ?? null, ownerId, saveDraft, removeDraft, refresh };
}
