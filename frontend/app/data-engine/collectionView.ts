import { DataSession } from './session';
import { canReplaceSnapshot } from './snapshotFreshness';
import { submittedWorkCheckpoint } from './submittedWork';

import type { CommitRequest } from './commits';
import type { DocumentData, ResourceRef, ResourceSnapshot } from './types';

/** Read-only presentation; its value must never be used as an editor's confirmed baseline. */
export interface CollectionDocumentView {
  resource: ResourceRef;
  value: DocumentData | null;
  pending: boolean;
  needsAttention: boolean;
  deleting: boolean;
}

export function collectionDocumentViews(owner: string, collection: string, snapshots: readonly ResourceSnapshot[], requests: readonly CommitRequest[]): CollectionDocumentView[] {
  const confirmed = new Map(snapshots.map(snapshot => [snapshot.resource.id, snapshot]));
  const related = requests.filter(request => request.owner === owner && request.baseline.resource.collection === collection);
  // ACK may arrive before the feed read. Keep its proven content visible throughout
  // that interval, without upgrading collection completeness or server freshness.
  for (const request of related) {
    if (request.result?.kind !== 'acknowledged') continue;
    const snapshot = request.result.snapshot;
    if (canReplaceSnapshot(confirmed.get(snapshot.resource.id), snapshot)) confirmed.set(snapshot.resource.id, snapshot);
  }
  const views = new Map([...confirmed].map(([id, snapshot]) => [id, {
    resource: snapshot.resource, value: snapshot.value, pending: false, needsAttention: false, deleting: false,
  }]));
  const ids = new Set(related.filter(request => !['acknowledged', 'cancelled'].includes(request.state)).map(request => request.baseline.resource.id));
  for (const id of ids) {
    const resource = { collection, id };
    let checkpoint = submittedWorkCheckpoint(owner, resource, related);
    if (checkpoint) {
      const session = DataSession.restore(checkpoint);
      // Use the editor's acceptance rule for already-acknowledged ancestors too:
      // their independently merged fields belong in every presentation of the chain.
      for (const requestId of Object.keys(checkpoint.pending)) {
        const request = related.find(item => item.id === requestId)!;
        session.applyCommit(request);
      }
      checkpoint = session.checkpoint();
    }
    const unsettled = related.filter(request => request.baseline.resource.id === id && !['acknowledged', 'cancelled'].includes(request.state));
    const needsAttention = !checkpoint || checkpoint.conflicts.length > 0 || unsettled.some(request => ['conflict', 'refused'].includes(request.state));
    // Keep a pending deletion addressable until its acknowledgement; a failed
    // deletion must never remove the only route to its retry/recovery controls.
    views.set(id, { resource, value: checkpoint?.draft ?? confirmed.get(id)?.value ?? checkpoint?.confirmed.value ?? null,
      pending: true, needsAttention, deleting: Boolean(checkpoint && checkpoint.draft === null) });
  }
  return JSON.parse(JSON.stringify([...views.values()]));
}
