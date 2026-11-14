import { boundedActionTime } from './actionClock';
import { COUNCIL_OUTCOME, COUNCIL_OUTCOME_POLICY, councilOutcomeRow } from './councilOutcomeAction';
import { COUNCIL_TOPIC_KIND, councilTopicKindRow } from './councilTopicKindAction';
import { COUNCIL_TOPIC_SUMMARY_POLICY, COUNCIL_TOPIC_TITLE_POLICY } from './councilTopicTitleAction';
import { equalValues, object } from './fieldValues';
import { GROUP_BLOCK_STATUS_POLICY } from './groupBlockStatusAction';
import { GROUP_BLOCK_CONTENT_POLICY, GROUP_BLOCK_TITLE_POLICY, GROUP_STEP_NOTES_POLICY, GROUP_STEP_TITLE_POLICY } from './groupFlowTitleAction';
import { GROUP_STEP_DURATION_POLICY } from './groupStepDurationAction';
import { outlinePlacementField } from './outlinePlacementResource';
import { outlineTitleId, outlineTitlePath, outlineTitlePolicy, OUTLINE_TITLE_QUEUED, OUTLINE_TITLE_SETTLED } from './outlineTitleAction';
import { matchesRowDetailBirth } from './rowDetailAction';
import { knownRowDetailPredecessor, pendingRowDetailRebases } from './rowDetailCapture';
import { boundedRowId, existingRowField, existingRowFields, isCapturedRowConflict, matchesRowAction, replaceExistingRowField, rowConflictPath, rowConflictValue } from './rowFieldAction';
import { THOUGHT_LOCK_POLICY } from './thoughtLockAction';
import { isThoughtLocation, isThoughtPlacementPart, THOUGHT_PLACEMENT_POLICY } from './thoughtPlacementAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { RowDetailObservation, RowDetailPolicy } from './rowDetailAction';
import type { SessionCheckpoint, ShownCopy } from './session';
import type { ConflictDetail, DocumentData, FieldChange, ResourceSnapshot } from './types';
import type { OutlineTitleOpening } from '@/utils/sermonNoteText';


type Value = string | number | boolean | null | DocumentData;
type Action = RowDetailObservation<Value>;
type Draft = { generation: string; action: Action; reviewed?: true };
type DraftKey = 'councilOutcomeDrafts' | 'councilTopicTitleDrafts' | 'councilTopicSummaryDrafts' | 'groupBlockTitleDrafts' | 'groupStepTitleDrafts' | 'groupBlockContentDrafts' | 'groupStepNotesDrafts' | 'groupBlockStatusDrafts' | 'groupStepDurationDrafts' | 'thoughtLockDrafts' | 'thoughtPlacementDrafts' | 'outlineTitleDrafts';
type ActionKey = 'councilOutcomeActions' | 'councilTopicTitleActions' | 'councilTopicSummaryActions' | 'groupBlockTitleActions' | 'groupStepTitleActions' | 'groupBlockContentActions' | 'groupStepNotesActions' | 'groupBlockStatusActions' | 'groupStepDurationActions' | 'thoughtLockActions' | 'thoughtPlacementActions' | 'outlineTitleActions';
export type RowFieldActionKind = 'council-topic-outcome' | 'council-topic-title' | 'council-topic-summary' | 'group-block-title' | 'group-step-title' | 'group-block-content' | 'group-step-notes' | 'group-block-status' | 'group-step-duration' | 'thought-lock' | 'thought-placement' | 'outline-title';
export type RowFieldStamp = { field: RowFieldActionKind; time: ActionTime | null } & (
  { rowId: string; titleOpening?: OutlineTitleOpening } | { rowIds: readonly string[] }
);
export type RowFieldDrafts = Partial<Record<DraftKey, Record<string, Draft>>>;
export type AutosaveRowFieldActions = Partial<Record<ActionKey, Action[]>>;

type Target = {
  stamp: RowFieldActionKind; draft: DraftKey; action: ActionKey; field: string; keepReselection: boolean;
  policy: Pick<RowDetailPolicy<string, Value>, 'collection' | 'fields' | 'birth' | 'target' | 'acceptsRowId' | 'proofs' | 'actions' | 'history'>;
};

