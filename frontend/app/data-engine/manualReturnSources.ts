import { areDifferentTabManualParents, areSameTabManualParents, readManualScopeIdentity } from './editorIdentity';
import { reconcileManualCaptures } from './manualScope';
import { equalValues } from './protocol';

import type { CommitRequest } from './commits';
import type { ManualScope, ManualCapture } from './manualScope';
import type { ManualScopeStore } from './manualScopes.client';
import type { SessionCheckpoint } from './session';
import type { ResourceRef } from './types';

function hasForeignContinuation(origin: string, targets: ReadonlySet<string>, resource: ResourceRef,
  requests: readonly CommitRequest[], byId: ReadonlyMap<string, CommitRequest>): boolean {
  if (!targets.size) return false;
  return requests.some(request => {
    const writer = readManualScopeIdentity(request.editorId)?.parentEditorId ?? request.editorId;
    if (['acknowledged', 'cancelled'].includes(request.state) || !areDifferentTabManualParents(origin, writer, resource)) return false;
    const visited = new Set<string>();
    for (let id = request.predecessor; id && !visited.has(id); id = byId.get(id)?.predecessor ?? null) {
      if (targets.has(id)) return true;
      visited.add(id);
    }
    return false;
  });
}

/** Return may discover a foreign dependent after this same-tab editor opened. */
export function reopenedManualAnswerScope(request: CommitRequest, editorId: string,
  requests: ReadonlyMap<string, CommitRequest>): string | undefined {
  const origin = readManualScopeIdentity(request.editorId)?.parentEditorId;
  const resource = request.baseline.resource;
  if (!origin || origin === editorId || !areSameTabManualParents(origin, editorId, resource)) return undefined;
  const related = [...requests.values()].filter(row => row.owner === request.owner && equalValues(row.baseline.resource, resource));
  return hasForeignContinuation(origin, new Set([request.id]), resource, related, requests) ? request.editorId : undefined;
}

/** The durable form envelope, rather than the spelling of a request ID, proves its source. */
export async function manualReturnSources(store: ManualScopeStore, owner: string, editorId: string,
  resource: ResourceRef, requests: readonly CommitRequest[]): Promise<Map<string, string>> {
  const outstanding = requests.filter(request => !['acknowledged', 'cancelled'].includes(request.state));
  const scopeIds = new Set(outstanding.map(request => request.editorId));
  const byId = new Map(requests.map(request => [request.id, request]));
  const proven = new Map<string, string>();
  await Promise.all([...scopeIds].map(async scopeId => {
    const identity = readManualScopeIdentity(scopeId);
    if (!identity || identity.parentEditorId === editorId) return;
    const origin = identity.parentEditorId;
    const otherTab = areDifferentTabManualParents(origin, editorId, resource);
    const reopened = !otherTab && areSameTabManualParents(origin, editorId, resource)
      && hasForeignContinuation(origin, new Set(outstanding.filter(row => row.editorId === scopeId).map(row => row.id)), resource, requests, byId);
    if (!otherTab && !reopened) return;
    const scope = await store.read(owner, scopeId);
    if (!scope?.record || scope.owner !== owner || scope.scopeId !== scopeId || scope.parentEditorId !== identity.parentEditorId
      || scope.slot !== identity.slot || scope.record.scopeId !== scopeId || scope.record.owner !== owner
      || !equalValues(scope.record.resource, resource)) return;
    const record = reconcileManualCaptures(scope.record, requests);
    const saved = record.predecessor;
    if (!saved || record.savedGeneration === null) return;
    let request = byId.get(saved.id);
    if (!request || request.editorId !== scopeId || request.editGeneration !== record.savedGeneration
      || request.predecessor !== saved.predecessorId || !equalValues(request.value, saved.value)) return;
    while (request?.editorId === scopeId && !proven.has(request.id)) {
      proven.set(request.id, scopeId);
      request = request.predecessor ? byId.get(request.predecessor) : undefined;
    }
  }));
  return proven;
}

export function markBorrowedManualSources(checkpoint: SessionCheckpoint, sources?: ReadonlyMap<string, string>): void {
  for (const [id, scopeId] of sources ?? []) {
    if (checkpoint.pending[id]) checkpoint.pending[id].borrowedManualScope = scopeId;
  }
}

export function sameManualSources(before?: ReadonlyMap<string, string>, after?: ReadonlyMap<string, string>): boolean {
  return (before?.size ?? 0) === (after?.size ?? 0) && [...before ?? []].every(([id, scopeId]) => after?.get(id) === scopeId);
}

export function shouldFollowReopenedManualStage(stage: ReturnType<ManualScope['getState']>, capture: ManualCapture): boolean {
  const predecessor = stage.record.predecessor?.id;
  const pending = capture.checkpoint.pending;
  return Boolean(predecessor && !stage.dirty && stage.record.savedGeneration === null && pending[predecessor]?.borrowedManualScope
    && capture.provenance.some(item => item.requestId !== predecessor && pending[item.requestId]?.borrowedManualScope));
}
