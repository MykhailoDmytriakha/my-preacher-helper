import { z } from 'zod';

import { getVisualOrderedThoughtsForOutlinePoint } from '@/utils/sermonVisualOrder';

import type { Sermon } from '@/models/models';

export const NotePlanRequestSchema = z.object({
  outlinePointId: z.string().min(1),
  style: z.enum(['memory', 'narrative', 'exegetical']),
  expectedContext: z.string().min(1),
});

export const NotePlanResultSchema = z.object({
  contentByNodeId: z.record(z.string()),
  missingMaterial: z.record(z.string()),
});

export type NotePlanResult = z.infer<typeof NotePlanResultSchema>;

/** Compare the actual generation inputs, not unrelated changes to saved plan text. */
export function notePlanContextKey(sermon: Sermon, pointId: string): string {
  return JSON.stringify({
    title: sermon.title,
    verse: sermon.verse,
    sourceNoteIds: sermon.sourceNoteIds ?? [],
    outline: ['introduction', 'main', 'conclusion'].map((section) =>
      (sermon.outline?.[section as keyof NonNullable<Sermon['outline']>] ?? []).map((point) => ({
        id: point.id, text: point.text, note: point.note ?? '',
        subPoints: [...(point.subPoints ?? [])].sort((a, b) => a.position - b.position).map((sub) => ({
          id: sub.id, text: sub.text, note: sub.note ?? '',
        })),
      }))),
    thoughts: getVisualOrderedThoughtsForOutlinePoint(sermon, pointId).map((thought) => ({
      id: thought.id, text: thought.text, subPointId: thought.subPointId ?? null, keyFragments: thought.keyFragments ?? [],
    })),
  });
}
