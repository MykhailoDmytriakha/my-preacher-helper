'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { clearDraft, draftKey, readDraft, saveDraft } from '@/utils/durableDraft';

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
    setConflictState(stored ? stored.value : null);
  }, [key]);

  const setConflict = useCallback((next: PersistedConflict<T> | null) => {
    setConflictState(next);
    const currentKey = keyRef.current;
    if (!currentKey) return;
    if (next) saveDraft(currentKey, next);
    else clearDraft(currentKey);
  }, []);

  return [conflict, setConflict] as const;
}
