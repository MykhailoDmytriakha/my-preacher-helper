'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { SyncOutletProvider } from '@/components/common/syncOutlet';
import { useAuth } from '@/providers/AuthProvider';
import { failureWords, logFailureOnce, readOnlyError, refusalWords, sayFailure, type FailureWords } from '@/utils/actionFailureMessage';
import { newClientId } from '@/utils/clientId';
import { LIST_STORAGE, OPENING_STORAGE, getDeviceStorageHealth, isStorageSilent, subscribeDeviceStorage, untilStorageSilent } from '@/utils/deviceStorage';
import { connectDraftCaptureRecovery } from '@/utils/draftCaptureRecovery.client';
import { useTranslation } from '@locales/useTranslation';

import { actionClock } from './actionClock.client';
import { analysisCreationScope as initialAnalysisScope } from './analysisCreation';
import { createBrowserDataEngine, type BrowserDataEngine } from './browser.client';
import { isCollectionOnEngine, isDataEngineEnabled } from './clientPolicy';
import { isLiveCollectionDocument as liveCollectionDocument, type CollectionPresentationRow } from './collectionPresentation';
import { isInactiveEditorError as inactiveEditor } from './controller';
import { isDirectLegacyDocumentIntent, savedDocumentAnswer, type DocumentAnswer } from './documentDelivery';
import { ACTION_SLOT, editorSlot, isManualChoiceRecoveryIdentity, readManualScopeIdentity, recoveryEditorIdentity } from './editorIdentity';
import { needsConnection } from './engine';
import { LegacyQueryCopies, LegacyQueryMigrationGate } from './LegacyQueryRecovery';
import { ARCHIVED_COLLECTIONS, isEngineOwnedLegacyMutation, isEngineOwnedLegacyQuery, legacyCacheMayBeOverwritten } from './legacyQueryRecovery.client';
import { discoverLegacyRecovery as discoverLegacyOriginals, exportLegacyRecovery as exportLegacyOriginal, type LegacyRecoverySource } from './legacyRecovery.client';
import { councilRefusalHeldOpen as refusalHeldOpen, recoveryHeldOpen as heldOpen, type OpenDocumentAnswer } from './openDocumentAnswers';
import { mergeFields } from './protocol';
import { collectionRecordPresence, documentRecordPresence, UNKNOWN_RECORD_PRESENCE, type RecordPresence } from './recordPresence';
import { isOnlySubmittedCopy } from './recovery.client';
import { captureRecoveryChoice as captureChoice, recoveryChoiceFingerprint, type RecoveryChoiceScope } from './recoveryChoice';
import { validateResourceDocument } from './resourceSchemas';
import { deletedUnder } from './session';
import { describeManualSync, describeSync, type SyncStatus } from './status';
import { shownDeliveryState } from './unanswered';
import { useRecoveryDiscovery as useDiscovery, type RecoveryDiscoveryOptions } from './useRecoveryDiscovery';

import type { StudyAnalysisWrite } from './analysisReshape';
import type { CollectionState } from './collections';
import type { EditorRecord, EditorState, RecoveryCheckpoint } from './controller';
import type { ManagedEditor, ManagedManualForm, ManualRecoveryPolicy } from './engine';
import type { ManualPath } from './manualScope';
import type { StoredManualScope } from './manualScopes.client';
import type { MembershipDelivery } from './membershipDelivery';
import type { MembershipAction } from './membershipIntent';
import type { MembershipScope, MembershipScopeRecord } from './membershipScope';
import type { DocumentData, EngineReadOptions, FailureAddress, FieldValue, JournalEntry, ResourceRef, ResourceSnapshot } from './types';
import type { AppLocale } from '@/utils/appLocale';
import type { BookText } from '@/utils/bibleText';

export { isCollectionOnEngine, isDataEngineEnabled } from './clientPolicy';
/** Stable capture ownership for the public initial-analysis creation flow. */
export function analysisCreationScope(id: string): string { return initialAnalysisScope(id); }

/** Ordinary presentation only; raw collection state remains addressable for delivery and recovery. */
export function isLiveCollectionDocument<T extends CollectionPresentationRow>(row: T): row is T & { value: DocumentData } {
  return liveCollectionDocument(row);
}


export type { RecoveryChoiceScope } from './recoveryChoice';
export type { LegacyRecoverySource } from './legacyRecovery.client';
export type { DocumentWriteReceipt } from './commitReceipt';

export type DocumentAction =
  | { kind: 'create'; value: DocumentData }
  | { kind: 'update'; update: (current: DocumentData | null) => DocumentData | null }
  | { kind: 'delete' };
export type { OpenDocumentAnswer } from './openDocumentAnswers';
/** Whether the answering document screens hold every shown request and the same words. */
export function isRecoveryHeldOpen(records: readonly EditorRecord[], answers: readonly OpenDocumentAnswer[]): boolean { return heldOpen(records, answers); }
/** Whether the open council holds the same refusal while other draft words remain unseen. */
export function councilRefusalHeldOpen(records: readonly EditorRecord[], answers: readonly OpenDocumentAnswer[]): boolean { return refusalHeldOpen(records, answers); }
/** Capture shown recovery work through the public engine facade. */
export function captureRecoveryChoice(records: readonly EditorRecord[]): RecoveryChoiceScope { return captureChoice(records); }

/** Whether a pending edit was cancelled because its editor retired. */
export function isInactiveEditorError(error: unknown): boolean { return inactiveEditor(error); }

/** A refusal only because this device holds no copy and the server cannot be asked now (offline, hidden tab). */
export const needsConnectionFailure = (error: unknown): boolean => needsConnection(error);

interface EngineContextValue {
  browser: BrowserDataEngine | null;
  owner: string | null;
  /**
   * Background failures of this owner's engine, counted by what they were about (`failureKey`);
   * a waiting screen compares the counts of its own address with those when it started waiting.
   * See `useBackgroundFailure` for who may show them.
   */
  failures: Readonly<Record<string, number>>;
}
/** The count a failure about nothing in particular is kept under. */
const ANY_ADDRESS = '*';
const failureKey = (about?: FailureAddress) => (about ? (about.id ? `${about.collection}/${about.id}` : about.collection) : ANY_ADDRESS);
const NO_FAILURES: Readonly<Record<string, number>> = {};
const EngineContext = createContext<EngineContextValue | null>(null);
const EDITOR_CHANGED = 'The active editor changed';
const ENGINE_NOT_READY = 'The data engine is not ready';
/** What a list, or a screen waiting on the engine's background work, says when that work failed. */
const BACKGROUND_FAILED = 'dataSync.backgroundFailure';

/**
 * Why a copy shown for reading cannot take this change, in the person's words: when the device's
 * storage is silent, editing returns by itself once it answers; otherwise the editor is still opening.
 */
/** Why changes are refused over a copy for reading, as a key: said in the current language when shown. */
const readOnlyReasonKey = (storage = isStorageSilent()) => (storage ? 'dataSync.readOnly.storage' : 'dataSync.readOnly.opening');

function useReadOnlyReason() {
  const { t } = useTranslation();
  // Re-render when storage goes silent or answers, so a reason already on the screen stays true.
  useSyncExternalStore(subscribeDeviceStorage, getDeviceStorageHealth, getDeviceStorageHealth);
  // Stable on purpose: editor callbacks and form identities depend on it, and a `t` that changes
  // between renders would reopen forms in a loop.
  const translate = useRef(t);
  translate.current = t;
  return useCallback((storage = isStorageSilent()) => translate.current(readOnlyReasonKey(storage)), []);
}

/*
 * WHAT A FAILURE SAYS ON SCREEN (BUG-20261003-engine-error-sentence-on-screen).
 *
 * The engine's errors are sentences for developers ("The document is not available in the local
 * cache"), and screens printed them under their own translated "could not load". Each hook keeps
 * the words of a failure where it catches it and translates them when it renders: a failed read
 * says the hook's line (`failureWords`), a refused action keeps an instruction it may carry
 * (`refusalWords`); see `utils/actionFailureMessage.ts`. Thrown errors reach the caller unchanged.
 */
const DOCUMENT_FAILED = 'dataSync.documentFailed';

function useSayFailure() {
  const { t } = useTranslation();
  return (words: FailureWords | null | undefined): string | null => (words ? sayFailure(words, t) : null);
}

/** The error an engine object keeps in its state, in words; the original goes to the console once per value. */
function useStateFailure(raw: string | null | undefined, key = DOCUMENT_FAILED): string | null {
  const { t } = useTranslation();
  const logged = useRef<string | null>(null);
  useEffect(() => {
    if (raw && raw !== logged.current) console.error('[data-engine]', raw);
    logged.current = raw ?? null;
  }, [raw]);
  return raw ? t(key) : null;
}

const COPY_RETRY_MS = 5000;

/**
 * LOOK FOR A COPY ONLY WHILE THE STORAGE THIS WAIT NEEDS IS SILENT
 * (BUG-20260927-engine-open-hangs-on-silent-device-storage). Time alone is not evidence: a slow
 * but healthy opening must stay the editor it is about to become. While the silence lasts, the
 * look is repeated whenever it may now succeed — network back, page shown, storage state changed —
 * and every few seconds, until the caller has what it needs.
 */
