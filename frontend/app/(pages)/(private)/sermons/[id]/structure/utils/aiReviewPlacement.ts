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

/** The saved card's words are independent of the placement shown in a proposal. */
export function capturedReviewChanges(before: Board, after: Board) {
  const previous = new Map(Object.entries(before).flatMap(([section, items]) =>
    items.map(item => [item.id, { section, item }] as const)));
  const words = new Map<string, Item>();
  const placements: string[] = [];
  for (const [section, items] of Object.entries(after)) {
    for (const item of items) {
      const old = previous.get(item.id);
      if (!old || old.section !== section
        || (old.item.outlinePointId ?? null) !== (item.outlinePointId ?? null)
        || (old.item.subPointId ?? null) !== (item.subPointId ?? null)) {
        placements.push(item.id);
      } else if (old.item.content !== item.content || JSON.stringify(old.item.customTagNames) !== JSON.stringify(item.customTagNames)) {
        words.set(item.id, item);
      }
    }
  }
  return { words, placements };
}

export function reflectCapturedReviewChanges(board: Board, captured: Board, changes: ReturnType<typeof capturedReviewChanges>): Board {
  const painted = changes.words.size ? Object.fromEntries(Object.entries(board).map(([section, items]) => [section, items.map(item => {
    const updated = changes.words.get(item.id);
    return updated ? { ...item, content: updated.content, customTagNames: updated.customTagNames } : item;
  })])) : board;
  return changes.placements.length ? advanceReviewBaseline(painted, captured, changes.placements) : painted;
}
