'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { clearDraftIfMatches, draftKey, readDraft, saveDraft } from '@/utils/durableDraft';

/**
 * A refused save, held somewhere that survives a reload.
 *
 * WHY THIS EXISTS. When the server turns a save away, the text that was refused
 * has nowhere to live: the sermon header has already closed its editor, the
 * series/prayer modal has already dismissed, the group cache has been rolled back
 * to the server's truth. For a while we kept it in component state — and
 * adversarial review was right that this is a trap: a reload, a crash, a stray
 * navigation or a tab eviction before the person chooses destroys the only copy.
 * That is the exact failure the whole mechanism exists to prevent, just moved one
 * step later.
 *
 * So the pending conflict is mirrored into the same durable store the note editor
 * uses, under its own aggregate namespace (`conflict:<aggregate>`), and read back
 * on mount. The person can close the laptop mid-conflict and still find their
 * words waiting.
 *
 * It is deliberately NOT keyed per browser tab: two tabs editing the same document
 * share one slot, so the later refusal wins. That is a known limit of the storage
 * layer (BUGS.md), not a new one introduced here.
 */
export interface PersistedConflict<T> {
  /** What was refused — enough to re-send it verbatim. */
  payload: T;
  /** The server's revision AT REFUSAL: what a deliberate overwrite must state. */
  actualRevision: number;
}

export function usePersistedConflict<T>(
  uid: string | null | undefined,
  docId: string | null | undefined,
  aggregate: string
) {
  const [conflict, setConflictState] = useState<PersistedConflict<T> | null>(null);

  const key = uid && docId ? draftKey(uid, docId, `conflict:${aggregate}`) : null;
  const keyRef = useRef(key);
  keyRef.current = key;

  // Restore on mount / when the document changes. A conflict belongs to ONE
  // document, so switching documents must not carry it across.
  const restoredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!key) return;
    if (restoredForRef.current === key) return;
    restoredForRef.current = key;
    const stored = readDraft<PersistedConflict<T>>(key);
    if (stored) ownByKeyRef.current.set(key, stored.value);
    setConflictState(stored ? stored.value : null);
  }, [key]);

  /**
   * What THIS tab believes the pending conflict to be — PER DOCUMENT.
   *
   * It used to be a single value, and that was a hole with teeth: one hook instance
   * serves many documents, because a navigation re-renders the page instead of
   * remounting it. So a resolution for document A landing after the person moved to
   * document B compared A's record against B's key, matched nothing — and cleared
   * B's slot regardless, destroying the only durable copy of a refusal B had not even
   * shown yet.
   *
   * Binding the key at write time was tried first and PROVED INSUFFICIENT by its own
   * test, for the reason this map fixes: by the time A's answer lands, the restore
   * effect has already replaced the single remembered value with B's. Remembering
   * ownership per key removes the collision instead of racing it — every document
   * keeps its own record, and a clear can only ever remove the record it stored.
   */
  const ownByKeyRef = useRef<Map<string, PersistedConflict<T>>>(new Map());

  /**
   * @param docIdOverride the document this conflict belongs to, when the caller
   *   learns it in the SAME render as the conflict itself. Without it the key
   *   would be built from state React has not committed yet, and the record would
   *   land under the previous document — or under none at all.
   */
  const setConflict = useCallback(
    (next: PersistedConflict<T> | null, docIdOverride?: string) => {
    const currentKey =
      docIdOverride && uid ? draftKey(uid, docIdOverride, `conflict:${aggregate}`) : keyRef.current;

    if (next) {
      setConflictState(next);
      if (!currentKey) return;
      ownByKeyRef.current.set(currentKey, next);
      saveDraft(currentKey, next);
      return;
    }

    // A CLEAR MAY ONLY EMPTY THE DOCUMENT IT NAMES. When it names another one — a
    // resolution finishing after the person navigated away — blanking the visible
    // slot would erase the banner holding THIS document's refused text from the
    // screen, even though the disk still had it.
    if (currentKey && keyRef.current && currentKey !== keyRef.current) {
      const mine = readDraft<PersistedConflict<T>>(keyRef.current);
      setConflictState(mine ? mine.value : null);
    } else {
      setConflictState(null);
    }
    if (!currentKey) return;

    // COMPARE BEFORE CLEARING. Two tabs on one document share this slot, so the
    // later refusal owns it. An unconditional clear meant tab A, resolving its
    // own conflict, deleted tab B's only copy of refused text — the loss this
    // layer exists to prevent, introduced by the layer itself.
    const own = ownByKeyRef.current.get(currentKey);
    ownByKeyRef.current.delete(currentKey);
    if (own) clearDraftIfMatches(currentKey, own);
    },
    [uid, aggregate]
  );

  return [conflict, setConflict] as const;
}
