'use client';

import { cancellationScope } from './atomicCommits';
import { PendingStartupAutosave } from './automaticDraftResume';
import { isCapturedTransferReplay, planCaptureTransfer } from './captureTransfer';
import { checkpointKey, writeCheckpointRecord, writeChoiceCheckpoints } from './checkpointStorage.client';
import { createCollectionCommitReads } from './collectionCommitReads.client';
import { assertCommitBatch, assertCommitCapture, assertCommitIdentities, orderCommitRequests, type ChoiceCheckpoint, type CommitRequest, type CommitStore } from './commits';
import { captureDeleteOrder, replayDeleteOrder } from './deletionOrdering';
import { captureLifetimeEditor, isRetirableOrdinaryEditor, readLeasedAtomicAction, type LeasedAtomicAction } from './editorIdentity';
import { equalValues, readField } from './fieldValues';
import { GROUP_MEETING_SLOT, readyMeetingAutosave } from './groupMeetingAutosave';
import { HARD_QUESTION_REORDER } from './hardQuestionRankOrder';
import { reconcileManualCaptures } from './manualScope';
import { writeManualChoiceRecoveries, type ManualStorageRecord } from './manualScopes.client';
import { MAX_RELATION_RESOURCES } from './protocol';
import { isRecoverableCheckpoint, reconcileRecoveryRecord, recoveryCheckpointId, validateRecoveryRecord } from './recovery.client';
import { versionRecoveryRecord } from './recoverySource.client';
import { COMMIT_ROW_KINDS, activeOrdinaryEditorKey, collectCommitRows, deferCollection, commitCaptureKey, commitDependencyKey, commitGenerationKey, commitProjectionKey, commitRowKey, commitSnapshotKey, readCommitIdentities, readCommitRows, retireCleanManualScopes } from './retention.client';
import { projectServiceOrderInput, serviceOrderInputKey } from './serviceOrderInput';
import { createEngineStorageTransaction, engineOwnerRange, validateCommitReferences, type StorageRead } from './storage.client';

import type { OrdinaryEditorLease, OrdinaryEditorLeases } from './ordinaryEditorLeases.client';


const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const changed = () => Object.assign(new Error('Commit changed'), { code: 'commit-changed' });

function otherRecoverableCheckpoint(record: unknown, current: CommitRequest): boolean {
  const candidate = record as { editorId?: unknown } | undefined;
  if (typeof candidate?.editorId !== 'string' || candidate.editorId === current.editorId) return false;
  try {
    return isRecoverableCheckpoint(validateRecoveryRecord(record, current.owner, candidate.editorId, current.baseline.resource));
  } catch {
    return false;
  }
}
function rankOpeningReferences(request: CommitRequest): string[] {
  if (request.atomic?.kind !== HARD_QUESTION_REORDER || request.atomic.id !== request.id) return [];
  return [...(request.atomic.hardQuestionRankScopeRequests ?? []),
    ...(request.atomic.hardQuestionRankWitnesses ?? []).flatMap(witness => witness.predecessor ? [witness.predecessor] : [])];
}

/** Older collectors honor reference rows even when they cannot read a new request format. */
function retainPredecessor(store: IDBObjectStore, request: CommitRequest): void {
  const key = commitDependencyKey(request.owner, request.id);
  const references = new Set<string>();
  if (!['cancelled', 'acknowledged'].includes(request.state)) {
    if (request.predecessor && !request.initialized) references.add(request.predecessor);
    if (!['acknowledged', 'cancelled', 'refused'].includes(request.state)) {
      request.serviceOrderPlacement?.afterRequests?.forEach(id => references.add(id));
      if (!request.command && request.state === 'queued') rankOpeningReferences(request).forEach(id => references.add(id));
    }
    for (const id of request.deleteAfter ?? []) references.add(id);
  }
  if (references.size) store.put({ commitReferences: [...references] }, key);
  else store.delete(key);
}

function checkOwnershipFormat(store: IDBObjectStore, read: StorageRead, request: CommitRequest, done: () => void): void {
  const selected = (commitRowKey(request) as IDBValidKey[])[0];
  const others = COMMIT_ROW_KINDS.filter(kind => kind !== selected);
  let remaining = others.length;
  for (const kind of others) read(store.get(commitRowKey(request, kind)), other => {
    if (other) throw new Error('Saved generation cannot change its ownership format');
    if (!--remaining) done();
  });
}

type CaptureAdmission = 'ordinary' | 'transfer' | 'resume' | 'meeting-resume' | 'leased-atomic';

