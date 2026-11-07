'use client';

import { isDocumentEditor, manualChoiceRecoveryIdentity, manualScopeIdentity, readManualScopeIdentity } from './editorIdentity';
import { replaySavedChoiceDelta } from './manualChoice';
import { retireManualRecoverySources } from './manualRecovery.client';
import { storedManualContinuation } from './manualReturnSources';
import { ManualScope, retainedManualScopeRecord, sameManualSelection, type ManualScopeRecord } from './manualScope';
import { equalValues } from './protocol';
import { changedRecoveryChoice, discardRecoveryRecord } from './recoveryDiscard.client';
import { pinRecoveryVersion, versionRecoveryRecord } from './recoverySource.client';
import { collectCommitRows } from './retention.client';
import { createEngineStorageTransaction, engineOwnerRange, validateCommitReferences, type StorageRead } from './storage.client';

import type { CommitRequest, ManualChoiceRecovery } from './commits';
import type { VersionedRecovery } from './recoverySource';
import type { DocumentData, ResourceRef } from './types';

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

/** Replay only the later captured changes to see what this branch still owes to the form. */
function branchWithoutForm(byId: ReadonlyMap<string, CommitRequest>, predecessor: CommitRequest,
  form: CommitRequest, tip: CommitRequest): { value: DocumentData; formRequests: CommitRequest[] } | null {
  const suffix: CommitRequest[] = [];
  const seen = new Set<string>();
  let current: CommitRequest | undefined = tip;
  while (current && current.id !== form.id && !seen.has(current.id)) {
    suffix.push(current);
    seen.add(current.id);
    current = current.predecessor ? byId.get(current.predecessor) : undefined;
  }
  if (current?.id !== form.id) return null;
  let value = predecessor.value;
  let before = form.value;
  const formRequests = [form];
  for (const request of suffix.reverse()) {
    if (request.editorId === form.editorId) formRequests.push(request);
    else value = replaySavedChoiceDelta(form.baseline.resource, before, request.value, value);
    before = request.value;
  }
  return value && { value, formRequests };
}

/** Retain exact form Saves in the same transaction that retires their blocked requests. */
export function writeManualChoiceRecoveries(store: IDBObjectStore, read: StorageRead, owner: string,
  recoveries: readonly ManualChoiceRecovery[], before: readonly CommitRequest[], retired: readonly CommitRequest[], done: () => void): void {
  const byId = new Map(retired.map(request => [request.id, request]));
  const written = new Map<string, ManualScopeRecord['stage'][]>();
  const changed = () => Object.assign(new Error('The saved form changed'), { code: 'decision-changed' });
  const next = (index: number): void => {
    if (index === recoveries.length) { done(); return; }
    const { rootId, requestIds, tipId, stored } = recoveries[index];
    const root = byId.get(rootId), request = byId.get(requestIds[0]), tip = byId.get(tipId);
    const predecessor = request?.predecessor ? byId.get(request.predecessor) : undefined;
    const identity = request && readManualScopeIdentity(request.editorId);
    if (!root?.cancelledByChoice || !request?.retainedAfterChoice || !tip?.retainedAfterChoice
      || !predecessor?.value || !request.value || !tip.value || !stored.value
      || [root, predecessor, request, tip].some(row => row.owner !== owner || !equalValues(row.baseline.resource, stored.resource))
      || !identity || !isDocumentEditor(identity.parentEditorId, stored.resource)) throw changed();
    const base = predecessor.value, saved = tip.value, accepted = stored.value;
    const branch = branchWithoutForm(byId, predecessor, request, tip);
    if (!branch || !equalValues(requestIds, branch.formRequests.map(row => row.id))) throw changed();
    const without = branch.value;
    read(store.get(key(owner, request.editorId)), (source: ManualStorageRecord | undefined) => {
      const original = source && validate(source, owner, request.editorId);
      if (!original?.record) throw changed();
      let proved: ManualScopeRecord | undefined;
      for (const saved of branch.formRequests) {
        const prior = saved.predecessor ? byId.get(saved.predecessor) : undefined;
        proved = prior && saved.retainedAfterChoice ? storedManualContinuation(original, prior, saved, before) : undefined;
        if (!proved) throw changed();
      }
      if (!proved?.predecessor) throw changed();
      if (!equalValues(original.record, proved)) {
        // A capture can survive the tab that was writing its separate form receipt. Record that
        // receipt before retiring the capture, while keeping any later private stage it proved.
        const repaired = validate({ ...original, record: proved, commitReferences: [proved.predecessor.id] });
        store.put(versionRecoveryRecord(repaired), key(owner, request.editorId));
      }
      if (proved.selection.every(path => sameManualSelection(without, saved, path))) { next(index + 1); return; }
      const draft = replaySavedChoiceDelta(stored.resource, without, saved, accepted);
      const fallback = replaySavedChoiceDelta(stored.resource, without, saved, base);
      if (!draft || !fallback) throw changed();
      const latestFormId = requestIds[requestIds.length - 1];
      const recoveryId = tipId === latestFormId ? latestFormId : JSON.stringify([latestFormId, tipId]);
      const scopeId = manualScopeIdentity(identity.parentEditorId, identity.slot, manualChoiceRecoveryIdentity(rootId, recoveryId));
      // A coincident stored value can still be changed by the kept root. Use the actual
      // capture predecessor as ancestry when the form needs to retain that same value.
      const record = retainedManualScopeRecord(proved, scopeId, stored, draft)
        ?? retainedManualScopeRecord(proved, scopeId, stored, fallback, {
          id: predecessor.id, owner, resource: stored.resource, value: base, predecessorId: predecessor.predecessor,
        });
      if (!record) throw changed();
      const stages = written.get(request.editorId) ?? [];
      if (stages.some(stage => equalValues(stage, record.stage))) { next(index + 1); return; }
      written.set(request.editorId, [...stages, record.stage]);
      read(store.get(key(owner, scopeId)), current => {
        if (current) throw changed();
        const commitReferences = record.predecessor ? [record.predecessor.id] : [];
        const value = validate({ owner, scopeId, ...identity, record, commitReferences });
        validateCommitReferences(store, read, owner, commitReferences, () => {
          store.put(versionRecoveryRecord(value), key(owner, scopeId));
          next(index + 1);
        });
      });
    });
  };
  next(0);
}

/** Shares the commit database so a saved form cannot race collection of its predecessor. */
export function createIndexedDbManualScopes(collect = collectCommitRows): ManualScopeStore {
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
            retireManualRecoverySources(store, read, frozen, validate, () => collect(store, read, frozen.owner, done));
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
        const sweep = () => collect(store, read, owner, done);
        retireManualRecoverySources(store, read, existing as StoredManualScope, validate, () => {
          if (record.active || !equalValues(record.stage, record.savedSelection)) { sweep(); return; }
          const finish = () => {
            const compact: ManualScopeWatermark = { owner, scopeId, parentEditorId: existing.parentEditorId, slot: existing.slot,
              record: null, watermark: { generation: record.generation, selection: record.selection, resource: record.resource }, commitReferences: [] };
            store.put(versionRecoveryRecord(compact), key(owner, scopeId)); sweep();
          };
          if (!record.predecessor) { finish(); return; }
          read(store.get(['identity', owner, record.predecessor.id]), (requestKey: IDBValidKey | undefined) => {
            if (!requestKey) { sweep(); return; }
            read(store.get(requestKey), (request: { state: string } | undefined) => { if (request && ['acknowledged', 'cancelled'].includes(request.state)) finish(); else sweep(); });
          });
        });
      });
    }),
  };
}
