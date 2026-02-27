import { Check, Copy, X } from "lucide-react";

import { TRANSLATION_KEYS, copyButtonClasses, copyButtonStatusClasses } from "./constants";

import type { CopyStatus } from "./types";

interface PlanCopyButtonProps {
  status: CopyStatus;
  onCopy: () => void | Promise<void>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function getCopyButtonTitle(status: CopyStatus, t: PlanCopyButtonProps["t"]): string {
  if (status === "success") {
    return t("common.copied");
  }
  if (status === "error") {
    return t(TRANSLATION_KEYS.PLAN.COPY_ERROR);
  }
  if (status === "copying") {
    return t(TRANSLATION_KEYS.COPY.COPYING, { defaultValue: "Copying…" });
  }
  return t(TRANSLATION_KEYS.COPY.COPY_FORMATTED);
}

function getLiveStatusText(status: CopyStatus, t: PlanCopyButtonProps["t"]): string {
  if (status === "success") {
    return t(TRANSLATION_KEYS.PLAN.COPY_SUCCESS);
  }
  if (status === "error") {
    return t(TRANSLATION_KEYS.PLAN.COPY_ERROR);
  }
  if (status === "copying") {
    return t(TRANSLATION_KEYS.COPY.COPYING, { defaultValue: "Copying…" });
  }
  return "";
}

export default function PlanCopyButton({ status, onCopy, t }: PlanCopyButtonProps) {
  return (
    <>
      <button
        type="button"
        onClick={onCopy}
        className={`${copyButtonClasses} ${copyButtonStatusClasses[status]}`}
        title={getCopyButtonTitle(status, t)}
        disabled={status === "copying"}
      >
        {status === "copying" ? (
          <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-gray-300 border-t-blue-600" />
        ) : status === "success" ? (
          <Check className="h-6 w-6 text-green-200" />
        ) : status === "error" ? (
          <X className="h-6 w-6 text-rose-200" />
        ) : (
          <Copy className="h-6 w-6" />
        )}
      </button>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {getLiveStatusText(status, t)}
      </span>
    </>
  );
}
