import debounce from 'lodash/debounce';
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Thought, ThoughtsBySection, Sermon } from "@/models/models";
import { updateStructure } from "@/services/structure.service";
import { updateThought } from "@/services/thought.service";

const SYNC_TTL_MS = 30 * 60 * 1000;
const SYNC_SUCCESS_MS = 3500;

interface UsePersistenceProps {
  setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
  onThoughtSyncStateChange?: (
    thoughtId: string,
    status?: 'pending' | 'error' | 'success',
    meta?: { expiresAt?: string; lastError?: string; successAt?: string; operation?: 'create' | 'update' | 'delete' }
  ) => void;
}

export const usePersistence = ({ setSermon, onThoughtSyncStateChange }: UsePersistenceProps) => {
  const { t } = useTranslation();
  const debouncedThoughtsRef = useRef<Map<string, ReturnType<typeof debounce>>>(new Map());
  const latestThoughtByKeyRef = useRef<Map<string, { sermonId: string; thought: Thought }>>(new Map());
  /**
   * The thought AS THIS SCREEN LAST KNEW IT TO BE STORED — the opening value, then
   * whatever a save confirmed. The write states only the fields that differ from it,
   * so dragging a thought between plan points stops re-sending this screen's old copy
   * of its TEXT over a rewrite made on another device hours earlier.
   *
   * It must ADVANCE on every confirmed save. Frozen at the opening value, the second
   * save of the session would state its own already-committed text as a change again
   * and overwrite whatever landed in between.
   */
  const baseThoughtByKeyRef = useRef<Map<string, Thought>>(new Map());
  const successTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const buildSyncExpiresAt = useCallback(() => {
    return new Date(Date.now() + SYNC_TTL_MS).toISOString();
  }, []);

  const clearSuccessTimer = useCallback((thoughtId: string) => {
    const timer = successTimersRef.current.get(thoughtId);
    if (timer) {
      clearTimeout(timer);
      successTimersRef.current.delete(thoughtId);
    }
  }, []);

  const scheduleSyncClear = useCallback((thoughtId: string) => {
    clearSuccessTimer(thoughtId);
    const timer = setTimeout(() => {
      onThoughtSyncStateChange?.(thoughtId);
      successTimersRef.current.delete(thoughtId);
    }, SYNC_SUCCESS_MS);
    successTimersRef.current.set(thoughtId, timer);
  }, [clearSuccessTimer, onThoughtSyncStateChange]);

  // Save functions for structure and thoughts
  /**
   * The arrangement this screen believes is stored — the value it opened with, then
   * whatever a save confirmed. It lets the write tell a move made HERE from one made on
   * another device; frozen, the second save of a session would revert their move again.
   */
  const baseStructureRef = useRef<ThoughtsBySection | null>(null);

  const saveStructure = useCallback(
    async (sermonId: string, structure: ThoughtsBySection, baseStructure?: ThoughtsBySection | null) => {
      if (baseStructure && !baseStructureRef.current) baseStructureRef.current = baseStructure;
      try {
        await updateStructure(sermonId, structure, baseStructureRef.current);
        baseStructureRef.current = structure;
      } catch {
        toast.error(t('errors.failedToSaveStructure'));
      }
    },
    [t]
  );

  const saveThought = useCallback(
    async (
      sermonId: string,
      thought: Thought,
      options?: { markPending?: boolean; baseThought?: Thought | null }
    ) => {
      const key = `${sermonId}:${thought.id}`;
      latestThoughtByKeyRef.current.set(key, { sermonId, thought });
      if (options?.baseThought && !baseThoughtByKeyRef.current.has(key)) {
        baseThoughtByKeyRef.current.set(key, options.baseThought);
      }
      clearSuccessTimer(thought.id);

      if (options?.markPending !== false) {
        onThoughtSyncStateChange?.(thought.id, 'pending', {
          expiresAt: buildSyncExpiresAt(),
          operation: 'update',
        });
      }

      try {
        const updatedThought = await updateThought(
          sermonId,
          thought,
          baseThoughtByKeyRef.current.get(key) ?? null
        );
        // CONFIRMED: this is now what the screen knows to be stored.
        baseThoughtByKeyRef.current.set(key, updatedThought);
        setSermon((prev: Sermon | null) => {
          if (!prev) return prev;
          return {
            ...prev,
            thoughts: prev.thoughts.map((t: Thought) => (t.id === updatedThought.id ? updatedThought : t)),
          };
        });
        onThoughtSyncStateChange?.(thought.id, 'success', {
          successAt: new Date().toISOString(),
          operation: 'update',
        });
        scheduleSyncClear(thought.id);
      } catch {
        onThoughtSyncStateChange?.(thought.id, 'error', {
          expiresAt: buildSyncExpiresAt(),
          lastError: t('errors.failedToSaveThought'),
          operation: 'update',
        });
        toast.error(t('errors.failedToSaveThought'));
      }
    },
    [buildSyncExpiresAt, clearSuccessTimer, onThoughtSyncStateChange, scheduleSyncClear, setSermon, t]
  );

  // Create debounced versions
  const debouncedSaveStructure = useMemo(() => debounce(saveStructure, 500), [saveStructure]);
  const debouncedSaveThought = useCallback(
    (sermonId: string, thought: Thought, baseThought?: Thought | null) => {
      const key = `${sermonId}:${thought.id}`;
      latestThoughtByKeyRef.current.set(key, { sermonId, thought });
      if (baseThought && !baseThoughtByKeyRef.current.has(key)) {
        baseThoughtByKeyRef.current.set(key, baseThought);
      }
      clearSuccessTimer(thought.id);
      onThoughtSyncStateChange?.(thought.id, 'pending', {
        expiresAt: buildSyncExpiresAt(),
        operation: 'update',
      });

      let debounced = debouncedThoughtsRef.current.get(key);
      if (!debounced) {
        debounced = debounce((nextSermonId: string, nextThought: Thought) => {
          void saveThought(nextSermonId, nextThought, { markPending: false });
        }, 500);
        debouncedThoughtsRef.current.set(key, debounced);
      }
      debounced(sermonId, thought);
    },
    [buildSyncExpiresAt, clearSuccessTimer, onThoughtSyncStateChange, saveThought]
  );

  const retryThoughtSave = useCallback(async (sermonId: string, thoughtId: string) => {
    const key = `${sermonId}:${thoughtId}`;
    const latest = latestThoughtByKeyRef.current.get(key);
    if (!latest) return;

    const debounced = debouncedThoughtsRef.current.get(key);
    if (debounced) {
      debounced.cancel();
    }

    await saveThought(latest.sermonId, latest.thought);
  }, [saveThought]);

  // NOTE (2026-07-25): a pagehide/visibility flush of pending debounced saves was
  // tried here and REMOVED. `hidden` fires on ordinary tab switches, so flushing
  // V1 there and letting the user come back and type V2 produced a newest-edit-
  // LOSES race (V2 commits, then the in-flight V1 writes its stale full Thought),
  // whereas the plain debounce coalesced V1+V2 into one save. Rescuing an edit
  // from a killed tab needs per-{sermonId,thoughtId} serialization with stale-
  // completion suppression plus a durable intent — see FIRESTORE_SYNC_RESEARCH.md.
  // Prevent stray saves after unmount or navigation
  // Cancel debounced functions on unmount to avoid writing to stale sermons
  useEffect(() => {
    const debouncedThoughts = debouncedThoughtsRef.current;
    const latestThoughtByKey = latestThoughtByKeyRef.current;
    const successTimers = successTimersRef.current;
    return () => {
      try { debouncedSaveStructure.flush(); } catch {}
      debouncedThoughts.forEach((debounced) => {
        try { debounced.flush(); } catch {}
      });
      debouncedThoughts.clear();
      latestThoughtByKey.clear();
      successTimers.forEach((timer) => clearTimeout(timer));
      successTimers.clear();
    };
  }, [debouncedSaveStructure]);

  return {
    saveStructure,
    saveThought,
    debouncedSaveStructure,
    debouncedSaveThought,
    retryThoughtSave,
  };
};
