import {
  ComposePlanApiResponseSchema,
  type ComposedPlanOutline,
  type ComposePlanExpectedSource,
  type ComposedPlanSubPoint,
} from '@/config/schemas/zod';
import { SermonOutline } from '@/models/models';
import { auth } from '@/services/firebaseAuth.service';
import { aiResultErrorCode, beginAiResultAttempt } from '@/utils/aiResultAttempt.client';
import { SCRATCH_COMPOSE_REQUEST_TIMEOUT_MS } from '@/utils/aiResultOperation';
import { withStatus } from '@/utils/aiTimeFailure';
import { apiClient } from '@/utils/apiClient';
import { isKnownOffline } from '@/utils/connectivity';
import { scratchComposeRequest } from '@/utils/scratchComposeSource';

function collectReturnedScratchIds(outline: ComposedPlanOutline): string[] {
  return [
    ...outline.introduction,
    ...outline.main,
    ...outline.conclusion,
  ].flatMap((point) => [
    point.scratchNoteId,
    ...(point.subPoints ?? []).map((subPoint: ComposedPlanSubPoint) => subPoint.scratchNoteId),
  ]).filter((scratchNoteId): scratchNoteId is string => Boolean(scratchNoteId));
}

export interface ComposePlanResult {
  acknowledge: () => void;
  outline: ComposedPlanOutline;
  /** Ids of notes the model did not place; they landed in the outline as their own points. */
  unplacedScratchNoteIds: string[];
}

export async function composePlanFromScratch(
  sermonId: string,
  existingOutline: SermonOutline | undefined,
  knownScratchNoteIds: Iterable<string>,
  expectedSource?: ComposePlanExpectedSource,
  options?: { recoverOnly?: boolean },
): Promise<ComposePlanResult> {
  if (isKnownOffline()) {
    throw new Error('Scratch compose is unavailable offline');
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('User is not authenticated');
  }

  const token = await currentUser.getIdToken();
  const scratchNoteIds = Array.from(knownScratchNoteIds);
  const { path, body } = scratchComposeRequest(sermonId, existingOutline, scratchNoteIds, expectedSource);
  const attempt = await beginAiResultAttempt(currentUser.uid, path, body, options);
  const response = await attempt.request(() => apiClient(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...attempt.headers,
    },
    body,
    category: 'ai',
    timeout: SCRATCH_COMPOSE_REQUEST_TIMEOUT_MS,
  }));

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  attempt.assertOwner();
  if (!response.ok) {
    attempt.refused(response.status, data);
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error?: unknown }).error)
        : response.statusText;
    const error = withStatus(new Error(message || `Compose failed with status ${response.status}`), response.status);
    throw Object.assign(error, { code: aiResultErrorCode(data) });
  }

  const parsed = ComposePlanApiResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Compose plan response failed validation');
  }

  const knownIds = new Set(scratchNoteIds);
  const unknownScratchIds = collectReturnedScratchIds(parsed.data.outline).filter(
    (scratchNoteId) => !knownIds.has(scratchNoteId)
  );
  if (unknownScratchIds.length > 0) {
    throw new Error(`Compose plan returned unknown scratch ids: ${unknownScratchIds.join(', ')}`);
  }

  return {
    acknowledge: attempt.acknowledge,
    outline: parsed.data.outline,
    // Notes the model skipped. They ARE in the outline, each as its own point — but the
    // preacher deserves to know his thought was placed by fallback, not by judgement.
    // A measured run placed 17 of 25 notes and said nothing.
    unplacedScratchNoteIds: parsed.data.unplacedScratchNoteIds ?? [],
  };
}
