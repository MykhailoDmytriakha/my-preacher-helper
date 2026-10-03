'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/providers/AuthProvider';
import { failureWords, logFailureOnce, refusalWords, sayFailure, type FailureWords } from '@/utils/actionFailureMessage';
import { newClientId } from '@/utils/clientId';
import { LIST_STORAGE, OPENING_STORAGE, getDeviceStorageHealth, isStorageSilent, subscribeDeviceStorage, untilStorageSilent } from '@/utils/deviceStorage';

import { createBrowserDataEngine, type BrowserDataEngine } from './browser.client';
import { isCollectionOnEngine, isDataEngineEnabled } from './clientPolicy';
import { editorSlot } from './editorIdentity';
import { LegacyQueryCopies, LegacyQueryMigrationGate } from './LegacyQueryRecovery';
import { isEngineOwnedLegacyQuery, legacyCacheMayBeOverwritten } from './legacyQueryRecovery.client';
import { describeManualSync, describeSync, type SyncStatus } from './status';
import { useRecoveryDiscovery as useDiscovery, type RecoveryDiscoveryOptions } from './useRecoveryDiscovery';

import type { CollectionState } from './collections';
import type { EditorRecord, EditorState } from './controller';
import type { ManagedEditor, ManagedManualForm, ManualRecoveryPolicy } from './engine';
import type { ManualPath } from './manualScope';
import type { MembershipDelivery } from './membershipDelivery';
import type { MembershipAction } from './membershipIntent';
import type { MembershipScope } from './membershipScope';
import type { DocumentData, JournalEntry, ResourceRef, ResourceSnapshot } from './types';

export { isCollectionOnEngine, isDataEngineEnabled } from './clientPolicy';

interface EngineContextValue {
  browser: BrowserDataEngine | null;
  owner: string | null;
  /** The last background failure of this owner's engine; see `useBackgroundFailure` for who may show it. */
  error: string | null;
  /** Counts background failures; a screen compares it with the count when it started waiting. */
  failureCount: number;
}
const EngineContext = createContext<EngineContextValue | null>(null);
/** Only whether the provider failed and how often; `useBackgroundFailure` says it in words. */
const message = (error: unknown) => error instanceof Error ? error.message : 'Data engine failed';
const EDITOR_CHANGED = 'The active editor changed';
const ENGINE_NOT_READY = 'The data engine is not ready';
/** What a list, or a screen waiting on the engine's background work, says when that work failed. */
const BACKGROUND_FAILED = 'dataSync.backgroundFailure';

/**
 * Why a copy shown for reading cannot take this change, in the person's words: when the device's
 * storage is silent, editing returns by itself once it answers; otherwise the editor is still opening.
 */
