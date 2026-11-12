import { equalValues } from './fieldValues';
import { relationMirrorFields } from './relationMirrors';

import type { ConflictDetail, DocumentData } from './types';

/** Compare the content the person saw when they confirmed Delete. */
export function deletionConflicts(collection: string, shown: DocumentData, stored: DocumentData): ConflictDetail[] {
  // A relation may change a reverse index. The delete cascade reads the current relationships.
  const ignored = new Set(['rev', 'updatedAt', 'id', '_dataEngine', ...relationMirrorFields(collection)]);
  const content = (data: DocumentData) => Object.fromEntries(Object.entries(data).filter(([key]) => !ignored.has(key)));
  return equalValues(content(shown), content(stored)) ? [] : [
    { path: [], base: { exists: true, value: shown }, mine: { exists: false }, theirs: { exists: true, value: stored } },
  ];
}
