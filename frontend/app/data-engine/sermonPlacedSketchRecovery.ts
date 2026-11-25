import { placeOfNode, scratchAfterOutlineChange, scratchNoteAt } from '@/utils/scratchPlacement';

import { protectedSermonRecoveryKind } from './editorIdentity';
import { equalValues, object, readField, restoreStoredField } from './fieldValues';

import type { CommitRequest } from './commits';
import type { EditorRecord } from './controller';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, Json, ResourceSnapshot } from './types';
import type { ScratchNote, SermonOutline } from '@/models/models';

const SKETCH_TEXT_COLLISION = 'recovered-sketch-text';
const SKETCH_ID_COLLISION = 'recovered-sketch-id';
const scratchPath = ['scratch'] as const;
const outline = (value: DocumentData) => value.outline as unknown as SermonOutline | undefined;

function sketchRows(value: DocumentData): readonly ScratchNote[] | undefined {
  const field = readField(value, scratchPath);
  if (!field.exists) return [];
  const rows = field.value;
  if (!Array.isArray(rows) || !rows.every(row => object(row) && typeof row.id === 'string' && row.id
    && typeof row.text === 'string' && typeof row.createdAt === 'string' && row.createdAt)
    || new Set(rows.map(row => (row as DocumentData).id)).size !== rows.length) return;
  return rows as unknown as ScratchNote[];
}

function appendedSketches(before: DocumentData, after: DocumentData) {
  const opening = sketchRows(before), result = sketchRows(after);
  if (!opening || !result || result.length <= opening.length
    || !equalValues(result.slice(0, opening.length), opening)) return;
  return result.slice(opening.length);
}

function capturedSketch(before: DocumentData, after: DocumentData): ScratchNote | undefined {
  const [note, extra] = appendedSketches(before, after) ?? [];
  if (!note?.outlinePointId || extra || note.text !== note.text.trim() || !note.text) return;
  const target = note.subPointId ? { kind: 'subpoint' as const, id: note.subPointId }
    : { kind: 'point' as const, id: note.outlinePointId };
  const place = placeOfNode(outline(before), target);
  if (place && equalValues(note, scratchNoteAt(place, { id: note.id, text: note.text, createdAt: note.createdAt }))) return note;
}

function pureSketchAppend(checkpoint: SessionCheckpoint) {
  const { confirmed, draft } = checkpoint;
  if (confirmed.resource.collection !== 'sermons' || !confirmed.value || !draft
    || !equalValues(restoreStoredField(draft, confirmed.value, scratchPath), confirmed.value)) return;
  return appendedSketches(confirmed.value, draft);
}

function sketchPlacements(opening: DocumentData, notes: readonly ScratchNote[], saved: DocumentData) {
  const ids = new Set(notes.map(note => note.id));
  const placed = scratchAfterOutlineChange(notes, outline(opening), outline(saved)).filter(note => ids.has(note.id));
  return placed.length === notes.length ? placed : undefined;
}

export function isPlacedSketchConflict(conflict: ConflictDetail): boolean {
  return conflict.code === SKETCH_ID_COLLISION || conflict.code === SKETCH_TEXT_COLLISION;
}

export function observePlacedSketchConflicts(checkpoint: SessionCheckpoint, snapshot: ResourceSnapshot): ConflictDetail[] {
  const { confirmed } = checkpoint;
  if (!confirmed.value || !snapshot.value || !snapshot.metadata || snapshot.metadata.generation !== confirmed.metadata?.generation) return [];
  const appended = pureSketchAppend(checkpoint);
  const notes = appended && sketchPlacements(confirmed.value, appended, snapshot.value);
  const current = notes && sketchRows(snapshot.value);
  if (!notes || !current) return [];
  const byId = new Map(current.map(note => [note.id, note]));
  return notes.flatMap(note => {
    const stored = byId.get(note.id);
    if (!stored || equalValues(stored, note)) return [];
    return [{ path: ['scratch', 'id:' + note.id], base: { exists: false },
      mine: { exists: true, value: note as unknown as Json }, theirs: { exists: true, value: stored as unknown as Json },
      code: stored.createdAt === note.createdAt ? SKETCH_TEXT_COLLISION : SKETCH_ID_COLLISION }];
  });
}

export function hasPlacedSketchIdCollision(conflicts: readonly ConflictDetail[]): boolean {
  return conflicts.some(conflict => conflict.code === SKETCH_ID_COLLISION);
}

export function readPlacedSketchComparison(checkpoint: SessionCheckpoint) {
  const { conflicts, remoteCandidate, editGeneration } = checkpoint;
  if (!remoteCandidate || !conflicts.length || !conflicts.every(isPlacedSketchConflict)) return;
  const words = (side: 'mine' | 'theirs') => conflicts.map(conflict => {
    const note = conflict[side].value;
    return object(note) && typeof note.text === 'string' ? note.text : '';
  }).join('\n');
  return { identity: JSON.stringify([remoteCandidate.metadata, conflicts, editGeneration]), mine: words('mine'), stored: words('theirs'),
    keepMineDisabled: hasPlacedSketchIdCollision(conflicts) };
}

