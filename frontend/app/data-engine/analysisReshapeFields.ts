import { ANALYSIS_RESHAPE_FRAME, equalValues, readField } from './protocol';

export { ANALYSIS_RESHAPE_FIELDS, ANALYSIS_RESHAPE_FRAME } from './protocol';

import type { ConflictDetail, DocumentData, FieldValue } from './types';

/** Whether both values name the same whole positional frame, including field absence. */
export function sameAnalysisFrame(a: DocumentData | null, b: DocumentData | null): boolean {
  if (a === null || b === null) return a === b;
  return ANALYSIS_RESHAPE_FRAME.every(field => equalValues(readField(a, [field]), readField(b, [field])));
}

/** A later frame is kept whole; its word positions are never laid onto different verses. */
export function keepAnalysisReshapeFrame(base: DocumentData | null, mine: DocumentData | null, theirs: DocumentData | null,
  merged: { value: FieldValue; conflicts: ConflictDetail[] }): void {
  if (!base || !mine || !theirs || !merged.value.exists) return;
  const mineChanged = !sameAnalysisFrame(base, mine), theirsChanged = !sameAnalysisFrame(base, theirs);
  const collision = mineChanged && theirsChanged && !sameAnalysisFrame(mine, theirs);
  const selected = mineChanged ? mine : theirs;
  const value = { ...(merged.value.value as DocumentData) };
  for (const field of ANALYSIS_RESHAPE_FRAME) {
    if (Object.prototype.hasOwnProperty.call(selected, field)) value[field] = selected[field];
    else delete value[field];
  }
  merged.value = { exists: true, value };
  merged.conflicts = merged.conflicts.filter(conflict => !ANALYSIS_RESHAPE_FRAME.some(field => conflict.path[0] === field));
  if (collision) for (const field of ANALYSIS_RESHAPE_FRAME) merged.conflicts.push({ path: [field],
    base: readField(base, [field]), mine: readField(mine, [field]), theirs: readField(theirs, [field]) });
}
