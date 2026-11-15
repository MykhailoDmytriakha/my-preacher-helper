import { appendNoteParagraph } from '@/utils/studyNoteRecordings';

import { equalValues } from './fieldValues';
import { snapshotBelongsToOwner } from './snapshotIdentity';

import type { CommitRequest } from './commits';
import type { DocumentData, ResourceSnapshot, StudyNoteContentCapture } from './types';

export interface NoteDictationAfterUndo {
  opening: string;
  restored: string;
  appended: string;
  sourceId: string;
  previousBody?: string;
}

export interface NoteBodyContinuation {
  expectedBody?: unknown;
  proof?: NoteDictationAfterUndo;
  patch: Record<string, unknown>;
}

function sourceIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

interface NoteBodyReplacement {
  confirmed: ResourceSnapshot;
  value: DocumentData;
  content: StudyNoteContentCapture;
}

function conflictOpening(source: CommitRequest) {
  const { result, command, working, value } = source;
  if (source.state !== 'conflict' || result?.kind !== 'conflict' || result.operationId !== source.id
    || command?.kind !== 'update' || command.operationId !== source.id || command.resource.collection !== 'studyNotes'
    || source.atomic || source.sequence !== 0 || command.dependsOn.length
    || result.conflicts.length !== 1 || !equalValues(result.conflicts[0].path, ['content'])
    || !command.changes.every(({ path }) => path.length === 1 && ['content', 'updatedAt', 'recordingSourceIds', 'dictationSourceIds'].includes(path[0]))) return;

  const confirmed = result.snapshot;
  const saved = confirmed.value;
  const opening = working.metadata;
  const incoming = confirmed.metadata;
  if (!saved || !opening || !incoming || incoming.generation !== opening.generation || incoming.deleted
    || !snapshotBelongsToOwner(source.owner, confirmed)
    || !equalValues(confirmed.resource, working.resource) || !equalValues(confirmed.resource, command.resource)
    || incoming.revision <= opening.revision) return;

  return { confirmed, saved, generation: opening.generation, incoming, opening, prior: working.value, refused: value };
}

/** Pair one exact reverted request with a locally witnessed transcription. */
export function continueRefusedNote(source: CommitRequest, attempt: NoteBodyContinuation): NoteBodyReplacement | undefined {
  const snapshots = conflictOpening(source);
  if (!snapshots || !attempt.proof) return;
  const { confirmed, saved, generation, incoming, prior, refused } = snapshots;
  const { proof, patch } = attempt;
  const { opening, restored, appended, sourceId } = proof;
  const current = saved.content;
  if (!isIndependentAppend(current, restored) || refused?.content !== opening || prior?.content !== restored
    || opening === restored || !appended || !sourceId || patch.content !== appendNoteParagraph(restored, appended)
    || !Object.keys(patch).every(field => ['content', 'dictationSourceIds', 'recordingSourceIds', 'updatedAt'].includes(field))) return;

  const completed = sourceIds(saved.dictationSourceIds);
  const recorded = sourceIds(saved.recordingSourceIds);
  if (sourceIds(refused.dictationSourceIds).some(id => !completed.includes(id))
    || completed.includes(sourceId) || !sourceIds(patch.dictationSourceIds).includes(sourceId)
    || sourceIds(patch.dictationSourceIds).some(id => id !== sourceId && !completed.includes(id))) return;

  const localRecordings = [...sourceIds(refused.recordingSourceIds), ...sourceIds(patch.recordingSourceIds)];
  if (localRecordings.some(id => id !== sourceId && !recorded.includes(id))) return;
  return { confirmed, content: { generation, opening: current, observedRevision: incoming.revision, time: null }, value: { ...saved, ...(typeof patch.updatedAt === 'string' && { updatedAt: patch.updatedAt }), content: appendNoteParagraph(current, appended), dictationSourceIds: [...completed, sourceId],
    ...(localRecordings.includes(sourceId) && { recordingSourceIds: [...new Set([...recorded, sourceId])] }) } };
}

/**
 * Submit the actual later draft against the last known opening. If the stored
 * body still differs, the existing conflict path compares those exact words.
 */
export function reviewRefusedNote(source: CommitRequest, attempt: NoteBodyContinuation): NoteBodyReplacement | undefined {
  const snapshots = conflictOpening(source);
  if (!snapshots || !attempt.proof) return;
  const { prior, refused, generation, opening } = snapshots;
  const { patch, expectedBody } = attempt;
  const proof = attempt.proof;
  if (!prior || typeof prior.content !== 'string' || typeof refused?.content !== 'string' || typeof patch.content !== 'string'
    || patch.content === refused.content || patch.content === prior.content
    || !Object.keys(patch).every(field => ['content', 'dictationSourceIds', 'recordingSourceIds', 'updatedAt'].includes(field))) return;
  const dictatedBody = appendNoteParagraph(proof.restored, proof.appended);
  const receipts = sourceIds(refused.dictationSourceIds);
  const restoresAndAppends = proof.opening === refused.content && proof.restored === prior.content && patch.content === dictatedBody;
  const followsFirstDraft = receipts.includes(proof.sourceId) && (expectedBody === refused.content || proof.previousBody === refused.content
    || (expectedBody === dictatedBody && refused.content === appendNoteParagraph(prior.content, proof.appended)));
  if (!restoresAndAppends && !followsFirstDraft) return;

  const stillOwnsEarlierText = followsFirstDraft;
  if (!stillOwnsEarlierText && sourceIds(refused.dictationSourceIds).some(id => !sourceIds(prior.dictationSourceIds).includes(id))) return;
  const recordings = [...new Set([...sourceIds(refused.recordingSourceIds), ...sourceIds(patch.recordingSourceIds)])];
  const received = [...new Set([...sourceIds(refused.dictationSourceIds), ...sourceIds(patch.dictationSourceIds)])];
  const value: DocumentData = { ...prior, content: patch.content,
    ...(typeof patch.updatedAt === 'string' && { updatedAt: patch.updatedAt }),
    ...(recordings.length && { recordingSourceIds: recordings }),
    ...(received.length && { dictationSourceIds: received }) };
  return { confirmed: source.working, value,
    content: { generation, observedRevision: opening.revision, opening: prior.content, time: null } };
}

function isIndependentAppend(value: unknown, opening: string): value is string {
  if (typeof value !== 'string' || value === opening) return false;
  return opening === '' ? value !== '' : value.startsWith(opening + '\n\n') && value.length > opening.length + 2;
}
