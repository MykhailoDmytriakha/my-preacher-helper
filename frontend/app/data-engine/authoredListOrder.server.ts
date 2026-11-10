import { createHash } from 'node:crypto';

import { boundedActionTime, compareActionTime } from './actionClock';
import { AUTHORED_LIST_PROJECTION, AUTHORED_LIST_REVIEW, isAuthoredStringList } from './authoredStringList';
import { documentFieldChange, documentFieldPath, replaceOrderedDocumentField, SERMON_REPEATED_WORDS } from './documentFieldAction';
import { previousRepeatedWordRemovals, repeatedWordsObservation } from './documentFieldOrder.server';
import { equalValues, object, readField } from './fieldValues';
import { mergeFields } from './protocol';
import { rowDetailPreviousValues } from './rowDetailOrder.server';
import { existingRowFields, isRowChange, proofRevision, replaceExistingRowField, rowConflictPath, rowConflictValue } from './rowFieldAction';
import { SERVICE_ORDER_STEP_SCRIPTURE_LIST as scriptureList, SERVICE_ORDER_STEP_SCRIPTURE_POLICY as scripturePolicy } from './serviceOrderStepAction';
import { readServiceStepScriptureObservations } from './serviceOrderStepScripture.server';

import type { ActionTime } from './actionClock';
import type { ConflictDetail, DataCommand, DocumentData, FieldValue, ResourceSnapshot } from './types';

const proofKey = 'authoredListRemovals';
const limit = 32;
const repeated = SERMON_REPEATED_WORDS;
const digest = (value: string) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{43}$/.test(value);

type Update = Extract<DataCommand, { kind: 'update' }>;
type OrderProof = { revision: number; time: ActionTime | null; operationId?: string };
type Removal = OrderProof & { scope: string; item: string };
type Floor = { scope: string; revision: number };
type Ledger = { removals: Removal[]; floors: Floor[]; evicted: number };
type Observation = { time: ActionTime | null; observedRevision: number; predecessorOperationId?: string };
type ListEdit = {
  scope: string;
  rowId?: string;
  path: string[];
  base: FieldValue;
  mine: FieldValue;
  theirs: FieldValue;
  observation?: Observation;
  reviewed?: true;
};

export type DiscardedListAddition = {
  path: string[];
  item: string;
  actionTime: ActionTime;
  winnerActionTime: ActionTime;
};

const listValue = (field: FieldValue | undefined) =>
  field?.exists && isAuthoredStringList(field.value) ? field.value : [];
const ledgerKey = (scope: string, item: string) => scope + item;

function readLedger(raw: unknown, revision: number): Ledger {
  const data = object(raw) ? raw[proofKey] : undefined;
  const validRevision = (value: unknown): value is number => proofRevision(value) && value <= revision;
  const removals = object(data) && Array.isArray(data.removals) ? data.removals.slice(0, limit).flatMap(value => {
    if (!object(value) || !isDigest(value.scope) || !isDigest(value.item) || !validRevision(value.revision)) return [];
    const time = value.time === null ? null : boundedActionTime(value.time);
    return time === undefined ? [] : [{ scope: value.scope, item: value.item, revision: value.revision, time,
      ...(typeof value.operationId === 'string' && { operationId: value.operationId }) }];
  }) : [];
  const floors = object(data) && Array.isArray(data.floors) ? data.floors.slice(0, limit).flatMap(value =>
    object(value) && isDigest(value.scope) && validRevision(value.revision) ? [{ scope: value.scope, revision: value.revision }] : []) : [];
  return { removals, floors, evicted: object(data) && validRevision(data.evicted) ? data.evicted : 0 };
}

function scriptureEdits(command: Update, current: ResourceSnapshot, serverMs: number): ListEdit[] {
  const change = command.changes.find(item => isRowChange(item, scriptureList));
  if (!change) return [];
  const previous = existingRowFields(change.before.value, scriptureList), proposed = existingRowFields(change.after.value, scriptureList);
  const stored = existingRowFields(current.value?.steps, scriptureList);
  const observations = readServiceStepScriptureObservations(command, current.metadata!.revision, serverMs);
  const reviewed = Array.isArray(command.serviceOrderStepScriptureActions?.reviewed);
  return [...previous].flatMap(([rowId, before]) => {
    const after = proposed.get(rowId), theirs = stored.get(rowId);
    if (!before || !after || !theirs || equalValues(before, after)) return [];
    return [{ rowId, scope: digest(rowId), path: rowConflictPath(rowId, scriptureList),
      base: rowConflictValue(before), mine: rowConflictValue(after), theirs: rowConflictValue(theirs),
      observation: observations.get(rowId),
      ...(reviewed && observations.get(rowId) && { reviewed: true as const }),
    }];
  });
}

