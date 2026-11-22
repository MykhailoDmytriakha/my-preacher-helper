import { readPlanText } from '@/utils/planTextStorage';

import { equalValues, object, own, readField, writeField } from './fieldValues';
import { mergeDocumentFields } from './protocol';
import { sermonTextKey } from './sermonTextOpenings';

import type { SermonTextOpenings } from './sermonTextOpenings';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, EngineMetadata, ResourceSnapshot } from './types';
import type { Sermon } from '@/models/models';

type PlanCellVersion = { generation: string; observedRevision: number }
  | { generation: null; observedRevision: null; legacyBirth?: string };

export type PlanCellOpening = PlanCellVersion & {
  sermonId: string;
  nodeId: string;
  text: string;
};

export type PlanCellDraft = PlanCellVersion & {
  opening: string;
  text: string;
};

const field = (value: string) => ({ exists: true, value } as const);
const pathFor = (nodeId: string) => ['planText', nodeId];
const cellText = (value: DocumentData | null, key: string) => {
  const displayed = readPlanText(value as unknown as Sermon | null);
  return own(displayed, key) ? displayed[key] : '';
};

function legacyPlanBirth(value: DocumentData | null): string | undefined {
  const birth = value?.createdAt;
  return typeof birth === 'string' && birth.length ? birth : undefined;
}

function matchesPlanCellVersion(snapshot: ResourceSnapshot, version: PlanCellVersion): boolean {
  const { metadata, value } = snapshot;
  if (!value || metadata?.deleted) return false;
  const birth = legacyPlanBirth(value);
  if (version.generation === null) return metadata ? Boolean(birth && version.legacyBirth === birth) : version.legacyBirth === birth;
  return metadata?.generation === version.generation && Number.isSafeInteger(version.observedRevision)
    && version.observedRevision > 0 && version.observedRevision <= metadata.revision;
}

export function planCellOpening(checkpoint: SessionCheckpoint | undefined, nodeId: string, text: string): PlanCellOpening | undefined {
  if (!checkpoint?.draft) return;
  const { confirmed, draft } = checkpoint;
  const metadata = confirmed.metadata;
  if (confirmed.resource.collection !== 'sermons' || !confirmed.value || metadata?.deleted || cellText(draft, nodeId) !== text) return;
  const cell = { sermonId: confirmed.resource.id, nodeId, text };
  const birth = legacyPlanBirth(confirmed.value);
  return metadata ? { ...cell, generation: metadata.generation, observedRevision: metadata.revision }
    : { ...cell, generation: null, observedRevision: null, ...(birth && { legacyBirth: birth }) };
}

function latestLocalPlanSave(checkpoint: SessionCheckpoint): DocumentData | null | undefined {
  return Object.values(checkpoint.pending).reduce<SessionCheckpoint['pending'][string] | undefined>((latest, item) =>
    !latest || item.generation > latest.generation ? item : latest, undefined)?.value;
}

export function stagePlanCell(checkpoint: SessionCheckpoint, seen: PlanCellOpening, text: string) {
  const { confirmed, draft, remoteCandidate } = checkpoint;
  const { sermonId, nodeId, text: opening, ...version } = seen;
  if (confirmed.resource.collection !== 'sermons' || confirmed.resource.id !== sermonId
    || !draft || !matchesPlanCellVersion(confirmed, version)) {
    throw Object.assign(new Error('The opening of this plan cell changed'), { code: 'decision-changed' });
  }

  const closest = checkpoint.planCellDrafts?.[nodeId];
  const continuation = closest && matchesPlanCellVersion(confirmed, closest) && closest.text === opening;
  const proof: PlanCellDraft = continuation ? { ...closest, text } : { ...version, opening, text };
  const path = pathFor(nodeId);
  const basis = confirmed.value && cellText(confirmed.value, nodeId) === text
    ? readField(confirmed.value, path) : field(text);
  const latest = remoteCandidate && matchesPlanCellVersion(remoteCandidate, proof) ? remoteCandidate : confirmed;
  const pending = latestLocalPlanSave(checkpoint);
  const pendingOpening = pending && cellText(pending, nodeId) === proof.opening && equalValues(latest, confirmed);
  const conflict = pendingOpening ? undefined : planCellConflict(nodeId, proof, latest);
  const others = checkpoint.conflicts.filter(conflict => !equalValues(conflict.path, path));

  return {
    draft: writeField(draft, path, basis),
    proofs: { ...checkpoint.planCellDrafts, [nodeId]: proof },
    conflicts: conflict ? [...others, conflict] : others,
    remoteCandidate: conflict ? latest : others.length || !equalValues(remoteCandidate, confirmed) ? remoteCandidate : null,
  };
}

