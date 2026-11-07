import { cancellationScope } from './atomicCommits';
import { orderCommitRequests } from './commits';
import { isDocumentEditor } from './editorIdentity';
import { chooseLocalPlacement } from './localPlacementChoice';
import { projectSavedChoiceDependents } from './manualChoice';
import { equalValues, mergeDocumentFields, mergeFields } from './protocol';
import { canReplaceSnapshot } from './snapshotFreshness';
import { snapshotBelongsToOwner } from './snapshotIdentity';

import type { CommitRequest } from './commits';
import type { CouncilRefusalCoverage, OpenDocumentAnswer } from './openDocumentAnswers';
import type { SessionCheckpoint } from './session';
import type { CommandResult, DocumentData, ResourceSnapshot } from './types';

export interface OrdinaryAnswerChoice {
  first: CommitRequest;
  answer: Extract<CommandResult, { kind: 'conflict' | 'refused' }>;
  scope: readonly CommitRequest[];
}

function ordinaryUpdate(request: CommitRequest): boolean {
  const { baseline, value, command } = request;
  return !request.atomic && !request.retentionScope && baseline.value !== null && value !== null
    && (!command || command.kind === 'update') && isDocumentEditor(request.editorId, baseline.resource);
}

function ordinaryBasis(request: CommitRequest): ResourceSnapshot {
  return request.initialized ? request.working : request.baseline;
}

function ordinaryAnswer(first: CommitRequest): OrdinaryAnswerChoice['answer'] | null {
  const answer = first.result;
  if (!ordinaryUpdate(first) || answer?.operationId !== first.id || answer.kind !== first.state) return null;
  const stored = answer.kind === 'conflict' ? answer.snapshot : ordinaryBasis(first);
  return (answer.kind === 'conflict' || answer.kind === 'refused')
    && equalValues(stored.resource, first.baseline.resource) && stored.value !== null && !stored.metadata?.deleted
    && snapshotBelongsToOwner(first.owner, stored) ? answer : null;
}

/** Select one answered ordinary edit and prove any linear, unsent suffix. */
export function ordinaryAnswerChoice(first: CommitRequest, requests: readonly CommitRequest[]): OrdinaryAnswerChoice | null {
  const answer = ordinaryAnswer(first);
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

/** A new branch or form in the suffix cannot be swept by an ordinary answer choice. */
export function reviewOrdinaryAnswerChoice(first: CommitRequest, requests: readonly CommitRequest[]): OrdinaryAnswerChoice | null {
  if (!ordinaryAnswer(first)) return null;
  const choice = ordinaryAnswerChoice(first, requests);
  if (!choice) throw Object.assign(new Error('The later saved work needs its own review'), { code: 'decision-changed' });
  return choice;
}

export function assertOrdinaryAnswerScope(choice: OrdinaryAnswerChoice, retired: readonly CommitRequest[]): void {
  if (choice.scope.length !== retired.length || choice.scope.some(previous =>
    !retired.some(request => request.id === previous.id && request.revision === previous.revision + 1))) {
    throw Object.assign(new Error('The shown saved copy changed'), { code: 'decision-changed' });
  }
}

/** An editor holding the suffix can choose its answered Save without submitting the later draft. */
export function ordinaryChoiceCheckpoint(choice: OrdinaryAnswerChoice, source: SessionCheckpoint): SessionCheckpoint {
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
  const confirmed = ordinaryBasis(first);
  const observed = source.remoteCandidate ?? source.confirmed;
  const answered = choice.answer.kind === 'conflict' ? choice.answer.snapshot : undefined;
  const remoteCandidate = answered ? (canReplaceSnapshot(answered, observed) ? observed : answered)
    : source.remoteCandidate ?? (canReplaceSnapshot(confirmed, observed) && !equalValues(confirmed, observed) ? observed : null);
  return { ...source, confirmed, draft: first.initialized ? first.intended : first.value, remoteCandidate };
}

/** Preserve each reviewed chain's own later changes when taking the stored version from the notice. */
export function ordinaryStoredChoice(owner: string, choices: readonly OrdinaryAnswerChoice[], retired: CommitRequest[], known?: ResourceSnapshot) {
  return choices.flatMap(choice => {
    const scope = cancellationScope(retired, '', [choice.first.id], true);
    assertOrdinaryAnswerScope(choice, scope);
    const base = ordinaryBasis(choice.first);
    const stored = choice.answer.kind === 'conflict' ? choice.answer.snapshot
      : known && canReplaceSnapshot(base, known) && snapshotBelongsToOwner(owner, known) ? known : base;
    return projectSavedChoiceDependents(owner, choice.first, stored, stored.value, scope);
  });
}

function hasOnlyCapturedWords(checkpoint: SessionCheckpoint, request: CommitRequest): boolean {
  const capture = checkpoint.pending[request.id];
  return Boolean(capture && (capture.generation === checkpoint.editGeneration || equalValues(checkpoint.draft, capture.value)
    || (request.initialized && equalValues(checkpoint.draft, request.intended))));
}

/** Two checkpoints can show the same refused capture on different, independently known copies. */
function equivalentCouncilCopy(checkpoint: SessionCheckpoint, first: CommitRequest): CouncilRefusalCoverage['equivalent'] {
  const confirmed = ordinaryBasis(first);
  const authored = first.initialized ? first.intended : first.value;
  const observed = checkpoint.remoteCandidate ?? checkpoint.confirmed;
  if (!authored || !confirmed.metadata || !observed.metadata || !observed.value || observed.metadata.deleted
    || !canReplaceSnapshot(confirmed, observed) || observed.metadata.revision <= confirmed.metadata.revision
    || !snapshotBelongsToOwner(first.owner, observed)) return undefined;
  const merged = mergeDocumentFields(confirmed.value, authored, observed.value);
  const projected = chooseLocalPlacement(observed.resource.collection, confirmed.value, authored, observed.value,
    merged.value.exists ? merged.value.value as DocumentData : null, mergeFields);
  const variants = [{ confirmed, draft: authored }, { confirmed: observed, draft: projected }];
  const matches = (variant: typeof variants[number]) => equalValues(variant.confirmed, checkpoint.confirmed)
    && equalValues(variant.draft, checkpoint.draft);
  return variants.some(matches) ? variants.find(variant => !matches(variant)) : undefined;
}

/** The inline question covers proved copies of the same work, while unrelated or unsent words stay visible. */
export function ordinaryAnswerCoverage(checkpoint: SessionCheckpoint, requests: readonly CommitRequest[]): Pick<OpenDocumentAnswer, 'laterSaves' | 'councilRefusal'> {
  const held = Object.keys(checkpoint.pending);
  if (held.length !== 1) return {};
  const first = requests.find(request => request.id === held[0]);
  const choice = first && ordinaryAnswerChoice(first, requests);
  if (!choice) return {};
  if (choice.scope.length === 1 && choice.answer.kind === 'refused' && checkpoint.confirmed.resource.collection === 'councils') {
    const equivalent = equivalentCouncilCopy(checkpoint, choice.first);
    return { councilRefusal: { confirmed: checkpoint.confirmed, remoteCandidate: checkpoint.remoteCandidate,
      ...(equivalent ? { equivalent } : {}) } };
  }
  if (choice.scope.length === 1 || !hasOnlyCapturedWords(checkpoint, choice.first)) return {};
  return { laterSaves: choice.scope.slice(1).map((request, index) => ({
    id: request.id, operationIds: choice.scope.slice(0, index + 2).map(member => member.id), draft: request.value,
  })) };
}
