"use client";



import { DndContext, DragOverlay, type DragEndEvent, type Over } from "@dnd-kit/core";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import React, { useState, useEffect, Suspense, useRef, useCallback, useMemo } from "react";
import { toast } from 'sonner';

import { ScriptureText } from '@/components/bible/ScriptureLinks';
import { ScriptureLinksInWindow } from '@/components/bible/VerseWindow';
import Column from "@/components/Column";
import { TechnicalDetailsButton } from '@/components/diagnostics/TechnicalDetailsButton';
import { OutlineWriteRecovery } from '@/components/sermon/OutlineWriteRecovery';
import { useStructureWriter } from "@/components/sermon/structureWriter";
import { StructurePageSkeleton } from "@/components/skeletons/StructurePageSkeleton";
import { SortableItemPreview } from "@/components/SortableItem";
import { EngineThoughtModal } from '@/components/thought/EngineThoughtModal';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { DataDocumentProvider, PHASES_TAKING_CHANGES, readThoughtLockComparison, useDataEngine, useOpenDocumentAnswerScopes, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useAiUsage } from "@/hooks/useAiUsage";
import { useConfirm } from '@/hooks/useConfirm';
import { useDndKitAccessibility } from '@/hooks/useDragAnnouncements';
import { useRouteId } from "@/hooks/useRouteId";
import { useSermonStructureData, type StructureEngineSource } from "@/hooks/useSermonStructureData";
import { Item, Sermon, SermonPoint, Thought, SermonOutline } from "@/models/models";
import "@locales/i18n";
import { newClientId } from "@/utils/clientId";
import { sermonLanguage } from '@/utils/documentLanguage';
import { getExportContent } from "@/utils/exportContent";
import { outlinePointText } from '@/utils/outlineDnd';
import {
  awaitWriteOperation,
} from "@/utils/recoverableWrite";
import { normalizeVisualSectionKey } from '@/utils/sermonVisualOrder';
import { normalizeStructureTag } from "@/utils/tagUtils";
import { NEUTRAL_CAPTION } from '@/utils/themeColors';
import { getSectionLabel } from "@lib/sections";
import { useTranslation } from '@locales/useTranslation';
import { getSermonPlanData, planEditorRoute } from "@utils/sermonPlanAccess";
import { insertThoughtIdInStructure, resolveSectionFromOutline } from "@utils/thoughtOrdering";

import { AmbiguousSection } from "./components/AmbiguousSection";
import { SectionVisibilityPills } from "./components/SectionVisibilityPills";
import { StructureReadOnlyBoard } from "./components/StructureReadOnlyBoard";
import { useAiSortingDiff } from "./hooks/useAiSortingDiff";
import { useFocusMode } from "./hooks/useFocusMode";
import { useOutlineStats } from "./hooks/useOutlineStats";
import { usePersistence } from "./hooks/usePersistence";
import { useSermonActions } from "./hooks/useSermonActions";
import { useStructureDnd } from "./hooks/useStructureDnd";
import { ThoughtLockHistory } from "./ThoughtLockHistory";
import { useEngineStructureWriter, type ShownThoughtIdentity } from "./useEngineStructureWriter";
import { createStructureCollisionDetection } from "./utils/collision";
import { boardLayoutClass, showLayoutToggle } from "./utils/sectionLayout";
import { findOutlinePoint } from "./utils/structure";

// Translation key constants
const TRANSLATION_KEYS = {
  ERRORS: {
    SAVING_ERROR: 'errors.savingError',
    SAVE_OUTLINE_ERROR: 'errors.saveOutlineError',
  },
} as const;

interface UseSermonStructureDataReturn {
  sermon: Sermon | null;
  setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
  containers: Record<string, Item[]>;
  setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
  outlinePoints: { introduction: SermonPoint[]; main: SermonPoint[]; conclusion: SermonPoint[] };
  requiredTagColors: { introduction?: string; main?: string; conclusion?: string };
  allowedTags: { name: string; color: string }[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  isAmbiguousVisible: boolean;
  setIsAmbiguousVisible: React.Dispatch<React.SetStateAction<boolean>>;
  /** Catches the board up with the document once a held card is let go. */
  syncFromEngine: () => void;
  projectBoard: (sermon: Sermon) => Record<string, Item[]>;
}

export default function StructurePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StructurePageContent />
    </Suspense>
  );
}

function StructurePageContent() {
  const searchParams = useSearchParams();
  const sermonIdFromPath = useRouteId();
  const sermonIdFromQuery = searchParams?.get("sermonId");
  const sermonId = sermonIdFromPath || sermonIdFromQuery || null;
  return sermonId
    ? <DataDocumentProvider resource={{ collection: 'sermons', id: sermonId }} options={{ readOnlyCopy: true }}><EngineStructureBoard sermonId={sermonId} /></DataDocumentProvider>
    : null;
}

/**
 * The same board on the engine: the document is the only store, every write goes through the
 * engine writer, and the board follows the document except while a card is in the person's hand.
 */
