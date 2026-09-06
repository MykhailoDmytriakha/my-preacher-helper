import { z } from 'zod';

import { getVisualOrderedThoughtsForOutlinePoint } from '@/utils/sermonVisualOrder';

import type { Sermon, SermonPoint } from '@/models/models';

export const NOTE_PLAN_INSTRUCTION_LIMIT = 2000;
export const NotePlanRevisionSchema = z.object({
  instruction: z.string().trim().min(1).max(NOTE_PLAN_INSTRUCTION_LIMIT),
  mode: z.enum(['edit', 'references', 'rewrite']),
  currentContentByNodeId: z.record(z.string().max(50_000)),
});
export type NotePlanRevision = z.infer<typeof NotePlanRevisionSchema>;
export type NotePlanRevisionIntent = Pick<NotePlanRevision, 'instruction' | 'mode'>;

export const NotePlanRequestSchema = z.object({
  outlinePointId: z.string().min(1),
  targetNodeId: z.string().min(1).optional(),
  style: z.enum(['memory', 'narrative', 'exegetical']),
  expectedContext: z.string().min(1),
  revision: NotePlanRevisionSchema.optional(),
});

export const NotePlanResultSchema = z.object({
  contentByNodeId: z.record(z.string()),
  missingMaterial: z.record(z.string()),
});

export type NotePlanResult = z.infer<typeof NotePlanResultSchema>;

/** One explicit cell, or the existing whole-point scope when no target is supplied. */
export function notePlanTargetNodes(point: SermonPoint, targetNodeId?: string) {
  const nodes = [
    { nodeId: point.id, title: point.text, reminder: point.note ?? '', kind: 'point' },
    [...(point.subPoints ?? [])].sort((a, b) => a.position - b.position).map((sub) => ({
      nodeId: sub.id, title: sub.text, reminder: sub.note ?? '', kind: 'subPoint',
    })),
  ].flat();
  return targetNodeId === undefined ? nodes : nodes.filter((node) => node.nodeId === targetNodeId);
}

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
