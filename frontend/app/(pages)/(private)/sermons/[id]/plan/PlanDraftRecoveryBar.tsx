"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import Select from '@/components/ui/Select';
import { useDiscardQuestion } from "@/hooks/useConfirm";
import { readPlanText } from "@/utils/planText";
import { writeFailureTranslationKey } from "@/utils/writeRecovery";
import { useTranslation } from "@locales/useTranslation";

import { planNodeNames } from "./planNodes";

import type { PlanDraftCopy } from "./planDraftTypes";
import type { PlanRecovery } from "./PlanModeStatus";
import type usePlanTextDraft from "./usePlanTextDraft";
import type { Sermon } from "@/models/models";

/** One offered card beside the working text that restoring it would replace. */
export interface RecoveredCell {
  id: string;
  name: string;
  recovered: string;
  current: string;
  choices?: PlanDraftCopy[];
  selectedKey?: string;
}

/** Waiting cells beside the shown working plan, with canonical fallback for absent working fields. */
export function recoveredCells(recovered: Record<string, string>, sermon: Sermon | null | undefined, copies: PlanDraftCopy[] = [], selected: PlanDraftCopy[] = [], working: Readonly<Record<string, string>> = {}): RecoveredCell[] {
  const names = planNodeNames(sermon?.outline);
  const order = Object.keys(names);
  // Both storage shapes, merged the canonical way: a cell only the old shape holds is not "empty".
  const stored = readPlanText(sermon);
  return Object.entries(recovered)
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([id, text]) => {
      const choices = copies.filter(copy => copy.id === id);
      return { id, name: names[id] ?? id, recovered: text, current: working[id] ?? stored[id] ?? "", ...(choices.length > 1 ? { choices, selectedKey: selected.find(copy => copy.id === id)?.key ?? choices[0].key } : {}) };
    });
}

/**
 * "Text from last time never reached the server — want it back?"
 *
 * DELIBERATELY AN OFFER, NOT A RESTORE. Applying a stored draft by itself is how the old
 * preparation backup destroyed work: a draft left behind by a failed save kept winning over
 * text genuinely edited later on another device. Here the person SEES each card's waiting
 * text beside the current working plan (BUG-20260815-draft-recovery-offers-a-number-not-the-text:
 * a bare count let yesterday's text go back over a newer one unseen) and decides; either choice
 * keeps the text somewhere until they say otherwise.
 */
