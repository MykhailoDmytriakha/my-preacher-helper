import { carriedCopy } from './councilCarryContent';
import { equalValues } from './protocol';
import { DataSession } from './session';
import { canReplaceSnapshot } from './snapshotFreshness';
import { submittedWorkCheckpoint } from './submittedWork';

import type { AtomicCapture, CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData, ResourceSnapshot } from './types';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const RESOLVE_VERSION_FIRST = 'resolve-version-first';
const refuse = (code: string): never => { throw Object.assign(new Error(code), { code }); };

/** A destination is based on confirmed content and one proven saved chain, never unsent typing. */
export function pinCouncilDestination(owner: string, snapshot: ResourceSnapshot, requests: readonly CommitRequest[]): SessionCheckpoint {
  let baseline = copy(snapshot);
  const related = requests.filter(request => request.owner === owner && equalValues(request.baseline.resource, snapshot.resource));
  for (const request of related) if (request.result?.kind === 'acknowledged' && canReplaceSnapshot(baseline, request.result.snapshot)) baseline = copy(request.result.snapshot);
  const unfinished = related.filter(request => !['acknowledged', 'cancelled'].includes(request.state));
  if (unfinished.some(request => ['conflict', 'refused'].includes(request.state))) return refuse(RESOLVE_VERSION_FIRST);
  const submitted = submittedWorkCheckpoint(owner, snapshot.resource, related);
  if (!submitted) {
    if (unfinished.length) return refuse(RESOLVE_VERSION_FIRST);
    return new DataSession(baseline).checkpoint();
  }
  const session = DataSession.restore(submitted);
  for (const id of Object.keys(submitted.pending)) session.applyCommit(related.find(request => request.id === id)!);
  return session.checkpoint();
}

function savedCouncilAncestor(owner: string, pinned: SessionCheckpoint, requests: readonly CommitRequest[]) {
  const baseline = pinned.confirmed;
  if (baseline.resource.collection !== 'councils' || baseline.metadata?.deleted || !pinned.draft
    || (baseline.value && baseline.value.userId !== owner) || pinned.draft.userId !== owner || pinned.conflicts.length) return refuse(RESOLVE_VERSION_FIRST);
  const predecessorId = Object.entries(pinned.pending).sort((a, b) => b[1].generation - a[1].generation)[0]?.[0] ?? null;
  const predecessor = predecessorId ? requests.find(request => request.id === predecessorId) : undefined;
  if (predecessorId && (!predecessor || predecessor.owner !== owner || !predecessor.value
    || !equalValues(predecessor.baseline.resource, baseline.resource)
    || !equalValues(predecessor.value, pinned.pending[predecessorId].value) || predecessor.state === 'cancelled')) return refuse(RESOLVE_VERSION_FIRST);
  const ancestor = copy(predecessor?.value ?? baseline.value);
  if (!ancestor || ancestor.userId !== owner) return refuse('referenced-document-deleted');
  return { baseline, ancestor, predecessorId };
}

/** Freeze just the selected matter and its carry mark, using each participant's proven saved chain. */
export function captureCouncilCarry(owner: string, editorId: string, pinned: SessionCheckpoint, requests: readonly CommitRequest[],
  topicId: string, destinationId: string, title: string, now: string, targetPin?: SessionCheckpoint, copyId = destinationId): { captures: AtomicCapture[]; destination: ResourceSnapshot } {
  const { baseline, ancestor, predecessorId } = savedCouncilAncestor(owner, pinned, requests);
  const selected = (pinned.draft!.topics as DocumentData[] | undefined)?.find(topic => topic.id === topicId);
  if (!selected) return refuse('topic-gone');
  if (selected.carriedToCouncilId) return refuse('topic-already-carried');
  if (destinationId === baseline.resource.id) return refuse('invalid-argument');
  const beforeTopics = (ancestor.topics ?? []) as DocumentData[];
  if (!beforeTopics.some(topic => topic.id === topicId)) return refuse('topic-gone');
  const source = new DataSession(baseline);
  source.edit({ ...ancestor, topics: beforeTopics.map(topic => topic.id === topicId ? { ...copy(selected), carriedToCouncilId: destinationId } : topic) });
  const targetSaved = targetPin ? savedCouncilAncestor(owner, targetPin, requests) : null;
  if (targetSaved && (targetSaved.baseline.resource.id !== destinationId || targetSaved.ancestor.status !== 'preparing')) return refuse('referenced-document-deleted');
  const destination: ResourceSnapshot = { resource: { collection: 'councils', id: destinationId }, metadata: targetSaved?.baseline.metadata ?? null,
    value: targetSaved ? { ...targetSaved.ancestor, topics: [...(targetSaved.ancestor.topics ?? []) as DocumentData[], carriedCopy(selected, copyId)] }
      : { userId: owner, title, status: 'preparing', topics: [carriedCopy(selected, copyId)], createdAt: now, updatedAt: now } };
  const target = new DataSession(targetSaved?.baseline ?? { ...destination, value: null }); target.edit(destination.value);
  return { destination, captures: [
    { editorId: JSON.stringify([editorId, 'carry', topicId, copyId]), captured: source.checkpoint(), predecessorId },
    { editorId: JSON.stringify([editorId, 'carry-destination', copyId]), captured: target.checkpoint(), predecessorId: targetSaved?.predecessorId ?? null },
  ] };
}
