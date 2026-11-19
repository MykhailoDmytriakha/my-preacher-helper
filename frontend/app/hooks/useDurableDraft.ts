'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { newClientId } from '@/utils/clientId';
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
const NO_COPIES: readonly DurableDraftCopy<unknown>[] = [];

interface DraftHandoff {
  key: string;
  editedAt: number;
}

interface AdoptedDraft<T> {
  identity: string | null;
  copy: DurableDraftCopy<T>;
  selectedAt?: DraftHandoff;
  allowConfirmedReturn?: boolean;
}

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
  /** Optional proof that a successful save covers the value of an already-owned recovery source. */
  isRecoveredDraftSaved?: (source: T, saved: T) => boolean;
  preferredRecoveryKey?: string | null;
  /** Logical editor identity across an optimistic document-id handoff. The draft
   * moves to docId, but recovery is inspected only once for this owner/identity. */
  recoveryIdentity?: string | null;
  /**
   * What the words being written are built from — the baseline the editor's own save of them would compare against —
   * read at every write, the debounced one and the departure flush alike, given those very words, and kept beside them
   * (`DurableDraft.base`). Omitted: copies are written without a base, as before.
   */
  readBase?: (value: T) => unknown;
}

export interface UseDurableDraftResult<T> {
  /** Time of this opening's current content change, also used by immediate create backup. */
  editedAt: number;
  /**
   * Unconfirmed text found in storage when this editor opened, or null.
   * Read ONCE at mount: it must not change under the user while typing.
   */
  recovered: T | null;
  /** What the selected copy was built from, unvalidated; undefined for a copy written without one. */
  recoveredBase: unknown;
  recoveredKey: string | null;
  recoveries: readonly DurableDraftCopy<T>[];
  selectRecovered: (key: string) => void;
  /** Hide equal shown words; only an equal complete baseline proves them settled. */
  settleRecovered: (verifiedBaseline?: T) => void;
  /** The user took the recovered text — hide the offer, KEEP the stored copy (every copy of its session). */
  acceptRecovered: (options?: { transferToWriter: true }) => void;
  /** The user chose to keep the server version — forget the draft (every copy of its session). */
  discardRecovered: () => void;
  /**
   * What the words are built from moved while the words did not (this device has just stored a save of earlier words):
   * write this writer's last copy again, with the base read now.
   */
  rewriteCopy: () => void;
  /** Transfer this exact payload to a durably captured canonical request. */
  markCaptured: (captured: T, targetDocId: string, editedAt?: number) => void;
  /** Hold independently confirmed words until an explicit comparison choice. */
  holdAlternative: (value: T) => ((keep: boolean) => void) | undefined;
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

/**
 * Two physical copies of ONE editing session: the same words built from the same base — written, for example, by two
 * openings that restored the same copy and were left before its question was answered. They are one choice, and one
 * answer settles them all. Words and base together are the session's identity; matching words alone are not, so a
 * copy written without a base stays a choice of its own.
 */
function sameSession(left: DurableDraftCopy<unknown>, right: DurableDraftCopy<unknown>): boolean {
  return left.base !== undefined && right.base !== undefined
    && serializeContent(left.value) === serializeContent(right.value) && serializeContent(left.base) === serializeContent(right.base);
}

/** Every listed copy of the session `copy` belongs to; at least the copy itself. */
function sessionOf<T>(copies: readonly DurableDraftCopy<T>[], copy: DurableDraftCopy<T>): DurableDraftCopy<T>[] {
  const members = copies.filter(other => sameSession(other, copy));
  return members.length > 0 ? members : [copy];
}

/** Drop the listed copies that are members of `session` (the same address holding the same words). */
function withoutSession<T>(copies: readonly DurableDraftCopy<T>[], session: readonly DurableDraftCopy<T>[]): DurableDraftCopy<T>[] {
  return copies.filter(candidate => !session.some(member => member.key === candidate.key
    && serializeContent(member.value) === serializeContent(candidate.value)));
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
  isRecoveredDraftSaved,
  preferredRecoveryKey,
  recoveryIdentity = docId,
  readBase,
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
  const readBaseRef = useRef(readBase);
  readBaseRef.current = readBase;

  const [recovery, setRecovery] = useState<{ identity: string | null; copies: DurableDraftCopy<T>[] }>({ identity: null, copies: [] });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const copies = recovery.identity === recoveryKey ? recovery.copies : NO_COPIES as DurableDraftCopy<T>[];
  const selected = copies.find(copy => copy.key === selectedKey)
    ?? copies.find(copy => copy.key === preferredRecoveryKey) ?? copies[0] ?? null;
  // One choice per session: the selected copy stands for its own session, any other session by its first copy.
  const recoveries = useMemo(() => copies.filter(copy => {
    const session = sessionOf(copies, copy);
    return copy === (selected && session.includes(selected) ? selected : session[0]);
  }), [copies, selected]);
  const recovered = selected?.value ?? null;
  const recoveredBase = selected?.base;
  const recoveredKey = selected?.key ?? null;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const recoveryRef = useRef(recovery);
  recoveryRef.current = recovery;
  const recoveryKeyRef = useRef(recoveryKey);
  recoveryKeyRef.current = recoveryKey;
  const adoptedRef = useRef(new Map<string, AdoptedDraft<T>>());
  const inspectedKeyRef = useRef<string | null>(null);

  const selectRecovered = useCallback((target: string) => {
    if (recoveryRef.current.identity === recoveryKeyRef.current && recoveryRef.current.copies.some(copy => copy.key === target)) setSelectedKey(target);
  }, []);

  // Matching words alone do not adopt another physical copy. Only this writer's
  // address and explicitly selected sources can transfer to canonical ownership.
  const retireKnownCopies = useCallback((
    value: T,
    identity: string | null,
    ownedKeys: readonly string[] = [],
    covers?: (source: T, saved: T) => boolean,
    handoff?: DraftHandoff & { only?: boolean },
  ) => {
    const serialised = serializeContent(value);
    const owned = new Set(ownedKeys);
    const known = recoveryRef.current.identity === identity ? recoveryRef.current.copies.filter(copy => owned.has(copy.key)) : [];
    const adopted = [...adoptedRef.current.values()].filter(entry => entry.identity === identity);
    const transferred = new Set(adopted.filter(({ selectedAt }) =>
      handoff && selectedAt && selectedAt.key === handoff.key && handoff.editedAt > selectedAt.editedAt,
    ).map(({ copy }) => copy.key));
    const retired = new Set<string>();
    for (const copy of [...known, ...adopted.map(entry => entry.copy)]) {
      const moved = transferred.has(copy.key);
      if (!moved && (handoff?.only || (serializeContent(copy.value) !== serialised && !covers?.(copy.value, value)))) continue;
      const { key: sourceKey, sourceRecord, ...expectedCopy } = copy;
      const physical = sourceRecord ?? expectedCopy;
      clearDraftIfMatches(sourceKey, moved || covers ? physical.value : value, physical);
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
        if (entry.identity === identity && (!entry.selectedAt || (entry.allowConfirmedReturn
          && entry.selectedAt.key === targetKey && editedAt > entry.selectedAt.editedAt))) retireKnownCopies(entry.copy.value, identity);
      }
      return;
    }
    // The base as it is now for these words: the same baseline the editor's next save of them would carry.
    if (saveDraft(targetKey, next, creationTargetId, false, editedAt, readBaseRef.current?.(next))) {
      const record = readDraft<T>(targetKey);
      if (record?.editedAt === editedAt && serializeContent(record.value) === serialised) {
        ourDraftRef.current = { key: targetKey, value: serialised, record };
        if (adoptedRef.current.size) retireKnownCopies(next, recoveryKeyRef.current, [], undefined, { key: targetKey, editedAt, only: true });
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

  /** The copies listed for this opening: the selected copy's session is looked up among them. */
  const listedCopies = useCallback(() => recoveryRef.current.identity === recoveryKeyRef.current
    ? recoveryRef.current.copies : NO_COPIES as DurableDraftCopy<T>[], []);

  /** Hide a shown offer; only a complete baseline match permits settled-copy cleanup. */
  const settleRecovered = useCallback((verifiedBaseline?: T) => {
    const copy = selectedRef.current;
    if (!copy) return;
    const identity = recoveryKeyRef.current;
    const session = sessionOf(listedCopies(), copy);
    // Preserve the existing completed-copy cleanup only with the entire baseline,
    // never merely another restored/typed value that happens to have equal words.
    const stored = serializeContent(copy.value);
    const verified = verifiedBaseline !== undefined && stored === serializeContent(verifiedBaseline);
    if (stored === confirmedRef.current || verified) {
      for (const member of session) adoptedRef.current.set(member.key, { identity, copy: member });
    }
    if (verified) retireKnownCopies(verifiedBaseline, identity);
    setRecovery(current => current.identity !== identity ? current : { ...current, copies: withoutSession(current.copies, session) });
  }, [retireKnownCopies, listedCopies]);

  /**
   * Explicitly adopt this physical source — every copy of its session — retaining each until exact retirement.
   * A transfer to this writer also retires them once the writer's own later copy returns to a confirmed save.
   */
  const acceptRecovered = useCallback((options?: { transferToWriter: true }) => {
    const copy = selectedRef.current;
    if (!copy) return;
    const identity = recoveryKeyRef.current;
    const writer = keyRef.current;
    const transfer = options?.transferToWriter && writer;
    for (const member of sessionOf(listedCopies(), copy)) adoptedRef.current.set(member.key, { identity, copy: member, ...(transfer && {
      selectedAt: { key: writer, editedAt: editRef.current.editedAt }, allowConfirmedReturn: true,
    }) });
    settleRecovered();
  }, [settleRecovered, listedCopies]);

  /**
   * The user rejected the recovered text — this is the one path that deletes it.
   *
   * It deletes THAT version and nothing else. The offer stays on screen while the
   * person keeps working, so by the time they dismiss it the slot may already hold
   * NEWER text typed since: an unconditional clear here threw away the very text
   * they were writing (loss of unconfirmed text, dressed as a dismissal). Compare
   * first, delete only on an exact match. The rejected version is the session the person answered about: every
   * copy of it goes, each on the same exact match.
   */
  const discardRecovered = useCallback(() => {
    const rejected = selectedRef.current;
    if (!rejected) return;
    const session = sessionOf(listedCopies(), rejected);
    for (const member of session) clearDraftIfMatches(member.key, member.value);
    const identity = recoveryKeyRef.current;
    setRecovery(current => current.identity !== identity ? current : { ...current, copies: withoutSession(current.copies, session) });
  }, [listedCopies]);

  /**
   * Write this writer's last copy again, with the base `readBase` gives now. For a base that moved while the words did
   * not: this device has just stored a save of the words before them, so they are built on that save from now on. Only
   * the copy this writer last wrote, still stored exactly as written, is rewritten — the same words and the same edit.
   */
  const rewriteCopy = useCallback(() => {
    const ours = ourDraftRef.current;
    if (!ours || !enabledRef.current) return;
    const record = readDraft<T>(ours.key);
    if (!record || serializeContent(record) !== serializeContent(ours.record)) return;
    persistRef.current(ours.key, record.value, record.editedAt ?? editRef.current.editedAt);
  }, []);

  const holdAlternative = useCallback((alternative: T) => {
    if (!uid || !docId) return;
    const sourceKey = draftKey(uid, docId, aggregate, newClientId());
    const identity = recoveryKey;
    const saved = saveDraft(sourceKey, alternative, creationTargetId, false, nextDraftEditTime(editRef.current.editedAt));
    const record = saved ? readDraft<T>(sourceKey) : null;
    return (keep: boolean) => {
      if (!keep) {
        clearDraftIfMatches(sourceKey, alternative, record ?? undefined);
      } else if (record && keyRef.current && identity === recoveryKeyRef.current) {
        // Keep the physical source until this writer has durably taken over. It may already
        // contain later keystrokes when its first capture happens.
        adoptedRef.current.set(sourceKey, {
          identity,
          copy: { ...record, key: sourceKey, sourceRecord: record },
          selectedAt: { key: keyRef.current, editedAt: editRef.current.editedAt },
        });
      }
    };
  }, [uid, docId, aggregate, recoveryKey, creationTargetId]);

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
      const writerKey = keyRef.current;
      const handoff = capturedEditedAt === undefined || !writerKey ? undefined : { key: writerKey, editedAt: capturedEditedAt };
      retireKnownCopies(captured, recoveryKey, ownsSource ? keys : [targetKey], undefined, handoff);
      if (ourDraftRef.current?.value === serialised) ourDraftRef.current = null;
    }
  }, [uid, key, aggregate, writerId, creationTargetId, recoveryKey, retireKnownCopies]);

  useEffect(() => subscribeDraftCapture(event => {
    if (event.key !== keyRef.current) return;
    const serialised = serializeContent(event.value);
    const sameEdit = event.editedAt === editRef.current.editedAt;
    if (sameEdit) capturedRef.current = { keys: [event.key], value: serialised };
    const handoff = sameEdit && event.editedAt !== undefined ? { key: event.key, editedAt: event.editedAt } : undefined;
    retireKnownCopies(event.value as T, recoveryKeyRef.current, [event.key], undefined, handoff);
    if (sameEdit && ourDraftRef.current?.value === serialised) ourDraftRef.current = null;
  }), [retireKnownCopies]);

  const markSaved = useCallback((confirmed: T) => {
    const currentOpening = recoveryKeyRef.current === recoveryKey;
    if (currentOpening) confirmedRef.current = serializeContent(confirmed);
    const ownKey = currentOpening ? keyRef.current : key;
    retireKnownCopies(confirmed, recoveryKey, ownKey ? [ownKey] : [], isRecoveredDraftSaved);
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
  }, [key, recoveryKey, retireKnownCopies, isRecoveredDraftSaved]);

  return { editedAt: editRef.current.editedAt, recovered, recoveredBase, recoveredKey, recoveries, selectRecovered, settleRecovered, acceptRecovered, discardRecovered, holdAlternative, rewriteCopy, markCaptured, markSaved };
}
