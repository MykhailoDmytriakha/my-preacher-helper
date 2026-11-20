"use client";

import { motion } from "framer-motion";
import { Pencil } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { FailureWords } from "@/utils/actionFailureMessage";
import type { ReactNode } from "react";


interface RecorderLikeProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  isProcessing?: boolean;
  disabled?: boolean;
  title?: string;
  onRetry?: () => void;
  retryCount?: number;
  maxRetries?: number;
  transcriptionError?: FailureWords | null;
  onClearError?: () => void;
  onDiscardRecording?: () => void | Promise<void>;
  hideKeyboardShortcuts?: boolean;
  splitLeft?: ReactNode;
  splitRight?: ReactNode;
  splitSeparate?: boolean;
  hideRecordButton?: boolean;
  enableAudioLevelMonitoring?: boolean;
  variant?: "standard" | "mini";
}

interface AudioRecorderPortalBridgeProps {
  RecorderComponent: React.ComponentType<RecorderLikeProps>;
  portalTarget: HTMLDivElement | null;
  onRecordingComplete: (audioBlob: Blob) => void;
  isProcessing: boolean;
  onRetry: () => void;
  retryCount: number;
  maxRetries?: number;
  transcriptionError: FailureWords | null;
  onClearError: () => void;
  onDiscardRecording?: () => void | Promise<void>;
  hideKeyboardShortcuts: boolean;
  isReadOnly: boolean;
  isRecorderDisabled?: boolean;
  recorderTitle?: string;
  isManualDisabled?: boolean;
  onOpenCreateModal: () => void;
  manualThoughtTitle: string;
  manualButtonPlacement?: "left" | "right";
  manualControl?: ReactNode;
  /** Render the manual button as a separate button (gap) instead of welded into the record pill. */
  manualButtonSeparate?: boolean;
  /** Hide the record button so the manual control owns the whole row (manual form open). */
  hideRecordButton?: boolean;
  /**
   * The recorder picks its layout from the WINDOW width; a host that is narrow on a wide screen (the
   * scratch pool's rail) asks for the compact one, or the recording controls spill out of it.
   */
  recorderVariant?: "standard" | "mini";
}

function AutoHeight({
  children,
  duration = 0.25,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  duration?: number;
  delay?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const lastHeight = useRef<number | undefined>(undefined);
  const unclipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Clip only while the height moves. At rest a button that grows on hover, its shadow and its focus
   * ring must not be cut at the box's edge (the owner, 2026-11-19: the pause button "grows and is cut").
   * The clip is set on the element in the same frame the content changes — a state update would come a
   * frame late and let the new content spill over what lies below for that frame.
   */
  const clipWhileMoving = useCallback((next: number) => {
    if (next === lastHeight.current) return;
    lastHeight.current = next;
    if (boxRef.current) boxRef.current.style.overflow = "hidden";
    if (unclipTimer.current) clearTimeout(unclipTimer.current);
    unclipTimer.current = setTimeout(() => {
      if (boxRef.current) boxRef.current.style.overflow = "visible";
    }, (duration + delay) * 1000 + 60);
    setHeight(next);
  }, [delay, duration]);
  useEffect(() => () => { if (unclipTimer.current) clearTimeout(unclipTimer.current); }, []);

  useEffect(() => {
    if (!containerRef.current || typeof window === "undefined") return;
    const ResizeObserverCtor = window.ResizeObserver;
    if (!ResizeObserverCtor) {
      clipWhileMoving(containerRef.current.getBoundingClientRect().height);
      return;
    }
    const observer = new ResizeObserverCtor((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr && typeof cr.height === "number") clipWhileMoving(cr.height);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [clipWhileMoving]);

  return (
    <motion.div
      ref={boxRef}
      className={className}
      initial={false}
      animate={height !== undefined ? { height } : undefined}
      transition={{ duration, ease: "easeInOut", delay }}
    >
      <div ref={containerRef}>{children}</div>
    </motion.div>
  );
}

export default function AudioRecorderPortalBridge({
  RecorderComponent,
  portalTarget,
  onRecordingComplete,
  isProcessing,
  onRetry,
  retryCount,
  maxRetries = 3,
  transcriptionError,
  onClearError,
  onDiscardRecording,
  hideKeyboardShortcuts,
  isReadOnly,
  isRecorderDisabled,
  recorderTitle,
  isManualDisabled,
  onOpenCreateModal,
  manualThoughtTitle,
  manualButtonPlacement = "left",
  manualControl,
  manualButtonSeparate,
  hideRecordButton,
  recorderVariant,
}: AudioRecorderPortalBridgeProps) {
  /**
   * A REASON TO REFUSE ADDS TO THE OTHERS, IT DOES NOT REPLACE THEM.
   *
   * These read `isRecorderDisabled ?? isReadOnly`, so a caller that answered the question at
   * all — even with "no" — silently switched the read-only rule off. A screen that gained a
   * usage gate would have lost its offline gate in the same line, and nothing would have said
   * so. Every reason now stands on its own.
   */
  const recorderDisabled = isReadOnly || (isRecorderDisabled ?? false);
  const manualDisabled = isReadOnly || (isManualDisabled ?? false);
  const splitLeft = manualControl ?? (
    <button
      type="button"
      onClick={onOpenCreateModal}
      className="bg-amber-500 hover:bg-amber-600 px-4 self-stretch flex items-center justify-center shrink-0 transition-colors disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:bg-amber-500"
      disabled={manualDisabled}
      title={manualThoughtTitle}
      aria-label={manualThoughtTitle}
    >
      <Pencil className="h-5 w-5 text-white" aria-hidden="true" />
    </button>
  );

  const recorderNode = (
    <RecorderComponent
      onRecordingComplete={onRecordingComplete}
      isProcessing={isProcessing}
      disabled={recorderDisabled}
      title={recorderTitle}
      onRetry={onRetry}
      retryCount={retryCount}
      maxRetries={maxRetries}
      transcriptionError={transcriptionError}
      onClearError={onClearError}
      onDiscardRecording={onDiscardRecording}
      hideKeyboardShortcuts={hideKeyboardShortcuts}
      splitLeft={manualButtonPlacement === "left" ? splitLeft : undefined}
      splitRight={manualButtonPlacement === "right" ? splitLeft : undefined}
      splitSeparate={manualButtonSeparate}
      hideRecordButton={hideRecordButton}
      enableAudioLevelMonitoring={false}
      variant={recorderVariant}
    />
  );

  if (portalTarget) {
    return createPortal(
      <AutoHeight className="w-full">{recorderNode}</AutoHeight>,
      portalTarget
    );
  }

  return <div className="hidden">{recorderNode}</div>;
}
