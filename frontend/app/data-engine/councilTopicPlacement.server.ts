import { projectServiceOrderStep } from '@/utils/serviceOrderStepPlacement';

import { trackAnchoredRows } from './anchoredRowTracking.server';
import { placementSteps } from './serviceOrderStepPlacement';
import { planStepPlacement } from './stepPlacement.server';

import type { PlacementStep, StepPlacementTarget } from './stepPlacement.server';
import type { DataCommand, ResourceSnapshot } from './types';

export const COUNCIL_TOPIC_PLACEMENT_HISTORY = '_topicPlacementHistory';
export const COUNCIL_TOPIC_PLACEMENT_REVIEW = 'council-topic-placement-needs-review';

const councilRows = {
  collection: 'councils', field: 'topics', proofKey: 'councilTopicPlacement',
  read: placementSteps, rowIdentity: (row: PlacementStep) => row.id,
};
const tracking = trackAnchoredRows(councilRows);

export function planCouncilTopicPlacement(command: Extract<DataCommand, { kind: 'update' }>, current: ResourceSnapshot,
  raw: unknown, serverMs?: number) {
  const queueId = command.councilTopicQueue!;
  const target: StepPlacementTarget = {
    ...councilRows, project: projectServiceOrderStep, title: (_value, row) => row.title,
    lineage: (metadata, snapshot, rows, opening, move) => tracking.lineage(metadata, snapshot, rows, opening, { ...move, queueId }),
  };
  return planStepPlacement(target, command.councilTopicPlacement!, command, current, raw, serverMs);
}

export function legacyCouncilTopicPlacementNeedsReview(command: DataCommand, current: ResourceSnapshot, raw: unknown): boolean {
  return !(command.kind === 'update' && command.councilTopicPlacement)
    && tracking.legacyNeedsReview(command, current, raw, current.value?.status === 'held');
}

export const metadataAfterCouncilTopicPlacement = tracking.metadataAfter;
