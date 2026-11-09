import { GROUP_BLOCK_STATUS_POLICY } from './groupBlockStatusAction';
import { GROUP_STEP_DURATION_POLICY } from './groupStepDurationAction';
import { boundedRowId, existingRowField, replaceExistingRowField } from './rowFieldAction';

import type { RowFieldTarget } from './rowFieldAction';
import type { ConflictDetail, DocumentData } from './types';

const reselectableFields: readonly { birth: RowFieldTarget<string>; target: RowFieldTarget<string | number | null> }[] = [
  { birth: GROUP_BLOCK_STATUS_POLICY.birth, target: GROUP_BLOCK_STATUS_POLICY.target('status') },
  { birth: GROUP_STEP_DURATION_POLICY.birth, target: GROUP_STEP_DURATION_POLICY.target('durationMin') },
];

/** An explicit reselection may equal its base; the ordinary merge sees that as untouched. */
export function keepReselectedGroupFlowFields(base: DocumentData | null, draft: DocumentData | null,
  stored: DocumentData | null, merged: DocumentData | null, conflicts: readonly ConflictDetail[]): DocumentData | null {
  if (!base || !draft || !stored || !merged) return merged;
  let resolved = merged;
  for (const { path, base: opening, mine } of conflicts) {
    if (path.length !== 3 || !path[1].startsWith('id:')) continue;
    const policy = reselectableFields.find(({ target }) => path[0] === target.field && path[2] === target.leaf);
    if (!policy) continue;
    const id = path[1].slice(3);
    const { birth, target } = policy;
    const { field } = target;
    const before = opening.exists ? opening.value : target.missing;
    const selected = mine.exists ? mine.value : target.missing;
    if (!boundedRowId(id) || before !== selected || !target.accepts(selected)
      || existingRowField(draft[field], id, target) !== selected) continue;
    const born = existingRowField(base[field], id, birth);
    if (born === undefined || existingRowField(draft[field], id, birth) !== born
      || existingRowField(stored[field], id, birth) !== born || existingRowField(resolved[field], id, birth) !== born) continue;
    const rows = replaceExistingRowField(resolved[field], id, selected, target);
    if (rows !== undefined && rows !== resolved[field]) resolved = { ...resolved, [field]: rows };
  }
  return resolved;
}