const closedAtomicCapture = () => Object.assign(new Error('The atomic action capture has closed'), { code: 'commit-editor-closed' });

function writeRecord(store: IDBObjectStore, read: StorageRead, frozen: CommitRequest,
  done: (record: CommitRequest) => void, admission: CaptureAdmission): void {
  if (frozen.transferredFrom && admission !== 'transfer') throw new Error('A replacement proof requires atomic source transfer');
  read(store.get(commitRowKey(frozen)), (existing: CommitRequest | undefined) => {
    if (existing) { assertCommitCapture(existing, frozen); done(existing); return; }
    if (readLeasedAtomicAction(frozen.editorId) && admission !== 'leased-atomic') throw closedAtomicCapture();
    const capture = () => checkOwnershipFormat(store, read, frozen, () => {
      read(store.get(commitGenerationKey(frozen)), (completed: { through: number } | undefined) => {
        if (completed && completed.through >= frozen.editGeneration) throw Object.assign(new Error('This saved generation is already complete'), { code: 'commit-generation-complete' });
        const identity = ['identity', frozen.owner, frozen.id];
        read(store.get(identity), used => {
          if (used) throw new Error('Commit identity is already used');
          const references = [...(frozen.predecessor && !frozen.initialized ? [frozen.predecessor] : []),
            ...(frozen.deleteAfter ?? []), ...rankOpeningReferences(frozen)];
          validateCommitReferences(store, read, frozen.owner, references, () => {
            store.put(commitRowKey(frozen), identity);
            store.put({ commitReferences: [frozen.id] }, commitProjectionKey(frozen.owner, frozen.id));
            if (frozen.retentionScope) store.put({ commitReferences: [frozen.id] }, commitCaptureKey(frozen.owner, frozen.retentionScope, frozen.id));
            store.put(frozen, commitRowKey(frozen));
            retainPredecessor(store, frozen);
            done(frozen);
          }, !frozen.initialized && frozen.predecessor ? frozen.predecessor : undefined);
        });
      });
    });
    const lifetime = captureLifetimeEditor(frozen.editorId);
    const resumedOpening = (admission === 'resume' && lifetime === frozen.editorId) || admission === 'meeting-resume';
    if (lifetime && !resumedOpening) {
      read(store.get(activeOrdinaryEditorKey(frozen.owner, lifetime)), active => {
        if (!active) throw Object.assign(new Error('The editor has already closed'), { code: 'commit-editor-closed' });
        capture();
      });
    } else capture();
  });
}

/** Derive the frontier only once, from rows read in this same native write transaction. */
function createRecord(store: IDBObjectStore, read: StorageRead, frozen: CommitRequest,
  done: (record: CommitRequest) => void, admission: CaptureAdmission = 'ordinary'): void {
  if (frozen.value !== null) { writeRecord(store, read, frozen, done, admission); return; }
  readCommitRows(store, read, frozen.owner, records => {
    const existing = records.find(record => record.editorId === frozen.editorId && record.editGeneration === frozen.editGeneration);
    const captured = existing ? replayDeleteOrder(frozen, existing) : captureDeleteOrder(frozen, records);
    writeRecord(store, read, captured, done, admission);
  });
}

