'use client';

import { isRetirableOrdinaryEditor, RETIRABLE_EDITOR_PREFIX } from './editorIdentity';
import { awaitingManualReceipt, type ManualScopeRecord } from './manualScope';
import { createEngineStorageTransaction, engineOwnerRange, type StorageRead } from './storage.client';

import type { CommitRequest } from './commits';
import type { EditorRecord } from './controller';

export const COMMIT_ROW_KINDS = ['request', 'atomic-request', 'creation-request', 'council-carry-request',
  'analysis-reshape-request', 'ordered-delete-request', 'sermon-note-text-request'] as const;

type CommitRow = Pick<CommitRequest, 'owner' | 'editorId' | 'editGeneration' | 'atomic' | 'deleteAfter' | 'sermonNoteText'>;
function commitRowKind(request: CommitRow): typeof COMMIT_ROW_KINDS[number] {
  if (request.sermonNoteText) return 'sermon-note-text-request';
  if (request.deleteAfter !== undefined) return 'ordered-delete-request';
  switch (request.atomic?.kind) {
    case 'analysis-reshape': return 'analysis-reshape-request';
    case 'council-carry': return 'council-carry-request';
    case 'create-member': return 'creation-request';
    default: return request.atomic ? 'atomic-request' : 'request';
  }
}
export const commitRowKey = (request: CommitRow, kind: string = commitRowKind(request)): IDBValidKey =>
  [kind, request.owner, request.editorId, request.editGeneration];
export const activeOrdinaryEditorKey = (owner: string, editorId: string): IDBValidKey => ['ordinary-editor', owner, editorId];
export const commitGenerationKey = (request: Pick<CommitRequest, 'owner' | 'editorId'>): IDBValidKey => ['generation', request.owner, request.editorId];
export const commitProjectionKey = (owner: string, id: string): IDBValidKey => ['reference', owner, 'projection', id];
/** Separate from editor projection: even older checkpoint writers must retain uncached ACKs. */
export const commitSnapshotKey = (owner: string, id: string): IDBValidKey => ['reference', owner, 'accepted-cache', id];
export const commitCaptureKey = (owner: string, scopeId: string, id: string): IDBValidKey => ['reference', owner, 'capture', scopeId, id];
export const commitDependencyKey = (owner: string, id: string): IDBValidKey => ['reference', owner, 'dependency', id];

/** Each capability has its own range so older bundles cannot prepare unsupported participants. */
export function readCommitRows(store: IDBObjectStore, read: StorageRead, owner: string, done: (requests: CommitRequest[]) => void): void {
  const rows: CommitRequest[] = [];
  let remaining = COMMIT_ROW_KINDS.length;
  for (const kind of COMMIT_ROW_KINDS) read(store.getAll(engineOwnerRange(kind, owner)), values => {
    rows.push(...values as CommitRequest[]);
    if (!--remaining) done(rows);
  });
}

/** Read only the immutable request identities needed for one projection. */
export function readCommitIdentities(store: IDBObjectStore, read: StorageRead, owner: string, ids: readonly string[],
  done: (requests: Map<string, CommitRequest>) => void): void {
  const unique = [...new Set(ids)];
  const requests = new Map<string, CommitRequest>();
  let remaining = unique.length;
  if (!remaining) { done(requests); return; }
  const finish = () => { if (!--remaining) done(requests); };
  for (const id of unique) read(store.get(['identity', owner, id]), (key: IDBValidKey | undefined) => {
    if (!key) { finish(); return; }
    read(store.get(key), (request: CommitRequest | undefined) => {
      if (request?.owner === owner && request.id === id) requests.set(id, request);
      finish();
    });
  });
}

export function checkpointCommitReferences(record: unknown): string[] {
  // Prepared legacy commands belong to the older journal, not the request store.
  const value = record as Partial<EditorRecord> | undefined;
  const pending = checkpointPending(record);
  if (!pending) return [];
  return Object.keys(pending).filter(id => id !== value?.prepared?.operationId);
}

function checkpointPending(record: unknown) {
  const pending = (record as Partial<EditorRecord> | undefined)?.checkpoint?.pending;
  return typeof pending === 'object' && pending !== null && !Array.isArray(pending) ? pending : undefined;
}

function retainAtomicParticipants(requests: readonly CommitRequest[], references: Set<string>): void {
  // Keep a complete participant group while any side still needs delivery,
  // projection or recovery. Otherwise one editor could compact the other's ACK.
  let expanded: boolean;
  do {
    expanded = false;
    for (const request of requests) if (request.atomic && (references.has(request.id)
      || !['acknowledged', 'cancelled'].includes(request.state) || request.unfinalized.length)) {
      for (const id of request.atomic.participants) if (!references.has(id)) { references.add(id); expanded = true; }
    }
  } while (expanded);
}

/** Leave payload collection to an existing maintenance pass; keep all reference mutations immediate. */
export const deferCollection: typeof collectCommitRows = (_store, _read, _owner, finish) => finish();

