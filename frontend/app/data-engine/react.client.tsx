'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { newClientId } from '@/utils/clientId';

import { createBrowserDataEngine, type BrowserDataEngine } from './browser.client';
import { isCollectionOnEngine, isDataEngineEnabled } from './clientPolicy';
import { LegacyQueryCopies, LegacyQueryMigrationGate } from './LegacyQueryRecovery';
import { isEngineOwnedLegacyQuery } from './legacyQueryRecovery.client';
import { describeManualSync, describeSync, type SyncStatus } from './status';
import { useRecoveryDiscovery as useDiscovery, type RecoveryDiscoveryOptions } from './useRecoveryDiscovery';

import type { CollectionState } from './collections';
import type { EditorRecord, EditorState } from './controller';
import type { ManagedEditor, ManagedManualForm, ManualRecoveryPolicy } from './engine';
import type { ManualPath } from './manualScope';
import type { MembershipDelivery } from './membershipDelivery';
import type { MembershipAction } from './membershipIntent';
import type { MembershipScope } from './membershipScope';
import type { DocumentData, JournalEntry, ResourceRef } from './types';

export { isCollectionOnEngine, isDataEngineEnabled } from './clientPolicy';

interface EngineContextValue {
  browser: BrowserDataEngine | null;
  owner: string | null;
  error: string | null;
}
const EngineContext = createContext<EngineContextValue | null>(null);
const message = (error: unknown) => error instanceof Error ? error.message : 'Data engine failed';
const EDITOR_CHANGED = 'The active editor changed';

/** Public recovery UI seam; storage and owner fencing remain inside the engine. */
export function useRecoveryDiscovery<T>(options: RecoveryDiscoveryOptions<T>) {
  return useDiscovery(options);
}

/** Whether the persisted query cache may keep this query; engine-owned collections are session-only. */
export function shouldPersistLegacyQuery(queryKey: readonly unknown[]): boolean {
  return !isEngineOwnedLegacyQuery(queryKey, isCollectionOnEngine);
}

/** Preserve old cache copies before the query provider may hydrate, expire or replace them. */
export function DataEngineMigrationGate({ children }: { children: ReactNode }) {
  return (['councils', 'groups', 'series', 'sermons'].some(isCollectionOnEngine)) ? <LegacyQueryMigrationGate enabled={isCollectionOnEngine}>{children}</LegacyQueryMigrationGate> : <>{children}</>;
}

