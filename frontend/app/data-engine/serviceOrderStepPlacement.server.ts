import { projectServiceOrderStep } from '@/utils/serviceOrderStepPlacement';

import { placementSteps } from './serviceOrderStepPlacement';
import { metadataAfterStepPlacement, planStepPlacement } from './stepPlacement.server';

import type { StepPlacementTarget, StepPlacementWrite } from './stepPlacement.server';
import type { DataCommand, ResourceSnapshot } from './types';

export const SERVICE_ORDER_STEP_PLACEMENT_HISTORY = '_stepPlacementHistory';
export type ServiceOrderStepPlacementWrite = StepPlacementWrite;

const serviceSteps: StepPlacementTarget = {
  collection: 'serviceOrders',
  field: 'steps',
  proofKey: 'serviceOrderStepPlacement',
  read: placementSteps,
  project: projectServiceOrderStep,
  title: (_value, step) => step.title,
};

export function planServiceOrderStepPlacement(command: Extract<DataCommand, { kind: 'update' }>,
  current: ResourceSnapshot, raw: unknown, serverMs: number | undefined) {
  return planStepPlacement(serviceSteps, command.serviceOrderStepPlacement!, command, current, raw, serverMs);
}

export function metadataAfterServiceOrderStepPlacement(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  write?: ServiceOrderStepPlacementWrite) {
  return metadataAfterStepPlacement(serviceSteps, snapshot, raw, write);
}
