import { ACCOUNT_PREFERENCE_TARGETS } from './accountPreference';

import type { SessionCheckpoint } from './session';

/** Comparison reasons for a private draft whose stored observation could not be read. */
export const UNREADABLE_SCALAR_PROOF = 'unreadable-scalar-proof';
export const UNREADABLE_ROW_PROOF = 'unreadable-row-proof';

/** Preference proof names use the same nested paths as their saved values. */
export function unreadableScalarPath(collection: string, field: string): string[] {
  const preference = collection === 'users' && ACCOUNT_PREFERENCE_TARGETS.find(target => target.field === field);
  return preference ? [...preference.path] : [field];
}

export function waitsForServiceOrderPosition(checkpoint: Pick<SessionCheckpoint, 'confirmed' | 'unreadableScalarProof'>): boolean {
  return checkpoint.confirmed.resource.collection === 'serviceOrders' && checkpoint.unreadableScalarProof?.includes('rank') === true;
}

/** A move that was kept on the device but has no submitted request to answer for it. */
export function hasPrivateServiceOrderPosition(checkpoint: Pick<SessionCheckpoint, 'confirmed' | 'pending' | 'serviceOrderPlacementRetry' | 'unreadableScalarProof'>): boolean {
  return checkpoint.confirmed.resource.collection === 'serviceOrders' && !Object.keys(checkpoint.pending).length
    && (Boolean(checkpoint.serviceOrderPlacementRetry) || waitsForServiceOrderPosition(checkpoint));
}
