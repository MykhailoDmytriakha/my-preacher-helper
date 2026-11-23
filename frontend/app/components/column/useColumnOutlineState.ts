
import { type DropResult } from "@hello-pangea/dnd";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useNewOutlineTitleDraft, useOutlineTitleDraft } from "@/components/plan-editor/OutlineTitleDrafts";
import { useStructureWriter } from "@/components/sermon/structureWriter";
import { isInactiveEditorError } from "@/data-engine/react.client";
import {
  generateSermonPointsForSection,
} from "@/services/outline.service";
import { newClientId } from "@/utils/clientId";
import { OutlineCapture } from "@/utils/outlineCapture";
import { capitalizeFirstLetter, changedCapitalizedTitle, normalizeCapitalizedTitle } from "@/utils/textNormalization";
import { writeFailureTranslationKey } from '@/utils/writeRecovery';

import { mapColumnIdToSectionType } from "./utils";

import type { AddOutlinePoint, SectionType, Translate } from "./types";
import type { SermonOutline, SermonPoint, SubPoint } from "@/models/models";
import type { OutlineTitleOpening, OutlineTitleVersion } from "@/utils/sermonNoteText";

const SAVE_OUTLINE_ERROR_KEY = "errors.saveOutlineError";

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

const sectionOutline = (field: keyof SermonOutline, points: SermonPoint[]): SermonOutline => ({
  introduction: [], main: [], conclusion: [], [field]: points,
});

interface UseColumnOutlineStateOptions {
  id: string;
  sermonId?: string;
  initialSermonPoints: SermonPoint[];
  onOutlineUpdate?: (updatedOutline: SermonOutline) => void;
  onOutlinePointDeleted?: (pointId: string, columnId: string) => void;
  onSubPointDeleted?: (outlinePointId: string, subPointId: string, columnId: string) => void;
  onAddOutlinePoint?: AddOutlinePoint;
  onAiSuccess?: () => Promise<void> | void;
  aiBlocked?: boolean;
  scheduleTask?: (callback: () => void | Promise<void>, delayMs: number) => ReturnType<typeof setTimeout>;
  t: Translate;
}

