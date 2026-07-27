'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearDraftIfMatches,
  draftKey,
  readDraft,
  saveDraft,
} from '@/utils/durableDraft';

/** How long to coalesce keystrokes before touching storage. */
const WRITE_DELAY_MS = 250;

export interface UseDurableDraftOptions<T> {
  /** Draft owner. Null disables the hook (no uid = no safe key to write under). */
  uid: string | null | undefined;
  /** Document being edited. Null/undefined disables the hook. */
  docId: string | null | undefined;
  /** Which independently edited part of that document this draft belongs to. */
  aggregate: string;
  /** The editor's current value. Written to storage as-is. */
  value: T;
  /** False while the editor is still initialising, so we never persist a blank. */
  enabled: boolean;
}

export interface UseDurableDraftResult<T> {
  /**
   * Unconfirmed text found in storage when this editor opened, or null.
   * Read ONCE at mount: it must not change under the user while typing.
   */
  recovered: T | null;
  /** The user took the recovered text — hide the offer, KEEP the stored copy. */
  acceptRecovered: () => void;
  /** The user chose to keep the server version — forget the draft. */
  discardRecovered: () => void;
  /** Call after the server accepted `confirmed`; retires that draft only. */
  markSaved: (confirmed: T) => void;
}

/**
 * Keeps the editor's text in storage that survives a closed tab, crash or reload.
 *
 * The contract with the rest of the app is the invariant from `durableDraft.ts`:
 * a stored draft means "this text was never confirmed saved". So the editor
 * writes on every change, and only a successful write clears it.
 *
 * WHY A `pagehide` LISTENER AND NOT `beforeunload`. The debounce means the last
 * few hundred milliseconds of typing are not in storage yet, and closing a tab
 * is exactly when that matters. `pagehide` fires for tab close, navigation and
 * mobile backgrounding — including iOS Safari, where `beforeunload` is not
 * reliable. `visibilitychange` to hidden covers the app-switch case that never
 * unloads at all.
 *
 * The recovered draft is deliberately NOT applied automatically. Auto-applying is
 * what makes the existing preparation backup unsafe: a draft left behind by a
 * failed save keeps winning over text genuinely edited later on another device
 * (`sermons/[id]/page.tsx:307-310`, "Local wins over stale remote"). Here the
 * caller is handed the draft and decides — which is also what lets the same text
 * survive whichever choice the user makes.
 */
