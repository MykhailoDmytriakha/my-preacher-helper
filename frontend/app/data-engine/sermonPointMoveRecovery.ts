import { outlinePointOrder, SECTION_KEYS } from '@/utils/outlineDnd';
import { mergeOutlineOrder } from '@/utils/outlineMergeParts';

import { equalValues, object } from './fieldValues';
import { replaceResourceOutline } from './outlinePlacementResource';
import { mergeDocumentFields } from './protocol';
import { placementSteps } from './serviceOrderStepPlacement';
import { UNREADABLE_OUTLINE_POINT_POSITION } from './unreadableDraftProof';

import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, Json } from './types';
import type { SermonOutline } from '@/models/models';
import type { OutlinePointOrder } from '@/utils/outlineDnd';

function readOutline(value: unknown): SermonOutline | undefined {
  if (!object(value) || !SECTION_KEYS.every(section => placementSteps(value[section] ?? []))) return undefined;
  const outline = value as unknown as SermonOutline;
  const ids = SECTION_KEYS.flatMap(section => (outline[section] ?? []).map(point => point.id));
  return new Set(ids).size === ids.length ? outline : undefined;
}

export function readRootPointOrder(value: unknown): OutlinePointOrder | undefined {
  const outline = readOutline(value);
  return outline && outlinePointOrder(outline);
}

export function retainedRootOrderChanged(before: OutlinePointOrder, after: OutlinePointOrder): boolean {
  const previous = new Set(SECTION_KEYS.flatMap(section => before[section].map(point => point.id)));
  const current = new Set(SECTION_KEYS.flatMap(section => after[section].map(point => point.id)));
  return SECTION_KEYS.some(section => !equalValues(before[section].filter(point => current.has(point.id)),
    after[section].filter(point => previous.has(point.id))));
}

export function unreadableOutlinePointPosition(opening: DocumentData | null, draft: DocumentData | null, stored: DocumentData | null): ConflictDetail | undefined {
  const base = readRootPointOrder(opening?.outline), local = readRootPointOrder(draft?.outline), saved = readRootPointOrder(stored?.outline);
  if (!base || !local || (!retainedRootOrderChanged(base, local) && (!saved || !retainedRootOrderChanged(saved, local)))) return undefined;
  const value = (order: OutlinePointOrder) => ({ exists: true as const, value: order as Json });
  return { path: ['outline', 'position'], base: value(base), mine: value(local),
    theirs: saved ? value(saved) : { exists: false }, code: UNREADABLE_OUTLINE_POINT_POSITION };
}

/** Restore the rooted points' previous positions. New roots and nested edits keep their own contents. */
function keepSavedRootPositions(opening: SermonOutline, draft: SermonOutline): SermonOutline {
  const known = new Set(SECTION_KEYS.flatMap(section => (opening[section] ?? []).map(point => point.id)));
  const rows = new Map(SECTION_KEYS.flatMap(section => (draft[section] ?? []).map(point => [point.id, point] as const)));
  const restored = { ...draft };
  for (const section of SECTION_KEYS) {
    const current = (draft[section] ?? []).map(point => point.id);
    const retained = (opening[section] ?? []).map(point => point.id).filter(id => rows.has(id));
    const wanted = new Set([...retained, ...current.filter(id => !known.has(id))]);
    restored[section] = mergeOutlineOrder(null, retained, current, wanted).map(id => rows.get(id)!);
  }
  return restored;
}

export function hasPrivateSermonPointMove(checkpoint: SessionCheckpoint): boolean {
  return checkpoint.confirmed.resource.collection === 'sermons' && !Object.keys(checkpoint.pending).length
    && Boolean(checkpoint.outlinePointPlacementRetry || checkpoint.unreadableOutlinePointPlacement);
}

export function readSermonPointMoveRecovery(checkpoint: SessionCheckpoint) {
  if (!hasPrivateSermonPointMove(checkpoint)) return undefined;
  const { confirmed, draft, conflicts, remoteCandidate, outlinePointPlacementRetry } = checkpoint;
  const target = remoteCandidate ?? confirmed;
  const canUseStored = Boolean(target.value && !target.metadata?.deleted
    && target.metadata?.generation === confirmed.metadata?.generation);
  return {
    identity: JSON.stringify([outlinePointPlacementRetry, draft?.outline, target.metadata, target.value?.outline]),
    mine: readOutline(draft?.outline) ?? null,
    stored: readOutline(target.value?.outline) ?? null,
    canSave: canUseStored && Boolean(outlinePointPlacementRetry && !remoteCandidate && !conflicts.length),
    canUseStored,
  };
}

export function storedSermonPointOrderChoice(checkpoint: SessionCheckpoint, shown: DocumentData | null | undefined) {
  if (!hasPrivateSermonPointMove(checkpoint)) return undefined;
  const { confirmed, draft } = checkpoint;
  const target = checkpoint.remoteCandidate ?? confirmed;
  const base = readOutline(confirmed.value?.outline), local = readOutline(draft?.outline);
  if (!draft || !base || !local || !target.value || target.metadata?.deleted
    || target.metadata?.generation !== confirmed.metadata?.generation
    || !equalValues(outlinePointOrder(local), readRootPointOrder((shown ?? draft).outline))) {
    throw Object.assign(new Error('The outline changed before this choice'), { code: 'decision-changed' });
  }
  const neutral = replaceResourceOutline('sermons', draft, keepSavedRootPositions(base, local));
  const merged = mergeDocumentFields(confirmed.value, neutral, target.value);
  return { target, draft: merged.value.exists ? merged.value.value as DocumentData : null, conflicts: merged.conflicts };
}
