"use client";

import { motion } from "framer-motion";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ReactNode } from "react";

interface RecorderLikeProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  isProcessing?: boolean;
  disabled?: boolean;
  onRetry?: () => void;
  retryCount?: number;
  maxRetries?: number;
  transcriptionError?: string | null;
  onClearError?: () => void;
  hideKeyboardShortcuts?: boolean;
  splitLeft?: ReactNode;
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
  onOpenCreateModal: () => void;
  manualThoughtTitle: string;
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
  onOpenCreateModal,
  manualThoughtTitle,
}: AudioRecorderPortalBridgeProps) {
  const splitLeft = (
    <button
      onClick={onOpenCreateModal}
      className="bg-amber-500 hover:bg-amber-600 px-4 self-stretch flex items-center justify-center shrink-0 transition-colors disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:bg-amber-500"
      disabled={isReadOnly}
      title={manualThoughtTitle}
    >
      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    </button>
  );

  const recorderNode = (
    <RecorderComponent
      onRecordingComplete={onRecordingComplete}
      isProcessing={isProcessing}
      disabled={isReadOnly}
      onRetry={onRetry}
      retryCount={retryCount}
      maxRetries={maxRetries}
      transcriptionError={transcriptionError}
      onClearError={onClearError}
      hideKeyboardShortcuts={hideKeyboardShortcuts}
      splitLeft={splitLeft}
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