function listEdits(command: Update, current: ResourceSnapshot, serverMs: number): ListEdit[] {
  if (command.resource.collection === 'serviceOrders') return scriptureEdits(command, current, serverMs);
  if (command.resource.collection !== 'sermons' || !current.value) return [];
  const change = documentFieldChange(command.changes, repeated);
  if (!change) return [];
  const observation = repeatedWordsObservation(command, change, current.metadata!.revision, serverMs);
  return [{ scope: digest(''), path: change.path, base: change.before, mine: change.after,
    theirs: readField(current.value, documentFieldPath(repeated)), observation }];
}

function legacyRemovals(raw: unknown, current: ResourceSnapshot, edit: ListEdit): ((item: string) => OrderProof | undefined) | undefined {
  if (edit.rowId === undefined) return previousRepeatedWordRemovals(raw, current);
  const earlier = rowDetailPreviousValues(raw, scripturePolicy, 'scriptureRefs', edit.rowId, edit.rowId,
    listValue(edit.theirs), current.metadata!.revision);
  return earlier && (item => earlier([item]));
}

function rewriteAddition(command: Update, edit: ListEdit, next: string[]): Update {
  if (edit.rowId === undefined) {
    const after = next.length ? { exists: true, value: next } : edit.base;
    return { ...command, changes: replaceOrderedDocumentField(command.changes, repeated, edit.base, after) };
  }
  const rowId = edit.rowId;
  return { ...command, changes: command.changes.map(change => isRowChange(change, scriptureList)
    ? { ...change, after: { ...change.after, value: replaceExistingRowField(change.after.value, rowId, next, scriptureList) } } : change) };
}

export function orderAuthoredListAdditions(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const uncertain: ConflictDetail[] = [], rejectedChoices: ConflictDetail[] = [], discarded: DiscardedListAddition[] = [];
  const resolved = new Set<string>();
  if (command.kind !== 'update' || !current.metadata || current.metadata.deleted
    || command.generation !== current.metadata.generation) return { command, uncertain, rejectedChoices, discarded, resolved, edits: [] as ListEdit[] };

  const edits = listEdits(command, current, serverMs);
  if (!edits.length) return { command, uncertain, rejectedChoices, discarded, resolved, edits };
  const { removals, floors, evicted } = readLedger(raw, current.metadata.revision);
  const byItem = new Map(removals.map(removal => [ledgerKey(removal.scope, removal.item), removal]));
  const byScope = new Map(floors.map(floor => [floor.scope, floor.revision]));
  for (const edit of edits) {
    // Explicit grouped choices are checked against their reviewed opening by the step policy.
    if (edit.reviewed) continue;
    const before = listValue(edit.base), after = listValue(edit.mine), stored = listValue(edit.theirs);
    const sameOpening = equalValues(before, stored);
    const opening = new Set(before), saved = new Set(stored), proposed = new Set(after);
    const adds = [...proposed].filter(item => !opening.has(item) && !saved.has(item));
    if (!adds.length) continue;
    const removes = before.some(item => !proposed.has(item));
    const action = edit.observation, observed = action?.observedRevision ?? 0;
    // A legacy replacement against the current list still uses the existing return-to-opening guard.
    if (sameOpening && removes && !action) continue;
    const floor = Math.max(byScope.get(edit.scope) ?? 0, evicted);
    const rejected = new Set<string>();
    const history: DiscardedListAddition[] = [];
    const legacy = legacyRemovals(raw, current, edit);
    let review = false, decidedMembership = false;
    for (const item of adds) {
      const proof = byItem.get(ledgerKey(edit.scope, digest(item))) ?? legacy?.(item);
      if (!proof) {
        if (observed < floor) review = true;
        continue;
      }
      const followsRemoval = observed >= proof.revision || (proof.operationId && action?.predecessorOperationId === proof.operationId);
      const order = action?.time && proof.time ? compareActionTime(action.time, proof.time) : 0;
      if (followsRemoval || order > 0) {
        if (!removes) decidedMembership = true;
        continue;
      }
      if (!order || removes || !action?.time || !proof.time) { review = true; continue; }
      decidedMembership = true;
      rejected.add(item);
      history.push({ path: edit.path, item, actionTime: action.time, winnerActionTime: proof.time });
    }
    const comparison = { path: edit.path, code: AUTHORED_LIST_REVIEW, base: edit.base, mine: edit.mine, theirs: edit.theirs };
    if (review) {
      uncertain.push(comparison);
    } else if (decidedMembership) {
      // Whole-list proofs can be newer because they concern a different item.
      resolved.add(edit.rowId ?? '');
      if (rejected.size) {
        const filtered = after.filter(item => !rejected.has(item));
        command = rewriteAddition(command, edit, filtered);
        discarded.push(...history);
        // A separate conflict may block the whole write. Show the safe projected list instead of replaying the old insertions.
        const proposed = filtered.length ? { exists: true, value: filtered } : edit.base;
        const merged = mergeFields(edit.base, proposed, edit.theirs, edit.path);
        rejectedChoices.push(merged.conflicts.length ? comparison
          : { ...comparison, code: AUTHORED_LIST_PROJECTION, mine: merged.value });
      }
    }
  }
  return { command, uncertain, rejectedChoices, discarded, resolved, edits };
}