/** Archived cache copies are evidence for the person, never confirmed engine snapshots. */
export function LegacyDataRecoveryNotice() {
  const { user } = useAuth();
  return user?.uid && (['councils', 'groups', 'series', 'sermons'].some(isCollectionOnEngine)) ? <LegacyQueryCopies key={user.uid} owner={user.uid} /> : null;
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
  const [failure, setFailure] = useState<{ owner: string | null; message: string } | null>(null);
  useEffect(() => {
    let active = true;
    const instance = createBrowserDataEngine({ onError: error => { if (active) setFailure({ owner, message: message(error) }); } });
    instance.engine.setOwner(owner);
    setFailure(null);
    setMounted({ owner, browser: instance });
    return () => { active = false; instance.dispose(); };
  }, [owner]);
  const browser = mounted?.owner === owner ? mounted.browser : null;
  const error = failure?.owner === owner ? failure.message : null;
  const value = useMemo(() => ({ browser, owner, error }), [browser, owner, error]);
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
 * Whether a closed editor's checkpoint waits for the person: the server answered a request with
 * a conflict or a refusal, or an edited draft has nothing in flight. Queued work does not.
 */
export function waitsForDecision(record: EditorRecord, journal: readonly JournalEntry[]): boolean {
  const failed = new Set(journal.filter(entry => entry.state === 'refused' || entry.state === 'conflict').map(entry => entry.command.operationId));
  const pending = Object.keys(record.checkpoint.pending);
  return record.checkpoint.conflicts.length > 0 || pending.some(id => failed.has(id))
    || (record.checkpoint.dirty && pending.length === 0 && record.prepared === null);
}

export function useDocumentActions() {
  // Menus that offer these actions render in both deployments; without an engine they are not ready.
  const { browser, owner } = useContext(EngineContext) ?? idleEngine;
  const withEditor = useCallback(async (resource: ResourceRef, action: (editor: ManagedEditor) => Promise<void>, creating = false) => {
    if (!browser || !owner) throw new Error('The data engine is not ready');
    const editorId = browser.editorId(resource, 'action');
    const editor = await (creating ? browser.engine.createEditor(resource, editorId) : browser.engine.openEditor(resource, editorId));
    try { await action(editor); } finally { editor.close({ flush: false }); }
  }, [browser, owner]);
  return useMemo(() => ({
    ready: Boolean(browser && owner),
    /** A new document under a stable client ID; a retry with the same ID never creates a second one. */
    create: (resource: ResourceRef, value: DocumentData) => withEditor(resource, editor => editor.commit(() => value), true),
    commit: (resource: ResourceRef, updater: (current: DocumentData | null) => DocumentData | null) =>
      withEditor(resource, editor => editor.commit(updater)),
    remove: (resource: ResourceRef) => withEditor(resource, editor => editor.remove()),
    /**
     * Settle work the server did not accept as sent — a conflict or a refusal — on a document no
     * screen has open, ONCE PER DOCUMENT. One-shot saves made before an answer arrives form a
     * chain: each later checkpoint carries its ancestors' pending requests and a higher
     * `editGeneration`, so the tip holds the newest text. Keeping mine saves the tip and only the
     * tip; its ancestors, and everything on "theirs", are retired without saving. A refusal has
     * no stored version to accept, so "theirs" there returns the draft to the confirmed copy.
     * Nothing is touched unless the document really waits for a decision (a conflict, a refused
     * request, or an edited draft with nothing in flight): work merely queued offline is never
     * cancelled. Each editor is reopened under its own identity, so a settled checkpoint stops
     * being recoverable. Resolves to the number of settled checkpoints.
     */
    resolve: async (resource: ResourceRef, choice: 'mine' | 'theirs'): Promise<number> => {
      if (!browser || !owner) throw new Error('The data engine is not ready');
      const [records, journal] = await Promise.all([browser.engine.listRecoverable(resource), browser.engine.listPending()]);
      if (!records.some(({ record }) => waitsForDecision(record, journal))) return 0;
      const chain = [...records].sort((a, b) => b.record.checkpoint.editGeneration - a.record.checkpoint.editGeneration);
      let settled = 0;
      for (const [index, { record }] of chain.entries()) {
        const editor = await browser.engine.openEditor(resource, record.editorId);
        try {
          if (choice === 'mine' && index === 0) {
            await editor.keepLocal(); await editor.save();
          } else {
            await editor.acceptRemote();
            const { checkpoint } = editor.getState();
            if (checkpoint.dirty) await editor.edit(checkpoint.confirmed.value);
          }
          settled += 1;
        } finally { editor.close({ flush: false }); }
      }
      return settled;
    },
  }), [browser, owner, withEditor]);
}

/**
 * For readers that exist in both deployments. A document editor keeps the strict boundary — a
 * missing provider there is a mistake — but a collection read from a screen that also runs
 * without the engine is an absence of rows, not a programming error.
 */
const idleEngine: EngineContextValue = { browser: null, owner: null, error: null };

/** Explicit semantic actions over an engine-owned pinned stage; no feature queue or ancestry. */
export function useDataMembership() {
  const { browser, owner } = useContext(EngineContext) ?? idleEngine;
  const identity = useMemo(() => ({ browser, owner }), [browser, owner]);
  const latest = useRef<object>(identity); latest.current = identity;
  const current = useRef<{ identity: object; scope: MembershipScope; scopeId: string; stop: () => void } | null>(null);
  const opening = useRef<{ identity: object; promise: Promise<void> } | null>(null);
  const [stored, setStored] = useState<{ identity: object; state: ReturnType<MembershipScope['getState']> } | null>(null);
  const [failure, setFailure] = useState<{ identity: object; message: string } | null>(null);
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
        setDelivery(null); setFailure({ identity, message: message(error) });
      }
    });
  }, [browser, identity]);
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    active(); setFailure(null);
    try { const result = await action(); active(); refresh(); return result; }
    catch (error) { if (latest.current === identity) setFailure({ identity, message: message(error) }); throw error; }
  }, [active, identity, refresh]);
  const begin = useCallback((sourceId?: string, creation?: { collection: 'sermons' | 'groups'; value: DocumentData; requestedSeriesId?: string }): Promise<void> => {
    if (opening.current?.identity === identity) return opening.current.promise;
    if (current.current?.identity === identity) return Promise.reject(new Error('Close the current membership stage first'));
    const engine = active();
    const promise = run(async () => {
      const scope = sourceId ? await engine.recoverMembership(sourceId, { exclusive: true })
        : creation ? await engine.beginMemberCreation(creation.collection, creation.value, creation.requestedSeriesId) : await engine.beginMembership();
      if (latest.current !== identity) { engine.releaseMembership(scope.getState().record.scopeId); throw new Error(EDITOR_CHANGED); }
      current.current = { identity, scope, scopeId: scope.getState().record.scopeId, stop: scope.subscribe(refresh) }; refresh();
    });
    opening.current = { identity, promise };
    void promise.finally(() => { if (opening.current?.promise === promise) opening.current = null; }).catch(() => undefined);
    return promise;
  }, [active, identity, refresh, run]);
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
    ready: Boolean(browser && owner), error: failure?.identity === identity ? failure.message : null,
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
function useIsolatedDataDocument(resource: ResourceRef | null, { slot = 'default', create = false, autoSave = true, autoSaveDelayMs = 750 }: DocumentOptions = {}) {
  const { browser, owner, error: engineError } = useDataEngine();
  const collection = resource?.collection ?? null, id = resource?.id ?? null;
  const key = JSON.stringify([collection, id, slot, create]);
  const [opened, setOpened] = useState<OpenEditor | null>(null);
  const [attempt, setAttempt] = useState(0);
  const base = useMemo(() => ({ owner, key, browser }), [owner, key, browser]);
  const [selection, setSelection] = useState<RecoveryRequest | null>(null);
  const requestedRecovery = useRef<RecoveryRequest | null>(null);
  const recovery = selection?.base === base ? selection : null;
  const identity = useMemo(() => ({ base, attempt, recovery }), [base, attempt, recovery]);
  const [failure, setFailure] = useState<{ identity: object; message: string } | null>(null);
  const error = failure?.identity === identity ? failure.message : null;
  const setError = useCallback((value: string | null) => {
    setFailure(value === null ? null : { identity, message: value });
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
        } catch (failure) { setError(message(failure)); }
      };
      stop = value.subscribe(publish);
      publish();
      recovery?.resolve();
    }).catch(failure => { recovery?.reject(failure); if (active) setError(message(failure)); });
    // Leaving the screen is a moment to save, not to forget (BUG-20260919-engine-leaving-strands-last-edit):
    // with autosave, whatever the debounce had not sent yet becomes a durable request as the editor closes.
    return () => { active = false; cancellation.abort(); recovery?.reject(aborted()); stop?.(); editor?.close({ flush: autoSaveRef.current }); };
  }, [browser, owner, collection, id, slot, create, key, attempt, setError, identity, recovery]);

  // Owner and resource identity gate rendering before effect cleanup can run.
  const current = opened?.identity === identity ? opened : null;
  const isCurrent = useCallback(() => mounted.current && scope.current === identity, [identity]);
  const run = useCallback(async (action: (editor: ManagedEditor) => Promise<void>) => {
    if (!isCurrent()) throw new Error(EDITOR_CHANGED);
    if (!current) throw new Error('The editor is not ready');
    try {
      await action(current.editor);
      if (!isCurrent()) throw new Error(EDITOR_CHANGED);
      setError(null);
    } catch (failure) {
      if (isCurrent()) setError(message(failure));
      throw failure;
    }
  }, [current, isCurrent, setError]);
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
      void current.editor.save().catch(failure => { if (isCurrent()) setError(message(failure)); });
    }, delay);
    saveTimer.current = timer;
    // Hiding the page — another tab, another app, the iPad's home gesture — may be the last
    // moment this page runs. Save now instead of waiting out the delay.
    const saveNow = () => {
      if (!active || !isCurrent()) return;
      active = false;
      clearTimeout(timer);
      if (saveTimer.current === timer) saveTimer.current = null;
      void current.editor.save().catch(failure => { if (isCurrent()) setError(message(failure)); });
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
    if (!manualEditor || !isCurrent()) throw new Error(EDITOR_CHANGED);
    return manualEditor.form(formSlot, fields, recovery);
  }, [manualEditor, isCurrent]);

  return {
    getManualForm,
    recoveryIdentity: identity as object,
    data: current?.state.checkpoint.draft ?? null,
    confirmed: current?.state.checkpoint.confirmed ?? null,
    remote: current?.state.checkpoint.remoteCandidate ?? null,
    state: current?.state ?? null,
    status: current?.status ?? null,
    loading: Boolean(resource && owner && !current && !error),
    error: error ?? current?.state.error ?? engineError,
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
    acceptRemote: () => run(editor => editor.acceptRemote()),
    keepLocal: () => run(editor => editor.keepLocal()),
    listRecoverable: async () => {
      if (!isCurrent() || !browser || !owner || !collection || !id) throw new Error(EDITOR_CHANGED);
      try {
        const records = await browser.engine.listRecoverable({ collection, id });
        if (!isCurrent()) throw new Error(EDITOR_CHANGED);
        setError(null);
        return records;
      } catch (failure) { if (isCurrent()) setError(message(failure)); throw failure; }
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
  const { browser, owner, error: engineError } = useContext(EngineContext) ?? idleEngine;
  const [attempt, setAttempt] = useState(0);
  const identity = useMemo(() => ({ owner, browser, collection, attempt }), [owner, browser, collection, attempt]);
  const scope = useRef(identity); scope.current = identity;
  const subscription = useRef<{ identity: object; watching: boolean } | null>(null);
  const mounted = useRef(false);
  const [observed, setObserved] = useState<{ identity: object; state: CollectionState } | null>(null);
  const [failure, setFailure] = useState<{ identity: object; message: string } | null>(null);
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
    } catch (error) { if (current()) setFailure({ identity, message: message(error) }); }
    return () => { active = false; stop?.(); };
  }, [browser, owner, collection, identity, current]);
  const state = observed?.identity === identity ? observed.state : null;
  const error = (failure?.identity === identity ? failure.message : null) ?? state?.error ?? engineError;
  return {
    state,
    loading: Boolean(owner && collection && !error && (!state || (state.freshness === 'unknown' && !state.documents?.some(document => document.value !== null)))),
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
        if (current()) setFailure({ identity, message: message(error) });
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
  const [failure, setFailure] = useState<{ identity: object; message: string } | null>(null);
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
    } catch (error) { if (current()) setFailure({ identity, message: message(error) }); }
    return () => { active = false; stop?.(); };
  }, [identity, owner, browser, hasResource, documentReady, getManualForm, slot, fields, recovery, current]);
  const target = opened?.identity === identity ? opened : null;
  const targetForm = target?.form;
  const run = useCallback(async (action: (form: ManagedManualForm) => Promise<void>, busy = true) => {
    if (!current() || !targetForm) throw new Error('The manual form is not ready');
    if (busy) setWorking(value => ({ identity, count: value.identity === identity ? value.count + 1 : 1 }));
    try {
      await action(targetForm);
      if (!current()) throw new Error(EDITOR_CHANGED);
      setFailure(null);
    } catch (error) {
      if (current()) setFailure({ identity, message: message(error) });
      throw error;
    } finally {
      if (busy && current()) setWorking(value => ({ identity, count: Math.max(0, value.identity === identity ? value.count - 1 : 0) }));
    }
  }, [targetForm, current, identity]);
  const begin = useCallback(() => run(form => form.begin()), [run]);
  const proposals = useMemo(() => ({ identity, pending: new Set<AbortController>() }), [identity]);
  useEffect(() => () => { proposals.pending.forEach(controller => controller.abort()); }, [proposals]);
  const error = failure?.identity === identity ? failure.message : document.error;
  return {
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
    listRecoverable: async () => { if (!target || !current()) throw new Error(EDITOR_CHANGED); const records = await target.form.listRecoverable(); if (!current()) throw new Error(EDITOR_CHANGED); return records; },
    recover: (scopeId: string) => run(form => form.recover(scopeId)),
  };
}
