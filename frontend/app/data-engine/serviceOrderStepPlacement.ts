import { equalValues, object } from './fieldValues';
import { UNREADABLE_STEP_POSITION } from './unreadableDraftProof';

import type { ConflictDetail, DocumentData } from './types';

type PlacementStep = DocumentData & { id: string };

export function placementSteps(value: unknown): PlacementStep[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = new Set<string>();
  for (const row of value) {
    if (!object(row) || typeof row.id !== 'string' || ids.has(row.id)) return undefined;
    ids.add(row.id);
  }
  return value;
}

export function retainedStepOrderChanged(before: DocumentData[], after: DocumentData[]): boolean {
  const older = new Set(before.map(step => step.id));
  const newer = new Set(after.map(step => step.id));
  return !equalValues(before.map(step => step.id).filter(id => newer.has(id)), after.map(step => step.id).filter(id => older.has(id)));
}

/** Restore the opening's relative order while keeping draft rows and their edited content. */
export function keepSavedStepPositions(opening: PlacementStep[], draft: PlacementStep[]): PlacementStep[] {
  const byId = new Map(draft.map(step => [step.id, step]));
  const openingIds = new Set(opening.map(step => step.id));
  const kept = opening.flatMap(step => byId.get(step.id) ?? []);
  let index = 0;
  return draft.map(step => openingIds.has(step.id) ? kept[index++] : step);
}

export function unreadableStepPosition(opening: DocumentData | null, draft: DocumentData | null, stored: DocumentData | null): ConflictDetail | undefined {
  const base = placementSteps(opening?.steps), mine = placementSteps(draft?.steps), theirs = placementSteps(stored?.steps);
  if (!base || !mine || (!retainedStepOrderChanged(base, mine) && (!theirs || !retainedStepOrderChanged(theirs, mine)))) return undefined;
  const positions = (steps: PlacementStep[]) => ({ exists: true as const, value: steps.map(step => step.id) });
  return { path: ['steps', 'position'], base: positions(base), mine: positions(mine),
    theirs: theirs ? positions(theirs) : { exists: false }, code: UNREADABLE_STEP_POSITION };
}

/** A returned anchor is new server data when both the predecessor and the visible draft lacked it. */
export function returnedPlacementAnchors(shown: unknown, local: unknown, stored: unknown,
  anchors: readonly (string | null)[]): string[] {
  const prior = placementSteps(shown);
  const draft = placementSteps(local), saved = placementSteps(stored);
  if (!prior || !draft || !saved) return [];
  return anchors.filter((id): id is string => id !== null && !prior.some(row => row.id === id) && !draft.some(row => row.id === id)
    && saved.some(row => row.id === id));
}
