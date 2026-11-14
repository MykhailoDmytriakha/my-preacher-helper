import { getUtf8ByteLength } from '@/utils/feedbackPayload';

import { diffFields } from './protocol';

import type { CommitRequest } from './commits';
import type { DocumentData, StudyNoteContentCapture } from './types';

/** Only a plain content Save can be superseded by shortening its text. */
export function oversizedNoteOpening(request: CommitRequest): request is CommitRequest & {
  command: Extract<NonNullable<CommitRequest['command']>, { kind: 'update' }>;
  value: DocumentData;
} {
  const { command, state, result, working, value } = request;
  return state === 'refused' && result?.kind === 'refused' && result.code === 'resource-exhausted'
    && command?.kind === 'update' && command.resource.collection === 'studyNotes'
    && !request.atomic && request.sequence === 0 && !command.dependsOn.length
    && Boolean(working.value && working.value.type !== 'analysis' && value && value.type !== 'analysis')
    && command.changes.some(change => change.path.length === 1 && change.path[0] === 'content')
    && command.changes.every(change => change.path.length === 1 && ['content', 'updatedAt'].includes(change.path[0]));
}

export function shortenedNoteContent(refused: DocumentData, corrected: DocumentData): boolean {
  return typeof refused.content === 'string' && typeof corrected.content === 'string'
    && getUtf8ByteLength(corrected.content) < getUtf8ByteLength(refused.content)
    && diffFields(refused, corrected).every(({ path }) => ['content', 'updatedAt', 'isDraft'].includes(path[0]));
}

export function noteCorrectionOpening(request: CommitRequest, capture?: StudyNoteContentCapture | null): StudyNoteContentCapture | null {
  const prior = request.studyNoteContentAction, { metadata } = request.working;
  if (!prior || !metadata || !('value' in prior.before) || typeof prior.before.value !== 'string') return null;
  return { generation: metadata.generation, observedRevision: prior.observedRevision, opening: prior.before.value,
    time: capture?.generation === metadata.generation ? capture.time : prior.time };
}
