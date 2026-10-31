import { studyAnalysisPositionBasis } from '@/utils/studyAnalysisSource';

import { equalValues, readField } from './fieldValues';

export const ANALYSIS_RESHAPE_FRAME = ['analysis', 'content', 'scriptureRefs'] as const;
export const ANALYSIS_RESHAPE_FIELDS = [...ANALYSIS_RESHAPE_FRAME, 'title'] as const;

import type { ConflictDetail, DocumentData, FieldChange, FieldValue } from './types';

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

/** Different origins or extents cannot share bare word indices, even with equal word counts. */
export function hasDifferentAnalysisPositionBasis(...values: (DocumentData | null)[]): boolean {
  if (values.some(value => value?.type !== 'analysis')) return false;
  const bases = values.map(studyAnalysisPositionBasis);
  // Missing proof is unknown, never evidence that two positional origins match.
  return bases.some(basis => basis === null || !equalValues(basis, bases[0]));
}

/** Ordinary saves may merge same-passage maps; across passages the authored frame stays whole. */
export function keepAnalysisPositionFrame(base: DocumentData | null, mine: DocumentData | null, theirs: DocumentData | null,
  merged: { value: FieldValue; conflicts: ConflictDetail[] }): void {
  if (hasDifferentAnalysisPositionBasis(base, mine, theirs)) keepAnalysisReshapeFrame(base, mine, theirs, merged);
}

/** A positional update from an older bundle cannot prove its original passage. */
export function lacksAnalysisFrameProof(value: DocumentData, changes: readonly FieldChange[]): boolean {
  return value.type === 'analysis' && changes.some(change => ANALYSIS_RESHAPE_FRAME.some(field => change.path[0] === field))
    && !ANALYSIS_RESHAPE_FRAME.every(field => changes.some(change => change.path[0] === field));
}