function autosaveTarget<Field extends string, Item extends Value>(policy: RowDetailPolicy<Field, Item>, field: Field,
  stamp: RowFieldActionKind, draft: DraftKey, action: ActionKey): Target {
  const { collection, birth, proofs, actions, history, acceptsRowId } = policy;
  return { stamp, draft, action, field, keepReselection: Boolean(policy.allowUnchanged), policy: { collection, birth, proofs, actions, history, acceptsRowId,
    fields: [field], target: () => policy.target(field) } };
}

const TARGETS: readonly Target[] = [
  autosaveTarget(COUNCIL_OUTCOME_POLICY, 'outcome', 'council-topic-outcome', 'councilOutcomeDrafts', 'councilOutcomeActions'),
  autosaveTarget(COUNCIL_TOPIC_TITLE_POLICY, 'title', 'council-topic-title', 'councilTopicTitleDrafts', 'councilTopicTitleActions'),
  autosaveTarget(COUNCIL_TOPIC_SUMMARY_POLICY, 'summary', 'council-topic-summary', 'councilTopicSummaryDrafts', 'councilTopicSummaryActions'),
  autosaveTarget(GROUP_BLOCK_TITLE_POLICY, 'title', 'group-block-title', 'groupBlockTitleDrafts', 'groupBlockTitleActions'),
  autosaveTarget(GROUP_STEP_TITLE_POLICY, 'title', 'group-step-title', 'groupStepTitleDrafts', 'groupStepTitleActions'),
  autosaveTarget(GROUP_BLOCK_CONTENT_POLICY, 'content', 'group-block-content', 'groupBlockContentDrafts', 'groupBlockContentActions'),
  autosaveTarget(GROUP_STEP_NOTES_POLICY, 'instanceNotes', 'group-step-notes', 'groupStepNotesDrafts', 'groupStepNotesActions'),
  autosaveTarget(GROUP_BLOCK_STATUS_POLICY, 'status', 'group-block-status', 'groupBlockStatusDrafts', 'groupBlockStatusActions'),
  autosaveTarget(GROUP_STEP_DURATION_POLICY, 'durationMin', 'group-step-duration', 'groupStepDurationDrafts', 'groupStepDurationActions'),
  autosaveTarget(THOUGHT_LOCK_POLICY, 'isLocked', 'thought-lock', 'thoughtLockDrafts', 'thoughtLockActions'),
  autosaveTarget(THOUGHT_PLACEMENT_POLICY, 'outlineLocation', 'thought-placement', 'thoughtPlacementDrafts', 'thoughtPlacementActions'),
  ...['sermons', 'planTemplates'].map(collection => autosaveTarget(outlineTitlePolicy(collection)!, 'text', 'outline-title',
    'outlineTitleDrafts', 'outlineTitleActions')),
];

const targetsFor = (collection: string) => TARGETS.filter(target => target.policy.collection === collection);
const fieldAt = (value: DocumentData | null | undefined, id: string, target: Target) =>
  existingRowField(value?.[target.policy.birth.field], id, target.policy.target(target.field));
const birthAt = (value: DocumentData | null | undefined, id: string, target: Target) =>
  existingRowField(value?.[target.policy.birth.field], id, target.policy.birth);
const sameCapture = (first: Action, second: Action) => first.rowId === second.rowId
  && first.rowCreatedAt === second.rowCreatedAt && equalValues(first.before, second.before) && equalValues(first.after, second.after)
  && first.observedRevision === second.observedRevision && equalValues(first.time, second.time);
const isCaptured = (checkpoint: SessionCheckpoint, action: Action, target: Target) => Object.values(checkpoint.pending)
  .some(request => request[target.action]?.some(captured => sameCapture(action, captured)));

export function hasRowProofTarget(collection: string, key: string): boolean {
  return targetsFor(collection).some(target => target.draft === key);
}

export type UnreadableRowProof = { field: DraftKey; rowId: string; birth: string; generation: string };

/** Recover a row address only from a structurally valid identity in the draft that carried the proof. */
export function unreadableRowProofs(collection: string, key: string, raw: unknown, draft: DocumentData | null): UnreadableRowProof[] {
  const target = targetsFor(collection).find(item => item.draft === key);
  if (!target || !object(raw)) return [];
  return Object.entries(raw).flatMap(([rowId, row]) => {
    if (!(target.policy.acceptsRowId ?? boundedRowId)(rowId) || !object(row) || !object(row.action)
      || row.action.rowId !== rowId || typeof row.action.rowCreatedAt !== 'string' || typeof row.generation !== 'string'
      || birthAt(draft, rowId, target) !== row.action.rowCreatedAt) return [];
    return [{ field: target.draft, rowId, birth: row.action.rowCreatedAt, generation: row.generation }];
  });
}

