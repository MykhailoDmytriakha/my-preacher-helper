import type { ComposePlanExpectedSource } from '@/config/schemas/zod';
import type { Sermon } from '@/models/models';

/** Every sermon field used to generate scratch placement, excluding the supplied outline. */
export function scratchComposeSource(sermon: Pick<Sermon, 'title' | 'verse' | 'scratch'>): ComposePlanExpectedSource {
  return { title: sermon.title ?? '', verse: sermon.verse ?? '', scratch: (sermon.scratch ?? []).map(note => ({
    id: note.id, text: note.text, createdAt: note.createdAt ?? '', section: note.section ?? null,
  })) };
}
