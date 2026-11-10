import { changeTagMembership } from './documentTagMembership';
import { writeField } from './fieldValues';
import { isValidIdentifier } from './protocol';
import { SOURCE_NOTE_FIELD, sourceNoteLinks, sourceNoteList, validSourceNoteLinkAction } from './sourceNoteLinkAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { SourceNoteChoice, SourceNoteLinkAction } from './sourceNoteLinkAction';
import type { DocumentData, FieldValue, ResourceSnapshot } from './types';

type SourceNoteContinuation = Pick<SourceNoteChoice, 'queueId' | 'predecessorOperationId'>;

type SourceNoteOpening = {
  sermonId: string;
  generation: string | null;
  revision: number;
  selected: FieldValue;
  pending: string[];
};

export type SourceNoteLinkOpening = SourceNoteOpening & { predecessors?: Record<string, SourceNoteContinuation> };

export type SourceNoteLinkCapture = {
  opening: SourceNoteOpening;
  action: SourceNoteLinkAction;
};

export function sourceNoteLinkOpening(checkpoint: SessionCheckpoint, requests: ReadonlyMap<string, CommitRequest> = new Map()): SourceNoteLinkOpening {
  const { confirmed, draft, pending } = checkpoint;
  const selected = sourceNoteLinks(draft);
  const noteIds = sourceNoteList(selected, isValidIdentifier);
  if (confirmed.resource.collection !== 'sermons' || !draft || confirmed.metadata?.deleted || !noteIds) {
    throw Object.assign(new Error('The sermon source selection is unavailable'), { code: 'decision-changed' });
  }
  const opening = { sermonId: confirmed.resource.id, generation: confirmed.metadata?.generation ?? null,
    revision: confirmed.metadata?.revision ?? 0, selected, pending: Object.keys(pending) };
  const shown = new Set(noteIds);
  const previous = new Map<string, SourceNoteContinuation | null>();
  for (const id of opening.pending.slice().reverse()) {
    const request = requests.get(id);
    if (!request?.sourceNoteLink || !matchesSourceNoteOpening(request.baseline, request.sourceNoteLink)
      || request.baseline.resource.id !== opening.sermonId || request.owner !== draft.userId) continue;
    for (const { noteId, linked, queueId } of request.sourceNoteLink.action.changes) {
      if (previous.has(noteId)) continue;
      const pendingAction = request.sequence === 0 && !['refused', 'conflict', 'cancelled'].includes(request.state);
      const acceptedAction = request.sequence === 1 && request.result?.kind === 'acknowledged'
        && (request.result.committed ?? request.result.snapshot.metadata)?.operationId === request.id;
      previous.set(noteId, queueId && shown.has(noteId) === linked && (pendingAction || acceptedAction)
        ? { queueId, predecessorOperationId: id } : null);
    }
  }
  return { ...opening, predecessors: Object.fromEntries([...previous].filter((entry): entry is [string, SourceNoteContinuation] => entry[1] !== null)) };
}

export function captureSourceNoteChoices(opening: SourceNoteLinkOpening, requested: string[], touched: readonly string[],
  time: ActionTime | null): SourceNoteLinkCapture {
  const { predecessors, ...shown } = opening;
  const selected = new Set(requested);
  const action = { observedRevision: shown.revision, time, changes: [...new Set(touched)].map(noteId => ({
    noteId, linked: selected.has(noteId), ...(predecessors && Object.hasOwn(predecessors, noteId) && predecessors[noteId]),
  })) };
  if (!validSourceNoteLinkAction(action, { path: [SOURCE_NOTE_FIELD], before: opening.selected, after: { exists: true, value: requested } }, isValidIdentifier)) {
    throw Object.assign(new Error('The shown source note selection changed'), { code: 'decision-changed' });
  }
  return { opening: shown, action };
}

function projectChoice(field: FieldValue, choices: readonly SourceNoteChoice[]) {
  return choices.reduce((value, { noteId, linked }) => changeTagMembership(value, noteId, linked), field);
}

export function projectSourceNoteChoices(current: DocumentData, choices: readonly SourceNoteChoice[], from = sourceNoteLinks(current)): DocumentData {
  return writeField(current, [SOURCE_NOTE_FIELD], projectChoice(from, choices));
}

export function matchesSourceNoteOpening(snapshot: ResourceSnapshot, capture: SourceNoteLinkCapture): boolean {
  const { opening } = capture;
  const generation = snapshot.metadata?.generation ?? null;
  // The first accepted write names the generation after its own durable request.
  const firstShownWrite = opening.generation === null && generation !== null && opening.pending.includes(generation);
  return snapshot.resource.collection === 'sermons' && snapshot.resource.id === opening.sermonId && !snapshot.metadata?.deleted
    && (generation === opening.generation || firstShownWrite);
}

export function sourceNoteQueueRebase(working: ResourceSnapshot, capture: SourceNoteLinkCapture | undefined) {
  if (!capture || !working.value || !matchesSourceNoteOpening(working, capture)) return undefined;
  const selected = sourceNoteLinks(working.value);
  return {
    align: (value: DocumentData | null) => value && writeField(value, [SOURCE_NOTE_FIELD], selected),
    restore: (value: DocumentData | null) => value && projectSourceNoteChoices(value, capture.action.changes, selected),
  };
}

export function sourceNoteCommandCopies(working: ResourceSnapshot, intended: DocumentData, capture: SourceNoteLinkCapture) {
  const selected = new Set(sourceNoteList(capture.opening.selected, isValidIdentifier));
  const opening = capture.action.changes.map(({ noteId, prior }) => ({ noteId, linked: prior?.before ?? selected.has(noteId) }));
  const saved = sourceNoteLinks(working.value);
  return { source: { ...working, value: projectSourceNoteChoices(working.value!, opening, saved) },
    intended: projectSourceNoteChoices(intended, capture.action.changes, saved) };
}

export function sourceNoteQueueCapture(capture: SourceNoteLinkCapture, newQueueId: () => string): SourceNoteLinkCapture {
  const queueId = newQueueId();
  return { ...capture, action: { ...capture.action, changes: capture.action.changes.map(choice =>
    choice.prior || choice.queueId ? choice : { ...choice, queueId }) } };
}
