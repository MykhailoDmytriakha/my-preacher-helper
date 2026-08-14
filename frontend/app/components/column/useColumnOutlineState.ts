
import { type DropResult } from "@hello-pangea/dnd";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  generateSermonPointsForSection,
  getSermonOutline,
  updateSermonOutline,
} from "@/services/outline.service";
import { newClientId } from "@/utils/clientId";
import { awaitAcceptance, persistedWrite, queuedMutation } from '@/utils/recoverableWrite';
import { capitalizeFirstLetter, normalizeCapitalizedTitle } from "@/utils/textNormalization";
import { writeFailureTranslationKey } from '@/utils/writeRecovery';

import { OUTLINE_SAVE_DEBOUNCE_MS } from "./constants";
import { mapColumnIdToSectionType } from "./utils";

import type { SectionType, Translate } from "./types";
import type { SermonOutline, SermonPoint, SubPoint } from "@/models/models";

/**
 * Section types and plan fields do NOT share a name: the middle one is `mainPart`
 * in the UI and `main` in the stored plan. Reading the committed section back needs
 * that translation, and getting it wrong loses the base silently.
 */
/**
 * ONE array for the missing-prop case. A fresh `[]` literal per render is a new
 * reference every time, so the sync effect below fires on every render and resets
 * both the visible list and the merge base — wiping text typed a moment ago.
 */
const EMPTY_SERMON_POINTS: SermonPoint[] = [];

const SECTION_FIELD_BY_TYPE: Record<SectionType, keyof SermonOutline> = {
  introduction: "introduction",
  mainPart: "main",
  conclusion: "conclusion",
};

interface UseColumnOutlineStateOptions {
  id: string;
  sermonId?: string;
  initialSermonPoints: SermonPoint[];
  isOnline: boolean;
  onOutlineUpdate?: (updatedOutline: SermonOutline) => void;
  onOutlinePointDeleted?: (pointId: string, columnId: string) => void;
  onSubPointDeleted?: (outlinePointId: string, subPointId: string, columnId: string) => void;
  onAddOutlinePoint?: (sectionId: string, index: number, text: string) => Promise<void>;
  onAiSuccess?: () => Promise<void> | void;
  aiBlocked?: boolean;
  scheduleTask?: (callback: () => void | Promise<void>, delayMs: number) => ReturnType<typeof setTimeout>;
  clearScheduledTask?: (taskId: ReturnType<typeof setTimeout>) => void;
  t: Translate;
}

