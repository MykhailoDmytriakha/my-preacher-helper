import { equalValues } from './fieldValues';
import { mergeDocumentFields } from './protocol';
import { sketchRows, withSketchRows } from './sermonScratchFrame';
import { UNREADABLE_ROW_PROOF } from './unreadableDraftProof';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, Json, ResourceSnapshot } from './types';
import type { ScratchNote } from '@/models/models';

export function capturedScratchRemoval(before: DocumentData, after: DocumentData) {
  const opening = sketchRows(before), remaining = sketchRows(after);
  if (!opening || !remaining || opening.length !== remaining.length + 1) return;
  const ids = new Set(remaining.map(note => note.id));
  const note = opening.find(item => !ids.has(item.id));
  const kept = note && opening.filter(item => item.id !== note.id);
  if (note && kept && equalValues(kept, remaining)) return { note, proposed: withSketchRows(before, kept) };
}

/** A queued deletion proves the previous row, but carries no action time. */
export function scratchRemovalRecoveryCopies(source: SessionCheckpoint, target: ResourceSnapshot, removed: readonly ScratchNote[]) {
  const { confirmed } = source;
  const { value: opening, metadata } = confirmed;
  const originals = opening && sketchRows(opening), stored = target.value && sketchRows(target.value);
  if (!metadata || !opening || !originals || !stored) return [];

  return removed.flatMap(note => {
    if (!stored.some(row => row.id === note.id && row.createdAt === note.createdAt)) return [];
    return [{
      key: 'scratch-removal:' + note.id, recoveryKind: 'sermon-scratch-removal' as const,
      continuation: {
        confirmed, draft: withSketchRows(opening, originals.filter(row => row.id !== note.id)),
        editGeneration: source.editGeneration, dirty: true, pending: {}, conflicts: [], remoteCandidate: null,
        unreadableRowProofs: [{ field: 'scratchRemoval', rowId: note.id, birth: note.createdAt, generation: metadata.generation }],
      } satisfies SessionCheckpoint,
    }];
  });
}

export function unresolvedScratchRemoval(checkpoint: SessionCheckpoint): boolean {
  return checkpoint.confirmed.resource.collection === 'sermons'
    && checkpoint.unreadableRowProofs?.some(address => address.field === 'scratchRemoval') === true;
}

function removalOpening(checkpoint: SessionCheckpoint) {
  const [address, other] = checkpoint.unreadableRowProofs ?? [];
  const { confirmed, draft } = checkpoint;
  if (other || address?.field !== 'scratchRemoval' || !unresolvedScratchRemoval(checkpoint)
    || !confirmed.value || !draft || confirmed.metadata?.deleted || confirmed.metadata?.generation !== address.generation
    || checkpoint.unreadableScalarProof?.length || checkpoint.unreadableExegeticalProofs?.length) return;
  const original = sketchRows(confirmed.value), later = sketchRows(draft);
  const note = original?.find(item => item.id === address.rowId && item.createdAt === address.birth);
  if (!original || !note || !later || later.some(item => item.id === address.rowId)) return;
  return { note, proposed: withSketchRows(confirmed.value, original.filter(item => item.id !== address.rowId)) };
}

function removalAgainstStored(checkpoint: SessionCheckpoint, removal: ReturnType<typeof capturedScratchRemoval>, target: ResourceSnapshot) {
  if (!removal || !target.metadata || !equalValues(target.resource, checkpoint.confirmed.resource)) return;
  const { note } = removal;
  const identity = JSON.stringify([note.id, note.createdAt, target.metadata.generation, target.metadata.revision, checkpoint.editGeneration]);
  if (target.metadata.deleted || target.metadata.generation !== checkpoint.confirmed.metadata?.generation) {
    return { opening: note.text, identity, settled: true as const };
  }
  const rows = target.value && sketchRows(target.value);
  if (!rows || !target.value) return;
  const stored = rows.find(item => item.id === note.id && item.createdAt === note.createdAt);
  if (!stored) return { opening: note.text, identity, settled: true as const };
  const conflict: ConflictDetail = {
    path: ['scratch', 'id:' + note.id], base: { exists: true, value: note as unknown as Json }, mine: { exists: false },
    theirs: { exists: true, value: stored as unknown as Json }, code: UNREADABLE_ROW_PROOF,
  };
  return { opening: note.text, stored: stored.text, identity, settled: false as const, conflict,
    proposed: withSketchRows(target.value, rows.filter(item => item.id !== note.id)) };
}

export function projectRecoveredScratchRemoval(checkpoint: SessionCheckpoint, target: ResourceSnapshot, side: 'local' | 'remote') {
  const opening = removalOpening(checkpoint);
  const comparison = removalAgainstStored(checkpoint, opening, target);
  if (!opening || !comparison || !checkpoint.draft || (side === 'local' && comparison.settled)) return;
  // Neutralize only the displayed removal in the ancestor. The rest of the draft belongs to later actions.
  const accepted = side === 'local' && !comparison.settled ? comparison.proposed : target.value;
  if (target.metadata?.generation !== checkpoint.confirmed.metadata?.generation && !equalValues(opening.proposed, checkpoint.draft)) return;
  const merged = mergeDocumentFields(opening.proposed, checkpoint.draft, accepted);
  return { value: merged.value.exists ? merged.value.value as DocumentData : null, conflicts: merged.conflicts };
}

export function recoveredScratchRemoval(checkpoint: SessionCheckpoint, target: ResourceSnapshot) {
  return removalAgainstStored(checkpoint, removalOpening(checkpoint), target);
}

/** A late delivery conflict must be reviewed again against that exact submitted removal. */
export function capturedScratchRemovalPath(request: CommitRequest): string[] | undefined {
  if (!request.scratchRemoval || !request.baseline.value || !request.value) return;
  const removal = capturedScratchRemoval(request.baseline.value, request.value);
  if (removal && equalValues(removal.proposed, request.value)) return ['scratch', 'id:' + removal.note.id];
}

export function pendingScratchRemoval(checkpoint: SessionCheckpoint) {
  const [request] = Object.entries(checkpoint.pending).sort(([, left], [, right]) => left.generation - right.generation);
  const { confirmed, remoteCandidate, conflicts } = checkpoint;
  if (!request?.[1].value || !confirmed.value || !remoteCandidate || confirmed.resource.collection !== 'sermons'
    || !conflicts.some(({ path }) => path[0] === 'scratch')) return;
  const [requestId, { value }] = request;
  const removal = capturedScratchRemoval(confirmed.value, value!);
  if (!removal || !equalValues(removal.proposed, value)) return;
  const comparison = removalAgainstStored(checkpoint, removal, remoteCandidate);
  return comparison && { ...comparison, requestId };
}

export const sermonScratchRemovalDraft = (checkpoint: SessionCheckpoint) => removalOpening(checkpoint)?.note.text;
