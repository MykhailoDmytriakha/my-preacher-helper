import { equalValues, object } from './fieldValues';

import type { DocumentData } from './types';

/** Trusted cleanup removes one exact label and preserves every other byte of the thought. */
export function withoutSermonTag(thoughts: DocumentData[], name: string): DocumentData[] {
  return thoughts.map(thought => object(thought) && Array.isArray(thought.tags) && thought.tags.includes(name)
    ? { ...thought, tags: thought.tags.filter(tag => tag !== name) } : thought);
}

/** Older malformed thought fields are tolerated only in an exact, guarded removal. */
export function isExactSermonTagCleanup(before: DocumentData | null, after: DocumentData, name: string): boolean {
  return Boolean(before && Array.isArray(before.thoughts) && equalValues(after, {
    ...before, thoughts: withoutSermonTag(before.thoughts as DocumentData[], name),
  }));
}
