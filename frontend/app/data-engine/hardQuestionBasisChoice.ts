import { equalValues } from './fieldValues';
import { BASIS_FIELD_QUEUED, BASIS_FIELD_SETTLED, BASIS_REFERENCE_PROJECTION, hardQuestionBasisField, readHardQuestionBasisField, writeBasisReferences } from './hardQuestionBasisFields';
import { projectManualSelection, sameManualSelection, type ManualPath } from './manualScope';

import type { ConflictDetail, DocumentData, ResourceSnapshot } from './types';

export function hardQuestionBasisChoiceFrames(basis: ResourceSnapshot, reviewed: DocumentData | null, stored: ResourceSnapshot, conflicts: readonly ConflictDetail[]) {
  if (!basis.value || !reviewed || !stored.value || basis.metadata?.generation !== stored.metadata?.generation) {
    return { basis, reviewed, conflicts };
  }
  let opening = basis.value, mine = reviewed;
  const pending = conflicts.filter(conflict => {
    if (conflict.code !== BASIS_FIELD_QUEUED && conflict.code !== BASIS_FIELD_SETTLED && conflict.code !== BASIS_REFERENCE_PROJECTION) return true;
    const target = hardQuestionBasisField(conflict.path);
    if (!target) return true;
    const { id, field } = target;
    const path: ManualPath = ['bases', { id }, field];
    if (conflict.code === BASIS_REFERENCE_PROJECTION) {
      if (!equalValues(readHardQuestionBasisField(mine, id, field), conflict.base)
        || !equalValues(readHardQuestionBasisField(stored.value!, id, field), conflict.theirs)) return true;
      mine = writeBasisReferences(mine, id, conflict.mine);
      opening = projectManualSelection(opening, stored.value!, [path]);
      return false;
    }
    if (sameManualSelection(mine, stored.value, path)) return false;
    if (!equalValues(readHardQuestionBasisField(mine, id, field), conflict.mine)) return true;
    if (conflict.code === BASIS_FIELD_SETTLED) mine = projectManualSelection(mine, opening, [path]);
    else if (equalValues(readHardQuestionBasisField(stored.value!, id, field), conflict.theirs)) {
      opening = projectManualSelection(opening, stored.value!, [path]);
    } else return true;
    return false;
  });
  return { basis: { ...basis, value: opening }, reviewed: mine, conflicts: pending };
}
