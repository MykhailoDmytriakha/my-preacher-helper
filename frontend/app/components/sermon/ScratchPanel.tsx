"use client";

import { motion } from "framer-motion";
import {
  Check,
  Pencil,
  Sparkles,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import TextareaAutosize from "react-textarea-autosize";
import { toast } from "sonner";

import { AudioRecoveryPanel } from "@/components/audio-recorder/AudioRecorderControls";
import { AudioRecorder } from "@/components/AudioRecorder";
import OutlineBoard, { type DragHandleProps } from "@/components/plan-editor/OutlineBoard";
import AudioRecorderPortalBridge from "@/components/sermon/AudioRecorderPortalBridge";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useAiUsage } from "@/hooks/useAiUsage";
import { useConnection } from "@/providers/ConnectionProvider";
import { composePlanFromScratch } from "@/services/scratch.service";
import { transcribeThoughtAudio } from "@/services/thought.service";
import { buildRecordingFilename, downloadBlobToDevice } from "@/utils/audioFormatUtils";
import { SECTION_KEYS, type SectionKey } from '@/utils/outlineDnd';
import { getSectionLabel } from "@lib/sections";

import {
  placementKey, getScratchSignature, getOutlineSignature,
  stripScratchMetadataWithIdMap, stripScratchMetadata, collectComposedScratchNoteIds,
  remapPlacement, cloneSermonOutline, appendScratchPlacementToOutline, getComposeNoticeKey,
} from './scratch/scratchBoardModel';
import ScratchNoteCard, { useScratchNoteLabels, type ScratchPlaceTarget } from './scratch/ScratchNoteCard';

import type { ComposedPlanOutline } from "@/config/schemas/zod";
import type { ScratchNote, SermonOutline } from "@/models/models";
import type { ScratchPlacement } from '@/utils/scratchPlacementRemap';

const VOICE_ERROR_KEY = "scratch.voice.error";
const BOARD_APPLY_ERROR_KEY = "scratch.board.applyError";
const MANUAL_ADD_LABEL_KEY = "scratch.capture.manualAdd";
const MANUAL_INPUT_LABEL_KEY = "scratch.capture.manualLabel";

type ScratchPatch = {
  text?: string;
  section?: SectionKey | null;
};
interface ScratchPanelProps {
  sermonId: string;
  notes: ScratchNote[];
  outline?: SermonOutline;
  addScratchNote: (text: string, section?: SectionKey) => ScratchNote | null;
  restoreScratchNote: (note: ScratchNote) => ScratchNote | null;
  updateScratchNote: (noteId: string, patch: ScratchPatch) => void;
  deleteScratchNote: (noteId: string) => void;
  /** Put a note among the notes of one container: `neighbourIds` as displayed, without it; `index` among them. */
  moveScratchNote?: (noteId: string, neighbourIds: string[], index: number) => void;
  isScratchWritePending: boolean;
  scratchRevision: number;
  onApplyOutline: (outline: SermonOutline, consumedNoteIds: string[]) => void | Promise<void>;
  onOutlineChange: (outline: SermonOutline) => void | Promise<void>;
  isReadOnly?: boolean;
}

const COMPOSE_TIMEOUT_MS = 55_000;
const APPLY_SETTLE_TIMEOUT_MS = 8_000;
const SCRATCH_TOAST_OPTIONS = { position: "bottom-right" as const };
/** Enough of the note to recognise which one is about to go, without a wall of text. */
const CONFIRM_PREVIEW_LIMIT = 100;

