"use client";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useClipboard } from "@/hooks/useClipboard";

/** Unsaved, non-empty cells whose node the outline no longer has. */
export function orphanedCells(
  contentByNodeId: Record<string, string>,
  modifiedNodeIds: Record<string, boolean>,
  liveNodeIds: Set<string>
): { id: string; text: string }[] {
  return Object.keys(modifiedNodeIds)
    .filter((nodeId) => modifiedNodeIds[nodeId] && !liveNodeIds.has(nodeId) && (contentByNodeId[nodeId] ?? "").trim() !== "")
    .map((nodeId) => ({ id: nodeId, text: contentByNodeId[nodeId] }));
}

/** The screen's orphans first, then last-copy drafts a previous session left for gone nodes. */
export function mergeOrphans(inSession: { id: string; text: string }[], stored: { id: string; text: string }[]): { id: string; text: string }[] {
  const seen = new Set(inSession.map((cell) => cell.id));
  return [...inSession, ...stored.filter((cell) => !seen.has(cell.id))];
}

/**
 * TEXT WHOSE CARD WAS REMOVED ELSEWHERE (BUG-20260815-refresh-hides-dirty-text-of-a-removed-node).
 *
 * Cards are drawn from the outline, so when a point is removed on another device the card goes
 * with it — and the words typed into it here, still unsaved, had nowhere to be seen. They are
 * shown here in full until the person copies them somewhere or lets them go.
 */
export function OrphanedPlanText({
  cells,
  onDiscard,
  readOnly = false,
}: {
  cells: { id: string; text: string }[];
  onDiscard: (nodeIds: string[]) => void;
  /** A copy for reading: the words stay in sight and copyable, and letting them go waits. */
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { copyToClipboard } = useClipboard({
    onSuccess: () => { toast.success(t("freshness.copiedToast")); },
    onError: () => { toast.error(t("common.saveError")); },
  });
  if (!cells.length) return null;

  return (
    <section
      role="status"
      aria-labelledby="orphaned-plan-text-title"
      className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      <h2 id="orphaned-plan-text-title" className="font-medium text-amber-900 dark:text-amber-200">{t("plan.orphanedTitle")}</h2>
      <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">{t("plan.orphanedBody")}</p>
      <ul className="mt-3 space-y-3">
        {cells.map((cell) => (
          <li key={cell.id} className="space-y-2">
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
                onClick={() => onDiscard([cell.id])}
                className="rounded-lg border border-amber-300 px-3 py-1.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20"
              >
                {t("plan.orphanedDiscard")}
              </button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
