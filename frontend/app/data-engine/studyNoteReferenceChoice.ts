import { projectStudyNoteReferenceChoice } from '@/utils/studyNoteReferenceChoice';

import { equalValues, readField, writeField } from './fieldValues';
import { mergeDocumentFields, mergeFields } from './protocol';
import {
  alignStudyNoteReferenceChange, hasStudyNoteReferenceReview, isOrdinaryReferenceDocument,
  referenceRows, reviewedStudyNoteReferences, studyNoteReferencesPath,
} from './studyNoteReferenceMerge';

import type { SessionCheckpoint } from './session';
import type { DocumentData, FieldValue } from './types';

function referenceChoice(checkpoint: SessionCheckpoint) {
  const { confirmed, remoteCandidate, draft, conflicts } = checkpoint;
  if (confirmed.resource.collection !== 'studyNotes' || !isOrdinaryReferenceDocument(confirmed.value) || !isOrdinaryReferenceDocument(draft)
    || !remoteCandidate || !isOrdinaryReferenceDocument(remoteCandidate.value)
    || remoteCandidate.resource.id !== confirmed.resource.id || remoteCandidate.resource.collection !== confirmed.resource.collection
    || remoteCandidate.metadata?.generation !== confirmed.metadata?.generation) return undefined;
  const reviewed = reviewedStudyNoteReferences(conflicts);
  if (!reviewed) return undefined;
  const aliases = remoteCandidate.metadata?.studyNoteReferenceAliases ?? [];
  const latest = readField(remoteCandidate.value, studyNoteReferencesPath);
  const current = readField(draft, studyNoteReferencesPath);
  // Older checkpoints may have kept only the projected list. Use the actual
  // captured request if available; never infer a later edit from a renamed ID.
  const authored = reviewed.authored ?? Object.values(checkpoint.pending).sort((a, b) => a.generation - b.generation)
    .map(pending => pending.value && readField(pending.value, studyNoteReferencesPath)).find(Boolean);
  const opening = authored || reviewed.mine;
  // When the submitted edit already changed an aliased row, it is still the
  // baseline for later typing. Use the projection to identify its current ID.
  const projected = referenceRows(reviewed.mine);
  const openingRows = referenceRows(opening);
  const currentRows = referenceRows(current);
  if (!projected || !openingRows || !currentRows) return undefined;
  const canonicalIds = new Map(aliases.map(({ from, to }) => [from, to]));
  const knownIds = new Set(openingRows.map(row => canonicalIds.get(row.id) ?? row.id));
  const afterAnswer = projected.filter(row => !knownIds.has(row.id) && currentRows.some(live => live.id === row.id));
  const comparisonOpening = { ...opening, value: [...openingRows, ...afterAnswer] };
  const delta = alignStudyNoteReferenceChange(comparisonOpening, current, latest, aliases);
  if (!delta) return undefined;
  const mine = mergeFields(reviewed.accepted, reviewed.mine, latest, studyNoteReferencesPath).value;
  const stored = mergeFields(reviewed.accepted, latest, reviewed.stored, studyNoteReferencesPath).value;
  const mineAfterEdit = mergeFields(delta.before, delta.after, mine, studyNoteReferencesPath).value;
  const storedAfterEdit = mergeFields(delta.before, stored, delta.after, studyNoteReferencesPath).value;
  const mineRows = referenceRows(mineAfterEdit), savedRows = referenceRows(storedAfterEdit);
  const acceptedRows = referenceRows(latest);
  if (!mineRows || !savedRows || !acceptedRows) return undefined;
  const { references: localRows, collapsed } = projectStudyNoteReferenceChoice(mineRows, savedRows, acceptedRows);
  const localChoice = localRows === mineRows ? mineAfterEdit : { exists: true, value: localRows };
  const local = new Map(localRows.map(row => [row.id, row]));
  const saved = new Map(savedRows.map(row => [row.id, row]));
  const field = (row: DocumentData | undefined): FieldValue => row === undefined ? { exists: false } : { exists: true, value: row };
  const comparedIds = [...new Set([...local.keys(), ...saved.keys()])].filter(id => !equalValues(local.get(id), saved.get(id)));
  const rows = comparedIds.map(id => ({ mine: field(local.get(id) ?? collapsed.get(id)), stored: field(saved.get(id)) }));
  if (!rows.length && !equalValues(localChoice, storedAfterEdit)) {
    rows.push({ mine: localChoice, stored: storedAfterEdit });
    comparedIds.push(...local.keys());
  }

  const otherChanges = writeField(draft, studyNoteReferencesPath, readField(confirmed.value, studyNoteReferencesPath));
  const merge = mergeDocumentFields(confirmed.value, otherChanges, remoteCandidate.value);
  // Top-level text conflicts can be compared alongside references. More complex
  // nested choices keep their existing independent evidence until they can be shown.
  if (!merge.value.exists || merge.conflicts.some(conflict => conflict.path.length !== 1)
    || reviewed.fieldConflicts.some(conflict => conflict.path.length !== 1)) return undefined;
  return { rows, comparedIds, fields: merge.conflicts, merged: merge.value.value as DocumentData,
    mine: localChoice, stored: storedAfterEdit };
}

export function readStudyNoteReferenceComparison(checkpoint: SessionCheckpoint) {
  const reviewed = referenceChoice(checkpoint);
  if (!reviewed) return undefined;
  const { rows, fields, comparedIds } = reviewed;
  return { rows, fields, comparedIds, identity: JSON.stringify([checkpoint.editGeneration, checkpoint.remoteCandidate?.metadata, rows, fields]) };
}

export function reviewedReferenceEvidence(checkpoint: SessionCheckpoint, ids: readonly string[]) {
  const revision = checkpoint.confirmed.metadata?.revision;
  return revision && ids.length ? {
    kind: 'study-note-references' as const,
    referenceEvidence: { observedRevisions: Object.fromEntries(ids.map(id => [id, revision])) },
  } : undefined;
}

/** A decision applies the compared rows and fields while retaining independent note work. */
export function chooseStudyNoteReferences(checkpoint: SessionCheckpoint, choice: 'local' | 'stored') {
  if (checkpoint.confirmed.resource.collection !== 'studyNotes' || !hasStudyNoteReferenceReview(checkpoint.conflicts)) return undefined;
  const reviewed = referenceChoice(checkpoint);
  if (!reviewed) throw Object.assign(new Error('The compared note references changed'), { code: 'decision-changed' });
  let merged = choice === 'local' ? reviewed.merged
    : reviewed.fields.reduce((value, conflict) => writeField(value, conflict.path, conflict.theirs), reviewed.merged);
  const saved = checkpoint.remoteCandidate?.value;
  if (choice === 'stored' && saved && reviewed.fields.some(({ path }) => path[0] === 'content')) {
    // Discarding the transcript must not confirm its source ID. Keep the raw recording link.
    merged = writeField(merged, ['dictationSourceIds'], readField(saved, ['dictationSourceIds']));
  }
  return writeField(merged, studyNoteReferencesPath, reviewed[choice === 'local' ? 'mine' : 'stored']);
}
