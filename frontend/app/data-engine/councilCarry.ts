import { carriedCopy } from './councilCarryContent';
import { equalValues } from './protocol';
import { DataSession } from './session';

import type { AtomicCapture, CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData, ResourceSnapshot } from './types';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const refuse = (code: string): never => { throw Object.assign(new Error(code), { code }); };

/** Freeze just the selected matter and its carry mark, using the parent's proven saved chain. */
export function captureCouncilCarry(owner: string, editorId: string, pinned: SessionCheckpoint, requests: readonly CommitRequest[],
  topicId: string, destinationId: string, title: string, now: string): { captures: AtomicCapture[]; destination: ResourceSnapshot } {
  const baseline = pinned.confirmed;
  if (baseline.resource.collection !== 'councils' || !baseline.value || baseline.metadata?.deleted || !pinned.draft
    || baseline.value.userId !== owner || pinned.draft.userId !== owner || pinned.conflicts.length) return refuse('resolve-version-first');
  const selected = (pinned.draft.topics as DocumentData[] | undefined)?.find(topic => topic.id === topicId);
  if (!selected) return refuse('topic-gone');
  if (selected.carriedToCouncilId) return refuse('topic-already-carried');
  const predecessorId = Object.entries(pinned.pending).sort((a, b) => b[1].generation - a[1].generation)[0]?.[0] ?? null;
  const predecessor = predecessorId ? requests.find(request => request.id === predecessorId) : undefined;
  if (predecessorId && (!predecessor || predecessor.owner !== owner || !predecessor.value
    || predecessor.baseline.resource.collection !== 'councils' || predecessor.baseline.resource.id !== baseline.resource.id
    || !equalValues(predecessor.value, pinned.pending[predecessorId].value) || predecessor.state === 'cancelled')) return refuse('resolve-version-first');
  const ancestor = copy(predecessor?.value ?? baseline.value);
  const beforeTopics = (ancestor.topics ?? []) as DocumentData[];
  if (!beforeTopics.some(topic => topic.id === topicId)) return refuse('topic-gone');
  const source = new DataSession(baseline);
  source.edit({ ...ancestor, topics: beforeTopics.map(topic => topic.id === topicId ? { ...copy(selected), carriedToCouncilId: destinationId } : topic) });
  const destination: ResourceSnapshot = { resource: { collection: 'councils', id: destinationId }, metadata: null,
    value: { userId: owner, title, status: 'preparing', topics: [carriedCopy(selected, destinationId)], createdAt: now, updatedAt: now } };
  const target = new DataSession({ ...destination, value: null }); target.edit(destination.value);
  return { destination, captures: [
    { editorId: JSON.stringify([editorId, 'carry', topicId, destinationId]), captured: source.checkpoint(), predecessorId },
    { editorId: JSON.stringify([editorId, 'carry-destination', destinationId]), captured: target.checkpoint(), predecessorId: null },
  ] };
}
