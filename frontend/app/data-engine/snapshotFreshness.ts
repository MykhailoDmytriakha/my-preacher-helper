import { serverCopyIsNewer, type VersionedCopy } from '../utils/readFreshness';

import type { EngineMetadata, ResourceRef, ResourceSnapshot } from './types';

function metadataCovers(current: EngineMetadata, incoming: EngineMetadata | null): boolean {
  return incoming !== null && incoming.generation === current.generation
    && incoming.revision >= current.revision && (!current.deleted || incoming.deleted);
}

/** A replay may return newer content, but it must still prove the committed generation. */
export function coversCommittedEffect(snapshot: ResourceSnapshot, resource: ResourceRef, committed: EngineMetadata): boolean {
  return snapshot.resource.collection === resource.collection && snapshot.resource.id === resource.id
    && metadataCovers(committed, snapshot.metadata);
}

/** Incoming data must be a confirmed snapshot, never an optimistic editor draft. */
export function canReplaceSnapshot(current: ResourceSnapshot | undefined, incoming: ResourceSnapshot): boolean {
  if (!current) return true;
  if ((current.resource.collection !== incoming.resource.collection || current.resource.id !== incoming.resource.id)) return false;
  if (current.metadata) {
    return metadataCovers(current.metadata, incoming.metadata);
  }
  if (incoming.metadata || current.value === null || incoming.value === null) return true;
  return !serverCopyIsNewer(current.value as VersionedCopy, incoming.value as VersionedCopy);
}
