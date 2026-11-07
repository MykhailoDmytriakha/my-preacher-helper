import { cancellationScope } from './atomicCommits';
import { orderCommitRequests } from './commits';
import { isDocumentEditor, readManualScopeIdentity } from './editorIdentity';
import { chooseLocalPlacement } from './localPlacementChoice';
import { projectSavedChoiceDependents } from './manualChoice';
import { storedManualContinuation } from './manualReturnSources';
import { projectManualSelection, type ManualPath } from './manualScope';
import { equalValues, mergeDocumentFields, mergeFields } from './protocol';
import { canReplaceSnapshot } from './snapshotFreshness';
import { snapshotBelongsToOwner } from './snapshotIdentity';

import type { CommitRequest, ManualChoiceRecovery } from './commits';
import type { EditorRecord } from './controller';
import type { ManualScopeStore } from './manualScopes.client';
import type { CouncilRefusalCoverage, CoveredSavedAnswer, OpenDocumentAnswer } from './openDocumentAnswers';
import type { SessionCheckpoint } from './session';
import type { CommandResult, DocumentData, ResourceRef, ResourceSnapshot } from './types';

export type ManualChoiceSources = ReadonlyMap<string, { scopeId: string; selection: readonly ManualPath[] }>;

export interface OrdinaryAnswerChoice {
  first: CommitRequest;
  answer: Extract<CommandResult, { kind: 'conflict' | 'refused' }>;
  scope: readonly CommitRequest[];
  manual: readonly CommitRequest[];
  branched: boolean;
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

function answerScope(first: CommitRequest, requests: readonly CommitRequest[]): CommitRequest[] {
  return cancellationScope(requests.filter(request => request.owner === first.owner), '', [first.id]);
}

function hasFork(scope: readonly CommitRequest[]): boolean {
  const ids = new Set(scope.map(request => request.id));
  const parents = new Set<string>();
  for (const { predecessor } of scope) {
    if (!predecessor || !ids.has(predecessor)) continue;
    if (parents.has(predecessor)) return true;
    parents.add(predecessor);
  }
  return false;
}

/** Identify an ordinary tree, allowing only independent form leaves directly below its root. */
function candidateOrdinaryAnswer(first: CommitRequest, requests: readonly CommitRequest[]): OrdinaryAnswerChoice | null {
  const answer = ordinaryAnswer(first);
  if (!answer) return null;
  let scope: CommitRequest[];
  try { scope = orderCommitRequests(answerScope(first, requests)); } catch { return null; }
  if (scope[0]?.id !== first.id) return null;
  const proved = new Set([first.id]);
  const manual: CommitRequest[] = [];
  for (const request of scope.slice(1)) {
    if (!request.predecessor || !proved.has(request.predecessor) || request.state !== 'queued'
      || request.initialized || request.command || !equalValues(request.baseline.resource, first.baseline.resource)) return null;
    if (ordinaryUpdate(request)) { proved.add(request.id); continue; }
    const identity = readManualScopeIdentity(request.editorId);
    if (!identity || !isDocumentEditor(identity.parentEditorId, first.baseline.resource) || request.predecessor !== first.id
      || !request.baseline.value || !request.value || request.atomic || request.retentionScope
      || request.transferredFrom || request.transferredTo) return null;
    manual.push(request);
  }
  const branched = hasFork(scope);
  if (manual.length && !branched) return null;
  return { first, answer, scope, manual, branched };
}

/** The shape of a manual identity alone cannot grant an ordinary editor its saved work. */
export function ordinaryAnswerChoice(first: CommitRequest, requests: readonly CommitRequest[],
  sources?: ManualChoiceSources): OrdinaryAnswerChoice | null {
  const choice = candidateOrdinaryAnswer(first, requests);
  return choice && choice.manual.every(request => sources?.get(request.id)?.scopeId === request.editorId) ? choice : null;
}

export async function manualOrdinaryChoiceSources(store: ManualScopeStore, owner: string, resource: ResourceRef,
  requests: readonly CommitRequest[]): Promise<ManualChoiceSources> {
  const related = requests.filter(request => request.owner === owner && equalValues(request.baseline.resource, resource));
  const sources = new Map<string, { scopeId: string; selection: readonly ManualPath[] }>();
  await Promise.all(related.flatMap(root => (candidateOrdinaryAnswer(root, requests)?.manual ?? []).map(async request => {
    const scope = await store.read(owner, request.editorId);
    const record = storedManualContinuation(scope, root, request, related);
    if (record) sources.set(request.id, { scopeId: record.scopeId, selection: record.selection });
  })));
  return sources;
}

/** When no single continuation can be opened, the only common answered Save may still be reviewed. */
export function commonOrdinaryAnswer(owner: string, resource: ResourceRef, requests: readonly CommitRequest[],
  sources?: ManualChoiceSources): CommitRequest | undefined {
  const unfinished = requests.filter(request => request.owner === owner && equalValues(request.baseline.resource, resource)
    && request.state !== 'acknowledged' && request.state !== 'cancelled');
  const answered = unfinished.filter(request => request.state === 'conflict' || request.state === 'refused');
  if (answered.length !== 1) return undefined;
  const choice = ordinaryAnswerChoice(answered[0], requests, sources);
  return choice?.branched && choice.scope.length === unfinished.length ? choice.first : undefined;
}

/** A field form cannot decide a whole-document fork, even when a different writer joined it. */
export function hasBranchedOrdinaryAnswer(held: readonly string[], requests: readonly CommitRequest[]): boolean {
  return requests.some(request => held.includes(request.id) && ordinaryAnswer(request) && hasFork(answerScope(request, requests)));
}

export function requireDocumentChoiceForBranch(held: readonly string[], requests: readonly CommitRequest[]): void {
  if (hasBranchedOrdinaryAnswer(held, requests)) {
    throw Object.assign(new Error('Resolve the branched Save from its document'), { code: 'other-changes-first' });
  }
}

function lineage(byId: ReadonlyMap<string, CommitRequest>, tip: CommitRequest): string[] {
  const ids = [tip.id];
  let predecessor = tip.predecessor;
  while (predecessor) {
    const parent = byId.get(predecessor);
    if (!parent) break;
    ids.push(parent.id);
    predecessor = parent.predecessor;
  }
  return ids.reverse();
}

/** A different kind of saved action cannot be swept by an ordinary answer choice. */
export function reviewOrdinaryAnswerChoice(first: CommitRequest, requests: readonly CommitRequest[],
  sources?: ManualChoiceSources): OrdinaryAnswerChoice | null {
  if (!ordinaryAnswer(first)) return null;
  const choice = ordinaryAnswerChoice(first, requests, sources);
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
  const path = new Set(lineage(new Map(scope.map(request => [request.id, request])), latest));
  if (Object.keys(source.pending).some(id => !path.has(id)) || !hasOnlyCapturedWords(source, latest)) {
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

/** Keep a later form Save in its own form, separate from the editor's retained copies. */
export function projectOrdinaryChoiceDependents(owner: string, choice: OrdinaryAnswerChoice, stored: ResourceSnapshot,
  draft: DocumentData | null, retired: CommitRequest[], decidingEditorId?: string) {
  const manual = new Set(choice.manual.map(request => request.id));
  return {
    editorRecords: projectSavedChoiceDependents(owner, choice.first, stored, draft,
      retired.filter(request => !manual.has(request.id)), decidingEditorId),
    manualRecoveries: choice.manual.map(request => ({ rootId: choice.first.id, requestId: request.id, stored })),
  };
}

/** Preserve each reviewed chain's own later changes when taking the stored version from the notice. */
export function ordinaryStoredChoice(owner: string, choices: readonly OrdinaryAnswerChoice[], retired: CommitRequest[], known?: ResourceSnapshot) {
  const editorRecords: EditorRecord[] = [], manualRecoveries: ManualChoiceRecovery[] = [];
  for (const choice of choices) {
    const scope = cancellationScope(retired, '', [choice.first.id], true);
    assertOrdinaryAnswerScope(choice, scope);
    const answered = choice.answer.kind === 'conflict' ? choice.answer.snapshot : ordinaryBasis(choice.first);
    const stored = known && equalValues(answered.resource, known.resource) && snapshotBelongsToOwner(owner, known)
      && canReplaceSnapshot(answered, known) ? known : answered;
    const projection = projectOrdinaryChoiceDependents(owner, choice, stored, stored.value, scope);
    editorRecords.push(...projection.editorRecords);
    manualRecoveries.push(...projection.manualRecoveries);
  }
  return { editorRecords, manualRecoveries };
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

/** A form's parent overlays only its selected fields on the ordinary draft it currently holds. */
function composedManualCoverage(choice: OrdinaryAnswerChoice, sources: ManualChoiceSources): CoveredSavedAnswer[] {
  const operationIds = choice.scope.map(request => request.id);
  const ordinary = choice.scope.filter(request => ordinaryUpdate(request));
  return choice.manual.flatMap(request => {
    const source = sources.get(request.id);
    if (!source || !request.value) return [];
    const value = request.value;
    return ordinary.flatMap(base => {
      try { return [{ id: request.id, operationIds, draft: projectManualSelection(base.value!, value, source.selection) }]; }
      catch { return []; } // An ordinary branch may have removed the selected item entirely.
    });
  });
}

/** The inline question covers proved copies of the same work, while unrelated or unsent words stay visible. */
export function ordinaryAnswerCoverage(checkpoint: SessionCheckpoint, requests: readonly CommitRequest[],
  sources?: ManualChoiceSources): Pick<OpenDocumentAnswer, 'laterSaves' | 'councilRefusal'> {
  const held = Object.keys(checkpoint.pending);
  if (held.length !== 1) return {};
  const first = requests.find(request => request.id === held[0]);
  const choice = first && ordinaryAnswerChoice(first, requests, sources);
  if (!choice) return {};
  if (choice.scope.length === 1 && choice.answer.kind === 'refused' && checkpoint.confirmed.resource.collection === 'councils') {
    const equivalent = equivalentCouncilCopy(checkpoint, choice.first);
    return { councilRefusal: { confirmed: checkpoint.confirmed, remoteCandidate: checkpoint.remoteCandidate,
      ...(equivalent ? { equivalent } : {}) } };
  }
  if (choice.scope.length === 1 || !hasOnlyCapturedWords(checkpoint, choice.first)) return {};
  const byId = new Map(choice.scope.map(request => [request.id, request]));
  const laterSaves: CoveredSavedAnswer[] = choice.scope.slice(1).map(request => ({
    id: request.id, operationIds: lineage(byId, request), draft: request.value,
  }));
  if (sources?.size) laterSaves.push(...composedManualCoverage(choice, sources));
  return { laterSaves };
}
