import { alignOptionalRowField, boundedRowId, existingRowField } from './rowFieldAction';

import type { RowDetailHistoryEntry, RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget } from './rowFieldAction';
import type { DataCommand, DocumentData, ResourceSnapshot } from './types';

const LOCK: RowFieldTarget<boolean> = {
  field: 'thoughts', leaf: 'isLocked', missing: false,
  accepts: (value): value is boolean => typeof value === 'boolean',
};

export const THOUGHT_LOCK_POLICY: RowDetailPolicy<'isLocked', boolean> = {
  collection: 'sermons', fields: ['isLocked'],
  birth: { field: 'thoughts', leaf: 'date', accepts: (value): value is string => typeof value === 'string' && value.length <= 128 },
  target: () => LOCK,
  proofs: 'thoughtLockProofs', actions: 'thoughtLockActions', history: '_thoughtLockHistory',
  repeatedFields: ['isLocked'], allowUnclocked: true, allowUnchanged: () => true,
};

export function thoughtLockConflictId(path: readonly string[]): string | undefined {
  if (path.length !== 3 || path[0] !== LOCK.field || path[2] !== LOCK.leaf || !path[1].startsWith('id:')) return undefined;
  const id = path[1].slice(3);
  return boundedRowId(id) ? id : undefined;
}

export function readThoughtLockConflict(id: string, base: DocumentData, draft: DocumentData, stored: DocumentData) {
  const birth = THOUGHT_LOCK_POLICY.birth;
  const date = existingRowField(base.thoughts, id, birth);
  if (date === undefined || existingRowField(draft.thoughts, id, birth) !== date || existingRowField(stored.thoughts, id, birth) !== date) return;
  const mine = existingRowField(draft.thoughts, id, LOCK);
  const theirs = existingRowField(stored.thoughts, id, LOCK);
  if (mine === undefined || theirs === undefined || mine === theirs) return;
  return { mine, stored: theirs };
}

export type ThoughtLockHistoryPage = {
  owner: string; sermonId: string; generation: string; nextCursor: string | null;
  entries: { id: string; acceptedAt: string; fields: RowDetailHistoryEntry<'isLocked', boolean>[] }[];
};

/** An absent legacy lock and an explicitly unlocked thought have the same meaning. */
export function alignThoughtLockRepresentation(command: DataCommand, current: ResourceSnapshot): DataCommand {
  if (command.kind !== 'update' || command.resource.collection !== 'sermons' || !Array.isArray(command.thoughtLockActions)) return command;
  return command.thoughtLockActions.reduce<DataCommand>((aligned, action) =>
    aligned.kind === 'update' ? alignOptionalRowField(aligned, current, LOCK, action?.rowId) : aligned, command);
}
