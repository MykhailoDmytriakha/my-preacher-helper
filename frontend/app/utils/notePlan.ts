import { z } from 'zod';

import { serializeContent } from '@/utils/contentFingerprint';
import { scratchByOutlineNode } from '@/utils/scratchPlacement';
import { formatScriptureReference } from '@/utils/scriptureReference';
import { parseReferenceText } from '@/utils/scriptureReferenceParser';
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

export const NotePlanReceiptSchema = z.object({ proposal: NotePlanResultSchema, sourceKey: z.string() });
export type NotePlanReceipt = z.infer<typeof NotePlanReceiptSchema>;

export function storedNotePlanProposal(value: unknown): NotePlanResult {
  const { proposal, sourceKey } = NotePlanReceiptSchema.parse(value);
  return { ...proposal, sourceKey };
}

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

/**
 * A sketch that IS the steps: every reminder line reads «name: … a place of Scripture …» with one name at its start
 * («Одежда правды: Ис.61:10»), and there are at least two. Then the plan's steps are exactly these, in order — the light
 * model turned such a sketch into a table of the people in it (owner on production, 2026-11-22). A line pairing two
 * audiences («Братья: …; Сестры: …») or holding a second «name:» is not a step line, and a mixed sketch — some lines
 * thoughts, some places — gives none: there the model weighs the material as before.
 */
export function notePlanSketchSteps(reminder: string): { title: string; places: string }[] {
  const lines = reminder.split('\n').map((line) => line.trim()).filter(Boolean);
  const steps = lines.map((line) => {
    const match = /^([^:\d][^:]{0,79}?)\s*:\s*(.+)$/.exec(line);
    if (!match) return null;
    const [, title, places] = match;
    // A place the app's own reader takes for Scripture («Исх.28:2», «Зах.3:1-4» — not a time code «02:15»), and no
    // second label after it («… / Жёны: …», «…; Сестры: …»): a line pairing two names is a table's row, not a step.
    const placesFound = [...places.matchAll(/(?:[1-3]\s*)?\p{L}[\p{L}.]*\.?\s*\d+\s*:\s*\d+/gu)].some(([found]) => parseReferenceText(found) !== null);
    if (!placesFound || /\p{L}[^:\d]{0,40}:\s*\D/u.test(places.replace(/\d+\s*:\s*\d+(?:\s*[–-]\s*\d+)?(?:\s*,\s*\d+)*\s*:?/g, ''))) return null;
    return { title: title.trim(), places: places.trim() };
  });
  return steps.length >= 2 && steps.every(Boolean) ? steps as { title: string; places: string }[] : [];
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