export function useDurableDraft<T>({
  uid,
  docId,
  aggregate,
  value,
  enabled,
}: UseDurableDraftOptions<T>): UseDurableDraftResult<T> {
  const key = uid && docId ? draftKey(uid, docId, aggregate) : null;

  // Always-current value for the listeners below, which must not re-subscribe
  // on every keystroke just to see fresh text.
  const valueRef = useRef(value);
  valueRef.current = value;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const keyRef = useRef(key);
  keyRef.current = key;

  const [recovered, setRecovered] = useState<T | null>(null);
  const inspectedKeyRef = useRef<string | null>(null);

  /**
   * The last value known to be safely on the server: the text the editor opened
   * with, then whatever a successful save confirmed.
   *
   * WITHOUT THIS the invariant "a draft exists <=> text is unconfirmed" breaks in
   * a way that eventually destroys data. Writing on every flush leaves a draft
   * behind after merely *visiting* a document. It looks harmless — the draft
   * equals the content, so no banner — right up until that document is edited on
   * another device. Then the stale leftover suddenly differs from the fresh
   * server text and the editor offers to "restore" OLD text over NEW. That is
   * exactly the failure mode of the preparation backup this module replaces.
   * Found by using the feature, not by unit tests.
   */
  const confirmedRef = useRef<string | null>(null);
  const confirmedKeyRef = useRef<string | null>(null);

  // The value an editor opens with IS the server's value, so it starts confirmed.
  if (enabled && key && confirmedKeyRef.current !== key) {
    confirmedKeyRef.current = key;
    confirmedRef.current = JSON.stringify(value);
  }

  /**
   * Store genuinely unconfirmed text. Text equal to the baseline is simply NOT
   * written — it is already on the server, so there is nothing to protect.
   *
   * ⚠️ IT MUST NOT DELETE. An earlier version cleared the draft whenever the value
   * matched the baseline, and that destroyed the very thing this module exists for:
   *   - an editor OPENS showing the server value, which IS the baseline, so the
   *     unconfirmed text found at open was wiped ~250ms later — while the user was
   *     still looking at the offer to restore it (the in-memory copy hid this until
   *     a reload, and then there was nothing left);
   *   - an UNTOUCHED tab would wipe unconfirmed text another tab had just stored
   *     under the shared key.
   * Retiring a draft is the job of whoever knows it was confirmed — `markSaved`,
   * which compares before removing. Both failures are locked by tests.
   */
  const persist = useCallback((targetKey: string, next: T) => {
    const serialised = JSON.stringify(next);
    if (serialised === confirmedRef.current) {
      // Back to the server's value by hand. Retire OUR draft so it stops being
      // offered — but only if the stored one is still the one we wrote. If another
      // tab has since put its own unconfirmed text there, leave it alone.
      if (ourDraftRef.current !== null) {
        clearDraftIfMatches(targetKey, JSON.parse(ourDraftRef.current) as T);
        ourDraftRef.current = null;
      }
      return;
    }
    saveDraft(targetKey, next);
    ourDraftRef.current = serialised;
  }, []);
  /** The last unconfirmed value THIS hook instance stored, so it can retire it. */
  const ourDraftRef = useRef<string | null>(null);
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // Look for unconfirmed text exactly once per document.
  useEffect(() => {
    if (!key || inspectedKeyRef.current === key) return;
    inspectedKeyRef.current = key;
    const stored = readDraft<T>(key);
    setRecovered(stored ? stored.value : null);
    // NOTE: deliberately NOT clearing the previous key here. The key also changes
    // when the user navigates from one document to another WITHOUT unmounting this
    // hook, so clearing it would destroy the unsaved draft of the document just
    // left — the exact loss this module exists to prevent. A placeholder id like
    // "new" is a caller-level concept, so the caller retires that draft itself at
    // the moment the server assigns a real id.
  }, [key]);

  // Persist while typing, coalesced so long documents do not hit storage on
  // every keystroke.
  useEffect(() => {
    if (!enabled || !key) return;
    const timeoutId = setTimeout(() => persist(key, value), WRITE_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [enabled, key, value]);

  // The page may go away before the debounce fires — write immediately then.
  useEffect(() => {
    const flush = () => {
      const currentKey = keyRef.current;
      if (!enabledRef.current || !currentKey) return;
      persistRef.current(currentKey, valueRef.current);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // Unmount is also a moment the text can disappear from memory: leaving the
      // route runs cleanup, and the note editor's pending save is cancelled by
      // its own cleanup. Writing here costs one storage write and keeps the
      // invariant true across navigation.
      flush();
    };
  }, []);

  /**
   * The user took the recovered text into the editor. Hide the offer, but KEEP the
   * stored copy: that text is still unconfirmed, and deleting it here leaves a
   * window — between the click and the next write — where the only durable copy is
   * gone. `markSaved` retires it once the server accepts it.
   */
  const acceptRecovered = useCallback(() => {
    setRecovered(null);
  }, []);

  /**
   * The user rejected the recovered text — this is the one path that deletes it.
   *
   * It deletes THAT version and nothing else. The offer stays on screen while the
   * person keeps working, so by the time they dismiss it the slot may already hold
   * NEWER text typed since: an unconditional clear here threw away the very text
   * they were writing (loss of unconfirmed text, dressed as a dismissal). Compare
   * first, delete only on an exact match.
   */
  const recoveredRef = useRef<T | null>(null);
  recoveredRef.current = recovered;
  const discardRecovered = useCallback(() => {
    const rejected = recoveredRef.current;
    setRecovered(null);
    if (keyRef.current && rejected !== null) clearDraftIfMatches(keyRef.current, rejected);
  }, []);

  const markSaved = useCallback((confirmed: T) => {
    // Record it even without a key so a later flush cannot re-store saved text.
    confirmedRef.current = JSON.stringify(confirmed);
    if (!keyRef.current) return;
    clearDraftIfMatches(keyRef.current, confirmed);
  }, []);

  return { recovered, acceptRecovered, discardRecovered, markSaved };
}
