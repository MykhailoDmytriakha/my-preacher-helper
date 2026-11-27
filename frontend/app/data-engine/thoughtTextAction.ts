import { boundedRowId, existingRowField } from './rowFieldAction';

import type { RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget } from './rowFieldAction';
import type { DocumentData } from './types';

const THOUGHT_TEXT: RowFieldTarget<string> = {
  field: 'thoughts', leaf: 'text', accepts: (value): value is string => typeof value === 'string',
};

export const THOUGHT_TEXT_POLICY: RowDetailPolicy<'text', string> = {
  collection: 'sermons', fields: ['text'],
  birth: { field: 'thoughts', leaf: 'date', accepts: (value): value is string => typeof value === 'string' && value.length <= 128 },
  target: () => THOUGHT_TEXT,
  proofs: 'thoughtTextProofs', actions: 'thoughtTextActions', history: '_thoughtTextHistory',
  repeatedFields: ['text'], allowUnclocked: true, atomicChoice: true, rememberOpenings: true, seedOpeningFromStoredValue: true,
};

export function thoughtTextConflictId(path: readonly string[]): string | undefined {
  if (path.length !== 3 || path[0] !== THOUGHT_TEXT.field || path[2] !== THOUGHT_TEXT.leaf || !path[1].startsWith('id:')) return;
  const id = path[1].slice(3);
  if (boundedRowId(id)) return id;
}

export function readThoughtBirth(id: string, sermon: DocumentData): string | undefined {
  return existingRowField(sermon.thoughts, id, THOUGHT_TEXT_POLICY.birth);
}

export function readThoughtTextConflict(id: string, mine: DocumentData, stored: DocumentData) {
  const date = readThoughtBirth(id, mine);
  if (date === undefined || readThoughtBirth(id, stored) !== date) return;
  const local = existingRowField(mine.thoughts, id, THOUGHT_TEXT);
  const saved = existingRowField(stored.thoughts, id, THOUGHT_TEXT);
  if (local !== undefined && saved !== undefined && local !== saved) return { mine: local, stored: saved };
}
