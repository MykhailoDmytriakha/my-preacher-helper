"use client";

import {
  type DraggableProvidedDragHandleProps,
} from "@hello-pangea/dnd";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  LayoutGrid,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AudioRecoveryPanel } from "@/components/audio-recorder/AudioRecorderControls";
import { AudioRecorder } from "@/components/AudioRecorder";
import OutlineBoard from "@/components/plan-editor/OutlineBoard";
import PointNote from "@/components/PointNote";
import AudioRecorderPortalBridge from "@/components/sermon/AudioRecorderPortalBridge";
import { useConnection } from "@/providers/ConnectionProvider";
import { composePlanFromScratch } from "@/services/scratch.service";
import { transcribeThoughtAudio } from "@/services/thought.service";
import { buildRecordingFilename, downloadBlobToDevice } from "@/utils/audioFormatUtils";
import { newClientId } from "@/utils/clientId";

import type { ComposedPlanOutline, ComposedPlanPoint } from "@/config/schemas/zod";
import type { OutlinePoint, ScratchNote, SermonOutline, SubPoint } from "@/models/models";

type SectionKey = "introduction" | "main" | "conclusion";
type ScratchView = "capture" | "board";
type ScratchPatch = {
  text?: string;
  section?: SectionKey | null;
};
type ScratchPlacement = {
  pointId: string;
  subPointId?: string;
};

interface ScratchPanelProps {
  sermonId: string;
  notes: ScratchNote[];
  outline?: SermonOutline;
  addScratchNote: (text: string, section?: SectionKey) => ScratchNote | null;
  restoreScratchNote: (note: ScratchNote) => ScratchNote | null;
  updateScratchNote: (noteId: string, patch: ScratchPatch) => void;
  deleteScratchNote: (noteId: string) => void;
  setScratchNoteSection: (noteId: string, section: SectionKey | null) => void;
  isScratchWritePending: boolean;
  scratchRevision: number;
  onApplyOutline: (outline: SermonOutline, consumedNoteIds: string[]) => void | Promise<void>;
  onOutlineChange: (outline: SermonOutline) => void | Promise<void>;
  isReadOnly?: boolean;
}

interface ScratchNoteCardProps {
  note: ScratchNote;
  isSelected?: boolean;
  isReadOnly?: boolean;
  isDragging?: boolean;
  sectionLabel?: string;
  dragHandleProps?: DraggableProvidedDragHandleProps | null;
  onSelect?: () => void;
  onEdit: (noteId: string, text: string) => void;
  onDelete: (noteId: string) => void;
  onUnplace?: (noteId: string) => void;
}

const SECTION_CONFIGS: { key: SectionKey; styleKey: "introduction" | "mainPart" | "conclusion" }[] = [
  { key: "introduction", styleKey: "introduction" },
  { key: "main", styleKey: "mainPart" },
  { key: "conclusion", styleKey: "conclusion" },
];

const EMPTY_OUTLINE: SermonOutline = {
  introduction: [],
  main: [],
  conclusion: [],
};

const NOTE_CARD_CLASS =
  "group rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-all duration-150 dark:border-gray-700 dark:bg-gray-800";
const PLAN_EDITOR_BUTTON_CLASS =
  "w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-500 dark:to-fuchsia-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:shadow-lg hover:scale-[1.01] active:scale-95 transition-all duration-200";
const COMPOSE_TIMEOUT_MS = 55_000;
const APPLY_SETTLE_TIMEOUT_MS = 8_000;
const SCRATCH_TOAST_OPTIONS = { position: "bottom-right" as const };

type StripScratchMetadataResult = {
  outline: SermonOutline;
  idMap: Map<string, string>;
};

function allComposedPoints(outline: ComposedPlanOutline | null): ComposedPlanPoint[] {
  if (!outline) return [];
  return [...outline.introduction, ...outline.main, ...outline.conclusion];
}

function getScratchSignature(notes: ScratchNote[]) {
  return notes.map((note) => [note.id, note.text, note.section ?? ""].join("\u0000")).join("\u0001");
}

function isOutlineEmpty(outline?: SermonOutline) {
  if (!outline) return true;
  return SECTION_CONFIGS.every(({ key }) => (outline[key] ?? []).length === 0);
}

function getOutlineSignature(outline?: SermonOutline | null) {
  return JSON.stringify(outline ?? EMPTY_OUTLINE);
}

