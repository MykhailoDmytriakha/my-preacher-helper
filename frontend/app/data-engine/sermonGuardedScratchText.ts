import { matchesSermonNoteOpening, readSermonNoteText, withSermonNoteText } from '@/utils/sermonNoteText';

import { equalValues } from './fieldValues';
import { mergeDocumentFields } from './protocol';
import { sameSketchFrame, sketchRows } from './sermonScratchFrame';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, EditorCommitAction, ResourceSnapshot } from './types';
import type { SermonNoteOpening } from '@/utils/sermonNoteText';

const REVIEW = 'guarded-scratch-text';
export const isGuardedScratchTextConflict = (conflict: ConflictDetail) => conflict.code === REVIEW;

export type ScratchOpening = SermonNoteOpening & { target: Extract<SermonNoteOpening['target'], { kind: 'scratch' }> };
const changedWords = (copy: DocumentData | null, opening: ScratchOpening) => readSermonNoteText(copy, opening.target)?.text;

function isScratchOpening(opening?: SermonNoteOpening): opening is ScratchOpening {
  return opening?.target.kind === 'scratch' && typeof opening.text === 'string';
}

/** Prove the captured text operation against its immediate predecessor and original document. */
export function capturedGuardedScratchOpening(
  confirmed: ResourceSnapshot, before: DocumentData, request: CommitRequest, predecessor: string,
): ScratchOpening | undefined {
  const observed = request.sermonNoteText, after = request.value;
  if (!after || !isScratchOpening(observed) || request.sequence !== 0 || !matchesSermonNoteOpening(confirmed, observed)
    || !observed.pending.includes(predecessor) || observed.text !== changedWords(before, observed)) return;
  const words = changedWords(after, observed);
  const exact = typeof words === 'string' && words !== observed.text && withSermonNoteText(before, observed.target, words);
  if (exact && sameSketchFrame(exact, after)) return observed;
}

export function scratchTextRecoveryCopies(
  source: SessionCheckpoint, target: ResourceSnapshot, last: DocumentData, openings: Iterable<ScratchOpening>,
) {
  const { confirmed } = source;
  return Array.from(openings).flatMap(observed => {
    const words = changedWords(last, observed);
    if (typeof words !== 'string' || words === changedWords(target.value, observed)) return [];
    const next = withSermonNoteText(confirmed.value, observed.target, words);
    return next ? [{ key: 'scratch-text:' + JSON.stringify(observed.target), recoveryKind: 'sermon-scratch-text' as const, continuation: {
      confirmed, draft: next, editGeneration: source.editGeneration, dirty: true, pending: {}, conflicts: [], remoteCandidate: target,
      guardedScratchText: { ...observed, pending: [] },
    } satisfies SessionCheckpoint }] : [];
  });
}

export function guardedScratchWords(checkpoint: SessionCheckpoint): string | undefined {
  const opening = checkpoint.guardedScratchText;
  if (!isScratchOpening(opening)) return;
  return changedWords(checkpoint.draft, opening) ?? undefined;
}

function currentWords(checkpoint: SessionCheckpoint, target: ResourceSnapshot) {
  const opening = checkpoint.guardedScratchText, mine = guardedScratchWords(checkpoint);
  if (!isScratchOpening(opening) || mine === undefined) return;
  const stored = matchesSermonNoteOpening(target, opening) ? changedWords(target.value, opening) : undefined;
  const revision = opening.observedRevision;
  const versionKnown = typeof revision === 'number' && revision > 0 && revision <= (target.metadata?.revision ?? 0);
  return { opening, mine, stored, needsChoice: mine !== stored && (stored !== opening.text || !versionKnown) };
}

function exactScratchText(before: DocumentData, after: DocumentData) {
  const next = sketchRows(after), originals = sketchRows(before);
  if (!next || !originals) return;
  const byId = new Map(originals.map(note => [note.id, note]));
  const edits = next.filter(note => {
    const prior = byId.get(note.id);
    return prior?.createdAt === note.createdAt && prior.text !== note.text;
  });
  const [edit] = edits;
  if (edits.length !== 1) return;
  const field = { kind: 'scratch' as const, id: edit.id, createdAt: edit.createdAt };
  if (equalValues(withSermonNoteText(before, field, edit.text), after)) return { field, words: edit.text };
}

export function capturedGuardedScratchTextPath(request: CommitRequest): string[] | undefined {
  if (!request.scratchTextRecovery || !request.value || !request.baseline.value) return;
  const captured = exactScratchText(request.baseline.value, request.value);
  if (captured) return ['scratch', 'id:' + captured.field.id, 'text'];
}