export function PlanDraftRecoveryBar({
  cells,
  onRestore,
  onDiscard,
  subject,
  onChoose,
  restoreDisabled = false,
  selectSource,
}: {
  cells: RecoveredCell[];
  onRestore: () => void | Promise<void>;
  restoreDisabled?: boolean;
  onDiscard: () => void | Promise<void>;
  selectSource?: { id: string; options: { id: string; label: string }[]; choose: (id: string) => void };
  subject?: unknown;
  onChoose?: (nodeId: string, key: string) => void;
}) {
  const { t } = useTranslation();
  const emptyText = t("plan.draftRecoveryEmpty");
  const { askBeforeDiscard, discardDialog } = useDiscardQuestion('text');
  const current = useRef({ cells, subject });
  current.current = { cells, subject };
  const [restoring, setRestoring] = useState(false);
  const restore = async () => {
    if (restoring || restoreDisabled) return;
    setRestoring(true);
    try { await onRestore(); } finally { setRestoring(false); }
  };
  const discard = () => {
    const shown = JSON.stringify(cells);
    void askBeforeDiscard(true, async () => {
      setRestoring(true);
      try { await onDiscard(); } finally { setRestoring(false); }
    }, () => current.current.subject === subject && JSON.stringify(current.current.cells) === shown);
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
            onClick={() => void restore()}
            disabled={restoreDisabled || restoring}
            className="inline-flex items-center rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("plan.draftRecoveryRestore")}
          </button>
          <button
            type="button"
            onClick={discard}
            disabled={restoring}
            className="rounded-lg border border-amber-300 px-3 py-1.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20"
          >
            {t("plan.draftRecoveryDiscard")}
          </button>
        </div>
      </div>
      {selectSource && <label className="mt-3 block">
        <span>{t("dataSync.recoveryLabel")}</span>
        <Select size="sm" accent="amber" wrapperClassName="mt-1"
          value={selectSource.id} disabled={restoring} onChange={event => selectSource.choose(event.target.value)}>
          {selectSource.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </Select>
      </label>}
      <ul className="mt-3 space-y-3 border-t border-amber-200 pt-3 dark:border-amber-500/30">
        {cells.map((cell) => (
          <li key={cell.id} className="space-y-1">
            <p className="font-medium text-gray-900 dark:text-gray-100">{cell.name}</p>
            {cell.choices && onChoose && <label className="block">
              <span>{t("unsavedDraft.chooseCopy")}</span>
              <Select
                size="sm"
                accent="amber"
                wrapperClassName="mt-1"
                value={cell.selectedKey ?? ""}
                disabled={restoring}
                onChange={event => onChoose(cell.id, event.target.value)}
              >
                {cell.choices.map((copy, index) => <option key={copy.key} value={copy.key}>{index + 1}. {copy.text.slice(0, 100) || emptyText}</option>)}
              </Select>
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

/** One plan recovery banner for device-session drafts and still-independent older copies. */
export function PlanDraftRecoveryOffers({ recovery, legacy, sermon, working, subject, busy, restoreLegacy, answered }: {
  recovery: PlanRecovery;
  legacy: ReturnType<typeof usePlanTextDraft>;
  sermon: Sermon;
  working: Readonly<Record<string, string>>;
  subject: string;
  busy: (id: string) => boolean;
  restoreLegacy: (cells: Record<string, string>, before: Record<string, string>) => Promise<boolean>;
  answered: () => void;
}) {
  const { t } = useTranslation();
  const [selectedId, choose] = useState<string>();
  const engines = recovery.canRecover ? recovery.offers : [];
  const matches = (offer: (typeof engines)[number], copy: PlanDraftCopy) =>
    Object.hasOwn(offer.cells, copy.id) && offer.cells[copy.id] === copy.text;
  const choices = legacy.copies.filter(copy => !engines.some(offer => matches(offer, copy)));
  const selection = legacy.selectedCopies.flatMap(previous => {
    const selected = choices.find(copy => copy.key === previous.key) ?? choices.find(copy => copy.id === previous.id);
    return selected ? [selected] : [];
  });
  const legacyText = Object.fromEntries(selection.map(copy => [copy.id, copy.text]));
  const options = [
    ...(selection.length ? [{ id: 'legacy', label: selection.map(copy => copy.text).join(' · ') }] : []),
    ...engines.map(offer => ({ id: offer.id, label: Object.values(offer.cells).join(' · ') })),
  ];
  const selected = options.find(option => option.id === selectedId) ?? options[0];
  if (!selected) return null;
  const engine = engines.find(offer => offer.id === selected.id);
  const cells = engine ? recoveredCells(engine.cells, sermon, [], [], working)
    : recoveredCells(legacyText, sermon, choices, selection, working);
  const duplicates = engine ? legacy.copies.filter(copy => matches(engine, copy)) : [];
  const act = async (restore: boolean) => {
    try {
      if (engine) {
        await (restore ? engine.restore() : engine.discard());
        legacy.accept(duplicates);
      } else {
        const opening = Object.fromEntries(cells.map(cell => [cell.id, cell.current]));
        if (restore && !await restoreLegacy(legacyText, opening)) return;
        legacy.accept(selection);
      }
      answered();
    } catch (error) {
      toast.error(t(writeFailureTranslationKey(error, 'dataSync.documentFailed')));
    }
  };
  return <PlanDraftRecoveryBar subject={JSON.stringify([subject, selected.id])} cells={cells}
    restoreDisabled={cells.some(cell => busy(cell.id))}
    onChoose={engine ? undefined : legacy.selectCopy}
    selectSource={options.length > 1 ? { id: selected.id, options: options.map((option, index) => ({
      id: option.id, label: `${index + 1}. ${option.label.slice(0, 100) || t("plan.draftRecoveryEmpty")}`,
    })), choose } : undefined}
    onRestore={() => act(true)} onDiscard={() => act(false)} />;
}
