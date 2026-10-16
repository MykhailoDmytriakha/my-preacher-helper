import { diffFields } from './protocol';

import type { ResourceSnapshot } from './types';

const BOOKKEEPING = new Set(['updatedAt', 'rev', 'id', '_dataEngine']);

/** Recency describes accepted content, never the order of a person's intentions. */
export function stampAcceptedResource(previous: ResourceSnapshot, next: ResourceSnapshot, acceptedAt: string): ResourceSnapshot {
  if (next.value === null) return next;
  const changed = previous.value === null || diffFields(previous.value, next.value)
    .some(change => !BOOKKEEPING.has(change.path[0]));
  const value = { ...next.value };
  if (changed) value.updatedAt = acceptedAt;
  else if (previous.value && Object.prototype.hasOwnProperty.call(previous.value, 'updatedAt')) value.updatedAt = previous.value.updatedAt;
  else delete value.updatedAt;
  return { ...next, value };
}
