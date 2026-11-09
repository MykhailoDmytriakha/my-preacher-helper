import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { toast } from 'sonner';

import { useStructureWriter } from "@/components/sermon/structureWriter";
import { Item, SermonPoint, Thought, Sermon, ThoughtsBySection } from "@/models/models";
import { isOfflineQueuedError } from "@/services/conflictSafeUpdate.client";
import { sortItemsWithAI } from "@/services/sortAI.service";
import { isUsageCapReachedError } from "@/services/usageLimits";
import {
  MAX_AI_SORT_ITEMS,
  AiSortDisabledReason,
  getOutlinePointAiSortState,
  hasLockedThoughtAnchorsPreserved,
  replaceScopedItemsInColumn,
} from "@/utils/aiSorting";
import { skippedWrite, type WriteOperation } from "@/utils/recoverableWrite";
import { useTranslation } from '@locales/useTranslation';

import { AiReviewCaptureFailure } from '../captureAiReview';
import { advanceReviewBaseline, capturedReviewChanges, reflectCapturedReviewChanges } from "../utils/aiReviewPlacement";
import { buildStructureFromContainers, isLocalThoughtId } from "../utils/structure";

type AiSortTarget = {
  columnId: string;
  outlinePointId?: string | null;
};

const MAX_LOCKED_ANCHOR_SORT_ATTEMPTS = 3;

interface UseAiSortingDiffProps {
  containers: Record<string, Item[]>;
  setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
  outlinePoints: { introduction: SermonPoint[]; main: SermonPoint[]; conclusion: SermonPoint[] };
  sermon: Sermon | null;
  capturedSermon?: Sermon | null;
  projectBoard?: (sermon: Sermon) => Record<string, Item[]>;
  setSermon?: React.Dispatch<React.SetStateAction<Sermon | null>>;
  sermonId: string | null;
  debouncedSaveThought: (sermonId: string, thought: Thought, baseThought: Thought | null) => void;
  debouncedSaveStructure: (sermonId: string, structure: ThoughtsBySection, baseStructure?: ThoughtsBySection | null) => void;
}

// Helper function to collect thought updates from highlighted items
function collectThoughtUpdates(ids: readonly string[], containers: Record<string, Item[]>, sermon: Sermon) {
  const items = new Map(Object.values(containers).flat().map(item => [item.id, item]));
  return ids.flatMap(id => {
    const item = items.get(id);
    const thought = sermon.thoughts.find(candidate => candidate.id === id);
    return item && thought ? [{
      thought: { ...thought, outlinePointId: item.outlinePointId ?? null, subPointId: item.subPointId ?? null },
      baseThought: thought,
    }] : [];
  });
}

// Helper function to create new structure from containers
const createStructureFromContainers = (containers: Record<string, Item[]>): ThoughtsBySection => {
  return buildStructureFromContainers(containers);
};

const resolveAiSortTarget = (target: string | AiSortTarget): AiSortTarget => (
  typeof target === "string" ? { columnId: target } : target
);

const getRetryValidationError = () => new Error("AI_SORT_LOCKED_ANCHORS_INVALID");
const getFailedFormatError = () => new Error("AI_SORT_FAILED_FORMAT");

const notifyOutlinePointSortBlocked = (
  disabledReason: AiSortDisabledReason | null,
  t: ReturnType<typeof useTranslation>["t"],
): boolean => {
  switch (disabledReason) {
    case "sorting":
      return true;
    case "review":
      toast.info(t("structure.aiSortPointDisabledReview", {
        defaultValue: "Review or revert current AI suggestions first.",
      }));
      return true;
    case "tooMany":
      toast.warning(t("structure.aiSortPointDisabledTooMany", {
        defaultValue: "AI sorting supports up to 25 thoughts in one structure point.",
      }));
      return true;
    case "insufficientUnlocked":
      toast.info(t("structure.aiSortPointDisabledTooFewUnlocked", {
        defaultValue: "Need at least 2 unlocked thoughts in this structure point.",
      }));
      return true;
    default:
      return false;
  }
};

