import { boundedActionTime } from './actionClock';
import { object, readField } from './fieldValues';

import type { ActionTime } from './actionClock';
import type { DataCommand, DocumentData, FieldChange, FieldValue } from './types';

export const SOURCE_NOTE_FIELD = 'sourceNoteIds';

export type SourceNoteBasis = { before: boolean; observedRevision: number | null; time: ActionTime | null };

export type SourceNoteChoice = {
  noteId: string;
  linked: boolean;
  queueId?: string;
  predecessorOperationId?: string;
  /** A second choice about another note must retain this note's original action. */
  prior?: SourceNoteBasis;
};

export type SourceNoteLinkAction = {
  observedRevision: number;
  time: ActionTime | null;
  changes: SourceNoteChoice[];
  reviewed?: true;
};

export function sourceNoteLinkChange(changes: readonly FieldChange[]): FieldChange | undefined {
  return changes.find(change => change.path[0] === SOURCE_NOTE_FIELD);
}

/** The earlier picker sent a single source field through the ordinary one-shot writer. */
export function legacySourceNoteChange(command: DataCommand | null | undefined): FieldChange | undefined {
  return command?.kind === 'update' && command.resource.collection === 'sermons' && command.changes.length === 1
    ? sourceNoteLinkChange(command.changes) : undefined;
}

export function sourceNoteList(field: FieldValue, isIdentifier: (value: unknown) => boolean): string[] | undefined {
  if (!field.exists) return [];
  return Array.isArray(field.value) && field.value.every(isIdentifier) ? field.value as string[] : undefined;
}

export function sourceNoteLinks(value: DocumentData | null | undefined): FieldValue {
  return readField(value ?? {}, [SOURCE_NOTE_FIELD]);
}

export function validSourceNoteLinkAction(raw: unknown, change: FieldChange | undefined, isIdentifier: (value: unknown) => boolean): raw is SourceNoteLinkAction {
  if (!change || !object(raw) || !(typeof raw.observedRevision === 'number' && Number.isSafeInteger(raw.observedRevision) && raw.observedRevision >= 0)
    || (raw.reviewed !== undefined && raw.reviewed !== true) || (raw.time !== null && !boundedActionTime(raw.time)) || !Array.isArray(raw.changes) || !raw.changes.length) return false;
  const before = sourceNoteList(change.before, isIdentifier), after = sourceNoteList(change.after, isIdentifier);
  if (!before || !after) return false;
  const beforeIds = new Set(before), afterIds = new Set(after);
  const choices = new Set<string>();
  for (const choice of raw.changes) {
    if (!object(choice) || typeof choice.noteId !== 'string' || !isIdentifier(choice.noteId) || choices.has(choice.noteId)
      || typeof choice.linked !== 'boolean' || choice.linked !== afterIds.has(choice.noteId)
      || (choice.queueId !== undefined && !isIdentifier(choice.queueId))
      || (choice.predecessorOperationId !== undefined && (!choice.queueId || !isIdentifier(choice.predecessorOperationId)))
      || (choice.prior !== undefined && (!raw.reviewed || !validPrior(choice.prior, beforeIds.has(choice.noteId), raw.observedRevision)))) return false;
    choices.add(choice.noteId);
  }
  return [...new Set([...before, ...after])].every(note => beforeIds.has(note) === afterIds.has(note) || choices.has(note));
}

function validPrior(prior: unknown, before: boolean, reviewedRevision: number): boolean {
  return object(prior) && prior.before === before
    && (prior.observedRevision === null ? prior.time === null : typeof prior.observedRevision === 'number'
      && Number.isSafeInteger(prior.observedRevision) && prior.observedRevision >= 0 && prior.observedRevision <= reviewedRevision
      && (prior.time === null || Boolean(boundedActionTime(prior.time))));
}