export function blocksIndependentActionDuringScratchRecovery(checkpoint: SessionCheckpoint, action?: EditorCommitAction): boolean {
  const opening = checkpoint.guardedScratchText;
  return Boolean(opening && action && (action.kind !== 'sermon-note-text' || !equalValues(action.opening.target, opening.target)));
}

export function guardedScratchTextSubmission(checkpoint: SessionCheckpoint): DocumentData | undefined {
  const { guardedScratchText: opening, confirmed } = checkpoint, words = guardedScratchWords(checkpoint);
  if (!isScratchOpening(opening) || words === undefined || !matchesSermonNoteOpening(confirmed, opening)) return;
  return withSermonNoteText(confirmed.value, opening.target, words);
}

export function pendingGuardedScratchTextReview(checkpoint: SessionCheckpoint) {
  const [request] = Object.entries(checkpoint.pending).sort(([, left], [, right]) => left.generation - right.generation);
  const { confirmed, remoteCandidate: target, conflicts } = checkpoint;
  if (!request?.[1].value || !confirmed.value || !target || confirmed.resource.collection !== 'sermons'
    || !conflicts.some(({ path }) => path[0] === 'scratch')) return;
  const captured = exactScratchText(confirmed.value, request[1].value);
  if (!captured) return;
  const { field, words } = captured;
  const row = 'id:' + field.id;
  if (!conflicts.some(({ path }) => path[0] === 'scratch' && path[1] === row && (path.length === 2 || path[2] === 'text'))) return;
  const sameGeneration = target.metadata?.generation === confirmed.metadata?.generation && !target.metadata?.deleted;
  const stored = sameGeneration ? readSermonNoteText(target.value, field)?.text : undefined;
  const proposed = typeof stored === 'string' ? withSermonNoteText(target.value, field, words) : undefined;
  if (stored === words) return;
  const opening: ScratchOpening | undefined = proposed && typeof stored === 'string' ? {
    sermonId: confirmed.resource.id, target: field, text: stored, pending: [],
    generation: target.metadata?.generation ?? null, observedRevision: target.metadata?.revision ?? null,
  } : undefined;
  return { requestId: request[0], mine: words, stored, keepMineDisabled: !proposed, proposed, opening,
    identity: JSON.stringify([request[0], target.metadata, field, words, stored ?? null, checkpoint.editGeneration]) };
}

export function guardedScratchTextReview(checkpoint: SessionCheckpoint) {
  if (Object.keys(checkpoint.pending).length) return pendingGuardedScratchTextReview(checkpoint);
  const target = checkpoint.remoteCandidate;
  if (!target || !checkpoint.conflicts.some(isGuardedScratchTextConflict)) return;
  const review = currentWords(checkpoint, target);
  if (!review?.needsChoice) return;
  return { identity: JSON.stringify([target.metadata, review.opening.target, review.mine, review.stored ?? null, checkpoint.editGeneration]),
    mine: review.mine, stored: review.stored, keepMineDisabled: typeof review.stored !== 'string' };
}

/** Refresh the text without changing the historical opening. Explicit choice may establish a new opening. */
export function projectGuardedScratchText(checkpoint: SessionCheckpoint, target: ResourceSnapshot, side?: 'local' | 'remote') {
  const data = currentWords(checkpoint, target);
  if (!data || !checkpoint.draft || !equalValues(target.resource, checkpoint.confirmed.resource)) return;
  const { opening, mine, stored, needsChoice } = data;
  const others = checkpoint.conflicts.filter(conflict => !isGuardedScratchTextConflict(conflict));
  if (!side && needsChoice) {
    const conflict: ConflictDetail = { path: ['scratch', 'id:' + opening.target.id, 'text'],
      base: { exists: true, value: opening.text }, mine: { exists: true, value: mine },
      theirs: typeof stored === 'string' ? { exists: true, value: stored } : { exists: false }, code: REVIEW };
    return { ...checkpoint, remoteCandidate: target, conflicts: [...others, conflict], dirty: true };
  }
  if (side === 'local' && typeof stored !== 'string') return;
  const wanted = side === 'remote' ? target.value : withSermonNoteText(target.value, opening.target, mine);
  if (wanted === undefined) return;
  const baseline = withSermonNoteText(checkpoint.confirmed.value, opening.target, mine);
  if (!baseline) return;
  const merged = mergeDocumentFields(baseline, checkpoint.draft, wanted);
  const draft = merged.value.exists ? merged.value.value as DocumentData : null;
  const guard = side === 'remote' || mine === stored ? undefined : side === 'local'
    ? { ...opening, text: stored!, generation: target.metadata?.generation ?? null, observedRevision: target.metadata?.revision ?? null }
    : opening;
  return { ...checkpoint, confirmed: target, draft, dirty: !equalValues(draft, target.value), guardedScratchText: guard,
    conflicts: merged.conflicts, remoteCandidate: merged.conflicts.length ? target : null };
}