function useLookWhileSilent(active: boolean, databases: readonly string[], look: () => void) {
  const latest = useRef(look);
  latest.current = look;
  useEffect(() => {
    if (!active) return;
    const attempt = () => { if (isStorageSilent(databases)) latest.current(); };
    const stop = subscribeDeviceStorage(attempt);
    const retry = setInterval(attempt, COPY_RETRY_MS);
    window.addEventListener('online', attempt);
    document.addEventListener('visibilitychange', attempt);
    attempt();
    return () => {
      stop(); clearInterval(retry);
      window.removeEventListener('online', attempt);
      document.removeEventListener('visibilitychange', attempt);
    };
  }, [active, databases]);
}

/** Public recovery UI seam; storage and owner fencing remain inside the engine. */
/**
 * The engine's own three-way merge of one value — objects by field, lists by item id; a part written
 * differently on both sides is a conflict. For code that must merge before it hands a value over
 * (the sermon plan's `mergeOutline`), so there is one rule for what "both changed" means.
 */
export function mergeValues(base: FieldValue, mine: FieldValue, theirs: FieldValue) {
  return mergeFields(base, mine, theirs);
}

/** Read-only historical originals; feature callers retain ownership and exact-byte removal checks. */
export function discoverLegacyRecovery(owner: string, options?: Parameters<typeof discoverLegacyOriginals>[1]) {
  return discoverLegacyOriginals(owner, options);
}

/** Export exactly the reviewed original, fenced to its owner. */
export function exportLegacyRecovery(source: LegacyRecoverySource, owner: string): string {
  return exportLegacyOriginal(source, owner);
}

/** Admit only the supplied recovery fields; a partial backup never proves a whole document. */
export function isValidRecoveryPatch(collection: string, value: DocumentData): boolean {
  try {
    validateResourceDocument(collection, value, { kind: 'update', changedFields: Object.keys(value) });
    return true;
  } catch { return false; }
}

export function useRecoveryDiscovery<T>(options: RecoveryDiscoveryOptions<T>) {
  return useDiscovery(options);
}

/** Whether the query persister may write over the old cache yet: never before its copies are archived. */
export function queryCacheMayBeOverwritten(owner?: string): boolean {
  return legacyCacheMayBeOverwritten(owner);
}

/** Whether the persisted query cache may keep this query; engine-owned collections are session-only. */
export function shouldPersistLegacyQuery(queryKey: readonly unknown[]): boolean {
  return !isEngineOwnedLegacyQuery(queryKey, isCollectionOnEngine);
}

export function shouldPersistLegacyMutation(mutationKey: readonly unknown[] | undefined): boolean {
  return !isEngineOwnedLegacyMutation(mutationKey, isCollectionOnEngine);
}

/** Preserve old cache copies before the query provider may hydrate, expire or replace them. */
export function DataEngineMigrationGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const owner = loading ? undefined : user?.uid;
  return ARCHIVED_COLLECTIONS.some(isCollectionOnEngine) ? <LegacyQueryMigrationGate key={JSON.stringify([owner ?? null])} enabled={isCollectionOnEngine} owner={owner}>{children}</LegacyQueryMigrationGate> : <>{children}</>;
}

/** Archived cache copies are evidence for the person, never confirmed engine snapshots. */
export function LegacyDataRecoveryNotice() {
  const { user } = useAuth();
  return user?.uid && ARCHIVED_COLLECTIONS.some(isCollectionOnEngine) ? <LegacyQueryCopies key={user.uid} owner={user.uid} /> : null;
}

/** Keep one owner-scoped engine alive when navigation chrome is hidden. */
export function DataEngineWorkspace({ children }: { children: ReactNode }) {
  return isDataEngineEnabled() ? <DataEngineProvider>{children}</DataEngineProvider> : <>{children}</>;
}

/** Mount once for the authenticated workspace, including screens that hide navigation. */
export function DataEngineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const owner = user?.uid ?? null;
  const [mounted, setMounted] = useState<{ owner: string | null; browser: BrowserDataEngine } | null>(null);
  const [failure, setFailure] = useState<{ owner: string | null; counts: Readonly<Record<string, number>> } | null>(null);
  useEffect(() => {
    let active = true;
    const instance = createBrowserDataEngine({ onError: (error, about) => {
      // The engine's own sentence is for developers; a screen that shows this failure says it in words.
      logFailureOnce(error, 'DataEngine background operation failed');
      const key = failureKey(about);
      if (active) setFailure(previous => ({ owner, counts: { ...previous?.counts, [key]: (previous?.counts[key] ?? 0) + 1 } }));
    } });
    instance.engine.setOwner(owner);
    const stopDraftCapture = owner ? connectDraftCaptureRecovery(owner, instance.engine) : () => undefined;
    setFailure(null);
    setMounted({ owner, browser: instance });
    return () => { active = false; stopDraftCapture(); instance.dispose(); };
  }, [owner]);
  const browser = mounted?.owner === owner ? mounted.browser : null;
  const failures = failure?.owner === owner ? failure.counts : NO_FAILURES;
  const value = useMemo(() => ({ browser, owner, failures }), [browser, owner, failures]);
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useDataEngine(): EngineContextValue {
  const context = useContext(EngineContext);
  if (!context) throw new Error('Mount DataEngineProvider before using data');
  return context;
}

const NO_OPEN_ANSWERS: readonly ResourceRef[] = Object.freeze([]);
const noOpenAnswers = () => NO_OPEN_ANSWERS;

/** The engine owns this fact; opening/closing a screen must not wait for a recovery-list poll. */
export function useOpenDocumentAnswers(): readonly ResourceRef[] {
  const { browser } = useDataEngine();
  const subscribe = useCallback((listener: () => void) => browser?.engine.subscribeOpenAnswers(listener) ?? (() => undefined), [browser]);
  const snapshot = useCallback(() => browser?.engine.getOpenAnswers() ?? NO_OPEN_ANSWERS, [browser]);
  return useSyncExternalStore(subscribe, snapshot, noOpenAnswers);
}

const NO_OPEN_ANSWER_SCOPES: readonly OpenDocumentAnswer[] = Object.freeze([]);
const noOpenAnswerScopes = () => NO_OPEN_ANSWER_SCOPES;

/** Exact saved work shown by mounted document editors, updated locally without a recovery poll. */
export function useOpenDocumentAnswerScopes(): readonly OpenDocumentAnswer[] {
  const { browser } = useDataEngine();
  const subscribe = useCallback((listener: () => void) => browser?.engine.subscribeOpenAnswerScopes(listener) ?? (() => undefined), [browser]);
  const snapshot = useCallback(() => browser?.engine.getOpenAnswerScopes() ?? NO_OPEN_ANSWER_SCOPES, [browser]);
  return useSyncExternalStore(subscribe, snapshot, noOpenAnswerScopes);
}

/**
 * ONE ACTION ON A DOCUMENT THAT NO SCREEN HAS OPEN — a menu entry on a list row, a link made
 * from the other side of a relation. The editor opens on the document's own baseline, captures
 * exactly this change as one durable request and closes; delivery, retries and conflicts stay
 * with the engine like any save. A screen that shows the document keeps its own editor instead.
 */
/**
 * Whether a closed checkpoint holds a conflict or a saved request/legacy command answer. Work that is queued, or an edit still on its way into a
 * request (possibly another tab's), does not.
 */
export function waitsForDecision(record: EditorRecord, journal: readonly JournalEntry[], answer?: DocumentAnswer): boolean {
  return record.checkpoint.conflicts.length > 0 || Boolean(answer) || Boolean(savedDocumentAnswer(record.owner,
    record.checkpoint.confirmed.resource, Object.keys(record.checkpoint.pending), [], journal));
}

/**
 * Whether a checkpoint was left by a one-shot action (useDocumentActions) rather than by a
 * screen's editor. Only these are answered from the app-wide banner: a screen's editor offers
 * its own recovery when it is opened again, and settling it from elsewhere would retire the
 * very text that screen is there to show.
 */
export function isOneShotRecord(record: EditorRecord): boolean {
  return editorSlot(record.editorId) === ACTION_SLOT;
}

const decisionRequired = () => Object.assign(new Error('An earlier change to this document waits for a decision'), { code: 'decision-required' });
const remoteDeleted = (record: EditorRecord) => {
  const candidate = record.checkpoint.remoteCandidate;
  return Boolean(candidate && (candidate.value === null || candidate.metadata?.deleted));
};

/**
 * Ask through the canonical engine reader, refusing offline/hidden reads. Use fresh:true
 * before retiring a local original: a unique request URL also prevents an older active
 * service worker from answering with a cached API response. Default readers retain their URL.
 */
export function useRemotePeek(options?: EngineReadOptions): ((resource: ResourceRef) => Promise<ResourceSnapshot>) | null {
  const { browser } = useContext(EngineContext) ?? idleEngine;
  const fresh = options?.fresh === true;
  return useMemo(() => browser ? (resource: ResourceRef) => (fresh ? browser.engine.peekRemote(resource, { fresh: true }) : browser.engine.peekRemote(resource)) : null, [browser, fresh]);
}

