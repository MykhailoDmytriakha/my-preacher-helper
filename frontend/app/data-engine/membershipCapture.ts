import { collectionDocumentViews } from './collectionView';
import { sameManualSelection } from './manualScope';
import { DataSession } from './session';
import { canReplaceSnapshot } from './snapshotFreshness';
import { submittedWorkCheckpoint } from './submittedWork';

import type { CollectionState } from './collections';
import type { CommitRequest } from './commits';
import type { MembershipPin } from './membershipScope';

/** Pin the list before presenting the selector. Never reread ancestors when Save is pressed. */
export function captureMembershipPins(owner: string, state: CollectionState, requests: readonly CommitRequest[]): MembershipPin[] {
  if (!state.complete) throw new Error('A complete saved series list is required for membership editing');
  const related = requests.filter(request => request.owner === owner && request.baseline.resource.collection === 'series');
  const snapshots = new Map(state.snapshots.map(snapshot => [snapshot.resource.id, snapshot]));
  for (const request of related) if (request.result?.kind === 'acknowledged') {
    const snapshot = request.result.snapshot;
    if (canReplaceSnapshot(snapshots.get(snapshot.resource.id), snapshot)) snapshots.set(snapshot.resource.id, snapshot);
  }
  return collectionDocumentViews(owner, 'series', [...snapshots.values()], related).flatMap((view): MembershipPin[] => {
    if (view.needsAttention || view.deleting) throw new Error('Resolve outstanding series changes before opening membership editing');
    if (!view.value) return [];
    const submitted = submittedWorkCheckpoint(owner, view.resource, related);
    if (!submitted) return [{ baseline: snapshots.get(view.resource.id)!, predecessor: null }];
    const session = DataSession.restore(submitted);
    for (const id of Object.keys(submitted.pending)) session.applyCommit(related.find(request => request.id === id)!);
    const checkpoint = session.checkpoint();
    const pending = related.filter(request => Object.keys(checkpoint.pending).includes(request.id));
    const predecessors = new Set(pending.map(request => request.predecessor));
    const tips = pending.filter(request => !predecessors.has(request.id));
    const tip = tips.length === 1 ? tips[0] : null;
    if (!tip?.value || !['items', 'sermonIds', 'seriesKind'].every(field => sameManualSelection(tip.value, checkpoint.draft, [field]))) {
      throw new Error('Membership display does not have one saved predecessor');
    }
    return [{ baseline: tip.baseline, predecessor: { id: tip.id, owner, resource: tip.baseline.resource, value: tip.value, predecessorId: tip.predecessor } }];
  });
}
