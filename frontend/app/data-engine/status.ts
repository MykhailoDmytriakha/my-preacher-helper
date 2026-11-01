import { sameManualSelection } from './manualScope';
import { shownDeliveryState } from './unanswered';

import type { EditorState } from './controller';
import type { ManualScope } from './manualScope';
import type { Observation } from './observer';
import type { RecordPresence } from './recordPresence';
import type { JournalEntry, ResourceSnapshot } from './types';

export type SyncPhase = 'savingLocally' | 'localFailure' | 'draft' | 'queued' | 'sending' | 'unknown'
  | 'blocked' | 'refused' | 'conflict' | 'remoteChanged' | 'deleted' | 'saved';

/**
 * WHEN EVERYTHING GOES AS EXPECTED, THE PERSON SEES NOTHING (owner, 2026-09-29).
 *
 * Saving on the device, a draft kept there, waiting in the queue, sending and saved are the
 * ordinary way a change travels, and the engine finishes each of them by itself. Only a phase the
 * app could not resolve on its own is said on screen — the way a toast is never shown for a save
 * that simply worked. A status line that appears and disappears with every keystroke also moved
 * the page under the reader.
 */
const SETTLING_PHASES: ReadonlySet<string> = new Set<SyncPhase>(['savingLocally', 'draft', 'queued', 'sending', 'blocked', 'saved']);

/** Whether this phase is trouble worth showing; every status surface asks this one rule. */
export function isSyncTrouble(phase: string | null | undefined): boolean {
  return Boolean(phase) && !SETTLING_PHASES.has(phase as string);
}

export interface SyncStatus {
  /** Keeping this local intent repeats a whole-record deletion, rather than preserving text. */
  deleting?: boolean;
  phase: SyncPhase;
  freshness: Observation['readiness'];
  checking: boolean;
  readFailed: boolean;
  hasForeignChange: boolean;
  canSave: boolean;
  canRemove: boolean;
  canAcceptRemote: boolean;
  canKeepLocal: boolean;
}

/** A Save-button stage owns its opening ancestor, even while the parent observes newer data. */
export function describeManualSync(form: ReturnType<ManualScope['getState']> | null, editor: EditorState | null, parent: SyncStatus | null, error: string | null, presence?: RecordPresence): SyncStatus | null {
  // A form resolves only its own fields, so dropping a refused change of the whole document is not its
  // choice to offer (a screen's editor offers it; EditorController.acceptRemote). A real newer version
  // from elsewhere is still offered, as it always was.
  if (parent?.phase === 'refused' && !parent.hasForeignChange) parent = { ...parent, canAcceptRemote: false };
  // A selected-field form never owns a whole-document deletion, including while it opens.
  if (parent?.deleting) parent = { ...parent, deleting: false };
  if (!form || (!form.record.active && !form.choiceRequired) || !editor || !parent) return parent;
  if (form.choiceRequired) return describeManualChoice(form, editor, parent, error, presence);
  // Explicit Keep local may include durable corrections to a known failed command.
  // Accept remote still cannot discard an unsent stage, and unknown outcomes stay immutable.
  if (form.dirty && form.durable && ['conflict', 'refused'].includes(parent.phase)) {
    return { ...parent, canSave: false, canRemove: false, canAcceptRemote: false };
  }
  // A pristine reopened form must not hide delivery or terminal recovery behind its pinned copy.
  if (!form.captureFailed && !form.dirty && form.durable && !['saved', 'draft', 'remoteChanged'].includes(parent.phase)) {
    return { ...parent, canSave: false, canRemove: false };
  }
  const { snapshot: observed, deleted } = manualObservation(form, editor, presence);
  const { baseline, predecessor, selection } = form.record;
  const replaced = Boolean(baseline.metadata && observed.metadata && baseline.metadata.generation !== observed.metadata.generation);
  const changed = deleted || replaced || selection.some(path => !sameManualSelection(observed.value, baseline.value, path)
    && !(predecessor && sameManualSelection(observed.value, predecessor.value, path)));
  let phase: SyncPhase = form.dirty ? 'draft' : 'saved';
  if (changed) phase = deleted ? 'deleted' : 'remoteChanged';
  if (!form.durable) phase = error ? 'localFailure' : 'savingLocally';
  if (form.captureFailed) phase = 'localFailure';
  return { ...parent, phase, hasForeignChange: changed,
    canSave: form.dirty && form.durable && !deleted && !form.captureFailed, canRemove: false,
    canAcceptRemote: false, canKeepLocal: false };
}

function describeManualChoice(form: ReturnType<ManualScope['getState']>, editor: EditorState, parent: SyncStatus, error: string | null, presence?: RecordPresence): SyncStatus {
    const pending = Object.keys(editor.checkpoint.pending).length > 0;
    const { deleted } = manualObservation(form, editor, presence);
    const ready = form.durable && !form.captureFailed;
    return { ...parent, phase: ready ? 'conflict' : error ? 'localFailure' : 'savingLocally',
      canSave: false, canRemove: false, canAcceptRemote: ready,
      canKeepLocal: ready && !deleted && (!pending || parent.canKeepLocal) };
}