export function useDocumentActions() {
  // Menus that offer these actions render in both deployments; without an engine they are not ready.
  const { browser, owner } = useContext(EngineContext) ?? idleEngine;
  const readOnlyReason = useReadOnlyReason();
  const actionOwner = useRef(owner); actionOwner.current = owner;
  /*
   * Opening an editor for one action changes nothing yet, so it may be abandoned; once the action
   * has run, its outcome must stay knowable and it is never raced. When the engine's storage goes
   * silent before the editor opens, the opening is cancelled — the action can never land later,
   * behind the person's back — and the menu hears why (BUG-20260927-engine-open-hangs-on-silent-device-storage).
   */
  const openFor = useCallback((resource: ResourceRef, editorId: string, creating = false) => {
    if (!browser) throw new Error(ENGINE_NOT_READY);
    const cancellation = new AbortController();
    const opening = creating
      ? browser.engine.createEditor(resource, editorId, { signal: cancellation.signal })
      : browser.engine.openEditor(resource, editorId, { signal: cancellation.signal });
    let abandoned = false;
    void opening.then(editor => { if (abandoned) editor.close({ flush: false }); }, () => undefined);
    return untilStorageSilent(opening, () => { abandoned = true; cancellation.abort(); }, readOnlyReason(true));
  }, [browser, readOnlyReason]);
  /** The closed checkpoints of a document that wait for the person, if any. */
  /**
   * Every draft of a document that waits for the person — a screen editor's too. A one-shot
   * change opens on the document's local head, which still carries a refused draft; letting it
   * through would only build on the refused text and be refused in turn.
   */
  const waitingFor = useCallback(async (resource: ResourceRef) => {
    if (!browser) return [];
    const [records, journal] = await untilStorageSilent(Promise.all([browser.engine.listRecoverable(resource), browser.engine.listPending()]), () => undefined, readOnlyReason(true));
    return records.filter(({ record, answer }) => waitsForDecision(record, journal, answer));
  }, [browser, readOnlyReason]);
  const withEditor = useCallback(async <T,>(resource: ResourceRef, action: (editor: ManagedEditor) => Promise<T>, creating = false): Promise<T> => {
    if (!browser || !owner) throw new Error(ENGINE_NOT_READY);
    // A document that waits for a decision takes no further one-shot change: each attempt
    // would only strand another checkpoint behind the answer (EngineConflictBanner asks first).
    if (!creating && (await waitingFor(resource)).length) throw decisionRequired();
    const editor = await openFor(resource, browser.editorId(resource, ACTION_SLOT), creating);
    try { return await action(editor); } finally { editor.close({ flush: false }); }
  }, [browser, owner, waitingFor, openFor]);
  return useMemo(() => ({
    ready: Boolean(browser && owner),
    /** One user action, durably captured for every note or refused before changing any. */
    reshapeStudyAnalysis: async (edits: readonly StudyAnalysisWrite[]): Promise<void> => {
      if (!browser || !owner) throw new Error(ENGINE_NOT_READY);
      for (const edit of edits) if (edit.expected && (await waitingFor(edit.resource)).length) throw decisionRequired();
      if (actionOwner.current !== owner) throw new Error(EDITOR_CHANGED);
      return browser.engine.reshapeStudyAnalysis(edits);
    },
    findStudyAnalysisCreation: async (id: string) => {
      if (!browser || !owner || actionOwner.current !== owner) throw new Error(ENGINE_NOT_READY);
      return browser.engine.findStudyAnalysisCreation(id);
    },
    releaseStudyAnalysisCreation: async (sourceId: string, adoptedId: string) => {
      if (!browser || !owner || actionOwner.current !== owner) throw new Error(ENGINE_NOT_READY);
      return browser.engine.releaseStudyAnalysisCreation(sourceId, adoptedId);
    },
    transferStudyAnalysisCreation: async (sourceId: string, targetId: string, text: BookText) => {
      if (!browser || !owner || actionOwner.current !== owner) throw new Error(ENGINE_NOT_READY);
      if ((await waitingFor({ collection: 'studyNotes', id: targetId })).length) throw decisionRequired();
      return browser.engine.transferStudyAnalysisCreation(sourceId, targetId, text);
    },
    /** A new document under a stable client ID; a retry with the same ID never creates a second one. */
    create: (resource: ResourceRef, value: DocumentData) => withEditor(resource, editor => editor.commit(() => value), true),
    commit: (resource: ResourceRef, updater: (current: DocumentData | null) => DocumentData | null) =>
      withEditor(resource, editor => editor.commit(updater)),
    remove: (resource: ResourceRef) => withEditor(resource, editor => editor.remove()),
    /** Resolves at local capture; its persistence promise follows only this complete request. */
    submit: (resource: ResourceRef, action: DocumentAction, options?: { captureScope?: string }) => withEditor(resource, editor => action.kind === 'delete'
      ? editor.removeWithReceipt(options)
      : editor.commitWithReceipt(action.kind === 'create' ? () => action.value : action.update, options), action.kind === 'create'),
    /**
     * Settle the answer the server gave to a document no screen has open — a conflict or a
     * refusal — without ever choosing for the person. "Mine" is allowed only when exactly one
     * checkpoint waits and the document still exists on the server: the engine gives no order
     * between several closed checkpoints of one document (their generations restart and tie),
     * so among several only "theirs" is possible, after the banner has shown every draft for
     * copying. "Theirs" retires exactly the waiting checkpoints; a refusal, which has no stored
     * version to accept, returns its draft to the confirmed copy. Queued work is never touched.
     * A reviewed scope pins modern request roots; their canonical cancellation projection needs no
     * reopened editor. Legacy direct commands still open only the exact shown checkpoint and check
     * it inside the controller queue. Omitted scope retains existing callers. Returns settled work.
     */
    resolve: async (resource: ResourceRef, choice: 'mine' | 'theirs', scope?: RecoveryChoiceScope): Promise<number> => {
      if (!browser || !owner) throw new Error(ENGINE_NOT_READY);
      // One-shot drafts only: a screen editor's draft of the same document is that screen's to settle.
      let waiting = (await waitingFor(resource)).filter(({ record }) => isOneShotRecord(record));
      const shown = (record: EditorRecord) => scope?.records.find(expected => expected.owner === owner && expected.editorId === record.editorId
        && recoveryChoiceFingerprint([expected]) === recoveryChoiceFingerprint([record]));
      let taken = 0;
      if (scope && choice === 'theirs') {
        // Modern copies settle through the same request-scoped projection as screen drafts.
        taken = await browser.engine.takeStoredVersion(resource, scope.operationIds);
        // Only directly owned legacy commands still need an editor; never reopen cancelled modern work.
        waiting = waiting.filter(({ record }) => shown(record) && record.prepared
          && isDirectLegacyDocumentIntent(Object.keys(record.checkpoint.pending), record.prepared.operationId)
          && scope.operationIds.includes(record.prepared.operationId));
      }
      if (scope && choice === 'mine' && waiting.some(({ record }) => !shown(record))) throw Object.assign(
        new Error('The shown saved copy changed'), { code: 'decision-changed' });
      if (!waiting.length) return taken;
      if (choice === 'mine' && (waiting.length !== 1 || remoteDeleted(waiting[0].record))) {
        throw Object.assign(new Error('Only the stored version can be taken here'), { code: 'ambiguous-choice' });
      }
      for (const { record } of waiting) {
        const editor = await openFor(resource, record.editorId);
        try {
          if (choice === 'mine') { await editor.keepLocal(scope ? shown(record) : undefined); await editor.save(); continue; }
          await editor.acceptRemote(scope ? shown(record) : undefined);
          const { checkpoint } = editor.getState();
          if (checkpoint.dirty) await editor.edit(checkpoint.confirmed.value);
        } finally { editor.close({ flush: false }); }
      }
      return taken + waiting.length;
    },
  }), [browser, owner, withEditor, waitingFor, openFor]);
}

/** Capability actions capture through the engine; callers never construct tokens or wire commands. */
export function useShareCapabilityActions() {
  const { browser, owner } = useContext(EngineContext) ?? idleEngine;
  const identity = useMemo(() => ({ browser, owner }), [browser, owner]);
  const current = useRef(identity); current.current = identity;
  const [observed, setObserved] = useState<{ identity: typeof identity; entries: JournalEntry[] } | null>(null);
  useEffect(() => {
    if (!browser || !owner) return;
    let active = true, version = 0;
    const receive = () => {
      version += 1;
      if (active && current.current === identity) setObserved({ identity, entries: browser.engine.getPending() });
    };
    const stop = browser.engine.subscribePending(receive); receive();
    const initial = version;
    void browser.engine.listPending().then(entries => {
      if (active && current.current === identity && version === initial) setObserved({ identity, entries });
    }, error => { if (active && current.current === identity) browser.engine.reportFailure(error, { collection: 'studyNoteShareLinks' }); });
    return () => { active = false; stop(); };
  }, [browser, owner, identity]);
  const actions = useMemo(() => (observed?.identity === identity ? observed.entries : []).flatMap(entry => {
    if (entry.command.owner !== owner || entry.command.resource.collection !== 'studyNoteShareLinks' || entry.command.kind !== 'relation') return [];
    const command = entry.command;
    if (command.relation !== 'share-link-create' && command.relation !== 'share-link-revoke') return [];
    return [{ id: command.operationId, kind: command.relation === 'share-link-create' ? 'create' as const : 'revoke' as const,
      targetId: command.relation === 'share-link-create' ? command.note.id : command.resource.id, state: shownDeliveryState(entry),
      ...(entry.result?.kind === 'refused' ? { code: entry.result.code } : {}) }];
  }), [observed, identity, owner]);
  const run = useCallback(async (action: (engine: BrowserDataEngine['engine']) => Promise<void>) => {
    if (!browser || !owner || current.current !== identity) throw new Error(ENGINE_NOT_READY);
    await action(browser.engine);
    if (current.current !== identity) throw new Error(EDITOR_CHANGED);
  }, [browser, owner, identity]);
  return useMemo(() => ({ ready: Boolean(browser && owner), actions,
    create: (noteId: string, locale: AppLocale, observed?: ResourceSnapshot | null, replaces?: string) => run(engine =>
      observed === undefined ? engine.createShareLink(noteId, locale) : engine.createShareLink(noteId, locale, observed, replaces)),
    revoke: (linkId: string) => run(engine => engine.revokeShareLink(linkId)),
    retry: (operationId: string) => run(engine => engine.retryShareCapability(operationId)),
  }), [browser, owner, actions, run]);
}

