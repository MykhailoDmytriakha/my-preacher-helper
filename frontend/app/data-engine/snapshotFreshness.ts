import { serverCopyIsNewer, type VersionedCopy } from '../utils/readFreshness';

import type { ResourceSnapshot } from './types';

/** Incoming data must be a confirmed snapshot, never an optimistic editor draft. */
export function canReplaceSnapshot(current: ResourceSnapshot | undefined, incoming: ResourceSnapshot): boolean {
  if (!current) return true;
  if ((current.resource.collection !== incoming.resource.collection || current.resource.id !== incoming.resource.id)) return false;
  if (current.metadata) {
    return incoming.metadata !== null
      && incoming.metadata.generation === current.metadata.generation
      && incoming.metadata.revision >= current.metadata.revision
      && (!current.metadata.deleted || incoming.metadata.deleted);
  }
  if (incoming.metadata || current.value === null || incoming.value === null) return true;
  return !serverCopyIsNewer(current.value as VersionedCopy, incoming.value as VersionedCopy);
}

