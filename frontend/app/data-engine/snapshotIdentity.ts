import { getResourcePolicy } from './protocol';

import type { ResourceSnapshot } from './types';

/** A confirmed copy follows its collection's ownership policy, including owner-id resources. */
export function snapshotBelongsToOwner(owner: string, snapshot: ResourceSnapshot): boolean {
  const { ownerField } = getResourcePolicy(snapshot.resource.collection);
  return ownerField === 'id' ? snapshot.resource.id === owner : !snapshot.value || snapshot.value[ownerField] === owner;
}
