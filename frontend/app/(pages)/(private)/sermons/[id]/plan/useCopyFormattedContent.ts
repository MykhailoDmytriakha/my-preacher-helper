import { useCallback } from "react";
import { toast } from "sonner";

import { useCopyFeedback } from "@/hooks/useClipboard";

import { TRANSLATION_KEYS } from "./constants";

interface UseCopyFormattedContentParams {
  t: (key: string, options?: Record<string, unknown>) => string;
  successResetDelayMs?: number;
  errorResetDelayMs?: number;
}

export default function useCopyFormattedContent({
  t,
  successResetDelayMs = 2000,
  errorResetDelayMs = 2500,
}: UseCopyFormattedContentParams) {
  const { status, runCopy: copy, reset: resetToIdle } = useCopyFeedback({
    successDuration: successResetDelayMs,
    errorDuration: errorResetDelayMs,
    ignoreWhileCopying: true,
    onSuccess: () => { toast.success(t(TRANSLATION_KEYS.PLAN.COPY_SUCCESS)); },
    onError: () => { toast.error(t(TRANSLATION_KEYS.PLAN.COPY_ERROR)); },
  });
  const runCopy = useCallback(async (operation: () => Promise<boolean>): Promise<void> => {
    await copy(operation);
  }, [copy]);

  return { status, runCopy, resetToIdle };
}