const getOutlinePointsForSort = ({
  outlinePoints,
  columnId,
  outlinePointId,
}: {
  outlinePoints: UseAiSortingDiffProps["outlinePoints"];
  columnId: string;
  outlinePointId?: string | null;
}) => {
  const outlinePointsForColumn = outlinePoints[columnId as keyof typeof outlinePoints] || [];

  return outlinePointId
    ? outlinePointsForColumn.filter((point) => point.id === outlinePointId)
    : outlinePointsForColumn;
};

const mergeSortedItemsWithOriginals = (sortableItems: Item[], aiSortedItems: Item[]) => {
  return aiSortedItems.map((sortedItem) => {
    const originalItem = sortableItems.find((item) => item.id === sortedItem.id);
    return originalItem ? { ...originalItem, ...sortedItem } : sortedItem;
  });
};

const getValidatedSortedItems = async ({
  columnId,
  sortableItems,
  sermonId,
  outlinePointsForSort,
  outlinePointId,
}: {
  columnId: string;
  sortableItems: Item[];
  sermonId: string;
  outlinePointsForSort: SermonPoint[];
  outlinePointId?: string | null;
}): Promise<Item[]> => {
  for (let attempt = 1; attempt <= MAX_LOCKED_ANCHOR_SORT_ATTEMPTS; attempt += 1) {
    const aiSortedItems = await sortItemsWithAI(
      columnId,
      sortableItems,
      sermonId,
      outlinePointsForSort,
    );

    if (!aiSortedItems || !Array.isArray(aiSortedItems)) {
      throw getFailedFormatError();
    }

    const mergedSortedItems = mergeSortedItemsWithOriginals(sortableItems, aiSortedItems);

    if (!outlinePointId || hasLockedThoughtAnchorsPreserved(sortableItems, mergedSortedItems)) {
      return mergedSortedItems;
    }
  }

  throw getRetryValidationError();
};

const buildHighlightedSortItems = ({
  sortedItems,
  sortableItems,
  currentColumnItems,
  finalSortedItems,
}: {
  sortedItems: Item[];
  sortableItems: Item[];
  currentColumnItems: Item[];
  finalSortedItems: Item[];
}): Record<string, { type: 'assigned' | 'moved' }> => {
  const newHighlightedItems: Record<string, { type: 'assigned' | 'moved' }> = {};

  for (const item of sortedItems) {
    const originalItem = sortableItems.find((sortableItem) => sortableItem.id === item.id);
    if (!originalItem) continue;

    const outlineChanged = (item.outlinePointId ?? null) !== (originalItem.outlinePointId ?? null);
    const subPointChanged = (item.subPointId ?? null) !== (originalItem.subPointId ?? null);
    if (outlineChanged || subPointChanged) {
      newHighlightedItems[item.id] = { type: 'assigned' };
      continue;
    }

    const previousIndex = currentColumnItems.findIndex((columnItem) => columnItem.id === item.id);
    const nextIndex = finalSortedItems.findIndex((columnItem) => columnItem.id === item.id);

    if (previousIndex !== nextIndex) {
      newHighlightedItems[item.id] = { type: 'moved' };
    }
  }

  return newHighlightedItems;
};

const updateColumnItems = (
  setContainers: UseAiSortingDiffProps["setContainers"],
  columnId: string,
  finalSortedItems: Item[],
) => {
  setContainers((prev) => ({
    ...prev,
    [columnId]: finalSortedItems,
  }));
};

const applyAiSortOutcome = ({
  sortedItems,
  sortableItems,
  currentColumnItems,
  finalSortedItems,
  columnId,
  setContainers,
  setHighlightedItems,
  setIsDiffModeActive,
  setPreSortState,
  t,
}: {
  sortedItems: Item[];
  sortableItems: Item[];
  currentColumnItems: Item[];
  finalSortedItems: Item[];
  columnId: string;
  setContainers: UseAiSortingDiffProps["setContainers"];
  setHighlightedItems: React.Dispatch<React.SetStateAction<Record<string, { type: 'assigned' | 'moved' }>>>;
  setIsDiffModeActive: React.Dispatch<React.SetStateAction<boolean>>;
  setPreSortState: React.Dispatch<React.SetStateAction<Record<string, Item[]> | null>>;
  t: ReturnType<typeof useTranslation>["t"];
}) => {
  const newHighlightedItems = buildHighlightedSortItems({
    sortedItems,
    sortableItems,
    currentColumnItems,
    finalSortedItems,
  });
  const hasChanges = Object.keys(newHighlightedItems).length > 0;

  updateColumnItems(setContainers, columnId, finalSortedItems);

  if (hasChanges) {
    setHighlightedItems(newHighlightedItems);
    setIsDiffModeActive(true);
    toast.success(t('structure.aiSortSuggestionsReady', {
      defaultValue: 'AI sorting completed. Review and confirm the changes.',
    }));
    return;
  }

  toast.info(t('structure.aiSortNoChanges', {
    defaultValue: 'AI sort did not suggest any changes.',
  }));
  setPreSortState(null);
};

