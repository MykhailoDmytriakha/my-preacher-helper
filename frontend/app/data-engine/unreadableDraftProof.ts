import { ACCOUNT_PREFERENCE_TARGETS } from './accountPreference';

import type { SessionCheckpoint } from './session';

/** Comparison reasons for a private draft whose stored observation could not be read. */
export const UNREADABLE_SCALAR_PROOF = 'unreadable-scalar-proof';
export const UNREADABLE_ROW_PROOF = 'unreadable-row-proof';
export const UNREADABLE_STEP_POSITION = 'unreadable-step-position';
export const UNREADABLE_OUTLINE_POINT_POSITION = 'unreadable-outline-point-position';

export function hasUnreadableDraftProof(checkpoint: SessionCheckpoint): boolean {
  return Boolean(checkpoint.unreadableScalarProof?.length || checkpoint.unreadableRowProofs?.length || checkpoint.unreadableExegeticalProofs?.length
    || checkpoint.unreadableServiceOrderStepPlacement || checkpoint.unreadableOutlinePointPlacement);
}

/** Preference proof names use the same nested paths as their saved values. */
export function unreadableScalarPath(collection: string, field: string): string[] {
  const preference = collection === 'users' && ACCOUNT_PREFERENCE_TARGETS.find(target => target.field === field);
  return preference ? [...preference.path] : [field];
}

type ServicePositionProof = Pick<SessionCheckpoint, 'confirmed' | 'pending' | 'serviceOrderPlacementRetry' | 'serviceOrderStepPlacementRetry'
  | 'unreadableScalarProof' | 'unreadableServiceOrderStepPlacement'>;

export function waitsForServiceOrderPosition(checkpoint: ServicePositionProof): boolean {
  return checkpoint.confirmed.resource.collection === 'serviceOrders' && (checkpoint.unreadableScalarProof?.includes('rank') === true
    || checkpoint.unreadableServiceOrderStepPlacement === true);
}

/** A move that was kept on the device but has no submitted request to answer for it. */
export function privateServiceOrderPosition(checkpoint: ServicePositionProof): 'rank' | 'step' | undefined {
  if (checkpoint.confirmed.resource.collection !== 'serviceOrders' || Object.keys(checkpoint.pending).length) return undefined;
  if (checkpoint.unreadableScalarProof?.includes('rank')) return 'rank';
  if (checkpoint.unreadableServiceOrderStepPlacement) return 'step';
  if (checkpoint.serviceOrderPlacementRetry) return 'rank';
  return checkpoint.serviceOrderStepPlacementRetry ? 'step' : undefined;
}

export function hasPrivateServiceOrderPosition(checkpoint: ServicePositionProof): boolean {
  return privateServiceOrderPosition(checkpoint) !== undefined;
}

export function hasTwoPrivateServiceOrderMoves(checkpoint: ServicePositionProof): boolean {
  return checkpoint.confirmed.resource.collection === 'serviceOrders' && Boolean((checkpoint.serviceOrderPlacementRetry || checkpoint.unreadableScalarProof?.includes('rank'))
    && (checkpoint.serviceOrderStepPlacementRetry || checkpoint.unreadableServiceOrderStepPlacement));
}
