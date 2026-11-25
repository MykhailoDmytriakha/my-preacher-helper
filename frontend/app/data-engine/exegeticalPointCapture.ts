import { boundedActionTime } from './actionClock';
import { changedExegeticalPoint, exegeticalPlan, exegeticalPointConflict, exegeticalPlanChange, exegeticalPointVersion, projectExegeticalPoint, rawExegeticalBranch, readExegeticalPointChoice } from './exegeticalPointAction';
import { equalValues, writeField } from './fieldValues';
import { mergeDocumentFields } from './protocol';
import { boundedRowId } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { ExegeticalPointStamp, ExegeticalPointVersion } from './exegeticalPointAction';
import type { SessionCheckpoint, ShownCopy } from './session';
import type { DocumentData, FieldChange, ResourceSnapshot } from './types';

export type ExegeticalPointEdit = { kind: 'exegetical-point'; nodeId: string; intent: 'title' | 'remove' };
export type ExegeticalPointEditStamp = { field: 'exegetical-point'; nodeId: string; intent: ExegeticalPointEdit['intent']; time: ActionTime | null };
type Draft = ExegeticalPointStamp & { generation: string; title: string | null; ancestors: string[]; removedPointId?: string };
const LIMIT = 32;

function matchesResult(plan: NonNullable<ReturnType<typeof exegeticalPlan>>, action: Draft) {
  const point = exegeticalPointVersion(plan, action.nodeId);
  return action.kind === 'remove' ? !point : point?.point.title === action.title && equalValues(point.ancestors, action.ancestors);
}

export type UnreadableExegeticalProof = Pick<Draft, 'nodeId' | 'kind' | 'generation' | 'ancestors'> & { pendingAddition?: true };
type RecoveryPoint = { address?: UnreadableExegeticalProof; draft?: Draft; removedPointId?: unknown };
type Plan = NonNullable<ReturnType<typeof exegeticalPlan>>;
type RecoveredPoint =
  | { kind: 'readable'; action: Draft }
  | { kind: 'held'; address: UnreadableExegeticalProof }
  | { kind: 'unidentified'; damaged: boolean };

function addressedPoint(plan: Plan, address: UnreadableExegeticalProof) {
  const point = exegeticalPointVersion(plan, address.nodeId);
  return point && equalValues(point.ancestors, address.ancestors) ? point : undefined;
}

function sharesLegacyRemovalScope(opening: Plan, local: Plan, address: UnreadableExegeticalProof): boolean {
  const point = opening.points.entries.get(address.nodeId);
  if (!point) return false;
  return (opening.points.orders.get(point.parent) ?? []).some(id => id !== address.nodeId
    && changedExegeticalPoint(opening, local, id) === 'remove');
}

function recoverPoint({ address, draft: action, removedPointId }: RecoveryPoint, opening: Plan, local: Plan, pending: Plan | undefined,
  metadata: NonNullable<ResourceSnapshot['metadata']>, duplicateAddress: boolean): RecoveredPoint {
  if (!address || address.generation !== metadata.generation) return { kind: 'unidentified', damaged: true };
  const current = exegeticalPointVersion(local, address.nodeId);
  const before = addressedPoint(opening, address), queued = pending && addressedPoint(pending, address);
  if (address.kind === 'remove') {
    if (removedPointId !== undefined && removedPointId !== address.nodeId) return { kind: 'unidentified', damaged: true };
    if (removedPointId === undefined && (duplicateAddress || sharesLegacyRemovalScope(opening, local, address)
      || (pending && sharesLegacyRemovalScope(pending, local, address)))) return { kind: 'unidentified', damaged: true };
  }
  const changedTitle = (basis: typeof before) => basis && current?.point.title !== basis.point.title;
  const explainsDraft = address.kind === 'remove' ? before || queued : changedTitle(before) || changedTitle(queued);
  const matches = action && action.observedRevision <= metadata.revision && matchesResult(local, action);
  if (action && matches && explainsDraft) return { kind: 'readable', action };
  // An ACK can leave an observation for words already in the opening. Only an unexplained edit needs review.
  if (action && address.kind === 'title' && (before || queued) && !explainsDraft) return { kind: 'unidentified', damaged: !matches };
  const sameAddress = address.kind === 'remove' ? !current : current && equalValues(current.ancestors, address.ancestors);
  return before && sameAddress ? { kind: 'held', address } : { kind: 'unidentified', damaged: true };
}

