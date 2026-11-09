import { boundedActionTime } from './actionClock';
import { COUNCIL_TOPIC_TITLE_POLICY } from './councilTopicTitleAction';
import { equalValues } from './fieldValues';
import { GROUP_BLOCK_STATUS_POLICY } from './groupBlockStatusAction';
import { GROUP_BLOCK_TITLE_POLICY, GROUP_STEP_TITLE_POLICY } from './groupFlowTitleAction';
import { GROUP_STEP_DURATION_POLICY } from './groupStepDurationAction';
import { matchesRowDetailBirth } from './rowDetailAction';
import { knownRowDetailPredecessor, pendingRowDetailRebases } from './rowDetailCapture';
import { boundedRowId, existingRowField, existingRowFields, isCapturedRowConflict, matchesRowAction, replaceExistingRowField, rowConflictPath } from './rowFieldAction';
import { THOUGHT_LOCK_POLICY } from './thoughtLockAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { RowDetailObservation, RowDetailPolicy } from './rowDetailAction';
import type { SessionCheckpoint, ShownCopy } from './session';
import type { ConflictDetail, DocumentData, FieldChange, ResourceSnapshot } from './types';

type Value = string | number | boolean | null;
type Action = RowDetailObservation<Value>;
type Draft = { generation: string; action: Action };
type DraftKey = 'councilTopicTitleDrafts' | 'groupBlockTitleDrafts' | 'groupStepTitleDrafts' | 'groupBlockStatusDrafts' | 'groupStepDurationDrafts' | 'thoughtLockDrafts';
type ActionKey = 'councilTopicTitleActions' | 'groupBlockTitleActions' | 'groupStepTitleActions' | 'groupBlockStatusActions' | 'groupStepDurationActions' | 'thoughtLockActions';
export type RowFieldActionKind = 'council-topic-title' | 'group-block-title' | 'group-step-title' | 'group-block-status' | 'group-step-duration' | 'thought-lock';
export type RowFieldStamp = { field: RowFieldActionKind; time: ActionTime | null } & (
  { rowId: string } | { rowIds: readonly string[] }
);
export type RowFieldDrafts = Partial<Record<DraftKey, Record<string, Draft>>>;
export type AutosaveRowFieldActions = Partial<Record<ActionKey, Action[]>>;

type Target = {
  stamp: RowFieldActionKind; draft: DraftKey; action: ActionKey; field: string; keepReselection: boolean;
  policy: Pick<RowDetailPolicy<string, Value>, 'collection' | 'fields' | 'birth' | 'target' | 'proofs' | 'actions' | 'history'>;
};

function autosaveTarget<Field extends string, Item extends Value>(policy: RowDetailPolicy<Field, Item>, field: Field,
  stamp: RowFieldActionKind, draft: DraftKey, action: ActionKey): Target {
  const { collection, birth, proofs, actions, history } = policy;
  return { stamp, draft, action, field, keepReselection: Boolean(policy.allowUnchanged), policy: { collection, birth, proofs, actions, history,
    fields: [field], target: () => policy.target(field) } };
}

const TARGETS: readonly Target[] = [
  autosaveTarget(COUNCIL_TOPIC_TITLE_POLICY, 'title', 'council-topic-title', 'councilTopicTitleDrafts', 'councilTopicTitleActions'),
  autosaveTarget(GROUP_BLOCK_TITLE_POLICY, 'title', 'group-block-title', 'groupBlockTitleDrafts', 'groupBlockTitleActions'),
  autosaveTarget(GROUP_STEP_TITLE_POLICY, 'title', 'group-step-title', 'groupStepTitleDrafts', 'groupStepTitleActions'),
  autosaveTarget(GROUP_BLOCK_STATUS_POLICY, 'status', 'group-block-status', 'groupBlockStatusDrafts', 'groupBlockStatusActions'),
  autosaveTarget(GROUP_STEP_DURATION_POLICY, 'durationMin', 'group-step-duration', 'groupStepDurationDrafts', 'groupStepDurationActions'),
  autosaveTarget(THOUGHT_LOCK_POLICY, 'isLocked', 'thought-lock', 'thoughtLockDrafts', 'thoughtLockActions'),
];

