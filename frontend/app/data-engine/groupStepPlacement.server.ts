import { trackAnchoredRows } from './anchoredRowTracking.server';
import { object } from './fieldValues';
import { groupPlacementSteps, projectGroupStep } from './groupStepPlacement';
import { planStepPlacement } from './stepPlacement.server';

import type { PlacementStep, StepPlacementTarget } from './stepPlacement.server';
import type { DataCommand, GroupFlowStepPlacement, ResourceSnapshot } from './types';

export const GROUP_STEP_PLACEMENT_HISTORY = '_groupStepPlacementHistory';
export const GROUP_STEP_PLACEMENT_REVIEW = 'group-step-placement-needs-review';
type GroupStep = NonNullable<ReturnType<typeof groupPlacementSteps>>[number];

const groupRows = {
  collection: 'groups', field: 'flow', proofKey: 'groupFlowStepPlacement',
  read: groupPlacementSteps,
  rowIdentity: (row: PlacementStep) => typeof row.templateId === 'string' ? row.templateId : undefined,
};
const tracking = trackAnchoredRows(groupRows);

const groupSteps: StepPlacementTarget<GroupStep> = {
  ...groupRows, project: projectGroupStep,
  title: (value, step) => {
    if (typeof step.instanceTitle === 'string' && step.instanceTitle) return step.instanceTitle;
    const block = Array.isArray(value.templates) ? value.templates.find(row => object(row) && row.id === step.templateId) : undefined;
    return object(block) ? block.title : undefined;
  },
  lineage: (raw, current, rows, opening, move) => tracking.lineage(raw, current, rows, opening, move as GroupFlowStepPlacement),
};

export function planGroupStepPlacement(command: Extract<DataCommand, { kind: 'update' }>, current: ResourceSnapshot, raw: unknown,
  serverMs?: number) {
  return planStepPlacement(groupSteps, command.groupFlowStepPlacement!, command, current, raw, serverMs);
}

export function legacyGroupPlacementNeedsReview(command: DataCommand, current: ResourceSnapshot, raw: unknown): boolean {
  return !(command.kind === 'update' && command.groupFlowStepPlacement) && tracking.legacyNeedsReview(command, current, raw);
}

export const metadataAfterGroupStepPlacement = tracking.metadataAfter;
