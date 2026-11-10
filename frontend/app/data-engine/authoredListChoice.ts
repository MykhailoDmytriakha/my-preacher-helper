import { repeatedWordsPath } from '@/utils/preparationFieldValues';

import { AUTHORED_LIST_PROJECTION, isAuthoredListComparison, isAuthoredStringList } from './authoredStringList';
import { equalValues, readField, writeField } from './fieldValues';
import { existingRowField, replaceExistingRowField } from './rowFieldAction';
import { SERVICE_ORDER_STEP_SCRIPTURE_LIST, serviceOrderStepField } from './serviceOrderStepAction';

import type { ConflictDetail, DocumentData, Json } from './types';

/** A deliberate choice of the shown list must bypass the ordinary union of independent additions. */
export function keepReviewedAuthoredLists(collection: string, draft: DocumentData | null,
  conflicts: readonly ConflictDetail[], reviewed?: DocumentData): DocumentData | null {
  if (!draft) return draft;
  for (const { path, code, mine } of conflicts) {
    if (!isAuthoredListComparison(code)) continue;
    const shown = code === AUTHORED_LIST_PROJECTION ? undefined : reviewed;
    if (collection === 'sermons' && equalValues(path, repeatedWordsPath)) {
      const field = shown ? readField(shown, path) : mine;
      if (!field.exists || isAuthoredStringList(field.value)) draft = writeField(draft, path, field);
    }
    if (collection !== 'serviceOrders') continue;
    const target = serviceOrderStepField(path);
    if (target?.field !== 'scriptureRefs') continue;
    const chosen = shown ? existingRowField(shown.steps, target.id, SERVICE_ORDER_STEP_SCRIPTURE_LIST) : mine.value;
    if (!isAuthoredStringList(chosen)) continue;
    const steps: Json | undefined = replaceExistingRowField(draft.steps, target.id, chosen, SERVICE_ORDER_STEP_SCRIPTURE_LIST);
    if (steps) draft = { ...draft, steps };
  }
  return draft;
}