function stripScratchMetadataWithIdMap(outline: ComposedPlanOutline): StripScratchMetadataResult {
  const idMap = new Map<string, string>();
  const cleanOutline = SECTION_CONFIGS.reduce<SermonOutline>((next, { key }) => {
    next[key] = outline[key].map(({ id, text, note, isReviewed, subPoints, scratchNoteId }) => {
      const pointId = scratchNoteId ? newClientId() : id;
      idMap.set(id, pointId);
      const cleanSubPoints = (subPoints ?? []).map((subPoint): SubPoint => {
        const subPointId = subPoint.scratchNoteId ? newClientId() : subPoint.id;
        idMap.set(subPoint.id, subPointId);
        const cleanSubPoint: SubPoint = {
          id: subPointId,
          text: subPoint.text,
          position: subPoint.position,
        };
        const cleanSubPointNote = subPoint.note?.trim();
        if (cleanSubPointNote) cleanSubPoint.note = cleanSubPointNote;
        return cleanSubPoint;
      });

      const point: OutlinePoint = {
        id: pointId,
        text,
      };
      const cleanNote = note?.trim();
      if (cleanNote) point.note = cleanNote;
      if (typeof isReviewed === "boolean") point.isReviewed = isReviewed;
      if (cleanSubPoints.length > 0) point.subPoints = cleanSubPoints;
      return point;
    });
    return next;
  }, { introduction: [], main: [], conclusion: [] });

  return { outline: cleanOutline, idMap };
}

function stripScratchMetadata(outline: ComposedPlanOutline): SermonOutline {
  return stripScratchMetadataWithIdMap(outline).outline;
}

function collectComposedScratchNoteIds(outline: ComposedPlanOutline | null): Set<string> {
  const noteIds = new Set<string>();
  if (!outline) return noteIds;

  allComposedPoints(outline).forEach((point) => {
    if (point.scratchNoteId) noteIds.add(point.scratchNoteId);
    (point.subPoints ?? []).forEach((subPoint) => {
      if (subPoint.scratchNoteId) noteIds.add(subPoint.scratchNoteId);
    });
  });

  return noteIds;
}

function remapPlacement(
  placement: ScratchPlacement,
  idMap?: Map<string, string> | null
): ScratchPlacement {
  const pointId = idMap?.get(placement.pointId) ?? placement.pointId;
  const subPointId = placement.subPointId
    ? idMap?.get(placement.subPointId) ?? placement.subPointId
    : undefined;

  return subPointId ? { pointId, subPointId } : { pointId };
}

function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