function unobservedPointChanges(opening: Plan, local: Plan, pending: Plan | undefined, generation: string,
  known: ReadonlySet<string>): UnreadableExegeticalProof[] {
  const addresses: UnreadableExegeticalProof[] = [];
  for (const [nodeId, point] of opening.points.entries) {
    if (known.has(nodeId) || !boundedRowId(nodeId)) continue;
    // A missing parent owns its removed subtree. Its children never become separate choices.
    if (point.parent !== null && !local.points.entries.has(point.parent)) continue;
    const kind = changedExegeticalPoint(opening, local, nodeId);
    if (!kind || (pending && changedExegeticalPoint(pending, local, nodeId) !== kind)) continue;
    const { ancestors } = exegeticalPointVersion(opening, nodeId)!;
    addresses.push({ nodeId, kind, generation, ancestors });
  }
  return addresses;
}

function pendingOnlyTitleChanges(opening: Plan, pending: Plan, local: Plan, generation: string,
  known: ReadonlySet<string>): UnreadableExegeticalProof[] {
  return [...pending.points.entries.keys()].flatMap(nodeId => {
    if (known.has(nodeId) || !boundedRowId(nodeId) || opening.points.entries.has(nodeId)
      || changedExegeticalPoint(pending, local, nodeId) !== 'title') return [];
    const { ancestors } = exegeticalPointVersion(pending, nodeId)!;
    return [{ nodeId, kind: 'title', generation, ancestors, pendingAddition: true }];
  });
}

export function recoverExegeticalPointProofs(confirmed: ResourceSnapshot, draft: DocumentData,
  pendingOpening: DocumentData | undefined, proofs: readonly RecoveryPoint[], wholeListUnreadable: boolean) {
  const metadata = confirmed.metadata;
  const opening = exegeticalPlan(confirmed.value?.preparation), local = exegeticalPlan(draft.preparation);
  if (!metadata || metadata.deleted || !opening || !local) return undefined;
  const pending = exegeticalPlan(pendingOpening?.preparation);
  const readable = new Map<string, Draft>();
  const held = new Map<string, UnreadableExegeticalProof>();
  let findLostAddress = wholeListUnreadable;
  let damaged = wholeListUnreadable;
  const addressCounts = new Map<string, number>();
  for (const { address } of proofs) {
    if (address?.generation === metadata.generation) addressCounts.set(address.nodeId, (addressCounts.get(address.nodeId) ?? 0) + 1);
  }
  for (const proof of proofs) {
    const duplicate = proof.address !== undefined && (addressCounts.get(proof.address.nodeId) ?? 0) > 1;
    const point = recoverPoint(proof, opening, local, pending, metadata, duplicate);
    if (point.kind === 'readable') {
      const { action } = point;
      if (action.kind === 'remove' && (readable.has(action.nodeId) || held.has(action.nodeId))) {
        // Two complete removals cannot own the same point in a healthy checkpoint.
        readable.delete(action.nodeId);
        held.set(action.nodeId, { nodeId: action.nodeId, kind: action.kind, generation: action.generation, ancestors: action.ancestors });
        damaged = true;
      } else {
        readable.set(action.nodeId, action);
      }
    }
    if (point.kind === 'held') {
      held.set(point.address.nodeId, point.address);
      damaged = true;
    }
    if (point.kind === 'unidentified') {
      findLostAddress = true;
      damaged ||= point.damaged;
    }
  }
  if (findLostAddress) {
    const known = new Set([...readable.keys(), ...held.keys()]);
    const changes = unobservedPointChanges(opening, local, pending, metadata.generation, known);
    const pendingOnly = pending ? pendingOnlyTitleChanges(opening, pending, local, metadata.generation, known) : [];
    for (const address of [...changes, ...pendingOnly]) held.set(address.nodeId, address);
    damaged ||= changes.length > 0 || pendingOnly.length > 0;
  }
  for (const nodeId of readable.keys()) held.delete(nodeId);
  return { damaged, readable: [...readable.values()], held: [...held.values()] };
}

