import React from "react";
import { useTranslation } from 'react-i18next';

import { getSectionLabel } from '@lib/sections';

import type { SectionId } from '../hooks/useFocusMode';

// Literal classes (Tailwind JIT does not pick up dynamic `bg-${x}-500` strings).
// Colors mirror the section identity used across the structure view.
const PILL_COLORS: Record<SectionId, { on: string; off: string }> = {
  introduction: {
    on: 'bg-amber-500 text-white border-amber-500',
    off: 'text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700/60 hover:bg-amber-50 dark:hover:bg-amber-900/20',
  },
  main: {
    on: 'bg-blue-600 text-white border-blue-600',
    off: 'text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700/60 hover:bg-blue-50 dark:hover:bg-blue-900/20',
  },
  conclusion: {
    on: 'bg-emerald-600 text-white border-emerald-600',
    off: 'text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700/60 hover:bg-emerald-50 dark:hover:bg-emerald-900/20',
  },
};

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
    <div className="flex flex-wrap items-center justify-center gap-2" data-testid="section-visibility-pills">
      <span className="text-sm text-gray-600 dark:text-gray-400">{t('structure.showSections')}:</span>
      {ORDER.map((id) => {
        const on = visibleSections.includes(id);
        const isLastActive = on && visibleSections.length === 1;
        const c = PILL_COLORS[id];
        return (
          <button
            key={id}
            onClick={() => onToggle(id)}
            aria-pressed={on}
            disabled={isLastActive}
            title={isLastActive ? t('structure.lastSectionHint') : undefined}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed ${on ? c.on : c.off}`}
          >
            {getSectionLabel(t, id)}
          </button>
        );
      })}
    </div>
  );
};

export default SectionVisibilityPills;
