import { equalValues, object } from './fieldValues';

import type { DocumentData } from './types';

export function placementSteps(value: unknown): Array<DocumentData & { id: string }> | undefined {
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