/** A row choice reads and replaces one field only while the original row still exists. */
export function unreadableRowChoice(checkpoint: SessionCheckpoint, address: UnreadableRowProof) {
  const { confirmed, draft } = checkpoint;
  const stored = checkpoint.remoteCandidate ?? confirmed;
  const target = targetsFor(confirmed.resource.collection).find(item => item.draft === address.field);
  if (!target || !draft || !confirmed.value || address.generation !== confirmed.metadata?.generation) return;
  const { rowId, birth } = address;
  const rowField = target.policy.target(target.field);
  const path = target.stamp === 'outline-title'
    ? outlineTitlePath(outlinePlacementField(confirmed.resource.collection)!, rowId, draft[rowField.field])
    : rowConflictPath(rowId, rowField);
  if (!path) return;
  const original = (value: DocumentData | null) => birthAt(value, rowId, target) === birth;
  const opening = original(confirmed.value) ? fieldAt(confirmed.value, rowId, target) : undefined;
  const mine = original(draft) ? fieldAt(draft, rowId, target) : undefined;
  const theirs = address.generation === stored.metadata?.generation && original(stored.value) ? fieldAt(stored.value, rowId, target) : undefined;
  if (mine === undefined) return;
  const apply = (value: DocumentData, field: 'opening' | 'mine') => {
    const selected = field === 'opening' ? opening : mine;
    if (selected === undefined || !original(value)) return value;
    const rows = replaceExistingRowField(value[rowField.field], rowId, selected, rowField);
    return rows === undefined ? value : { ...value, [rowField.field]: rows };
  };
  return { path, base: rowConflictValue(opening ?? null), mine: rowConflictValue(mine), theirs: rowConflictValue(theirs ?? null),
    available: theirs !== undefined, apply };
}

function validDrafts(checkpoint: SessionCheckpoint, value: DocumentData | null, target: Target) {
  const metadata = checkpoint.confirmed.metadata;
  if (!metadata || metadata.deleted) return [];
  return Object.values(checkpoint[target.draft] ?? {}).filter(({ generation, action }) => generation === metadata.generation
    && action.observedRevision <= metadata.revision && equalValues(fieldAt(value, action.rowId, target), action.after)
    && birthAt(value, action.rowId, target) === action.rowCreatedAt);
}

function observeRowEdit(checkpoint: SessionCheckpoint, value: DocumentData | null, visible: ShownCopy,
  target: Target, rowId: string, time: ActionTime | null, prior?: Action, opening?: OutlineTitleOpening): Action | undefined {
  if (!(target.policy.acceptsRowId ?? boundedRowId)(rowId)) return;
  const old = fieldAt(checkpoint.draft, rowId, target), after = fieldAt(value, rowId, target);
  const rowCreatedAt = birthAt(checkpoint.draft, rowId, target);
  if (old === undefined || after === undefined || (equalValues(old, after) && !target.keepReselection)
    || rowCreatedAt === undefined || birthAt(value, rowId, target) !== rowCreatedAt
    || (!opening && visible.draft && birthAt(visible.draft, rowId, target) !== rowCreatedAt)) return;
  const typing = prior && !isCaptured(checkpoint, prior, target);
  const shownValue = fieldAt(visible.draft, rowId, target);
  const before = typing ? prior.before : opening?.text ?? (shownValue === undefined ? old : shownValue);
  const observedRevision = prior?.observedRevision ?? opening?.version?.observedRevision ?? visible.confirmed.metadata!.revision;
  if (!equalValues(before, after) || target.keepReselection) return { rowId, rowCreatedAt, before, after, time, observedRevision };
}

function carryReviewedCouncilDrafts(checkpoint: SessionCheckpoint, value: DocumentData | null, target: Target): Draft[] {
  const revision = checkpoint.confirmed.metadata?.revision;
  return validDrafts(checkpoint, checkpoint.draft, target).flatMap(draft => {
    const action = draft.action;
    if (!draft.reviewed || action.observedRevision !== revision || isCaptured(checkpoint, action, target)) return [];
    const after = fieldAt(value, action.rowId, target);
    return after !== undefined && !equalValues(after, action.after) && birthAt(value, action.rowId, target) === action.rowCreatedAt
      ? [{ ...draft, action: { ...action, after } }] : [];
  });
}