/** Each request has its own row; a participant batch shares one IndexedDB transaction. */
export function createIndexedDbCommitStore(collect = collectCommitRows, leases?: Pick<OrdinaryEditorLeases, 'acquire' | 'runExclusive'>): CommitStore {
  const heldLeases = new Map<string, OrdinaryEditorLease>();
  const atomicAdmissions = new Map<string, { owner: string; kind: LeasedAtomicAction }>();
  const scopedAdmissions = new Map<string, Promise<unknown>>();
  const leaseKey = (owner: string, editorId: string) => JSON.stringify([owner, editorId]);
  const transaction = createEngineStorageTransaction();
  const collections = createCollectionCommitReads(transaction);
  const createBatch = async (requests: readonly CommitRequest[]): Promise<CommitRequest[]> => {
    const frozen = clone(requests); assertCommitBatch(frozen);
    if (!frozen.length) return [];
    const participantLeases = frozen.map(request => readLeasedAtomicAction(request.editorId));
    const lease = participantLeases.find(identity => identity !== null);
    if (lease) {
      const allowed = atomicAdmissions.get(lease.leaseId);
      const limit = lease.kind === HARD_QUESTION_REORDER ? MAX_RELATION_RESOURCES : lease.kind === 'analysis-reshape' ? 3 : 2;
      const minimum = lease.kind === HARD_QUESTION_REORDER ? 1 : 2;
      if (allowed?.owner !== frozen[0].owner || allowed.kind !== lease.kind || frozen.length < minimum || frozen.length > limit
        || participantLeases.some(identity => identity?.leaseId !== lease.leaseId || identity.kind !== lease.kind)
        || frozen.some(request => request.atomic?.kind !== lease.kind)) throw closedAtomicCapture();
      // A conflicting or rolled-back transaction cannot issue another batch under this lease.
      atomicAdmissions.delete(lease.leaseId);
    }
    return transaction('readwrite', (store, read, done) => {
      const result: CommitRequest[] = []; let remaining = frozen.length;
      frozen.forEach((request, index) => createRecord(store, read, request, saved => {
        result[index] = saved;
        if (!--remaining) done(result);
      }, lease ? 'leased-atomic' : 'ordinary'));
    });
  };
  const compareAndSetBatchInternal = async (changes: readonly { previous: CommitRequest; next: CommitRequest }[],
    project?: (saved: CommitRequest[]) => ChoiceCheckpoint, choiceRequestIds?: readonly string[]): Promise<CommitRequest[]> => {
    const frozen = clone(changes); assertCommitIdentities(frozen.map(change => change.previous));
    if (!frozen.length) {
      if (project) throw new Error('A checkpoint projection requires at least one changed commit');
      return [];
    }
    return transaction('readwrite', (store, read, done) => {
      const result: CommitRequest[] = []; let remaining = frozen.length;
      const write = (before: readonly CommitRequest[] = []) => frozen.forEach(({ previous, next }, index) => {
        read(store.get(commitRowKey(previous)), (current: CommitRequest | undefined) => {
          if (!current || current.id !== previous.id || current.revision !== previous.revision) throw changed();
          if (next.id !== previous.id || next.owner !== previous.owner || next.editorId !== previous.editorId
            || next.editGeneration !== previous.editGeneration) throw new Error('Commit identity changed');
          assertCommitCapture(current, next);
          const saved = { ...next, revision: previous.revision + 1 };
          retainPredecessor(store, saved);
          if (saved.state === 'acknowledged' && saved.result?.kind === 'acknowledged') {
            store.put({ commitReferences: [saved.id] }, commitSnapshotKey(saved.owner, saved.id));
          }
          store.put(saved, commitRowKey(saved)); result[index] = saved;
          if (!--remaining) {
            const projection = project?.(clone(result)) ?? [];
            const checkpoints = 'editorRecords' in projection ? projection.editorRecords
              : Array.isArray(projection) ? projection : [projection];
            const captured: CommitRequest[] = [];
            const finish = () => {
              const complete = () => done([...result, ...captured]);
              if (checkpoints.length) writeChoiceCheckpoints(store, read, previous.owner, checkpoints, complete, collect);
              else collect(store, read, saved.owner, complete);
            };
            const writeRecoveries = () => {
              if ('manualRecoveries' in projection && projection.manualRecoveries.length) {
                writeManualChoiceRecoveries(store, read, previous.owner, projection.manualRecoveries, before, result, finish);
              } else finish();
            };
            const replacements = 'replacements' in projection ? projection.replacements ?? [] : [];
            assertCommitIdentities(replacements);
            const captureNext = (index: number) => {
              const replacement = replacements[index];
              if (!replacement) { writeRecoveries(); return; }
              if (replacement.owner !== previous.owner) throw new Error('Choice replacement owner differs from changed commits');
              createRecord(store, read, replacement, request => {
                if (request.id !== replacement.id) throw changed();
                captured.push(request);
                captureNext(index + 1);
              });
            };
            captureNext(0);
          }
        });
      });
      if (!choiceRequestIds?.length) { write(); return; }
      readCommitRows(store, read, frozen[0].previous.owner, records => {
        const expected = new Set(frozen.map(change => change.previous.id));
        const frontier = cancellationScope(records, '', choiceRequestIds);
        if (frontier.length !== expected.size || frontier.some(request => !expected.has(request.id))) throw changed();
        write(records);
      });
    });
  };
  const compareAndSetBatch = (changes: readonly { previous: CommitRequest; next: CommitRequest }[],
    choiceRequestIds?: readonly string[]): Promise<CommitRequest[]> => compareAndSetBatchInternal(changes, undefined, choiceRequestIds);
  const compareAndSetWithCheckpoint = (changes: readonly { previous: CommitRequest; next: CommitRequest }[],
    project: (saved: CommitRequest[]) => ChoiceCheckpoint, choiceRequestIds?: readonly string[]): Promise<CommitRequest[]> =>
    compareAndSetBatchInternal(changes, project, choiceRequestIds);
  return {
    list: owner => transaction('readonly', (store, read, done) => {
      readCommitRows(store, read, owner, done);
    }),
    listForCollection: collections,
    listForAnalysisRecovery: owner => transaction('readonly', (store, read, done) => {
      read(store.getAllKeys(engineOwnerRange('analysis-reshape-request', owner)), keys => {
        if (!keys.length) { done([]); return; }
        // An action's cancellation evidence can also contain ordinary dependent Saves.
        readCommitRows(store, read, owner, done);
      });
    }),
    readByIds: (owner, ids) => transaction('readonly', (store, read, done) => {
      readCommitIdentities(store, read, owner, ids, requests => done([...requests.values()]));
    }),
    readChainStep: (owner, knownIds, ids) => transaction('readonly', (store, read, done) => {
      // Every request kind already shares this durable identity index, including older writers.
      read(store.getAllKeys(engineOwnerRange('identity', owner)), keys => {
        if (keys.some(key => !Array.isArray(key) || typeof key[2] !== 'string' || !knownIds.has(key[2]))) { done(null); return; }
        readCommitIdentities(store, read, owner, ids, requests => {
          done(requests.size === ids.length ? ids.map(id => requests.get(id)!) : null);
        });
      });
    }),
    activateOrdinaryEditor: async (owner, editorId) => {
      if (!isRetirableOrdinaryEditor(editorId)) throw new Error('Expected a fresh ordinary editor');
      const lease = await leases?.acquire();
      try {
        await transaction<void>('readwrite', (store, read, done) => {
          const key = activeOrdinaryEditorKey(owner, editorId);
          read(store.get(key), active => {
            if (active) throw new Error('This editor identity is already open');
            store.put(lease ? { lease: lease.id } : true, key);
            done(undefined);
          });
        });
      } catch (error) {
        await lease?.release();
        throw error;
      }
      if (lease) heldLeases.set(leaseKey(owner, editorId), lease);
    },
    retireOrdinaryEditor: async (owner, editorId) => {
      const key = leaseKey(owner, editorId);
      const lease = heldLeases.get(key);
      await transaction<void>('readwrite', (store, read, done) => {
        if (!isRetirableOrdinaryEditor(editorId)) { done(undefined); return; }
        // The admission row and replay guard retire together. Existing requests own their identities.
        store.delete(activeOrdinaryEditorKey(owner, editorId));
        store.delete(commitGenerationKey({ owner, editorId }));
        retireCleanManualScopes(store, read, owner, editorId, () => done(undefined));
      });
      if (heldLeases.get(key) === lease) heldLeases.delete(key);
      await lease?.release();
    },
    withAtomicActionAdmission: async (owner, kind, capture, scope) => {
      const run = async () => {
        const lease = await leases?.acquire();
        if (!lease) return capture(null);
        atomicAdmissions.set(lease.id, { owner, kind });
        try { return await capture(lease.id); }
        finally {
          atomicAdmissions.delete(lease.id);
          await lease.release();
        }
      };
      if (!scope) return run();
      const key = JSON.stringify([owner, kind, scope]);
      if (leases?.runExclusive) return leases.runExclusive(key, run);
      const pending = (scopedAdmissions.get(key) ?? Promise.resolve()).catch(() => undefined).then(run);
      scopedAdmissions.set(key, pending);
      try { return await pending; }
      finally { if (scopedAdmissions.get(key) === pending) scopedAdmissions.delete(key); }
    },
    create: request => createBatch([request]).then(records => records[0]),
    createWithCheckpoint: (request, project, options) => {
      const frozen = clone(request);
      const version = options?.resumeVersion;
      return transaction('readwrite', (store, read, done) => {
        const capture = (admission: CaptureAdmission) => createRecord(store, read, frozen, saved => {
          const settle = () => writeCheckpointRecord(store, read, project(clone(saved)), false, () => done(saved),
            options?.deferRetention ? deferCollection : collect);
          if (admission === 'resume' && isRetirableOrdinaryEditor(frozen.editorId)) {
            store.delete(activeOrdinaryEditorKey(frozen.owner, frozen.editorId));
            retireCleanManualScopes(store, read, frozen.owner, frozen.editorId, settle);
          } else settle();
        }, admission);
        if (!version) { capture('ordinary'); return; }
        // Capture at the source identity so a later Discard still sees the queued write.
        read(store.get(checkpointKey(frozen.owner, frozen.editorId)), value => {
          if (value?.recoveryVersion !== version) throw changed();
          const { checkpoint } = validateRecoveryRecord(value, frozen.owner, frozen.editorId, frozen.baseline.resource);
          const input = options?.resumedServiceInput;
          if (!checkpoint.dirty || !frozen.value || Object.keys(checkpoint.pending).length
            || !equalValues(checkpoint.confirmed, frozen.baseline)) throw changed();
          if (input) {
            if (frozen.baseline.resource.collection !== 'serviceOrders' || frozen.predecessor || !input.version || input.retainedOnly
              || checkpoint.editGeneration + 1 !== frozen.editGeneration
              || !equalValues(checkpoint.serviceOrderInputs?.[serviceOrderInputKey(input)], input)
              || !equalValues(projectServiceOrderInput(checkpoint.confirmed.value, input), frozen.value)) throw changed();
          } else if (checkpoint.editGeneration !== frozen.editGeneration || !equalValues(checkpoint.draft, frozen.value)) throw changed();
          // A person may have taken over this same source between the presence check
          // and the transaction. The fork's existing source proof settles the race.
          const id = recoveryCheckpointId(frozen.owner, frozen.editorId);
          read(store.getAll(engineOwnerRange('checkpoint', frozen.owner)), records => {
            const forked = records.some(record => Array.isArray(record?.recoveryOrigins)
              && record.recoveryOrigins.some((origin: { id?: string; version?: string }) => origin?.id === id && origin.version === version));
            if (forked) throw changed();
            if (!input) { capture('resume'); return; }
            readCommitRows(store, read, frozen.owner, requests => {
              const competing = requests.filter(item => equalValues(item.baseline.resource, frozen.baseline.resource)
                && !['acknowledged', 'cancelled'].includes(item.state));
              if (competing.some(item => item.state === 'conflict' || item.state === 'refused')) throw changed();
              if (competing.length) throw new PendingStartupAutosave(competing.map(item => item.id));
              if (records.some(record => otherRecoverableCheckpoint(record, frozen))) throw changed();
              capture('resume');
            });
          });
        });
      });
    },
    createWithMeetingResume: (request, version) => {
      const frozen = clone(request), value = frozen.value;
      if (!value) return Promise.reject(changed());
      return transaction('readwrite', (store, read, done) => {
        read(store.get(['manual', frozen.owner, frozen.editorId]), (source: ManualStorageRecord | undefined) => {
          const input = source?.record;
          if (!source || !input || source.slot !== GROUP_MEETING_SLOT || source.recoveryVersion !== version
            || input.owner !== frozen.owner || input.scopeId !== frozen.editorId
            || input.generation !== frozen.editGeneration) throw changed();
          read(store.getAll(engineOwnerRange('manual', frozen.owner)), (scopes: ManualStorageRecord[]) => {
            // A chosen recovery fork or a newer on-device record has its own authority.
            if (scopes.some(scope => scope.record?.recoveryOrigins?.some(origin =>
              origin.id === source.scopeId && origin.version === version))) throw changed();
            readCommitRows(store, read, frozen.owner, requests => {
              const waiting = requests.filter(item => equalValues(item.baseline.resource, frozen.baseline.resource)
                && !['acknowledged', 'cancelled'].includes(item.state));
              if (waiting.length) throw new PendingStartupAutosave(waiting.map(item => item.id));
              const stage = reconcileManualCaptures(input, requests);
              if (!readyMeetingAutosave(stage) || (stage.predecessor?.id ?? null) !== frozen.predecessor
                || !equalValues(stage.baseline, frozen.baseline)
                || !equalValues(stage.stage[0], readField(value, ['meetingDates']))) throw changed();
              createRecord(store, read, frozen, saved => {
                const record = reconcileManualCaptures(stage, [...requests.filter(item => item.id !== saved.id), saved]);
                const captured = versionRecoveryRecord({ ...source, record: { ...record, active: false }, commitReferences: [saved.id] });
                store.put(captured, ['manual', frozen.owner, frozen.editorId]);
                done(saved);
              }, 'meeting-resume');
            });
          });
        });
      });
    },
    createWithTransfer: (request, project, sources) => {
      const frozen = clone(request), expected = clone(sources);
      return transaction('readwrite', (store, read, done) => {
        readCommitRows(store, read, frozen.owner, records => {
          const existing = records.find(record => record.editorId === frozen.editorId && record.editGeneration === frozen.editGeneration);
          if (existing?.transferredFrom) {
            assertCommitCapture(existing, frozen);
            if (!isCapturedTransferReplay(existing, frozen)) throw changed();
            // The first transaction already stored the target checkpoint and sources.
            // Replaying it must not replace a newer private target checkpoint.
            done({ request: clone(existing), retired: [] });
            return;
          }
          createRecord(store, read, frozen, saved => {
            const retired = planCaptureTransfer(saved, expected, records);
            for (const source of retired) { store.put(source, commitRowKey(source)); retainPredecessor(store, source); }
            writeCheckpointRecord(store, read, project(clone(saved)), false, () => done({ request: saved, retired }), collect);
          }, 'transfer');
        });
      });
    },
    compareAndSet: (previous, next) => compareAndSetBatch([{ previous, next }]).then(records => records[0]),
    createBatch,
    compareAndSetBatch,
    compareAndSetWithCheckpoint,
    listCaptures: (owner, prefix) => transaction('readonly', (store, read, done) => {
      read(store.getAllKeys(engineOwnerRange('reference', owner, 'capture')), keys => {
        const ids = keys.flatMap(key => Array.isArray(key) && key.length === 5 && typeof key[3] === 'string'
          && key[3].startsWith(prefix) && typeof key[4] === 'string' ? [key[4]] : []);
        readCommitIdentities(store, read, owner, ids, requests => {
          const candidates = [...requests.values()].filter(request => request.retentionScope?.startsWith(prefix));
          if (!candidates.length) { done([]); return; }
          const held: CommitRequest[] = []; let remaining = candidates.length;
          for (const request of candidates) read(store.get(commitCaptureKey(owner, request.retentionScope!, request.id)), reference => {
            if (reference?.commitReferences?.length === 1 && reference.commitReferences[0] === request.id) held.push(request);
            if (!--remaining) done(held);
          });
        });
      });
    }),
    releaseCapture: (owner, scope, id) => transaction('readwrite', (store, read, done) => {
      readCommitIdentities(store, read, owner, [id], requests => {
        if (requests.get(id)?.retentionScope !== scope) { done(undefined); return; }
        const key = commitCaptureKey(owner, scope, id);
        read(store.get(key), reference => {
          if (reference?.commitReferences?.length === 1 && reference.commitReferences[0] === id) store.delete(key);
          collect(store, read, owner, () => done(undefined));
        });
      });
    }),
    releaseProjection: (owner, ids) => transaction('readwrite', (store, read, done) => {
      readCommitIdentities(store, read, owner, ids, requested => {
        const missing = [...requested.values()].flatMap(request =>
          request.atomic?.participants.filter(id => !requested.has(id)) ?? []);
        readCommitIdentities(store, read, owner, missing, participants => {
          const ready = [...requested.values()].filter(request =>
            (request.atomic?.participants ?? [request.id]).every(id => {
              const item = requested.get(id) ?? participants.get(id);
              return item && ['acknowledged', 'cancelled'].includes(item.state) && !item.unfinalized.length;
            }));
          let ordered: CommitRequest[] | undefined;
          const projectNext = (index: number): void => {
            const request = ready[index];
            if (!request) {
              if (ready.length) collect(store, read, owner, () => done(undefined));
              else done(undefined);
              return;
            }
            store.delete(commitProjectionKey(owner, request.id));
            store.delete(commitSnapshotKey(owner, request.id));
            read(store.get(checkpointKey(owner, request.editorId)), record => {
              if (!record || (!request.transferredFrom && !request.transferredTo && !record.recoveryOrigins?.length)) {
                projectNext(index + 1); return;
              }
              // Transferred and recovered targets still reconcile through the complete dependency order.
              const project = (requests: CommitRequest[]) => {
                const frozen = validateRecoveryRecord(record, owner, request.editorId, request.baseline.resource);
                writeCheckpointRecord(store, read, reconcileRecoveryRecord(frozen, requests), false,
                  () => projectNext(index + 1), deferCollection);
              };
              if (ordered) project(ordered);
              else readCommitRows(store, read, owner, requests => { ordered = orderCommitRequests(requests); project(ordered); });
            });
          };
          projectNext(0);
        });
      });
    }),
  };
}