/** A refused earlier addition owns its submitted branch, but any later change still needs its own decision. */
export function hasLaterPendingExegeticalTitle(checkpoint: SessionCheckpoint, requestId: string): boolean {
  const pending = checkpoint.pending[requestId];
  if (!pending || pending.generation >= checkpoint.editGeneration) return false;
  const opening = exegeticalPlan(checkpoint.confirmed.value?.preparation);
  const submitted = exegeticalPlan(pending.value?.preparation), local = exegeticalPlan(checkpoint.draft?.preparation);
  if (!opening || !submitted || !local) return false;
  return checkpoint.unreadableExegeticalProofs?.some(address => address.pendingAddition && address.kind === 'title'
    && address.generation === checkpoint.confirmed.metadata?.generation && !opening.points.entries.has(address.nodeId)
    && addressedPoint(submitted, address) && changedExegeticalPoint(submitted, local, address.nodeId) === 'title') ?? false;
}

export const UNREADABLE_EXEGETICAL_PROOF = 'unreadable-exegetical-proof';

function pendingPointBranch(checkpoint: SessionCheckpoint, address: UnreadableExegeticalProof): UnreadableExegeticalProof {
  if (!address.pendingAddition || address.kind !== 'title') return address;
  const opening = exegeticalPlan(checkpoint.confirmed.value?.preparation);
  const live = exegeticalPlan((checkpoint.remoteCandidate ?? checkpoint.confirmed).value?.preparation);
  if (!opening || !live || opening.points.entries.has(address.nodeId) || live.points.entries.has(address.nodeId)) return address;
  // Restore the shallowest missing ancestor only when it was absent from the opening too.
  // An already saved and later removed parent is a different user action.
  const index = address.ancestors.findIndex(id => !opening.points.entries.has(id) && !live.points.entries.has(id));
  if (index < 0) return address;
  return { ...address, nodeId: address.ancestors[index], ancestors: address.ancestors.slice(0, index) };
}

