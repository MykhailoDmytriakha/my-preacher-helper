'use client';

import { ManualScope, type ManualScopeRecord } from './manualScope';
import { equalValues } from './protocol';
import { collectCommitRows } from './retention.client';
import { createEngineStorageTransaction, engineOwnerRange, validateCommitReferences } from './storage.client';

import type { ResourceRef } from './types';

export interface StoredManualScope {
  owner: string;
  scopeId: string;
  parentEditorId: string;
  slot: string;
  record: ManualScopeRecord;
  commitReferences: string[];
}
export interface ManualScopeWatermark extends Omit<StoredManualScope, 'record'> {
  record: null;
  watermark: Pick<ManualScopeRecord, 'generation' | 'selection' | 'resource'>;
}
export type ManualStorageRecord = StoredManualScope | ManualScopeWatermark;
export interface ManualScopeStore {
  read(owner: string, scopeId: string): Promise<ManualStorageRecord | undefined>;
  list(owner: string, resource?: ResourceRef): Promise<StoredManualScope[]>;
  create(value: StoredManualScope): Promise<void>;
  put(value: StoredManualScope): Promise<void>;
  compact(owner: string, scopeId: string): Promise<void>;
}
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (owner: string, scopeId: string): IDBValidKey => ['manual', owner, scopeId];
function validate(value: ManualStorageRecord, owner = value.owner, scopeId = value.scopeId): ManualStorageRecord {
  if (!value.record) {
    if (value.owner !== owner || value.scopeId !== scopeId || !value.parentEditorId || !value.slot || value.commitReferences.length
      || !Number.isSafeInteger(value.watermark?.generation) || value.watermark.generation < 0
      || !value.watermark.resource?.collection || !value.watermark.resource.id || !Array.isArray(value.watermark.selection)) throw new Error('Invalid manual scope watermark');
    return copy(value);
  }
  if (value.owner !== owner || value.scopeId !== scopeId || value.record.owner !== owner || value.record.scopeId !== scopeId
    || !value.parentEditorId || !value.slot) throw new Error('Manual storage identity mismatch');
  const record = value.record;
  const references = record.predecessor ? [record.predecessor.id] : [];
  if (JSON.stringify(value.commitReferences) !== JSON.stringify(references)) throw new Error('Manual storage references mismatch');
  ManualScope.restore({ owner, scopeId, resource: record.resource, selection: record.selection, port: {
    capture: () => ({ checkpoint: { confirmed: record.baseline, draft: record.baseline.value, editGeneration: 0, dirty: false, pending: {}, conflicts: [], remoteCandidate: null }, provenance: [], requests: [] }),
    isCurrent: () => true, persist: async () => undefined, save: async () => { throw new Error('Validation cannot submit'); },
  } }, record);
  return copy(value);
}

/** Shares the commit database so a saved form cannot race collection of its predecessor. */
export function createIndexedDbManualScopes(): ManualScopeStore {
  const transaction = createEngineStorageTransaction();
  const write = async (value: StoredManualScope, create: boolean) => {
    const frozen = validate(value) as StoredManualScope;
    return transaction<void>('readwrite', (store, read, done) => {
      read(store.get(key(frozen.owner, frozen.scopeId)), (existing: ManualStorageRecord | undefined) => {
        if (create ? Boolean(existing) : !existing) throw new Error(create ? 'Manual scope already exists' : 'Manual scope no longer exists');
        if (existing && (existing.parentEditorId !== frozen.parentEditorId || existing.slot !== frozen.slot
          || JSON.stringify(existing.record ? existing.record.selection : existing.watermark.selection) !== JSON.stringify(frozen.record.selection))) throw new Error('Manual storage identity changed');
        validateCommitReferences(store, read, frozen.owner, frozen.commitReferences, () => { store.put(frozen, key(frozen.owner, frozen.scopeId)); collectCommitRows(store, read, frozen.owner, done); });
      });
    });
  };
  return {
    read: (owner, scopeId) => transaction('readonly', (store, read, done) => { read(store.get(key(owner, scopeId)), value => done(value ? validate(value, owner, scopeId) : undefined)); }),
    list: (owner, resource) => transaction('readonly', (store, read, done) => {
      read(store.getAll(engineOwnerRange('manual', owner)), (values: ManualStorageRecord[]) => {
        const valid = values.map(value => validate(value, owner)).filter((value): value is StoredManualScope => Boolean(value.record));
        done(valid.filter(value => !resource || value.record.resource.collection === resource.collection && value.record.resource.id === resource.id));
      });
    }),
    create: value => write(value, true),
    put: value => write(value, false),
    compact: (owner, scopeId) => transaction('readwrite', (store, read, done) => {
      read(store.get(key(owner, scopeId)), (value: ManualStorageRecord | undefined) => {
        if (!value) { done(undefined); return; }
        const existing = validate(value, owner, scopeId), record = existing.record;
        if (!record || record.active || !equalValues(record.stage, record.savedSelection)) { done(undefined); return; }
        const finish = () => {
          const compact: ManualScopeWatermark = { owner, scopeId, parentEditorId: existing.parentEditorId, slot: existing.slot,
            record: null, watermark: { generation: record.generation, selection: record.selection, resource: record.resource }, commitReferences: [] };
          store.put(compact, key(owner, scopeId)); collectCommitRows(store, read, owner, done);
        };
        if (!record.predecessor) { finish(); return; }
        read(store.get(['identity', owner, record.predecessor.id]), (requestKey: IDBValidKey | undefined) => {
          if (!requestKey) { done(undefined); return; }
          read(store.get(requestKey), (request: { state: string } | undefined) => { if (request?.state === 'acknowledged') finish(); else done(undefined); });
        });
      });
    }),
  };
}