/** Owner-scoped recovery for whole passage actions, driven by the shared journal/request signal. */
export function useAnalysisReshapeActions() {
  const { browser, owner } = useContext(EngineContext) ?? idleEngine;
  const { t } = useTranslation();
  const identity = useMemo(() => ({ browser, owner }), [browser, owner]);
  const current = useRef(identity); current.current = identity;
  const [revision, setRevision] = useState(0);
  type Item = Awaited<ReturnType<BrowserDataEngine['engine']['listAnalysisReshapes']>>[number];
  const [state, setState] = useState<{ identity: typeof identity; items: Item[]; error: unknown } | null>(null);
  useEffect(() => {
    if (!browser || !owner) return;
    let active = true, sequence = 0;
    const refresh = () => {
      const request = ++sequence;
      void browser.engine.listAnalysisReshapes().then(items => {
        if (active && current.current === identity && request === sequence) setState({ identity, items, error: null });
      }, error => {
        if (active && current.current === identity && request === sequence) setState(previous => ({ identity,
          items: previous?.identity === identity ? previous.items : [], error }));
      });
    };
    const stop = browser.engine.subscribeSavedWork(refresh); refresh();
    return () => { active = false; stop(); };
  }, [browser, owner, identity, revision]);
  const run = async (operation: () => Promise<void>) => {
    if (!browser || !owner || current.current !== identity) throw new Error(EDITOR_CHANGED);
    try { await operation(); }
    catch (error) {
      if (current.current === identity) setState(previous => ({ identity, items: previous?.identity === identity ? previous.items : [], error }));
      throw error;
    }
  };
  const shown = state?.identity === identity ? state : null;
  const error = shown?.error ? sayFailure(refusalWords(shown.error, 'common.saveError'), t) : null;
  const retry = () => run(() => browser!.engine.retry()).finally(() => { if (current.current === identity) setRevision(value => value + 1); });
  return { error, retry, actions: (shown?.items ?? []).map(item => ({ ...item, durable: true, error, phase: 'submitted' as const,
    retry, discard: () => run(() => browser!.engine.discardAnalysisReshape(item.id)),
  })) };
}

/**
 * For readers that exist in both deployments. A document editor keeps the strict boundary — a
 * missing provider there is a mistake — but a collection read from a screen that also runs
 * without the engine is an absence of rows, not a programming error.
 */
const idleEngine: EngineContextValue = { browser: null, owner: null, failures: NO_FAILURES };

/*
 * A BACKGROUND FAILURE EXPLAINS ONLY A WAIT IT HAPPENED DURING
 * (BUG-20260927-engine-background-error-sticks-on-every-screen).
 *
 * The engine reports failures of its background work — a list read, delivery preparation — with no
 * address. Handed to every screen, the last one stood as a red developer sentence over screens it
 * had nothing to do with, and pages read it as "could not load" and hid what they already showed.
 * It may only explain a screen that has nothing to show and began waiting before it happened; a
 * screen with content, or one that started waiting after it, is not told, and the one that is
 * told reads a sentence in words, not the engine's. A list's own failure still reaches that list
 * through its own state.
 */
function useBackgroundFailure(waitIdentity: object | null, address: FailureAddress | null): string | null {
  const { t } = useTranslation();
  const { failures } = useContext(EngineContext) ?? idleEngine;
  // Its own address and failures about nothing in particular; another document's or list's never
  // explain this wait (BUG-20261003-background-failure-without-address).
  const failureCount = address ? (failures[failureKey(address)] ?? 0) + (failures[ANY_ADDRESS] ?? 0) : 0;
  const [since, setSince] = useState<{ identity: object; count: number } | null>(null);
  const latestCount = useRef(failureCount);
  latestCount.current = failureCount;
  useEffect(() => {
    if (waitIdentity) setSince({ identity: waitIdentity, count: latestCount.current });
  }, [waitIdentity]);
  return waitIdentity && since?.identity === waitIdentity && failureCount > since.count
    ? t(BACKGROUND_FAILED)
    : null;
}

/** Explicit semantic actions over an engine-owned pinned stage; no feature queue or ancestry. */
export function useDataMembership() {
  const { browser, owner } = useContext(EngineContext) ?? idleEngine;
  const readOnlyReason = useReadOnlyReason();
  const say = useSayFailure();
  const identity = useMemo(() => ({ browser, owner }), [browser, owner]);
  const latest = useRef<object>(identity); latest.current = identity;
  const current = useRef<{ identity: object; scope: MembershipScope; scopeId: string; stop: () => void } | null>(null);
  const opening = useRef<{ identity: object; promise: Promise<void> } | null>(null);
  const [stored, setStored] = useState<{ identity: object; state: ReturnType<MembershipScope['getState']> } | null>(null);
  const [failure, setFailure] = useState<{ identity: object; words: FailureWords } | null>(null);
  const [delivery, setDelivery] = useState<{ identity: object; scopeId: string; state: MembershipDelivery } | null>(null);
  const refreshVersion = useRef(0);
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const active = useCallback(() => {
    if (latest.current !== identity || !browser || !owner) throw new Error(EDITOR_CHANGED);
    return browser.engine;
  }, [browser, owner, identity]);
  const refresh = useCallback(() => {
    const held = current.current;
    if (held?.identity !== identity || latest.current !== identity) return;
    const version = ++refreshVersion.current;
    setStored({ identity, state: held.scope.getState() });
    void browser!.engine.membershipDelivery(held.scopeId).then(state => {
      if (latest.current === identity && current.current === held && version === refreshVersion.current) setDelivery({ identity, scopeId: held.scopeId, state });
    }).catch(error => {
      if (latest.current === identity && current.current === held && version === refreshVersion.current) {
        setDelivery(null); setFailure({ identity, words: failureWords(error, DOCUMENT_FAILED) });
      }
    });
  }, [browser, identity]);
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    active(); setFailure(null);
    try { const result = await action(); active(); refresh(); return result; }
    catch (error) { if (latest.current === identity) setFailure({ identity, words: refusalWords(error, DOCUMENT_FAILED) }); throw error; }
  }, [active, identity, refresh]);
  const begin = useCallback((sourceId?: string, creation?: { collection: 'sermons' | 'groups'; value: DocumentData; requestedSeriesId?: string }): Promise<void> => {
    if (opening.current?.identity === identity) return opening.current.promise;
    if (current.current?.identity === identity) return Promise.reject(new Error('Close the current membership stage first'));
    const engine = active();
    const promise = run(async () => {
      // Opening a stage reads the engine's storage; when it is silent the dialog says so instead of
      // spinning, and a stage that opens later is released at once rather than held behind the
      // person's back (BUG-20260927-engine-open-hangs-on-silent-device-storage). A creation stage
      // keeps waiting: releasing it keeps its record, so an abandoned one would come back later
      // as unfinished work the person was told had been refused.
      let abandoned = false;
      const acquiring = sourceId ? engine.recoverMembership(sourceId, { exclusive: true })
        : creation ? null : engine.beginMembership();
      if (acquiring) void acquiring.then(opened => { if (abandoned) engine.releaseMembership(opened.getState().record.scopeId); }, () => undefined);
      const scope = acquiring ? await untilStorageSilent(acquiring, () => { abandoned = true; }, readOnlyReason(true))
        : await engine.beginMemberCreation(creation!.collection, creation!.value, creation!.requestedSeriesId);
      if (latest.current !== identity) { engine.releaseMembership(scope.getState().record.scopeId); throw new Error(EDITOR_CHANGED); }
      current.current = { identity, scope, scopeId: scope.getState().record.scopeId, stop: scope.subscribe(refresh) }; refresh();
    });
    opening.current = { identity, promise };
    void promise.finally(() => { if (opening.current?.promise === promise) opening.current = null; }).catch(() => undefined);
    return promise;
  }, [active, identity, refresh, run, readOnlyReason]);
  const required = useCallback(() => {
    active(); if (current.current?.identity !== identity) throw new Error('Open membership editing first'); return current.current.scope;
  }, [active, identity]);
  const dismiss = useCallback(() => {
    active(); const held = current.current;
    if (held?.identity === identity) { held.stop(); browser!.engine.releaseMembership(held.scopeId); current.current = null; }
    setStored(null); setFailure(null); setDelivery(null);
  }, [active, browser, identity]);
  useEffect(() => {
    latest.current = identity;
    const stopDelivery = browser && owner ? browser.engine.subscribeMembership(() => {
      if (latest.current !== identity) return;
      setRecoveryVersion(version => version + 1); refresh();
    }) : () => undefined;
    return () => {
      stopDelivery();
      if (latest.current === identity) latest.current = {};
      const held = current.current;
      if (held?.identity === identity) {
        held.stop();
        // The owner may already have changed. The old engine still owns its cleanup.
        try { browser?.engine.releaseMembership(held.scopeId); } catch { /* Owner disposal already closed the stage. */ }
        current.current = null;
      }
    };
  }, [browser, owner, identity, refresh]);
  const state = stored?.identity === identity ? stored.state : null;
  const errorWords = failure?.identity === identity ? failure.words : null;
  return {
    ready: Boolean(browser && owner), error: errorWords ? say(errorWords) : null, errorWords,
    values: state?.values ?? [], phase: state?.record.phase ?? null, durable: state?.durable ?? false,
    action: state?.record.action ?? null, scopeId: state?.record.scopeId ?? null,
    creation: state?.record.creation ?? null,
    recoveryIdentity: identity as object, recoveryVersion,
    delivery: delivery?.identity === identity && delivery.scopeId === state?.record.scopeId ? delivery.state : null,
    begin: () => begin(), recover: (scopeId: string) => begin(scopeId), dismiss,
    beginCreate: (collection: 'sermons' | 'groups', value: DocumentData, requestedSeriesId?: string) => begin(undefined, { collection, value, requestedSeriesId }),
    openSeries: () => run(() => active().openCreationSeries(required().getState().record.scopeId)),
    updateCreation: (updater: (value: DocumentData) => DocumentData) => run(async () => {
      const scope = required(), creation = scope.getState().record.creation;
      if (!creation) throw new Error('Open a creation stage first');
      await scope.updateCreation(updater(creation.value));
    }),
    update: (action: MembershipAction | null) => run(() => required().update(action)),
    save: () => run(() => required().save()), cancel: () => run(async () => { await required().cancel(); dismiss(); }),
    retry: () => run(() => active().retryMembership(required().getState().record.scopeId)),
    discard: () => run(async () => { await active().discardMembership(required().getState().record.scopeId); dismiss(); }),
    listRecoverable: (options?: { closedOnly?: boolean }) => run(() => active().listMembershipRecovery(options)),
    listRecoveryChoices: () => run(() => active().listMembershipRecoveryChoices()),
    discardRecovery: (source: MembershipScopeRecord) => run(() => active().discardMembershipRecovery(source)),
  };
}

