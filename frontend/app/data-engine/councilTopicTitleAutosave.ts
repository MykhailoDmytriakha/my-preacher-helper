import { boundedActionTime } from './actionClock';
import { COUNCIL_TOPIC_TITLE, COUNCIL_TOPIC_TITLE_POLICY } from './councilTopicTitleAction';
import { equalValues } from './fieldValues';
import { matchesRowDetailBirth } from './rowDetailAction';
import { knownRowDetailPredecessor } from './rowDetailCapture';
import { boundedRowId, existingRowField, matchesRowAction, replaceExistingRowField } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { CouncilTopicTitleAction } from './councilTopicTitleAction';
import type { SessionCheckpoint, ShownCopy } from './session';
import type { DocumentData, FieldChange, ResourceSnapshot } from './types';

export type CouncilTopicTitleStamp = { field: 'council-topic-title'; rowId: string; time: ActionTime | null };
type TopicTitleDraft = { generation: string; action: CouncilTopicTitleAction };
export type CouncilTopicTitleDrafts = Record<string, TopicTitleDraft>;
export type CouncilTopicTitleActions = { councilTopicTitleActions?: CouncilTopicTitleAction[] };

const titleAt = (value: DocumentData | null | undefined, id: string) => existingRowField(value?.topics, id, COUNCIL_TOPIC_TITLE);
const sameCapture = (first: CouncilTopicTitleAction, second: CouncilTopicTitleAction) => first.rowId === second.rowId
  && first.before === second.before && first.after === second.after && first.observedRevision === second.observedRevision
  && equalValues(first.time, second.time);
const isCaptured = (checkpoint: SessionCheckpoint, action: CouncilTopicTitleAction) => Object.values(checkpoint.pending)
  .some(request => request.councilTopicTitleActions?.some(captured => sameCapture(action, captured)));

function validDrafts(checkpoint: SessionCheckpoint, value: DocumentData | null) {
  const metadata = checkpoint.confirmed.metadata;
  if (checkpoint.confirmed.resource.collection !== COUNCIL_TOPIC_TITLE_POLICY.collection || !metadata || metadata.deleted) return [];
  return Object.values(checkpoint.councilTopicTitleDrafts ?? {}).filter(draft => draft.generation === metadata.generation
    && draft.action.observedRevision <= metadata.revision && titleAt(value, draft.action.rowId) === draft.action.after);
}

export function stageCouncilTopicTitle(checkpoint: SessionCheckpoint, value: DocumentData | null, shown: ShownCopy | undefined,
  stamp: CouncilTopicTitleStamp | undefined): CouncilTopicTitleDrafts | undefined {
  const staged = validDrafts(checkpoint, value);
  const metadata = checkpoint.confirmed.metadata;
  if (checkpoint.confirmed.resource.collection === COUNCIL_TOPIC_TITLE_POLICY.collection && metadata && !metadata.deleted
    && stamp && boundedRowId(stamp.rowId)) {
    const { rowId } = stamp;
    const old = titleAt(checkpoint.draft, rowId), after = titleAt(value, rowId);
    const time = stamp.time === null ? null : boundedActionTime(stamp.time);
    if (time !== undefined && old !== undefined && after !== undefined && old !== after) {
      const prior = validDrafts(checkpoint, checkpoint.draft).find(item => item.action.rowId === rowId)?.action;
      const typing = prior && !isCaptured(checkpoint, prior);
      const visible = shown?.editGeneration === checkpoint.editGeneration
        && shown.confirmed.metadata?.generation === metadata.generation ? shown : checkpoint;
      const before = typing ? prior.before : titleAt(visible.draft, rowId) ?? old;
      const observedRevision = prior?.observedRevision ?? visible.confirmed.metadata!.revision;
      if (before !== after) staged.push({ generation: metadata.generation,
        action: { rowId, rowCreatedAt: rowId, before, after, time, observedRevision } });
    }
  }
  return staged.length ? Object.fromEntries(staged.map(draft => [draft.action.rowId, draft])) : undefined;
}

function uncaptured(checkpoint: SessionCheckpoint) {
  return validDrafts(checkpoint, checkpoint.draft).map(draft => draft.action).filter(action => !isCaptured(checkpoint, action));
}

export function hasUncapturedCouncilTopicTitle(checkpoint: SessionCheckpoint): boolean {
  return uncaptured(checkpoint).length > 0;
}

export function captureCouncilTopicTitles(checkpoint: SessionCheckpoint, baseline: ResourceSnapshot,
  predecessor: CommitRequest | undefined, records: readonly CommitRequest[]): CouncilTopicTitleAction[] {
  const byId = new Map(records.map(record => [record.id, record]));
  return uncaptured(checkpoint).filter(action => titleAt(predecessor ? predecessor.value : baseline.value, action.rowId) !== undefined)
    .map(action => {
      const predecessorOperationId = knownRowDetailPredecessor(predecessor, byId, baseline, COUNCIL_TOPIC_TITLE_POLICY, request => {
        const captured = request.councilTopicTitleActions?.find(item => item.rowId === action.rowId);
        if (captured) return captured;
        const opening = request.predecessor ? byId.get(request.predecessor)?.value : request.baseline.value;
        if (titleAt(opening, action.rowId) === undefined && titleAt(request.value, action.rowId) === action.before) {
          return { rowId: action.rowId, rowCreatedAt: action.rowCreatedAt, after: action.before };
        }
      }, 'title', action.rowId, action.rowCreatedAt, action.before, undefined);
      return { ...action, ...(predecessorOperationId && { predecessorOperationId }) };
    });
}

export function matchingCouncilTopicTitles(changes: FieldChange[], actions: CouncilTopicTitleAction[] | undefined) {
  return actions?.filter(action => matchesRowDetailBirth(changes, action, COUNCIL_TOPIC_TITLE_POLICY.birth)
    && matchesRowAction(changes, action, COUNCIL_TOPIC_TITLE));
}

export function acknowledgeCouncilTopicTitles(checkpoint: SessionCheckpoint, captured: CouncilTopicTitleAction[] | undefined) {
  const remaining = Object.entries(checkpoint.councilTopicTitleDrafts ?? {}).filter(([, { action }]) =>
    !captured?.some(sent => sameCapture(action, sent)));
  if (remaining.length) checkpoint.councilTopicTitleDrafts = Object.fromEntries(remaining);
  else delete checkpoint.councilTopicTitleDrafts;
}

export function councilTopicTitleAckAncestor(ancestor: DocumentData | null, accepted: ResourceSnapshot,
  checkpoint: SessionCheckpoint): DocumentData | null {
  if (!ancestor || accepted.metadata?.generation !== checkpoint.confirmed.metadata?.generation) return ancestor;
  let topics = ancestor.topics;
  for (const { action } of validDrafts(checkpoint, checkpoint.draft)) {
    const stored = titleAt(accepted.value, action.rowId);
    if (stored !== undefined && titleAt(ancestor, action.rowId) === action.before) {
      topics = replaceExistingRowField(topics, action.rowId, stored, COUNCIL_TOPIC_TITLE) ?? topics;
    }
  }
  return topics === ancestor.topics ? ancestor : { ...ancestor, topics };
}