async function waitForSettleWithTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  try {
    const result = await Promise.race([promise.then(() => "settled" as const), timeoutPromise]);
    return result === "settled";
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function createVoiceRecoveryUrl(audioBlob: Blob | null) {
  if (!audioBlob || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }
  return URL.createObjectURL(audioBlob);
}

function revokeVoiceRecoveryUrl(audioUrl: string | null) {
  if (!audioUrl || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
    return;
  }
  URL.revokeObjectURL(audioUrl);
}

function toComposedOutline(outline?: SermonOutline): ComposedPlanOutline {
  const current = outline ?? EMPTY_OUTLINE;
  return SECTION_CONFIGS.reduce<ComposedPlanOutline>((next, { key }) => {
    next[key] = (current[key] ?? []).map((point) => ({
      ...point,
      subPoints: point.subPoints?.map((subPoint) => ({ ...subPoint })),
    }));
    return next;
  }, { introduction: [], main: [], conclusion: [] });
}

function cloneSermonOutline(outline?: SermonOutline): SermonOutline {
  const current = outline ?? EMPTY_OUTLINE;
  return SECTION_CONFIGS.reduce<SermonOutline>((next, { key }) => {
    next[key] = (current[key] ?? []).map((point) => ({
      ...point,
      subPoints: point.subPoints?.map((subPoint) => ({ ...subPoint })),
    }));
    return next;
  }, { introduction: [], main: [], conclusion: [] });
}

function appendNoteText(existingNote: string | undefined, scratchText: string) {
  return [existingNote, scratchText]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function appendScratchPlacementToOutline(
  outline: SermonOutline,
  placement: ScratchPlacement,
  scratchText: string
) {
  const cleanText = scratchText.trim();
  if (!cleanText) return false;

  for (const { key } of SECTION_CONFIGS) {
    const point = (outline[key] ?? []).find((item) => item.id === placement.pointId);
    if (!point) continue;

    if (placement.subPointId) {
      const subPoint = (point.subPoints ?? []).find((item) => item.id === placement.subPointId);
      if (!subPoint) return false;
      subPoint.note = appendNoteText(subPoint.note, cleanText);
      return true;
    }

    point.note = appendNoteText(point.note, cleanText);
    return true;
  }

  return false;
}

function getComposeNoticeKey(outline: ComposedPlanOutline) {
  const points = allComposedPoints(outline);
  const subPoints = points.flatMap((point) => point.subPoints ?? []);
  const composeItems = [...points, ...subPoints].filter((item) => item.source === "ai" || item.source === "manual");
  const aiCount = composeItems.filter((item) => item.source === "ai").length;
  const manualCount = composeItems.filter((item) => item.source === "manual").length;

  if (composeItems.length > 0 && aiCount === 0) return "scratch.board.composeSuccessAllManual";
  if (composeItems.length > 0 && manualCount === 0) return "scratch.board.composeSuccessAllAi";
  return "scratch.board.composeSuccessHybrid";
}

function ScratchNoteCard({
  note,
  isSelected = false,
  isReadOnly = false,
  isDragging = false,
  sectionLabel,
  dragHandleProps,
  onSelect,
  onEdit,
  onDelete,
  onUnplace,
}: ScratchNoteCardProps) {
  const { t } = useTranslation();

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onSelect) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  };

  const handleNoteChange = (nextNote: string | undefined) => {
    if (nextNote) {
      onEdit(note.id, nextNote);
      return;
    }
    onDelete(note.id);
  };

  const actionControls = !isReadOnly ? (
    <div className="flex shrink-0 items-center gap-1">
      {onUnplace && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onUnplace(note.id);
          }}
          className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          {t("scratch.board.unplace")}
        </button>
      )}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(note.id);
        }}
        className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-300"
        aria-label={t("scratch.card.delete")}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  ) : null;

  return (
    <div
      className={[
        NOTE_CARD_CLASS,
        onSelect ? "cursor-pointer" : "",
        isSelected ? "border-indigo-300 ring-2 ring-indigo-300/70 dark:border-indigo-400 dark:ring-indigo-500/50" : "",
        isDragging ? "shadow-lg ring-1 ring-indigo-300 dark:ring-indigo-500/60" : "",
      ].join(" ")}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      data-testid={`scratch-note-card-${note.id}`}
      aria-pressed={onSelect ? isSelected : undefined}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-2">
        {!isReadOnly && dragHandleProps && (
          <button
            type="button"
            {...dragHandleProps}
            className="flex shrink-0 cursor-grab touch-manipulation items-center justify-center rounded p-0.5 text-gray-400 transition hover:text-gray-600 active:cursor-grabbing dark:text-gray-500 dark:hover:text-gray-300"
            aria-label={t("common.dragToReorder")}
            onClick={(event) => event.stopPropagation()}
          >
            <Bars3Icon className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {sectionLabel && (
            <span className="mb-1.5 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-300">
              {t("scratch.card.placedIn", { section: sectionLabel })}
            </span>
          )}
          <div
            className="-mt-1"
            data-testid={`scratch-note-point-note-${note.id}`}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <PointNote
              note={note.text}
              onChange={handleNoteChange}
              isReadOnly={isReadOnly}
              addRevealClass="opacity-100"
              hideClearButton
              tone="neutral"
            />
          </div>
        </div>
        {actionControls}
      </div>
    </div>
  );
}

export default function ScratchPanel({
  sermonId,
  notes,
  outline,
  addScratchNote,
  restoreScratchNote,
  updateScratchNote,
  deleteScratchNote,
  isScratchWritePending,
  scratchRevision,
  onApplyOutline,
  onOutlineChange,
  isReadOnly = false,
}: ScratchPanelProps) {
  const { t } = useTranslation();
  const { isMagicAvailable } = useConnection();
  const [view, setView] = useState<ScratchView>("capture");
  const [capturePortal, setCapturePortal] = useState<HTMLDivElement | null>(null);
  const [isManualCaptureOpen, setIsManualCaptureOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState("");
  const [composedOutline, setComposedOutline] = useState<ComposedPlanOutline | null>(null);
  const [manualOutline, setManualOutline] = useState<SermonOutline | null>(null);
  const [composeNoticeKey, setComposeNoticeKey] = useState<string | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [placements, setPlacements] = useState<Record<string, ScratchPlacement>>({});
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceRetryCount, setVoiceRetryCount] = useState(0);
  const [voiceRecoveryUrl, setVoiceRecoveryUrl] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const isCaptureLocked = isReadOnly || isApplying;
  const isBoardLocked = isReadOnly || isApplying || isScratchWritePending;
  const scratchSignature = useMemo(() => getScratchSignature(notes), [notes]);
  const scratchRevisionRef = useRef(scratchRevision);
  const scratchWritePendingRef = useRef(isScratchWritePending);
  const scratchSignatureRef = useRef(scratchSignature);
  const scratchMutationLockedRef = useRef(isCaptureLocked);
  const isApplyingRef = useRef(isApplying);
  const localScratchChangeRef = useRef(0);
  const outlineRevisionRef = useRef(0);
  const pendingManualOutlineSignatureRef = useRef<string | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const storedVoiceBlobRef = useRef<Blob | null>(null);
  const voiceRecoveryUrlRef = useRef<string | null>(null);
  const composeRequestIdRef = useRef(0);

  scratchRevisionRef.current = scratchRevision;
  scratchWritePendingRef.current = isScratchWritePending;
  scratchSignatureRef.current = scratchSignature;
  scratchMutationLockedRef.current = isCaptureLocked;
  isApplyingRef.current = isApplying;

  const markScratchChanged = useCallback(() => {
    localScratchChangeRef.current += 1;
    scratchWritePendingRef.current = true;
  }, []);

  const replaceStoredVoiceBlob = useCallback((audioBlob: Blob | null) => {
    revokeVoiceRecoveryUrl(voiceRecoveryUrlRef.current);
    storedVoiceBlobRef.current = audioBlob;
    const nextUrl = createVoiceRecoveryUrl(audioBlob);
    voiceRecoveryUrlRef.current = nextUrl;
    setVoiceRecoveryUrl(nextUrl);
  }, []);

  useEffect(() => {
    return () => revokeVoiceRecoveryUrl(voiceRecoveryUrlRef.current);
  }, []);

  const hasExistingOutline = !isOutlineEmpty(outline);
  const hasBoardContent = notes.length > 0 || hasExistingOutline;
  const currentOutline = manualOutline ?? outline;
  const incomingOutlineSignature = useMemo(() => getOutlineSignature(outline), [outline]);
  const boardOutline = useMemo(
    () => composedOutline ?? toComposedOutline(currentOutline),
    [composedOutline, currentOutline]
  );
  const strippedProposedOutline = useMemo(
    () => (composedOutline ? stripScratchMetadataWithIdMap(composedOutline) : null),
    [composedOutline]
  );
  const cleanProposedOutline = strippedProposedOutline?.outline ?? null;
  const boardOutlineLookup = useMemo(() => {
    const pointIds = new Set<string>();
    const subPointParentById = new Map<string, string>();

    SECTION_CONFIGS.forEach(({ key }) => {
      (boardOutline[key] ?? []).forEach((point) => {
        pointIds.add(point.id);
        (point.subPoints ?? []).forEach((subPoint) => {
          subPointParentById.set(subPoint.id, point.id);
        });
      });
    });

    return { pointIds, subPointParentById };
  }, [boardOutline]);
  const pooledNotes = useMemo(
    () => notes.filter((note) => !placements[note.id]),
    [notes, placements]
  );
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const placementCount = Object.keys(placements).length;
  const hasPlacements = placementCount > 0;

  const canCompose =
    pooledNotes.length > 0 &&
    isMagicAvailable &&
    !isScratchWritePending &&
    !isComposing &&
    !isApplying &&
    !isReadOnly;

  const clearComposition = useCallback(() => {
    setComposedOutline(null);
    setComposeNoticeKey(null);
    setComposeError(null);
  }, []);

  useEffect(() => {
    if (isManualCaptureOpen) {
      manualInputRef.current?.focus();
    }
  }, [isManualCaptureOpen]);

  useEffect(() => {
    outlineRevisionRef.current += 1;
    setManualOutline((current) => {
      if (!current) {
        pendingManualOutlineSignatureRef.current = null;
        return null;
      }

      const pendingSignature = pendingManualOutlineSignatureRef.current;
      if (!pendingSignature || pendingSignature === incomingOutlineSignature) {
        pendingManualOutlineSignatureRef.current = null;
        return null;
      }

      return current;
    });
  }, [incomingOutlineSignature]);

  useEffect(() => {
    setPlacements((current) => {
      let changed = false;
      const next: Record<string, ScratchPlacement> = {};

      Object.entries(current).forEach(([noteId, placement]) => {
        const parentPointId = placement.subPointId
          ? boardOutlineLookup.subPointParentById.get(placement.subPointId)
          : placement.pointId;
        const isValidPoint = boardOutlineLookup.pointIds.has(placement.pointId);
        const isValidSubPoint = !placement.subPointId || parentPointId === placement.pointId;

        if (isValidPoint && isValidSubPoint) {
          next[noteId] = placement;
        } else {
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [boardOutlineLookup]);

  const handleAddManualNote = useCallback((text: string) => {
    if (scratchMutationLockedRef.current) return false;
    const note = addScratchNote(text);
    if (!note) return false;
    markScratchChanged();
    clearComposition();
    return true;
  }, [addScratchNote, clearComposition, markScratchChanged]);

  const collapseManualCapture = useCallback(() => {
    setManualDraft("");
    setIsManualCaptureOpen(false);
  }, []);

  const handleManualSubmit = useCallback(() => {
    const nextText = manualDraft.trim();
    if (!nextText) return;
    if (handleAddManualNote(nextText)) {
      setManualDraft("");
      manualInputRef.current?.focus();
      toast.success(t("scratch.capture.manualSuccess"), SCRATCH_TOAST_OPTIONS);
    } else {
      toast.error(t("scratch.capture.manualError"));
    }
  }, [handleAddManualNote, manualDraft, t]);

  const surfaceVoiceApplyRecovery = useCallback(() => {
    const message = t("scratch.voice.applyInProgress");
    setVoiceError(message);
    toast.error(message);
  }, [t]);

  const runVoiceTranscription = useCallback(
    async (audioBlob: Blob) => {
      if (isApplyingRef.current) {
        surfaceVoiceApplyRecovery();
        return;
      }

      replaceStoredVoiceBlob(audioBlob);
      setIsVoiceProcessing(true);
      setVoiceError(null);

      try {
        const result = await transcribeThoughtAudio(audioBlob);
        const polishedText = (result.polishedText || result.originalText || "").trim();
        if (!polishedText) {
          throw new Error("Empty transcription");
        }

        if (isApplyingRef.current) {
          surfaceVoiceApplyRecovery();
          return;
        }

        const note = addScratchNote(polishedText);
        if (!note) {
          const message = t("scratch.voice.error");
          setVoiceError(message);
          toast.error(message);
          return;
        }

        markScratchChanged();
        replaceStoredVoiceBlob(null);
        setVoiceRetryCount(0);
        clearComposition();
        toast.success(t("scratch.voice.success"), SCRATCH_TOAST_OPTIONS);
      } catch (error) {
        const message = error instanceof Error ? error.message : t("scratch.voice.error");
        setVoiceError(message);
        toast.error(t("scratch.voice.error"));
      } finally {
        setIsVoiceProcessing(false);
      }
    },
    [addScratchNote, clearComposition, markScratchChanged, replaceStoredVoiceBlob, surfaceVoiceApplyRecovery, t]
  );

  const handleVoiceComplete = useCallback(
    async (audioBlob: Blob) => {
      replaceStoredVoiceBlob(audioBlob);
      setVoiceRetryCount(0);
      await runVoiceTranscription(audioBlob);
    },
    [replaceStoredVoiceBlob, runVoiceTranscription]
  );

  const handleRetryVoice = useCallback(() => {
    const blob = storedVoiceBlobRef.current;
    if (!blob || isVoiceProcessing) return;
    replaceStoredVoiceBlob(blob);
    if (isApplyingRef.current) {
      surfaceVoiceApplyRecovery();
      return;
    }
    setVoiceRetryCount((count) => count + 1);
    void runVoiceTranscription(blob);
  }, [isVoiceProcessing, replaceStoredVoiceBlob, runVoiceTranscription, surfaceVoiceApplyRecovery]);

  const handleClearVoiceError = useCallback(() => {
    replaceStoredVoiceBlob(null);
    setVoiceError(null);
    setVoiceRetryCount(0);
  }, [replaceStoredVoiceBlob]);

  const handleRecordVoiceAgain = useCallback(() => {
    handleClearVoiceError();
    setView("capture");
  }, [handleClearVoiceError]);

  const handleDownloadVoiceRecovery = useCallback(() => {
    const blob = storedVoiceBlobRef.current;
    if (!blob) return;
    downloadBlobToDevice(blob, buildRecordingFilename(blob.type));
  }, []);

  const handleEditNote = useCallback(
    (noteId: string, text: string) => {
      if (scratchMutationLockedRef.current) return;
      markScratchChanged();
      updateScratchNote(noteId, { text });
      clearComposition();
    },
    [clearComposition, markScratchChanged, updateScratchNote]
  );

  const handleDeleteNote = useCallback(
    (noteId: string) => {
      if (scratchMutationLockedRef.current) return;
      const deletedNote = notes.find((note) => note.id === noteId);
      markScratchChanged();
      setPlacements((current) => {
        if (!current[noteId]) return current;
        const next = { ...current };
        delete next[noteId];
        return next;
      });
      deleteScratchNote(noteId);
      clearComposition();
      if (!deletedNote) return;

      toast.success(t("scratch.card.deleteSuccess"), {
        ...SCRATCH_TOAST_OPTIONS,
        action: {
          label: t("scratch.card.undoDelete"),
          onClick: () => {
            if (scratchMutationLockedRef.current) return;
            const restored = restoreScratchNote(deletedNote);
            if (!restored) return;
            markScratchChanged();
            clearComposition();
          },
        },
      });
    },
    [clearComposition, deleteScratchNote, markScratchChanged, notes, restoreScratchNote, t]
  );

  const handleScratchPlace = useCallback(
    (noteId: string, target: ScratchPlacement | null) => {
      if (isBoardLocked || !notes.some((note) => note.id === noteId)) return;

      const currentPlacement = placements[noteId];
      const isSamePlacement =
        currentPlacement?.pointId === target?.pointId &&
        currentPlacement?.subPointId === target?.subPointId;
      if (isSamePlacement) return;

      markScratchChanged();
      setPlacements((current) => {
        if (target === null) {
          const next = { ...current };
          delete next[noteId];
          return next;
        }
        return { ...current, [noteId]: target };
      });
    },
    [isBoardLocked, markScratchChanged, notes, placements]
  );

  const handleManualOutlineChange = useCallback(
    (nextOutline: SermonOutline) => {
      if (isBoardLocked) return;

      if (composedOutline) {
        setComposedOutline(toComposedOutline(nextOutline));
        setComposeError(null);
        return;
      }

      const cleanOutline = stripScratchMetadata(nextOutline as ComposedPlanOutline);
      outlineRevisionRef.current += 1;
      pendingManualOutlineSignatureRef.current = getOutlineSignature(cleanOutline);
      setManualOutline(cleanOutline);
      void Promise.resolve(onOutlineChange(cleanOutline)).catch((error) => {
        const message = error instanceof Error ? error.message : t("scratch.board.applyError");
        toast.error(message || t("scratch.board.applyError"));
      });
    },
    [composedOutline, isBoardLocked, onOutlineChange, t]
  );

  const handleCompose = async () => {
    if (!canCompose || isApplying) return;
    const requestId = composeRequestIdRef.current + 1;
    composeRequestIdRef.current = requestId;
    const composeRevision = scratchRevisionRef.current;
    const composeSignature = scratchSignatureRef.current;
    const composeLocalScratchChange = localScratchChangeRef.current;
    const composeOutlineRevision = outlineRevisionRef.current;
    setIsComposing(true);
    setComposeNoticeKey(null);
    setComposeError(null);

    const isLatestRequest = () => composeRequestIdRef.current === requestId;
    const isStillValid = () =>
      scratchRevisionRef.current === composeRevision &&
      scratchSignatureRef.current === composeSignature &&
      localScratchChangeRef.current === composeLocalScratchChange &&
      outlineRevisionRef.current === composeOutlineRevision &&
      !scratchWritePendingRef.current;

    const timeoutId = window.setTimeout(() => {
      if (!isLatestRequest()) return;
      const timeoutMessage = t("scratch.board.composeTimeout");
      composeRequestIdRef.current = requestId + 1;
      setIsComposing(false);
      setComposeError(timeoutMessage);
      toast.error(timeoutMessage);
    }, COMPOSE_TIMEOUT_MS);

    try {
      const outlineFromScratch = await composePlanFromScratch(
        sermonId,
        currentOutline,
        pooledNotes.map((note) => note.id)
      );

      if (!isLatestRequest()) {
        return;
      }
      if (!isStillValid()) {
        const staleMessage = t("scratch.board.composeStale");
        setComposeError(staleMessage);
        toast.error(staleMessage);
        return;
      }

      setComposedOutline(outlineFromScratch);
      setComposeNoticeKey(getComposeNoticeKey(outlineFromScratch));
      setComposeError(null);
    } catch (error) {
      if (!isLatestRequest()) return;
      const isTimeout =
        error instanceof Error &&
        (error.name === "FetchTimeoutError" || error.message.toLowerCase().includes("timed out"));
      const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
      const message = isOffline
        ? t("scratch.board.composeOffline")
        : isTimeout
        ? t("scratch.board.composeTimeout")
        : error instanceof Error
          ? error.message
          : t("scratch.board.composeError");
      const visibleMessage = message || t("scratch.board.composeError");
      setComposeError(visibleMessage);
      toast.error(visibleMessage);
    } finally {
      window.clearTimeout(timeoutId);
      if (isLatestRequest()) {
        setIsComposing(false);
      }
    }
  };

  const applyOutline = async () => {
    if (
      (!cleanProposedOutline && !hasPlacements) ||
      isScratchWritePending ||
      isVoiceProcessing ||
      isReadOnly ||
      isApplying
    ) return;

    setIsApplying(true);
    let didReportApplyError = false;
    const reportApplyError = (error: unknown) => {
      if (didReportApplyError) return;
      didReportApplyError = true;
      const message = error instanceof Error ? error.message : t("scratch.board.applyError");
      toast.error(message || t("scratch.board.applyError"));
    };

    try {
      const finalOutline = cloneSermonOutline(cleanProposedOutline ?? currentOutline);
      const consumedNoteIds = cleanProposedOutline
        ? collectComposedScratchNoteIds(composedOutline)
        : new Set<string>();
      const failedPlacementNoteIds: string[] = [];

      Object.entries(placements).forEach(([noteId, placement]) => {
        const note = notesById.get(noteId);
        if (!note) return;
        const finalPlacement = remapPlacement(placement, strippedProposedOutline?.idMap);
        if (appendScratchPlacementToOutline(finalOutline, finalPlacement, note.text)) {
          consumedNoteIds.add(noteId);
        } else {
          failedPlacementNoteIds.push(noteId);
        }
      });

      if (failedPlacementNoteIds.length > 0) {
        throw new Error(t("scratch.board.applyPlacementError"));
      }

      const persistApply = Promise.resolve(onApplyOutline(finalOutline, Array.from(consumedNoteIds)));
      void persistApply.catch(reportApplyError);

      let didOnlineWriteSettle = true;
      if (!isBrowserOffline()) {
        didOnlineWriteSettle = await waitForSettleWithTimeout(persistApply, APPLY_SETTLE_TIMEOUT_MS);
      }

      if (didReportApplyError) return;

      if (consumedNoteIds.size > 0) {
        markScratchChanged();
      }
      setPlacements({});
      clearComposition();
      // Apply supersedes any pending manual-edit draft: drop the local `manualOutline`
      // shadow so the board renders the freshly-applied outline (which already folded that
      // edit in) instead of keeping the stale pre-Apply draft until a remount. (Review r8.)
      setManualOutline(null);
      if (didOnlineWriteSettle) {
        toast.success(t("scratch.board.applySuccess"), SCRATCH_TOAST_OPTIONS);
      }
    } catch (error) {
      reportApplyError(error);
    } finally {
      setIsApplying(false);
    }
  };

  const handleApplyClick = () => {
    if (
      (!cleanProposedOutline && !hasPlacements) ||
      isScratchWritePending ||
      isVoiceProcessing ||
      isReadOnly ||
      isApplying
    ) return;
    void applyOutline();
  };

  const composeDisabledTitle = isScratchWritePending
    ? t("scratch.board.composePendingWrites")
    : !isMagicAvailable
      ? t("scratch.board.composeOffline")
      : pooledNotes.length === 0
        ? t("scratch.board.composeEmpty")
        : undefined;

  const hasApplicableOutlineChanges = Boolean(cleanProposedOutline) || hasPlacements;
  const applyDisabledTitle = isReadOnly
    ? t("scratch.board.applyReadOnly")
    : isVoiceProcessing
      ? t("scratch.board.applyVoiceProcessing")
      : isScratchWritePending
      ? t("scratch.board.applyPendingWrites")
      : !hasApplicableOutlineChanges
        ? t("scratch.board.applyNeedsProposal")
        : undefined;

  const renderManualCaptureControl = () => {
    return (
      <button
        type="button"
        onClick={() => {
          if (isCaptureLocked) return;
          setIsManualCaptureOpen(true);
          manualInputRef.current?.focus();
        }}
        className={[
          "flex min-w-0 flex-1 items-center justify-center gap-2 self-stretch rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-4 py-3 font-medium text-gray-700 dark:text-gray-200 shadow-sm transition-all duration-200 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70",
          isManualCaptureOpen ? "bg-gray-200 dark:bg-gray-700" : "",
        ].join(" ")}
        disabled={isCaptureLocked}
        title={t("scratch.capture.manualAdd")}
        aria-label={t("scratch.capture.manualAdd")}
        aria-expanded={isManualCaptureOpen}
      >
        <Pencil className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
        <span className="min-w-0 text-center leading-tight">{t("scratch.capture.manualAdd")}</span>
      </button>
    );
  };

  const renderManualCaptureForm = () => {
    if (!isManualCaptureOpen) return null;

    return (
      <form
        className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800/60 sm:p-4"
        onSubmit={(event) => {
          event.preventDefault();
          handleManualSubmit();
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="scratch-manual-note-input"
            className="text-sm font-semibold text-gray-800 dark:text-gray-100"
          >
            {t("scratch.capture.manualLabel")}
          </label>
          <button
            type="button"
            onClick={collapseManualCapture}
            className="rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="scratch-manual-note-input"
            ref={manualInputRef}
            type="text"
            value={manualDraft}
            onChange={(event) => {
              if (!isCaptureLocked) setManualDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                collapseManualCapture();
              }
            }}
            placeholder={t("scratch.capture.manualLabel")}
            aria-label={t("scratch.capture.manualLabel")}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-400 dark:focus:ring-violet-900/40"
            disabled={isCaptureLocked}
          />
          <button
            type="submit"
            disabled={!manualDraft.trim() || isCaptureLocked}
            className="inline-flex items-center justify-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-violet-600 dark:bg-violet-500 dark:hover:bg-violet-400"
          >
            {t("scratch.capture.add")}
          </button>
        </div>
      </form>
    );
  };

  const renderVoiceRecoveryPanel = () => (
    <AudioRecoveryPanel
      show={Boolean(voiceError && storedVoiceBlobRef.current && voiceRecoveryUrl)}
      audioUrl={voiceRecoveryUrl}
      errorMessage={voiceError}
      appliedVariant="standard"
      retryCount={voiceRetryCount}
      maxRetries={3}
      isProcessing={isVoiceProcessing || isApplying}
      onRetry={handleRetryVoice}
      onRecordAgain={handleRecordVoiceAgain}
      onDiscard={handleClearVoiceError}
      onDownload={handleDownloadVoiceRecovery}
      t={t}
      className="mb-4"
    />
  );

  const renderCapture = () => (
    <div className="grid grid-cols-1 gap-4">
      <section className="rounded-xl border border-gray-200 border-l-4 border-l-violet-400 bg-white p-4 shadow-sm shadow-gray-900/5 dark:border-gray-700 dark:border-l-violet-600 dark:bg-gray-900 dark:shadow-black/20 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-gray-950 dark:text-gray-100">
              {t("scratch.title")}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {t("scratch.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!isApplying) setView("board");
            }}
            disabled={!hasBoardContent || isApplying}
            className={`${PLAN_EDITOR_BUTTON_CLASS} disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 disabled:hover:scale-100 disabled:hover:shadow-sm`}
          >
            <LayoutGrid className="w-4 h-4 text-white/90" aria-hidden="true" />
            {t("scratch.capture.toBoard")}
          </button>
        </div>

        <div className="mb-4" ref={setCapturePortal} />
        <AudioRecorderPortalBridge
          RecorderComponent={AudioRecorder}
          portalTarget={capturePortal}
          onRecordingComplete={handleVoiceComplete}
          isProcessing={isVoiceProcessing}
          onRetry={handleRetryVoice}
          retryCount={voiceRetryCount}
          maxRetries={3}
          transcriptionError={null}
          onClearError={handleClearVoiceError}
          hideKeyboardShortcuts
          isReadOnly={isCaptureLocked}
          isRecorderDisabled={!isMagicAvailable || isCaptureLocked}
          isManualDisabled={isCaptureLocked}
          onOpenCreateModal={() => {
            if (!isCaptureLocked) setIsManualCaptureOpen(true);
          }}
          manualControl={renderManualCaptureControl()}
          manualThoughtTitle={t("scratch.capture.manualAdd")}
          manualButtonPlacement="right"
          manualButtonSeparate
        />
        {renderVoiceRecoveryPanel()}
        {renderManualCaptureForm()}

        {notes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {t("scratch.capture.empty")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {notes.map((note) => (
              <ScratchNoteCard
                key={note.id}
                note={note}
                isReadOnly={isCaptureLocked}
                sectionLabel={note.section ? t(`scratch.sections.${note.section}`) : undefined}
                onEdit={handleEditNote}
                onDelete={handleDeleteNote}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );

  const renderScratchNote = (
    note: ScratchNote,
    dragHandleProps: DraggableProvidedDragHandleProps | null | undefined
  ) => {
    const currentNote = notesById.get(note.id) ?? note;
    return (
      <ScratchNoteCard
        note={currentNote}
        isReadOnly={isBoardLocked}
        dragHandleProps={dragHandleProps}
        onEdit={handleEditNote}
        onDelete={handleDeleteNote}
        onUnplace={placements[currentNote.id] ? (noteId) => handleScratchPlace(noteId, null) : undefined}
      />
    );
  };

  const renderPoolHeader = () => (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("scratch.board.pool")}
        </h3>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {pooledNotes.length}
          </span>
          <button
            type="button"
            onClick={handleCompose}
            disabled={!canCompose}
            title={composeDisabledTitle}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-800 shadow-sm transition-all duration-200 hover:bg-violet-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-violet-50 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-200 dark:hover:bg-violet-900/40 sm:w-auto"
          >
            <Sparkles className={["h-4 w-4", isComposing ? "animate-spin" : ""].join(" ")} aria-hidden="true" />
            {isComposing ? t("scratch.board.composing") : t("scratch.board.compose")}
          </button>
        </div>
      </div>

      {composeNoticeKey && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          {t(composeNoticeKey)}
        </div>
      )}

      {composeError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200">
          {composeError}
        </div>
      )}
    </div>
  );

  const renderBoard = () => (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-900/5 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/20 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => {
              if (!isApplying) setView("capture");
            }}
            disabled={isApplying}
            className="mb-3 inline-flex items-center justify-center gap-1.5 rounded-full border border-gray-300 bg-transparent px-3.5 py-2 text-sm font-medium text-gray-600 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 disabled:hover:bg-transparent dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 dark:disabled:hover:bg-transparent"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t("scratch.capture.back")}
          </button>
          <h2 className="text-xl font-semibold text-gray-950 dark:text-gray-100">
            {t("scratch.board.title")}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t("scratch.board.subtitle")}
          </p>
        </div>
        <span title={applyDisabledTitle}>
          <button
            type="button"
            onClick={handleApplyClick}
            disabled={
              !hasApplicableOutlineChanges ||
              isApplying ||
              isVoiceProcessing ||
              isReadOnly ||
              isScratchWritePending
            }
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:scale-[1.01] hover:bg-violet-700 hover:shadow-lg active:scale-95 disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-violet-600 dark:bg-violet-500 dark:hover:bg-violet-400 sm:w-auto"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {isApplying ? t("common.saving") : t("scratch.board.apply")}
          </button>
        </span>
      </div>

      {renderVoiceRecoveryPanel()}
      <OutlineBoard
        value={boardOutline}
        onChange={handleManualOutlineChange}
        showNotes
        isReadOnly={isBoardLocked}
        scratch={{
          pool: pooledNotes,
          notesById,
          placements,
          onPlace: handleScratchPlace,
          renderNote: renderScratchNote,
          poolHeader: renderPoolHeader(),
          poolEmptyLabel: t("scratch.board.poolEmpty"),
        }}
      />
    </div>
  );

  return (
    <motion.div layout={false} className="space-y-4 sm:space-y-6" data-scratch-count={notes.length}>
      {view === "capture" ? renderCapture() : renderBoard()}
    </motion.div>
  );
}
