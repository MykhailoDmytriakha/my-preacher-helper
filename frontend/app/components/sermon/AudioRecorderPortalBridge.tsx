"use client";

import { motion } from "framer-motion";
import { Pencil } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ReactNode } from "react";

interface RecorderLikeProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  isProcessing?: boolean;
  disabled?: boolean;
  title?: string;
  onRetry?: () => void;
  retryCount?: number;
  maxRetries?: number;
  transcriptionError?: string | null;
  onClearError?: () => void;
  hideKeyboardShortcuts?: boolean;
  splitLeft?: ReactNode;
  splitRight?: ReactNode;
  splitSeparate?: boolean;
  enableAudioLevelMonitoring?: boolean;
}

interface AudioRecorderPortalBridgeProps {
  RecorderComponent: React.ComponentType<RecorderLikeProps>;
  portalTarget: HTMLDivElement | null;
  onRecordingComplete: (audioBlob: Blob) => void;
  isProcessing: boolean;
  onRetry: () => void;
  retryCount: number;
  maxRetries?: number;
  transcriptionError: string | null;
  onClearError: () => void;
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
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!containerRef.current || typeof window === "undefined") return;
    const ResizeObserverCtor = window.ResizeObserver;
    if (!ResizeObserverCtor) {
      setHeight(containerRef.current.getBoundingClientRect().height);
      return;
    }
    const observer = new ResizeObserverCtor((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr && typeof cr.height === "number") setHeight(cr.height);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className={className}
      initial={false}
      animate={height !== undefined ? { height } : undefined}
      transition={{ duration, ease: "easeInOut", delay }}
      style={{ overflow: "hidden" }}
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
}: AudioRecorderPortalBridgeProps) {
  const recorderDisabled = isRecorderDisabled ?? isReadOnly;
  const manualDisabled = isManualDisabled ?? isReadOnly;
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
      hideKeyboardShortcuts={hideKeyboardShortcuts}
      splitLeft={manualButtonPlacement === "left" ? splitLeft : undefined}
      splitRight={manualButtonPlacement === "right" ? splitLeft : undefined}
      splitSeparate={manualButtonSeparate}
      enableAudioLevelMonitoring={false}
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
