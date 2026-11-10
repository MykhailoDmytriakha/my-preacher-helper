import { projectServiceOrderStep, stepGap } from '@/utils/serviceOrderStepPlacement';

import type { ServiceOrderStepGap } from './types';
import type { SeriesItem } from '@/models/models';

export type SeriesReorderStep = { itemId: string; index: number };
export type SeriesReorderComparison = {
  seriesId: string;
  generation: string | null;
  revision: number;
  proposed: SeriesItem[];
  stored: SeriesItem[];
};

export function isSeriesReorderTrace(value: unknown, isIdentifier: (value: unknown) => boolean): value is SeriesReorderStep[] {
  return Array.isArray(value) && value.length > 0 && value.every(step => step && isIdentifier(step.itemId)
    && Number.isSafeInteger(step.index) && step.index >= 0);
}

/** Replay the exact dragged item, even when an adjacent swap has two equivalent permutations. */
export function replaySeriesReorder(opening: readonly string[], trace: readonly SeriesReorderStep[]): string[] | undefined {
  const ordered = [...opening];
  for (const { itemId, index } of trace) {
    const from = ordered.indexOf(itemId);
    if (from < 0 || from === index || index < 0 || index >= ordered.length) return undefined;
    ordered.splice(from, 1);
    ordered.splice(index, 0, itemId);
  }
  return ordered;
}

/** Only the final saved order matters. Ignore transient positions and as-yet unplaced subjects. */
export function seriesReorderGap(order: readonly string[], itemId: string, anchors: ReadonlySet<string>): ServiceOrderStepGap {
  const at = order.indexOf(itemId);
  return { previous: order.slice(0, at).filter(id => anchors.has(id)).at(-1) ?? null,
    next: order.slice(at + 1).find(id => anchors.has(id)) ?? null };
}

const rowIdentity = ({ type, refId }: SeriesItem) => JSON.stringify([type, refId]);

/** Retain current members and move only the subjects of the confirmed order. */
export function projectSeriesReorder(current: SeriesItem[], proposed: SeriesItem[], subjects: ReadonlySet<string>) {
  const order = proposed.map(row => row.id);
  const identities = new Map(current.map(row => [row.id, rowIdentity(row)]));
  const intended = new Map(proposed.map(row => [row.id, rowIdentity(row)]));
  const anchors = new Set(order.filter(id => !subjects.has(id)));
  const trace: SeriesReorderStep[] = [];
  let rows = current;
  for (const id of order.filter(id => subjects.has(id))) {
    const savedGap = stepGap(proposed, id)!;
    const gap = seriesReorderGap(order, id, anchors);
    if ([id, savedGap.previous, savedGap.next, gap.previous, gap.next].some(key => key !== null && intended.get(key) !== identities.get(key))) {
      return undefined;
    }
    const next = projectServiceOrderStep(rows, id, gap);
    if (!next) return undefined;
    if (next !== rows) trace.push({ itemId: id, index: next.findIndex(row => row.id === id) });
    rows = next;
    anchors.add(id);
  }
  return { rows, trace };
}

export function reviewedSeriesReorder(current: SeriesItem[], proposed: SeriesItem[], originalTrace: SeriesReorderStep[] | undefined) {
  if (originalTrace) return projectSeriesReorder(current, proposed, new Set(originalTrace.map(step => step.itemId)));
  // The old format had only a whole permutation. Review it only with the same membership.
  const identities = new Map(current.map(row => [row.id, rowIdentity(row)]));
  if (current.length !== proposed.length || proposed.some(row => identities.get(row.id) !== rowIdentity(row))) return undefined;
  const rows = [...current];
  const trace: SeriesReorderStep[] = [];
  for (const [index, row] of proposed.entries()) {
    const from = rows.findIndex(item => item.id === row.id);
    if (from === index) continue;
    rows.splice(index, 0, ...rows.splice(from, 1));
    trace.push({ itemId: row.id, index });
  }
  return { rows, trace };
}