export function useColumnOutlineState({
  id,
  sermonId,
  initialSermonPoints = EMPTY_SERMON_POINTS,
  onOutlineUpdate,
  onOutlinePointDeleted,
  onSubPointDeleted,
  onAddOutlinePoint,
  onAiSuccess,
  aiBlocked = false,
  scheduleTask = setTimeout,
  t,
}: UseColumnOutlineStateOptions) {
  const writer = useStructureWriter();
  const [editingPointId, setEditingPointId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const openingTitle = useRef("");
  const [addingNewPoint, setAddingNewPoint] = useState(false);
  const [newPointText, setNewPointText] = useState("");
  const [insertPointIndex, setInsertPointIndex] = useState<number | null>(null);
  const [insertPointText, setInsertPointText] = useState("");
  const [isGeneratingSermonPoints, setIsGeneratingSermonPoints] = useState(false);
  const [localSermonPoints, setLocalSermonPoints] = useState<SermonPoint[]>(initialSermonPoints);
  const [deletePointId, setDeletePointId] = useState<string | null>(null);

  const sectionType = mapColumnIdToSectionType(id);
  const field = sectionType ? SECTION_FIELD_BY_TYPE[sectionType] : 'main';
  const incomingOutline = useMemo(() => sectionOutline(field, initialSermonPoints), [field, initialSermonPoints]);
  const captureOwner = useMemo(() => ({ capture: new OutlineCapture(writer, sermonId ?? '', 'preferMine'), active: true }), [writer, sermonId, id]);
  const editInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const insertInputRef = useRef<HTMLInputElement>(null);

  const titleDraft = useOutlineTitleDraft(localSermonPoints.some(point => point.id === editingPointId) ? editingPointId : null);
  const newPointDraft = useNewOutlineTitleDraft('point', addingNewPoint);
  const insertedPointDraft = useNewOutlineTitleDraft('point', insertPointIndex !== null && insertPointIndex < localSermonPoints.length);
  const creationText = useRef({ newPointText, insertPointText });
  creationText.current = { newPointText, insertPointText };
  const pendingCreations = useRef(new Map<string, { text: string }>());
  const pointToDeleteDetail = localSermonPoints.find((point) => point.id === deletePointId);

  // The exact base object stays stable until this view adopts a parent or a returned section.
  const baseOutlineRef = useRef<SermonOutline>(incomingOutline);
  useLayoutEffect(() => {
    captureOwner.active = true;
    return () => { captureOwner.active = false; captureOwner.capture.observeView({}); };
  }, [captureOwner]);
  useLayoutEffect(() => { captureOwner.capture.observeView(incomingOutline); }, [captureOwner, incomingOutline]);
  useEffect(() => {
    setLocalSermonPoints(initialSermonPoints);
    baseOutlineRef.current = incomingOutline;
  }, [initialSermonPoints, incomingOutline]);

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

  /**
   * ON THE ENGINE THE EDIT IS HANDED OVER AT ONCE (BUG-20261010-column-outline-save-cancelled-on-leave).
   *
   * The column used to wait a pause and read the plan before handing an edit over, and leaving the
   * board — or the screen going dark — in that window cancelled the timer: the edit never left the
   * screen. The engine writer keeps a change on this device the moment it is handed over and sends it
   * itself, hidden page or not, as the plan editor and the board already rely on.
   *
   * No read first: only this column's section is known here, so the other two go in as the same empty
   * placeholder on both sides of the merge — unchanged — and the document keeps what it holds.
   */
  const triggerSaveOutline = (updatedPoints: SermonPoint[], titleOpening?: OutlineTitleOpening) => {
    if (!sermonId) return;
    if (!sectionType) {
      console.error("Cannot save outline: Invalid section ID", id);
      return;
    }
    const intended = sectionOutline(field, updatedPoints);
    return captureOwner.capture.schedule({ outline: intended, base: baseOutlineRef.current, titleOpening, begin: () => ({
      stored: (saved, sameView) => {
        if (!captureOwner.active || !sameView) return;
        const committedPoints = saved[field];
        baseOutlineRef.current = sectionOutline(field, committedPoints);
        setLocalSermonPoints(committedPoints);
        onOutlineUpdate?.(saved);
      },
      failed: error => {
        if (!captureOwner.active && isInactiveEditorError(error)) return;
        console.error("Error saving sermon outline:", error);
        toast.error(t(writeFailureTranslationKey(error, SAVE_OUTLINE_ERROR_KEY)));
      },
    }) });
  };

  const startAddingNewPoint = () => {
    newPointDraft.open();
    setNewPointText("");
    setAddingNewPoint(true);
    setEditingPointId(null);
  };

  const setCapitalizedEditingText = (value: string) => {
    titleDraft.change(value);
    setEditingText(capitalizeFirstLetter(value));
  };

  const setCapitalizedNewPointText = (value: string) => {
    newPointDraft.change(value);
    setNewPointText(capitalizeFirstLetter(value));
  };

  const setCapitalizedInsertPointText = (value: string) => {
    insertedPointDraft.change(value);
    setInsertPointText(capitalizeFirstLetter(value));
  };

  const closeAddingNewPoint = () => {
    setAddingNewPoint(false);
    setNewPointText("");
  };
  const cancelAddingNewPoint = () => {
    newPointDraft.cancel();
    closeAddingNewPoint();
  };

  const handleAddPoint = () => {
    const textToSave = normalizeCapitalizedTitle(newPointText);
    if (!textToSave) {
      setAddingNewPoint(false);
      return;
    }

    const newPoint: SermonPoint = {
      id: newPointDraft.id() ?? newClientId(),
      text: textToSave,
    };

    const updatedPoints = [...localSermonPoints, newPoint];
    setLocalSermonPoints(updatedPoints);
    closeAddingNewPoint();
    newPointDraft.handoff(triggerSaveOutline(updatedPoints), textToSave);
  };

  const handleStartEdit = (point: SermonPoint) => {
    openingTitle.current = point.text;
    const displayed = capitalizeFirstLetter(point.text);
    titleDraft.open({ target: { kind: 'point', id: point.id }, text: point.text }, displayed);
    setEditingPointId(point.id);
    setEditingText(displayed);
    setAddingNewPoint(false);
  };

  const closeEdit = () => {
    setEditingPointId(null);
    setEditingText("");
  };

  const handleCancelEdit = () => {
    titleDraft.cancel();
    closeEdit();
  };

  const handleSaveEdit = () => {
    const textToSave = changedCapitalizedTitle(editingText, capitalizeFirstLetter(openingTitle.current));
    if (!editingPointId || !textToSave) {
      handleCancelEdit();
      return;
    }

    titleDraft.handoff(handleSaveEditDirect(editingPointId, textToSave, openingTitle.current, titleDraft.opening()?.version));
    closeEdit();
  };

  const handleSaveEditDirect = (pointId: string, newText: string, openingText?: string, version?: OutlineTitleVersion) => {
    const textToSave = normalizeCapitalizedTitle(newText);
    if (!textToSave) return;

    const updatedPoints = localSermonPoints.map((point) =>
      point.id === pointId ? { ...point, text: textToSave } : point
    );

    if (openingText === undefined) setLocalSermonPoints(updatedPoints);
    return triggerSaveOutline(updatedPoints, openingText === undefined ? undefined : {
      target: { kind: 'point', id: pointId }, text: openingText, ...(version && { version }),
    });
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

  const finishInsertPoint = () => {
    setInsertPointIndex(null);
    setInsertPointText("");
  };
  const closeInsertPointForm = () => {
    insertedPointDraft.cancel();
    finishInsertPoint();
  };

  const openInsertPointForm = (index: number) => {
    insertedPointDraft.open();
    setInsertPointIndex(index);
    setInsertPointText("");
    scheduleTask(() => insertInputRef.current?.focus(), 10);
  };

  const handleInsertSave = async (index: number, specificText?: string) => {
    const inserting = specificText === undefined;
    const entered = specificText ?? insertPointText;
    const normalizedText = normalizeCapitalizedTitle(entered);
    const draft = inserting ? insertedPointDraft : newPointDraft;
    const pointId = draft.id();
    if (!normalizedText) {
      if (inserting) closeInsertPointForm();
      else cancelAddingNewPoint();
      return;
    }
    if (!onAddOutlinePoint) return;
    const attempt = { text: normalizedText };
    if (pointId) {
      if (pendingCreations.current.get(pointId)?.text === normalizedText) return;
      pendingCreations.current.set(pointId, attempt);
    }
    try {
      const writing = pointId ? onAddOutlinePoint(id, index, normalizedText, pointId) : onAddOutlinePoint(id, index, normalizedText);
      draft.handoff(writing, normalizedText);
      await writing;
      const currentText = inserting ? creationText.current.insertPointText : creationText.current.newPointText;
      if (draft.id() !== pointId) return;
      if (pointId && (pendingCreations.current.get(pointId) !== attempt || currentText !== entered)) return;
      if (inserting) finishInsertPoint();
      else closeAddingNewPoint();
    } catch {
      toast.error(t("structure.saveError", { defaultValue: "Failed to save structure point" }));
    } finally {
      if (pointId && pendingCreations.current.get(pointId) === attempt) pendingCreations.current.delete(pointId);
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
            defaultValue: "Failed to generate structure points",
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
          defaultValue: "Structure points generated successfully",
          count: newPoints.length,
        })
      );
    } catch (error) {
      console.error("Error generating outline points:", error);
      toast.error(
        t("structure.generateSermonPointsError", {
          defaultValue: "Failed to generate structure points",
        })
      );
    } finally {
      setIsGeneratingSermonPoints(false);
    }
  };

  // --- Sub-point operations ---

  const handleAddSubPoint = (outlinePointId: string, text: string, subPointId?: string) => {
    const textToSave = normalizeCapitalizedTitle(text);
    if (!textToSave) return;

    const updatedPoints = localSermonPoints.map((point) => {
      if (point.id !== outlinePointId) return point;
      const existing = point.subPoints ?? [];
      const maxPos = existing.length > 0
        ? Math.max(...existing.map((sp) => sp.position))
        : 0;
      const newSubPoint: SubPoint = {
        id: subPointId ?? `sp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: textToSave,
        position: maxPos + 1000,
      };
      return { ...point, subPoints: [...existing, newSubPoint] };
    });

    setLocalSermonPoints(updatedPoints);
    return triggerSaveOutline(updatedPoints);
  };

  const handleEditSubPoint = (outlinePointId: string, subPointId: string, newText: string, openingText?: string, version?: OutlineTitleVersion) => {
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

    if (openingText === undefined) setLocalSermonPoints(updatedPoints);
    return triggerSaveOutline(updatedPoints, openingText === undefined ? undefined : {
      target: { kind: 'subpoint', id: subPointId }, text: openingText, ...(version && { version }),
    });
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
