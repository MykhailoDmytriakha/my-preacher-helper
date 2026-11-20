import { z } from 'zod';

import { serializeContent } from '@/utils/contentFingerprint';
import { scratchByOutlineNode } from '@/utils/scratchPlacement';
import { formatScriptureReference } from '@/utils/scriptureReference';
import { getVisualOrderedThoughtsForOutlinePoint } from '@/utils/sermonVisualOrder';

import type { Sermon, SermonPoint, StudyNote } from '@/models/models';

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
  expectedSourceKey: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  revision: NotePlanRevisionSchema.optional(),
});

export type NotePlanRequest = z.infer<typeof NotePlanRequestSchema>;

export const NotePlanResultSchema = z.object({
  contentByNodeId: z.record(z.string()),
  missingMaterial: z.record(z.string()),
  sourceKey: z.string().optional(),
  sourceChanged: z.boolean().optional(),
});

export type NotePlanResult = z.infer<typeof NotePlanResultSchema>;

/** The ordered note material used by the generator, in one Scripture numbering. */
export function notePlanSourceMaterial(notes: StudyNote[]) {
  return notes.map(note => ({
    id: note.id,
    title: note.title ?? '',
    content: note.content,
    scriptureRefs: (note.scriptureRefs ?? []).map(ref => formatScriptureReference(ref, { style: 'canonical' })),
  }));
}

export function notePlanSourceText(notes: StudyNote[]): string {
  return serializeContent(notePlanSourceMaterial(notes));
}

/**
 * The scratch notes filed on each outline node, by node id. A node's reminders are its old one-line `note`
 * and these notes (owner, 2026-11-19: they are one thing, pieces), so the plan reads all of them.
 */
export function notePlanFiledNotes(sermon: Pick<Sermon, 'outline' | 'scratch'>): Record<string, string[]> {
  return Object.fromEntries([...scratchByOutlineNode(sermon.scratch ?? [], sermon.outline)].map(([nodeId, notes]) => [nodeId, notes.map((note) => note.text)]));
}

/** A node's reminders as the plan reads them: the old one-line note first, then each filed note, one per line. */
export function notePlanReminder(nodeId: string, note: string | undefined, filed: Record<string, string[]> = {}): string {
  return [note, ...(filed[nodeId] ?? [])].filter((text): text is string => Boolean(text?.trim())).join('\n');
}

/** One explicit cell, or the existing whole-point scope when no target is supplied. */
export function notePlanTargetNodes(point: SermonPoint, targetNodeId?: string, filed: Record<string, string[]> = {}) {
  const nodes = [
    { nodeId: point.id, title: point.text, reminder: notePlanReminder(point.id, point.note, filed), kind: 'point' },
    [...(point.subPoints ?? [])].sort((a, b) => a.position - b.position).map((sub) => ({
      nodeId: sub.id, title: sub.text, reminder: notePlanReminder(sub.id, sub.note, filed), kind: 'subPoint',
    })),
  ].flat();
  return targetNodeId === undefined ? nodes : nodes.filter((node) => node.nodeId === targetNodeId);
}

/** Compare the actual generation inputs, not unrelated changes to saved plan text. */
export function notePlanContextKey(sermon: Sermon, pointId: string): string {
  const filed = notePlanFiledNotes(sermon);
  return JSON.stringify({
    title: sermon.title,
    verse: sermon.verse,
    sourceNoteIds: sermon.sourceNoteIds ?? [],
    outline: ['introduction', 'main', 'conclusion'].map((section) =>
      (sermon.outline?.[section as keyof NonNullable<Sermon['outline']>] ?? []).map((point) => ({
        id: point.id, text: point.text, note: point.note ?? '', filed: filed[point.id] ?? [],
        subPoints: [...(point.subPoints ?? [])].sort((a, b) => a.position - b.position).map((sub) => ({
          id: sub.id, text: sub.text, note: sub.note ?? '', filed: filed[sub.id] ?? [],
        })),
      }))),
    thoughts: getVisualOrderedThoughtsForOutlinePoint(sermon, pointId).map((thought) => ({
      id: thought.id, text: thought.text, subPointId: thought.subPointId ?? null, keyFragments: thought.keyFragments ?? [],
    })),
  });
}
