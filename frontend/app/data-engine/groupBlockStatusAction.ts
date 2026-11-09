import { isGroupBlockStatus } from '@/utils/groupDocument';

import { GROUP_BLOCK_TITLE_POLICY } from './groupFlowTitleAction';
import { boundedRowId, existingRowField, replaceExistingRowField } from './rowFieldAction';

import type { RowDetailPolicy } from './rowDetailAction';
import type { ConflictDetail, DocumentData } from './types';
import type { GroupBlockStatus } from '@/models/models';

export const GROUP_BLOCK_STATUS_POLICY: RowDetailPolicy<'status', GroupBlockStatus> = {
  collection: 'groups', fields: ['status'], birth: GROUP_BLOCK_TITLE_POLICY.birth,
  target: () => ({ field: 'templates', leaf: 'status', accepts: isGroupBlockStatus }),
  proofs: 'groupBlockStatusProofs', actions: 'groupBlockStatusActions', history: '_blockStatusHistory',
  repeatedFields: ['status'], allowUnclocked: true, allowUnchanged: () => true,
};

/** A reviewed explicit reselection may equal its base; the ordinary merge sees that as untouched. */
export function keepReselectedBlockStatuses(base: DocumentData | null, draft: DocumentData | null,
  stored: DocumentData | null, merged: DocumentData | null, conflicts: readonly ConflictDetail[]): DocumentData | null {
  if (!base || !draft || !stored || !merged) return merged;
  const { birth } = GROUP_BLOCK_STATUS_POLICY;
  const target = GROUP_BLOCK_STATUS_POLICY.target('status');
  let rows = merged.templates;
  for (const { path, base: opening, mine } of conflicts) {
    if (path.length !== 3 || path[0] !== target.field || !path[1].startsWith('id:') || path[2] !== target.leaf
      || !mine.exists || !opening.exists || opening.value !== mine.value || !isGroupBlockStatus(mine.value)) continue;
    const id = path[1].slice(3);
    if (!boundedRowId(id) || existingRowField(draft.templates, id, target) !== mine.value) continue;
    const born = existingRowField(base.templates, id, birth);
    if (born === undefined || existingRowField(draft.templates, id, birth) !== born
      || existingRowField(stored.templates, id, birth) !== born || existingRowField(rows, id, birth) !== born) continue;
    rows = replaceExistingRowField(rows, id, mine.value, target) ?? rows;
  }
  return rows === merged.templates ? merged : { ...merged, templates: rows };
}
