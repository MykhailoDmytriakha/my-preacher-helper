import React from "react";
import { useTranslation } from 'react-i18next';

import { getSectionLabel } from '@lib/sections';

import type { SectionId } from '../hooks/useFocusMode';

// Literal classes (Tailwind JIT does not pick up dynamic `bg-${x}-500` strings).
// Design split (Norman + Rams): COLOR carries section identity (the dot, always on),
// while FILL vs. OUTLINE carries on/off state — so a pill reads as a toggle, not an
// action button. Tones stay soft so the toolbar is calm instead of shouting at full
// saturation.
const PILL_STYLES: Record<SectionId, { dot: string; on: string }> = {
  introduction: {
    dot: 'bg-amber-500',
    on: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700/60',
  },
  main: {
    dot: 'bg-blue-500',
    on: 'bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-700/60',
  },
  conclusion: {
    dot: 'bg-emerald-500',
    on: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-700/60',
  },
};

// Off state is shared and quiet: the dot keeps the section's identity, while a
// dashed, muted pill signals "this section is currently hidden".
const OFF =
  'bg-transparent text-gray-500 border-dashed border-gray-300 hover:bg-gray-50 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-800/40';

const ORDER: SectionId[] = ['introduction', 'main', 'conclusion'];

interface SectionVisibilityPillsProps {
  visibleSections: string[];
  onToggle: (id: string) => void;
}

/**
 * The single control that drives the structure layout: toggle which sections are
 * on screen. 1 on = focus mode · 2 on = a pair · 3 on = whole plan. At least one
 * section always stays visible (the last active pill is disabled).
 */
export const SectionVisibilityPills: React.FC<SectionVisibilityPillsProps> = ({ visibleSections, onToggle }) => {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="section-visibility-pills"
      role="group"
      aria-label={t('structure.showSections')}
    >
      {ORDER.map((id) => {
        const on = visibleSections.includes(id);
        const isLastActive = on && visibleSections.length === 1;
        const s = PILL_STYLES[id];
        return (
          <button
            key={id}
            onClick={() => onToggle(id)}
            aria-pressed={on}
            disabled={isLastActive}
            title={isLastActive ? t('structure.lastSectionHint') : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed ${on ? s.on : OFF}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} aria-hidden="true" />
            {getSectionLabel(t, id)}
          </button>
        );
      })}
    </div>
  );
};

export default SectionVisibilityPills;
