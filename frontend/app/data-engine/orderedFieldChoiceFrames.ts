import { equalValues, readField, writeField } from './fieldValues';

import type { ConflictDetail, DocumentData, ResourceSnapshot } from './types';

type OrderedFieldState = 'settled' | 'queued';

/** Reframe an atomic form choice around fields whose original action order was already decided. */
export function orderedFieldChoiceFrames(basis: ResourceSnapshot, reviewed: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[], order: (conflict: ConflictDetail) => OrderedFieldState | undefined) {
  if (!basis.value || !reviewed || !stored?.value || basis.metadata?.generation !== stored.metadata?.generation) {
    return { basis, reviewed, conflicts };
  }
  let opening = basis.value;
  let draft = reviewed;
  const remaining = conflicts.filter(conflict => {
    const state = order(conflict);
    if (!state) return true;
    const mine = readField(draft, conflict.path);
    const saved = readField(stored.value!, conflict.path);
    if (equalValues(mine, saved)) return false;
    if (!equalValues(mine, conflict.mine) || (state === 'queued' && !equalValues(saved, conflict.theirs))) return true;
    if (state === 'settled') draft = writeField(draft, conflict.path, readField(opening, conflict.path));
    else opening = writeField(opening, conflict.path, saved);
    return false;
  });
  return { basis: { ...basis, value: opening }, reviewed: draft, conflicts: remaining };
}