function planCellConflict(nodeId: string, proof: PlanCellDraft, saved: ResourceSnapshot): ConflictDetail | undefined {
  if (!matchesPlanCellVersion(saved, proof)
    || (proof.observedRevision !== null && (saved.metadata?.revision ?? 0) <= proof.observedRevision)) return;
  const stored = cellText(saved.value, nodeId);
  if (stored === proof.opening || stored === proof.text) return;
  return { path: pathFor(nodeId), base: field(proof.opening), mine: field(proof.text), theirs: field(stored) };
}

/** A remote version arriving after typing updates only comparisons of the cells it actually changed. */
export function reviewObservedPlanCells(checkpoint: SessionCheckpoint, saved: ResourceSnapshot): ConflictDetail[] {
  if (!checkpoint.planCellDrafts || Object.keys(checkpoint.pending).length) return checkpoint.conflicts;
  const reviewed = Object.entries(checkpoint.planCellDrafts).flatMap(([nodeId, proof]) => planCellConflict(nodeId, proof, saved) ?? []);
  const owned = Object.keys(checkpoint.planCellDrafts);
  const other = checkpoint.conflicts.filter(({ path }) => !(path[0] === 'planText' && path.length === 2 && owned.includes(path[1])));
  return [...other, ...reviewed];
}

/** A receipt for a different cell does not answer a comparison already on this screen. */
export function preservePlanCellComparisons(checkpoint: SessionCheckpoint, incoming: ConflictDetail[]): ConflictDetail[] {
  if (!checkpoint.planCellDrafts || !checkpoint.conflicts.length) return incoming;
  const retained = checkpoint.conflicts.flatMap(({ path }) => {
    const proof = path[0] === 'planText' && path.length === 2 ? checkpoint.planCellDrafts?.[path[1]] : undefined;
    return proof ? planCellConflict(path[1], proof, checkpoint.confirmed) ?? [] : [];
  });
  return [...incoming.filter(({ path }) => !retained.some(comparison => equalValues(comparison.path, path))), ...retained];
}

/** Keeping the local side explicitly answers only the compared cells. */
export function acceptPlanCellComparison(checkpoint: SessionCheckpoint): void {
  const { confirmed, planCellDrafts } = checkpoint;
  const metadata = confirmed.metadata;
  if (!planCellDrafts || !metadata || metadata.deleted) return;
  for (const { path } of checkpoint.conflicts) {
    if (path[0] !== 'planText' || path.length !== 2 || !own(planCellDrafts, path[1])) continue;
    const proof = planCellDrafts[path[1]];
    planCellDrafts[path[1]] = { generation: metadata.generation, observedRevision: metadata.revision,
      opening: cellText(confirmed.value, path[1]), text: proof.text };
  }
}

/** Taking the stored side settles the compared cells while leaving other typed words staged. */
export function projectStoredPlanCellChoice(checkpoint: SessionCheckpoint, atChoice?: DocumentData | null) {
  const { confirmed, remoteCandidate, draft, planCellDrafts, conflicts } = checkpoint;
  if (!confirmed.value || !remoteCandidate?.value || !draft || !planCellDrafts || !conflicts.length
    || conflicts.some(({ path }) => path[0] !== 'planText' || path.length !== 2 || !own(planCellDrafts, path[1]))) return;
  const shown = atChoice === undefined ? draft : atChoice;
  if (!shown || conflicts.some(({ path }) => !equalValues(readField(shown, path), readField(draft, path)))) {
    throw Object.assign(new Error('The compared plan text changed'), { code: 'decision-changed' });
  }
  const baseline = confirmed.value;
  const retained = conflicts.reduce((value, { path }) => writeField(value, path, readField(baseline, path)), draft);
  const merged = mergeDocumentFields(baseline, retained, remoteCandidate.value);
  return { confirmed: remoteCandidate, draft: merged.value.value as DocumentData, conflicts: merged.conflicts };
}

