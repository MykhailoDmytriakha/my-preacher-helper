"use client";

import { useRef } from "react";

import { useDiscardQuestion } from "@/hooks/useConfirm";
import { readPlanText } from "@/utils/planText";
import { useTranslation } from "@locales/useTranslation";

import { planNodeNames } from "./planNodes";

import type { PlanDraftCopy } from "./planDraftTypes";
import type { Sermon } from "@/models/models";

/** One card offered back: which card it is, what the draft holds, what the server holds now. */
export interface RecoveredCell {
  id: string;
  name: string;
  recovered: string;
  current: string;
  choices?: PlanDraftCopy[];
  selectedKey?: string;
}

/** The waiting cells in outline order, named, beside what the server holds for each now. */
export function recoveredCells(recovered: Record<string, string>, sermon: Sermon | null | undefined, copies: PlanDraftCopy[] = [], selected: PlanDraftCopy[] = []): RecoveredCell[] {
  const names = planNodeNames(sermon?.outline);
  const order = Object.keys(names);
  // Both storage shapes, merged the canonical way: a cell only the old shape holds is not "empty".
  const stored = readPlanText(sermon);
  return Object.entries(recovered)
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([id, text]) => {
      const choices = copies.filter(copy => copy.id === id);
      return { id, name: names[id] ?? id, recovered: text, current: stored[id] ?? "", ...(choices.length > 1 ? { choices, selectedKey: selected.find(copy => copy.id === id)?.key ?? choices[0].key } : {}) };
    });
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
  subject,
  onChoose,
}: {
  cells: RecoveredCell[];
  onRestore: () => void;
  onDiscard: () => void;
  subject?: unknown;
  onChoose?: (nodeId: string, key: string) => void;
}) {
  const { t } = useTranslation();
  const emptyText = t("plan.draftRecoveryEmpty");
  const { askBeforeDiscard, discardDialog } = useDiscardQuestion('text');
  const current = useRef({ cells, subject });
  current.current = { cells, subject };
  const discard = () => {
    const shown = JSON.stringify(cells);
    void askBeforeDiscard(true, onDiscard, () =>
      current.current.subject === subject && JSON.stringify(current.current.cells) === shown);
  };

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
            onClick={discard}
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
            {cell.choices && onChoose && <label className="block">
              <span>{t("unsavedDraft.chooseCopy")}</span>
              <select
                className="mt-1 block w-full rounded-lg border border-amber-300 bg-white px-2 py-1 dark:bg-gray-900"
                value={cell.selectedKey ?? ""}
                onChange={event => onChoose(cell.id, event.target.value)}
              >
                {cell.choices.map((copy, index) => <option key={copy.key} value={copy.key}>{index + 1}. {copy.text.slice(0, 100) || emptyText}</option>)}
              </select>
            </label>}

            <p className="text-xs text-amber-900/80 dark:text-amber-200/70">{t("plan.draftRecoveryFromDraft")}</p>
            <p className={box}>{cell.recovered || emptyText}</p>
            <p className="text-xs text-amber-900/80 dark:text-amber-200/70">
              {cell.current === cell.recovered ? t("plan.draftRecoverySameOnServer") : t("plan.draftRecoveryOnServer")}
            </p>
            {cell.current !== cell.recovered && <p className={box}>{cell.current || emptyText}</p>}
          </li>
        ))}
      </ul>
      {discardDialog}
    </div>
  );
}
