"use client";

import { useTranslation } from "react-i18next";

/**
 * "Text from last time never reached the server — want it back?"
 *
 * DELIBERATELY AN OFFER, NOT A RESTORE. Applying a stored draft by itself is how the old
 * preparation backup destroyed work: a draft left behind by a failed save kept winning over
 * text genuinely edited later on another device. Here the person is shown that something is
 * waiting and decides; either choice keeps the text somewhere until they say otherwise.
 */
export function PlanDraftRecoveryBar({
  count,
  onRestore,
  onDiscard,
}: {
  /** How many cells are waiting. Naming the number is what makes the offer credible. */
  count: number;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className="mb-3 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      <div className="min-w-0">
        <p className="font-medium text-amber-900 dark:text-amber-200">
          {t("plan.draftRecoveryTitle")}
        </p>
        <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">
          {t("plan.draftRecoveryDescription", { count })}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onRestore}
          className="inline-flex items-center rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700"
        >
          {t("plan.draftRecoveryRestore")}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-lg border border-amber-300 px-3 py-1.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20"
        >
          {t("plan.draftRecoveryDiscard")}
        </button>
      </div>
    </div>
  );
}