function EngineStructureBoard({ sermonId }: { sermonId: string }) {
  const { owner } = useDataEngine();
  const { t } = useTranslation();
  const outline = useEngineStructureWriter(sermonId, owner);
  const { document } = outline;
  const holdingRef = useRef(false);
  const generation = document.confirmed?.metadata?.generation;
  const sermon = useMemo(() => document.data
    ? ({ ...document.data, id: sermonId, thoughts: document.data.thoughts ?? [] } as unknown as Sermon)
    : null, [document.data, sermonId]);
  const checkpoint = document.state?.checkpoint;
  const answers = useOpenDocumentAnswerScopes();
  const [operationId] = Object.keys(checkpoint?.pending ?? {});
  const owned = answers.filter(answer => answer.owner === owner && answer.resource.collection === 'sermons'
    && answer.resource.id === sermonId && answer.operationIds.includes(operationId));
  // A document choice keeps queued descendants. A field choice is valid only for one shown Save.
  const conflict = checkpoint && owned.length && owned.every(answer => answer.operationIds.length === 1 && !answer.laterSaves?.length)
    ? readThoughtLockComparison(checkpoint) : undefined;
  const lockText = (locked: boolean) => t(locked ? 'structure.locked' : 'structure.unlocked');
  const canRecover = Boolean(owner && document.state?.durable && !document.readOnly && document.status?.phase === 'saved');
  const recovery = useRecoveryDiscovery({
    identity: document.recoveryIdentity,
    enabled: canRecover,
    version: JSON.stringify([generation, document.confirmed?.metadata?.revision, document.status?.phase]),
    list: async () => (await document.listRecoverable({ manualChoiceCopies: 'only' })).map(source => {
      const { draft, confirmed } = source.record.checkpoint;
      const value = draft as unknown as Sermon | null;
      const base = (source.record.retainedManualChoice?.base ?? confirmed.value) as unknown as Sermon | null;
      const original = new Map(base?.thoughts?.map(thought => [thought.id, thought]));
      const locks = value?.thoughts?.flatMap(thought => {
        const before = original.get(thought.id);
        return before && before.date === thought.date && Boolean(before.isLocked) !== Boolean(thought.isLocked)
          ? [thought.text + ' · ' + lockText(Boolean(thought.isLocked))] : [];
      });
      const preview = locks?.length ? [t('structure.thoughtLockState'), ...locks].join('\n') : undefined;
      return { id: source.id, title: value?.title ?? base?.title ?? sermonId, preview,
        discard: () => document.discardRecovery(source) };
    }),
    recover: document.recover,
  });
  const comparison = conflict ? {
    identity: conflict.identity, title: t('structure.thoughtLockState'), valueKind: 'field' as const, scopedChoice: true as const,
    mine: conflict.locks.map(lock => lock.text + ' · ' + lockText(lock.mine)).join('\n'),
    stored: conflict.locks.map(lock => lock.text + ' · ' + lockText(lock.stored)).join('\n'),
  } : undefined;
  const engine = useMemo<StructureEngineSource>(() => ({
    sermon, loading: document.loading, error: document.error, durable: document.state?.durable, isHolding: () => holdingRef.current,
    retry: () => { void document.retry().catch(() => undefined); },
  }), [sermon, document]);
  // A copy for reading keeps this page and its toolbar; only the board is drawn without controls.
  // It is its own tree, standing exactly where the separate reader stood, so every switch mounts
  // the other one fresh, as the swap did.
  return <OutlineWriteRecovery key={`${owner}:${sermonId}`} owner={owner} sermonId={sermonId} {...outline}>
    <StructureBoard key={document.readOnly ? 'copy' : 'editor'} sermonId={sermonId} engine={engine} holdingRef={holdingRef} readOnly={document.readOnly}
      setThoughtLocks={outline.writer.setThoughtLocks}
      lockHistory={owner && generation && sermon && !document.readOnly && <ThoughtLockHistory key={generation}
        owner={owner} sermonId={sermonId} generation={generation} thoughts={sermon.thoughts}
        disabled={!document.state?.durable || !PHASES_TAKING_CHANGES.has(document.status?.phase ?? '')} onRestore={outline.writer.setThoughtLocks} />}
      syncStatus={document.readOnly ? null : <DataSyncStatus
        subject={document.recoveryIdentity} status={document.status} error={document.error} errorWords={document.errorWords} onRetry={document.retry}
        comparison={comparison} onKeepLocal={() => document.keepLocal(comparison ? checkpoint : undefined)}
        onAcceptRemote={() => document.acceptRemote(comparison ? checkpoint : undefined)}
        recoveryChoices={canRecover ? recovery.choices : []} recoveryLoading={recovery.loading}
        recoveryError={canRecover ? recovery.error : null} onRecover={recovery.recover} onDiscardRecovery={recovery.discard} />} />
  </OutlineWriteRecovery>;
}

