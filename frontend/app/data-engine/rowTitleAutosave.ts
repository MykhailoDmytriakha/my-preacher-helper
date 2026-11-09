import { boundedActionTime } from './actionClock';
import { COUNCIL_TOPIC_TITLE_POLICY } from './councilTopicTitleAction';
import { equalValues } from './fieldValues';
import { GROUP_BLOCK_TITLE_POLICY, GROUP_STEP_TITLE_POLICY } from './groupFlowTitleAction';
import { matchesRowDetailBirth } from './rowDetailAction';
import { knownRowDetailPredecessor, pendingRowDetailRebases } from './rowDetailCapture';
import { boundedRowId, existingRowField, isCapturedRowConflict, matchesRowAction, replaceExistingRowField, rowConflictPath } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { RowDetailObservation, RowDetailPolicy } from './rowDetailAction';
import type { SessionCheckpoint, ShownCopy } from './session';
import type { ConflictDetail, DocumentData, FieldChange, ResourceSnapshot } from './types';

type Title = string | null;
type Action = RowDetailObservation<Title>;
type Draft = { generation: string; action: Action };
type DraftKey = 'councilTopicTitleDrafts' | 'groupBlockTitleDrafts' | 'groupStepTitleDrafts';
type ActionKey = 'councilTopicTitleActions' | 'groupBlockTitleActions' | 'groupStepTitleActions';
export type RowTitleField = 'council-topic-title' | 'group-block-title' | 'group-step-title';
export type RowTitleStamp = { field: RowTitleField; rowId: string; time: ActionTime | null };
export type RowTitleDrafts = Partial<Record<DraftKey, Record<string, Draft>>>;
export type RowTitleActions = Partial<Record<ActionKey, Action[]>>;

type Target = {
  stamp: RowTitleField; draft: DraftKey; action: ActionKey;
  policy: Pick<RowDetailPolicy<'title', Title>, 'collection' | 'fields' | 'birth' | 'target' | 'proofs' | 'actions' | 'history' | 'scopes'>;
};
const TARGETS: readonly Target[] = [
  { stamp: 'council-topic-title', draft: 'councilTopicTitleDrafts', action: 'councilTopicTitleActions', policy: COUNCIL_TOPIC_TITLE_POLICY },
  { stamp: 'group-block-title', draft: 'groupBlockTitleDrafts', action: 'groupBlockTitleActions', policy: GROUP_BLOCK_TITLE_POLICY },
  { stamp: 'group-step-title', draft: 'groupStepTitleDrafts', action: 'groupStepTitleActions', policy: GROUP_STEP_TITLE_POLICY },
];

const targetsFor = (collection: string) => TARGETS.filter(target => target.policy.collection === collection);
const fieldAt = (value: DocumentData | null | undefined, id: string, target: Target) =>
  existingRowField(value?.[target.policy.birth.field], id, target.policy.target('title'));
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

function stageTitle(checkpoint: SessionCheckpoint, value: DocumentData | null, shown: ShownCopy | undefined,
  stamp: RowTitleStamp | undefined, target: Target): Draft[] {
  const staged = validDrafts(checkpoint, value, target);
  const metadata = checkpoint.confirmed.metadata;
  if (!metadata || metadata.deleted || stamp?.field !== target.stamp || !boundedRowId(stamp.rowId)) return staged;
  const { rowId } = stamp;
  const old = fieldAt(checkpoint.draft, rowId, target), after = fieldAt(value, rowId, target);
  const time = stamp.time === null ? null : boundedActionTime(stamp.time);
  const rowCreatedAt = birthAt(checkpoint.draft, rowId, target);
  if (time === undefined || old === undefined || after === undefined || old === after
    || rowCreatedAt === undefined || birthAt(value, rowId, target) !== rowCreatedAt) return staged;
  const prior = validDrafts(checkpoint, checkpoint.draft, target).find(item => item.action.rowId === rowId)?.action;
  const typing = prior && !isCaptured(checkpoint, prior, target);
  const visible = shown?.editGeneration === checkpoint.editGeneration
    && shown.confirmed.metadata?.generation === metadata.generation ? shown : checkpoint;
  if (visible.draft && birthAt(visible.draft, rowId, target) !== rowCreatedAt) return staged;
  const shownTitle = fieldAt(visible.draft, rowId, target);
  const before = typing ? prior.before : shownTitle === undefined ? old : shownTitle;
  const observedRevision = prior?.observedRevision ?? visible.confirmed.metadata!.revision;
  if (before !== after) staged.push({ generation: metadata.generation, action: { rowId, rowCreatedAt, before, after, time, observedRevision } });
  return staged;
}

export function stageRowTitles(checkpoint: SessionCheckpoint, value: DocumentData | null, shown: ShownCopy | undefined, stamp?: RowTitleStamp): void {
  for (const target of targetsFor(checkpoint.confirmed.resource.collection)) {
    const staged = stageTitle(checkpoint, value, shown, stamp, target);
    if (staged.length) checkpoint[target.draft] = Object.fromEntries(staged.map(draft => [draft.action.rowId, draft]));
    else delete checkpoint[target.draft];
  }
}