function truncateForConfirm(text: string) {
  const clean = text.trim();
  return clean.length > CONFIRM_PREVIEW_LIMIT
    ? `${clean.slice(0, CONFIRM_PREVIEW_LIMIT)}…`
    : clean;
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

export default function ScratchPanel({
  sermonId,
  notes,
  outline,
  addScratchNote,
  restoreScratchNote,
  updateScratchNote,
  deleteScratchNote,
  moveScratchNote,
  isScratchWritePending,
  scratchRevision,
  onApplyOutline,
  onOutlineChange,
  isReadOnly = false,
}: ScratchPanelProps) {
  const { t } = useTranslation();
  const boardNoteLabels = useScratchNoteLabels();
  const { isMagicAvailable } = useConnection();
  const { aiBlocked, transcriptionBlocked, refresh: refreshAiUsage } = useAiUsage();
  const transcriptionUnavailableLabel = transcriptionBlocked
    ? t("settings.usage.transcriptionUsageExhausted")
    : undefined;
  const [capturePortal, setCapturePortal] = useState<HTMLDivElement | null>(null);
  const [isManualCaptureOpen, setIsManualCaptureOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState("");
  const [composedOutline, setComposedOutline] = useState<ComposedPlanOutline | null>(null);
  const [manualOutline, setManualOutline] = useState<SermonOutline | null>(null);
  const [composeNoticeKey, setComposeNoticeKey] = useState<string | null>(null);
  /** How many notes the model skipped. They are in the plan, but placed by fallback. */
  const [composeUnplacedCount, setComposeUnplacedCount] = useState(0);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [placements, setPlacements] = useState<Record<string, ScratchPlacement>>({});
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceRetryCount, setVoiceRetryCount] = useState(0);
  const [voiceRecoveryUrl, setVoiceRecoveryUrl] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  /** Note queued for deletion — the trash click only ARMS it, the modal confirms. */
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null);
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
  const manualInputRef = useRef<HTMLTextAreaElement | null>(null);
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

  const currentOutline = manualOutline ?? outline;
  const incomingOutlineSignature = useMemo(() => getOutlineSignature(outline), [outline]);
  const boardOutline = useMemo(
    () => composedOutline ?? cloneSermonOutline(currentOutline),
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

    SECTION_KEYS.forEach((key) => {
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
    !aiBlocked &&
    !isScratchWritePending &&
    !isComposing &&
    !isApplying &&
    !isReadOnly;

  const clearComposition = useCallback(() => {
    setComposedOutline(null);
    setComposeNoticeKey(null);
    setComposeUnplacedCount(0);
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

  /** Closing keeps what was typed — a stray click on the head must not eat a draft. */
  const collapseManualCapture = useCallback(() => {
    setIsManualCaptureOpen(false);
  }, []);

  const handleManualSubmit = useCallback(() => {
    const nextText = manualDraft.trim();
    if (!nextText) return;
    if (handleAddManualNote(nextText)) {
      setManualDraft("");
      manualInputRef.current?.focus();
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
      if (transcriptionBlocked) return;
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
          const message = t(VOICE_ERROR_KEY);
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
        const message = error instanceof Error ? error.message : t(VOICE_ERROR_KEY);
        setVoiceError(message);
        toast.error(t(VOICE_ERROR_KEY));
      } finally {
        setIsVoiceProcessing(false);
      }
    },
    [addScratchNote, clearComposition, markScratchChanged, replaceStoredVoiceBlob, surfaceVoiceApplyRecovery, t, transcriptionBlocked]
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

  /**
   * Deleting a scratch note is one click away from an idea the preacher cannot retype,
   * so the click only ARMS the delete; the modal is what actually pulls the trigger.
   * Both delete paths funnel here — the trash button and clearing the note text to empty.
   */
  const requestDeleteNote = useCallback(
    (noteId: string) => {
      if (scratchMutationLockedRef.current) return;
      setPendingDeleteNoteId(noteId);
    },
    []
  );

  const cancelDeleteNote = useCallback(() => setPendingDeleteNoteId(null), []);

  const confirmDeleteNote = useCallback(() => {
    const noteId = pendingDeleteNoteId;
    setPendingDeleteNoteId(null);
    if (!noteId) return;
    handleDeleteNote(noteId);
  }, [handleDeleteNote, pendingDeleteNoteId]);

  const pendingDeleteNote = pendingDeleteNoteId
    ? notes.find((note) => note.id === pendingDeleteNoteId) ?? null
    : null;

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

  /**
   * One drop, one operation: WHICH container the note goes to and WHERE among its
   * notes. The container is a draft that lives until Apply; the order is part of
   * the notes themselves and is written straight through — the same split as
   * before, done in one call so the two halves can never disagree.
   */
  const handleScratchMove = useCallback(
    (noteId: string, target: ScratchPlacement | null, neighbourIds: string[], index: number) => {
      if (isBoardLocked || !notes.some((note) => note.id === noteId)) return;
      markScratchChanged();
      setPlacements((current) => {
        if (target === null) {
          if (!current[noteId]) return current;
          const next = { ...current };
          delete next[noteId];
          return next;
        }
        return { ...current, [noteId]: target };
      });
      moveScratchNote?.(noteId, neighbourIds, index);
    },
    [isBoardLocked, markScratchChanged, moveScratchNote, notes]
  );

  /** Every container a note can be filed into, in reading order: pool, then section → point → sub-point. */
  const placeTargets = useMemo<ScratchPlaceTarget[]>(() => {
    const targets: ScratchPlaceTarget[] = [{ key: "pool", label: t("scratch.card.placeIntoPool"), depth: 0, target: null }];
    SECTION_KEYS.forEach((key) => {
      const sectionLabel = getSectionLabel(t, key);
      (boardOutline[key] ?? []).forEach((point) => {
        targets.push({ key: `point:${point.id}`, label: `${sectionLabel}: ${point.text}`, depth: 0, target: { pointId: point.id } });
        (point.subPoints ?? []).forEach((subPoint) => {
          targets.push({ key: `sub:${subPoint.id}`, label: subPoint.text, depth: 1, target: { pointId: point.id, subPointId: subPoint.id } });
        });
      });
    });
    return targets;
  }, [boardOutline, t]);

  /** The menu's outcome is a drop at the END of the chosen container — same operation, no gesture. */
  const handlePlaceInto = useCallback(
    (noteId: string, target: ScratchPlacement | null) => {
      const targetKey = placementKey(target);
      const neighbourIds = notes
        .filter((note) => note.id !== noteId && placementKey(placements[note.id]) === targetKey)
        .map((note) => note.id);
      handleScratchMove(noteId, target, neighbourIds, neighbourIds.length);
    },
    [handleScratchMove, notes, placements]
  );

  const handleManualOutlineChange = useCallback(
    (nextOutline: SermonOutline) => {
      if (isBoardLocked) return;

      if (composedOutline) {
        setComposedOutline(cloneSermonOutline(nextOutline));
        setComposeError(null);
        return;
      }

      const cleanOutline = stripScratchMetadata(nextOutline as ComposedPlanOutline);
      outlineRevisionRef.current += 1;
      pendingManualOutlineSignatureRef.current = getOutlineSignature(cleanOutline);
      setManualOutline(cleanOutline);
      void Promise.resolve(onOutlineChange(cleanOutline)).catch((error) => {
        const message = error instanceof Error ? error.message : t(BOARD_APPLY_ERROR_KEY);
        toast.error(message || t(BOARD_APPLY_ERROR_KEY));
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
    setComposeUnplacedCount(0);
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
      const { outline: outlineFromScratch, unplacedScratchNoteIds } = await composePlanFromScratch(
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
      setComposeUnplacedCount(unplacedScratchNoteIds.length);
      setComposeError(null);
      await refreshAiUsage();
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
      const message = error instanceof Error ? error.message : t(BOARD_APPLY_ERROR_KEY);
      toast.error(message || t(BOARD_APPLY_ERROR_KEY));
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

  const composeDisabledKey = getComposeDisabledKey(isScratchWritePending, isMagicAvailable, aiBlocked, pooledNotes.length);
  const composeDisabledTitle = composeDisabledKey ? t(composeDisabledKey) : undefined;

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
    // Open = the button is the HEAD of the form below it: same violet accent, squared
    // bottom, no gap. Otherwise the panel reads as a stray card owned by nothing.
    return (
      <button
        type="button"
        onClick={() => {
          if (isCaptureLocked) return;
          if (isManualCaptureOpen) {
            collapseManualCapture();
            return;
          }
          setIsManualCaptureOpen(true);
          manualInputRef.current?.focus();
        }}
        className={[
          "flex min-w-0 flex-1 items-center justify-center gap-2 self-stretch border px-4 py-3 font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70",
          isManualCaptureOpen
            ? "rounded-xl rounded-b-none border-b-0 border-violet-400 bg-violet-50 text-violet-900 focus:ring-violet-400 dark:border-violet-500 dark:bg-violet-600/15 dark:text-violet-100"
            : "rounded-xl border-gray-300 bg-gray-100 text-gray-700 shadow-sm hover:bg-gray-200 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700",
        ].join(" ")}
        disabled={isCaptureLocked}
        title={t(MANUAL_ADD_LABEL_KEY)}
        aria-label={t(MANUAL_ADD_LABEL_KEY)}
        aria-expanded={isManualCaptureOpen}
      >
        <Pencil
          className={[
            "h-5 w-5 shrink-0",
            isManualCaptureOpen
              ? "text-violet-600 dark:text-violet-300"
              : "text-gray-500 dark:text-gray-400",
          ].join(" ")}
          aria-hidden="true"
        />
        <span className="min-w-0 text-center leading-tight">{t(MANUAL_ADD_LABEL_KEY)}</span>
      </button>
    );
  };

  const renderManualCaptureForm = () => {
    if (!isManualCaptureOpen) return null;

    return (
      // Open = manual mode: the recorder button steps aside, the head goes full width and
      // this panel continues it — one shape, so it is obvious what you are doing.
      <form
        className="mb-4 rounded-xl rounded-t-none border border-t-0 border-violet-400 bg-violet-50/60 p-3 dark:border-violet-500 dark:bg-violet-600/[0.07] sm:p-4"
        onSubmit={(event) => {
          event.preventDefault();
          handleManualSubmit();
        }}
      >
        {/* The head above already names the mode — no second title here. */}
        <label htmlFor="scratch-manual-note-input" className="sr-only">
          {t(MANUAL_INPUT_LABEL_KEY)}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <TextareaAutosize
            id="scratch-manual-note-input"
            ref={manualInputRef}
            minRows={2}
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
            placeholder={t(MANUAL_INPUT_LABEL_KEY)}
            aria-label={t(MANUAL_INPUT_LABEL_KEY)}
            className="min-w-0 flex-1 resize-none rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-violet-400/70 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-violet-800 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-violet-300/40 dark:focus:ring-violet-900/40"
            disabled={isCaptureLocked}
          />
          <div className="flex items-start gap-2">
            <button
              type="submit"
              disabled={!manualDraft.trim() || isCaptureLocked}
              className="inline-flex flex-1 items-center justify-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-violet-600 dark:bg-violet-500 dark:hover:bg-violet-400 sm:flex-none"
            >
              {t("scratch.capture.add")}
            </button>
            <button
              type="button"
              onClick={collapseManualCapture}
              className="shrink-0 rounded-lg p-2 text-violet-500 transition hover:bg-violet-100 hover:text-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:text-violet-300 dark:hover:bg-violet-900/50 dark:hover:text-violet-100"
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
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

  /**
   * Recording and the manual note — the two ways a thought gets in.
   *
   * They used to live only on the capture screen, so writing something down while
   * arranging the plan meant leaving the board and coming back. The same controls
   * now render inside the board's pool as well. Only ONE of them is mounted at a
   * time (the view switch renders either capture or board), so the recorder keeps
   * a single instance and `capturePortal` a single target.
   */
  const renderCaptureControls = () => (
    <>
      {/* No gap under the recorder row while the manual form is open — the button and
          the panel below it have to read as one block, not two stacked cards. */}
      <div className={isManualCaptureOpen ? "" : "mb-4"} ref={setCapturePortal} />
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
        isRecorderDisabled={!isMagicAvailable || isCaptureLocked || transcriptionBlocked}
        recorderTitle={transcriptionUnavailableLabel}
        isManualDisabled={isCaptureLocked}
        onOpenCreateModal={() => {
          if (!isCaptureLocked) setIsManualCaptureOpen(true);
        }}
        manualControl={renderManualCaptureControl()}
        manualThoughtTitle={t(MANUAL_ADD_LABEL_KEY)}
        manualButtonPlacement="right"
        manualButtonSeparate
        hideRecordButton={isManualCaptureOpen}
      />
      {renderManualCaptureForm()}
      {renderVoiceRecoveryPanel()}
    </>
  );

  const renderScratchNote = (
    note: ScratchNote,
    dragHandleProps: DragHandleProps | null | undefined,
    options?: { overlay?: boolean }
  ) => {
    const currentNote = notesById.get(note.id) ?? note;
    if (options?.overlay) {
      return <ScratchNoteCard note={currentNote} isOverlay onEdit={() => {}} onDelete={() => {}} />;
    }
    return (
      <ScratchNoteCard
        note={currentNote}
        isReadOnly={isBoardLocked}
        dragHandleProps={dragHandleProps}
        onEdit={handleEditNote}
        onDelete={requestDeleteNote}
        onUnplace={placements[currentNote.id] ? (noteId) => handleScratchPlace(noteId, null) : undefined}
        placeTargets={placeTargets}
        currentTargetKey={placementKey(placements[currentNote.id])}
        onPlaceInto={handlePlaceInto}
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

      {/* Capture lives here too: a thought that arrives while the plan is being
          arranged should not cost a trip back to another screen. */}
      <div data-testid="board-capture-controls">{renderCaptureControls()}</div>

      {composeNoticeKey && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          {t(composeNoticeKey)}
        </div>
      )}

      {composeUnplacedCount > 0 && (
        <div
          data-testid="compose-unplaced-notice"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {t("scratch.board.composeUnplaced", { count: composeUnplacedCount })}
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
            onClick={applyOutline}
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

      {/* Recovery lives with the recorder, inside the pool — one instance only. */}
      <OutlineBoard
        className="grid grid-cols-1 items-start gap-3 sm:gap-4 lg:grid-cols-3"
        value={boardOutline}
        onChange={handleManualOutlineChange}
        showNotes
        isReadOnly={isBoardLocked}
        scratch={{
          pool: pooledNotes,
          notesById,
          placements,
          onPlace: handleScratchPlace,
          onMove: handleScratchMove,
          renderNote: renderScratchNote,
          poolHeader: renderPoolHeader(),
          poolEmptyLabel: t("scratch.board.poolEmpty"),
          noteLabels: boardNoteLabels,
        }}
      />
    </div>
  );

  return (
    <motion.div layout={false} className="space-y-4 sm:space-y-6" data-scratch-count={notes.length}>
      {/*
        ONE SCREEN, NOT TWO.
        The capture screen showed the same notes the board's pool already shows,
        so reaching the plan cost a trip through a screen that repeated itself.
        Capture (recording, manual note) lives in the pool; the board is the page.
      */}
      {renderBoard()}
      <ConfirmModal
        isOpen={Boolean(pendingDeleteNote)}
        onClose={cancelDeleteNote}
        onConfirm={confirmDeleteNote}
        title={t("scratch.card.deleteConfirmTitle")}
        description={t("scratch.card.deleteConfirm", {
          text: truncateForConfirm(pendingDeleteNote?.text ?? ""),
        })}
        confirmText={t("common.delete")}
      />
    </motion.div>
  );
}

function getComposeDisabledKey(pending: boolean, online: boolean, aiBlocked: boolean, noteCount: number): string | undefined {
  if (pending) return "scratch.board.composePendingWrites";
  if (!online) return "scratch.board.composeOffline";
  if (aiBlocked) return "settings.usage.aiUsageExhausted";
  if (noteCount === 0) return "scratch.board.composeEmpty";
  return undefined;
}
