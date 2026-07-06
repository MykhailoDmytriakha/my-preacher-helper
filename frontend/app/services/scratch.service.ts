import {
  ComposePlanApiResponseSchema,
  type ComposedPlanOutline,
  type ComposedPlanSubPoint,
} from '@/config/schemas/zod';
import { ScratchNote, SermonOutline } from '@/models/models';
import { auth } from '@/services/firebaseAuth.service';
import {
  addScratchNoteViaClient,
  deleteScratchNoteViaClient,
  updateScratchNoteViaClient,
} from '@/services/sermons.client';
import { apiClient } from '@/utils/apiClient';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;
const SCRATCH_COMPOSE_TIMEOUT_MS = 55_000;
const isBrowserOffline = () => typeof navigator !== 'undefined' && !navigator.onLine;

export function addScratchNote(sermonId: string, scratch: ScratchNote[]): Promise<ScratchNote[]> {
  return addScratchNoteViaClient(sermonId, scratch);
}

export function updateScratchNote(sermonId: string, scratch: ScratchNote[]): Promise<ScratchNote[]> {
  return updateScratchNoteViaClient(sermonId, scratch);
}

export function deleteScratchNote(sermonId: string, scratch: ScratchNote[]): Promise<ScratchNote[]> {
  return deleteScratchNoteViaClient(sermonId, scratch);
}

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

export async function composePlanFromScratch(
  sermonId: string,
  existingOutline: SermonOutline | undefined,
  knownScratchNoteIds: Iterable<string>
): Promise<ComposedPlanOutline> {
  if (isBrowserOffline()) {
    throw new Error('Scratch compose is unavailable offline');
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('User is not authenticated');
  }

  const token = await currentUser.getIdToken();
  const scratchNoteIds = Array.from(knownScratchNoteIds);
  const response = await apiClient(`${API_BASE}/api/sermons/${sermonId}/compose-plan-from-scratch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ existingOutline, scratchNoteIds }),
    category: 'ai',
    timeout: SCRATCH_COMPOSE_TIMEOUT_MS,
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error?: unknown }).error)
        : response.statusText;
    throw new Error(message || `Compose failed with status ${response.status}`);
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

  return parsed.data.outline;
}