/** A feature may present its own expected question; storage and lifecycle failures still surface. */
export interface DocumentUpdateOptions {
  handlesRefusal?: (failure: unknown) => boolean;
}

interface DocumentOptions {
  slot?: string;
  create?: boolean;
  autoSave?: boolean;
  /**
   * The screen can show this document for reading only: while device storage is silent it gets a
   * copy in `data` with `readOnly` set, and must offer no edit it could not keep. Screens without
   * a read-only form keep waiting, as they always did — an editable page over a copy that cannot
   * be saved would lose what the person types.
   */
  readOnlyCopy?: boolean;
  /** Only delivery is delayed; editor.edit persists each draft immediately. */
  autoSaveDelayMs?: number;
}
const DocumentContext = createContext<{
  resource: ResourceRef;
  create: boolean;
  value: ReturnType<typeof useIsolatedDataDocument>;
} | null>(null);

/** One document editor for a whole workspace. Child fields share its baseline,
 * draft, journal and recovery state; this provider owns the autosave policy.
 */
export function DataDocumentProvider({ resource, options, children }: {
  resource: ResourceRef;
  options?: DocumentOptions;
  children: ReactNode;
}) {
  const document = useIsolatedDataDocument(resource, options);
  return <SyncOutletProvider><DocumentContext.Provider value={{ resource, create: options?.create ?? false, value: document }}>{children}</DocumentContext.Provider></SyncOutletProvider>;
}

/**
 * The phases of a document's form a change may be laid on (`commit`). Any other — a choice waiting for the person, a failed
 * save, a deleted document — could sweep a new change away with the draft it replaces, or never keep it (Bible marks,
 * 2026-10-16). One set for every screen that commits changes in quick succession.
 */
export const PHASES_TAKING_CHANGES: ReadonlySet<string> = new Set(['saved', 'draft', 'savingLocally', 'queued', 'sending', 'unknown', 'remoteChanged']);

/** Reuse a workspace editor when present; unrelated resources remain independent. */
export function useDataDocument(resource: ResourceRef | null, options: DocumentOptions = {}) {
  const shared = useContext(DocumentContext);
  const matching = Boolean(resource && shared && resource.collection === shared.resource.collection
    && resource.id === shared.resource.id && Boolean(options.create) === shared.create);
  const isolated = useIsolatedDataDocument(matching ? null : resource, options);
  return matching ? shared!.value : isolated;
}
interface OpenEditor {
  identity: object;
  owner: string;
  browser: BrowserDataEngine;
  key: string;
  editor: ManagedEditor;
  state: EditorState;
  status: SyncStatus;
  presence: RecordPresence;
  actions: ReturnType<ManagedEditor['getActions']>;
}
interface RecoveryRequest {
  base: object;
  sourceId: string;
  editorId: string;
  resolve: () => void;
  reject: (error: Error) => void;
}
const aborted = () => Object.assign(new Error('Editor recovery was cancelled'), { name: 'AbortError' });

