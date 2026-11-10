import { projectServiceOrderStep, stepGap } from '@/utils/serviceOrderStepPlacement';

import { anchoredPlacementPredecessor, captureAnchoredRowPlacement } from './anchoredRowPlacement';
import { equalValues } from './fieldValues';
import { placementSteps } from './serviceOrderStepPlacement';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { CouncilTopicPlacementCapture, DocumentData, ResourceSnapshot, ServiceOrderStepGap } from './types';

export function councilTopicWitness(value: unknown) {
  return placementSteps(value)?.map(({ id }) => ({ id }));
}

export function captureCouncilTopicPlacement(before: unknown, after: unknown, id: string, generation: string | null,
  observedRevision: number, time: ActionTime | null) {
  return captureAnchoredRowPlacement(councilTopicWitness(before), councilTopicWitness(after), id, generation, observedRevision, time);
}

export function projectCouncilTopicOnDocument(value: DocumentData | null, move: CouncilTopicPlacementCapture): DocumentData | null {
  const rows = placementSteps(value?.topics);
  const topics = rows && projectServiceOrderStep(rows, move.placement.stepId, move.placement.destination);
  return value && topics ? { ...value, topics } : value;
}

export function projectCapturedCouncilTopic(value: DocumentData | null, move: CouncilTopicPlacementCapture): DocumentData | null {
  if (!equalValues(councilTopicWitness(value?.topics), move.before)) return null;
  return projectCouncilTopicOnDocument(value, move);
}

export function retryCouncilTopicPlacement(snapshot: ResourceSnapshot, move: CouncilTopicPlacementCapture,
  reviewed: ServiceOrderStepGap, time: ActionTime | null) {
  const opening = councilTopicWitness(snapshot.value?.topics);
  if (!snapshot.value || snapshot.value.status === 'held' || !opening
    || !equalValues(stepGap(opening, move.placement.stepId), reviewed)) return undefined;
  const draft = projectCouncilTopicOnDocument(snapshot.value, move);
  if (!draft || draft === snapshot.value) return undefined;
  const capture = captureCouncilTopicPlacement(snapshot.value.topics, draft.topics, move.placement.stepId,
    snapshot.metadata?.generation ?? null, snapshot.metadata?.revision ?? 0, time);
  return { capture, draft };
}

export function councilTopicPlacementPredecessor(records: readonly CommitRequest[], predecessor: CommitRequest | undefined,
  move: CouncilTopicPlacementCapture) {
  return anchoredPlacementPredecessor(records, predecessor, move, 'councils', record => councilTopicWitness(record.value?.topics),
    record => record.councilTopicPlacement);
}
