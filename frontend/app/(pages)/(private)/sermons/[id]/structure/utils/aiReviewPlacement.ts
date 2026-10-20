import { applyScopedThoughtPlacement, removeThoughtIdFromStructure } from '@/utils/thoughtOrdering';

import { buildStructureFromContainers } from './structure';

import type { Item } from '@/models/models';

type Board = Record<string, Item[]>;

/** Advance only a captured decision, retaining the original state of pending proposals. */
export function advanceReviewBaseline(baseline: Board, board: Board, thoughtIds: readonly string[]): Board {
  const selected = new Set(thoughtIds);
  const stored = { ...board, ...baseline };
  const proposed = buildStructureFromContainers(board);
  const alive = new Set(Object.values(proposed).flat());
  const retained = thoughtIds.reduce((placement, id) => alive.has(id) ? placement : removeThoughtIdFromStructure(placement, id), buildStructureFromContainers(stored));
  const placement = applyScopedThoughtPlacement(retained, proposed, thoughtIds);
  const known = new Map(Object.values(stored).flat().map(item => [item.id, item]));
  for (const item of Object.values(board).flat()) if (selected.has(item.id)) known.set(item.id, item);
  return Object.fromEntries(Object.keys(baseline).map(section => [section,
    (placement[section as keyof typeof placement] ?? []).flatMap(id => known.has(id) ? [known.get(id)!] : []),
  ]));
}
