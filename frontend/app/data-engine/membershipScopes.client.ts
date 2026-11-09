'use client';

import { CREATION_SCOPE_PREFIX, validateMembershipScope, type MembershipSaveReceipt, type MembershipScopeRecord } from './membershipScope';
import { equalValues } from './protocol';
import { discardRecoveryRecord } from './recoveryDiscard.client';
import { collectCommitRows, commitCaptureKey } from './retention.client';
import { createEngineStorageTransaction, engineOwnerRange, validateCommitReferences } from './storage.client';

import type { CommitRequest } from './commits';

export interface MembershipScopeStore {
  read(owner: string, scopeId: string): Promise<MembershipScopeRecord | undefined>;
  list(owner: string): Promise<MembershipScopeRecord[]>;
  persist(record: MembershipScopeRecord, expectedRevision: number | null): Promise<MembershipScopeRecord>;
  compact(owner: string, scopeId: string): Promise<void>;
  discardRecovery?(record: MembershipScopeRecord, isCurrent: () => boolean): Promise<void>;
  completion(owner: string, scopeId: string): Promise<'acknowledged' | 'cancelled' | null>;
  readSaveReceipt(record: MembershipScopeRecord, editingRevision?: number | null): Promise<MembershipSaveReceipt | null>;
}
type ScopeRow = MembershipScopeRecord & { frozenFrom?: number };
interface ScopeWatermark {
  owner: string; scopeId: string; revision: number; closed: true; outcome?: 'acknowledged' | 'cancelled';
  save?: Pick<MembershipScopeRecord, 'generation' | 'requestIds' | 'seriesMembershipTime'> & { frozenFrom?: number };
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (owner: string, id: string): IDBValidKey => [id.startsWith(CREATION_SCOPE_PREFIX) ? 'creation-scope' : 'membership-scope', owner, id];
const referenceKey = (owner: string, id: string): IDBValidKey => ['reference', owner, 'membership', id];
const live = (value: ScopeRow | ScopeWatermark): value is ScopeRow => !('closed' in value);
const stage = ({ frozenFrom: _frozenFrom, ...record }: ScopeRow): MembershipScopeRecord => record;
function sameSave(current: ScopeRow, attempted: MembershipScopeRecord): boolean {
  // Two copies may press Save on the same editing revision at different times.
  // The one that freezes storage first owns the time of that shared capture.
  const { seriesMembershipTime: _currentTime, ...saved } = stage(current);
  const { seriesMembershipTime: _attemptedTime, ...next } = attempted;
  return equalValues(saved, { ...next, phase: current.phase, revision: current.revision, requestIds: current.requestIds });
}
const changedStage = () => Object.assign(new Error('Membership stage changed in another session'), { code: 'membership-stage-changed' });
const references = (record: MembershipScopeRecord) => [...new Set([...record.pins.flatMap(pin => pin.predecessor ? [pin.predecessor.id] : []), ...record.requestIds])];

/** A separate stage range is invisible to ordinary editor recovery and older queues. */
export function createIndexedDbMembershipScopes(): MembershipScopeStore {
  const transaction = createEngineStorageTransaction();
  const validated = (row: ScopeRow, owner: string, scopeId = row.scopeId) => {
    const record = stage(row);
    validateMembershipScope(record);
    if (record.owner !== owner || record.scopeId !== scopeId) throw new Error('Membership storage ownership mismatch');
    return clone(record);
  };
  return {
    discardRecovery: (record, isCurrent) => discardRecoveryRecord<MembershipScopeRecord>(transaction, {
      owner: record.owner, key: key(record.owner, record.scopeId), expected: record,
      validate: candidate => validated(candidate as MembershipScopeRecord, record.owner, record.scopeId),
      references, scopeId: record.scopeId, canRemove: current => current.phase === 'editing' && current.requestIds.length === 0,
      isCurrent, remove: (store, current) => {
        store.put({ owner: current.owner, scopeId: current.scopeId, revision: current.revision + 1, closed: true,
          outcome: 'cancelled' } satisfies ScopeWatermark, key(current.owner, current.scopeId));
        store.delete(referenceKey(current.owner, current.scopeId));
      },
    }),
    completion: (owner, scopeId) => transaction('readonly', (store, read, done) => read(store.get(key(owner, scopeId)), (value: ScopeRow | ScopeWatermark | undefined) => {
      done(value && !live(value) && value.owner === owner && value.scopeId === scopeId ? value.outcome ?? null : null);
    })),
    // A live row can prove the exact intent. After compaction an unfrozen caller
    // must prove it started with the same durable editing revision as the winner.
    readSaveReceipt: (record, editingRevision) => transaction('readonly', (store, read, done) => {
      read(store.get(key(record.owner, record.scopeId)), (current: ScopeRow | ScopeWatermark | undefined) => {
        if (!current || current.owner !== record.owner || current.scopeId !== record.scopeId || current.revision <= record.revision
          || (record.phase !== 'saving' && record.phase !== 'submitted')) { done(null); return; }
        const saved = live(current)
          ? current.phase === 'submitted' && sameSave(current, record) ? current : undefined
          : current.outcome === 'acknowledged'
            && (editingRevision === undefined || (editingRevision !== null && current.save?.frozenFrom === editingRevision)) ? current.save : undefined;
        if (!saved || saved.generation !== record.generation
          || (record.phase === 'submitted' && !equalValues(saved.requestIds, record.requestIds))) { done(null); return; }
        done({ revision: current.revision, requestIds: [...saved.requestIds],
          ...(saved.seriesMembershipTime !== undefined ? { seriesMembershipTime: saved.seriesMembershipTime } : {}) });
      });
    }),
    read: (owner, scopeId) => transaction('readonly', (store, read, done) => read(store.get(key(owner, scopeId)), (value: ScopeRow | ScopeWatermark | undefined) => {
      done(value && live(value) ? validated(value, owner, scopeId) : undefined);
    })),
    list: owner => transaction('readonly', (store, read, done) => {
      const records: MembershipScopeRecord[] = []; let remaining = 2;
      for (const kind of ['membership-scope', 'creation-scope']) read(store.getAll(engineOwnerRange(kind, owner)), (values: (ScopeRow | ScopeWatermark)[]) => {
        records.push(...values.filter(live).map(record => validated(record, owner)));
        if (!--remaining) done(records);
      });
    }),
    persist: async (record, expectedRevision) => {
      const frozen = validated(record, record.owner), refs = references(frozen);
      return transaction('readwrite', (store, read, done) => read(store.get(key(frozen.owner, frozen.scopeId)), (existing: ScopeRow | ScopeWatermark | undefined) => {
        if (expectedRevision === null ? Boolean(existing) : !existing || existing.revision !== expectedRevision || !live(existing)) {
          if (expectedRevision !== null && existing && live(existing) && existing.revision > expectedRevision
            && frozen.phase === 'saving' && existing.phase === 'saving' && sameSave(existing, frozen)) {
            done(validated(existing, frozen.owner, frozen.scopeId)); return;
          }
          throw changedStage();
        }
        if (existing && live(existing)) {
          const openingCreationSeries = existing.phase === 'editing' && existing.creation?.seriesOpened === false && frozen.creation?.seriesOpened === true;
          if ((!openingCreationSeries && !equalValues(existing.pins, frozen.pins))
            || existing.seriesCatalogVersion !== frozen.seriesCatalogVersion
            || !equalValues(existing.creation?.resource, frozen.creation?.resource)
            || (existing.creation?.seriesOpened === true && frozen.creation?.seriesOpened !== true)
            || (existing.phase !== 'editing' && !equalValues(existing.creation, frozen.creation)) || existing.generation > frozen.generation
            || (existing.phase !== 'editing' && (!equalValues(existing.action, frozen.action) || existing.generation !== frozen.generation
              || !equalValues(existing.seriesMembershipTime, frozen.seriesMembershipTime)))
            || (existing.phase === 'saving' && !['saving', 'submitted'].includes(frozen.phase))
            || (existing.phase === 'submitted' && (frozen.phase !== 'submitted' || !equalValues(existing.requestIds, frozen.requestIds)))
            || (existing.phase === 'cancelled' && frozen.phase !== 'cancelled')) throw new Error('Frozen membership intent cannot change');
        }
        validateCommitReferences(store, read, frozen.owner, refs, () => {
          const frozenFrom = existing && live(existing)
            ? existing.phase === 'editing'
              ? frozen.phase === 'saving' && sameSave(existing, frozen) ? existing.revision : undefined
              : existing.frozenFrom
            : undefined;
          const saved = { ...frozen, revision: (expectedRevision ?? -1) + 1 };
          const stored = frozenFrom === undefined ? saved : { ...saved, frozenFrom };
          store.put(stored, key(saved.owner, saved.scopeId));
          // Existing retention (including old tabs) already honors the reference range.
          store.put({ commitReferences: refs }, referenceKey(saved.owner, saved.scopeId));
          // Transfer capture ownership to the stage in this same transaction.
          saved.requestIds.forEach(id => store.delete(commitCaptureKey(saved.owner, saved.scopeId, id)));
          done(saved);
        });
      }));
    },
    compact: (owner, scopeId) => transaction('readwrite', (store, read, done) => read(store.get(key(owner, scopeId)), (value: ScopeRow | ScopeWatermark | undefined) => {
      if (!value || !live(value) || !['cancelled', 'submitted'].includes(value.phase)) { done(undefined); return; }
      const record = validated(value, owner, scopeId);
      const finish = (outcome: 'acknowledged' | 'cancelled') => {
        const watermark: ScopeWatermark = { owner, scopeId, revision: record.revision + 1, closed: true, outcome };
        if (outcome === 'acknowledged') watermark.save = { generation: record.generation, requestIds: record.requestIds,
          ...(value.frozenFrom === undefined ? {} : { frozenFrom: value.frozenFrom }),
          ...(record.seriesMembershipTime !== undefined ? { seriesMembershipTime: record.seriesMembershipTime } : {}) };
        store.put(watermark, key(owner, scopeId));
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
