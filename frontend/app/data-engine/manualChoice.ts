import { orderCommitRequests } from './commits';
import { manualChoiceRecoveryIdentity } from './editorIdentity';
import { chooseLocalPlacement } from './localPlacementChoice';
import { projectManualSelection, type ManualPath } from './manualScope';
import { equalValues, mergeDocumentFields, mergeFields } from './protocol';
import { canReplaceSnapshot } from './snapshotFreshness';

import type { CommitRequest } from './commits';
import type { EditorRecord } from './controller';
import type { ManualScope } from './manualScope';
import type { SessionCheckpoint } from './session';
import type { DocumentData, ResourceSnapshot } from './types';

type ManualStage = ReturnType<ManualScope['getState']>;
const unanswered = (request: CommitRequest) => !['acknowledged', 'cancelled'].includes(request.state);

function hasLaterScope(request: CommitRequest, requests: ReadonlyMap<string, CommitRequest>): boolean {
  const related = [...requests.values()].filter(item => item.owner === request.owner && equalValues(item.baseline.resource, request.baseline.resource));
  const descendants = new Set([request.id]);
  for (const item of orderCommitRequests(related)) {
    if (!item.predecessor || !descendants.has(item.predecessor)) continue;
    if (unanswered(item) && item.editorId !== request.editorId) return true;
    descendants.add(item.id);
  }
  return false;
}

/** Explicit recovery grants authority only over a proved, answered ancestor of the shown form. */
export function exactManualRequest(stage: ManualStage | undefined, checkpoint: SessionCheckpoint,
  requests: ReadonlyMap<string, CommitRequest>): CommitRequest | undefined {
  if (!stage) return undefined;
  const { record } = stage;
  const visited = new Set<string>();
  let id = record.predecessor?.id;
  while (id && !visited.has(id)) {
    visited.add(id);
    const request = requests.get(id);
    if (!request || request.owner !== record.owner || !equalValues(request.baseline.resource, record.resource)) return undefined;
    const pending = checkpoint.pending[id];
    if (pending && request.value && ['conflict', 'refused'].includes(request.state)) {
      const recovered = record.recoverySources?.some(source => source.id === request.editorId);
      if (recovered || (record.scopeId === request.editorId && hasLaterScope(request, requests))) return request;
    }
    id = request.predecessor ?? undefined;
  }
  return undefined;
}

export function exactManualWords(stage: ManualStage, request: CommitRequest): DocumentData {
  return stage.record.predecessor?.id === request.id ? stage.value : request.value!;
}

export interface ExactManualChoice {
  choice: 'local' | 'remote';
  request: CommitRequest;
  stored: ResourceSnapshot;
  value: DocumentData;
  selection: readonly ManualPath[];
  privateStage?: { scopeId: string; generation: number; predecessorId: string; base: DocumentData; value: DocumentData };
}

function afterChoice(confirmed: ResourceSnapshot, draft: DocumentData | null, generation: number): SessionCheckpoint {
  return { confirmed, draft, dirty: !equalValues(draft, confirmed.value), editGeneration: generation,
    pending: {}, conflicts: [], remoteCandidate: null };
}

/** The comparison decides its one Save. Later branches remain separate drafts until explicitly recovered. */
export function projectExactManualChoice(record: EditorRecord, decision: ExactManualChoice, retired: CommitRequest[]): EditorRecord[] {
  const { checkpoint } = record;
  const ids = new Set(retired.map(request => request.id));
  const pending = Object.entries(checkpoint.pending);
  const latest = pending.reduce((generation, [, intent]) => Math.max(generation, intent.generation), -1);
  if (record.prepared || !checkpoint.pending[decision.request.id] || pending.some(([id]) => !ids.has(id))
    || !pending.some(([, intent]) => intent.generation === latest && equalValues(intent.value, checkpoint.draft))) {
    throw Object.assign(new Error('Save or resolve other document changes before resolving this form'), { code: 'other-changes-first' });
  }
  if (decision.choice === 'local' && (!decision.stored.value || decision.stored.metadata?.deleted)) {
    throw Object.assign(new Error('Remote document was deleted; use a new copy to preserve this draft'), { code: 'use-new-copy' });
  }
  const draft = decision.choice === 'local'
    ? projectManualSelection(decision.stored.value!, decision.value, decision.selection)
    : decision.stored.value;
  const decided = { ...record, checkpoint: afterChoice(decision.stored, draft, checkpoint.editGeneration + 1),
    completedCommits: [...new Set([...(record.completedCommits ?? []), ...ids])] };
  return [decided, ...projectSavedChoiceDependents(record.owner, decision.request, decision.stored, draft, retired,
    decision.choice === 'local' ? record.editorId : undefined, decision.privateStage)];
}

