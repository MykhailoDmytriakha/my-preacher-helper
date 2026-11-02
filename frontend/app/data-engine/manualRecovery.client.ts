'use client';

import { equalValues } from './protocol';
import { recoveryOrigins } from './recoverySource';
import { retireRecoveryVersions } from './recoverySource.client';

import type { CommitRequest } from './commits';
import type { ManualStorageRecord, StoredManualScope } from './manualScopes.client';
import type { StorageRead } from './storage.client';

/** A recovered form's new Save must be acknowledged before its captured sources can retire. */
export function retireManualRecoverySources(store: IDBObjectStore, read: StorageRead, value: StoredManualScope,
  validate: (value: ManualStorageRecord, owner: string, scopeId: string) => ManualStorageRecord, done: () => void): void {
  const record = value.record, requestId = record.recoverySavedRequestId;
  const sources = recoveryOrigins(record.recoveryOrigins);
  if (!sources.length || !requestId || requestId !== record.predecessor?.id) { done(); return; }
  read(store.get(['identity', value.owner, requestId]), (requestKey: IDBValidKey | undefined) => {
    if (!requestKey) { done(); return; }
    read(store.get(requestKey), (request: CommitRequest | undefined) => {
      const result = request?.result;
      if (!request || request.id !== requestId || request.owner !== value.owner || request.editorId !== value.scopeId
        || !equalValues(request.baseline.resource, record.resource) || !equalValues(request.value, record.predecessor!.value)
        || request.state !== 'acknowledged' || result?.kind !== 'acknowledged' || result.operationId !== requestId
        || !equalValues(result.snapshot.resource, record.resource)) { done(); return; }
      retireRecoveryVersions(store, read, sources, scopeId => scopeId === value.scopeId ? null : {
        key: ['manual', value.owner, scopeId],
        owns: candidate => {
          const source = validate(candidate as ManualStorageRecord, value.owner, scopeId);
          return Boolean(source.record && equalValues(source.record.resource, record.resource)
            && equalValues(source.record.selection, record.selection));
        },
      }, done);
    });
  });
}
