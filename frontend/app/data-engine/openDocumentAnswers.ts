import { equalValues } from './protocol';

import type { EditorRecord } from './controller';
import type { DocumentData, ResourceRef } from './types';

/** The saved work a mounted document editor can speak for on its screen. A derived local view only. */
export interface CoveredSavedAnswer {
  readonly id: string;
  readonly operationIds: readonly string[];
  readonly draft: Readonly<DocumentData> | null;
}

export interface OpenDocumentAnswer {
  readonly owner: string;
  readonly resource: ResourceRef;
  readonly operationIds: readonly string[];
  readonly draft: Readonly<DocumentData> | null;
  readonly laterSaves?: readonly CoveredSavedAnswer[];
}

/** An address or a shared request alone cannot stand for unseen words in another checkpoint. */
export function recoveryHeldOpen(records: readonly EditorRecord[], answers: readonly OpenDocumentAnswer[]): boolean {
  return records.length > 0 && records.every(record => {
    const ids = Object.keys(record.checkpoint.pending);
    const resource = record.checkpoint.confirmed.resource;
    return ids.length > 0 && answers.some(answer => answer.owner === record.owner
      && answer.resource.collection === resource.collection && answer.resource.id === resource.id
      && ((ids.every(id => answer.operationIds.includes(id)) && equalValues(answer.draft, record.checkpoint.draft))
        || answer.laterSaves?.some(save => ids.includes(save.id) && ids.every(id => save.operationIds.includes(id))
          && equalValues(save.draft, record.checkpoint.draft))));
  });
}