const targetsFor = (collection: string) => TARGETS.filter(target => target.policy.collection === collection);
const fieldAt = (value: DocumentData | null | undefined, id: string, target: Target) =>
  existingRowField(value?.[target.policy.birth.field], id, target.policy.target(target.field));
const birthAt = (value: DocumentData | null | undefined, id: string, target: Target) =>
  existingRowField(value?.[target.policy.birth.field], id, target.policy.birth);
const sameCapture = (first: Action, second: Action) => first.rowId === second.rowId
  && first.rowCreatedAt === second.rowCreatedAt && first.before === second.before && first.after === second.after
  && first.observedRevision === second.observedRevision && equalValues(first.time, second.time);
const isCaptured = (checkpoint: SessionCheckpoint, action: Action, target: Target) => Object.values(checkpoint.pending)
  .some(request => request[target.action]?.some(captured => sameCapture(action, captured)));

function validDrafts(checkpoint: SessionCheckpoint, value: DocumentData | null, target: Target) {
  const metadata = checkpoint.confirmed.metadata;
  if (!metadata || metadata.deleted) return [];
  return Object.values(checkpoint[target.draft] ?? {}).filter(({ generation, action }) => generation === metadata.generation
    && action.observedRevision <= metadata.revision && fieldAt(value, action.rowId, target) === action.after
    && birthAt(value, action.rowId, target) === action.rowCreatedAt);
}

function observeRowEdit(checkpoint: SessionCheckpoint, value: DocumentData | null, visible: ShownCopy,
  target: Target, rowId: string, time: ActionTime | null, prior?: Action): Action | undefined {
  if (!boundedRowId(rowId)) return;
  const old = fieldAt(checkpoint.draft, rowId, target), after = fieldAt(value, rowId, target);
  const rowCreatedAt = birthAt(checkpoint.draft, rowId, target);
  if (old === undefined || after === undefined || (old === after && !target.keepReselection)
    || rowCreatedAt === undefined || birthAt(value, rowId, target) !== rowCreatedAt
    || (visible.draft && birthAt(visible.draft, rowId, target) !== rowCreatedAt)) return;
  const typing = prior && !isCaptured(checkpoint, prior, target);
  const shownValue = fieldAt(visible.draft, rowId, target);
  const before = typing ? prior.before : shownValue === undefined ? old : shownValue;
  const observedRevision = prior?.observedRevision ?? visible.confirmed.metadata!.revision;
  if (before !== after || target.keepReselection) return { rowId, rowCreatedAt, before, after, time, observedRevision };
}

function stageField(checkpoint: SessionCheckpoint, value: DocumentData | null, shown: ShownCopy | undefined,
  stamp: RowFieldStamp | undefined, target: Target): Draft[] {
  const staged = validDrafts(checkpoint, value, target);
  const metadata = checkpoint.confirmed.metadata;
  if (!metadata || metadata.deleted || stamp?.field !== target.stamp) return staged;
  const time = stamp.time === null ? null : boundedActionTime(stamp.time);
  if (time === undefined) return staged;
  const rowIds = 'rowIds' in stamp ? stamp.rowIds : [stamp.rowId];
  const priorById = new Map(validDrafts(checkpoint, checkpoint.draft, target).map(item => [item.action.rowId, item.action]));
  const visible = shown?.editGeneration === checkpoint.editGeneration
    && shown.confirmed.metadata?.generation === metadata.generation ? shown : checkpoint;
  for (const rowId of rowIds) {
    const action = observeRowEdit(checkpoint, value, visible, target, rowId, time, priorById.get(rowId));
    if (action) staged.push({ generation: metadata.generation, action });
  }
  return staged;
}

