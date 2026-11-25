import { readSermonNoteText } from '@/utils/sermonNoteText';

import { equalValues } from './fieldValues';
import { capturedGuardedScratchOpening, scratchTextRecoveryCopies } from './sermonGuardedScratchText';
import { capturedPlacedSketch, placedSketchRecovery } from './sermonPlacedSketchRecovery';
import { restoreSketchFrame, sameSketchFrame, sketchRows } from './sermonScratchFrame';
import { capturedScratchRemoval, scratchRemovalRecoveryCopies } from './sermonScratchRemovalRecovery';

import type { CommitRequest } from './commits';
import type { ScratchOpening } from './sermonGuardedScratchText';
import type { SessionCheckpoint } from './session';
import type { DocumentData, ResourceSnapshot } from './types';
import type { ScratchNote } from '@/models/models';

function capturedScratchAction(confirmed: ResourceSnapshot, previous: CommitRequest, request: CommitRequest) {
  const before = previous.value, after = request.value;
  if (!before || !after) return;
  if (request.sermonNoteText) {
    const captured = capturedGuardedScratchOpening(confirmed, before, request, previous.id);
    return captured && { kind: 'text' as const, ...captured };
  }
  if (sameSketchFrame(before, after)) return { kind: 'unchanged' as const };

  const added = capturedPlacedSketch(before, after);
  if (added) return { kind: 'append' as const, note: added };
  const removed = capturedScratchRemoval(before, after);
  if (removed) return { kind: 'removal' as const, note: removed.note };
}

function captureIndependentScratchActions(
  confirmed: ResourceSnapshot, opening: DocumentData, originals: readonly ScratchNote[], chain: readonly CommitRequest[],
) {
  const originalById = new Map(originals.map(note => [note.id, note]));
  const appended = new Map<string, { note: ScratchNote; requestId: string; amended: boolean }>();
  const removed: ScratchNote[] = [];
  const structuralRows = new Set<string>();
  const textOpenings = new Map<string, ScratchOpening>();
  const textActions = new Set<string>();
  for (let index = 1; index < chain.length; index += 1) {
    const request = chain[index];
    const action = capturedScratchAction(confirmed, chain[index - 1], request);
    if (!action) return;
    if (action.kind === 'unchanged') continue;
    if (action.kind === 'text') {
      const observed = action.opening;
      const id = observed.target.id;
      const addition = appended.get(id);
      if (addition) {
        if (addition.note.createdAt !== observed.target.createdAt || !observed.pending.includes(addition.requestId)) return;
        addition.note = { ...addition.note, text: action.words };
        addition.amended = true;
      } else {
        if (structuralRows.has(id)) return;
        if (!textOpenings.has(id)) {
          if (readSermonNoteText(opening, observed.target)?.text !== observed.text) return;
          textOpenings.set(id, observed);
        }
      }
      textActions.add(request.id);
      continue;
    }
    const { note } = action;
    if (structuralRows.has(note.id) || textOpenings.has(note.id)) return;
    if (action.kind === 'removal') {
      if (!confirmed.metadata || !equalValues(note, originalById.get(note.id))) return;
      removed.push(note);
    } else appended.set(note.id, { note, requestId: request.id, amended: false });
    structuralRows.add(note.id);
  }
  if (structuralRows.size || textOpenings.size) return { appended, removed, textOpenings, textActions };
}

/** Keep edits of an unsent addition together, and separate actions whose rows are independent. */
export function recoverableScratchTail(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const { confirmed, draft } = source, target = projected.confirmed;
  const opening = confirmed.value, first = chain[0]?.value, last = chain.at(-1)?.value, saved = target.value;
  const originals = opening && sketchRows(opening);
  if (!opening || !originals || !first || !last || !draft || !saved || !sketchRows(saved)
    || !sameSketchFrame(opening, first) || !sameSketchFrame(last, draft)) return;

  const captures = captureIndependentScratchActions(confirmed, opening, originals, chain);
  if (!captures) return;
  const { appended, removed, textOpenings, textActions } = captures;
  const additions = [...appended.values()];
  const unchanged = additions.filter(addition => !addition.amended).map(addition => addition.note);
  const placement = unchanged.length ? placedSketchRecovery(source, target, unchanged, 'addition') : undefined;
  if (unchanged.length && !placement) return;

  const editedCopies = [];
  for (const { note, amended } of additions) {
    if (!amended) continue;
    const placed = placedSketchRecovery(source, target, [note], 'amended');
    if (!placed) return;
    if (placed.continuation) editedCopies.push({
      key: 'amended-sketch:' + note.id, recoveryKind: 'sermon-amended-sketch' as const, continuation: placed.continuation,
    });
  }
  const copies = [
    ...(placement?.continuation ? [{ key: 'placed-sketches', recoveryKind: 'sermon-placed-sketch' as const, continuation: placement.continuation }] : []),
    ...editedCopies,
    ...scratchRemovalRecoveryCopies(source, target, removed),
    ...scratchTextRecoveryCopies(source, target, last, textOpenings.values()),
  ];
  return { textActions, copies, restoreStored: (value: DocumentData) => restoreSketchFrame(value, saved) };
}