/** Replay a captured delta without treating the entire captured document as a new edit. */
export function replaySavedChoiceDelta(resource: ResourceSnapshot['resource'], base: DocumentData | null,
  value: DocumentData | null, target: DocumentData | null): DocumentData | null {
  const merged = mergeDocumentFields(base, value, target);
  return chooseLocalPlacement(resource.collection, base, value, target,
    merged.value.exists ? merged.value.value as DocumentData : null, mergeFields);
}

/** A choice retires blocked request identities while retaining each later branch's own delta. */
export function projectSavedChoiceDependents(owner: string, chosen: CommitRequest, stored: ResourceSnapshot,
  draft: DocumentData | null, retired: readonly CommitRequest[], decidingEditorId?: string,
  privateStage?: ExactManualChoice['privateStage'], formRequests?: ReadonlySet<string>): EditorRecord[] {
  const byId = new Map(retired.map(request => [request.id, request]));
  const predecessors = new Set(retired.map(request => request.predecessor));
  const projected = new Map<string, DocumentData | null>([[chosen.id, draft]]);
  const editors = new Map<string, string>();
  const retained = new Set<string>();
  const retain = (id: string, value: DocumentData | null): EditorRecord => ({
    owner, editorId: manualChoiceRecoveryIdentity(chosen.id, id), prepared: null, unfinalized: [],
    retainedManualChoice: { base: draft, ...(decidingEditorId ? { decidingEditorId } : {}) },
    checkpoint: { ...afterChoice(stored, value, 1), dirty: true },
  });
  const later = orderCommitRequests([...retired]).flatMap(request => {
    if (!request.retainedAfterChoice || !request.predecessor) return [];
    const ancestor = byId.get(request.predecessor);
    if (!ancestor || !projected.has(ancestor.id)) throw new Error('The later Save lost its reviewed ancestor');
    const basis = projected.get(ancestor.id)!;
    const formOwned = formRequests?.has(request.id);
    const laterDraft = formOwned ? basis : replaySavedChoiceDelta(stored.resource, ancestor.value, request.value, basis);
    projected.set(request.id, laterDraft);
    const editor = formOwned ? editors.get(ancestor.id) : request.id;
    if (editor) editors.set(request.id, editor);
    if (!editor || predecessors.has(request.id) || retained.has(editor) || equalValues(draft, laterDraft)) return [];
    retained.add(editor);
    return [retain(editor, laterDraft)];
  });
  if (privateStage) {
    const basis = projected.get(privateStage.predecessorId);
    if (basis === undefined) throw Object.assign(new Error('The shown saved copy changed'), { code: 'decision-changed' });
    const value = replaySavedChoiceDelta(stored.resource, privateStage.base, privateStage.value, basis);
    later.push(retain(JSON.stringify(['stage', privateStage.scopeId, privateStage.generation]), value));
  }
  return later;
}

/** Apply the later draft's actual delta only on explicit recovery, over the latest accepted copy. */
export function recoverManualChoiceCopy(record: EditorRecord, known?: ResourceSnapshot): EditorRecord {
  const retained = record.retainedManualChoice;
  if (!retained) return record;
  const original = record.checkpoint.confirmed;
  const confirmed = known && canReplaceSnapshot(original, known) ? known : original;
  const draft = replaySavedChoiceDelta(confirmed.resource, retained.base, record.checkpoint.draft, confirmed.value);
  return { ...record, checkpoint: afterChoice(confirmed, draft, record.checkpoint.editGeneration) };
}
