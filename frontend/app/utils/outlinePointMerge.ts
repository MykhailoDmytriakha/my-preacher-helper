import { normalizeOutlineFields } from '@/utils/outlineMergeParts';
import { sortSubPointsByPosition } from '@/utils/subPoints';

import type { ConflictDetail, FieldValue } from '@/data-engine/types';
import type { OutlinePoint, SubPoint } from '@/models/models';

type FieldMerger = (base: FieldValue, mine: FieldValue, theirs: FieldValue) => {
  value: FieldValue; conflicts: ConflictDetail[];
};

/** Numeric positions describe visible sibling order, not an independently authored word. */
function readableSubpoints(point: OutlinePoint): boolean {
  const subs = point.subPoints ?? [];
  return subs.every(sub => typeof sub.id === 'string' && sub.id.length > 0 && Number.isFinite(sub.position))
    && new Set(subs.map(sub => sub.id)).size === subs.length;
}

function field(point: OutlinePoint): FieldValue {
  return {
    exists: true,
    value: JSON.parse(JSON.stringify({
      ...normalizeOutlineFields(point),
      subPoints: sortSubPointsByPosition(point.subPoints).map(sub => {
        const { position: _position, ...words } = normalizeOutlineFields(sub);
        return words;
      }),
    })),
  };
}

/**
 * Merge compatible point content and visible sibling order through the established field merger.
 * Global ownership still belongs to mergeOutline; ambiguous lists and actual collisions return
 * no candidate, so callers retain their ordinary complete-copy review instead of guessing.
 */
export function mergeOutlinePointParts(base: OutlinePoint, mine: OutlinePoint, theirs: OutlinePoint,
  merge: FieldMerger): OutlinePoint | null {
  if (![base, mine, theirs].every(readableSubpoints)) return null;
  const result = merge(field(base), field(mine), field(theirs));
  if (result.conflicts.length || !result.value.exists) return null;
  const point = result.value.value as unknown as OutlinePoint;
  const local = new Map((mine.subPoints ?? []).map(sub => [sub.id, sub.position]));
  const remote = new Map((theirs.subPoints ?? []).map(sub => [sub.id, sub.position]));
  const subs = point.subPoints ?? [];
  const positions = subs.map(sub => local.get(sub.id) ?? remote.get(sub.id));
  if (positions.some(position => position === undefined || !Number.isFinite(position))) return null;
  // Preserve existing positions when they already express the merged order. Independent additions
  // can share a position, and a remote reorder can use a different scale: assign one increasing
  // sequence only in those cases so the reader's numeric sort cannot scramble the merged list.
  const ordered = positions.every((position, index) => index === 0 || position! > positions[index - 1]!);
  return { ...point, subPoints: subs.map((sub, index): SubPoint => ({
    ...sub, position: ordered ? positions[index]! : index + 1,
  })) };
}