/** One UI contract: durable draft, observed value, delivery and conflict choices. */
function useIsolatedDataDocument(resource: ResourceRef | null, { slot = 'default', create = false, autoSave = true, autoSaveDelayMs = 750, readOnlyCopy = false }: DocumentOptions = {}) {
  // The app-wide banner answers drafts under this slot; a screen editor there would be settled behind its back.
  if (slot === ACTION_SLOT) throw new Error(`The "${ACTION_SLOT}" slot is reserved for one-shot actions`);
  const { browser, owner } = useDataEngine();
  const readOnlyReason = useReadOnlyReason();
  const say = useSayFailure();
  const collection = resource?.collection ?? null, id = resource?.id ?? null;
  const key = JSON.stringify([collection, id, slot, create]);
  const [opened, setOpened] = useState<OpenEditor | null>(null);
  const [attempt, setAttempt] = useState(0);
  const base = useMemo(() => ({ owner, key, browser }), [owner, key, browser]);
  const [selection, setSelection] = useState<RecoveryRequest | null>(null);
  const requestedRecovery = useRef<RecoveryRequest | null>(null);
  const recovery = selection?.base === base ? selection : null;
  const identity = useMemo(() => ({ base, attempt, recovery }), [base, attempt, recovery]);
  const [failure, setFailure] = useState<{ identity: object; words: FailureWords } | null>(null);
  const observedFailure = failure?.identity === identity ? failure : null;
  const error = say(observedFailure?.words);
  /** Hold a failure for the screen as words: `read` for a failed read, `refused` for a refused action; null clears it. */
  const setError = useCallback((failure: unknown, kind: 'read' | 'refused' = 'refused') => {
    setFailure(failure === null ? null : { identity, words: (kind === 'read' ? failureWords : refusalWords)(failure, DOCUMENT_FAILED) });
  }, [identity]);
  const mounted = useRef(false);
  // Read when the editor closes, not when it opened: whether leaving may send what was typed.
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestedRecovery.current?.reject(aborted()); }; }, []);
  useEffect(() => () => { if (requestedRecovery.current?.base === base) requestedRecovery.current.reject(aborted()); }, [base]);
  const scope = useRef(identity);
  scope.current = identity;
  useEffect(() => {
    if (!browser || !owner || !collection || !id) return;
    let active = true;
    let editor: ManagedEditor | undefined;
    let stop: (() => void) | undefined, stopWaiting: (() => void) | undefined;
    const ref = { collection, id };
    const editorId = recovery?.editorId ?? browser.editorId(ref, slot);
    const cancellation = new AbortController();
    setError(null);
    const opening = recovery ? browser.engine.recoverEditor(ref, editorId, recovery.sourceId, { signal: cancellation.signal }) : create
      ? browser.engine.createEditor(ref, editorId, { signal: cancellation.signal })
      : browser.engine.openEditor(ref, editorId, { signal: cancellation.signal });
    void opening.then(value => {
      if (!active) { value.dispose(); return; }
      editor = value;
      const publish = () => {
        if (!active) return;
        try {
          const state = value.getState();
          setOpened({ identity, owner, key, browser, editor: value, state, presence: value.getPresence?.() ?? UNKNOWN_RECORD_PRESENCE, actions: value.getActions?.() ?? [], status: describeSync(state, value.getObservation(), value.getDelivery()) });
        } catch (failure) { setError(failure, 'read'); }
      };
      stop = value.subscribe(publish);
      publish();
      recovery?.resolve();
    // Recovering a draft is the person's action; its refusal may explain itself ("no longer exists").
    }).catch(failure => {
      recovery?.reject(failure);
      if (!active) return;
      setError(failure, recovery ? 'refused' : 'read');
      // Refused only because this tab could not ask the server — hidden, or offline with no copy here:
      // read again once it can (BUG-20261006-hidden-tab-document-read-not-retried). Recovering a draft
      // is the person's action and is never repeated behind the person's back.
      if (!recovery && needsConnection(failure)) stopWaiting = browser.engine.onceReachable(() => { if (active) setAttempt(value => value + 1); });
    });
    // Leaving the screen is a moment to save, not to forget (BUG-20260919-engine-leaving-strands-last-edit):
    // with autosave, whatever the debounce had not sent yet becomes a durable request as the editor closes.
    return () => { active = false; cancellation.abort(); recovery?.reject(aborted()); stop?.(); stopWaiting?.(); editor?.close({ flush: autoSaveRef.current }); };
  }, [browser, owner, collection, id, slot, create, key, attempt, setError, identity, recovery]);

  // Owner and resource identity gate rendering before effect cleanup can run.
  const current = opened?.identity === identity ? opened : null;
  const backgroundFailure = useBackgroundFailure(browser && owner && collection && id ? identity : null, collection && id ? { collection, id } : null);

  /*
   * AN OPENING THAT DOES NOT ANSWER IS NOT WAITED ON IN FRONT OF THE PERSON
   * (BUG-20260927-engine-open-hangs-on-silent-device-storage). Opening reads the editor's storage
   * first; when that storage is silent the opening hangs with neither result nor error, and the
   * council stayed a skeleton for half an hour at the meeting it was prepared for. A screen that
   * can show the document read-only (`readOnlyCopy`) gets, while that storage is silent, a copy
   * that needs no editor storage — the server's, or this device's confirmed one when the server
   * cannot be asked. The opening keeps running: when storage answers, the editor replaces the
   * copy and editing comes back by itself. The copy is keyed by the document, not the attempt, so
   * "retry" does not blank the screen, and it is forgotten once an editor opens.
   */
  const [copied, setCopied] = useState<{ base: object; snapshot: ResourceSnapshot; source: 'device' | 'server' } | null>(null);
  // The two looks are independent: the device copy lives in a store that may itself be silent,
  // and a device look that never answers must not stop the server from being asked again.
  // Both are stamped with the document they look for, so moving to another document neither waits
  // behind the previous one's look nor lets its late answer through.
  const lookingDevice = useRef<object | null>(null), lookingServer = useRef<object | null>(null);
  const editorOpen = useRef(false), latestBase = useRef(base);
  editorOpen.current = Boolean(current);
  latestBase.current = base;
  const waitingForEditor = Boolean(readOnlyCopy && browser && owner && collection && id && !create && !current && !error);
  const hasCopy = copied?.base === base;
  const hasServerCopy = hasCopy && copied!.source === 'server';
  useLookWhileSilent(waitingForEditor && !hasServerCopy, OPENING_STORAGE, () => {
    if (!browser || !collection || !id) return;
    const ref = { collection, id }, forBase = base;
    const offer = (snapshot: ResourceSnapshot | undefined, source: 'device' | 'server') => {
      // A look that answers after the editor opened, or for a document no longer on the screen, is old news.
      if (editorOpen.current || latestBase.current !== forBase) return;
      // An empty copy tells a reader nothing true: the document may exist only in this device's
      // silent storage, not yet delivered. Waiting is honest; "not found" would not be.
      if (!snapshot || snapshot.value === null) return;
      // The server's copy is the newest truth; the device's only fills the gap until it answers.
      setCopied(previous => previous?.base === forBase && previous.source === 'server' && source === 'device' ? previous : { base: forBase, snapshot, source });
    };
    // The device copy does not change while its store is silent: once one is on the screen, only the server is asked.
    if (!hasCopy && lookingDevice.current !== forBase) {
      lookingDevice.current = forBase;
      void browser.engine.peekCached(ref).then(snapshot => offer(snapshot, 'device'), () => undefined)
        .finally(() => { if (lookingDevice.current === forBase) lookingDevice.current = null; });
    }
    if (lookingServer.current !== forBase) {
      lookingServer.current = forBase;
      void browser.engine.peekRemote(ref).then(snapshot => offer(snapshot, 'server'), () => undefined)
        .finally(() => { if (lookingServer.current === forBase) lookingServer.current = null; });
    }
  });
  useEffect(() => { if (current) setCopied(null); }, [current]);
  // Only while the screen still asks for it: a view that switches to editing must not inherit it.
  const copy = readOnlyCopy && !current && copied?.base === base ? copied : null;
  const editorError = current?.state.error ?? null, editorErrorCode = current?.state.errorCode ?? undefined;
  const editorRefusal = editorError === null ? null
    : say(refusalWords(Object.assign(new Error(editorError), { code: editorErrorCode }), DOCUMENT_FAILED));
  const isCurrent = useCallback(() => mounted.current && scope.current === identity, [identity]);
  const run = useCallback(async <T,>(action: (editor: ManagedEditor) => Promise<T>): Promise<T> => {
    if (!isCurrent()) throw new Error(EDITOR_CHANGED);
    if (!current) throw copy ? readOnlyError(readOnlyReasonKey()) : new Error('The editor is not ready');
    try {
      const result = await action(current.editor);
      if (!isCurrent()) throw new Error(EDITOR_CHANGED);
      setError(null);
      return result;
    } catch (failure) {
      if (isCurrent()) setError(failure);
      throw failure;
    }
  }, [current, copy, readOnlyReason, isCurrent, setError]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelScheduledSave = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }, []);
  const save = useCallback(() => {
    cancelScheduledSave();
    return run(editor => editor.save());
  }, [run, cancelScheduledSave]);
  const recover = useCallback((sourceId: string): Promise<void> => {
    if (!isCurrent() || !browser || !owner || !collection || !id) return Promise.reject(new Error(EDITOR_CHANGED));
    cancelScheduledSave();
    return new Promise((resolve, reject) => {
      requestedRecovery.current?.reject(aborted());
      const request = { base, sourceId, editorId: recoveryEditorIdentity(browser.editorId({ collection, id }, slot), newClientId()), resolve, reject };
      requestedRecovery.current = request;
      setSelection(request);
    });
  }, [base, browser, owner, collection, id, slot, isCurrent, cancelScheduledSave]);
  useEffect(() => {
    if (!autoSave || !current?.status.canSave) return;
    let active = true;
    const delay = Number.isFinite(autoSaveDelayMs) ? Math.max(0, autoSaveDelayMs) : 750;
    const timer = setTimeout(() => {
      saveTimer.current = null;
      if (!active || !isCurrent()) return;
      void current.editor.save().catch(failure => { if (isCurrent()) setError(failure); });
    }, delay);
    saveTimer.current = timer;
    // Hiding the page — another tab, another app, the iPad's home gesture — may be the last
    // moment this page runs. Save now instead of waiting out the delay.
    const saveNow = () => {
      if (!active || !isCurrent()) return;
      active = false;
      clearTimeout(timer);
      if (saveTimer.current === timer) saveTimer.current = null;
      void current.editor.save().catch(failure => { if (isCurrent()) setError(failure); });
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') saveNow(); };
    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      clearTimeout(timer);
      if (saveTimer.current === timer) saveTimer.current = null;
      window.removeEventListener('pagehide', saveNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [autoSave, autoSaveDelayMs, current?.editor, current?.state.checkpoint.editGeneration, current?.status.canSave, isCurrent, setError]);

  const manualEditor = current?.editor;
  const getManualForm = useCallback((formSlot: string, fields: readonly ManualPath[], recovery?: ManualRecoveryPolicy) => {
    if (!manualEditor && copy) throw readOnlyError(readOnlyReasonKey());
    if (!manualEditor || !isCurrent()) throw new Error(EDITOR_CHANGED);
    return manualEditor.form(formSlot, fields, recovery);
  }, [manualEditor, copy, readOnlyReason, isCurrent]);

  return {
    getManualForm,
    /** Notification metadata; `error` still reports the read failure to data consumers. */
    ...(observedFailure ? { errorWords: observedFailure.words } : {}),
    recoveryIdentity: identity as object,
    data: current ? current.state.checkpoint.draft : copy?.snapshot.value ?? null,
    presence: current?.presence ?? (copy ? documentRecordPresence(copy.snapshot.resource, { snapshot: copy.snapshot, source: copy.source === 'server' ? 'server' : 'cache', readiness: copy.source === 'server' ? 'server' : 'cache', checking: false, error: false }) : UNKNOWN_RECORD_PRESENCE),
    confirmed: current?.state.checkpoint.confirmed ?? null,
    remote: current?.state.checkpoint.remoteCandidate ?? null,
    state: current?.state ?? null,
    status: current?.status ?? null,
    loading: Boolean(resource && owner && !current && !error && !copy),
    /** A copy is on the screen for reading; every change is refused with `readOnlyReason`. */
    readOnly: Boolean(copy),
    copySource: copy?.source ?? null,
    readOnlyReason: copy ? readOnlyReason() : null,
    // A background failure elsewhere in the engine never reaches an open document or a copy shown
    // for reading: pages treat `error` as "could not load" (see useBackgroundFailure).
    // The editor's own state error also holds refused actions (controller `enqueue`): a coded one is
    // said in words, an unknown one keeps the engine's sentence, which may be an instruction
    // (BUG-20261003-engine-refusals-speak-english).
    error: error ?? editorRefusal ?? (copy || current ? null : backgroundFailure),
    /*
     * Typing is a change of what this screen shows. When a deletion from another device took the
     * draft away a moment before the screen redrew, the change is made on the copy shown and waits
     * under "deleted on another device" instead of being refused with the words left only in the
     * field (BUG-20261011-refused-edit-words-not-recoverable).
     */
    edit: (value: DocumentData | null) => {
      cancelScheduledSave();
      return run(editor => editor.edit(value, current?.state.checkpoint));
    },
    update: (updater: (current: DocumentData | null) => DocumentData | null, options?: DocumentUpdateOptions) => {
      let refused: { error: unknown } | null = null;
      return run(editor => {
        const live = editor.getState().checkpoint, shown = current?.state.checkpoint;
        const base = shown && deletedUnder(live, shown) ? shown.draft : live.draft;
        let next: DocumentData | null;
        try { next = updater(base); }
        catch (error) {
          if (!options?.handlesRefusal?.(error)) throw error;
          refused = { error };
          return Promise.resolve();
        }
        // An expected question changed no draft and must not cancel an earlier save.
        cancelScheduledSave();
        return editor.edit(next, shown);
      }).then(() => { if (refused) throw refused.error; }, error => {
        // A question already established for the departed owner must still reach its backup.
        throw refused ? refused.error : error;
      });
    },
    /** Freeze the intended save before any asynchronous draft persistence. */
    commit: (updater: (current: DocumentData | null) => DocumentData | null, action?: 'bible-mark-stroke') => {
      const time = action && owner ? actionClock.capture(owner) : undefined;
      cancelScheduledSave();
      return run(editor => time ? editor.commit(updater, time) : editor.commit(updater));
    },
    actions: current?.actions ?? [],
    carryCouncilTopicToNew: (topicId: string, title: string) => {
      cancelScheduledSave();
      return run(editor => editor.carryCouncilTopicToNew(topicId, title));
    },
    carryCouncilTopicToExisting: (topicId: string, destinationId: string) => {
      cancelScheduledSave();
      return run(editor => editor.carryCouncilTopicToExisting(topicId, destinationId));
    },
    discardAction: (id: string) => run(editor => editor.discardAction(id)),
    save,
    remove: () => { cancelScheduledSave(); return run(editor => editor.remove()); },
    // After a refusal this also drops the refused change (EditorController.acceptRemote).
    acceptRemote: () => run(editor => editor.acceptRemote()),
    keepLocal: () => run(editor => editor.keepLocal()),
    /*
     * The draft search owns what it finds and how it fails (`useRecoveryDiscovery` says it): its
     * failure is not the document's, and its success does not clear the document's own failure
     * (BUG-20261003-draft-search-failure-shown-twice).
     */
    listRecoverable: async (options?: { omitBorrowedSlots?: readonly string[]; manualChoiceCopies?: 'only' | 'omit' }) => {
      if (!isCurrent() || !browser || !owner || !collection || !id) throw new Error(EDITOR_CHANGED);
      // Listing drafts reads the editor's storage; when it is silent the search says so instead of spinning.
      const resource = { collection, id };
      const listing = options?.manualChoiceCopies === 'only'
        ? browser.engine.listRecoveryChoices(resource, true) : browser.engine.listRecoveryChoices(resource);
      const records = await untilStorageSilent(listing, () => undefined, readOnlyReason(true));
      if (!isCurrent()) throw new Error(EDITOR_CHANGED);
      if (!options) return records;
      const pending = current?.state.checkpoint.pending ?? {};
      const duplicate = (id: string): boolean => {
        const scope = pending[id]?.borrowedManualScope;
        const slot = scope && readManualScopeIdentity(scope)?.slot;
        return Boolean(slot && options.omitBorrowedSlots?.includes(slot));
      };
      return records.filter(({ record }) => {
        const preserved = isManualChoiceRecoveryIdentity(record.editorId);
        if (options.manualChoiceCopies === 'only') return preserved;
        if (options.manualChoiceCopies === 'omit' && preserved) return false;
        return !isOnlySubmittedCopy(record, duplicate);
      });
    },
    discardRecovery: async (source: RecoveryCheckpoint) => {
      if (!isCurrent() || !browser || !owner || !collection || !id
        || source.record.checkpoint.confirmed.resource.collection !== collection || source.record.checkpoint.confirmed.resource.id !== id) throw new Error(EDITOR_CHANGED);
      await browser.engine.discardRecovery(source);
      if (!isCurrent()) throw new Error(EDITOR_CHANGED);
    },
    recover,
    retry: async () => {
      if (!isCurrent()) throw new Error(EDITOR_CHANGED);
      setError(null);
      if (current && browser && collection && id) {
        // Said like any other action's failure (`run`): a retry that fails silently looks like a
        // button that does nothing (BUG-20261003-document-retry-error-hidden).
        try {
          await browser.engine.retry({ collection, id });
        } catch (failure) {
          if (isCurrent()) setError(failure);
          throw failure;
        }
      } else if (recovery) await recover(recovery.sourceId);
      else setAttempt(value => value + 1);
    },
  };
}

/** Collection snapshots retain tombstones so a remote deletion is distinguishable from an incomplete list. */
export function useDataCollection(collection: string | null) {
  const { browser, owner } = useContext(EngineContext) ?? idleEngine;
  const [attempt, setAttempt] = useState(0);
  const identity = useMemo(() => ({ owner, browser, collection, attempt }), [owner, browser, collection, attempt]);
  const backgroundFailure = useBackgroundFailure(browser && owner && collection ? identity : null, collection ? { collection } : null);
  const say = useSayFailure();
  const scope = useRef(identity); scope.current = identity;
  const subscription = useRef<{ identity: object; watching: boolean } | null>(null);
  const mounted = useRef(false);
  const [observed, setObserved] = useState<{ identity: object; state: CollectionState } | null>(null);
  const [failure, setFailure] = useState<{ identity: object; words: FailureWords } | null>(null);
  const current = useCallback(() => mounted.current && scope.current === identity, [identity]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!browser || !owner || !collection) return;
    let active = true;
    let stop: (() => void) | undefined;
    subscription.current = { identity, watching: false };
    try {
      stop = browser.engine.watchCollection(collection, state => {
        if (active && current()) { setObserved({ identity, state }); setFailure(null); }
      });
      subscription.current = { identity, watching: true };
    } catch (error) { if (current()) setFailure({ identity, words: failureWords(error, BACKGROUND_FAILED) }); }
    return () => { active = false; stop?.(); };
  }, [browser, owner, collection, identity, current]);
  const state = observed?.identity === identity ? observed.state : null;
  const stateError = useStateFailure(state?.error, BACKGROUND_FAILED);
  // A list that fails says what its wait says; the engine's sentence goes to the console.
  const ownError = (failure?.identity === identity ? say(failure.words) : null) ?? stateError;
  const waiting = Boolean(owner && collection && !ownError && (!state || (state.freshness === 'unknown' && !state.documents?.some(document => document.value !== null))));
  /*
   * A LIST WHOSE CACHE DOES NOT ANSWER (BUG-20260927-engine-open-hangs-on-silent-device-storage).
   * The live list reads its rows and cursor from device storage before it asks the server, so a
   * silent store held every list — prayers, notes, councils — on its placeholder. While the list's
   * storage is silent it shows a copy for reading: the server's whole list, or the rows this device
   * confirmed when the server cannot be asked. Rows lead only to documents and to actions that
   * refuse in words while storage is silent, so no list needs to opt in. The live list replaces
   * the copy as soon as it answers.
   */
  const [copied, setCopied] = useState<{ identity: object; state: CollectionState; source: 'device' | 'server' } | null>(null);
  // Independent looks, as for a document: a silent row store must not stop the server being asked.
  const lookingDevice = useRef<object | null>(null), lookingServer = useRef<object | null>(null);
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const listHasCopy = copied?.identity === identity;
  useLookWhileSilent(waiting && !(listHasCopy && copied!.source === 'server'), LIST_STORAGE, () => {
    if (!browser || !collection) return;
    const forIdentity = identity;
    const offer = (next: CollectionState, source: 'device' | 'server') => {
      if (latestIdentity.current !== forIdentity) return;
      setCopied(previous => previous?.identity === forIdentity && previous.source === 'server' && source === 'device' ? previous : { identity: forIdentity, state: next, source });
    };
    // A device scan of the whole row store is not repeated once its rows are on the screen.
    if (!listHasCopy && lookingDevice.current !== forIdentity) {
      lookingDevice.current = forIdentity;
      void browser.engine.peekCollectionCached(collection).then(next => offer(next, 'device'), () => undefined)
        .finally(() => { if (lookingDevice.current === forIdentity) lookingDevice.current = null; });
    }
    if (lookingServer.current !== forIdentity) {
      lookingServer.current = forIdentity;
      void browser.engine.peekCollectionRemote(collection).then(next => offer(next, 'server'), () => undefined)
        .finally(() => { if (lookingServer.current === forIdentity) lookingServer.current = null; });
    }
  });
  const copy = waiting && copied?.identity === identity ? copied : null;
  // The engine's background failure explains only a list still waiting (see useBackgroundFailure);
  // it neither stops that list from being offered a copy nor hides one.
  const error = ownError ?? (copy || !waiting ? null : backgroundFailure);
  const refresh = async () => {
  if (!current() || !browser || !owner || !collection) throw new Error('The active collection changed');
  try {
    const next = await browser.engine.refreshCollection(collection);
    if (!current()) throw new Error('The active collection changed');
    setFailure(null);
    if (subscription.current?.identity === identity && !subscription.current.watching) setAttempt(value => value + 1);
    return next;
  } catch (error) {
    if (current()) setFailure({ identity, words: failureWords(error, BACKGROUND_FAILED) });
    throw error;
  }
  };
  const presence = useCallback((id: string, answer: CollectionState | null = copy ? copy.state : state) =>
    collection ? collectionRecordPresence({ collection, id }, answer) : UNKNOWN_RECORD_PRESENCE,
  [collection, copy, state]);
  return {
    state: copy ? copy.state : state,
    presence,
    loading: waiting && !copy && !error,
    /** The rows are a copy for reading while the list's own storage is silent. */
    readOnly: Boolean(copy),
    error,
    refresh,
    /** One identity-fenced refresh classified from that exact answer, without waiting for a React echo. */
    refreshPresence: async (id: string) => presence(id, await refresh()),
  };
}


