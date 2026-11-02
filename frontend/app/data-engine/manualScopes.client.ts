'use client';

import { retireManualRecoverySources } from './manualRecovery.client';
import { ManualScope, type ManualScopeRecord } from './manualScope';
import { equalValues } from './protocol';
import { changedRecoveryChoice, discardRecoveryRecord } from './recoveryDiscard.client';
import { pinRecoveryVersion, versionRecoveryRecord } from './recoverySource.client';
import { collectCommitRows } from './retention.client';
import { createEngineStorageTransaction, engineOwnerRange, validateCommitReferences } from './storage.client';

import type { VersionedRecovery } from './recoverySource';
import type { ResourceRef } from './types';

export interface StoredManualScope extends VersionedRecovery {
  owner: string;
  scopeId: string;
  parentEditorId: string;
  slot: string;
  record: ManualScopeRecord;
  commitReferences: string[];
}
export interface ManualScopeWatermark extends Omit<StoredManualScope, 'record'> {
  record: null;
  /** An explicit removal cannot be reopened by a delayed writer of this identity. */
  discarded?: true;
  watermark: Pick<ManualScopeRecord, 'generation' | 'selection' | 'resource'>;
}
export type ManualStorageRecord = StoredManualScope | ManualScopeWatermark;
export interface ManualScopeStore {
  read(owner: string, scopeId: string): Promise<ManualStorageRecord | undefined>;
  list(owner: string, resource?: ResourceRef): Promise<StoredManualScope[]>;
  create(value: StoredManualScope): Promise<void>;
  put(value: StoredManualScope): Promise<void>;
  compact(owner: string, scopeId: string): Promise<void>;
  discardRecovery?(value: StoredManualScope, isCurrent: () => boolean): Promise<void>;
  pinRecovery?(value: StoredManualScope): Promise<string | null>;
}
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (owner: string, scopeId: string): IDBValidKey => ['manual', owner, scopeId];
function validate(value: ManualStorageRecord, owner = value.owner, scopeId = value.scopeId): ManualStorageRecord {
  if (value.recoveryVersion !== undefined && (typeof value.recoveryVersion !== 'string' || !value.recoveryVersion)) throw new Error('Invalid manual storage version');
  if (!value.record) {
    if (value.owner !== owner || value.scopeId !== scopeId || !value.parentEditorId || !value.slot || value.commitReferences.length
      || !Number.isSafeInteger(value.watermark?.generation) || value.watermark.generation < 0
      || !value.watermark.resource?.collection || !value.watermark.resource.id || !Array.isArray(value.watermark.selection)) throw new Error('Invalid manual scope watermark');
    if (value.discarded !== undefined && value.discarded !== true) throw new Error('Invalid discarded manual watermark');
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
        if (existing && !existing.record && existing.discarded) throw changedRecoveryChoice();
        if (existing && (existing.parentEditorId !== frozen.parentEditorId || existing.slot !== frozen.slot
          || JSON.stringify(existing.record ? existing.record.selection : existing.watermark.selection) !== JSON.stringify(frozen.record.selection))) throw new Error('Manual storage identity changed');
        validateCommitReferences(store, read, frozen.owner, frozen.commitReferences, () => {
          const writeTarget = () => {
            store.put(versionRecoveryRecord(frozen), key(frozen.owner, frozen.scopeId));
            retireManualRecoverySources(store, read, frozen, validate, () => collectCommitRows(store, read, frozen.owner, done));
          };
          // A follow/restart may drop an acknowledged predecessor. Settle its existing proof
          // before replacing that row and releasing the reference that proves the ACK.
          if (existing?.record) retireManualRecoverySources(store, read, validate(existing) as StoredManualScope, validate, writeTarget);
          else writeTarget();
        });
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
    discardRecovery: (value, isCurrent) => discardRecoveryRecord<StoredManualScope>(transaction, {
      owner: value.owner, key: key(value.owner, value.scopeId), expected: value,
      validate: candidate => {
        const current = validate(candidate as ManualStorageRecord, value.owner, value.scopeId);
        if (!current.record || current.parentEditorId !== value.parentEditorId || current.slot !== value.slot
          || !equalValues(current.record.resource, value.record.resource)
          || !equalValues(current.record.selection, value.record.selection)) throw changedRecoveryChoice();
        return current as StoredManualScope;
      }, version: current => current.recoveryVersion, references: current => current.commitReferences,
      scopeId: value.scopeId, canRemove: () => true, isCurrent,
      remove: (store, current) => {
        const watermark: ManualScopeWatermark = { owner: current.owner, scopeId: current.scopeId,
          parentEditorId: current.parentEditorId, slot: current.slot, record: null, discarded: true, commitReferences: [],
          watermark: { generation: current.record.generation, selection: current.record.selection, resource: current.record.resource } };
        store.put(versionRecoveryRecord(watermark), key(current.owner, current.scopeId));
      },
    }),
    create: value => write(value, true),
    pinRecovery: value => pinRecoveryVersion(transaction, key(value.owner, value.scopeId), value,
      candidate => validate(candidate as ManualStorageRecord, value.owner, value.scopeId) as StoredManualScope),
    put: value => write(value, false),
    compact: (owner, scopeId) => transaction('readwrite', (store, read, done) => {
      read(store.get(key(owner, scopeId)), (value: ManualStorageRecord | undefined) => {
        if (!value) { done(undefined); return; }
        const existing = validate(value, owner, scopeId), record = existing.record;
        if (!record) { done(undefined); return; }
        const collect = () => collectCommitRows(store, read, owner, done);
        retireManualRecoverySources(store, read, existing as StoredManualScope, validate, () => {
          if (record.active || !equalValues(record.stage, record.savedSelection)) { collect(); return; }
          const finish = () => {
            const compact: ManualScopeWatermark = { owner, scopeId, parentEditorId: existing.parentEditorId, slot: existing.slot,
              record: null, watermark: { generation: record.generation, selection: record.selection, resource: record.resource }, commitReferences: [] };
            store.put(versionRecoveryRecord(compact), key(owner, scopeId)); collect();
          };
          if (!record.predecessor) { finish(); return; }
          read(store.get(['identity', owner, record.predecessor.id]), (requestKey: IDBValidKey | undefined) => {
            if (!requestKey) { collect(); return; }
            read(store.get(requestKey), (request: { state: string } | undefined) => { if (request && ['acknowledged', 'cancelled'].includes(request.state)) finish(); else collect(); });
          });
        });
      });
    }),
  };
}
