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
    const observed = capturedGuardedScratchOpening(confirmed, before, request, previous.id);
    return observed && { kind: 'text' as const, observed };
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
  const appended: ScratchNote[] = [];
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
      const { observed } = action;
      const id = observed.target.id;
      if (structuralRows.has(id)) return;
      if (!textOpenings.has(id)) {
        if (readSermonNoteText(opening, observed.target)?.text !== observed.text) return;
        textOpenings.set(id, observed);
      }
      textActions.add(request.id);
      continue;
    }
    const { note } = action;
    if (structuralRows.has(note.id) || textOpenings.has(note.id)) return;
    if (action.kind === 'removal') {
      if (!confirmed.metadata || !equalValues(note, originalById.get(note.id))) return;
      removed.push(note);
    } else appended.push(note);
    structuralRows.add(note.id);
  }
  if (structuralRows.size || textOpenings.size) return { appended, removed, textOpenings, textActions };
}

/** Separate saved scratch actions only when every change is proven and their rows are independent. */
export function recoverableScratchTail(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const { confirmed, draft } = source, target = projected.confirmed;
  const opening = confirmed.value, first = chain[0]?.value, last = chain.at(-1)?.value, saved = target.value;
  const originals = opening && sketchRows(opening);
  if (!opening || !originals || !first || !last || !draft || !saved || !sketchRows(saved)
    || !sameSketchFrame(opening, first) || !sameSketchFrame(last, draft)) return;

  const captures = captureIndependentScratchActions(confirmed, opening, originals, chain);
  if (!captures) return;
  const { appended, removed, textOpenings, textActions } = captures;
  const placement = appended.length ? placedSketchRecovery(source, target, appended) : undefined;
  if (appended.length && !placement) return;

  const copies = [
    ...(placement?.continuation ? [{ key: 'placed-sketches', recoveryKind: 'sermon-placed-sketch' as const, continuation: placement.continuation }] : []),
    ...scratchRemovalRecoveryCopies(source, target, removed),
    ...scratchTextRecoveryCopies(source, target, last, textOpenings.values()),
  ];
  return { textActions, copies, restoreStored: (value: DocumentData) => restoreSketchFrame(value, saved) };
}
