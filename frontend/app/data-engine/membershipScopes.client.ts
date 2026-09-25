'use client';

import { CREATION_SCOPE_PREFIX, validateMembershipScope, type MembershipScopeRecord } from './membershipScope';
import { equalValues } from './protocol';
import { collectCommitRows, commitCaptureKey } from './retention.client';
import { createEngineStorageTransaction, engineOwnerRange, validateCommitReferences } from './storage.client';

import type { CommitRequest } from './commits';

export interface MembershipScopeStore {
  read(owner: string, scopeId: string): Promise<MembershipScopeRecord | undefined>;
  list(owner: string): Promise<MembershipScopeRecord[]>;
  persist(record: MembershipScopeRecord, expectedRevision: number | null): Promise<MembershipScopeRecord>;
  compact(owner: string, scopeId: string): Promise<void>;
  completion(owner: string, scopeId: string): Promise<'acknowledged' | 'cancelled' | null>;
}
interface ScopeWatermark { owner: string; scopeId: string; revision: number; closed: true; outcome?: 'acknowledged' | 'cancelled' }
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (owner: string, id: string): IDBValidKey => [id.startsWith(CREATION_SCOPE_PREFIX) ? 'creation-scope' : 'membership-scope', owner, id];
const referenceKey = (owner: string, id: string): IDBValidKey => ['reference', owner, 'membership', id];
const live = (value: MembershipScopeRecord | ScopeWatermark): value is MembershipScopeRecord => !('closed' in value);
const references = (record: MembershipScopeRecord) => [...new Set([...record.pins.flatMap(pin => pin.predecessor ? [pin.predecessor.id] : []), ...record.requestIds])];

/** A separate stage range is invisible to ordinary editor recovery and older queues. */
export function createIndexedDbMembershipScopes(): MembershipScopeStore {
  const transaction = createEngineStorageTransaction();
  const validated = (record: MembershipScopeRecord, owner: string, scopeId = record.scopeId) => {
    validateMembershipScope(record);
    if (record.owner !== owner || record.scopeId !== scopeId) throw new Error('Membership storage ownership mismatch');
    return clone(record);
  };
  return {
    completion: (owner, scopeId) => transaction('readonly', (store, read, done) => read(store.get(key(owner, scopeId)), (value: MembershipScopeRecord | ScopeWatermark | undefined) => {
      done(value && !live(value) && value.owner === owner && value.scopeId === scopeId ? value.outcome ?? null : null);
    })),
    read: (owner, scopeId) => transaction('readonly', (store, read, done) => read(store.get(key(owner, scopeId)), (value: MembershipScopeRecord | ScopeWatermark | undefined) => {
      done(value && live(value) ? validated(value, owner, scopeId) : undefined);
    })),
    list: owner => transaction('readonly', (store, read, done) => {
      const records: MembershipScopeRecord[] = []; let remaining = 2;
      for (const kind of ['membership-scope', 'creation-scope']) read(store.getAll(engineOwnerRange(kind, owner)), (values: (MembershipScopeRecord | ScopeWatermark)[]) => {
        records.push(...values.filter(live).map(record => validated(record, owner)));
        if (!--remaining) done(records);
      });
    }),
    persist: async (record, expectedRevision) => {
      const frozen = validated(record, record.owner), refs = references(frozen);
      return transaction('readwrite', (store, read, done) => read(store.get(key(frozen.owner, frozen.scopeId)), (existing: MembershipScopeRecord | ScopeWatermark | undefined) => {
        if (expectedRevision === null ? Boolean(existing) : !existing || existing.revision !== expectedRevision || !live(existing)) throw new Error('Membership stage changed in another session');
        if (existing && live(existing)) {
          const openingCreationSeries = existing.phase === 'editing' && existing.creation?.seriesOpened === false && frozen.creation?.seriesOpened === true;
          if ((!openingCreationSeries && !equalValues(existing.pins, frozen.pins))
            || !equalValues(existing.creation?.resource, frozen.creation?.resource)
            || (existing.creation?.seriesOpened === true && frozen.creation?.seriesOpened !== true)
            || (existing.phase !== 'editing' && !equalValues(existing.creation, frozen.creation)) || existing.generation > frozen.generation
            || (existing.phase !== 'editing' && (!equalValues(existing.action, frozen.action) || existing.generation !== frozen.generation))
            || (existing.phase === 'saving' && !['saving', 'submitted'].includes(frozen.phase))
            || (existing.phase === 'submitted' && (frozen.phase !== 'submitted' || !equalValues(existing.requestIds, frozen.requestIds)))
            || (existing.phase === 'cancelled' && frozen.phase !== 'cancelled')) throw new Error('Frozen membership intent cannot change');
        }
        validateCommitReferences(store, read, frozen.owner, refs, () => {
          const saved = { ...frozen, revision: (expectedRevision ?? -1) + 1 };
          store.put(saved, key(saved.owner, saved.scopeId));
          // Existing retention (including old tabs) already honors the reference range.
          store.put({ commitReferences: refs }, referenceKey(saved.owner, saved.scopeId));
          // Transfer capture ownership to the stage in this same transaction.
          saved.requestIds.forEach(id => store.delete(commitCaptureKey(saved.owner, saved.scopeId, id)));
          done(saved);
        });
      }));
    },
    compact: (owner, scopeId) => transaction('readwrite', (store, read, done) => read(store.get(key(owner, scopeId)), (value: MembershipScopeRecord | ScopeWatermark | undefined) => {
      if (!value || !live(value) || !['cancelled', 'submitted'].includes(value.phase)) { done(undefined); return; }
      const record = validated(value, owner, scopeId);
      const finish = (outcome: 'acknowledged' | 'cancelled') => {
        store.put({ owner, scopeId, revision: record.revision + 1, closed: true, outcome }, key(owner, scopeId));
        store.delete(referenceKey(owner, scopeId)); collectCommitRows(store, read, owner, () => done(undefined));
      };
      if (!record.requestIds.length) { finish(record.phase === 'cancelled' ? 'cancelled' : 'acknowledged'); return; }
      let remaining = record.requestIds.length, settled = true;
      const outcomes = new Set<string>();
      for (const id of record.requestIds) read(store.get(['identity', owner, id]), (requestKey: IDBValidKey | undefined) => {
        if (!requestKey) throw new Error('Membership request evidence is missing');
        read(store.get(requestKey), (request: CommitRequest | undefined) => {
          if (!request || !['acknowledged', 'cancelled'].includes(request.state)) settled = false;
          if (request) outcomes.add(request.state);
          if (!--remaining) { if (settled && outcomes.size === 1) finish(outcomes.has('cancelled') ? 'cancelled' : 'acknowledged'); else done(undefined); }
        });
      });
    })),
  };
}
