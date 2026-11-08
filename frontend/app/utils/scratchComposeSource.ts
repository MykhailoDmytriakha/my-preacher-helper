import type { ComposePlanExpectedSource } from '@/config/schemas/zod';
import type { Sermon, SermonOutline } from '@/models/models';

/** Every sermon field used to generate scratch placement, excluding the supplied outline. */
export function scratchComposeSource(sermon: Pick<Sermon, 'title' | 'verse' | 'scratch'>): ComposePlanExpectedSource {
  return { title: sermon.title ?? '', verse: sermon.verse ?? '', scratch: (sermon.scratch ?? []).map(note => ({
    id: note.id, text: note.text, createdAt: note.createdAt ?? '', section: note.section ?? null,
  })) };
}

export function scratchComposeRequest(
  sermonId: string,
  existingOutline: SermonOutline | undefined,
  scratchNoteIds: string[],
  expectedSource?: ComposePlanExpectedSource,
) {
  return {
    path: `/api/sermons/${sermonId}/compose-plan-from-scratch`,
    body: JSON.stringify({ existingOutline, scratchNoteIds, ...(expectedSource ? { expectedSource } : {}) }),
  };
}