/** Public presence supplies creation evidence without changing the form's pinned baseline. */
function manualObservation(form: ReturnType<ManualScope['getState']>, editor: EditorState,
  presence?: RecordPresence): { snapshot: ResourceSnapshot; deleted: boolean } {
  let snapshot = editor.checkpoint.remoteCandidate ?? editor.checkpoint.confirmed;
  const { baseline, predecessor, resource, owner } = form.record;
  const matches = (candidate: ResourceSnapshot['resource']) => candidate.collection === resource.collection && candidate.id === resource.id;
  const savedCreation = baseline.value === null && baseline.metadata === null && predecessor
    && predecessor.owner === owner && matches(predecessor.resource) && matches(baseline.resource)
    && presence?.snapshot && matches(presence.snapshot.resource) && presence.snapshot.value?.userId === owner;
  const openingAbsence = !editor.checkpoint.remoteCandidate && matches(snapshot.resource) && snapshot.value === null && snapshot.metadata === null;
  // The accepted public copy may arrive before the editor finishes adopting its ACK.
  if (savedCreation && openingAbsence && presence?.kind === 'present' && presence.source === 'server') snapshot = presence.snapshot;
  const awaitingCreation = savedCreation && openingAbsence && presence?.kind === 'creating';
  return { snapshot, deleted: Boolean(snapshot.metadata?.deleted) || (snapshot.value === null && !awaitingCreation) };
}

/** Status describes proven state; an SDK echo of our command is not a foreign edit. */
export function describeSync(state: EditorState, observation: Observation, delivery: readonly JournalEntry[]): SyncStatus {
  const { checkpoint } = state;
  const pendingIds = Object.keys(checkpoint.pending);
  const candidate = checkpoint.remoteCandidate;
  const operationId = candidate?.metadata?.operationId;
  const ownEcho = Boolean(operationId && (pendingIds.includes(operationId)
    || Object.values(checkpoint.pending).some(pending => pending.operations?.includes(operationId))));
  const hasUnqueuedGeneration = pendingIds.length === 0
    || Object.values(checkpoint.pending).every(pending => pending.generation < checkpoint.editGeneration);
  const refused = state.result?.kind === 'conflict' || state.result?.kind === 'refused'
    || delivery.some(entry => ['blocked', 'refused', 'conflict'].includes(entry.state));
  const foreign = Boolean(candidate && !ownEcho);
  const terminal = delivery.length > 0 && delivery.every(entry => entry.state === 'conflict' || entry.state === 'refused');
  const settled = pendingIds.length === 0 || (state.savedIntentReplaceable ?? terminal);
  const deletedCandidate = foreign && candidate?.value === null;
  const phase = deliveryPhase(state, delivery, foreign, deletedCandidate, pendingIds.length);
  return {
    deleting: checkpoint.draft === null && checkpoint.confirmed.value !== null,
    phase, freshness: observation.readiness, checking: observation.checking, readFailed: observation.error,
    hasForeignChange: foreign,
    canSave: checkpoint.dirty && state.durable && !state.preparing && hasUnqueuedGeneration && !refused && checkpoint.conflicts.length === 0 && !deletedCandidate && !checkpoint.confirmed.metadata?.deleted,
    canRemove: state.durable && !state.preparing && pendingIds.length === 0 && checkpoint.confirmed.value !== null && !checkpoint.confirmed.metadata?.deleted,
    // A refusal has no other version to take, but "use the server's version" still means dropping
    // this device's refused change — without it a refused screen draft had no way back.
    canAcceptRemote: !state.actionResolutionRequired && (foreign
      || (phase === 'conflict' && Boolean(candidate) && state.savedIntentReplaceable === true)
      || (phase === 'refused' && !state.manualWork)) && settled,
    canKeepLocal: !state.actionResolutionRequired && settled && !deletedCandidate && (foreign || phase === 'conflict' || phase === 'refused'),
  };
}

function deliveryPhase(state: EditorState, delivery: readonly JournalEntry[], foreign: boolean, deletedCandidate: boolean, pendingCount: number): SyncPhase {
  const { checkpoint } = state;
  let phase: SyncPhase = 'saved';
  if (checkpoint.dirty) phase = 'draft';
  if (pendingCount) phase = 'queued';
  for (const next of ['queued', 'sending', 'unknown', 'blocked', 'refused', 'conflict'] as const) {
    if (delivery.some(entry => shownDeliveryState(entry) === next)) phase = next;
  }
  if (foreign) phase = deletedCandidate ? 'deleted' : 'remoteChanged';
  if (checkpoint.conflicts.length || state.result?.kind === 'conflict') phase = 'conflict';
  if (state.result?.kind === 'refused') phase = 'refused';
  if (checkpoint.confirmed.metadata?.deleted && !checkpoint.dirty && !pendingCount) phase = 'deleted';
  if (!state.durable) phase = state.error ? 'localFailure' : 'savingLocally';
  if (state.captureFailed) phase = 'localFailure';
  return phase;
}
