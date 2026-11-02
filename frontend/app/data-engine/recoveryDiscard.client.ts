'use client';

import { equalValues, isValidIdentifier } from './protocol';
import { collectCommitRows, readCommitRows } from './retention.client';
import { snapshotBelongsToOwner } from './snapshotIdentity';
import { snapshotSchema } from './transport.client';

import type { CommitRequest } from './commits';
import type { VersionedRecovery } from './recoverySource';
import type { StorageTransaction } from './storage.client';
import type { ResourceRef } from './types';

export const changedRecoveryChoice = () => Object.assign(new Error('The selected saved draft changed'), { code: 'decision-changed' });
const pendingDelivery = () => Object.assign(new Error('Resolve the saved request before removing this draft'), { code: 'pending-delivery-first' });
function ownedSnapshot(value: unknown, owner: string, resource?: ResourceRef): boolean {
  const snapshot = snapshotSchema.parse(value);
  return snapshotBelongsToOwner(owner, snapshot) && (!resource || equalValues(snapshot.resource, resource));
}
function validRequestIdentity(request: CommitRequest, owner: string): boolean {
  return request.owner === owner && isValidIdentifier(request.id) && typeof request.editorId === 'string' && Boolean(request.editorId)
    && [request.editGeneration, request.revision, request.sequence].every(value => Number.isSafeInteger(value) && value >= 0)
    && typeof request.initialized === 'boolean' && (request.predecessor === null || isValidIdentifier(request.predecessor))
    && Array.isArray(request.unfinalized) && request.unfinalized.length === 0;
}
function settled(request: CommitRequest, owner: string): boolean {
  try {
    if (!validRequestIdentity(request, owner) || !ownedSnapshot(request.baseline, owner)
      || !ownedSnapshot(request.working, owner, request.baseline.resource)
      || !ownedSnapshot({ resource: request.baseline.resource, value: request.value, metadata: null }, owner)) return false;
    if (request.state === 'cancelled') return true;
    return request.state === 'acknowledged' && request.result?.kind === 'acknowledged' && request.result.operationId === request.id
      && ownedSnapshot(request.result.snapshot, owner, request.baseline.resource);
  } catch { return false; }
}

interface RecoveryDiscard<T> {
  owner: string;
  key: IDBValidKey;
  expected: T;
  validate(value: unknown): T;
  /** Legacy records have no opaque version, so their whole validated value must match. */
  version?(value: T): VersionedRecovery['recoveryVersion'];
  references(value: T): readonly string[];
  scopeId: string;
  canRemove(value: T): boolean;
  isCurrent(): boolean;
  remove(store: IDBObjectStore, value: T): void;
}

/** Exact selected-copy removal, request evidence and existing retention share one transaction. */
export function discardRecoveryRecord<T>(transaction: StorageTransaction, choice: RecoveryDiscard<T>): Promise<void> {
  const expected = choice.validate(choice.expected);
  return transaction('readwrite', (store, read, done) => {
    read(store.get(choice.key), value => {
      if (!value || !choice.isCurrent()) throw changedRecoveryChoice();
      const current = choice.validate(value), version = choice.version?.(expected);
      if (version ? choice.version?.(current) !== version : !equalValues(current, expected)) throw changedRecoveryChoice();
      if (!choice.canRemove(current)) throw pendingDelivery();
      readCommitRows(store, read, choice.owner, requests => {
        const references = [...new Set(choice.references(current))];
        // A captured Save may precede its checkpoint projection; it is still protected work.
        const attributed = requests.filter(request => request.editorId === choice.scopeId);
        if (references.some(id => !requests.some(request => request.id === id && request.owner === choice.owner && settled(request, choice.owner)))
          || attributed.some(request => request.owner !== choice.owner || !settled(request, choice.owner))) throw pendingDelivery();
        if (!choice.isCurrent()) throw changedRecoveryChoice();
        choice.remove(store, current);
        collectCommitRows(store, read, choice.owner, () => done(undefined));
      });
    });
  });
}