export function unreadableExegeticalChoice(checkpoint: SessionCheckpoint, original: UnreadableExegeticalProof) {
  const address = pendingPointBranch(checkpoint, original);
  const { confirmed, draft, remoteCandidate } = checkpoint;
  if (confirmed.resource.collection !== 'sermons' || address.generation !== confirmed.metadata?.generation) return;
  const opening = exegeticalPlan(confirmed.value?.preparation), local = exegeticalPlan(draft?.preparation);
  const stored = remoteCandidate ?? confirmed;
  const live = exegeticalPlan(stored.value?.preparation);
  if (!opening || !local) return;
  const { nodeId, ancestors, kind } = address;
  const before = exegeticalPointVersion(opening, nodeId), mine = exegeticalPointVersion(local, nodeId);
  const saved = live ? exegeticalPointVersion(live, nodeId) : null;
  const pendingAddition = Boolean(address.pendingAddition && kind === 'title' && !before);
  const movedScope = nodeId !== original.nodeId;
  const reviewedNode = movedScope ? exegeticalPointVersion(local, original.nodeId) : mine;
  if (movedScope && !equalValues(reviewedNode?.ancestors, original.ancestors)) return;
  if ((!before && !pendingAddition) || (before && !equalValues(before.ancestors, ancestors))
    || (kind === 'remove' ? mine : !mine || !equalValues(mine.ancestors, ancestors))) return;
  const apply = (value: DocumentData, side: 'opening' | 'mine'): DocumentData | undefined => {
    const tree = exegeticalPlan(value.preparation);
    if (!tree) return;
    const selected = side === 'opening' ? before : pendingAddition && mine
      ? { ...mine, point: rawExegeticalBranch(local, mine) } : mine;
    const mode = kind === 'title' && !pendingAddition ? 'title' : 'branch';
    const preparation = projectExegeticalPoint(value.preparation, tree, nodeId, ancestors, selected, mode);
    return preparation && writeField(value, ['preparation'], preparation);
  };
  const sameBranch = saved && equalValues(saved.ancestors, ancestors);
  const canChooseLocal = live && (pendingAddition ? !saved && projectExegeticalPoint(stored.value?.preparation, live, nodeId, ancestors, mine)
    : kind === 'title' ? sameBranch
    : (!saved || (sameBranch && equalValues(saved.point.children, before?.point.children)))
      && ancestors.every(id => live.points.entries.has(id)));
  const localAvailable = Boolean(stored.metadata?.generation === address.generation && live && canChooseLocal);
  const conflict = { ...exegeticalPointConflict(nodeId, before, mine, saved), code: UNREADABLE_EXEGETICAL_PROOF };
  const descendantTitles = pendingAddition && mine && mine.point.children
    ? [...(exegeticalPlan({ exegeticalPlan: [mine.point] })?.points.entries.values() ?? [])]
      .filter(point => point.parent !== null).flatMap(point => typeof point.fields.title === 'string' ? [point.fields.title] : [])
    : [];
  return { conflict, localAvailable, pendingAddition, descendantTitles, apply,
    reviewedTogether: (reviewed: typeof conflict) => kind === 'title' && !pendingAddition
      ? (reviewed.mine.value as DocumentData)?.title === mine?.point.title : equalValues(reviewed.mine, conflict.mine) };
}

export function canRebaseRefusedPointTail(before: DocumentData | null, draft: DocumentData | null, projected: SessionCheckpoint): boolean {
  if (!before || !draft || !projected.unreadableExegeticalProofs?.length) return false;
  let opening = before;
  let local = draft;
  let projectedTail = projected.draft;
  for (const address of projected.unreadableExegeticalProofs) {
    const choice = unreadableExegeticalChoice(projected, address);
    const neutralOpening = choice?.apply(opening, 'opening');
    const neutralLocal = choice?.apply(local, 'opening');
    const neutralProjected = projectedTail && choice?.apply(projectedTail, 'opening');
    if (!neutralOpening || !neutralLocal || !neutralProjected) return false;
    opening = neutralOpening;
    local = neutralLocal;
    projectedTail = neutralProjected;
  }
  // A deleted pending point can appear as a whole-plan merge conflict. Set aside the points
  // already shown for review to test whether any other later words still require a decision.
  const saved = projected.confirmed.value;
  if (!saved || !projectedTail) return false;
  const merged = mergeDocumentFields(opening, local, saved);
  // A choice about the shown points cannot carry independent later words.
  return !merged.conflicts.length && equalValues(merged.value.value, saved) && equalValues(projectedTail, saved);
}

function titleOnDocument(data: DocumentData, id: string, version: ExegeticalPointVersion): DocumentData | undefined {
  const plan = exegeticalPlan(data.preparation);
  const preparation = plan && projectExegeticalPoint(data.preparation, plan, id, version.ancestors, version, 'title');
  return preparation && writeField(data, ['preparation'], preparation);
}

function sameExegeticalPoint(first: ExegeticalPointVersion, second: ExegeticalPointVersion): boolean {
  return equalValues([first.point, first.ancestors], [second.point, second.ancestors]);
}

