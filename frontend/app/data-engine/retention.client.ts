'use client';

import { engineOwnerRange, type StorageRead } from './storage.client';

import type { CommitRequest } from './commits';
import type { EditorRecord } from './controller';

export const commitRowKey = (request: Pick<CommitRequest, 'owner' | 'editorId' | 'editGeneration'>): IDBValidKey => ['request', request.owner, request.editorId, request.editGeneration];
export const commitGenerationKey = (request: Pick<CommitRequest, 'owner' | 'editorId'>): IDBValidKey => ['generation', request.owner, request.editorId];
export const commitProjectionKey = (owner: string, id: string): IDBValidKey => ['reference', owner, 'projection', id];

export function checkpointCommitReferences(record: EditorRecord): string[] {
  // Prepared legacy commands belong to the older journal, not the request store.
  return Object.keys(record.checkpoint.pending).filter(id => id !== record.prepared?.operationId);
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
  read(store.getAll(engineOwnerRange('request', owner)), values => { requests = values as CommitRequest[]; finish(); });
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