type ListOrder = ReturnType<typeof orderAuthoredListAdditions>;

function storedLists(collection: string, data: DocumentData | null | undefined): Map<string, string[]> {
  if (collection === 'sermons') return new Map([[digest(''), listValue(data ? readField(data, documentFieldPath(repeated)) : undefined)]]);
  if (collection === 'serviceOrders') return new Map([...existingRowFields(data?.steps, scriptureList)]
    .flatMap(([id, list]) => list ? [[digest(id), list] as const] : []));
  return new Map();
}

export function metadataAfterAuthoredListRemovals(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  order?: ListOrder, acceptedExact?: (edit: ListEdit) => boolean) {
  const metadata = snapshot.metadata, rawMeta = raw?._dataEngine;
  const collection = snapshot.resource.collection;
  if (!metadata || !snapshot.value || (collection !== 'sermons' && collection !== 'serviceOrders')
    || !object(rawMeta) || rawMeta.generation !== metadata.generation) return metadata;
  const before = storedLists(collection, raw as DocumentData), after = storedLists(collection, snapshot.value);
  const ledger = readLedger(rawMeta, metadata.revision - 1);
  const edits = new Map(order?.edits.map(edit => [edit.scope, edit]));
  const known = new Map(ledger.removals.map(removal => [ledgerKey(removal.scope, removal.item), removal]));
  const removed: Removal[] = [];
  for (const [scope, previous] of before) {
    const next = after.get(scope);
    if (!next) continue;
    const remaining = new Set(next), edit = edits.get(scope);
    const intended = listValue(edit?.mine), intendedAfter = new Set(intended);
    const intentional = new Set(listValue(edit?.base).filter(item => !intendedAfter.has(item)));
    const observation = edit?.observation;
    const remember = (item: string, time: ActionTime | null) => removed.push({
      scope, item, revision: metadata.revision, time, ...(metadata.operationId && { operationId: metadata.operationId }),
    });
    const previousItems = new Set(previous);
    for (const item of previousItems) {
      if (!remaining.has(item)) remember(digest(item), intentional.has(item) ? observation?.time ?? null : null);
    }
    if (!edit || !equalValues(next, intended)) continue;
    for (const item of intentional) {
      if (previousItems.has(item)) continue;
      const fingerprint = digest(item);
      const prior = known.get(ledgerKey(scope, fingerprint));
      if (!prior && !acceptedExact?.(edit)) continue;
      // An exact acknowledged reaffirmation can remove the same item without changing the stored list.
      const time = observation?.time ?? null;
      const order = prior?.time && time ? compareActionTime(time, prior.time) : 0;
      const follows = !prior || (observation && (observation.observedRevision >= prior.revision
        || (prior.operationId && observation.predecessorOperationId === prior.operationId)));
      if (follows || order >= 0) remember(fingerprint, follows || order > 0 ? time : null);
    }
  }
  const tracked = new Set(ledger.removals.map(({ scope }) => scope));
  const present = new Map([...after].filter(([scope]) => tracked.has(scope))
    .map(([scope, items]) => [scope, new Set(items.map(digest))]));
  const fresh = new Set(removed.map(({ scope, item }) => ledgerKey(scope, item)));
  const merged = [...removed, ...ledger.removals.filter(({ scope, item }) => present.has(scope)
    && !present.get(scope)!.has(item) && !fresh.has(ledgerKey(scope, item)))];
  const byScope = new Map(ledger.floors.filter(floor => after.has(floor.scope)).map(({ scope, revision }) => [scope, revision]));
  for (const { scope, revision } of merged.slice(limit)) byScope.set(scope, Math.max(byScope.get(scope) ?? 0, revision));
  const floors = [...byScope].map(([scope, revision]) => ({ scope, revision })).sort((a, b) => b.revision - a.revision);
  const evicted = Math.max(ledger.evicted, floors[limit]?.revision ?? 0);
  if (!merged.length && !floors.length && !evicted) return metadata;
  return { ...metadata, [proofKey]: { removals: merged.slice(0, limit), floors: floors.slice(0, limit), evicted } };
}