/** Run in the same transaction as checkpoint/manual mutations: no recovery read can
 * introduce a dangling reference after this transaction has removed its payload. */
export function collectCommitRows(store: IDBObjectStore, read: StorageRead, owner: string, done: () => void): void {
  let requests: CommitRequest[] = [];
  const references = new Set<string>();
  const meetingStages = new Map<string, ManualScopeRecord>();
  let remaining = 4;
  const finish = () => {
    remaining -= 1;
    if (remaining) return;
    for (const request of requests) {
      if (!request.initialized && request.predecessor) references.add(request.predecessor);
      const stage = meetingStages.get(request.editorId);
      // The renderer can stop after queuing a Save and before recording its form receipt.
      if (stage && awaitingManualReceipt(stage, request)) references.add(request.id);
    }
    retainAtomicParticipants(requests, references);
    const watermarks = new Map<string, number>();
    for (const request of requests) {
      if (!['acknowledged', 'cancelled'].includes(request.state) || request.unfinalized.length || references.has(request.id)) continue;
      store.delete(commitRowKey(request));
      store.delete(commitDependencyKey(owner, request.id));
      store.delete(['identity', owner, request.id]);
      watermarks.set(request.editorId, Math.max(watermarks.get(request.editorId) ?? 0, request.editGeneration));
    }
    // One monotonic generation watermark per editor, rather than one row per Save.
    let pending = watermarks.size;
    if (!pending) { done(); return; }
    for (const [editorId, through] of watermarks) {
      const key = commitGenerationKey({ owner, editorId });
      const collected = () => { if (!--pending) done(); };
      const protect = () => read(store.get(key), (previous: { through: number } | undefined) => {
        store.put({ through: Math.max(previous?.through ?? 0, through) }, key);
        collected();
      });
      if (isRetirableOrdinaryEditor(editorId)) {
        read(store.get(activeOrdinaryEditorKey(owner, editorId)), active => {
          if (active) protect();
          else { store.delete(key); collected(); }
        });
      } else protect();
    }
  };
  readCommitRows(store, read, owner, values => { requests = values; finish(); });
  read(store.getAll(engineOwnerRange('checkpoint', owner)), (values: unknown[]) => {
    for (const record of values) for (const id of checkpointCommitReferences(record)) references.add(id);
    finish();
  });
  for (const kind of ['manual', 'reference']) {
    read(store.getAll(engineOwnerRange(kind, owner)), values => {
      for (const envelope of values as Array<{ commitReferences?: string[]; record?: ManualScopeRecord | null }>) {
        for (const id of envelope.commitReferences ?? []) references.add(id);
        if (kind === 'manual' && envelope.record?.active && envelope.record.autosaveGroupMeeting) {
          meetingStages.set(envelope.record.scopeId, envelope.record);
        }
      }
      finish();
    });
  }
}

// Give consecutive writes one sweep while keeping released payloads out of later queue reads.
const COLLECTION_BATCH_SIZE = 32;

/** Release exact references immediately. Batch their collection during delivery and sweep at its end.
 * A stopped page leaves the original durable rows behind. The next delivery pass collects those too.
 */
export function createCommitCollectionWindow() {
  const transaction = createEngineStorageTransaction();
  const passes = new Map<string, { count: number; writes: number }>();
  const collect: typeof collectCommitRows = (store, read, owner, done) => {
    const pass = passes.get(owner);
    if (pass) {
      pass.writes += 1;
      if (pass.writes < COLLECTION_BATCH_SIZE) { done(); return; }
      pass.writes = 0;
    }
    collectCommitRows(store, read, owner, done);
  };
  const begin = (owner: string) => {
    const pass = passes.get(owner) ?? { count: 0, writes: 0 };
    passes.set(owner, pass);
    pass.count += 1;
    return async () => {
      pass.count -= 1;
      if (pass.count) return;
      passes.delete(owner);
      await transaction<void>('readwrite', (store, read, done) => {
        const compact = () => collectCommitRows(store, read, owner, () => done(undefined));
        // An older page may have swept a request after its editor retired.
        const scope = ['generation', owner];
        const range = IDBKeyRange.bound([...scope, RETIRABLE_EDITOR_PREFIX], [...scope, RETIRABLE_EDITOR_PREFIX + '\uffff']);
        read(store.getAllKeys(range), keys => {
          const editors = keys.flatMap(key => Array.isArray(key) && typeof key[2] === 'string'
            && isRetirableOrdinaryEditor(key[2]) ? [key[2]] : []);
          let remaining = editors.length;
          if (!remaining) { compact(); return; }
          for (const editorId of editors) read(store.get(activeOrdinaryEditorKey(owner, editorId)), active => {
            if (!active) store.delete(commitGenerationKey({ owner, editorId }));
            if (!--remaining) compact();
          });
        });
      });
    };
  };
  return { collect, begin };
}
