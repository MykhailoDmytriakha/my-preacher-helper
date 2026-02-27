import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { COPY_STATUS, TRANSLATION_KEYS } from "./constants";

import type { CopyStatus } from "./types";

interface UseCopyFormattedContentParams {
  t: (key: string, options?: Record<string, unknown>) => string;
  successResetDelayMs?: number;
  errorResetDelayMs?: number;
}

interface UseCopyFormattedContentResult {
  status: CopyStatus;
  runCopy: (copyOperation: () => Promise<boolean>) => Promise<void>;
  resetToIdle: () => void;
}

export default function useCopyFormattedContent({
  t,
  successResetDelayMs = 2000,
  errorResetDelayMs = 2500,
}: UseCopyFormattedContentParams): UseCopyFormattedContentResult {
  const [status, setStatus] = useState<CopyStatus>(COPY_STATUS.IDLE);
  const statusRef = useRef<CopyStatus>(COPY_STATUS.IDLE);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimeout = useCallback(() => {
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }
  }, []);

  const resetToIdle = useCallback(() => {
    clearResetTimeout();
    setStatus(COPY_STATUS.IDLE);
  }, [clearResetTimeout]);

  const scheduleReset = useCallback((nextStatus: CopyStatus, delayMs: number) => {
    setStatus(nextStatus);
    clearResetTimeout();
    resetTimeoutRef.current = setTimeout(() => {
      setStatus(COPY_STATUS.IDLE);
      resetTimeoutRef.current = null;
    }, delayMs);
  }, [clearResetTimeout]);

  const runCopy = useCallback(async (copyOperation: () => Promise<boolean>) => {
    if (statusRef.current === COPY_STATUS.COPYING) {
      return;
    }

    setStatus(COPY_STATUS.COPYING);

    let copied = false;
    try {
      copied = await copyOperation();
    } catch {
      copied = false;
    }

    if (copied) {
      toast.success(t(TRANSLATION_KEYS.PLAN.COPY_SUCCESS));
      scheduleReset(COPY_STATUS.SUCCESS, successResetDelayMs);
      return;
    }

    toast.error(t(TRANSLATION_KEYS.PLAN.COPY_ERROR));
    scheduleReset(COPY_STATUS.ERROR, errorResetDelayMs);
  }, [errorResetDelayMs, scheduleReset, successResetDelayMs, t]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    return () => {
      clearResetTimeout();
    };
  }, [clearResetTimeout]);

  return {
    status,
    runCopy,
    resetToIdle,
  };
}