function uncaptured(checkpoint: SessionCheckpoint, target: Target) {
  return validDrafts(checkpoint, checkpoint.draft, target).map(draft => draft.action).filter(action => !isCaptured(checkpoint, action, target));
}

export function hasUncapturedRowTitle(checkpoint: SessionCheckpoint): boolean {
  return targetsFor(checkpoint.confirmed.resource.collection).some(target => uncaptured(checkpoint, target).length > 0);
}

export function captureRowTitles(checkpoint: SessionCheckpoint, baseline: ResourceSnapshot,
  predecessor: CommitRequest | undefined, records: readonly CommitRequest[]): RowTitleActions {
  const byId = new Map(records.map(record => [record.id, record]));
  const opening = predecessor ? predecessor.value : baseline.value;
  const result: RowTitleActions = {};
  for (const target of targetsFor(baseline.resource.collection)) {
    const actions = uncaptured(checkpoint, target).filter(action => birthAt(opening, action.rowId, target) === action.rowCreatedAt)
      .map(action => {
        const predecessorOperationId = knownRowDetailPredecessor(predecessor, byId, baseline, target.policy, request => {
          const captured = request[target.action]?.find(item => item.rowId === action.rowId);
          if (captured) return captured;
          const parent = request.predecessor ? byId.get(request.predecessor)?.value : request.baseline.value;
          if (birthAt(parent, action.rowId, target) === undefined && fieldAt(request.value, action.rowId, target) === action.before) {
            return { rowId: action.rowId, rowCreatedAt: action.rowCreatedAt, after: action.before };
          }
        }, 'title', action.rowId, action.rowCreatedAt, action.before, undefined);
        return { ...action, ...(predecessorOperationId && { predecessorOperationId }) };
      });
    if (actions.length) result[target.action] = actions;
  }
  return result;
}

export function matchingRowTitles(changes: FieldChange[], captured: RowTitleActions, collection: string): RowTitleActions {
  const result: RowTitleActions = {};
  for (const target of targetsFor(collection)) {
    const actions = captured[target.action]?.filter(action => matchesRowDetailBirth(changes, action, target.policy.birth)
      && matchesRowAction(changes, action, target.policy.target('title')));
    if (actions?.length) result[target.action] = actions;
  }
  return result;
}

export function registerRowTitles(pending: RowTitleActions, captured: RowTitleActions | undefined, collection: string): void {
  for (const { action } of targetsFor(collection)) {
    if (captured?.[action]) pending[action] = JSON.parse(JSON.stringify(captured[action])) as Action[];
  }
}

export function acknowledgeRowTitles(checkpoint: SessionCheckpoint, captured: RowTitleActions): void {
  for (const target of targetsFor(checkpoint.confirmed.resource.collection)) {
    const remaining = Object.entries(checkpoint[target.draft] ?? {}).filter(([, { action }]) =>
      !captured[target.action]?.some(sent => sameCapture(action, sent)));
    if (remaining.length) checkpoint[target.draft] = Object.fromEntries(remaining);
    else delete checkpoint[target.draft];
  }
}

export function clearRowTitleDrafts(checkpoint: SessionCheckpoint): void {
  for (const { draft } of targetsFor(checkpoint.confirmed.resource.collection)) delete checkpoint[draft];
}

export function rowTitleAckAncestor(ancestor: DocumentData | null, accepted: ResourceSnapshot,
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
        rows = replaceExistingRowField(rows, action.rowId, stored, target.policy.target('title')) ?? rows;
      }
    }
    if (rows !== rebased[field]) rebased = { ...rebased, [field]: rows };
  }
  return rebased;
}

export function sameRowTitleCaptures(first: CommitRequest, second: CommitRequest): boolean {
  return targetsFor(first.baseline.resource.collection).every(({ action }) => equalValues(first[action] ?? null, second[action] ?? null));
}

export function pendingRowTitleRebases(record: CommitRequest) {
  return targetsFor(record.baseline.resource.collection).flatMap(target =>
    (record[target.action] ?? []).flatMap(title => pendingRowDetailRebases(record, { title }, target.policy)));
}

export function isCapturedRowTitleConflict(conflict: ConflictDetail, record: CommitRequest): boolean {
  return targetsFor(record.baseline.resource.collection).some(target => record[target.action]?.some(action =>
    isCapturedRowConflict(conflict, action, target.policy.target('title'))));
}

export function isRowTitlePath(path: readonly string[] | undefined, collection: string): boolean {
  const id = path?.[1]?.startsWith('id:') ? path[1].slice(3) : undefined;
  return boundedRowId(id) && targetsFor(collection).some(target => equalValues(path, rowConflictPath(id, target.policy.target('title'))));
}

export function hasRowTitleCaptures(record: CommitRequest): boolean {
  return targetsFor(record.baseline.resource.collection).some(({ action }) => Boolean(record[action]?.length));
}

export function missingRowTitleTarget(stored: DocumentData, record: CommitRequest): boolean {
  return targetsFor(record.baseline.resource.collection).some(target => record[target.action]?.some(action =>
    birthAt(stored, action.rowId, target) !== action.rowCreatedAt));
}