const notifyAiSortError = (
  error: unknown,
  t: ReturnType<typeof useTranslation>["t"],
) => {
  if (error instanceof Error && error.message === "AI_SORT_LOCKED_ANCHORS_INVALID") {
    toast.error(t("structure.aiSortLockedValidationFailed", {
      defaultValue: "AI could not keep locked thoughts fixed. No changes were applied.",
    }));
    return;
  }

  if (error instanceof Error && error.message === "AI_SORT_FAILED_FORMAT") {
    toast.error(t("errors.aiSortFailedFormat"));
    return;
  }

  toast.error(t('errors.failedToSortItems'));
};

export const useAiSortingDiff = ({
  containers,
  setContainers,
  outlinePoints,
  sermon,
  capturedSermon,
  projectBoard,
  setSermon,
  sermonId,
}: UseAiSortingDiffProps) => {
  const { t } = useTranslation();
  const writer = useStructureWriter();
  
  // AI Sort with Interactive Confirmation state
  const [preSortState, setPreSortState] = useState<Record<string, Item[]> | null>(null);
  const [highlightedItems, setHighlightedItems] = useState<Record<string, { type: 'assigned' | 'moved' }>>({});
  const [isDiffModeActive, setIsDiffModeActive] = useState<boolean>(false);
  const [isSorting, setIsSorting] = useState(false);
  const [sortingTarget, setSortingTarget] = useState<AiSortTarget | null>(null);
  // A capture belongs to this owner/document, even if its promise outlives the screen.
  const applying = useMemo(() => ({ sermonId, owner: sermon?.userId, pending: null as Promise<void> | null, discard: undefined as (() => Promise<void>) | undefined }), [sermonId, sermon?.userId]);
  const currentApplying = useRef<typeof applying | null>(applying);
  currentApplying.current = applying;
  useEffect(() => {
    currentApplying.current = applying;
    return () => { if (currentApplying.current === applying) currentApplying.current = null; };
  }, [applying]);
  const [pendingSort, setPendingSort] = useState<object | null>(null);
  const isApplyingSort = pendingSort === applying;

  const handleAiSort = useCallback(async (targetInput: string | AiSortTarget) => {
    const target = resolveAiSortTarget(targetInput);
    const { columnId, outlinePointId } = target;

    if (applying.pending || isSorting || !sermon || !sermonId) return;

    const currentColumnItems: Item[] = containers[columnId] || [];
    const scopedItems = outlinePointId
      ? currentColumnItems.filter((item) => item.outlinePointId === outlinePointId)
      : currentColumnItems;

    if (outlinePointId) {
      const pointSortState = getOutlinePointAiSortState({
        items: currentColumnItems,
        outlinePointId,
        isSorting,
        isDiffModeActive,
      });

      if (notifyOutlinePointSortBlocked(pointSortState.disabledReason, t)) {
        return;
      }
    }

    const sortableItems = scopedItems.filter((item) => !isLocalThoughtId(item.id));

    if (sortableItems.length === 0) {
      toast.info(t("structure.noItemsToSort", {
        defaultValue: "No items to sort.",
      }));
      return;
    }

    if (sortableItems.length > MAX_AI_SORT_ITEMS) {
      toast.warning(t("structure.tooManyThoughts", {
        defaultValue: "Too many thoughts to sort. Please reduce to 25 or fewer.",
      }));
      return;
    }

    setIsSorting(true);
    setSortingTarget(target);
    setPreSortState({ [columnId]: [...currentColumnItems] });

    try {
      const outlinePointsForSort = getOutlinePointsForSort({
        outlinePoints,
        columnId,
        outlinePointId,
      });
      const sortedItems = await getValidatedSortedItems({
        columnId,
        sortableItems,
        sermonId,
        outlinePointsForSort,
        outlinePointId,
      });

      const finalSortedItems = replaceScopedItemsInColumn({
        columnItems: currentColumnItems,
        scopedItemIds: sortableItems.map((item) => item.id),
        sortedScopedItems: sortedItems,
      });
      applyAiSortOutcome({
        sortedItems,
        sortableItems,
        currentColumnItems,
        finalSortedItems,
        columnId,
        setContainers,
        setHighlightedItems,
        setIsDiffModeActive,
        setPreSortState,
        t,
      });
    } catch (error) {
      if (isUsageCapReachedError(error)) {
        setPreSortState(null);
        return;
      }
      notifyAiSortError(error, t);
      setPreSortState(null);
    } finally {
      setIsSorting(false);
      setSortingTarget(null);
    }
  }, [
    applying,
    containers,
    isDiffModeActive,
    isSorting,
    outlinePoints,
    sermon,
    sermonId,
    setContainers,
    t,
  ]);

  // Manual actions use this same boundary after their actual device capture.
  const lastCaptured = useRef<Sermon | null>(null);
  useEffect(() => {
    if (!capturedSermon || !projectBoard) return;
    const previous = lastCaptured.current;
    lastCaptured.current = capturedSermon;
    if (!isDiffModeActive || !previous || previous === capturedSermon) return;
    const board = projectBoard(capturedSermon);
    const changes = capturedReviewChanges(projectBoard(previous), board);
    if (!changes.words.size && !changes.placements.length) return;
    setContainers(current => reflectCapturedReviewChanges(current, board, changes));
    setPreSortState(current => current && reflectCapturedReviewChanges(current, board, changes));
    setSermon?.(current => current && {
      ...current, thoughts: capturedSermon.thoughts,
      structure: capturedSermon.structure, thoughtsBySection: capturedSermon.thoughtsBySection,
    });
    if (changes.placements.some(id => id in highlightedItems)) {
      const remaining = { ...highlightedItems };
      for (const id of changes.placements) delete remaining[id];
      setHighlightedItems(remaining);
      if (!Object.keys(remaining).length) {
        setIsDiffModeActive(false);
        setPreSortState(null);
      }
    }
  }, [capturedSermon, projectBoard, isDiffModeActive, highlightedItems, setContainers, setSermon]);

  const handlePlacementCaptured = useCallback((itemId: string, board: Record<string, Item[]>) => {
    setPreSortState(previous => previous ? advanceReviewBaseline(previous, board, [itemId]) : previous);
    setHighlightedItems(previous => {
      if (!(itemId in previous)) return previous;
      const remaining = { ...previous };
      delete remaining[itemId];
      if (Object.keys(remaining).length === 0) {
        setIsDiffModeActive(false);
        setPreSortState(null);
      }
      return remaining;
    });
  }, []);

  const captureReviewDecision = useCallback((write: () => Promise<unknown>, captured: () => void): WriteOperation => {
    if (applying.pending) return applying.pending;
    setPendingSort(applying);
    const persistence = (async () => {
      if (applying.discard) {
        await applying.discard();
        applying.discard = undefined;
      }
      try { await write(); }
      catch (error) { if (!isOfflineQueuedError(error)) throw error; }
      if (currentApplying.current === applying) captured();
    })().catch(error => {
      if (error instanceof AiReviewCaptureFailure) applying.discard = error.discard;
      if (currentApplying.current === applying) toast.error(t('errors.failedToSaveStructure'));
      throw error;
    }).finally(() => {
      applying.pending = null;
      if (currentApplying.current === applying) setPendingSort(null);
    });
    applying.pending = persistence;
    void persistence.catch(() => undefined);
    return persistence;
  }, [applying, t]);

  const handleKeepItem = useCallback((itemId: string, columnId: string): WriteOperation => {
    if (applying.pending) return applying.pending;
    const item = containers[columnId]?.find(candidate => candidate.id === itemId);
    const thought = sermon?.thoughts.find(candidate => candidate.id === itemId);
    if (!item || !thought || !sermonId || !(itemId in highlightedItems)) return skippedWrite();
    return captureReviewDecision(() => writer.updateStructure(sermonId, createStructureFromContainers(containers), sermon?.structure, {
      thoughtIds: [itemId],
      captureReview: true,
      thoughtUpdates: [{ thought: { ...thought, outlinePointId: item.outlinePointId ?? null, subPointId: item.subPointId ?? null }, baseThought: thought }],
    }), () => handlePlacementCaptured(itemId, containers));
  }, [applying, containers, sermon, sermonId, highlightedItems, captureReviewDecision, writer, handlePlacementCaptured]);

  const handleRevertItem = useCallback((itemId: string, columnId: string): WriteOperation => {
    if (applying.pending) return applying.pending;
    const originalItems = preSortState?.[columnId];
    const originalItem = originalItems?.find(candidate => candidate.id === itemId);
    const item = containers[columnId]?.find(candidate => candidate.id === itemId);
    const thought = sermon?.thoughts.find(candidate => candidate.id === itemId);
    if (!originalItems || !originalItem || !item || !thought || !sermonId || !(itemId in highlightedItems)) return skippedWrite();
    const revertedItems = containers[columnId].filter(candidate => candidate.id !== itemId);
    revertedItems.splice(Math.min(originalItems.indexOf(originalItem), revertedItems.length), 0, originalItem);
    const revertedBoard = { ...containers, [columnId]: revertedItems };
    const dismiss = () => {
      setContainers(revertedBoard);
      handlePlacementCaptured(itemId, revertedBoard);
    };
    if (applying.discard) return captureReviewDecision(async () => undefined, dismiss);
    dismiss();
    return Promise.resolve();
  }, [applying, preSortState, containers, sermon, sermonId, highlightedItems, captureReviewDecision, setContainers, handlePlacementCaptured]);

  const finishReview = useCallback(() => {
    setHighlightedItems({});
    setIsDiffModeActive(false);
    setPreSortState(null);
  }, []);

  const handleKeepAll = useCallback((): WriteOperation => {
    if (applying.pending) return applying.pending;
    const thoughtIds = Object.keys(highlightedItems);
    if (!thoughtIds.length || !sermon || !sermonId) return skippedWrite();
    const thoughtUpdates = collectThoughtUpdates(thoughtIds, containers, sermon);
    return captureReviewDecision(() => writer.updateStructure(sermonId, createStructureFromContainers(containers), sermon.structure, {
      thoughtIds, thoughtUpdates, captureReview: true,
    }), () => {
      finishReview();
      toast.success(t('structure.aiSortChangesAccepted', { defaultValue: 'All AI suggestions accepted.' }));
    });
  }, [applying, captureReviewDecision, writer, highlightedItems, containers, sermon, sermonId, finishReview, t]);

  const handleRevertAll = useCallback((columnId: string): WriteOperation => {
    if (applying.pending) return applying.pending;
    if (!preSortState?.[columnId] || !sermon || !sermonId) return skippedWrite();
    const dismiss = () => {
      setContainers({ ...containers, [columnId]: preSortState[columnId] });
      finishReview();
      toast.info(t('structure.aiSortChangesReverted', { defaultValue: 'All AI suggestions reverted.' }));
    };
    if (applying.discard) return captureReviewDecision(async () => undefined, dismiss);
    dismiss();
    return Promise.resolve();
  }, [applying, preSortState, sermon, sermonId, containers, captureReviewDecision, setContainers, finishReview, t]);

  return {
    // State
    preSortState,
    highlightedItems,
    isDiffModeActive,
    isSorting,
    sortingTarget,
    isApplyingSort,
    
    // Actions
    handleAiSort,
    handleKeepItem,
    handleRevertItem,
    handleKeepAll,
    handleRevertAll,
    handlePlacementCaptured,
    
    // Setters for external use (e.g., when dragging highlighted items)
    setHighlightedItems,
    setIsDiffModeActive,
    setPreSortState,
  };
};
