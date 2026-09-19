'use client';

import { engineOwnerRange, type StorageRead } from './storage.client';

import type { CommitRequest } from './commits';
import type { EditorRecord } from './controller';

export const commitRowKey = (request: Pick<CommitRequest, 'owner' | 'editorId' | 'editGeneration' | 'atomic'>, kind = request.atomic ? 'atomic-request' : 'request'): IDBValidKey => [kind, request.owner, request.editorId, request.editGeneration];
export const commitGenerationKey = (request: Pick<CommitRequest, 'owner' | 'editorId'>): IDBValidKey => ['generation', request.owner, request.editorId];
export const commitProjectionKey = (owner: string, id: string): IDBValidKey => ['reference', owner, 'projection', id];
export const commitCaptureKey = (owner: string, scopeId: string, id: string): IDBValidKey => ['reference', owner, 'capture', scopeId, id];

/** Old bundles scan only `request`. They must never prepare atomic participants separately. */
export function readCommitRows(store: IDBObjectStore, read: StorageRead, owner: string, done: (requests: CommitRequest[]) => void): void {
  const rows: CommitRequest[] = [];
  let remaining = 2;
  for (const kind of ['request', 'atomic-request']) read(store.getAll(engineOwnerRange(kind, owner)), values => {
    rows.push(...values as CommitRequest[]);
    if (!--remaining) done(rows);
  });
}

export function checkpointCommitReferences(record: EditorRecord): string[] {
  // Prepared legacy commands belong to the older journal, not the request store.
  return Object.keys(record.checkpoint.pending).filter(id => id !== record.prepared?.operationId);
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

/** Run in the same transaction as checkpoint/manual mutations: no recovery read can
 * introduce a dangling reference after this transaction has removed its payload. */
export function collectCommitRows(store: IDBObjectStore, read: StorageRead, owner: string, done: () => void): void {
  let requests: CommitRequest[] = [];
  const references = new Set<string>();
  let remaining = 4;
  const finish = () => {
    remaining -= 1;
    if (remaining) return;
    for (const request of requests) {
      if (!request.initialized && request.predecessor) references.add(request.predecessor);
    }
    retainAtomicParticipants(requests, references);
    const watermarks = new Map<string, number>();
    for (const request of requests) {
      if (!['acknowledged', 'cancelled'].includes(request.state) || request.unfinalized.length || references.has(request.id)) continue;
      store.delete(commitRowKey(request));
      store.delete(['identity', owner, request.id]);
      watermarks.set(request.editorId, Math.max(watermarks.get(request.editorId) ?? 0, request.editGeneration));
    }
    // One monotonic generation watermark per editor, rather than one row per Save.
    let pending = watermarks.size;
    if (!pending) { done(); return; }
    for (const [editorId, through] of watermarks) {
      const key = commitGenerationKey({ owner, editorId });
      read(store.get(key), (previous: { through: number } | undefined) => {
        store.put({ through: Math.max(previous?.through ?? 0, through) }, key);
        pending -= 1;
        if (!pending) done();
      });
    }
  };
  readCommitRows(store, read, owner, values => { requests = values; finish(); });
  read(store.getAll(engineOwnerRange('checkpoint', owner)), values => {
    for (const record of values as EditorRecord[]) for (const id of checkpointCommitReferences(record)) references.add(id);
    finish();
  });
  for (const kind of ['manual', 'reference']) {
    read(store.getAll(engineOwnerRange(kind, owner)), values => {
      for (const record of values as Array<{ commitReferences?: string[] }>) for (const id of record.commitReferences ?? []) references.add(id);
      finish();
    });
  }
}
