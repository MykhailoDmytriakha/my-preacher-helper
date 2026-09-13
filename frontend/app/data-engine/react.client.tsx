'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { newClientId } from '@/utils/clientId';

import { createBrowserDataEngine, type BrowserDataEngine } from './browser.client';
import { describeSync, type SyncStatus } from './status';

import type { CollectionState } from './collections';
import type { EditorState } from './controller';
import type { ManagedEditor, ManagedManualForm } from './engine';
import type { ManualPath } from './manualScope';
import type { DocumentData, ResourceRef } from './types';

interface EngineContextValue {
  browser: BrowserDataEngine | null;
  owner: string | null;
  error: string | null;
}
const EngineContext = createContext<EngineContextValue | null>(null);
const message = (error: unknown) => error instanceof Error ? error.message : 'Data engine failed';
const EDITOR_CHANGED = 'The active editor changed';

const listed = (value: string | undefined): string[] =>
  (value ?? '').split(',').map(entry => entry.trim()).filter(Boolean);

/**
 * A domain migrates as a whole, so activation is per collection. The older
 * all-or-nothing flag stays valid and means every collection.
 * Enable only with the coordinated server, legacy-writer and rules cutover.
 */
export function isCollectionOnEngine(collection: string): boolean {
  if (process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED === 'true') return true;
  return listed(process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS).includes(collection);
}

/** Whether the workspace needs a live engine at all: one migrated collection is enough. */
export function isDataEngineEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED === 'true'
    || listed(process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS).length > 0;
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
    return () => { active = false; cancellation.abort(); recovery?.reject(aborted()); stop?.(); editor?.dispose(); };
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
    return () => {
      active = false;
      clearTimeout(timer);
      if (saveTimer.current === timer) saveTimer.current = null;
    };
  }, [autoSave, autoSaveDelayMs, current?.editor, current?.state.checkpoint.editGeneration, current?.status.canSave, isCurrent, setError]);

  const manualEditor = current?.editor;
  const getManualForm = useCallback((formSlot: string, fields: readonly ManualPath[]) => {
    if (!manualEditor || !isCurrent()) throw new Error(EDITOR_CHANGED);
    return manualEditor.form(formSlot, fields);
  }, [manualEditor, isCurrent]);

  return {
    getManualForm,
    data: current?.state.checkpoint.draft ?? null,
    confirmed: current?.state.checkpoint.confirmed ?? null,
    remote: current?.state.checkpoint.remoteCandidate ?? null,
    state: current?.state ?? null,
    status: current?.status ?? null,
    loading: Boolean(resource && owner && !current && !error),
    error: error ?? engineError,
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
  const { browser, owner, error: engineError } = useDataEngine();
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
    loading: Boolean(owner && collection && !error && (!state || state.freshness === 'unknown')),
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
export function useDataForm(resource: ResourceRef | null, slot: string, selection: readonly ManualPath[]) {
  const { owner, browser } = useDataEngine();
  const document = useDataDocument(resource, { autoSave: false });
  const fieldsKey = JSON.stringify(selection);
  const fields = useMemo(() => JSON.parse(fieldsKey) as ManualPath[], [fieldsKey]);
  const key = JSON.stringify([resource?.collection, resource?.id, slot, fieldsKey]);
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
      const form = getManualForm(slot, fields);
      const update = () => { if (active && current()) setOpened({ identity, form, state: form.getState() }); };
      stop = form.subscribe(update); update();
    } catch (error) { if (current()) setFailure({ identity, message: message(error) }); }
    return () => { active = false; stop?.(); };
  }, [identity, owner, browser, hasResource, documentReady, getManualForm, slot, fields, current]);
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
  return {
    active: target?.state?.record.active ?? false,
    data: target?.state?.value ?? document.data,
    busy: working.identity === identity && working.count > 0,
    loading: document.loading,
    durable: target?.state?.durable ?? true,
    dirty: target?.state?.dirty ?? false,
    status: document.status,
    error: failure?.identity === identity ? failure.message : document.error,
    begin: () => run(form => form.begin()),
    update: (updater: (draft: DocumentData) => DocumentData) => run(form => form.update(updater), false),
    save: (updater?: (draft: DocumentData) => DocumentData) => run(form => form.save(updater)),
    cancel: () => run(form => form.cancel()),
    retry: () => run(form => form.retry()),
    listRecoverable: async () => { if (!target || !current()) throw new Error(EDITOR_CHANGED); const records = await target.form.listRecoverable(); if (!current()) throw new Error(EDITOR_CHANGED); return records; },
    recover: (scopeId: string) => run(form => form.recover(scopeId)),
  };
}
