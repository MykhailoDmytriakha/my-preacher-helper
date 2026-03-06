
import { type DropResult } from "@hello-pangea/dnd";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  generateSermonPointsForSection,
  getSermonOutline,
  updateSermonOutline,
} from "@/services/outline.service";

import { OUTLINE_SAVE_DEBOUNCE_MS } from "./constants";
import { mapColumnIdToSectionType } from "./utils";

import type { Translate } from "./types";
import type { SermonOutline, SermonPoint } from "@/models/models";

interface UseColumnOutlineStateOptions {
  id: string;
  sermonId?: string;
  initialSermonPoints: SermonPoint[];
  isOnline: boolean;
  onOutlineUpdate?: (updatedOutline: SermonOutline) => void;
  onOutlinePointDeleted?: (pointId: string, columnId: string) => void;
  onAddOutlinePoint?: (sectionId: string, index: number, text: string) => Promise<void>;
  scheduleTask?: (callback: () => void | Promise<void>, delayMs: number) => ReturnType<typeof setTimeout>;
  clearScheduledTask?: (taskId: ReturnType<typeof setTimeout>) => void;
  t: Translate;
}

export function useColumnOutlineState({
  id,
  sermonId,
  initialSermonPoints,
  isOnline,
  onOutlineUpdate,
  onOutlinePointDeleted,
  onAddOutlinePoint,
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
  const editInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const insertInputRef = useRef<HTMLInputElement>(null);

  const pointToDeleteDetail = localSermonPoints.find((point) => point.id === deletePointId);

  useEffect(() => {
    setLocalSermonPoints(initialSermonPoints);
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

        await updateSermonOutline(sermonId, outlineToSave);
        onOutlineUpdate?.(outlineToSave);
        toast.success(t("structure.outlineSavedSuccess", { defaultValue: "SermonOutline saved" }));
      } catch (error) {
        console.error("Error saving sermon outline:", error);
        toast.error(t("errors.saveOutlineError", { defaultValue: "Failed to save outline" }));
      } finally {
        if (saveTimeoutRef.current) {
          clearScheduledTask(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
      }
    }, OUTLINE_SAVE_DEBOUNCE_MS);
  };

  const startAddingNewPoint = () => {
    setAddingNewPoint(true);
    setEditingPointId(null);
  };

  const cancelAddingNewPoint = () => {
    setAddingNewPoint(false);
    setNewPointText("");
  };

  const handleAddPoint = () => {
    if (!newPointText.trim()) {
      setAddingNewPoint(false);
      return;
    }

    const newPoint: SermonPoint = {
      id: `new-${Date.now().toString()}`,
      text: newPointText.trim(),
    };

    const updatedPoints = [...localSermonPoints, newPoint];
    setLocalSermonPoints(updatedPoints);
    setNewPointText("");
    setAddingNewPoint(false);
    triggerSaveOutline(updatedPoints);
  };

  const handleStartEdit = (point: SermonPoint) => {
    setEditingPointId(point.id);
    setEditingText(point.text);
    setAddingNewPoint(false);
  };

  const handleCancelEdit = () => {
    setEditingPointId(null);
    setEditingText("");
  };

  const handleSaveEdit = () => {
    if (!editingPointId || !editingText.trim()) {
      handleCancelEdit();
      return;
    }

    const updatedPoints = localSermonPoints.map((point) =>
      point.id === editingPointId ? { ...point, text: editingText.trim() } : point
    );

    setLocalSermonPoints(updatedPoints);
    handleCancelEdit();
    triggerSaveOutline(updatedPoints);
  };

  const handleSaveEditDirect = (pointId: string, newText: string) => {
    if (!newText.trim()) return;

    const updatedPoints = localSermonPoints.map((point) =>
      point.id === pointId ? { ...point, text: newText.trim() } : point
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

    if (!textToSave.trim() || !onAddOutlinePoint) {
      if (specificText === undefined) {
        closeInsertPointForm();
      } else {
        cancelAddingNewPoint();
      }
      return;
    }

    try {
      await onAddOutlinePoint(id, index, textToSave);
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
    if (!sermonId) return;

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

  return {
    localSermonPoints,
    editingPointId,
    editingText,
    setEditingText,
    addingNewPoint,
    newPointText,
    setNewPointText,
    insertPointIndex,
    insertPointText,
    setInsertPointText,
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
    confirmDeletePoint,
    openInsertPointForm,
    closeInsertPointForm,
    handleInsertSave,
    handleDragEnd,
    handleGenerateSermonPoints,
  };
}
