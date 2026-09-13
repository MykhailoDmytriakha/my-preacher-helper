import { getResourcePolicy, isValidIdentifier } from './protocol';

import type { ResourceRef } from './types';

/** Shared identity for the small version signal; only the server can advance it. */
export function collectionHeadRef(owner: string, collection: string): ResourceRef {
  if (!isValidIdentifier(owner) || !getResourcePolicy(collection).allowed || collection === '_dataEngineHeads') throw new Error('Invalid collection feed');
  return { collection: '_dataEngineHeads', id: JSON.stringify([owner, collection]) };
}

export function feedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid collection version');
  return value as number;
}