function useReadOnlyReason() {
  const { t } = useTranslation();
  // Re-render when storage goes silent or answers, so a reason already on the screen stays true.
  useSyncExternalStore(subscribeDeviceStorage, getDeviceStorageHealth, getDeviceStorageHealth);
  // Stable on purpose: editor callbacks and form identities depend on it, and a `t` that changes
  // between renders would reopen forms in a loop.
  const translate = useRef(t);
  translate.current = t;
  return useCallback((storage = isStorageSilent()) => translate.current(storage ? 'dataSync.readOnly.storage' : 'dataSync.readOnly.opening'), []);
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
const readOnlyRefusal = (reason: string) => Object.assign(new Error(reason), { code: 'read-only' });

/** Public recovery UI seam; storage and owner fencing remain inside the engine. */
export function useRecoveryDiscovery<T>(options: RecoveryDiscoveryOptions<T>) {
  return useDiscovery(options);
}

/** Whether the query persister may write over the old cache yet: never before its copies are archived. */
export function queryCacheMayBeOverwritten(): boolean {
  return legacyCacheMayBeOverwritten();
}

/** Whether the persisted query cache may keep this query; engine-owned collections are session-only. */
export function shouldPersistLegacyQuery(queryKey: readonly unknown[]): boolean {
  return !isEngineOwnedLegacyQuery(queryKey, isCollectionOnEngine);
}

/** Preserve old cache copies before the query provider may hydrate, expire or replace them. */
export function DataEngineMigrationGate({ children }: { children: ReactNode }) {
  return (['councils', 'groups', 'series', 'sermons', 'users'].some(isCollectionOnEngine)) ? <LegacyQueryMigrationGate enabled={isCollectionOnEngine}>{children}</LegacyQueryMigrationGate> : <>{children}</>;
}

/** Archived cache copies are evidence for the person, never confirmed engine snapshots. */
export function LegacyDataRecoveryNotice() {
  const { user } = useAuth();
  return user?.uid && (['councils', 'groups', 'series', 'sermons', 'users'].some(isCollectionOnEngine)) ? <LegacyQueryCopies key={user.uid} owner={user.uid} /> : null;
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
  const [failure, setFailure] = useState<{ owner: string | null; message: string; count: number } | null>(null);
  useEffect(() => {
    let active = true;
    const instance = createBrowserDataEngine({ onError: error => {
      // The engine's own sentence is for developers; a screen that shows this failure says it in words.
      logFailureOnce(error, 'DataEngine background operation failed');
      if (active) setFailure(previous => ({ owner, message: message(error), count: (previous?.count ?? 0) + 1 }));
    } });
    instance.engine.setOwner(owner);
    setFailure(null);
    setMounted({ owner, browser: instance });
    return () => { active = false; instance.dispose(); };
  }, [owner]);
  const browser = mounted?.owner === owner ? mounted.browser : null;
  const error = failure?.owner === owner ? failure.message : null;
  const failureCount = failure?.owner === owner ? failure.count : 0;
  const value = useMemo(() => ({ browser, owner, error, failureCount }), [browser, owner, error, failureCount]);
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useDataEngine(): EngineContextValue {
  const context = useContext(EngineContext);
  if (!context) throw new Error('Mount DataEngineProvider before using data');
  return context;
}

/**
 * ONE ACTION ON A DOCUMENT THAT NO SCREEN HAS OPEN — a menu entry on a list row, a link made
 * from the other side of a relation. The editor opens on the document's own baseline, captures
 * exactly this change as one durable request and closes; delivery, retries and conflicts stay
 * with the engine like any save. A screen that shows the document keeps its own editor instead.
 */
/**
 * Whether a closed editor's checkpoint waits for the person: the server answered one of its
 * requests with a conflict or a refusal. Work that is queued, or an edit still on its way into a
 * request (possibly another tab's), does not.
 */
export function waitsForDecision(record: EditorRecord, journal: readonly JournalEntry[]): boolean {
  const failed = new Set(journal.filter(entry => entry.state === 'refused' || entry.state === 'conflict').map(entry => entry.command.operationId));
  return record.checkpoint.conflicts.length > 0 || Object.keys(record.checkpoint.pending).some(id => failed.has(id));
}

/** The slot one-shot actions open their editor under. */
const ACTION_SLOT = 'action';

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
 * The server's copy of one document, read now through the engine's transport — for a screen that
 * must see proof from the server before it gives something up. Null without an engine; the read
 * refuses offline or on a hidden page rather than answering from this device.
 */
export function useRemotePeek(): ((resource: ResourceRef) => Promise<ResourceSnapshot>) | null {
  const { browser } = useContext(EngineContext) ?? idleEngine;
  return useMemo(() => browser ? (resource: ResourceRef) => browser.engine.peekRemote(resource) : null, [browser]);
}

export function useDocumentActions() {
  // Menus that offer these actions render in both deployments; without an engine they are not ready.
  const { browser, owner } = useContext(EngineContext) ?? idleEngine;
  const readOnlyReason = useReadOnlyReason();
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
    return records.filter(({ record }) => waitsForDecision(record, journal));
  }, [browser, readOnlyReason]);
  const withEditor = useCallback(async (resource: ResourceRef, action: (editor: ManagedEditor) => Promise<void>, creating = false) => {
    if (!browser || !owner) throw new Error(ENGINE_NOT_READY);
    // A document that waits for a decision takes no further one-shot change: each attempt
    // would only strand another checkpoint behind the answer (EngineConflictBanner asks first).
    if (!creating && (await waitingFor(resource)).length) throw decisionRequired();
    const editor = await openFor(resource, browser.editorId(resource, ACTION_SLOT), creating);
    try { await action(editor); } finally { editor.close({ flush: false }); }
  }, [browser, owner, waitingFor, openFor]);
  return useMemo(() => ({
    ready: Boolean(browser && owner),
    /** A new document under a stable client ID; a retry with the same ID never creates a second one. */
    create: (resource: ResourceRef, value: DocumentData) => withEditor(resource, editor => editor.commit(() => value), true),
    commit: (resource: ResourceRef, updater: (current: DocumentData | null) => DocumentData | null) =>
      withEditor(resource, editor => editor.commit(updater)),
    remove: (resource: ResourceRef) => withEditor(resource, editor => editor.remove()),
    /**
     * Settle the answer the server gave to a document no screen has open — a conflict or a
     * refusal — without ever choosing for the person. "Mine" is allowed only when exactly one
     * checkpoint waits and the document still exists on the server: the engine gives no order
     * between several closed checkpoints of one document (their generations restart and tie),
     * so among several only "theirs" is possible, after the banner has shown every draft for
     * copying. "Theirs" retires exactly the waiting checkpoints; a refusal, which has no stored
     * version to accept, returns its draft to the confirmed copy. Queued work is never touched.
     * Each editor is reopened under its own identity so a settled checkpoint stops being
     * recoverable. Resolves to the number of settled checkpoints.
     */
    resolve: async (resource: ResourceRef, choice: 'mine' | 'theirs'): Promise<number> => {
      if (!browser || !owner) throw new Error(ENGINE_NOT_READY);
      // One-shot drafts only: a screen editor's draft of the same document is that screen's to settle.
      const waiting = (await waitingFor(resource)).filter(({ record }) => isOneShotRecord(record));
      if (!waiting.length) return 0;
      if (choice === 'mine' && (waiting.length !== 1 || remoteDeleted(waiting[0].record))) {
        throw Object.assign(new Error('Only the stored version can be taken here'), { code: 'ambiguous-choice' });
      }
      for (const { record } of waiting) {
        const editor = await openFor(resource, record.editorId);
        try {
          if (choice === 'mine') { await editor.keepLocal(); await editor.save(); continue; }
          await editor.acceptRemote();
          const { checkpoint } = editor.getState();
          if (checkpoint.dirty) await editor.edit(checkpoint.confirmed.value);
        } finally { editor.close({ flush: false }); }
      }
      return waiting.length;
    },
  }), [browser, owner, withEditor, waitingFor, openFor]);
}

