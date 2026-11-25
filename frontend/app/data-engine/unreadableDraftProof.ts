import { ACCOUNT_PREFERENCE_TARGETS } from './accountPreference';

/** Comparison reasons for a private draft whose stored observation could not be read. */
export const UNREADABLE_SCALAR_PROOF = 'unreadable-scalar-proof';
export const UNREADABLE_ROW_PROOF = 'unreadable-row-proof';

/** Preference proof names use the same nested paths as their saved values. */
export function unreadableScalarPath(collection: string, field: string): string[] {
  const preference = collection === 'users' && ACCOUNT_PREFERENCE_TARGETS.find(target => target.field === field);
  return preference ? [...preference.path] : [field];
}