export function stageRowFields(checkpoint: SessionCheckpoint, value: DocumentData | null, shown: ShownCopy | undefined, stamp?: RowFieldStamp): void {
  for (const target of targetsFor(checkpoint.confirmed.resource.collection)) {
    const staged = stageField(checkpoint, value, shown, stamp, target);
    if (staged.length) checkpoint[target.draft] = Object.fromEntries(staged.map(draft => [draft.action.rowId, draft]));
    else delete checkpoint[target.draft];
  }
}

function uncaptured(checkpoint: SessionCheckpoint, target: Target) {
  return validDrafts(checkpoint, checkpoint.draft, target).map(draft => draft.action).filter(action => !isCaptured(checkpoint, action, target));
}

export function hasUncapturedAutosaveRowField(checkpoint: SessionCheckpoint): boolean {
  return targetsFor(checkpoint.confirmed.resource.collection).some(target => uncaptured(checkpoint, target).length > 0);
}

function manualDurationActions(checkpoint: SessionCheckpoint, baseline: ResourceSnapshot, opening: DocumentData | null,
  target: Target, captured: ActionTime | null | undefined): Action[] {
  if (target.stamp !== 'group-step-duration' || captured === undefined || !baseline.metadata || baseline.metadata.deleted) return [];
  const time = captured === null ? null : boundedActionTime(captured);
  if (time === undefined) return [];
  const field = target.policy.target(target.field);
  const shown = existingRowFields(opening?.[field.field], field);
  const next = existingRowFields(checkpoint.draft?.[field.field], field);
  return [...shown].flatMap(([rowId, before]) => {
    const after = next.get(rowId), rowCreatedAt = birthAt(opening, rowId, target);
    return boundedRowId(rowId) && before !== undefined && after !== undefined && before !== after
      && rowCreatedAt !== undefined && birthAt(checkpoint.draft, rowId, target) === rowCreatedAt
      ? [{ rowId, rowCreatedAt, before, after, time, observedRevision: baseline.metadata!.revision }] : [];
  });
}

export function captureRowFields(checkpoint: SessionCheckpoint, baseline: ResourceSnapshot,
  predecessor: CommitRequest | undefined, records: readonly CommitRequest[], manualTime?: ActionTime | null): AutosaveRowFieldActions {
  const byId = new Map(records.map(record => [record.id, record]));
  const opening = predecessor ? predecessor.value : baseline.value;
  const result: AutosaveRowFieldActions = {};
  for (const target of targetsFor(baseline.resource.collection)) {
    const actions = [...uncaptured(checkpoint, target), ...manualDurationActions(checkpoint, baseline, opening, target, manualTime)].filter(action => birthAt(opening, action.rowId, target) === action.rowCreatedAt)
      .map(action => {
        const predecessorOperationId = knownRowDetailPredecessor(predecessor, byId, baseline, target.policy, request => {
          const captured = request[target.action]?.find(item => item.rowId === action.rowId);
          if (captured) return captured;
          const parent = request.predecessor ? byId.get(request.predecessor)?.value : request.baseline.value;
          if (birthAt(parent, action.rowId, target) === undefined && fieldAt(request.value, action.rowId, target) === action.before) {
            return { rowId: action.rowId, rowCreatedAt: action.rowCreatedAt, after: action.before };
          }
        }, target.field, action.rowId, action.rowCreatedAt, action.before, undefined);
        return { ...action, ...(predecessorOperationId && { predecessorOperationId }) };
      });
    if (actions.length) result[target.action] = actions;
  }
  return result;
}

export function matchingRowFields(changes: FieldChange[], captured: AutosaveRowFieldActions, collection: string): AutosaveRowFieldActions {
  const result: AutosaveRowFieldActions = {};
  for (const target of targetsFor(collection)) {
    const actions = captured[target.action]?.filter(action => matchesRowDetailBirth(changes, action, target.policy.birth)
      && matchesRowAction(changes, action, target.policy.target(target.field)));
    if (actions?.length) result[target.action] = actions;
  }
  return result;
}

