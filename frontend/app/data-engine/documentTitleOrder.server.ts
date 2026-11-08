import { boundedActionTime, compareActionTime } from './actionClock';
import { documentTitleChange, documentTitleTarget, isShortDocumentTitle } from './documentTitle';
import { object } from './fieldValues';

import type { ActionTime } from './actionClock';
import type { DisplacedDocumentTitle, DocumentTitleAction, DocumentTitleTarget } from './documentTitle';
import type { ConflictDetail, DataCommand, FieldChange, ResourceSnapshot } from './types';

export const DOCUMENT_TITLE_HISTORY = '_titleHistory';
type TitleProof = { title: string; revision: number; time: ActionTime | null };
export type DocumentTitleOrder = {
  command: DataCommand;
  stamp?: ActionTime | null;
  previous?: TitleProof;
  displaced?: DisplacedDocumentTitle;
  uncertain?: ConflictDetail[];
};

function previousTitle(raw: unknown, current: ResourceSnapshot, target: DocumentTitleTarget): TitleProof | undefined {
  const proof = object(raw) ? raw[target.proof] : undefined;
  if (!object(proof) || !isShortDocumentTitle(proof.title, target) || proof.title !== current.value?.title
    || typeof proof.revision !== 'number' || !Number.isSafeInteger(proof.revision)
    || proof.revision < 1 || proof.revision > (current.metadata?.revision ?? 0)) return undefined;
  const time = proof.time === null ? null : boundedActionTime(proof.time);
  return time !== undefined ? { title: proof.title, revision: proof.revision, time } : undefined;
}

function readAction(command: Extract<DataCommand, { kind: 'update' }>, change: FieldChange, revision: number, serverMs: number, target: DocumentTitleTarget): DocumentTitleAction | undefined {
  const action: unknown = command[target.action];
  if (!object(action) || !isShortDocumentTitle(action.before, target) || !isShortDocumentTitle(action.after, target) || action.before === action.after
    || !change.before.exists || !change.after.exists || change.before.value !== action.before || change.after.value !== action.after
    || typeof action.observedRevision !== 'number' || !Number.isSafeInteger(action.observedRevision)
    || action.observedRevision < 1 || action.observedRevision > revision || !Number.isFinite(serverMs)) return undefined;
  const time = boundedActionTime(action.time);
  return time && time.earliestMs <= serverMs + 5 ? { before: action.before, after: action.after, observedRevision: action.observedRevision, time } : undefined;
}

function decideUnobservedTitle(command: Extract<DataCommand, { kind: 'update' }>, change: FieldChange, action: DocumentTitleAction,
  previous: TitleProof): DocumentTitleOrder {
  const { title, time } = previous;
  const order = time ? compareActionTime(action.time, time) : 0;
  if (action.after === title) return order > 0 ? { command, stamp: action.time } : order < 0 ? { command, previous } : { command, stamp: null };
  if (!order || !time) {
    const uncertain = action.before === title ? [{ path: change.path, base: change.before, mine: change.after, theirs: change.before }] : undefined;
    return { command, uncertain };
  }
  const incomingWins = order > 0;
  const stored = { exists: true, value: title };
  const changes = command.changes.map(field => field === change
    ? { ...field, before: stored, after: incomingWins ? field.after : stored }
    : field);
  return {
    command: { ...command, changes },
    ...(incomingWins ? { stamp: action.time } : { previous }),
    displaced: {
      title: incomingWins ? title : action.after,
      winnerTitle: incomingWins ? action.after : title,
      generation: command.generation!,
      actionTime: incomingWins ? time : action.time,
      winnerActionTime: incomingWins ? action.time : time,
    },
  };
}

export function orderDocumentTitle(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number): DocumentTitleOrder {
  const target = documentTitleTarget(command.resource.collection);
  if (!target || command.kind !== 'update') return { command };
  const change = documentTitleChange(command.changes);
  if (!change || !current.metadata || current.metadata.deleted || command.generation !== current.metadata.generation) return { command };
  if (!isShortDocumentTitle(current.value?.title, target)) return { command, stamp: null };
  const action = readAction(command, change, current.metadata.revision, serverMs, target);
  if (!action) return { command, stamp: null };
  const previous = previousTitle(raw, current, target);
  if (previous && previous.revision > action.observedRevision) return decideUnobservedTitle(command, change, action, previous);
  if (action.after === current.value.title) return { command, previous };
  return { command, stamp: previous || action.observedRevision === current.metadata.revision ? action.time : null };
}

export function metadataAfterDocumentTitle(snapshot: ResourceSnapshot, raw: unknown, order?: DocumentTitleOrder) {
  const target = documentTitleTarget(snapshot.resource.collection);
  const title = snapshot.value?.title;
  if (!target || !snapshot.metadata || !isShortDocumentTitle(title, target)) return snapshot.metadata;
  const previous = order?.previous ?? previousTitle(raw, snapshot, target);
  if (order?.stamp === undefined && previous) return { ...snapshot.metadata, [target.proof]: previous };
  return { ...snapshot.metadata, [target.proof]: { title, revision: snapshot.metadata.revision, time: order?.stamp ?? null } };
}