/** Recover a separately captured title over its own opening, outside the choice about the refused point. */
export function separateRefusedPointTitle(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const { confirmed, draft } = source;
  const saved = projected.confirmed.value;
  const before = source.pending[chain[0]?.id]?.value;
  const opening = exegeticalPlan(confirmed.value?.preparation);
  const submitted = exegeticalPlan(before?.preparation);
  const local = exegeticalPlan(draft?.preparation);
  const live = exegeticalPlan(saved?.preparation);
  if (!confirmed.metadata || !confirmed.value || !before || !draft || !projected.draft || !opening || !submitted || !local || !live) return undefined;
  const comparedIds = new Set(projected.unreadableExegeticalProofs?.map(address => address.nodeId));
  const others = [...opening.points.entries.keys()].filter(id => !comparedIds.has(id)
    && changedExegeticalPoint(submitted, local, id) === 'title');
  if (others.length !== 1) return undefined;
  const [id] = others;
  const original = exegeticalPointVersion(opening, id);
  const start = exegeticalPointVersion(submitted, id);
  const mine = exegeticalPointVersion(local, id);
  const stored = exegeticalPointVersion(live, id);
  if (!original || !start || !mine || !stored || !sameExegeticalPoint(original, start)) return undefined;

  const latest = exegeticalPlan(chain.at(-1)?.value?.preparation);
  const captured = latest && exegeticalPointVersion(latest, id);
  if (!captured || !sameExegeticalPoint(mine, captured)) return undefined;
  const pointDraft = titleOnDocument(confirmed.value, id, mine);
  const cleanBefore = titleOnDocument(before, id, stored);
  const cleanLocal = titleOnDocument(draft, id, stored);
  const cleanDraft = titleOnDocument(projected.draft, id, stored);
  if (!pointDraft || !cleanBefore || !cleanLocal || !cleanDraft) return undefined;
  const checkpoint = { ...projected, draft: cleanDraft };
  if (!canRebaseRefusedPointTail(cleanBefore, cleanLocal, checkpoint)) return undefined;

  const lastEdit = chain.findLast((request, index) => {
    if (!index) return false;
    const previous = exegeticalPlan(chain[index - 1].value?.preparation);
    const next = exegeticalPlan(request.value?.preparation);
    return previous && next && changedExegeticalPoint(previous, next, id) === 'title';
  });
  if (!lastEdit) return undefined;
  const address = { nodeId: id, kind: 'title' as const, generation: confirmed.metadata.generation, ancestors: original.ancestors };
  const capturedStamp = lastEdit.exegeticalPlanActions?.find(action => action.nodeId === id);
  const staged = source.exegeticalPointDrafts?.find(action => action.nodeId === id);
  const stamp = staged ?? capturedStamp;
  const openingRevision = lastEdit.baseline.metadata?.revision;
  const capturedOpening = exegeticalPlan(lastEdit.baseline.value?.preparation);
  const capturedPoint = capturedOpening && exegeticalPointVersion(capturedOpening, id);
  const time = stamp?.time === null ? null : stamp && boundedActionTime(stamp.time);
  const proof = stamp?.kind === 'title' && stamp.observedRevision === openingRevision && openingRevision === confirmed.metadata.revision
    && !stamp.predecessorOperationId && time !== undefined && capturedPoint && sameExegeticalPoint(original, capturedPoint)
    && (!staged || staged.generation === address.generation && matchesResult(local, staged))
    ? { ...address, observedRevision: stamp.observedRevision, title: mine.point.title as string, time } : undefined;
  if (stamp && !proof) return undefined;
  const continuation: SessionCheckpoint = {
    confirmed, draft: pointDraft, editGeneration: source.editGeneration, dirty: true, pending: {}, conflicts: [], remoteCandidate: null,
    ...(proof ? { exegeticalPointDrafts: [proof] } : { unreadableExegeticalProofs: [address] }),
  };
  return { id, checkpoint, continuation };
}

export function readUnreadableExegeticalChoice(checkpoint: SessionCheckpoint, nodeId: string) {
  for (const address of checkpoint.unreadableExegeticalProofs ?? []) {
    const choice = unreadableExegeticalChoice(checkpoint, address);
    if (choice?.conflict.path.at(-1) === 'id:' + nodeId) return choice;
  }
  return undefined;
}