export function registerRowFields(pending: AutosaveRowFieldActions, captured: AutosaveRowFieldActions | undefined, collection: string): void {
  for (const { action } of targetsFor(collection)) {
    if (captured?.[action]) pending[action] = JSON.parse(JSON.stringify(captured[action])) as Action[];
  }
}

export function acknowledgeRowFields(checkpoint: SessionCheckpoint, captured: AutosaveRowFieldActions): void {
  for (const target of targetsFor(checkpoint.confirmed.resource.collection)) {
    const remaining = Object.entries(checkpoint[target.draft] ?? {}).filter(([, { action }]) =>
      !captured[target.action]?.some(sent => sameCapture(action, sent)));
    if (remaining.length) checkpoint[target.draft] = Object.fromEntries(remaining);
    else delete checkpoint[target.draft];
  }
}

export function clearRowFieldDrafts(checkpoint: SessionCheckpoint): void {
  for (const { draft } of targetsFor(checkpoint.confirmed.resource.collection)) delete checkpoint[draft];
}

export function rowFieldAckAncestor(ancestor: DocumentData | null, accepted: ResourceSnapshot,
  checkpoint: SessionCheckpoint): DocumentData | null {
  if (!ancestor || accepted.metadata?.generation !== checkpoint.confirmed.metadata?.generation) return ancestor;
  let rebased = ancestor;
  for (const target of targetsFor(checkpoint.confirmed.resource.collection)) {
    const field = target.policy.birth.field;
    let rows = rebased[field];
    for (const { action } of validDrafts(checkpoint, checkpoint.draft, target)) {
      const stored = fieldAt(accepted.value, action.rowId, target);
      if (stored !== undefined && fieldAt(ancestor, action.rowId, target) === action.before
        && birthAt(accepted.value, action.rowId, target) === action.rowCreatedAt) {
        rows = replaceExistingRowField(rows, action.rowId, stored, target.policy.target(target.field)) ?? rows;
      }
    }
    if (rows !== rebased[field]) rebased = { ...rebased, [field]: rows };
  }
  return rebased;
}

export function sameAutosaveRowFieldCaptures(first: CommitRequest, second: CommitRequest): boolean {
  return targetsFor(first.baseline.resource.collection).every(({ action }) => equalValues(first[action] ?? null, second[action] ?? null));
}

export function pendingAutosaveRowFieldRebases(record: CommitRequest) {
  return targetsFor(record.baseline.resource.collection).flatMap(target =>
    (record[target.action] ?? []).flatMap(action => pendingRowDetailRebases(record, { [target.field]: action }, target.policy)));
}

export function isCapturedAutosaveRowFieldConflict(conflict: ConflictDetail, record: CommitRequest): boolean {
  return targetsFor(record.baseline.resource.collection).some(target => record[target.action]?.some(action =>
    isCapturedRowConflict(conflict, action, target.policy.target(target.field))));
}

export function isAutosaveRowFieldPath(path: readonly string[] | undefined, collection: string): boolean {
  const id = path?.[1]?.startsWith('id:') ? path[1].slice(3) : undefined;
  return boundedRowId(id) && targetsFor(collection).some(target => equalValues(path, rowConflictPath(id, target.policy.target(target.field))));
}

export function hasAutosaveRowFieldCaptures(record: CommitRequest): boolean {
  return targetsFor(record.baseline.resource.collection).some(({ action }) => Boolean(record[action]?.length));
}

export function missingAutosaveRowFieldTarget(stored: DocumentData, record: CommitRequest): boolean {
  return targetsFor(record.baseline.resource.collection).some(target => record[target.action]?.some(action =>
    birthAt(stored, action.rowId, target) !== action.rowCreatedAt));
}
