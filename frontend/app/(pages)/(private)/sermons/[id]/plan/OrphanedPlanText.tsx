"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useClipboard } from "@/hooks/useClipboard";
import { useDiscardQuestion } from "@/hooks/useConfirm";
import { liveNodeIds, readPlanText } from "@/utils/planText";
import { useTranslation } from "@locales/useTranslation";

import { planOrphanIdentity, type PlanOrphanCell } from "./planDraftTypes";
import { usePlanWriter } from "./planWriter";

import type { Sermon } from "@/models/models";

/** Unsaved, non-empty cells whose node the outline no longer has. */
export function orphanedCells(
  contentByNodeId: Record<string, string>,
  modifiedNodeIds: Record<string, boolean>,
  liveNodeIds: Set<string>
): PlanOrphanCell[] {
  return Object.keys(modifiedNodeIds)
    .filter((nodeId) => modifiedNodeIds[nodeId] && !liveNodeIds.has(nodeId) && (contentByNodeId[nodeId] ?? "").trim() !== "")
    .map((nodeId) => ({ id: nodeId, text: contentByNodeId[nodeId] }));
}

/** The screen's orphans first, then last-copy drafts a previous session left for gone nodes. */
export function mergeOrphans(inSession: PlanOrphanCell[], stored: PlanOrphanCell[]): PlanOrphanCell[] {
  // Equal words can still belong to separate unfinished copies.
  return [...inSession, ...stored];
}

/**
 * TEXT WHOSE CARD WAS REMOVED ELSEWHERE (BUG-20260815-refresh-hides-dirty-text-of-a-removed-node).
 *
 * Local drafts and accepted text without an outline card have different keepers. The recovery
 * list can show both, but each discard must address only the selected copy.
 */
export function OrphanedPlanText({
  cells,
  storedSermon,
  liveIds,
  onDiscard,
  readOnly = false,
  subject,
}: {
  cells: PlanOrphanCell[];
  storedSermon?: Sermon | null;
  liveIds?: ReadonlySet<string>;
  onDiscard: (cells: PlanOrphanCell[]) => void;
  /** A copy for reading: the words stay in sight and copyable, and letting them go waits. */
  readOnly?: boolean;
  subject?: unknown;
}) {
  const { t } = useTranslation();
  const writer = usePlanWriter();
  const storedIds = liveNodeIds(storedSermon?.outline);
  const stored = Object.entries(readPlanText(storedSermon))
    .filter(([id, text]) => text.trim() && !storedIds.has(id) && !liveIds?.has(id))
    .map(([id, text]): PlanOrphanCell => ({ id, text, stored: true }));
  const shown = [...cells, ...stored];
  const { askBeforeDiscard, discardDialog, withdraw } = useDiscardQuestion('text');
  const current = useRef({ shown, readOnly, subject });
  current.current = { shown, readOnly, subject };
  const shownCells = JSON.stringify(shown);
  useEffect(() => { withdraw(); }, [subject, readOnly, shownCells, withdraw]);
  const discard = (cell: PlanOrphanCell) => {
    void askBeforeDiscard(true, () => {
      if (cell.stored && storedSermon) {
        void writer.savePlanText(storedSermon.id, { [cell.id]: "" }, [], {
          orphaned: true, baselineByNodeId: { [cell.id]: cell.text },
        }).catch(() => toast.error(t("common.saveError")));
      } else onDiscard([cell]);
    }, () => current.current.subject === subject && !current.current.readOnly
      && current.current.shown.some(candidate => planOrphanIdentity(candidate) === planOrphanIdentity(cell) && candidate.text === cell.text));
  };

  const { copyToClipboard } = useClipboard({
    onSuccess: () => { toast.success(t("freshness.copiedToast")); },
    onError: () => { toast.error(t("common.saveError")); },
  });
  if (!shown.length) return null;

  return (
    <section
      role="status"
      aria-labelledby="orphaned-plan-text-title"
      className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      <h2 id="orphaned-plan-text-title" className="font-medium text-amber-900 dark:text-amber-200">{t("plan.orphanedTitle")}</h2>
      <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">{t("plan.orphanedBody")}</p>
      <ul className="mt-3 space-y-3">
        {shown.map((cell) => (
          <li key={planOrphanIdentity(cell)} className="space-y-2">
            <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/70 px-3 py-2 text-gray-900 dark:bg-black/20 dark:text-gray-100">{cell.text}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { void copyToClipboard(cell.text); }}
                className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700"
              >
                {t("plan.orphanedCopy")}
              </button>
              {!readOnly && <button
                type="button"
                onClick={() => discard(cell)}
                className="rounded-lg border border-amber-300 px-3 py-1.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20"
              >
                {t("plan.orphanedDiscard")}
              </button>}
            </div>
          </li>
        ))}
      </ul>
      {discardDialog}
    </section>
  );
}
