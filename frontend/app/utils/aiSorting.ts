import { Item } from "@/models/models";

export const MAX_AI_SORT_ITEMS = 25;

export type AiSortDisabledReason =
  | "offline"
  | "sorting"
  | "review"
  | "tooMany"
  | "insufficientUnlocked";

export type OutlinePointAiSortState = {
  disabledReason: AiSortDisabledReason | null;
  totalCount: number;
  unlockedStableCount: number;
};

export const getOutlinePointAiSortState = ({
  items,
  outlinePointId,
  isOnline,
  isSorting,
  isDiffModeActive,
}: {
  items: Item[];
  outlinePointId: string;
  isOnline: boolean;
  isSorting: boolean;
  isDiffModeActive: boolean;
}): OutlinePointAiSortState => {
  const pointItems = items.filter((item) => item.outlinePointId === outlinePointId);
  const totalCount = pointItems.length;
  const unlockedStableCount = pointItems.filter(
    (item) => !item.isLocked,
  ).length;

  let disabledReason: AiSortDisabledReason | null = null;

  if (!isOnline) {
    disabledReason = "offline";
  } else if (isSorting) {
    disabledReason = "sorting";
  } else if (isDiffModeActive) {
    disabledReason = "review";
  } else if (totalCount > MAX_AI_SORT_ITEMS) {
    disabledReason = "tooMany";
  } else if (unlockedStableCount < 2) {
    disabledReason = "insufficientUnlocked";
  }

  return {
    disabledReason,
    totalCount,
    unlockedStableCount,
  };
};

export const hasLockedThoughtAnchorsPreserved = (
  originalItems: Item[],
  sortedItems: Item[],
): boolean => {
  if (originalItems.length !== sortedItems.length) {
    return false;
  }

  return originalItems.every((item, index) => {
    if (!item.isLocked) {
      return true;
    }

    return sortedItems[index]?.id === item.id;
  });
};

export const replaceScopedItemsInColumn = ({
  columnItems,
  scopedItemIds,
  sortedScopedItems,
}: {
  columnItems: Item[];
  scopedItemIds: string[];
  sortedScopedItems: Item[];
}): Item[] => {
  const scopedIds = new Set(scopedItemIds);
  let sortedIndex = 0;

  return columnItems.map((item) => {
    if (!scopedIds.has(item.id)) {
      return item;
    }

    const replacement = sortedScopedItems[sortedIndex];
    sortedIndex += 1;
    return replacement ?? item;
  });
};
