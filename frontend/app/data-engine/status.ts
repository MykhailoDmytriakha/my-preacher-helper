import { sameManualSelection } from './manualScope';

import type { EditorState } from './controller';
import type { ManualScope } from './manualScope';
import type { Observation } from './observer';
import type { JournalEntry } from './types';

export type SyncPhase = 'savingLocally' | 'localFailure' | 'draft' | 'queued' | 'sending' | 'unknown'
  | 'blocked' | 'refused' | 'conflict' | 'remoteChanged' | 'deleted' | 'saved';

export interface SyncStatus {
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
export function describeManualSync(form: ReturnType<ManualScope['getState']> | null, editor: EditorState | null, parent: SyncStatus | null, error: string | null): SyncStatus | null {
  if (!form?.record.active || !editor || !parent) return parent;
  // Explicit Keep local may include durable corrections to a known failed command.
  // Accept remote still cannot discard an unsent stage, and unknown outcomes stay immutable.
  if (form.dirty && form.durable && ['conflict', 'refused'].includes(parent.phase)) {
    return { ...parent, canSave: false, canRemove: false, canAcceptRemote: false };
  }
  // A pristine reopened form must not hide delivery or terminal recovery behind its pinned copy.
  if (!form.dirty && form.durable && !['saved', 'draft', 'remoteChanged'].includes(parent.phase)) {
    return { ...parent, canSave: false, canRemove: false };
  }
  const observed = editor.checkpoint.remoteCandidate ?? editor.checkpoint.confirmed;
  const { baseline, predecessor, selection } = form.record;
  const deleted = observed.value === null || Boolean(observed.metadata?.deleted);
  const replaced = Boolean(baseline.metadata && observed.metadata && baseline.metadata.generation !== observed.metadata.generation);
  const changed = deleted || replaced || selection.some(path => !sameManualSelection(observed.value, baseline.value, path)
    && !(predecessor && sameManualSelection(observed.value, predecessor.value, path)));
  let phase: SyncPhase = form.dirty ? 'draft' : 'saved';
  if (changed) phase = deleted ? 'deleted' : 'remoteChanged';
  if (!form.durable) phase = error ? 'localFailure' : 'savingLocally';
  return { ...parent, phase, hasForeignChange: changed,
    canSave: form.dirty && form.durable && !deleted, canRemove: false,
    canAcceptRemote: false, canKeepLocal: false };
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
  const settled = pendingIds.length === 0 || terminal;
  const deletedCandidate = foreign && candidate?.value === null;
  const phase = deliveryPhase(state, delivery, foreign, deletedCandidate, pendingIds.length);
  return {
    phase, freshness: observation.readiness, checking: observation.checking, readFailed: observation.error,
    hasForeignChange: foreign,
    canSave: checkpoint.dirty && state.durable && !state.preparing && hasUnqueuedGeneration && !refused && checkpoint.conflicts.length === 0 && !deletedCandidate && !checkpoint.confirmed.metadata?.deleted,
    canRemove: state.durable && !state.preparing && pendingIds.length === 0 && checkpoint.confirmed.value !== null && !checkpoint.confirmed.metadata?.deleted,
    canAcceptRemote: !state.actionResolutionRequired && foreign && settled,
    canKeepLocal: !state.actionResolutionRequired && settled && !deletedCandidate && (foreign || phase === 'conflict' || phase === 'refused'),
  };
}

function deliveryPhase(state: EditorState, delivery: readonly JournalEntry[], foreign: boolean, deletedCandidate: boolean, pendingCount: number): SyncPhase {
  const { checkpoint } = state;
  let phase: SyncPhase = 'saved';
  if (checkpoint.dirty) phase = 'draft';
  if (pendingCount) phase = 'queued';
  for (const next of ['queued', 'sending', 'unknown', 'blocked', 'refused', 'conflict'] as const) {
    if (delivery.some(entry => entry.state === next)) phase = next;
  }
  if (foreign) phase = deletedCandidate ? 'deleted' : 'remoteChanged';
  if (checkpoint.conflicts.length || state.result?.kind === 'conflict') phase = 'conflict';
  if (state.result?.kind === 'refused') phase = 'refused';
  if (checkpoint.confirmed.metadata?.deleted && !checkpoint.dirty && !pendingCount) phase = 'deleted';
  if (!state.durable) phase = state.error ? 'localFailure' : 'savingLocally';
  return phase;
}
