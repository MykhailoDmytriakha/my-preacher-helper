import { createHash } from 'node:crypto';

import { documentProofHeadroom } from './documentProofBudget.server';
import { commandFingerprint, equalValues, object, own } from './fieldValues';
import { proofRevision } from './rowFieldAction';
import { changedSermonText, isPlanCellPath, isSermonTextRoot, SERMON_TEXT_ROOTS as roots, sermonTextChanges, sermonTextLeaves } from './sermonTextOpenings';

import type { ConflictDetail, DataCommand, ResourceSnapshot } from './types';

const PROOF = 'sermonTextReturn';
const MAX_DEPARTURES = 96;

type Departure = { digest: string; revision: number };
type History = { floor: number; departures: Departure[] };
type HistoryByRoot = Record<typeof roots[number], History>;
const empty = (): History => ({ floor: 0, departures: [] });
const digest = (key: string, value: unknown) => createHash('sha256').update(commandFingerprint([key, value])).digest('base64url');

function history(raw: unknown, generation: string, revision: number): HistoryByRoot {
  const evidence = object(raw) ? raw[PROOF] : undefined;
  const read = (root: typeof roots[number]): History => {
    if (evidence === undefined) return empty();
    const entries = object(evidence) && evidence.generation === generation ? evidence[root] : undefined;
    if (!object(entries) || !Array.isArray(entries.departures) || entries.departures.length > MAX_DEPARTURES
      || !(entries.floor === 0 || (proofRevision(entries.floor) && entries.floor <= revision))) return { floor: revision, departures: [] };
    const departures: Departure[] = [];
    for (const entry of entries.departures) {
      if (!object(entry) || typeof entry.digest !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(entry.digest)
        || !proofRevision(entry.revision) || entry.revision > revision) return { floor: revision, departures: [] };
      departures.push({ digest: entry.digest, revision: entry.revision });
    }
    return { floor: entries.floor, departures };
  };
  return { planText: read('planText'), outline: read('outline'), scratch: read('scratch') };
}

export function compareReturnedSermonText(command: DataCommand, current: ResourceSnapshot, raw: unknown): ConflictDetail[] {
  const { metadata, value } = current;
  if (command.kind !== 'update' || command.resource.collection !== 'sermons' || !value || !metadata
    || command.generation !== metadata.generation || !object(raw) || raw[PROOF] === undefined) return [];
  const evidence = history(raw, metadata.generation, metadata.revision);
  const live = new Map(roots.filter(root => command.changes.some(change => change.path[0] === root))
    .map(root => [root, sermonTextLeaves(root, value[root])]));
  const changes = sermonTextChanges(command.changes);
  return changes.flatMap(({ key, path, before, after }) => {
    const root = path[0];
    if (!isSermonTextRoot(root)) return [];
    const field = live.get(root)?.get(key);
    if (!field && !isPlanCellPath(path)) return [];
    const stored = field?.value ?? { exists: false };
    if (!equalValues(before, stored)) return [];
    const opened = command.sermonTextOpenings && own(command.sermonTextOpenings, key)
      ? command.sermonTextOpenings[key] : command.sermonTextObservedRevision;
    const observed = opened && opened <= metadata.revision ? opened : 0;
    const { departures, floor } = evidence[root];
    if (observed >= floor && !departures.some(entry => entry.revision > observed && entry.digest === digest(key, stored))) return [];
    return [{ path: field?.path ?? path, base: before, mine: after, theirs: stored }];
  });
}

/** Record accepted departures for each field, including writes made by older clients. */
export function metadataAfterSermonText(snapshot: ResourceSnapshot, previous: ResourceSnapshot, raw: unknown) {
  const { value, metadata } = snapshot;
  if (snapshot.resource.collection !== 'sermons' || !value || !metadata || !previous.value
    || metadata.generation !== previous.metadata?.generation) return metadata;
  const prior = previous.value;
  const updates = roots.flatMap(root => equalValues(prior[root], value[root]) ? [] : [{
    root, changes: changedSermonText(root, sermonTextLeaves(root, prior[root]), sermonTextLeaves(root, value[root]), true),
  }]);
  if (!updates.some(update => update.changes.length) && (!object(raw) || raw[PROOF] === undefined)) return metadata;
  const evidence = history(raw, metadata.generation, previous.metadata.revision);
  for (const { root, changes } of updates) {
    const history = evidence[root];
    const departures = new Map(history.departures.map(entry => [entry.digest, entry]));
    for (const { key, before } of changes) {
      const keyDigest = digest(key, before);
      departures.delete(keyDigest);
      departures.set(keyDigest, { digest: keyDigest, revision: metadata.revision });
    }
    const recent = [...departures.values()];
    const removed = recent.splice(0, Math.max(0, recent.length - MAX_DEPARTURES));
    evidence[root] = { floor: Math.max(history.floor, ...removed.map(entry => entry.revision)), departures: recent };
  }
  const withHistory = () => ({ ...metadata, [PROOF]: { generation: metadata.generation, ...evidence } });
  const result = withHistory();
  if (documentProofHeadroom(value, result) >= 0) return result;
  for (const root of roots) {
    const { departures, floor } = evidence[root];
    evidence[root] = { departures: [], floor: Math.max(floor, ...departures.map(entry => entry.revision)) };
  }
  return withHistory();
}
