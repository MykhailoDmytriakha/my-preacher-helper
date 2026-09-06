"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { savePlanModeViaClient } from "@/services/sermons.client";
import { debugLog } from "@/utils/debugMode";

import type { Sermon } from "@/models/models";

/**
 * WHICH EDITOR THIS PLAN IS KEPT IN — shown, and switchable.
 *
 * Both screens write the same text, so before this there was no way to tell them apart and
 * every shortcut opened the paired AI screen. For a plan written by hand that is worse than a
 * detour: that screen shows one cell per outline point, so the text under sub-points was not
 * shown at all and the preacher met his own plan looking half empty.
 *
 * ONE COMPONENT ON BOTH SCREENS, on purpose. The pair has already drifted twice — a banner on
 * one and not the other, sub-points on one and not the other — and each time the person paid
 * for it. A switch written twice would drift the same way.
 */
export function PlanModeSwitch({
  sermon,
  current,
  onSwitched,
  beforeSwitch,
}: {
  sermon: Sermon | null | undefined;
  /** Which screen is rendering this switch. */
  current: 'manual' | 'ai' | 'note';
  beforeSwitch?: () => Promise<boolean>;
  /** The sermon in memory should carry the new mode without waiting for a refetch. */
  onSwitched?: (mode: 'manual' | 'ai' | 'note') => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  // Manual and note modes share a route, so navigation preserves this component.
  // Keep the guard until the destination renders, then allow another switch.
  useEffect(() => {
    setSwitching(false);
  }, [current, sermon?.id]);

  const go = async (mode: 'manual' | 'ai' | 'note') => {
    if (mode === current || switching || !sermon) return;
    setSwitching(true);
    try {
      if (beforeSwitch && !await beforeSwitch()) { setSwitching(false); return; }
      /**
       * RECORD FIRST, TRAVEL SECOND. Navigating first would leave the other screen deciding
       * what it is from a sermon that still says the old thing — and on a slow connection the
       * person would arrive, look at the toggle, and see it pointing back where they came from.
       */
      await savePlanModeViaClient(sermon.id, mode);
      onSwitched?.(mode);
      router.push(mode === 'note' ? `/sermons/${sermon.id}/plan/manual?source=note` : mode === 'manual' ? `/sermons/${sermon.id}/plan/manual` : `/sermons/${sermon.id}/plan`);
    } catch (error) {
      debugLog("Switching the plan editor failed", { sermonId: sermon.id, mode, error });
      toast.error(t("plan.modeSwitchFailed"));
      setSwitching(false);
    }
  };

  const option = (mode: 'manual' | 'ai' | 'note', label: string) => (
    <button
      type="button"
      onClick={() => void go(mode)}
      disabled={switching}
      aria-pressed={mode === current}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        mode === current
          ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
          : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
      <span className="px-2 text-xs text-gray-500 dark:text-gray-400">{t("plan.modeLabel")}</span>
      {option('manual', t("plan.modeManual"))}
      {option('ai', t("plan.modeFromThoughts"))}
      {(sermon?.sourceNoteIds?.length || current === 'note') ? option('note', t('plan.fromNote.mode')) : null}
    </div>
  );
}