/**
 * For readers that exist in both deployments. A document editor keeps the strict boundary — a
 * missing provider there is a mistake — but a collection read from a screen that also runs
 * without the engine is an absence of rows, not a programming error.
 */
const idleEngine: EngineContextValue = { browser: null, owner: null, error: null, failureCount: 0 };

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
function useBackgroundFailure(waitIdentity: object | null): string | null {
  const { t } = useTranslation();
  const { error, failureCount } = useContext(EngineContext) ?? idleEngine;
  const [since, setSince] = useState<{ identity: object; count: number } | null>(null);
  const latestCount = useRef(failureCount);
  latestCount.current = failureCount;
  useEffect(() => {
    if (waitIdentity) setSince({ identity: waitIdentity, count: latestCount.current });
  }, [waitIdentity]);
  return error && waitIdentity && since?.identity === waitIdentity && failureCount > since.count
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
  return {
    ready: Boolean(browser && owner), error: failure?.identity === identity ? say(failure.words) : null,
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
  };
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
  return <DocumentContext.Provider value={{ resource, create: options?.create ?? false, value: document }}>{children}</DocumentContext.Provider>;
}

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
  const error = failure?.identity === identity ? say(failure.words) : null;
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
    let stop: (() => void) | undefined;
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
          setOpened({ identity, owner, key, browser, editor: value, state, status: describeSync(state, value.getObservation(), value.getDelivery()) });
        } catch (failure) { setError(failure, 'read'); }
      };
      stop = value.subscribe(publish);
      publish();
      recovery?.resolve();
    // Recovering a draft is the person's action; its refusal may explain itself ("no longer exists").
    }).catch(failure => { recovery?.reject(failure); if (active) setError(failure, recovery ? 'refused' : 'read'); });
    // Leaving the screen is a moment to save, not to forget (BUG-20260919-engine-leaving-strands-last-edit):
    // with autosave, whatever the debounce had not sent yet becomes a durable request as the editor closes.
    return () => { active = false; cancellation.abort(); recovery?.reject(aborted()); stop?.(); editor?.close({ flush: autoSaveRef.current }); };
  }, [browser, owner, collection, id, slot, create, key, attempt, setError, identity, recovery]);

  // Owner and resource identity gate rendering before effect cleanup can run.
  const current = opened?.identity === identity ? opened : null;
  const backgroundFailure = useBackgroundFailure(browser && owner && collection && id ? identity : null);

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
  const isCurrent = useCallback(() => mounted.current && scope.current === identity, [identity]);
  const run = useCallback(async (action: (editor: ManagedEditor) => Promise<void>) => {
    if (!isCurrent()) throw new Error(EDITOR_CHANGED);
    if (!current) throw copy ? readOnlyRefusal(readOnlyReason()) : new Error('The editor is not ready');
    try {
      await action(current.editor);
      if (!isCurrent()) throw new Error(EDITOR_CHANGED);
      setError(null);
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
      const request = { base, sourceId, editorId: `${browser.editorId({ collection, id }, slot)}:recovery:${newClientId()}`, resolve, reject };
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
    if (!manualEditor && copy) throw readOnlyRefusal(readOnlyReason());
    if (!manualEditor || !isCurrent()) throw new Error(EDITOR_CHANGED);
    return manualEditor.form(formSlot, fields, recovery);
  }, [manualEditor, copy, readOnlyReason, isCurrent]);

  return {
    getManualForm,
    recoveryIdentity: identity as object,
    data: current ? current.state.checkpoint.draft : copy?.snapshot.value ?? null,
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
    // The editor's own state error also holds refused actions (controller `enqueue`), so it keeps
    // the engine's words, which may be an instruction (BUG-20261003-engine-refusals-speak-english).
    error: error ?? current?.state.error ?? (copy || current ? null : backgroundFailure),
    edit: (value: DocumentData | null) => {
      cancelScheduledSave();
      return run(editor => editor.edit(value));
    },
    update: (updater: (current: DocumentData | null) => DocumentData | null) => {
      cancelScheduledSave();
      return run(editor => editor.edit(updater(editor.getState().checkpoint.draft)));
    },
    /** Freeze the intended save before any asynchronous draft persistence. */
    commit: (updater: (current: DocumentData | null) => DocumentData | null) => {
      cancelScheduledSave();
      return run(editor => editor.commit(updater));
    },
    save,
    remove: () => { cancelScheduledSave(); return run(editor => editor.remove()); },
    // After a refusal this also drops the refused change (EditorController.acceptRemote).
    acceptRemote: () => run(editor => editor.acceptRemote()),
    keepLocal: () => run(editor => editor.keepLocal()),
    listRecoverable: async () => {
      if (!isCurrent() || !browser || !owner || !collection || !id) throw new Error(EDITOR_CHANGED);
      try {
        // Listing drafts reads the editor's storage; when it is silent the search says so instead of spinning.
        const records = await untilStorageSilent(browser.engine.listRecoverable({ collection, id }), () => undefined, readOnlyReason(true));
        if (!isCurrent()) throw new Error(EDITOR_CHANGED);
        setError(null);
        return records;
      } catch (failure) {
        // Silent storage is not a failure of this document: the search reports it, the editor stays as it is.
        if (isCurrent() && (failure as { code?: string }).code !== 'storage-silent') setError(failure, 'read');
        throw failure;
      }
    },
    recover,
    retry: async () => {
      if (!isCurrent()) throw new Error(EDITOR_CHANGED);
      setError(null);
      if (current && browser && collection && id) await browser.engine.retry({ collection, id });
      else if (recovery) await recover(recovery.sourceId);
      else setAttempt(value => value + 1);
    },
  };
}