function StructureBoard({ sermonId, engine, holdingRef, syncStatus, lockHistory, setThoughtLocks, readOnly = false }: {
  sermonId: string;
  engine: StructureEngineSource;
  holdingRef: React.MutableRefObject<boolean>;
  syncStatus?: React.ReactNode;
  lockHistory?: React.ReactNode;
  setThoughtLocks: (thoughts: readonly ShownThoughtIdentity[], isLocked: boolean) => Promise<void>;
  /** A copy for reading (device storage silent): see `StructureReadOnlyBoard`. */
  readOnly?: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useTranslation();
  const structureWriter = useStructureWriter();
  const { confirm, confirmDialog } = useConfirm();
  const { refresh: refreshAiUsage } = useAiUsage();
  const [isClient, setIsClient] = useState(false);
  const [isVerticalLayout, setIsVerticalLayout] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('structureLayoutVertical') === 'true';
    }
    return false;
  });

  const handleToggleLayout = useCallback(() => {
    setIsVerticalLayout(prev => {
      const next = !prev;
      localStorage.setItem('structureLayoutVertical', String(next));
      return next;
    });
  }, []);

  // Use effect to mark when component is mounted on client
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Use the hook to manage data fetching and related state
  const {
    sermon,
    setSermon,
    containers,
    setContainers,
    outlinePoints,
    requiredTagColors,
    allowedTags,
    loading,
    error,
    retry,
    isAmbiguousVisible,
    setIsAmbiguousVisible,
    syncFromEngine,
    projectBoard,
  }: UseSermonStructureDataReturn = useSermonStructureData(t, engine);

  // Handle switching to plan view
  const handleSwitchToPlan = useCallback((sectionId?: string) => {
    if (sermonId) {
      // The section shortcut belongs to the paired screen (it scrolls to a section there);
      // without one, open whichever editor this plan is actually kept in.
      const url = sectionId
        ? `/sermons/${encodeURIComponent(sermonId)}/plan?section=${sectionId}`
        : planEditorRoute(encodeURIComponent(sermonId), sermon);
      router.push(url);
    }
  }, [sermonId, router, sermon]);

  // Ref to hold the latest containers state
  const containersRef = useRef(containers);
  /**
   * The plan this page last saw CONFIRMED — not the one merely on screen.
   *
   * A new point appears immediately, before the server answers. That is right; what
   * is wrong is judging the NEXT save against it. If the first save failed, the held
   * plan holds a point the server never received, and the merge would read its
   * absence there as a deletion made on another device — dropping it for good.
   */
  const outlineSaveStateRef = useRef<{
    sermonId: string;
    nextSequence: number;
    confirmedSequence: number;
    confirmedOutline: SermonOutline;
  } | null>(null);
  // Stateful instance (holds the sticky-target hysteresis across a drag).
  const { detect: collisionDetector, reset: resetCollision } = useMemo(() => createStructureCollisionDetection(), []);
  useEffect(() => {
    containersRef.current = containers;
  }, [containers]);

  const columnTitles = useMemo((): Record<string, string> => ({
    introduction: getSectionLabel(t, 'introduction'),
    main: getSectionLabel(t, 'main'),
    conclusion: getSectionLabel(t, 'conclusion'),
    ambiguous: getSectionLabel(t, 'ambiguous'),
  }), [t]);

  // Pending state comes from the optimistic write path, so no separate sync callback is needed.
  const { debouncedSaveThought, debouncedSaveStructure, retryThoughtSave } = usePersistence({
    setSermon,
  });

  // Section visibility (subsumes focus mode: 1 visible = focus, 2 = pair, 3 = all)
  const {
    focusedColumn,
    isFocusMode,
    visibleSections,
    isSectionVisible,
    toggleSection,
    handleToggleFocusMode,
    navigateToSection,
  } = useFocusMode({ searchParams, sermonId });

  // SermonOutline stats hook
  const { thoughtsPerSermonPoint } = useOutlineStats({ sermon, containers });

  // DnD hook
  const {
    sensors: dndSensors,
    activeId: dndActiveId,
    handleDragStart: onDragStartHook,
    handleDragOver: onDragOverHook,
    handleDragEnd,
    handleDragCancel: onDragCancelHook,
  } = useStructureDnd({
    containers,
    setContainers,
    containersRef,
    sermon,
    setSermon,
  });

  // AI sorting diff hook
  const {
    highlightedItems,
    isDiffModeActive,
    isApplyingSort,
    isSorting,
    sortingTarget,
    handleAiSort,
    handleKeepItem,
    handleRevertItem,
    handleKeepAll,
    handleRevertAll,
    handlePlacementCaptured,
  } = useAiSortingDiff({
    containers,
    setContainers,
    outlinePoints,
    sermon,
    capturedSermon: engine.durable && dndActiveId === null ? engine.sermon : null,
    projectBoard,
    setSermon,
    sermonId,
    debouncedSaveThought,
    debouncedSaveStructure,
  });

  // Sermon actions hook
  const {
    editingItem,
    addingThoughtToSection,
    handleEdit,
    handleCloseEdit,
    handleAddThoughtToSection,
    handleDeleteThought,
    handleMoveToAmbiguous,
  } = useSermonActions({
    sermon,
    setSermon,
    containers,
    setContainers,
    containersRef,
    allowedTags,
    onPlacementCaptured: handlePlacementCaptured,
    debouncedSaveThought,
    debouncedSaveStructure,
    retryThoughtSave: async (thoughtId: string) => {
      if (!sermonId) return;
      await retryThoughtSave(sermonId, thoughtId);
    },
  });

  const requestAiSortForOutlinePoint = useCallback(async (columnId: "introduction" | "main" | "conclusion", outlinePointId: string) => {
    await handleAiSort({ columnId, outlinePointId });
    await refreshAiUsage();
  }, [handleAiSort, refreshAiUsage]);

  // The drag hint and announcements in the interface language (BUG-20261006-library-screen-reader-words-english).
  // A thought is said by where it would land: the point, or the section when it has none, and its place there.
  const outlineRef = useRef(sermon?.outline);
  outlineRef.current = sermon?.outline;
  const placeOfThought = useCallback((over: Over) => {
    const data = over.data.current as { container?: string; outlinePointId?: string | null; subPointId?: string | null; sortable?: { index?: number } } | undefined;
    if (!data?.container) return undefined;
    const position = typeof data.sortable?.index === 'number' ? data.sortable.index + 1 : undefined;
    const pointId = data.subPointId ?? data.outlinePointId;
    const point = pointId && outlineRef.current ? outlinePointText(outlineRef.current, pointId) : '';
    if (point) return position === undefined ? t('dragAndDrop.placeInPoint', { point }) : t('dragAndDrop.placeInPointAt', { point, position });
    const section = columnTitles[data.container] ?? data.container;
    return position === undefined ? t('dragAndDrop.placeSection', { section }) : t('dragAndDrop.placeSectionAt', { section, position });
  }, [t, columnTitles]);
  const dndAccessibility = useDndKitAccessibility({ placeOf: placeOfThought });
  // A drag or an AI review owns the board; the engine's rebuild waits and then catches up.
  const holdingBoard = dndActiveId !== null || isDiffModeActive;
  holdingRef.current = holdingBoard;
  useEffect(() => {
    if (!holdingBoard) syncFromEngine();
  }, [holdingBoard, syncFromEngine]);

  // Safety timeout to prevent stuck drag state (especially on touch devices)
  useEffect(() => {
    if (!dndActiveId) return;

    // If drag is active for more than 30 seconds, something went wrong - reset state
    const safetyTimeout = setTimeout(() => {
      console.warn('[DnD Safety Guard] Drag state timeout detected, resetting');
      // The state will be cleared by the DnD hook's cleanup
    }, 30000);

    return () => clearTimeout(safetyTimeout);
  }, [dndActiveId]);

  const activeDragItem = useMemo(() => {
    if (!dndActiveId) return null;

    for (const [containerId, columnItems] of Object.entries(containers)) {
      const activeItem = columnItems.find((item) => item.id === dndActiveId);
      if (activeItem) {
        return { containerId, item: activeItem };
      }
    }

    return null;
  }, [containers, dndActiveId]);

  // Handle a newly created audio thought: append to data model and UI, and persist structure
  const handleAudioThoughtCreated = useCallback(async (thought: Thought, sectionId: 'introduction' | 'main' | 'conclusion') => {
    if (!sermon) return;

    try {
      const outlineSection = resolveSectionFromOutline(sermon, thought.outlinePointId ?? null);
      const finalSection = outlineSection && outlineSection !== 'ambiguous' ? outlineSection : sectionId;

      // Compute custom tags (exclude structural tag), preserving original order
      const customTags = (thought.tags || []).filter((tag) => normalizeStructureTag(tag) === null);

      // Build UI item - find outline point if available
      const outlinePoint = findOutlinePoint(thought.outlinePointId ?? undefined, sermon);

      const newItem: Item = {
        id: thought.id,
        content: thought.text,
        requiredTags: [],
        customTagNames: customTags.map((name) => ({
          name,
          color: allowedTags.find((t) => t.name === name)?.color || '#4c51bf',
        })),
        outlinePointId: thought.outlinePointId,
        subPointId: thought.subPointId ?? null,
        outlinePoint,
        isLocked: Boolean(thought.isLocked),
      };

      // 1) Update containers UI (append to end of the target section)
      setContainers((prev) => {
        const next = { ...prev };
        const items = prev[finalSection] || [];
        const insertAtOutlineGroupEnd = (list: Item[], item: Item): Item[] => {
          if (!item.outlinePointId) return [...list, item];
          let lastIndex = -1;
          list.forEach((existing, index) => {
            if (existing.outlinePointId === item.outlinePointId) {
              lastIndex = index;
            }
          });
          if (lastIndex === -1) return [...list, item];
          const nextList = [...list];
          nextList.splice(lastIndex + 1, 0, item);
          return nextList;
        };
        next[finalSection] = insertAtOutlineGroupEnd(items, newItem);
        return next;
      });

      // 2) Persist updated structure (append id to the section)
      const insertAtOutlineGroupEnd = (list: Item[], item: Item): Item[] => {
        if (!item.outlinePointId) return [...list, item];
        let lastIndex = -1;
        list.forEach((existing, index) => {
          if (existing.outlinePointId === item.outlinePointId) {
            lastIndex = index;
          }
        });
        if (lastIndex === -1) return [...list, item];
        const nextList = [...list];
        nextList.splice(lastIndex + 1, 0, item);
        return nextList;
      };
      const updatedContainers = {
        ...containersRef.current,
        [finalSection]: insertAtOutlineGroupEnd(containersRef.current[finalSection] || [], newItem),
      } as Record<string, Item[]>;

      containersRef.current = updatedContainers;

      const thoughtsById = new Map(
        [...(sermon.thoughts || []), thought].map((t) => [t.id, t])
      );
      const newStructure = insertThoughtIdInStructure({
        structure: {
          introduction: (updatedContainers.introduction || []).map((it) => it.id),
          main: (updatedContainers.main || []).map((it) => it.id),
          conclusion: (updatedContainers.conclusion || []).map((it) => it.id),
          ambiguous: (updatedContainers.ambiguous || []).map((it) => it.id),
        },
        section: finalSection,
        thoughtId: thought.id,
        outlinePointId: thought.outlinePointId,
        thoughtsById,
        thoughts: [...(sermon.thoughts || []), thought],
        outline: sermon.outline,
      });

      // 3) Update sermon state (thoughts + structure)
      setSermon((prev) => prev ? { ...prev, thoughts: [...prev.thoughts, thought], structure: newStructure, thoughtsBySection: newStructure } : prev);

      // Use debounced structure save
      // Third argument: the arrangement as this screen holds it stored, so a move
      // made on another device is not reverted by this save.
      await structureWriter.updateStructure(sermon.id, newStructure, sermon.structure, { thoughtIds: [thought.id] });
      handlePlacementCaptured(thought.id, containersRef.current);
    } catch (e) {
      console.error('Error handling audio thought creation:', e);
      toast.error(t(TRANSLATION_KEYS.ERRORS.SAVING_ERROR));
    }
  }, [allowedTags, structureWriter, handlePlacementCaptured, containersRef, sermon, t, setContainers, setSermon]);

  const getExportContentForFocusedColumn = async (format: 'plain' | 'markdown', options?: { includeTags?: boolean }) => {
    if (!focusedColumn || !sermon) {
      return '';
    }

    // Pass format and includeTags parameters to getExportContent
    return getExportContent(sermon, focusedColumn, {
      format,
      includeTags: options?.includeTags
    });
  };

  const planData = useMemo(() => {
    return getSermonPlanData(sermon);
  }, [sermon]);

  const handleRemoveFromStructure = async (itemId: string, containerId: string) => {
    if (!sermon || containerId !== 'ambiguous') {
      toast.error(t('errors.removingError') || "Error removing item.");
      return;
    }

    // Find thought first to use its text in confirmation
    const thoughtToDelete = sermon.thoughts.find(t => t.id === itemId);
    if (!thoughtToDelete) {
      toast.error(t('errors.deletingError') || "Failed to find thought to delete.");
      return;
    }

    const question = { key: 'sermon.deleteThoughtConfirm', values: { text: thoughtToDelete.text } };
    if (!(await confirm({ title: question, confirmText: { key: 'common.delete' } }))) {
      return;
    }
    const submission = handleDeleteThought(itemId);
    let failureReported = false;
    const reportFailure = () => {
      if (failureReported) return;
      failureReported = true;
      toast.error(t('errors.deletingError') || "Failed to delete thought.");
    };
    // Explicit deletion has no editor; its actual capture refusal is reported here.
    void awaitWriteOperation(submission, reportFailure).catch(reportFailure);
  };

  // Function to handle outline updates from Column components
  const handleOutlineUpdate = (updatedOutline: SermonOutline) => {
    setSermon((prevSermon: Sermon | null) => {
      if (!prevSermon) return null;

      // Merge the updated outline sections with existing ones
      const mergedOutline: SermonOutline = {
        introduction: updatedOutline.introduction.length > 0 ? updatedOutline.introduction : (prevSermon.outline?.introduction || []),
        main: updatedOutline.main.length > 0 ? updatedOutline.main : (prevSermon.outline?.main || []),
        conclusion: updatedOutline.conclusion.length > 0 ? updatedOutline.conclusion : (prevSermon.outline?.conclusion || [])
      };

      return {
        ...prevSermon,
        outline: mergedOutline
      };
    });
  };

  const submitThoughtLocks = useCallback((select: (thought: Thought) => boolean, isLocked: boolean): void => {
    const selected = sermon?.thoughts.filter(select);
    if (!selected?.length) return;
    void setThoughtLocks(selected, isLocked).catch(() => {
      toast.error(t("errors.failedToSaveThought", { defaultValue: "Failed to save thought." }));
    });
  }, [sermon, setThoughtLocks, t]);

  const submitThoughtLockToggle = useCallback((thoughtId: string, isLocked: boolean): void => {
    submitThoughtLocks(thought => thought.id === thoughtId, isLocked);
  }, [submitThoughtLocks]);

  const submitPointLockToggle = useCallback((outlinePointId: string, isLocked: boolean): void => {
    submitThoughtLocks(thought => thought.outlinePointId === outlinePointId, isLocked);
  }, [submitThoughtLocks]);

  const handleOutlinePointDeleted = (pointId: string, sectionId: string) => {
    if (!sermon) return;

    const thoughtsToUpdate = sermon.thoughts.filter(t => t.outlinePointId === pointId);
    if (thoughtsToUpdate.length === 0) return;

    try {
      // 1. Update local sermon state
      setSermon(prevSermon => {
        if (!prevSermon) return null;
        return {
          ...prevSermon,
          thoughts: prevSermon.thoughts.map(thought =>
            thought.outlinePointId === pointId
              ? { ...thought, outlinePointId: undefined, subPointId: null }
              : thought
          )
        };
      });

      // 2. Update local containers state so UI updates
      setContainers(prevContainers => {
        const nextContainers = { ...prevContainers };
        if (nextContainers[sectionId]) {
          nextContainers[sectionId] = nextContainers[sectionId].map(item =>
            item.outlinePointId === pointId
              ? { ...item, outlinePointId: undefined, outlinePoint: undefined, subPointId: null }
              : item
          );
        }
        containersRef.current = nextContainers;
        return nextContainers;
      });

      // 3. Update backend for each thought
      thoughtsToUpdate.forEach(thought => {
        // Only the plan link changes here — state `thought` as the opening value so
        // the write does not also re-send this screen's copy of the thought's text.
        debouncedSaveThought(sermon.id, { ...thought, outlinePointId: null, subPointId: null }, thought);
      });

    } catch (error) {
      console.error('Error updating thoughts after outline point deletion:', error);
      toast.error(t(TRANSLATION_KEYS.ERRORS.SAVE_OUTLINE_ERROR, { defaultValue: 'Error updating thoughts' }));
    }
  };

  const handleSubPointDeleted = (outlinePointId: string, subPointId: string, sectionId: string) => {
    if (!sermon) return;

    const thoughtsToUpdate = sermon.thoughts.filter((thought) => thought.subPointId === subPointId);
    if (thoughtsToUpdate.length === 0) return;

    try {
      setSermon((prevSermon) => {
        if (!prevSermon) return null;
        return {
          ...prevSermon,
          thoughts: prevSermon.thoughts.map((thought) => (
            thought.subPointId === subPointId
              ? { ...thought, subPointId: null }
              : thought
          )),
        };
      });

      setContainers((prevContainers) => {
        const nextContainers = { ...prevContainers };
        if (nextContainers[sectionId]) {
          nextContainers[sectionId] = nextContainers[sectionId].map((item) => (
            item.subPointId === subPointId && item.outlinePointId === outlinePointId
              ? { ...item, subPointId: null }
              : item
          ));
        }
        containersRef.current = nextContainers;
        return nextContainers;
      });

      thoughtsToUpdate.forEach((thought) => {
        debouncedSaveThought(sermon.id, { ...thought, subPointId: null }, thought);
      });
    } catch (error) {
      console.error('Error updating thoughts after sub-point deletion:', error);
      toast.error(t(TRANSLATION_KEYS.ERRORS.SAVE_OUTLINE_ERROR, { defaultValue: 'Error updating thoughts' }));
    }
  };

  const handleAddOutlinePoint = async (sectionId: string, index: number, text: string) => {
    if (!sermon || !text.trim()) return;

    try {
      // The merge identifies plan points by id, so this id must remain unique after it is saved.
      const newPointId = newClientId();
      const newPoint: SermonPoint = {
        id: newPointId,
        text: text.trim(),
      };

      // 2. clone existing outline
      const updatedOutline: SermonOutline = {
        introduction: [...(sermon.outline?.introduction || [])],
        main: [...(sermon.outline?.main || [])],
        conclusion: [...(sermon.outline?.conclusion || [])]
      };

      /**
       * The plan THIS PAGE LOADED WITH — the base the write merges against.
       *
       * Taken before the insertion below, and deliberately from the loaded sermon
       * rather than a fresh read: a base read moments before the write compares the
       * server with itself and always agrees, so nothing is ever detected. Without a
       * base at all the save replaced the whole field, erasing every point stored
       * since this page loaded.
       */
      // Initialize once. Re-reading the optimistic screen after a failed overlapping
      // save would certify an uncommitted point as stored, so the next merge could
      // interpret its server-side absence as a deletion and discard it.
      let saveState = outlineSaveStateRef.current;
      if (!saveState || saveState.sermonId !== sermon.id) {
        saveState = {
          sermonId: sermon.id,
          nextSequence: 0,
          confirmedSequence: 0,
          confirmedOutline: {
            introduction: [...(sermon.outline?.introduction || [])],
            main: [...(sermon.outline?.main || [])],
            conclusion: [...(sermon.outline?.conclusion || [])]
          },
        };
        outlineSaveStateRef.current = saveState;
      }
      const baseOutline = saveState.confirmedOutline;
      const saveSequence = ++saveState.nextSequence;

      // 3. insert new point at specified index
      const sectionPoints = updatedOutline[sectionId as keyof SermonOutline] || [];
      if (index >= sectionPoints.length) {
        sectionPoints.push(newPoint);
      } else {
        sectionPoints.splice(index, 0, newPoint);
      }
      updatedOutline[sectionId as keyof SermonOutline] = sectionPoints;

      // 4. Update local sermon state
      setSermon(prev => prev ? { ...prev, outline: updatedOutline } : null);

      // 5. Save to backend

      // The legacy flag routes a refused automatic edit to the shared recovery surface.
      const savedOutline = await structureWriter.updateSermonOutline(sermon.id, updatedOutline, baseOutline, 'preferMine');
      // Only a newer SUCCESS may advance the base. A newer request that failed does
      // not block this late answer, while an older delayed answer cannot roll back a
      // baseline already confirmed by a newer successful save.
      const currentSaveState = outlineSaveStateRef.current;
      if (
        currentSaveState?.sermonId === sermon.id
        && saveSequence > currentSaveState.confirmedSequence
      ) {
        currentSaveState.confirmedOutline = savedOutline ?? updatedOutline;
        currentSaveState.confirmedSequence = saveSequence;
      }

    } catch (error) {
      console.error('Error adding outline point:', error);
      toast.error(t(TRANSLATION_KEYS.ERRORS.SAVE_OUTLINE_ERROR, { defaultValue: 'Failed to save structure' }));
    }
  };

  const onDragEndWrapper = (event: DragEndEvent) => {
    const activeKey = String(event.active?.id ?? "");
    const operation = handleDragEnd(event);
    // DnD owns rollback/refusal. Review changes only after its actual capture succeeds.
    void awaitWriteOperation(operation, () => undefined).then(acceptance => {
      if (acceptance?.kind !== 'skipped' && activeKey) handlePlacementCaptured(activeKey, containersRef.current);
    }).catch(() => undefined);
  };

  // Add loading and error handling based on the hook's state
  if (loading) {
    return <StructurePageSkeleton isFocusMode={!!focusedColumn} />;
  }

  if (error) {
    return <div role="alert" className="space-y-3 p-4">
      <p className="text-red-500">{t('errors.fetchSermonStructureError')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={retry} className="rounded-lg bg-blue-600 px-4 py-2 text-white">{t('buttons.retry')}</button>
        <TechnicalDetailsButton />
      </div>
    </div>;
  }

  if (!sermon) {
    return <div className="p-4">{isClient ? t('structure.sermonNotFound') : "Sermon not found"}</div>;
  }

  return (
    <ScriptureLinksInWindow writtenIn={sermonLanguage(sermon)} toBible={false}>
    <div className="px-4 pb-4">
      {/* `empty:hidden`: a silent status leaves no margin behind. */}
      <div className="mb-4 empty:hidden">{syncStatus}</div>
      <div className={`w-full`}>
        {/* One calm toolbar: back + quiet title (left), section toggles + layout (right).
            The big gradient title was dropped — breadcrumbs already carry the sermon path. */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={`/sermons/${sermon.id}`}
              className="whitespace-nowrap text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              {t('structure.backToSermon')}
            </Link>
            <span className="hidden h-4 w-px bg-gray-200 dark:bg-gray-700 sm:block" aria-hidden="true" />
            <h1 className="min-w-0 truncate text-base font-semibold text-gray-800 dark:text-gray-100 md:text-lg">
              <span className={`font-normal ${NEUTRAL_CAPTION}`}>{t('structure.title')} </span>
              <ScriptureText text={sermon.title} />
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <SectionVisibilityPills visibleSections={visibleSections} onToggle={toggleSection} />
            {/* Layout toggle (vertical/horizontal) — for 2+ columns (a pair can stack too); hidden on mobile */}
            {showLayoutToggle(visibleSections.length) && (
              <>
                <span className="mx-1 hidden h-5 w-px bg-gray-200 dark:bg-gray-700 md:block" aria-hidden="true" />
                <button
                  onClick={handleToggleLayout}
                  title={isVerticalLayout ? t('structure.switchToHorizontalLayout', { defaultValue: 'Switch to horizontal layout' }) : t('structure.switchToVerticalLayout', { defaultValue: 'Switch to vertical layout' })}
                  className="hidden items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/40 dark:hover:text-gray-200 md:inline-flex"
                  data-testid="layout-toggle-button"
                >
                  {isVerticalLayout ? (
                    // Horizontal layout icon (3 columns)
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="5" height="18" rx="1" />
                      <rect x="10" y="3" width="5" height="18" rx="1" />
                      <rect x="17" y="3" width="5" height="18" rx="1" />
                    </svg>
                  ) : (
                    // Vertical layout icon (stacked rows)
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="5" rx="1" />
                      <rect x="3" y="10" width="18" height="5" rx="1" />
                      <rect x="3" y="17" width="18" height="5" rx="1" />
                    </svg>
                  )}
                  <span>{isVerticalLayout ? t('structure.horizontalLayout', { defaultValue: 'Horizontal' }) : t('structure.verticalLayout', { defaultValue: 'Vertical' })}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {lockHistory}
        {readOnly ? <StructureReadOnlyBoard
          containers={containers}
          outlinePoints={outlinePoints}
          sections={visibleSections}
          titles={columnTitles}
          headerColors={requiredTagColors}
          isVerticalLayout={isVerticalLayout}
        /> : <DndContext
          data-testid="dnd-context"
          accessibility={dndAccessibility}
          sensors={dndSensors}
          collisionDetection={collisionDetector}
          onDragStart={(event) => { resetCollision(); onDragStartHook(event); }}
          onDragOver={onDragOverHook}
          onDragEnd={onDragEndWrapper}
          onDragCancel={onDragCancelHook}
        >
          <AmbiguousSection
            items={containers.ambiguous}
            isVisible={isAmbiguousVisible}
            onToggleVisibility={() => setIsAmbiguousVisible(!isAmbiguousVisible)}
            onEdit={handleEdit}
            onDelete={handleRemoveFromStructure}
            deletingItemId={null}
            activeId={dndActiveId}
            focusedColumn={focusedColumn}
            columnTitle={columnTitles["ambiguous"]}
          />

          <div className={`${boardLayoutClass(visibleSections.length, isVerticalLayout)} w-full mt-8`}>
            {/* Introduction column — shown if its section is visible */}
            {isSectionVisible("introduction") && (
              <Column
                key="introduction"
                id="introduction"
                title={getSectionLabel(t, 'introduction')}
                items={containers.introduction || []}
                headerColor={requiredTagColors.introduction}
                onEdit={handleEdit}
                outlinePoints={outlinePoints.introduction}
                showFocusButton={true}
                isFocusMode={isFocusMode}
                onToggleFocusMode={handleToggleFocusMode}
                onAiSortPoint={(outlinePointId) => requestAiSortForOutlinePoint("introduction", outlinePointId)}
                isLoading={isSorting}
                sortingOutlinePointId={sortingTarget?.columnId === "introduction" ? sortingTarget.outlinePointId ?? null : null}
                getExportContent={getExportContentForFocusedColumn}
                sermonId={sermonId || undefined}
                onAddThought={handleAddThoughtToSection}
                onAudioThoughtCreated={handleAudioThoughtCreated}
                onOutlineUpdate={handleOutlineUpdate}
                thoughtsPerSermonPoint={thoughtsPerSermonPoint}
                isDiffModeActive={isDiffModeActive}
                isApplyingSort={isApplyingSort}
                highlightedItems={highlightedItems}
                onKeepItem={handleKeepItem}
                onRevertItem={handleRevertItem}
                onKeepAll={handleKeepAll}
                onRevertAll={() => handleRevertAll("introduction")}
                activeId={dndActiveId}
                onMoveToAmbiguous={handleMoveToAmbiguous}
                onTogglePointLock={submitPointLockToggle}
                onToggleThoughtLock={submitThoughtLockToggle}
                onSwitchPage={handleSwitchToPlan}
                onNavigateToSection={navigateToSection}
                planData={planData}
                onOutlinePointDeleted={handleOutlinePointDeleted}
                onSubPointDeleted={handleSubPointDeleted}
                onAddOutlinePoint={handleAddOutlinePoint}
                showNotes
              />
            )}

            {/* Main column — shown if its section is visible */}
            {isSectionVisible("main") && (
              <Column
                key="main"
                id="main"
                title={getSectionLabel(t, 'main')}
                items={containers.main || []}
                headerColor={requiredTagColors.main}
                onEdit={handleEdit}
                outlinePoints={outlinePoints.main}
                showFocusButton={true}
                isFocusMode={isFocusMode}
                onToggleFocusMode={handleToggleFocusMode}
                onAiSortPoint={(outlinePointId) => requestAiSortForOutlinePoint("main", outlinePointId)}
                isLoading={isSorting}
                sortingOutlinePointId={sortingTarget?.columnId === "main" ? sortingTarget.outlinePointId ?? null : null}
                getExportContent={getExportContentForFocusedColumn}
                sermonId={sermonId || undefined}
                onAddThought={handleAddThoughtToSection}
                onAudioThoughtCreated={handleAudioThoughtCreated}
                onOutlineUpdate={handleOutlineUpdate}
                thoughtsPerSermonPoint={thoughtsPerSermonPoint}
                isDiffModeActive={isDiffModeActive}
                isApplyingSort={isApplyingSort}
                highlightedItems={highlightedItems}
                onKeepItem={handleKeepItem}
                onRevertItem={handleRevertItem}
                onKeepAll={handleKeepAll}
                onRevertAll={() => handleRevertAll("main")}
                activeId={dndActiveId}
                onMoveToAmbiguous={handleMoveToAmbiguous}
                onTogglePointLock={submitPointLockToggle}
                onToggleThoughtLock={submitThoughtLockToggle}
                onSwitchPage={handleSwitchToPlan}
                onNavigateToSection={navigateToSection}
                planData={planData}
                onOutlinePointDeleted={handleOutlinePointDeleted}
                onSubPointDeleted={handleSubPointDeleted}
                onAddOutlinePoint={handleAddOutlinePoint}
                showNotes
              />
            )}
            {isSectionVisible("conclusion") && (
              <Column
                key="conclusion"
                id="conclusion"
                title={getSectionLabel(t, 'conclusion')}
                items={containers.conclusion || []}
                headerColor={requiredTagColors.conclusion}
                onEdit={handleEdit}
                outlinePoints={outlinePoints.conclusion}
                showFocusButton={true}
                isFocusMode={isFocusMode}
                onToggleFocusMode={handleToggleFocusMode}
                onAiSortPoint={(outlinePointId) => requestAiSortForOutlinePoint("conclusion", outlinePointId)}
                isLoading={isSorting}
                sortingOutlinePointId={sortingTarget?.columnId === "conclusion" ? sortingTarget.outlinePointId ?? null : null}
                getExportContent={getExportContentForFocusedColumn}
                sermonId={sermonId || undefined}
                onAddThought={handleAddThoughtToSection}
                onAudioThoughtCreated={handleAudioThoughtCreated}
                onOutlineUpdate={handleOutlineUpdate}
                thoughtsPerSermonPoint={thoughtsPerSermonPoint}
                isDiffModeActive={isDiffModeActive}
                isApplyingSort={isApplyingSort}
                highlightedItems={highlightedItems}
                onKeepItem={handleKeepItem}
                onRevertItem={handleRevertItem}
                onKeepAll={handleKeepAll}
                onRevertAll={() => handleRevertAll("conclusion")}
                activeId={dndActiveId}
                onMoveToAmbiguous={handleMoveToAmbiguous}
                onTogglePointLock={submitPointLockToggle}
                onToggleThoughtLock={submitThoughtLockToggle}
                onSwitchPage={handleSwitchToPlan}
                onNavigateToSection={navigateToSection}
                planData={planData}
                onOutlinePointDeleted={handleOutlinePointDeleted}
                onSubPointDeleted={handleSubPointDeleted}
                onAddOutlinePoint={handleAddOutlinePoint}
                showNotes
              />
            )}
          </div>
          <DragOverlay>
            {activeDragItem ? (
              <SortableItemPreview
                item={activeDragItem.item}
                containerId={activeDragItem.containerId}
                isLocked={Boolean(activeDragItem.item.isLocked)}
              />
            ) : null}
          </DragOverlay>
        </DndContext>}
        {editingItem && !readOnly && (
          <EngineThoughtModal key={editingItem.id} sermonId={sermonId}
            thoughtId={addingThoughtToSection ? undefined : editingItem.id}
            initialOutlinePointId={addingThoughtToSection ? editingItem.outlinePointId ?? undefined : undefined}
            boardSection={normalizeVisualSectionKey(addingThoughtToSection ?? Object.keys(containers).find(section =>
              containers[section].some(item => item.id === editingItem.id))) ?? 'ambiguous'}
            allowedTags={allowedTags} onClose={handleCloseEdit} />
        )}
      </div>
      {confirmDialog}
    </div>
    </ScriptureLinksInWindow>
  );
}