export function stageExegeticalPoint(checkpoint: SessionCheckpoint, next: DocumentData | null, shown: ShownCopy | undefined,
  stamp: ExegeticalPointEditStamp | undefined): Draft[] | undefined {
  const { metadata, resource } = checkpoint.confirmed;
  if (resource.collection !== 'sermons' || !metadata || metadata.deleted || (!stamp && !checkpoint.exegeticalPointDrafts)) return undefined;
  const plan = exegeticalPlan(next?.preparation);
  if (!plan) return undefined;
  const previous = checkpoint.exegeticalPointDrafts?.filter(action => action.generation === metadata.generation && matchesResult(plan, action)) ?? [];
  if (!stamp || !boundedRowId(stamp.nodeId)) return previous.length ? previous : undefined;
  const opening = exegeticalPlan(checkpoint.draft?.preparation);
  const time = stamp.time === null ? null : boundedActionTime(stamp.time);
  if (!opening || time === undefined || changedExegeticalPoint(opening, plan, stamp.nodeId) !== stamp.intent) return previous.length ? previous : undefined;
  const basis = shown?.confirmed.metadata?.generation === metadata.generation && shown.editGeneration === checkpoint.editGeneration
    ? shown.confirmed.metadata : metadata;
  const point = exegeticalPointVersion(opening, stamp.nodeId)!;
  const title = exegeticalPointVersion(plan, stamp.nodeId)?.point.title;
  const action = { nodeId: stamp.nodeId, kind: stamp.intent, observedRevision: basis.revision, time, generation: metadata.generation,
    title: typeof title === 'string' ? title : null, ancestors: point.ancestors,
    ...(stamp.intent === 'remove' && { removedPointId: point.point.id as string }) };
  return [action, ...previous.filter(item => item.nodeId !== stamp.nodeId)].slice(0, LIMIT);
}

function capturedPointPredecessor(baseline: ResourceSnapshot, nodeId: string, opening: NonNullable<ReturnType<typeof exegeticalPlan>>,
  predecessor: CommitRequest | undefined, requests: ReadonlyMap<string, CommitRequest>) {
  const shown = exegeticalPointVersion(opening, nodeId);
  const visited = new Set<string>();
  for (let request = predecessor; request && !visited.has(request.id); request = requests.get(request.predecessor ?? '')) {
    const tree = exegeticalPlan(request.value?.preparation);
    const point = tree && exegeticalPointVersion(tree, nodeId);
    if (!point || !shown || !equalValues([point.point, point.ancestors], [shown.point, shown.ancestors])
      || request.owner !== predecessor?.owner || !equalValues(request.baseline.resource, baseline.resource)
      || request.baseline.metadata?.generation !== baseline.metadata?.generation
      || ['cancelled', 'refused', 'conflict'].includes(request.state)) return undefined;
    if (request.exegeticalPlanActions?.some(action => action.nodeId === nodeId && action.kind === 'title')) {
      return request.command?.operationId ?? request.id;
    }
    visited.add(request.id);
  }
  return undefined;
}

export function captureExegeticalPointActions(checkpoint: SessionCheckpoint, baseline: ResourceSnapshot,
  predecessor: CommitRequest | undefined, records: readonly CommitRequest[]): ExegeticalPointStamp[] | undefined {
  if (!checkpoint.exegeticalPointDrafts?.length || !baseline.metadata || baseline.metadata.deleted) return undefined;
  const opening = exegeticalPlan((predecessor ? predecessor.value : baseline.value)?.preparation), next = exegeticalPlan(checkpoint.draft?.preparation);
  if (!opening || !next) return undefined;
  const requests = new Map(records.map(record => [record.id, record]));
  const actions = checkpoint.exegeticalPointDrafts.flatMap((action): ExegeticalPointStamp[] => {
    if (action.generation !== baseline.metadata?.generation || action.observedRevision > baseline.metadata.revision
      || !matchesResult(next, action) || changedExegeticalPoint(opening, next, action.nodeId) !== action.kind) return [];
    const predecessorOperationId = capturedPointPredecessor(baseline, action.nodeId, opening, predecessor, requests);
    return [{ nodeId: action.nodeId, kind: action.kind, observedRevision: action.observedRevision, time: action.time,
      ...(predecessorOperationId && { predecessorOperationId }) }];
  });
  return actions.length ? actions : undefined;
}