/** Collection snapshots retain tombstones so a remote deletion is distinguishable from an incomplete list. */
export function useDataCollection(collection: string | null) {
  const { browser, owner } = useContext(EngineContext) ?? idleEngine;
  const [attempt, setAttempt] = useState(0);
  const identity = useMemo(() => ({ owner, browser, collection, attempt }), [owner, browser, collection, attempt]);
  const backgroundFailure = useBackgroundFailure(browser && owner && collection ? identity : null);
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
  return {
    state: copy ? copy.state : state,
    loading: waiting && !copy && !error,
    /** The rows are a copy for reading while the list's own storage is silent. */
    readOnly: Boolean(copy),
    error,
    refresh: async () => {
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
    },
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
    if (!current() || !targetForm) throw readOnly ? readOnlyRefusal(document.readOnlyReason ?? '') : new Error('The manual form is not ready');
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
  const proposals = useMemo(() => ({ identity, pending: new Set<AbortController>() }), [identity]);
  useEffect(() => () => { proposals.pending.forEach(controller => controller.abort()); }, [proposals]);
  const error = failure?.identity === identity ? say(failure.words) : readOnly ? document.readOnlyReason : document.error;
  return {
    readOnly,
    active: target?.state?.record.active ?? false,
    data: target?.state?.value ?? document.data,
    // The opening may include submitted predecessors; it is never a confirmed snapshot.
    openingData: target?.state?.openingValue ?? null,
    // This may be a previously saved intent, so it is deliberately not called confirmed.
    initialData: target?.state ? target.state.record.predecessor?.value ?? target.state.record.baseline.value : document.data,
    recoveryIdentity: identity as object,
    busy: working.identity === identity && working.count > 0,
    loading: document.loading || Boolean(hasResource && owner && !target && !error),
    durable: target?.state?.durable ?? true,
    dirty: target?.state?.dirty ?? false,
    status: describeManualSync(target?.state ?? null, document.state, document.status, error),
    error,
    begin,
    propose: (producer: (source: DocumentData) => Promise<DocumentData>) => {
      const controller = new AbortController(); proposals.pending.add(controller);
      return run(form => form.propose(producer, controller.signal)).finally(() => proposals.pending.delete(controller));
    },
    update: (updater: (draft: DocumentData) => DocumentData) => run(form => form.update(updater), false),
    save: (updater?: (draft: DocumentData) => DocumentData) => run(form => form.save(updater)),
    cancel: () => run(form => form.cancel()),
    keepLocal: () => run(form => form.resolve('local')),
    acceptRemote: () => run(form => form.resolve('remote')),
    retry: () => run(form => form.retry()),
    listRecoverable: async () => {
      // Over a copy for reading there is no form storage to search; the app-wide notice says why.
      if (readOnly) return [];
      if (!target || !current()) throw new Error(EDITOR_CHANGED);
      const records = await target.form.listRecoverable(); if (!current()) throw new Error(EDITOR_CHANGED); return records;
    },
    recover: (scopeId: string) => run(form => form.recover(scopeId)),
  };
}