function stageField(checkpoint: SessionCheckpoint, value: DocumentData | null, shown: ShownCopy | undefined,
  stamp: RowFieldStamp | undefined, target: Target): Draft[] {
  const staged = validDrafts(checkpoint, value, target);
  if (target.action === 'councilOutcomeActions') staged.push(...carryReviewedCouncilDrafts(checkpoint, value, target));
  const metadata = checkpoint.confirmed.metadata;
  if (!metadata || metadata.deleted || stamp?.field !== target.stamp) return staged;
  const time = stamp.time === null ? null : boundedActionTime(stamp.time);
  if (time === undefined) return staged;
  const opening = target.stamp === 'outline-title' && 'titleOpening' in stamp ? stamp.titleOpening : undefined;
  if (opening && (opening.version?.generation !== metadata.generation || opening.version.observedRevision > metadata.revision)) return staged;
  const rowIds = 'rowIds' in stamp ? stamp.rowIds : [stamp.rowId];
  const priorById = new Map(validDrafts(checkpoint, checkpoint.draft, target).map(item => [item.action.rowId, item.action]));
  const visible = shown?.editGeneration === checkpoint.editGeneration
    && shown.confirmed.metadata?.generation === metadata.generation ? shown : checkpoint;
  for (const rowId of rowIds) {
    const action = observeRowEdit(checkpoint, value, visible, target, rowId, time, priorById.get(rowId), opening);
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

/** A deliberate version choice sees the saved topic frame, including a kind-only change. */
export function stageReviewedCouncilTopics(checkpoint: SessionCheckpoint, conflicts: readonly ConflictDetail[]): void {
  const { confirmed, draft } = checkpoint;
  if (confirmed.resource.collection !== 'councils' || !confirmed.metadata || !confirmed.value || !draft) return;
  const { generation, revision: observedRevision } = confirmed.metadata;
  const rows = new Set(conflicts.flatMap(({ path }) => councilOutcomeRow(path) ?? councilTopicKindRow(path) ?? []));
  if (!rows.size) return;
  const opening = existingRowFields(confirmed.value.topics, COUNCIL_OUTCOME), proposed = existingRowFields(draft.topics, COUNCIL_OUTCOME);
  const beforeKinds = existingRowFields(confirmed.value.topics, COUNCIL_TOPIC_KIND), afterKinds = existingRowFields(draft.topics, COUNCIL_TOPIC_KIND);
  const birth = COUNCIL_OUTCOME_POLICY.birth;
  const beforeBirths = existingRowFields(confirmed.value.topics, birth), afterBirths = existingRowFields(draft.topics, birth);
  const stamps = [...rows].flatMap(rowId => {
    const before = opening.get(rowId), after = proposed.get(rowId), rowCreatedAt = beforeBirths.get(rowId);
    if (!before || !after || !rowCreatedAt || rowCreatedAt !== afterBirths.get(rowId)
      || (equalValues(before, after) && beforeKinds.get(rowId) === afterKinds.get(rowId))) return [];
    return [[rowId, { generation, reviewed: true, action: { rowId, rowCreatedAt, before, after, time: null, observedRevision } }]] as const;
  });
  if (stamps.length) checkpoint.councilOutcomeDrafts = { ...checkpoint.councilOutcomeDrafts, ...Object.fromEntries(stamps) };
}

export function stageReviewedGroupFlowText(checkpoint: SessionCheckpoint, paths: readonly (readonly string[])[], time: ActionTime | null): void {
  if (checkpoint.confirmed.resource.collection === 'groups') {
    stageReviewedRowFields(checkpoint, paths, time, ['group-block-content', 'group-step-notes']);
  }
}

export function stageReviewedRowFields(checkpoint: SessionCheckpoint, paths: readonly (readonly string[])[], time: ActionTime | null,
  kinds?: readonly RowFieldActionKind[]): void {
  const { confirmed, draft } = checkpoint;
  const metadata = confirmed.metadata;
  if (!metadata || metadata.deleted || !draft) return;
  for (const target of targetsFor(confirmed.resource.collection).filter(item => !kinds || kinds.includes(item.stamp))) {
    const field = target.policy.target(target.field);
    for (const path of paths) {
      const rowId = path[1]?.startsWith('id:') ? path[1].slice(3) : undefined;
      if (!rowId || !equalValues(path, rowConflictPath(rowId, field))) continue;
      const before = fieldAt(confirmed.value, rowId, target), after = fieldAt(draft, rowId, target);
      const rowCreatedAt = birthAt(confirmed.value, rowId, target);
      if (before === undefined || after === undefined || equalValues(before, after) || rowCreatedAt === undefined
        || birthAt(draft, rowId, target) !== rowCreatedAt) continue;
      checkpoint[target.draft] = { ...checkpoint[target.draft],
        [rowId]: { generation: metadata.generation, action: { rowId, rowCreatedAt, before, after, observedRevision: metadata.revision, time } } };
    }
  }
}

/** A title choice sees the exact saved revision, even when it contains a repeated title. */
export function stageReviewedOutlineTitles(checkpoint: SessionCheckpoint, conflicts: readonly ConflictDetail[], time: ActionTime | null): void {
  const collection = checkpoint.confirmed.resource.collection;
  stageReviewedOutlineTitleIds(checkpoint, conflicts.flatMap(({ path }) => outlineTitleId(path, collection) ?? []), time);
}

export function stageReviewedOutlineTitleIds(checkpoint: SessionCheckpoint, ids: readonly string[], time: ActionTime | null): void {
  const { confirmed, draft } = checkpoint;
  const metadata = confirmed.metadata;
  if (!metadata || metadata.deleted || !draft) return;
  const collection = confirmed.resource.collection;
  const target = targetsFor(collection).find(item => item.stamp === 'outline-title');
  if (!target) return;
  for (const rowId of ids) {
    const before = fieldAt(confirmed.value, rowId, target), after = fieldAt(draft, rowId, target);
    const rowCreatedAt = birthAt(confirmed.value, rowId, target);
    if (typeof before !== 'string' || typeof after !== 'string' || before === after || rowCreatedAt === undefined
      || birthAt(draft, rowId, target) !== rowCreatedAt) continue;
    checkpoint.outlineTitleDrafts = { ...checkpoint.outlineTitleDrafts,
      [rowId]: { generation: metadata.generation, action: { rowId, rowCreatedAt, before, after, observedRevision: metadata.revision, time } } };
  }
}

/** Preserve independent title actions and queued winners through a choice about a different field. */
export function carryOutlineTitleActions(source: SessionCheckpoint, checkpoint: SessionCheckpoint): void {
  const { confirmed, draft } = checkpoint;
  const metadata = confirmed.metadata;
  const collection = confirmed.resource.collection;
  const target = targetsFor(collection).find(item => item.stamp === 'outline-title');
  if (!target || !metadata || metadata.deleted || source.confirmed.metadata?.generation !== metadata.generation) return;
  const staged = Object.values(source.outlineTitleDrafts ?? {}).filter(({ generation, action }) =>
    generation === metadata.generation && action.observedRevision <= metadata.revision
    && fieldAt(draft, action.rowId, target) === action.after && fieldAt(confirmed.value, action.rowId, target) !== action.after
    && birthAt(confirmed.value, action.rowId, target) === action.rowCreatedAt && birthAt(draft, action.rowId, target) === action.rowCreatedAt);
  if (staged.length) checkpoint.outlineTitleDrafts = { ...checkpoint.outlineTitleDrafts,
    ...Object.fromEntries(staged.map(item => [item.action.rowId, item])) };
  for (const { path, code, mine } of source.conflicts) {
    const rowId = code === OUTLINE_TITLE_QUEUED && outlineTitleId(path, collection);
    if (!rowId || checkpoint.outlineTitleDrafts?.[rowId] || fieldAt(draft, rowId, target) !== mine.value || fieldAt(confirmed.value, rowId, target) === mine.value) continue;
    const actions = [source.outlineTitleDrafts?.[rowId]?.action, ...Object.values(source.pending).flatMap(value => value.outlineTitleActions ?? [])];
    const action = actions.find(candidate => candidate?.rowId === rowId && candidate.after === mine.value
      && candidate.observedRevision <= metadata.revision && birthAt(confirmed.value, rowId, target) === candidate.rowCreatedAt);
    if (action) checkpoint.outlineTitleDrafts = { ...checkpoint.outlineTitleDrafts, [rowId]: { generation: metadata.generation, action } };
  }
}

function uncaptured(checkpoint: SessionCheckpoint, target: Target) {
  return validDrafts(checkpoint, checkpoint.draft, target).map(draft => draft.action).filter(action => !isCaptured(checkpoint, action, target));
}

export function hasUncapturedAutosaveRowField(checkpoint: SessionCheckpoint): boolean {
  return targetsFor(checkpoint.confirmed.resource.collection).some(target => uncaptured(checkpoint, target).length > 0);
}

function manualRowActions(checkpoint: SessionCheckpoint, baseline: ResourceSnapshot, opening: DocumentData | null,
  target: Target, captured: ActionTime | null | undefined, thoughtPlacementIds?: readonly string[]): Action[] {
  const selectedByForm = target.stamp === 'group-step-duration' || target.stamp === 'council-topic-outcome' || target.stamp === 'outline-title';
  const placement = target.stamp === 'thought-placement' ? thoughtPlacementIds?.filter(boundedRowId) : undefined;
  if ((!selectedByForm && !placement?.length) || captured === undefined || !baseline.metadata || baseline.metadata.deleted) return [];
  const time = captured === null ? null : boundedActionTime(captured);
  if (time === undefined) return [];
  const field = target.policy.target(target.field);
  const shown = existingRowFields(opening?.[field.field], field);
  const next = existingRowFields(checkpoint.draft?.[field.field], field);
  const candidates = placement ? [...new Set(placement)].map(id => [id, shown.get(id)] as const) : [...shown];
  return candidates.flatMap(([rowId, before]) => {
    const after = next.get(rowId), rowCreatedAt = birthAt(opening, rowId, target);
    return (target.policy.acceptsRowId ?? boundedRowId)(rowId) && before !== undefined && after !== undefined && !equalValues(before, after)
      && rowCreatedAt !== undefined && birthAt(checkpoint.draft, rowId, target) === rowCreatedAt
      ? [{ rowId, rowCreatedAt, before, after, time, observedRevision: baseline.metadata!.revision }] : [];
  });
}

export function captureRowFields(checkpoint: SessionCheckpoint, baseline: ResourceSnapshot,
  predecessor: CommitRequest | undefined, records: readonly CommitRequest[], manualTime?: ActionTime | null, thoughtPlacementIds?: readonly string[]): AutosaveRowFieldActions {
  const byId = new Map(records.map(record => [record.id, record]));
  const opening = predecessor ? predecessor.value : baseline.value;
  const result: AutosaveRowFieldActions = {};
  for (const target of targetsFor(baseline.resource.collection)) {
    const autosaved = uncaptured(checkpoint, target);
    const manual = manualRowActions(checkpoint, baseline, opening, target, manualTime, thoughtPlacementIds);
    const autosavedIds = new Set(autosaved.map(action => action.rowId));
    const actions = [...autosaved, ...manual.filter(action => !autosavedIds.has(action.rowId))]
      .filter(action => birthAt(opening, action.rowId, target) === action.rowCreatedAt)
      .map(action => {
        const outcome = target.action === 'councilOutcomeActions';
        const policy: RowDetailPolicy<string, Value> = outcome
          ? { ...target.policy, scopes: rows => COUNCIL_OUTCOME_POLICY.scopes?.(rows, 'outcome') }
          : target.policy;
        const scope = policy.scopes?.(opening?.[policy.birth.field], target.field)?.get(action.rowId);
        const predecessorOperationId = knownRowDetailPredecessor(predecessor, byId, baseline, policy, request => {
          const captured = request[target.action]?.find(item => item.rowId === action.rowId);
          if (captured) return captured;
          const parent = request.predecessor ? byId.get(request.predecessor)?.value : request.baseline.value;
          const created = birthAt(parent, action.rowId, target) === undefined;
          const changedType = outcome && request.councilTopicKindActions?.kind.rowId === action.rowId;
          if ((created || changedType) && equalValues(fieldAt(request.value, action.rowId, target), action.before)) {
            return { rowId: action.rowId, rowCreatedAt: action.rowCreatedAt, after: action.before };
          }
        }, target.field, action.rowId, action.rowCreatedAt, action.before, scope);
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

export function restoreSavedRowFieldDrafts(request: CommitRequest, checkpoint: SessionCheckpoint): void {
  const generation = checkpoint.confirmed.metadata?.generation;
  if (!generation) return;
  for (const { draft, action } of targetsFor(checkpoint.confirmed.resource.collection)) {
    const saved = request[action];
    if (saved?.length) checkpoint[draft] = Object.fromEntries(saved.map(item => [item.rowId, { generation, action: item }]));
  }
}

export function carryRowFieldDrafts(source: SessionCheckpoint, target: SessionCheckpoint,
  keep: (path: readonly string[]) => boolean): void {
  for (const field of targetsFor(target.confirmed.resource.collection)) {
    if (!source[field.draft]) continue;
    target[field.draft] = source[field.draft];
    const outline = field.stamp === 'outline-title' ? outlinePlacementField(field.policy.collection) : undefined;
    const valid = validDrafts(target, target.draft, field)
      .filter(({ action }) => keep((outline && outlineTitlePath(outline, action.rowId, target.draft?.[outline]))
        || rowConflictPath(action.rowId, field.policy.target(field.field))));
    if (valid.length) target[field.draft] = Object.fromEntries(valid.map(item => [item.action.rowId, item]));
    else delete target[field.draft];
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
      if (stored !== undefined && equalValues(fieldAt(ancestor, action.rowId, target), action.before)
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

/** Keep the observed pair whole until the server can compare it with the accepted outline. */
export function retainQueuedThoughtPlacements(merged: DocumentData | null, opening: DocumentData | null, draft: DocumentData | null,
  stored: DocumentData | null, captured: CommitRequest['thoughtPlacementActions']): DocumentData | null {
  if (!merged || !opening || !draft || !stored || !captured?.length) return merged;
  const { birth } = THOUGHT_PLACEMENT_POLICY;
  const target = THOUGHT_PLACEMENT_POLICY.target(THOUGHT_PLACEMENT_POLICY.fields[0]);
  let rows = merged.thoughts;
  for (const action of captured) {
    if (!isThoughtLocation(action.after) || !equalValues(existingRowField(opening.thoughts, action.rowId, target), action.before)
      || !equalValues(existingRowField(draft.thoughts, action.rowId, target), action.after)
      || ![opening.thoughts, draft.thoughts, stored.thoughts, rows].every(value => existingRowField(value, action.rowId, birth) === action.rowCreatedAt)) continue;
    rows = replaceExistingRowField(rows, action.rowId, action.after, target) ?? rows;
  }
  return rows === merged.thoughts ? merged : { ...merged, thoughts: rows };
}

function capturedPlacementPart(conflict: ConflictDetail, action: Action): boolean {
  const key = conflict.path[2];
  if (!isThoughtPlacementPart(conflict.path, action.rowId) || (key !== 'outlinePointId' && key !== 'subPointId')
    || !isThoughtLocation(action.before) || !isThoughtLocation(action.after)) return false;
  return equalValues(conflict.base.value ?? null, action.before[key]) && equalValues(conflict.mine.value ?? null, action.after[key]);
}

export function isCapturedAutosaveRowFieldConflict(conflict: ConflictDetail, record: CommitRequest): boolean {
  const collection = record.baseline.resource.collection;
  return targetsFor(collection).some(target => record[target.action]?.some(action =>
    isCapturedRowConflict(target.stamp === 'outline-title' && outlineTitleId(conflict.path, collection) === action.rowId
      ? { ...conflict, path: rowConflictPath(action.rowId, target.policy.target(target.field)) } : conflict, action, target.policy.target(target.field))
    || (target.stamp === 'thought-placement' && capturedPlacementPart(conflict, action))));
}

export function isAutosaveRowFieldPath(path: readonly string[] | undefined, collection: string): boolean {
  if (path && outlineTitleId(path, collection)) return true;
  const id = path?.[1]?.startsWith('id:') ? path[1].slice(3) : undefined;
  return boundedRowId(id) && targetsFor(collection).some(target => equalValues(path, rowConflictPath(id, target.policy.target(target.field))));
}

export function hasAutosaveRowFieldCaptures(record: CommitRequest): boolean {
  return targetsFor(record.baseline.resource.collection).some(({ action }) => Boolean(record[action]?.length));
}

export function missingAutosaveRowFieldTarget(stored: DocumentData, record: CommitRequest, conflicts: readonly ConflictDetail[] = []): boolean {
  const collection = record.baseline.resource.collection;
  const resolved = new Set(conflicts.flatMap(({ code, path }) =>
    code === OUTLINE_TITLE_SETTLED || code === OUTLINE_TITLE_QUEUED ? outlineTitleId(path, collection) ?? [] : []));
  return targetsFor(collection).some(target => record[target.action]?.some(action =>
    (target.stamp !== 'outline-title' || !resolved.has(action.rowId)) && birthAt(stored, action.rowId, target) !== action.rowCreatedAt));
}