export function useColumnOutlineState({
  id,
  sermonId,
  initialSermonPoints = EMPTY_SERMON_POINTS,
  isOnline,
  onOutlineUpdate,
  onOutlinePointDeleted,
  onSubPointDeleted,
  onAddOutlinePoint,
  onAiSuccess,
  aiBlocked = false,
  scheduleTask = setTimeout,
  clearScheduledTask = clearTimeout,
  t,
}: UseColumnOutlineStateOptions) {
  const [editingPointId, setEditingPointId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [addingNewPoint, setAddingNewPoint] = useState(false);
  const [newPointText, setNewPointText] = useState("");
  const [insertPointIndex, setInsertPointIndex] = useState<number | null>(null);
  const [insertPointText, setInsertPointText] = useState("");
  const [isGeneratingSermonPoints, setIsGeneratingSermonPoints] = useState(false);
  const [localSermonPoints, setLocalSermonPoints] = useState<SermonPoint[]>(initialSermonPoints);
  const [deletePointId, setDeletePointId] = useState<string | null>(null);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Counts scheduled saves, so an older one cannot cancel a newer one. */
  const saveGenerationRef = useRef(0);
  const editInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const insertInputRef = useRef<HTMLInputElement>(null);

  const pointToDeleteDetail = localSermonPoints.find((point) => point.id === deletePointId);

  /**
   * The points this column last KNEW to be stored — its base for merging.
   *
   * Reset together with the visible list: a new list arriving from above is what the
   * person now sees, so it is what their next edit is built on.
   */
  const baseSectionPointsRef = useRef<SermonPoint[]>(initialSermonPoints);

  useEffect(() => {
    setLocalSermonPoints(initialSermonPoints);
    baseSectionPointsRef.current = initialSermonPoints;
  }, [initialSermonPoints]);

  useEffect(() => {
    if (addingNewPoint && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [addingNewPoint]);

  useEffect(() => {
    if (editingPointId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingPointId]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearScheduledTask(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [clearScheduledTask]);

  const triggerSaveOutline = (updatedPoints: SermonPoint[]) => {
    if (!sermonId) return;
    if (!isOnline) {
      toast.error(t("errors.saveOutlineError", { defaultValue: "Failed to save outline" }));
      return;
    }

    if (saveTimeoutRef.current) {
      clearScheduledTask(saveTimeoutRef.current);
    }

    /**
     * Which save this is. The `finally` below used to clear whatever sat in the ref,
     * so a save that started earlier and finished later cancelled the timer of an
     * edit made SINCE — the text stayed on screen and never reached the server.
     */
    const generation = saveGenerationRef.current + 1;
    saveGenerationRef.current = generation;

    saveTimeoutRef.current = scheduleTask(async () => {
      try {
        const sectionType = mapColumnIdToSectionType(id);
        if (!sectionType) {
          console.error("Cannot save outline: Invalid section ID", id);
          return;
        }

        const currentOutline = await getSermonOutline(sermonId);
        const outlineToSave: SermonOutline = {
          introduction:
            sectionType === "introduction" ? updatedPoints : currentOutline?.introduction || [],
          main: sectionType === "mainPart" ? updatedPoints : currentOutline?.main || [],
          conclusion:
            sectionType === "conclusion" ? updatedPoints : currentOutline?.conclusion || [],
        };

        /**
         * WHAT THIS COLUMN STARTED FROM — so the write MERGES by point id instead of
         * replacing the whole plan.
         *
         * Without it a save from this view erased every point the column had never
         * seen: one added on the phone this morning disappeared when a point was
         * edited here in the afternoon, silently. The read above does NOT serve as a
         * base — it is the server's CURRENT state, and comparing the server with
         * itself always agrees, which is exactly the no-op the guard warns about
         * (conflictSafeUpdate.client.ts).
         *
         * Only THIS column's section carries a real base: the other two are passed
         * through untouched from the same read, so the merge sees them as unchanged
         * and keeps whatever is stored.
         */
        const openingPoints = baseSectionPointsRef.current;
        const baseOutline: SermonOutline = {
          introduction:
            sectionType === "introduction" ? openingPoints : currentOutline?.introduction || [],
          main: sectionType === "mainPart" ? openingPoints : currentOutline?.main || [],
          conclusion:
            sectionType === "conclusion" ? openingPoints : currentOutline?.conclusion || [],
        };

        // `preferMine`: this view has nowhere to hold a refused plan, and a refusal here
        // would become an error toast with the edit lost at the next reload.
        const request = updateSermonOutline(sermonId, outlineToSave, baseOutline, 'preferMine');
        const acceptance = await awaitAcceptance(
          typeof navigator !== 'undefined' && navigator.onLine === false
            ? queuedMutation(`outline:${sermonId}`, request)
            : persistedWrite(request),
          (error) => toast.error(t(writeFailureTranslationKey(error, 'errors.saveOutlineError')))
        );
        const saved = acceptance.kind === 'persisted' ? await request : outlineToSave;

        /**
         * THE BASE AND THE VISIBLE LIST MOVE TOGETHER — OR NOT AT ALL.
         *
         * The committed plan can legitimately hold MORE than we sent: a point added
         * on another device that the merge kept. Taking it into the base while the
         * list stays local puts the two out of step, and the next edit reads that gap
         * as an intention — a point in the base and missing from the list means
         * "deleted here" (`utils/mergeOutline.ts`), so the merge removes the other
         * device's point for good. The person only ever saw it disappear from screen.
         *
         * And nothing is adopted at all once a newer edit has been scheduled: with a
         * local list that never saw that point, adopting the base alone would delete
         * it on the next save. Keeping the OLDER base lets the merge re-add it.
         */
        if (generation !== saveGenerationRef.current) return;
        const committedSection = saved?.[SECTION_FIELD_BY_TYPE[sectionType]];
        const committedPoints = committedSection ?? updatedPoints;
        baseSectionPointsRef.current = committedPoints;
        setLocalSermonPoints(committedPoints);
        // Built here rather than forwarded from the writer: the other two sections
        // came from the same read that produced `outlineToSave`, and only THIS
        // section has a committed value worth carrying up.
        onOutlineUpdate?.({
          ...outlineToSave,
          [SECTION_FIELD_BY_TYPE[sectionType]]: committedPoints,
        });
      } catch (error) {
        console.error("Error saving sermon outline:", error);
        toast.error(t(writeFailureTranslationKey(error, "errors.saveOutlineError")));
      } finally {
        // ONLY if no newer save has been scheduled since this one started.
        if (generation === saveGenerationRef.current) {
          saveTimeoutRef.current = null;
        }
      }
    }, OUTLINE_SAVE_DEBOUNCE_MS);
  };

  const startAddingNewPoint = () => {
    setAddingNewPoint(true);
    setEditingPointId(null);
  };

  const setCapitalizedEditingText = (value: string) => {
    setEditingText(capitalizeFirstLetter(value));
  };

  const setCapitalizedNewPointText = (value: string) => {
    setNewPointText(capitalizeFirstLetter(value));
  };

  const setCapitalizedInsertPointText = (value: string) => {
    setInsertPointText(capitalizeFirstLetter(value));
  };

  const cancelAddingNewPoint = () => {
    setAddingNewPoint(false);
    setNewPointText("");
  };

  const handleAddPoint = () => {
    const textToSave = normalizeCapitalizedTitle(newPointText);
    if (!textToSave) {
      setAddingNewPoint(false);
      return;
    }

    const newPoint: SermonPoint = {
      id: newClientId(),
      text: textToSave,
    };

    const updatedPoints = [...localSermonPoints, newPoint];
    setLocalSermonPoints(updatedPoints);
    setNewPointText("");
    setAddingNewPoint(false);
    triggerSaveOutline(updatedPoints);
  };

  const handleStartEdit = (point: SermonPoint) => {
    setEditingPointId(point.id);
    setEditingText(capitalizeFirstLetter(point.text));
    setAddingNewPoint(false);
  };

  const handleCancelEdit = () => {
    setEditingPointId(null);
    setEditingText("");
  };

  const handleSaveEdit = () => {
    const textToSave = normalizeCapitalizedTitle(editingText);
    if (!editingPointId || !textToSave) {
      handleCancelEdit();
      return;
    }

    const updatedPoints = localSermonPoints.map((point) =>
      point.id === editingPointId ? { ...point, text: textToSave } : point
    );

    setLocalSermonPoints(updatedPoints);
    handleCancelEdit();
    triggerSaveOutline(updatedPoints);
  };

  const handleSaveEditDirect = (pointId: string, newText: string) => {
    const textToSave = normalizeCapitalizedTitle(newText);
    if (!textToSave) return;

    const updatedPoints = localSermonPoints.map((point) =>
      point.id === pointId ? { ...point, text: textToSave } : point
    );

    setLocalSermonPoints(updatedPoints);
    triggerSaveOutline(updatedPoints);
  };

  const handleSetPointNote = (pointId: string, note?: string) => {
    const updatedPoints = localSermonPoints.map((point) =>
      point.id === pointId ? { ...point, note } : point
    );

    setLocalSermonPoints(updatedPoints);
    triggerSaveOutline(updatedPoints);
  };

  const handleDeletePoint = (pointId: string) => {
    const updatedPoints = localSermonPoints.filter((point) => point.id !== pointId);
    setLocalSermonPoints(updatedPoints);

    if (editingPointId === pointId) {
      handleCancelEdit();
    }

    triggerSaveOutline(updatedPoints);
    onOutlinePointDeleted?.(pointId, id);
  };

  const confirmDeletePoint = () => {
    if (!deletePointId) return;
    handleDeletePoint(deletePointId);
    setDeletePointId(null);
  };

  const closeInsertPointForm = () => {
    setInsertPointIndex(null);
    setInsertPointText("");
  };

  const openInsertPointForm = (index: number) => {
    setInsertPointIndex(index);
    setInsertPointText("");
    scheduleTask(() => insertInputRef.current?.focus(), 10);
  };

  const handleInsertSave = async (index: number, specificText?: string) => {
    const textToSave = specificText !== undefined ? specificText : insertPointText;
    const normalizedText = normalizeCapitalizedTitle(textToSave);

    if (!normalizedText || !onAddOutlinePoint) {
      if (specificText === undefined) {
        closeInsertPointForm();
      } else {
        cancelAddingNewPoint();
      }
      return;
    }

    try {
      await onAddOutlinePoint(id, index, normalizedText);
      if (specificText === undefined) {
        closeInsertPointForm();
      } else {
        cancelAddingNewPoint();
      }
    } catch {
      toast.error(t("structure.saveError", { defaultValue: "Failed to save outline point" }));
    }
  };

  const handleDragEnd = (result: DropResult) => {
    const { source, destination } = result;

    if (!destination || destination.index === source.index) {
      return;
    }

    const updatedPoints = Array.from(localSermonPoints);
    const [removed] = updatedPoints.splice(source.index, 1);
    updatedPoints.splice(destination.index, 0, removed);

    setLocalSermonPoints(updatedPoints);
    triggerSaveOutline(updatedPoints);
  };

  const handleGenerateSermonPoints = async () => {
    if (aiBlocked || !sermonId) return;

    const sectionName = id === "main" ? "main" : id;

    try {
      setIsGeneratingSermonPoints(true);

      const newPoints = await generateSermonPointsForSection(
        sermonId,
        sectionName as "introduction" | "main" | "conclusion"
      );

      if (newPoints.length === 0) {
        toast.error(
          t("structure.generateSermonPointsError", {
            defaultValue: "Failed to generate outline points",
          })
        );
        return;
      }

      const updatedPoints = [...localSermonPoints, ...newPoints];
      setLocalSermonPoints(updatedPoints);
      triggerSaveOutline(updatedPoints);
      await onAiSuccess?.();

      toast.success(
        t("structure.outlinePointsGenerated", {
          defaultValue: "SermonOutline points generated successfully",
          count: newPoints.length,
        })
      );
    } catch (error) {
      console.error("Error generating outline points:", error);
      toast.error(
        t("structure.generateSermonPointsError", {
          defaultValue: "Failed to generate outline points",
        })
      );
    } finally {
      setIsGeneratingSermonPoints(false);
    }
  };

  // --- Sub-point operations ---

  const handleAddSubPoint = (outlinePointId: string, text: string) => {
    const textToSave = normalizeCapitalizedTitle(text);
    if (!textToSave) return;

    const updatedPoints = localSermonPoints.map((point) => {
      if (point.id !== outlinePointId) return point;
      const existing = point.subPoints ?? [];
      const maxPos = existing.length > 0
        ? Math.max(...existing.map((sp) => sp.position))
        : 0;
      const newSubPoint: SubPoint = {
        id: `sp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: textToSave,
        position: maxPos + 1000,
      };
      return { ...point, subPoints: [...existing, newSubPoint] };
    });

    setLocalSermonPoints(updatedPoints);
    triggerSaveOutline(updatedPoints);
  };

  const handleEditSubPoint = (outlinePointId: string, subPointId: string, newText: string) => {
    const textToSave = normalizeCapitalizedTitle(newText);
    if (!textToSave) return;

    const updatedPoints = localSermonPoints.map((point) => {
      if (point.id !== outlinePointId || !point.subPoints) return point;
      return {
        ...point,
        subPoints: point.subPoints.map((sp) =>
          sp.id === subPointId ? { ...sp, text: textToSave } : sp
        ),
      };
    });

    setLocalSermonPoints(updatedPoints);
    triggerSaveOutline(updatedPoints);
  };

  const handleSetSubPointNote = (outlinePointId: string, subPointId: string, note?: string) => {
    const updatedPoints = localSermonPoints.map((point) => {
      if (point.id !== outlinePointId || !point.subPoints) return point;
      return {
        ...point,
        subPoints: point.subPoints.map((sp) =>
          sp.id === subPointId ? { ...sp, note } : sp
        ),
      };
    });

    setLocalSermonPoints(updatedPoints);
    triggerSaveOutline(updatedPoints);
  };

  const handleDeleteSubPoint = (outlinePointId: string, subPointId: string) => {
    const updatedPoints = localSermonPoints.map((point) => {
      if (point.id !== outlinePointId || !point.subPoints) return point;
      return {
        ...point,
        subPoints: point.subPoints.filter((sp) => sp.id !== subPointId),
      };
    });

    setLocalSermonPoints(updatedPoints);
    triggerSaveOutline(updatedPoints);
    onSubPointDeleted?.(outlinePointId, subPointId, id);
  };

  const handleReorderSubPoints = (outlinePointId: string, sourceIndex: number, destinationIndex: number) => {
    if (sourceIndex === destinationIndex) return;

    const updatedPoints = localSermonPoints.map((point) => {
      if (point.id !== outlinePointId || !point.subPoints) return point;
      const reordered = Array.from(point.subPoints);
      const [removed] = reordered.splice(sourceIndex, 1);
      reordered.splice(destinationIndex, 0, removed);
      // Re-assign positions after reorder
      const repositioned = reordered.map((sp, idx) => ({
        ...sp,
        position: (idx + 1) * 1000,
      }));
      return { ...point, subPoints: repositioned };
    });

    setLocalSermonPoints(updatedPoints);
    triggerSaveOutline(updatedPoints);
  };

  return {
    localSermonPoints,
    editingPointId,
    editingText,
    setEditingText: setCapitalizedEditingText,
    addingNewPoint,
    newPointText,
    setNewPointText: setCapitalizedNewPointText,
    insertPointIndex,
    insertPointText,
    setInsertPointText: setCapitalizedInsertPointText,
    isGeneratingSermonPoints,
    deletePointId,
    setDeletePointId,
    pointToDeleteDetail,
    editInputRef,
    addInputRef,
    insertInputRef,
    startAddingNewPoint,
    cancelAddingNewPoint,
    handleAddPoint,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleSaveEditDirect,
    handleSetPointNote,
    confirmDeletePoint,
    openInsertPointForm,
    closeInsertPointForm,
    handleInsertSave,
    handleDragEnd,
    handleGenerateSermonPoints,
    // Sub-point operations
    handleAddSubPoint,
    handleEditSubPoint,
    handleSetSubPointNote,
    handleDeleteSubPoint,
    handleReorderSubPoints,
  };
}