export function matchingExegeticalPointActions(changes: readonly FieldChange[], actions: ExegeticalPointStamp[] | undefined) {
  if (!actions?.length) return undefined;
  const plan = exegeticalPlanChange(changes);
  const matching = plan && actions.filter(action => changedExegeticalPoint(plan.opening, plan.local, action.nodeId) === action.kind);
  return matching?.length ? matching : undefined;
}

export type ExegeticalQueueBasis = { nodeId: string; version: ExegeticalPointVersion };

export function restoreExegeticalQueueBasis(snapshot: ResourceSnapshot, basis: ExegeticalQueueBasis): ResourceSnapshot {
  const data = snapshot.value;
  const plan = exegeticalPlan(data?.preparation);
  const projected = plan && projectExegeticalPoint(data?.preparation, plan, basis.nodeId, basis.version.ancestors, basis.version);
  return data && projected ? { ...snapshot, value: writeField(data, ['preparation'], projected) } : snapshot;
}

/** Merge the other changes, then put the chosen branch back at its surviving anchors. */
export function mergeExegeticalPointChoice(ancestor: DocumentData | null, local: DocumentData | null, stored: DocumentData | null,
  ids: readonly string[]) {
  if (!ids.length || !ancestor || !local || !stored) return undefined;
  const opening = exegeticalPlan(ancestor.preparation), mine = exegeticalPlan(local.preparation), live = exegeticalPlan(stored.preparation);
  if (!opening || !mine || !live) return undefined;
  const contested = ids.flatMap(id => {
    const choice = readExegeticalPointChoice(opening, mine, live, id);
    return choice ? [{ id, ...choice }] : [];
  });
  if (contested.length !== 1) return undefined;
  const [{ id, before, mine: intended, saved }] = contested;
  const neutralOpening = projectExegeticalPoint(ancestor.preparation, opening, id, before.ancestors, saved);
  const neutralLocal = projectExegeticalPoint(local.preparation, mine, id, before.ancestors, saved);
  if (!neutralOpening || !neutralLocal) return undefined;
  const merged = mergeDocumentFields(writeField(ancestor, ['preparation'], neutralOpening), writeField(local, ['preparation'], neutralLocal), stored);
  const combined = merged.value.value as DocumentData | undefined;
  const combinedPlan = exegeticalPlan(combined?.preparation);
  if (!combined || !combinedPlan) return undefined;
  const projected = projectExegeticalPoint(combined.preparation, combinedPlan, id, before.ancestors, intended);
  const working = projectExegeticalPoint(stored.preparation, live, id, before.ancestors, before);
  if (!projected || !working) return undefined;
  const basis: ExegeticalQueueBasis = { nodeId: id, version: before };
  return { basis, rebased: { ...merged, value: { exists: true, value: writeField(combined, ['preparation'], projected) } } };
}

/** Hold the authored point over a preceding ACK; the server still owns the time comparison. */
export function rebaseQueuedExegeticalPoint(ancestor: DocumentData | null, local: DocumentData | null, stored: DocumentData | null,
  actions: readonly ExegeticalPointStamp[] | undefined) {
  if (!actions?.length) return undefined;
  const result = mergeExegeticalPointChoice(ancestor, local, stored, actions.map(action => action.nodeId));
  return result?.rebased.conflicts.length === 0 ? result : undefined;
}