/** Explicit forms share the document observer and delivery while keeping typing stage-only. */
export function useDataForm(resource: ResourceRef | null, slot: string, selection: readonly ManualPath[], recovery: ManualRecoveryPolicy = 'same-slot') {
  const { owner, browser } = useDataEngine();
  const document = useDataDocument(resource, { autoSave: false });
  const fieldsKey = JSON.stringify(selection);
  const fields = useMemo(() => JSON.parse(fieldsKey) as ManualPath[], [fieldsKey]);
  const key = JSON.stringify([resource?.collection, resource?.id, slot, fieldsKey, recovery]);
  const hasResource = Boolean(resource), documentReady = !document.loading && Boolean(document.state);
  const getManualForm = document.getManualForm;
  const identity = useMemo(() => ({ owner, browser, key, editor: document.getManualForm }), [owner, browser, key, document.getManualForm]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const [opened, setOpened] = useState<{ identity: object; form: ManagedManualForm; state: ReturnType<ManagedManualForm['getState']> } | null>(null);
  const [failure, setFailure] = useState<{ identity: object; words: FailureWords } | null>(null);
  const say = useSayFailure();
  const [working, setWorking] = useState<{ identity: object; count: number }>({ identity, count: 0 });
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = useCallback(() => mounted.current && currentIdentity.current === identity, [identity]);
  useEffect(() => {
    if (!hasResource || !owner || !browser || !documentReady) return;
    let active = true;
    let stop: (() => void) | undefined;
    try {
      const form = getManualForm(slot, fields, recovery);
      const update = () => { if (active && current()) setOpened({ identity, form, state: form.getState() }); };
      stop = form.subscribe(update); update();
    } catch (error) { if (current()) setFailure({ identity, words: refusalWords(error, DOCUMENT_FAILED) }); }
    return () => { active = false; stop?.(); };
  }, [identity, owner, browser, hasResource, documentReady, getManualForm, slot, fields, recovery, current]);
  const target = opened?.identity === identity ? opened : null;
  const targetForm = target?.form;
  const readOnly = !targetForm && document.readOnly;
  const run = useCallback(async (action: (form: ManagedManualForm) => Promise<void>, busy = true) => {
    // A form over a copy shown for reading cannot stage anything; say why instead of "not ready".
    if (!current() || !targetForm) throw readOnly ? readOnlyError(readOnlyReasonKey()) : new Error('The manual form is not ready');
    if (busy) setWorking(value => ({ identity, count: value.identity === identity ? value.count + 1 : 1 }));
    try {
      await action(targetForm);
      if (!current()) throw new Error(EDITOR_CHANGED);
      setFailure(null);
    } catch (error) {
      if (current()) setFailure({ identity, words: refusalWords(error, DOCUMENT_FAILED) });
      throw error;
    } finally {
      if (busy && current()) setWorking(value => ({ identity, count: Math.max(0, value.identity === identity ? value.count - 1 : 0) }));
    }
  }, [targetForm, readOnly, document.readOnlyReason, current, identity]);
  const begin = useCallback(() => run(form => form.begin()), [run]);
  const follow = useCallback(() => run(form => form.follow()), [run]);
  const proposals = useMemo(() => ({ identity, pending: new Set<AbortController>() }), [identity]);
  useEffect(() => () => { proposals.pending.forEach(controller => controller.abort()); }, [proposals]);
  const error = failure?.identity === identity ? say(failure.words) : readOnly ? document.readOnlyReason : document.error;
  const errorWords = failure?.identity === identity ? failure.words : readOnly ? undefined : document.errorWords;
  /*
   * A form shows its own stage only while it has one: open for editing, or holding words not yet
   * saved. Closed and clean, it has nothing of its own, and its last Save may no longer be the
   * document's — "take theirs" cancels it — so it shows the document, which carries a Save still
   * on its way as well (BUG-20261003-take-theirs-title-keeps-discarded-text).
   */
  const stage = target?.state;
  const ownStage = stage && (stage.record.active || stage.dirty) ? stage.value : null;
  // Screens with a separate document notice can omit a form's copy while it has no failure of its own.
  const mirrorsDocumentConflict = Boolean(stage?.documentChoiceRequired && stage.durable
    && !stage.choiceRequired && !stage.captureFailed && !stage.capturing && failure?.identity !== identity);
  return {
    readOnly,
    active: stage?.record.active ?? false,
    ...(stage?.documentChoiceRequired ? { documentChoiceRequired: true as const, mirrorsDocumentConflict } : {}),
    data: ownStage ?? document.data,
    /** Settled loading can mean an opening failed; only an acquired manual form can list its drafts. */
    recoveryReady: Boolean(targetForm),
    recoveryVersion: JSON.stringify([Boolean(stage?.record.active), Boolean(stage?.documentChoiceRequired), document.status?.phase]),
    borrowedRecoveryIds: [...new Set((document.state?.borrowedManualAnswers ?? []).filter(id => readManualScopeIdentity(id)?.slot === slot))],
    exactChoice: target?.state?.exactChoice ?? false,
    // The opening may include submitted predecessors; it is never a confirmed snapshot.
    openingData: target?.state?.openingValue ?? null,
    // This may be a previously saved intent, so it is deliberately not called confirmed.
    initialData: target?.state ? target.state.record.predecessor?.value ?? target.state.record.baseline.value : document.data,
    recoveryIdentity: identity as object,
    busy: working.identity === identity && working.count > 0,
    loading: document.loading || Boolean(hasResource && owner && !target && !error),
    durable: target?.state?.durable ?? true,
    capturing: target?.state?.capturing ?? false,
    comparison: target?.state?.comparison ?? null,
    canDiscardStage: Boolean(target?.state?.dirty && target.state.durable && target.state.comparison
      && document.status?.phase === 'conflict' && document.status.canAcceptRemote),
    ...(target?.state?.choiceRequired ? { choiceRequired: true as const } : {}),
    dirty: target?.state?.dirty ?? false,
    status: describeManualSync(target?.state ?? null, document.state, document.status, error, document.presence),
    ...(failure?.identity === identity ? { localError: say(failure.words) } : {}),
    error,
    ...(errorWords ? { errorWords } : {}),
    begin,
    follow,
    propose: (producer: (source: DocumentData) => Promise<DocumentData>) => {
      const controller = new AbortController(); proposals.pending.add(controller);
      return run(form => form.propose(producer, controller.signal)).finally(() => proposals.pending.delete(controller));
    },
    update: (updater: (draft: DocumentData) => DocumentData) => run(form => form.update(updater), false),
    save: (updater?: (draft: DocumentData) => DocumentData, action?: { preachDateId: string }) => {
      const time = action && owner && actionClock.capture(owner);
      return run(form => action && time ? form.save(updater, { rowId: action.preachDateId, time }) : form.save(updater));
    },
    cancel: () => run(form => form.cancel()),
    keepLocal: (updater?: (current: DocumentData) => DocumentData) => run(form => form.resolve('local', { expectedComparison: target?.state?.comparison, updater })),
    acceptRemote: () => run(form => form.resolve('remote', { expectedComparison: target?.state?.comparison })),
    discardStageAndAcceptRemote: () => run(form => form.resolve('remote', { discardStage: true, expectedComparison: target?.state?.comparison })),
    retry: () => run(form => form.retry()),
    listRecoverable: async () => {
      // Over a copy for reading there is no form storage to search; the app-wide notice says why.
      if (readOnly) return [];
      if (!target || !current()) throw new Error(EDITOR_CHANGED);
      const records = await target.form.listRecoverable(); if (!current()) throw new Error(EDITOR_CHANGED); return records;
    },
    recover: (scopeId: string) => run(form => form.recover(scopeId)),
    discardRecovery: (source: StoredManualScope) => run(form => form.discardRecovery(source)),
  };
}