/** A receipt for this editor's first write can identify an old sermon even without a creation date. */
export function adoptFirstPlanCellVersion(checkpoint: SessionCheckpoint, accepted: ResourceSnapshot,
  effect: EngineMetadata | null, operationId: string, submitted: DocumentData | null): void {
  const { confirmed, planCellDrafts } = checkpoint;
  if (!planCellDrafts || confirmed.metadata || !effect || effect.generation !== operationId || effect.deleted
    || effect.generation !== accepted.metadata?.generation || !submitted) return;
  for (const [nodeId, proof] of Object.entries(planCellDrafts)) {
    if (!matchesPlanCellVersion(confirmed, proof)) continue;
    planCellDrafts[nodeId] = { generation: effect.generation, observedRevision: effect.revision,
      opening: cellText(submitted, nodeId), text: proof.text };
  }
}

export function retainPlanCellDrafts(checkpoint: SessionCheckpoint, draft: DocumentData | null) {
  if (!checkpoint.planCellDrafts) return;
  const { confirmed } = checkpoint;
  const pending = latestLocalPlanSave(checkpoint);
  const entries = Object.entries(checkpoint.planCellDrafts).filter(([nodeId, proof]) =>
    matchesPlanCellVersion(confirmed, proof) && draft && cellText(draft, nodeId) === proof.text
    && (cellText(confirmed.value, nodeId) !== proof.text || (pending && cellText(pending, nodeId) !== proof.text)));
  if (entries.length) checkpoint.planCellDrafts = Object.fromEntries(entries);
  else delete checkpoint.planCellDrafts;
}

/** Carry the displayed per-cell revision into the existing sermon text protocol. */
export function capturePlanCellOpenings(checkpoint: SessionCheckpoint): SermonTextOpenings | undefined {
  const { confirmed, draft, planCellDrafts } = checkpoint;
  const metadata = confirmed.metadata;
  if (confirmed.resource.collection !== 'sermons' || !metadata || !draft || !planCellDrafts) return;
  const captured = Object.entries(planCellDrafts).flatMap(([id, proof]) =>
    proof.generation !== null && proof.generation === metadata.generation && proof.observedRevision <= metadata.revision
    && readField(draft, pathFor(id)).value === proof.text ? [[sermonTextKey('planText', id), proof.observedRevision] as const] : []);
  return captured.length ? Object.fromEntries(captured) : undefined;
}

/** Build a selected Save from the previous submitted value, without copying private sibling drafts. */
export function selectPlanCellSave(checkpoint: SessionCheckpoint, ids: readonly string[], basis: DocumentData | null): SessionCheckpoint {
  const entries = Object.entries(checkpoint.planCellDrafts ?? {}).filter(([id]) => ids.includes(id));
  if (!basis || !checkpoint.draft) return { ...checkpoint, dirty: false, planCellDrafts: undefined };
  let draft = basis;
  for (const [id, proof] of entries) {
    if (cellText(basis, id) !== proof.text) draft = writeField(draft, pathFor(id), field(proof.text));
  }
  const conflicts = checkpoint.conflicts.filter(({ path }) => path[0] !== 'planText' || path.length !== 2
    || !checkpoint.planCellDrafts?.[path[1]] || ids.includes(path[1]));
  return { ...checkpoint, draft, conflicts, dirty: !equalValues(draft, basis), planCellDrafts: Object.fromEntries(entries) };
}

/** A save of the sermon can carry its submitted cells, but never another private cell. */
export function reservePrivatePlanCells(checkpoint: SessionCheckpoint, basis: DocumentData | null,
  included: readonly string[]): SessionCheckpoint {
  const { planCellDrafts } = checkpoint;
  if (!basis || !checkpoint.draft || !planCellDrafts) return checkpoint;
  let draft = checkpoint.draft;
  const captured = Object.entries(planCellDrafts).filter(([id]) => {
    if (included.includes(id)) return true;
    const path = pathFor(id);
    draft = writeField(draft, path, readField(basis, path));
    return false;
  });
  if (!own(basis, 'planText') && object(draft.planText) && !Object.keys(draft.planText).length) {
    draft = writeField(draft, ['planText'], { exists: false });
  }
  return { ...checkpoint, draft, dirty: !equalValues(draft, basis), planCellDrafts: Object.fromEntries(captured) };
}
