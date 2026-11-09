import { newClientId } from '@/utils/clientId';

import type { useDataDocument, useDocumentActions } from '@/data-engine/react.client';
import type { DocumentData } from '@/data-engine/types';

type ManualForm = Pick<ReturnType<typeof useDataDocument>, 'getManualForm'>;
type Time = ReturnType<ReturnType<typeof useDocumentActions>['captureActionTime']>;

export class AiReviewCaptureFailure extends Error {
  constructor(cause: unknown, readonly discard: () => Promise<void>) {
    super('The rejected AI review draft could not be discarded', { cause });
  }
}

/** The private stage cannot be saved by another editor action if this capture fails. */
export async function captureAiReview(document: ManualForm, time: Time, selected: readonly string[],
  update: (current: DocumentData | null) => DocumentData | null): Promise<void> {
  const fields = selected.flatMap(id => [
    ['thoughts', { id }, 'outlinePointId'] as const,
    ['thoughts', { id }, 'subPointId'] as const,
  ]);
  const form = document.getManualForm('ai-placement:' + newClientId(), [
    ...fields, ['structure'], ['thoughtsBySection'],
  ]);
  await form.begin();
  let captured = false;
  try {
    await form.save(value => {
      const next = update(value);
      if (!next) throw new Error('The sermon is not available for editing');
      return next;
    }, { documentMetadata: { time: time ?? null, thoughtPlacementIds: selected } }, () => { captured = true; });
  } catch (error) {
    // Cancel affects the private stage only. A request already captured keeps its original intent.
    const discard = () => form.cancel();
    try { await discard(); }
    catch { if (!captured) throw new AiReviewCaptureFailure(error, discard); }
    if (!captured) throw error;
  }
}
