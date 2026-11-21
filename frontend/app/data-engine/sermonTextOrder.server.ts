import { createHash } from 'node:crypto';

import { documentProofHeadroom } from './documentProofBudget.server';
import { commandFingerprint, equalValues, object, own } from './fieldValues';
import { preachDateDetailConflict, preachDateFieldTarget } from './preachDateFieldAction';
import { proofRevision, rowConflictPath } from './rowFieldAction';
import { preserveUnorderedPlanText } from './sermonPlanText';
import { changedSermonText, isPlanCellPath, isSermonTextRoot, SERMON_TEXT_ROOTS as roots, sermonTextChanges, sermonTextLeaves } from './sermonTextOpenings';

import type { PreachDateField, PreachDateFieldValue } from './preachDateFieldAction';
import type { RowDetailOrder } from './rowDetailOrder.server';
import type { ConflictDetail, DataCommand, ResourceSnapshot } from './types';

const PROOF = 'sermonTextReturn';
const MAX_DEPARTURES = 96;

type PreachingOrder = RowDetailOrder<PreachDateField, PreachDateFieldValue>;
type TextEdits = ReturnType<typeof sermonTextChanges>;

type Departure = { digest: string; revision: number };
type History = { floor: number; departures: Departure[] };
type HistoryByRoot = Record<typeof roots[number], History>;
const empty = (): History => ({ floor: 0, departures: [] });
const digest = (key: string, value: unknown) => createHash('sha256').update(commandFingerprint([key, value])).digest('base64url');

function history(raw: unknown, generation: string, revision: number): HistoryByRoot {
  const evidence = object(raw) ? raw[PROOF] : undefined;
  const read = (root: typeof roots[number]): History => {
    if (evidence === undefined) return empty();
    // Records written before date notes joined this policy have no notes history.
    if (root === 'preachDates' && object(evidence) && evidence.generation === generation && !own(evidence, root)) return empty();
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
  return { planText: read('planText'), outline: read('outline'), scratch: read('scratch'), preachDates: read('preachDates') };
}

export function compareReturnedSermonText(command: DataCommand, current: ResourceSnapshot, raw: unknown, orderedPaths: ReadonlySet<string>): ConflictDetail[] {
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
    if (orderedPaths.has(JSON.stringify(path))) return [];
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

/** Find authored returns that the normal merge accepted without changing the stored words. */
export function reaffirmedSermonText(command: DataCommand | undefined, previous: ResourceSnapshot, snapshot: ResourceSnapshot,
  preaching?: PreachingOrder): TextEdits {
  if (command?.kind !== 'update' || command.generation !== previous.metadata?.generation
    || command.generation !== snapshot.metadata?.generation || !previous.value || !snapshot.value) return [];
  const prior = previous.value, value = snapshot.value;
  const superseded = new Set([...(preaching?.fields ?? [])].flatMap(([field, plans]) => plans.flatMap(({ supersededSameValue }) =>
    supersededSameValue ? [JSON.stringify(rowConflictPath(supersededSameValue, preachDateFieldTarget(field)))] : [])));
  const edits = sermonTextChanges(command.changes.map(change => change.path[0] === 'planText'
    ? preserveUnorderedPlanText(change, prior, value, command.observedPlanTextRemoval) : change));
  return roots.flatMap(root => {
    const candidates = edits.filter(({ path }) => path[0] === root && !superseded.has(JSON.stringify(path)));
    if (!candidates.length) return [];
    const opening = sermonTextLeaves(root, prior[root]);
    const saved = equalValues(prior[root], value[root]) ? opening : sermonTextLeaves(root, value[root]);
    return candidates.filter(({ key, path, after }) => {
      const previousLeaf = opening.get(key);
      const savedLeaf = saved.get(key);
      if ((!previousLeaf || !savedLeaf) && !isPlanCellPath(path)) return false;
      return equalValues(previousLeaf?.value ?? { exists: false }, after)
        && equalValues(savedLeaf?.value ?? { exists: false }, after);
    });
  });
}

/** A legacy return also advances the date-field proof, with no claim about its action time. */
export function preachingWithReaffirmations(order: PreachingOrder | undefined, edits: TextEdits): PreachingOrder | undefined {
  if (order?.command.kind !== 'update' || !edits.some(({ path }) => path[0] === 'preachDates')) return order;
  const fields = new Map([...order.fields].map(([field, plans]) => [field, [...plans]]));
  for (const { path } of edits) {
    const detail = preachDateDetailConflict(path);
    if (!detail) continue;
    const { field, rowId } = detail;
    if (order.fields.get(field)?.some(plan => plan.stamp?.rowId === rowId)) continue;
    const plans = fields.get(field) ?? [];
    plans.push({ command: order.command, reaffirmedWithoutTime: rowId });
    fields.set(field, plans);
  }
  return { ...order, fields };
}

/** Carry accepted departures and reaffirmations forward with their per-field revisions. */
export function metadataAfterSermonText(snapshot: ResourceSnapshot, previous: ResourceSnapshot, raw: unknown, reaffirmed: TextEdits) {
  const { value, metadata } = snapshot;
  if (snapshot.resource.collection !== 'sermons' || !value || !metadata || !previous.value
    || metadata.generation !== previous.metadata?.generation) return metadata;
  const prior = previous.value;
  const updates = roots.map(root => {
    const departed = equalValues(prior[root], value[root]) ? []
      : changedSermonText(root, sermonTextLeaves(root, prior[root]), sermonTextLeaves(root, value[root]), true);
    return { root, digests: [
      ...departed.map(({ key, before }) => digest(key, before)),
      ...reaffirmed.filter(({ path }) => path[0] === root).map(({ key, after }) => digest(key, after)),
    ] };
  });
  if (!updates.some(update => update.digests.length) && (!object(raw) || raw[PROOF] === undefined)) return metadata;
  const evidence = history(raw, metadata.generation, previous.metadata.revision);
  for (const { root, digests } of updates) {
    const history = evidence[root];
    const departures = new Map(history.departures.map(entry => [entry.digest, entry]));
    for (const keyDigest of digests) {
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
