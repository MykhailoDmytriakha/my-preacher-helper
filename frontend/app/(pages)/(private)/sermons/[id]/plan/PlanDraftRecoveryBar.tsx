"use client";

import { useTranslation } from "react-i18next";

import { readPlanText } from "@/utils/planText";

import { planNodeNames } from "./planNodes";

import type { Sermon } from "@/models/models";

/** One card offered back: which card it is, what the draft holds, what the server holds now. */
export interface RecoveredCell {
  id: string;
  name: string;
  recovered: string;
  current: string;
}

/** The waiting cells in outline order, named, beside what the server holds for each now. */
export function recoveredCells(recovered: Record<string, string>, sermon: Sermon | null | undefined): RecoveredCell[] {
  const names = planNodeNames(sermon?.outline);
  const order = Object.keys(names);
  // Both storage shapes, merged the canonical way: a cell only the old shape holds is not "empty".
  const stored = readPlanText(sermon);
  return Object.entries(recovered)
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([id, text]) => ({ id, name: names[id] ?? id, recovered: text, current: stored[id] ?? "" }));
}

/**
 * "Text from last time never reached the server — want it back?"
 *
 * DELIBERATELY AN OFFER, NOT A RESTORE. Applying a stored draft by itself is how the old
 * preparation backup destroyed work: a draft left behind by a failed save kept winning over
 * text genuinely edited later on another device. Here the person SEES each card's waiting
 * text beside what the server holds now (BUG-20260815-draft-recovery-offers-a-number-not-the-text:
 * a bare count let yesterday's text go back over a newer one unseen) and decides; either choice
 * keeps the text somewhere until they say otherwise.
 */
export function PlanDraftRecoveryBar({
  cells,
  onRestore,
  onDiscard,
}: {
  cells: RecoveredCell[];
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const box = "mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/70 px-3 py-2 text-gray-900 dark:bg-black/20 dark:text-gray-100";

  return (
    <div
      role="status"
      className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {t("plan.draftRecoveryTitle")}
          </p>
          <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">
            {t("plan.draftRecoveryDescription", { count: cells.length })}
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
      <ul className="mt-3 space-y-3 border-t border-amber-200 pt-3 dark:border-amber-500/30">
        {cells.map((cell) => (
          <li key={cell.id} className="space-y-1">
            <p className="font-medium text-gray-900 dark:text-gray-100">{cell.name}</p>
            <p className="text-xs text-amber-900/80 dark:text-amber-200/70">{t("plan.draftRecoveryFromDraft")}</p>
            <p className={box}>{cell.recovered || t("plan.draftRecoveryEmpty")}</p>
            <p className="text-xs text-amber-900/80 dark:text-amber-200/70">
              {cell.current === cell.recovered ? t("plan.draftRecoverySameOnServer") : t("plan.draftRecoveryOnServer")}
            </p>
            {cell.current !== cell.recovered && <p className={box}>{cell.current || t("plan.draftRecoveryEmpty")}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
