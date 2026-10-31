'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { serializeContent } from '@/utils/contentFingerprint';
import {
  clearDraftIfMatches,
  draftKey,
  findDraftCopies,
  nextDraftEditTime,
  readDraft,
  readDraftsStrict,
  type DurableDraft,
  type DurableDraftCopy,
  saveDraft,
  subscribeDraftCapture,
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
  /** Stable identity of this mounted writer; omitted only for legacy callers. */
  writerId?: string;
  /** The editor's current value. Written to storage as-is. */
  value: T;
  /** False while the editor is still initialising, so we never persist a blank. */
  enabled: boolean;
  /** Explicit editor baseline; null means no confirmed value yet. Used when a
   * temporary document id changes before its create has been acknowledged. */
  confirmedValue?: T | null;
  /** Only precreate typing carries the future resource identity. */
  creationTargetId?: string;
  /** Optional feature mapping for precreate copies of the same actual resource. */
  findCopies?: (uid: string, docId: string, aggregate: string) => DurableDraftCopy<T>[];
  preferredRecoveryKey?: string | null;
  /** Logical editor identity across an optimistic document-id handoff. The draft
   * moves to docId, but recovery is inspected only once for this owner/identity. */
  recoveryIdentity?: string | null;
}

export interface UseDurableDraftResult<T> {
  /** Time of this opening's current content change, also used by immediate create backup. */
  editedAt: number;
  /**
   * Unconfirmed text found in storage when this editor opened, or null.
   * Read ONCE at mount: it must not change under the user while typing.
   */
  recovered: T | null;
  recoveredKey: string | null;
  recoveries: readonly DurableDraftCopy<T>[];
  selectRecovered: (key: string) => void;
  /** Hide equal shown words; only an equal complete baseline proves them settled. */
  settleRecovered: () => void;
  /** The user took the recovered text — hide the offer, KEEP the stored copy. */
  acceptRecovered: () => void;
  /** The user chose to keep the server version — forget the draft. */
  discardRecovered: () => void;
  /** Transfer this exact payload to a durably captured canonical request. */
  markCaptured: (captured: T, targetDocId: string, editedAt?: number) => void;
  /** Call after the server accepted `confirmed`; retires that draft only. */
  markSaved: (confirmed: T) => void;
}

/**
 * Equal shown words need no question. Hiding that question does not adopt an
 * unconfirmed independent source; the hook checks its complete baseline separately.
 * Follow each physical key so another equal copy cannot relock the first keystroke.
 */
export function useSettleShownDraft(shown: boolean, settleRecovered: () => void, sourceKey?: string | null): void {
  useEffect(() => {
    if (shown) settleRecovered();
  }, [shown, settleRecovered, sourceKey]);
}

/** The initial recovery choice belongs to this opening, not every remaining source.
 * Answering never removes a copy or proves that its words reached the server.
 */
export function useDraftQuestion(identity: string, waiting: boolean): { held: boolean; answer: () => void } {
  const [question, setQuestion] = useState(() => ({ identity, answered: false, opening: {} }));
  if (question.identity !== identity) setQuestion({ identity, answered: false, opening: {} });
  const opening = question.opening;
  const answer = useCallback(() => {
    setQuestion(current => current.opening === opening && !current.answered ? { ...current, answered: true } : current);
  }, [opening]);
  return { held: waiting && (question.identity !== identity || !question.answered), answer };
}

