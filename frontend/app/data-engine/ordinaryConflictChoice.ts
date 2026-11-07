import { cancellationScope } from './atomicCommits';
import { orderCommitRequests } from './commits';
import { isDocumentEditor } from './editorIdentity';
import { projectSavedChoiceDependents } from './manualChoice';
import { equalValues } from './protocol';
import { canReplaceSnapshot } from './snapshotFreshness';
import { snapshotBelongsToOwner } from './snapshotIdentity';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { CommandResult } from './types';

export interface OrdinaryConflictChoice {
  first: CommitRequest;
  answer: Extract<CommandResult, { kind: 'conflict' }>;
  scope: readonly CommitRequest[];
}

function ordinaryUpdate(request: CommitRequest): boolean {
  const { baseline, value, command } = request;
  return !request.atomic && !request.retentionScope && baseline.value !== null && value !== null
    && (!command || command.kind === 'update') && isDocumentEditor(request.editorId, baseline.resource);
}

function ordinaryConflictAnswer(first: CommitRequest): OrdinaryConflictChoice['answer'] | null {
  const answer = first.result;
  return first.state === 'conflict' && answer?.kind === 'conflict' && answer.operationId === first.id
    && ordinaryUpdate(first) && equalValues(answer.snapshot.resource, first.baseline.resource)
    && answer.snapshot.value !== null && !answer.snapshot.metadata?.deleted
    && snapshotBelongsToOwner(first.owner, answer.snapshot) ? answer : null;
}

/** Select one answered ordinary edit and prove any linear, unsent suffix. */
export function ordinaryConflictChoice(first: CommitRequest, requests: readonly CommitRequest[]): OrdinaryConflictChoice | null {
  const answer = ordinaryConflictAnswer(first);
  if (!answer) return null;
  const owned = requests.filter(request => request.owner === first.owner);
  let scope: CommitRequest[];
  try { scope = orderCommitRequests(cancellationScope(owned, '', [first.id])); } catch { return null; }
  if (scope[0]?.id !== first.id) return null;
  if (scope.slice(1).some((request, index) => request.predecessor !== scope[index].id
    || request.state !== 'queued' || request.initialized || request.command || !ordinaryUpdate(request)
    || !equalValues(request.baseline.resource, first.baseline.resource))) return null;
  return { first, answer, scope };
}

/** A new branch or form in the suffix cannot be swept by an ordinary conflict choice. */
export function reviewOrdinaryConflictChoice(first: CommitRequest, requests: readonly CommitRequest[]): OrdinaryConflictChoice | null {
  if (!ordinaryConflictAnswer(first)) return null;
  const choice = ordinaryConflictChoice(first, requests);
  if (!choice) throw Object.assign(new Error('The later saved work needs its own review'), { code: 'decision-changed' });
  return choice;
}

export function assertOrdinaryConflictScope(choice: OrdinaryConflictChoice, retired: readonly CommitRequest[]): void {
  if (choice.scope.length !== retired.length || choice.scope.some(previous =>
    !retired.some(request => request.id === previous.id && request.revision === previous.revision + 1))) {
    throw Object.assign(new Error('The shown saved copy changed'), { code: 'decision-changed' });
  }
}

/** An editor holding the suffix can choose its answered Save without submitting the later draft. */
export function ordinaryChoiceCheckpoint(choice: OrdinaryConflictChoice, source: SessionCheckpoint): SessionCheckpoint {
  const { first, scope } = choice;
  const ids = new Set(scope.map(request => request.id));
  if (!source.pending[first.id] || Object.keys(source.pending).some(id => !ids.has(id))) {
    throw Object.assign(new Error('Resolve other saved work separately'), { code: 'other-changes-first' });
  }
  const latest = scope.filter(request => source.pending[request.id]).at(-1);
  if (scope.length === 1 || !latest) return source;
  if (!hasOnlyCapturedWords(source, latest)) {
    throw Object.assign(new Error('Save or resolve other document changes before choosing'), { code: 'other-changes-first' });
  }
  if (latest.id === first.id) return source;
  const answered = choice.answer.snapshot;
  const observed = source.remoteCandidate ?? source.confirmed;
  const remoteCandidate = canReplaceSnapshot(answered, observed) ? observed : answered;
  return { ...source, confirmed: first.initialized ? first.working : first.baseline,
    draft: first.initialized ? first.intended : first.value, remoteCandidate };
}

/** Preserve each reviewed chain's own later changes when taking the stored version from the notice. */
export function ordinaryStoredChoice(owner: string, choices: readonly OrdinaryConflictChoice[], retired: CommitRequest[]) {
  return choices.flatMap(choice => {
    const scope = cancellationScope(retired, '', [choice.first.id], true);
    assertOrdinaryConflictScope(choice, scope);
    const stored = choice.answer.snapshot;
    return projectSavedChoiceDependents(owner, choice.first, stored, stored.value, scope);
  });
}

function hasOnlyCapturedWords(checkpoint: SessionCheckpoint, request: CommitRequest): boolean {
  const capture = checkpoint.pending[request.id];
  return Boolean(capture && (capture.generation === checkpoint.editGeneration || equalValues(checkpoint.draft, capture.value)
    || (request.initialized && equalValues(checkpoint.draft, request.intended))));
}

/** The inline question covers a proved saved suffix, while unrelated or unsent words stay visible. */
export function laterOrdinaryAnswerCopies(checkpoint: SessionCheckpoint, requests: readonly CommitRequest[]) {
  const held = Object.keys(checkpoint.pending);
  if (held.length !== 1) return [];
  const first = requests.find(request => request.id === held[0] && request.state === 'conflict');
  if (!first || !hasOnlyCapturedWords(checkpoint, first)) return [];
  const choice = ordinaryConflictChoice(first, requests);
  return choice?.scope.slice(1).map((request, index) => ({
    id: request.id, operationIds: choice.scope.slice(0, index + 2).map(member => member.id), draft: request.value,
  })) ?? [];
}
