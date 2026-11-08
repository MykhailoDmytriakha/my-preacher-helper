import { submittedServiceOrderTitle } from './documentFieldAction';
import { DataSession } from './session';
import { canReplaceSnapshot } from './snapshotFreshness';
import { submittedWorkCheckpoint } from './submittedWork';

import type { CommitRequest } from './commits';
import type { ServiceOrderTitleSeen } from './documentFieldAction';
import type { DocumentData, JournalEntry, ResourceRef, ResourceSnapshot } from './types';

/** Read-only presentation; its value must never be used as an editor's confirmed baseline. */
export interface CollectionDocumentView {
  resource: ResourceRef;
  value: DocumentData | null;
  pending: boolean;
  needsAttention: boolean;
  deleting: boolean;
  /** Proven submitted first creation, kept separate from server existence. */
  creating?: true;
  /** A confirmed ACK that the list has not caught up with yet; never a projected draft. */
  acknowledged?: ResourceSnapshot;
  /** Exact pending request that supplied the displayed title, never a confirmed snapshot. */
  submittedTitle?: ServiceOrderTitleSeen;
}

export function collectionDocumentViews(owner: string, collection: string, snapshots: readonly ResourceSnapshot[], requests: readonly CommitRequest[], journal: readonly JournalEntry[] = []): CollectionDocumentView[] {
  const listed = new Map(snapshots.map(snapshot => [snapshot.resource.id, snapshot]));
  const confirmed = new Map(listed);
  const acknowledged = new Map<string, ResourceSnapshot>();
  const related = requests.filter(request => request.owner === owner && request.baseline.resource.collection === collection);
  // ACK may arrive before the feed read. Keep its proven content visible throughout
  // that interval, without upgrading collection completeness or server freshness.
  const accepted = related.flatMap(request => request.result?.kind === 'acknowledged' ? [request.result.snapshot] : []);
  // Server-owned actions have no editable-document draft. Their existing journal is the accepted
  // copy until cache projection finishes; include secondary capability proofs from the same ACK.
  for (const entry of journal) if (collection === 'studyNoteShareLinks' && entry.command.owner === owner
    && entry.command.resource.collection === collection && entry.result?.kind === 'acknowledged') {
    accepted.push(entry.result.snapshot, ...(entry.result.relatedSnapshots ?? []).filter(snapshot => snapshot.resource.collection === collection));
  }
  for (const snapshot of accepted) {
    if (canReplaceSnapshot(confirmed.get(snapshot.resource.id), snapshot)) {
      confirmed.set(snapshot.resource.id, snapshot);
      const previous = listed.get(snapshot.resource.id);
      if (!previous || !canReplaceSnapshot(snapshot, previous)) acknowledged.set(snapshot.resource.id, snapshot);
    }
  }
  const views = new Map<string, CollectionDocumentView>([...confirmed].map(([id, snapshot]) => [id, {
    resource: snapshot.resource, value: snapshot.value, pending: false, needsAttention: false, deleting: false,
    ...(acknowledged.has(id) ? { acknowledged: acknowledged.get(id)! } : {}),
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
    const submittedTitle = submittedServiceOrderTitle(checkpoint, unsettled, needsAttention);
    // Keep a pending deletion addressable until its acknowledgement; a failed
    // deletion must never remove the only route to its retry/recovery controls.
    views.set(id, { resource, value: checkpoint?.draft ?? confirmed.get(id)?.value ?? checkpoint?.confirmed.value ?? null,
      pending: true, needsAttention, deleting: Boolean(checkpoint && checkpoint.draft === null),
      ...(submittedTitle && { submittedTitle }),
      ...(acknowledged.has(id) ? { acknowledged: acknowledged.get(id)! } : {}),
      ...(checkpoint && checkpoint.confirmed.value === null && !checkpoint.confirmed.metadata && checkpoint.draft !== null
        ? { creating: true as const } : {}) });
  }
  return JSON.parse(JSON.stringify([...views.values()]));
}