/**
 * Keeps the editor's text in storage that survives a closed tab, crash or reload.
 *
 * The contract with the rest of the app is the invariant from `durableDraft.ts`:
 * unsent text has a safe copy. An exact canonical request may take ownership of
 * its captured payload; otherwise only server acceptance retires that copy.
 * Historical copies with no transfer evidence keep their unknown outcome.
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
  writerId,
  value,
  enabled,
  confirmedValue,
  creationTargetId,
  findCopies = findDraftCopies,
  preferredRecoveryKey,
  recoveryIdentity = docId,
}: UseDurableDraftOptions<T>): UseDurableDraftResult<T> {
  const key = uid && docId ? draftKey(uid, docId, aggregate, writerId) : null;
  const recoveryKey = uid && recoveryIdentity ? draftKey(uid, recoveryIdentity, aggregate) : null;

  // Always-current value for the listeners below, which must not re-subscribe
  // on every keystroke just to see fresh text.
  const valueRef = useRef(value);
  valueRef.current = value;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const keyRef = useRef(key);
  keyRef.current = key;

  const [recovery, setRecovery] = useState<{ identity: string | null; copies: DurableDraftCopy<T>[] }>({ identity: null, copies: [] });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const recoveries = recovery.identity === recoveryKey ? recovery.copies : [];
  const selected = recoveries.find(copy => copy.key === selectedKey)
    ?? recoveries.find(copy => copy.key === preferredRecoveryKey) ?? recoveries[0] ?? null;
  const recovered = selected?.value ?? null;
  const recoveredKey = selected?.key ?? null;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const recoveryRef = useRef(recovery);
  recoveryRef.current = recovery;
  const recoveryKeyRef = useRef(recoveryKey);
  recoveryKeyRef.current = recoveryKey;
  const adoptedRef = useRef(new Map<string, { identity: string | null; copy: DurableDraftCopy<T> }>());
  const inspectedKeyRef = useRef<string | null>(null);

  const selectRecovered = useCallback((target: string) => {
    if (recoveryRef.current.identity === recoveryKeyRef.current && recoveryRef.current.copies.some(copy => copy.key === target)) setSelectedKey(target);
  }, []);

  // Matching words alone do not adopt another physical copy. Only this writer's
  // address and explicitly selected sources can transfer to canonical ownership.
  const retireKnownCopies = useCallback((value: T, identity: string | null, ownedKeys: readonly string[] = []) => {
    const serialised = serializeContent(value);
    const owned = new Set(ownedKeys);
    const known = recoveryRef.current.identity === identity ? recoveryRef.current.copies.filter(copy => owned.has(copy.key)) : [];
    const adopted = [...adoptedRef.current.values()].filter(entry => entry.identity === identity).map(entry => entry.copy);
    const retired = new Set<string>();
    for (const copy of [...known, ...adopted]) {
      if (serializeContent(copy.value) !== serialised) continue;
      const { key: sourceKey, sourceRecord, ...expectedCopy } = copy;
      clearDraftIfMatches(sourceKey, value, sourceRecord ?? expectedCopy);
      const remaining = readDraftsStrict([sourceKey]);
      if (!remaining || remaining.has(sourceKey)) continue;
      retired.add(sourceKey);
      adoptedRef.current.delete(sourceKey);
    }
    if (retired.size > 0) setRecovery(current => current.identity !== identity ? current : {
      ...current, copies: current.copies.filter(copy => !retired.has(copy.key)),
    });
  }, []);

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
  const capturedRef = useRef<{ keys: readonly string[]; value: string } | null>(null);
  const confirmedRef = useRef<string | null>(null);
  const confirmedKeyRef = useRef<string | null>(null);
  const serialisedValue = useMemo(() => serializeContent(value), [value]);
  const editRef = useRef({ value: serialisedValue, editedAt: nextDraftEditTime() });
  if (editRef.current.value !== serialisedValue) {
    // A new value is a new edit even when these words were typed and saved before.
    // Equal immutable objects and identity/availability changes are not edits.
    const storedTime = key ? readDraft<T>(key)?.editedAt : undefined;
    editRef.current = { value: serialisedValue, editedAt: nextDraftEditTime(Math.max(
      editRef.current.editedAt, Number.isFinite(storedTime) ? storedTime! : 0,
    )) };
    capturedRef.current = null;
  }


  // Callers with an explicit baseline retain its provenance across id adoption.
  // Legacy callers establish their opening value once per key.
  if (confirmedValue !== undefined) {
    confirmedRef.current = confirmedValue === null ? null : serializeContent(confirmedValue);
  } else if (enabled && key && confirmedKeyRef.current !== key) {
    confirmedKeyRef.current = key;
    confirmedRef.current = serializeContent(value);
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
  const persist = useCallback((targetKey: string, next: T, editedAt: number) => {
    const serialised = serializeContent(next);
    // The canonical queue already owns these words, including after this page leaves.
    if (capturedRef.current?.keys.includes(targetKey) && capturedRef.current.value === serialised) return;
    if (serialised === confirmedRef.current) {
      // Back to the server's value by hand. Retire OUR draft so it stops being
      // offered — but only if the stored one is still the one we wrote. If another
      // tab has since put its own unconfirmed text there, leave it alone.
      const ours = ourDraftRef.current;
      if (ours !== null) {
        if (ours.key === targetKey) clearDraftIfMatches(targetKey, JSON.parse(ours.value) as T, ours.record);
        ourDraftRef.current = null;
      }
      // An explicitly adopted source is ours to release too, even when the
      // person returned to the baseline before this writer's first debounce.
      const identity = recoveryKeyRef.current;
      for (const entry of [...adoptedRef.current.values()]) {
        if (entry.identity === identity) retireKnownCopies(entry.copy.value, identity);
      }
      return;
    }
    if (saveDraft(targetKey, next, creationTargetId, false, editedAt)) {
      const record = readDraft<T>(targetKey);
      if (record?.editedAt === editedAt && serializeContent(record.value) === serialised) {
        ourDraftRef.current = { key: targetKey, value: serialised, record };
      }
    }
  }, [creationTargetId, retireKnownCopies]);
  /** Keep the exact physical write for cleanup/retry, never an equal replacement. */
  const ourDraftRef = useRef<{ key: string; value: string; record: DurableDraft<T> } | null>(null);
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // Read every independently kept copy once per logical opening. Local edit time
  // orders known edits; legacy storage time is only a presentation fallback.
  useEffect(() => {
    if (!uid || !docId || !key || !recoveryKey) return;
    if (inspectedKeyRef.current === recoveryKey) return;
    const stored = findCopies(uid, docId, aggregate);
    inspectedKeyRef.current = recoveryKey;
    setSelectedKey(null);
    setRecovery({ identity: recoveryKey, copies: stored });
    // A previous opening's copies remain in storage. Switching owner or document
    // is never permission to remove unconfirmed text.
  }, [uid, docId, aggregate, key, recoveryKey, findCopies]);

  // Persist while typing, coalesced so long documents do not hit storage on
  // every keystroke.
  useEffect(() => {
    if (!enabled || !key) return;
    const editedAt = editRef.current.editedAt;
    const timeoutId = setTimeout(() => persist(key, value, editedAt), WRITE_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [enabled, key, value, persist]);

  // The page may go away before the debounce fires — write immediately then.
  useEffect(() => {
    const flush = () => {
      const currentKey = keyRef.current;
      if (!enabledRef.current || !currentKey) return;
      persistRef.current(currentKey, valueRef.current, editRef.current.editedAt);
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
      // invariant true across navigation. Moving from one note to the next is an
      // unmount too: the router keys the `[id]` segment by its value, so the next
      // note gets a new editor instance and this write covers the last keystrokes
      // of the note just left.
      flush();
    };
  }, []);

  /** Hide a shown offer; only a complete baseline match permits settled-copy cleanup. */
  const settleRecovered = useCallback(() => {
    const copy = selectedRef.current;
    if (!copy) return;
    const identity = recoveryKeyRef.current;
    // Preserve the existing completed-copy cleanup only with the entire baseline,
    // never merely another restored/typed value that happens to have equal words.
    if (serializeContent(copy.value) === confirmedRef.current) adoptedRef.current.set(copy.key, { identity, copy });
    setRecovery(current => current.identity !== identity ? current : { ...current,
      copies: current.copies.filter(candidate => candidate.key !== copy.key || serializeContent(candidate.value) !== serializeContent(copy.value)) });
  }, []);

  /** Explicitly adopt this physical source, retaining it until exact retirement. */
  const acceptRecovered = useCallback(() => {
    const copy = selectedRef.current;
    if (!copy) return;
    adoptedRef.current.set(copy.key, { identity: recoveryKeyRef.current, copy });
    settleRecovered();
  }, [settleRecovered]);

  /**
   * The user rejected the recovered text — this is the one path that deletes it.
   *
   * It deletes THAT version and nothing else. The offer stays on screen while the
   * person keeps working, so by the time they dismiss it the slot may already hold
   * NEWER text typed since: an unconditional clear here threw away the very text
   * they were writing (loss of unconfirmed text, dressed as a dismissal). Compare
   * first, delete only on an exact match.
   */
  const discardRecovered = useCallback(() => {
    const rejected = selectedRef.current;
    if (!rejected) return;
    clearDraftIfMatches(rejected.key, rejected.value);
    const identity = recoveryKeyRef.current;
    setRecovery(current => current.identity !== identity ? current : { ...current,
      copies: current.copies.filter(copy => copy.key !== rejected.key || serializeContent(copy.value) !== serializeContent(rejected.value)) });
  }, []);

  const markCaptured = useCallback((captured: T, targetDocId: string, capturedEditedAt?: number) => {
    if (!uid || !targetDocId) return;
    // A late callback for an earlier A cannot capture A typed again after B.
    if (capturedEditedAt !== undefined && capturedEditedAt !== editRef.current.editedAt) return;
    const targetKey = draftKey(uid, targetDocId, aggregate, writerId);
    // A precreate address and its reserved document are one opening. This is not
    // permission to claim an untagged legacy source or another creation's copy.
    const sourceKey = creationTargetId === targetDocId ? key : null;
    const keys = sourceKey && sourceKey !== targetKey ? [targetKey, sourceKey] : [targetKey];
    const serialised = serializeContent(captured);
    if (keyRef.current && keys.includes(keyRef.current)) capturedRef.current = { keys, value: serialised };
    clearDraftIfMatches(targetKey, captured);
    const ownsSource = sourceKey && readDraft(sourceKey)?.creationTargetId === targetDocId;
    if (ownsSource) clearDraftIfMatches(sourceKey, captured);
    if (keyRef.current === targetKey || (ownsSource && keyRef.current === sourceKey)) {
      retireKnownCopies(captured, recoveryKey, ownsSource ? keys : [targetKey]);
      if (ourDraftRef.current?.value === serialised) ourDraftRef.current = null;
    }
  }, [uid, key, aggregate, writerId, creationTargetId, recoveryKey, retireKnownCopies]);

  useEffect(() => subscribeDraftCapture(event => {
    if (event.key !== keyRef.current) return;
    const serialised = serializeContent(event.value);
    const sameEdit = event.editedAt === editRef.current.editedAt;
    if (sameEdit) capturedRef.current = { keys: [event.key], value: serialised };
    retireKnownCopies(event.value as T, recoveryKeyRef.current, [event.key]);
    if (sameEdit && ourDraftRef.current?.value === serialised) ourDraftRef.current = null;
  }), [retireKnownCopies]);

  const markSaved = useCallback((confirmed: T) => {
    const currentOpening = recoveryKeyRef.current === recoveryKey;
    if (currentOpening) confirmedRef.current = serializeContent(confirmed);
    const ownKey = currentOpening ? keyRef.current : key;
    retireKnownCopies(confirmed, recoveryKey, ownKey ? [ownKey] : []);
    const ours = ourDraftRef.current;
    if (ownKey && ours?.key === ownKey) {
      const record = readDraft<T>(ownKey);
      // Canonical preparation can refresh this same edit's capture metadata.
      if (record && record.editedAt === ours.record.editedAt && serializeContent(record.value) === ours.value) ours.record = record;
    }
    if (ownKey) clearDraftIfMatches(ownKey, confirmed,
      ours?.key === ownKey && ours.value === serializeContent(confirmed) ? ours.record : undefined);
    // Keep the exact snapshot for a departure retry if removal was refused.
    // A replacement at that address can never satisfy this old snapshot.
  }, [key, recoveryKey, retireKnownCopies]);

  return { editedAt: editRef.current.editedAt, recovered, recoveredKey, recoveries, selectRecovered, settleRecovered, acceptRecovered, discardRecovered, markCaptured, markSaved };
}