export function resolvePlacedSketchComparison(checkpoint: SessionCheckpoint, side: 'local' | 'remote'): DocumentData | undefined {
  const { confirmed, remoteCandidate, conflicts } = checkpoint;
  if (!readPlacedSketchComparison(checkpoint) || !confirmed.value || !remoteCandidate?.value) return;
  const notes = pureSketchAppend(checkpoint);
  if (!notes || !equalValues(observePlacedSketchConflicts(checkpoint, remoteCandidate), conflicts)) {
    throw Object.assign(new Error('The compared scratch notes changed'), { code: 'decision-changed' });
  }
  if (side === 'local' && hasPlacedSketchIdCollision(conflicts)) {
    throw Object.assign(new Error('The saved scratch note is a different note'), { code: 'decision-changed' });
  }
  const compared = new Set(conflicts.map(conflict => conflict.path[1]));
  const projected = projectSketches(confirmed.value, notes.filter(note => !compared.has('id:' + note.id)), remoteCandidate.value, false);
  const stored = projected && sketchRows(projected);
  if (!stored) throw Object.assign(new Error('The compared scratch notes changed'), { code: 'decision-changed' });
  if (side === 'remote') return projected;
  const words = new Map(notes.filter(note => compared.has('id:' + note.id)).map(note => [note.id, note.text]));
  return { ...projected, scratch: stored.map(note => words.has(note.id) ? { ...note, text: words.get(note.id)! } : note) as unknown as Json };
}

function projectSketches(opening: DocumentData, notes: readonly ScratchNote[], saved: DocumentData,
  retainNewerStoredText: boolean): DocumentData | undefined {
  const current = sketchRows(saved);
  if (!current) return;
  const byId = new Map(current.map(note => [note.id, note]));
  const placed = sketchPlacements(opening, notes, saved);
  if (!placed) return;
  // The original append is satisfied by a later version of that same note. A reopened draft may contain later typing.
  for (const note of placed) {
    const current = byId.get(note.id);
    if (current && (!retainNewerStoredText || current.createdAt !== note.createdAt) && !equalValues(current, note)) return;
  }
  const additions = placed.filter(note => !byId.has(note.id));
  return additions.length ? { ...saved, scratch: [...current, ...additions] as unknown as Json } : saved;
}

/** Only an exact tail of authored appends can be separated from the previous point's refusal. */
export function recoverablePlacedSketches(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const { confirmed, draft } = source;
  const first = chain[0]?.value, last = chain.at(-1)?.value, saved = projected.confirmed.value;
  const sameScratch = (left: DocumentData, right: DocumentData) =>
    equalValues(readField(left, scratchPath), readField(right, scratchPath));
  if (!confirmed.value || !draft || !first || !last || !saved || !sameScratch(confirmed.value, first) || !sameScratch(last, draft)) return;
  const notes: ScratchNote[] = [];
  for (let index = 1; index < chain.length; index += 1) {
    const before = chain[index - 1].value, after = chain[index].value;
    if (!before || !after) return;
    if (sameScratch(before, after)) continue;
    const note = capturedSketch(before, after);
    if (!note) return;
    notes.push(note);
  }
  if (!notes.length) return;
  const append: SessionCheckpoint = {
    confirmed, draft: { ...confirmed.value, scratch: [...sketchRows(confirmed.value)!, ...notes] as unknown as Json },
    editGeneration: source.editGeneration, dirty: true, pending: {}, conflicts: [], remoteCandidate: null,
  };
  const rebased = projectSketches(confirmed.value, notes, saved, true);
  const conflicts = rebased ? [] : observePlacedSketchConflicts(append, projected.confirmed);
  if (!rebased && !conflicts.length) return;
  const continuation = rebased === saved ? undefined : rebased
    ? { ...append, confirmed: projected.confirmed, draft: rebased }
    : { ...append, conflicts, remoteCandidate: projected.confirmed };
  return { continuation, restoreStored: (value: DocumentData) => restoreStoredField(value, saved, scratchPath) };
}

/** Reproject only an append onto a fresh opening just before restoring its saved copy. */
export function rebaseRecoveredPlacedSketches(checkpoint: SessionCheckpoint, saved: ResourceSnapshot,
  original: boolean): SessionCheckpoint | undefined {
  const { confirmed, draft } = checkpoint;
  if (!confirmed.value || !draft || !saved.value || !saved.metadata || saved.metadata.deleted
    || confirmed.metadata?.generation !== saved.metadata.generation) return;
  const notes = pureSketchAppend(checkpoint);
  const rebased = notes && projectSketches(confirmed.value, notes, saved.value, original);
  if (!rebased) return;
  return { ...checkpoint, confirmed: saved, draft: rebased, dirty: rebased !== saved.value, conflicts: [], remoteCandidate: null };
}

export function sermonPlacedSketchDraft({ editorId, checkpoint }: EditorRecord): string | undefined {
  if (protectedSermonRecoveryKind(editorId) === 'sermon-placed-sketch') {
    return pureSketchAppend(checkpoint)?.map(note => note.text).join('\n').slice(0, 500);
  }
}
