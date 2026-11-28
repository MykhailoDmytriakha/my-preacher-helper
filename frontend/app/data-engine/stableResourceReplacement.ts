import type { ResourceRef, ResourceSnapshot } from './types';

/** These addresses are reused by design: account settings and one owner's marks for a Bible book. */
export function hasStableResourceAddress(resource: ResourceRef): boolean {
  return resource.collection === 'users' || resource.collection === 'bibleMarks';
}

export function isStableResourceReplacement(previous: ResourceSnapshot | null | undefined, incoming: ResourceSnapshot | null | undefined): boolean {
  return Boolean(previous?.metadata && incoming?.metadata && incoming.value !== null && !incoming.metadata.deleted
    && hasStableResourceAddress(incoming.resource)
    && previous.resource.collection === incoming.resource.collection && previous.resource.id === incoming.resource.id
    && previous.metadata.generation !== incoming.metadata.generation);
}
