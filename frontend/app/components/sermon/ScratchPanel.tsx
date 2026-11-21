"use client";

import { Pencil, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { toast } from "sonner";

import { AudioRecoveryPanel } from "@/components/audio-recorder/AudioRecorderControls";
import RecordingDraftBanner from '@/components/audio-recorder/RecordingDraftBanner';
import { AudioRecorder } from "@/components/AudioRecorder";
import PointNote from '@/components/PointNote';
import AudioRecorderPortalBridge from "@/components/sermon/AudioRecorderPortalBridge";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { showUndoNotice } from "@/components/ui/showUndoNotice";
import { useAiUsage } from "@/hooks/useAiUsage";
import { useTextDictation } from '@/hooks/useTextDictation';
import { transcribeThoughtAudio } from "@/services/thought.service";
import { sayFailure } from '@/utils/actionFailureMessage';
import { buildRecordingFilename, downloadBlobToDevice } from "@/utils/audioFormatUtils";
import { outlineNoteSketches } from '@/utils/scratchPlacement';
import { useTranslation } from "@locales/useTranslation";

import { useScratchNoteLabels } from './scratch/ScratchNoteCard';
import ScratchSortingBoard from './scratch/ScratchSortingBoard';

import type { ScratchNote, SermonOutline } from "@/models/models";
import type { SectionKey } from '@/utils/outlineDnd';
import type { ScratchPlace } from '@/utils/scratchPlacement';
import type { OutlineNoteTarget } from '@/utils/sermonNoteText';

const VOICE_ERROR_KEY = "scratch.voice.error";
const MANUAL_ADD_LABEL_KEY = "scratch.capture.manualAdd";
const MANUAL_INPUT_LABEL_KEY = "scratch.capture.manualLabel";

interface ScratchPanelProps {
  sermonId: string;
  notes: ScratchNote[];
  outline?: SermonOutline;
  addScratchNote: (text: string, section?: SectionKey) => ScratchNote | null;
  addRecordedScratchNote: (text: string, recordingId: string) => Promise<ScratchNote | null>;
  restoreScratchNote: (note: ScratchNote) => Promise<ScratchNote | null>;
  updateScratchNote: (noteId: string, patch: { text?: string }) => void;
  captureScratchText?: (note: ScratchNote) => (text: string) => Promise<void>;
  /** Resolves once the deletion is submitted, so «Undo» never runs ahead of it. */
  deleteScratchNote: (noteId: string) => Promise<void> | void;
  placeScratchNotes: (noteIds: string[], place: ScratchPlace, beforeId?: string) => void;
  createPointWithScratch: (section: SectionKey, title: string, noteIds: string[]) => void;
  addOutlinePoint: (section: SectionKey, title: string) => void;
  addOutlineSubPoint: (pointId: string, title: string) => void;
  removeOutlinePoint: (pointId: string) => void;
  renameOutlineTitle: (target: OutlineNoteTarget, title: string) => void;
  removeOutlineSubPoint: (subPointId: string) => void;
  pointThoughtCount: (pointId: string) => number;
  isScratchWritePending: boolean;
  canEditQueuedNotes?: boolean;
  isReadOnly?: boolean;
}

const SCRATCH_TOAST_OPTIONS = { position: "bottom-right" as const };
/** Enough of the note to recognise which one is about to go, without a wall of text. */
const CONFIRM_PREVIEW_LIMIT = 100;

function truncateForConfirm(text: string) {
  const clean = text.trim();
  return clean.length > CONFIRM_PREVIEW_LIMIT ? `${clean.slice(0, CONFIRM_PREVIEW_LIMIT)}…` : clean;
}

function createVoiceRecoveryUrl(audioBlob: Blob | null) {
  if (!audioBlob || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(audioBlob);
}

function revokeVoiceRecoveryUrl(audioUrl: string | null) {
  if (!audioUrl || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(audioUrl);
}

/**
 * «Наброски»: what the preacher will speak about, captured by voice or by hand, then sorted into the
 * plan on the same page (`ScratchSortingBoard`). Every move is saved at once and a note stays a piece
 * of its own; there is no draft to apply and no second board in a window.
 */
export default function ScratchPanel({
  sermonId, notes, outline, addScratchNote, addRecordedScratchNote, restoreScratchNote, updateScratchNote,
  captureScratchText, deleteScratchNote, placeScratchNotes, createPointWithScratch, addOutlinePoint,
  addOutlineSubPoint, removeOutlinePoint, renameOutlineTitle, removeOutlineSubPoint, pointThoughtCount, isScratchWritePending, canEditQueuedNotes = false,
  isReadOnly = false,
}: ScratchPanelProps) {
  const { t } = useTranslation();
  const noteLabels = useScratchNoteLabels();
  const { blocked, blockedLabelKey } = useAiUsage();
  const transcriptionBlocked = blocked('dictation');
  const dictationBlockedKey = blockedLabelKey('dictation');
  const transcriptionUnavailableLabel = dictationBlockedKey ? t(dictationBlockedKey) : undefined;
  const [capturePortal, setCapturePortal] = useState<HTMLDivElement | null>(null);
  const [isManualCaptureOpen, setIsManualCaptureOpen] = useState(false);
  const [manualFocusRequest, setManualFocusRequest] = useState(0);
  const [voiceStartRequest, setVoiceStartRequest] = useState<{ key: string; portal: HTMLDivElement } | null>(null);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [hasRecordingDraftBanner, setHasRecordingDraftBanner] = useState(false);
  const [manualDraft, setManualDraft] = useState("");
  const [voiceRecoveryUrl, setVoiceRecoveryUrl] = useState<string | null>(null);
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null);
  const isCaptureLocked = isReadOnly;
  const isNoteEditingLocked = isCaptureLocked || (isScratchWritePending && !canEditQueuedNotes);
  const lockedRef = useRef(isCaptureLocked);
  lockedRef.current = isCaptureLocked;
  const manualInputRef = useRef<HTMLTextAreaElement | null>(null);
  const storedVoiceBlobRef = useRef<Blob | null>(null);
  const voiceRecoveryUrlRef = useRef<string | null>(null);

  const replaceStoredVoiceBlob = useCallback((audioBlob: Blob | null) => {
    revokeVoiceRecoveryUrl(voiceRecoveryUrlRef.current);
    storedVoiceBlobRef.current = audioBlob;
    const nextUrl = createVoiceRecoveryUrl(audioBlob);
    voiceRecoveryUrlRef.current = nextUrl;
    setVoiceRecoveryUrl(nextUrl);
  }, []);

  useEffect(() => () => revokeVoiceRecoveryUrl(voiceRecoveryUrlRef.current), []);
  useEffect(() => { if (isManualCaptureOpen) manualInputRef.current?.focus(); }, [isManualCaptureOpen, manualFocusRequest]);

  /** Closing keeps what was typed — a stray click on the head must not eat a draft. */
  const collapseManualCapture = useCallback(() => setIsManualCaptureOpen(false), []);

  const handleManualSubmit = useCallback(() => {
    const nextText = manualDraft.trim();
    if (!nextText) return;
    if (!lockedRef.current && addScratchNote(nextText)) {
      setManualDraft("");
      manualInputRef.current?.focus();
    } else {
      toast.error(t("scratch.capture.manualError"));
    }
  }, [addScratchNote, manualDraft, t]);

  const voice = useTextDictation({
    recordingContext: { context: 'scratch', contextId: sermonId },
    transcribe: transcribeThoughtAudio,
    fallbackErrorKey: VOICE_ERROR_KEY,
    acceptAfterText: true,
    onText: async (text, sourceId) => {
      if (!sourceId) throw new Error('The scratch recording identity is required');
      const note = await addRecordedScratchNote(text, sourceId);
      if (!note) throw new Error('The voice note was not accepted');
      replaceStoredVoiceBlob(null);
      toast.success(t('scratch.voice.success'), SCRATCH_TOAST_OPTIONS);
    },
    onEmpty: () => toast.error(t(VOICE_ERROR_KEY)),
    onError: words => toast.error(sayFailure(words, t)),
  });
  const isVoiceProcessing = voice.isProcessing;
  const voiceErrorMessage = voice.error ? sayFailure(voice.error, t) : null;
  const showVoiceRecovery = Boolean(voiceErrorMessage && storedVoiceBlobRef.current && voiceRecoveryUrl);
  const voiceRetryCount = voice.retryCount;
  // Check the destination and portal in render so a replacement recorder never sees an old request.
  const voiceStartAsked = voiceStartRequest?.key === voice.recordingKey && voiceStartRequest.portal === capturePortal;
  useEffect(() => {
    if (!voiceStartRequest) return;
    if (!voiceStartAsked) {
      setVoiceStartRequest(null);
      return;
    }
    const timer = window.setTimeout(() => setVoiceStartRequest(null), 1500);
    return () => window.clearTimeout(timer);
  }, [voiceStartAsked, voiceStartRequest]);

  const handleRecordingStateChange = (active: boolean) => {
    setIsVoiceRecording(active);
    if (active) setVoiceStartRequest(null);
  };
  const handleVoiceComplete = (audioBlob: Blob) => {
    replaceStoredVoiceBlob(audioBlob);
    voice.complete(audioBlob);
  };
  const handleRetryVoice = () => voice.retry();
  const handleClearVoiceError = () => { replaceStoredVoiceBlob(null); voice.clear(); };
  const handleDiscardVoice = async () => { await voice.discard(); handleClearVoiceError(); };
  const handleDownloadVoiceRecovery = useCallback(() => {
    const blob = storedVoiceBlobRef.current;
    if (blob) downloadBlobToDevice(blob, buildRecordingFilename(blob.type));
  }, []);

  /** The notes the board shows: the nodes' old one-line reminders are notes there too. */
  const shownNotes = useMemo(() => [...outlineNoteSketches(outline), ...notes], [notes, outline]);
  const handleEditNote = useCallback((noteId: string, text: string, save?: (text: string) => Promise<void>) => {
    if (lockedRef.current) return;
    if (save) return save(text);
    updateScratchNote(noteId, { text });
  }, [updateScratchNote]);

  const handleDeleteNote = useCallback((noteId: string) => {
    if (lockedRef.current) return;
    const deletedNote = shownNotes.find((note) => note.id === noteId);
    const deleted = deleteScratchNote(noteId);
    if (!deletedNote) return;
    showUndoNotice({
      ...SCRATCH_TOAST_OPTIONS,
      kind: "success",
      message: t("scratch.card.deleteSuccess"),
      label: t("scratch.card.undoDelete"),
      saving: t("dataSync.phase.savingLocally"),
      onUndo: async () => {
        if (lockedRef.current) throw new Error("Scratch notes are read-only");
        if (deleted) await deleted;
        if (!await restoreScratchNote(deletedNote)) throw new Error("The scratch note could not be restored");
      },
      failureMessage: error => {
        console.error("Failed to restore a scratch note", error);
        return t("common.saveError");
      },
    });
  }, [deleteScratchNote, shownNotes, restoreScratchNote, t]);

  /**
   * Deleting a scratch note is one click away from an idea the preacher cannot retype,
   * so the click only ARMS the delete; the modal is what actually pulls the trigger.
   * Both delete paths funnel here — the trash button and clearing the note text to empty.
   */
  const requestDeleteNote = useCallback((noteId: string) => {
    if (!lockedRef.current) setPendingDeleteNoteId(noteId);
  }, []);
  const cancelDeleteNote = useCallback(() => setPendingDeleteNoteId(null), []);
  const confirmDeleteNote = useCallback(() => {
    const noteId = pendingDeleteNoteId;
    setPendingDeleteNoteId(null);
    if (!noteId || isNoteEditingLocked) return;
    handleDeleteNote(noteId);
  }, [handleDeleteNote, isNoteEditingLocked, pendingDeleteNoteId]);
  const pendingDeleteNote = pendingDeleteNoteId ? shownNotes.find((note) => note.id === pendingDeleteNoteId) ?? null : null;

  /** The note's words, edited in place with the shared note editor; clearing them asks to delete. */
  const renderText = (note: ScratchNote, editSignal: number, onEditingChange: (editing: boolean) => void) => (
    <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} data-testid={`scratch-note-text-${note.id}`}>
      <PointNote
        note={note.text}
        onChange={(next) => { if (next) handleEditNote(note.id, next); else requestDeleteNote(note.id); }}
        captureSave={captureScratchText && (() => {
          const save = captureScratchText(note);
          return text => text ? handleEditNote(note.id, text, save) : requestDeleteNote(note.id);
        })}
        isReadOnly={isNoteEditingLocked}
        addRevealClass="opacity-100"
        hideClearButton
        tone="neutral"
        appearance="body"
        clickToEdit={false}
        editSignal={editSignal}
        editActions={{ save: t('scratch.card.save'), cancel: t('scratch.card.cancel') }}
        onEditingChange={onEditingChange}
        labels={noteLabels}
      />
    </div>
  );

  const renderManualCaptureControl = () => (
    // Open = the button is the HEAD of the form below it: same violet accent, squared bottom, no gap.
    <button
      type="button"
      onClick={() => {
        if (isCaptureLocked) return;
        if (isManualCaptureOpen) { collapseManualCapture(); return; }
        setIsManualCaptureOpen(true);
        manualInputRef.current?.focus();
      }}
      className={[
        "flex min-w-0 flex-1 items-center justify-center gap-2 self-stretch border px-3 py-2.5 text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70",
        isManualCaptureOpen
          ? "rounded-xl border-violet-400 bg-violet-50 text-violet-900 focus-visible:ring-violet-400 dark:border-violet-500 dark:bg-violet-600/15 dark:text-violet-100"
          : "rounded-xl border-gray-300 bg-gray-100 text-gray-700 shadow-sm hover:bg-gray-200 focus-visible:ring-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700",
      ].join(" ")}
      disabled={isCaptureLocked}
      title={t(MANUAL_ADD_LABEL_KEY)}
      aria-label={t(MANUAL_ADD_LABEL_KEY)}
      aria-expanded={isManualCaptureOpen}
    >
      <Pencil className={["h-4 w-4 shrink-0", isManualCaptureOpen ? "text-violet-600 dark:text-violet-300" : "text-gray-500 dark:text-gray-400"].join(" ")} aria-hidden="true" />
      <span className="min-w-0 text-center leading-tight">{t(MANUAL_ADD_LABEL_KEY)}</span>
    </button>
  );

  /**
   * The form is always there and opens or closes by one smooth height move, so the hint and the notes
   * below glide instead of jumping up and back (the owner, 2026-11-19). Closed, it is inert: no field
   * to tab into, nothing read aloud.
   */
  const renderManualCaptureForm = () => (
    <div className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${isManualCaptureOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      inert={!isManualCaptureOpen} aria-hidden={!isManualCaptureOpen || undefined}>
      <div className="min-h-0 overflow-hidden">
      <form
        className="mt-2 rounded-xl border border-violet-300 bg-violet-50/60 p-3 dark:border-violet-500 dark:bg-violet-600/[0.07]"
        onSubmit={(event) => { event.preventDefault(); handleManualSubmit(); }}
      >
        <label htmlFor="scratch-manual-note-input" className="sr-only">{t(MANUAL_INPUT_LABEL_KEY)}</label>
        <div className="flex flex-col gap-2">
          <TextareaAutosize
            id="scratch-manual-note-input"
            ref={manualInputRef}
            minRows={2}
            value={manualDraft}
            onChange={(event) => { if (!isCaptureLocked) setManualDraft(event.target.value); }}
            onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); collapseManualCapture(); } }}
            placeholder={t(MANUAL_INPUT_LABEL_KEY)}
            aria-label={t(MANUAL_INPUT_LABEL_KEY)}
            className="min-w-0 flex-1 resize-none rounded-lg border border-violet-200 bg-white px-3 py-2 text-base text-gray-900 placeholder-violet-400/70 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200 md:text-sm dark:border-violet-800 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-violet-300/40 dark:focus:ring-violet-900/40"
            disabled={isCaptureLocked}
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!manualDraft.trim() || isCaptureLocked}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
            >
              {t("scratch.capture.add")}
            </button>
            <button
              type="button"
              onClick={collapseManualCapture}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-violet-500 transition hover:bg-violet-100 hover:text-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:text-violet-300 dark:hover:bg-violet-900/50 dark:hover:text-violet-100"
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </form>
      </div>
    </div>
  );

  /** Recording and the manual note — the two ways a thought gets in; they head the pool. */
  const capture = (
    <>
      <div ref={setCapturePortal} />
      <AudioRecorderPortalBridge
        key={voice.recordingKey}
        onDiscardRecording={handleDiscardVoice}
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
        isRecorderDisabled={isCaptureLocked || transcriptionBlocked}
        recorderTitle={transcriptionUnavailableLabel}
        isManualDisabled={isCaptureLocked}
        onOpenCreateModal={() => { if (!isCaptureLocked) setIsManualCaptureOpen(true); }}
        manualControl={renderManualCaptureControl()}
        manualThoughtTitle={t(MANUAL_ADD_LABEL_KEY)}
        manualButtonPlacement="right"
        manualButtonSeparate
        recorderVariant="mini"
        autoStart={voiceStartAsked}
        onRecordingStateChange={handleRecordingStateChange}
      />
      {renderManualCaptureForm()}
      <AudioRecoveryPanel
        show={showVoiceRecovery}
        audioUrl={voiceRecoveryUrl}
        errorMessage={voiceErrorMessage}
        appliedVariant="standard"
        retryCount={voiceRetryCount}
        maxRetries={3}
        isProcessing={isVoiceProcessing}
        onRetry={handleRetryVoice}
        onRecordAgain={handleClearVoiceError}
        onDiscard={() => { void handleDiscardVoice().catch(() => toast.error(t('audio.draft.discardFailed'))); }}
        onDownload={handleDownloadVoiceRecovery}
        t={t}
        className="mt-2"
      />
      <RecordingDraftBanner context="scratch" contextId={sermonId} isProcessing={isVoiceProcessing}
        resendDisabled={transcriptionBlocked || isCaptureLocked} excludeDraftIds={voice.appliedDraftIds}
        onPresenceChange={setHasRecordingDraftBanner}
        onResend={(_blob, source) => voice.recover(source)} />
    </>
  );

  return (
    <div data-scratch-count={notes.length}>
      <ScratchSortingBoard
        notes={notes}
        outline={outline}
        capture={capture}
        onRailCapture={(kind) => {
          if (isCaptureLocked) return;
          if (kind === 'write') {
            setIsManualCaptureOpen(true);
            setManualFocusRequest((request) => request + 1);
          } else if (!transcriptionBlocked && capturePortal) {
            setVoiceStartRequest({ key: voice.recordingKey, portal: capturePortal });
          }
        }}
        captureBusy={isVoiceRecording || isVoiceProcessing || showVoiceRecovery || hasRecordingDraftBanner}
        railVoiceUnavailable={transcriptionBlocked ? transcriptionUnavailableLabel ?? null : null}
        isReadOnly={isReadOnly}
        isNoteLocked={isNoteEditingLocked}
        pointThoughtCount={pointThoughtCount}
        renderText={renderText}
        onDelete={requestDeleteNote}
        onPlace={placeScratchNotes}
        onCreatePoint={createPointWithScratch}
        onAddPoint={addOutlinePoint}
        onAddSubPoint={addOutlineSubPoint}
        onRemovePoint={removeOutlinePoint}
        onRenameTitle={renameOutlineTitle}
        onRemoveSubPoint={removeOutlineSubPoint}
      />
      <ConfirmModal
        isOpen={Boolean(pendingDeleteNote)}
        onClose={cancelDeleteNote}
        onConfirm={confirmDeleteNote}
        title={t("scratch.card.deleteConfirmTitle")}
        description={t("scratch.card.deleteConfirm", { text: truncateForConfirm(pendingDeleteNote?.text ?? "") })}
        confirmText={t("common.delete")}
      />
    </div>
  );
}
