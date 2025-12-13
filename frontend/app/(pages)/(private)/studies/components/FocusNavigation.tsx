'use client';

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';

interface FocusNavigationProps {
  currentIndex: number;
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  isQuestion?: boolean;
}

/**
 * Navigation header for Focus Mode.
 * Shows close button, position counter, and prev/next arrows.
 */
export default function FocusNavigation({
  currentIndex,
  totalCount,
  onPrev,
  onNext,
  onClose,
  hasPrev,
  hasNext,
  isQuestion = false,
}: FocusNavigationProps) {
  const { t } = useTranslation();

  // Header background changes based on note type
  const headerBgClass = isQuestion
    ? 'bg-amber-50/50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800/30'
    : 'bg-emerald-50/50 dark:bg-emerald-900/20 border-b border-emerald-100 dark:border-emerald-800/30';

  const accentTextClass = isQuestion
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-emerald-600 dark:text-emerald-400';

  const navButtonClass = isQuestion
    ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/40'
    : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-800/40';

  return (
    <div
      className={`flex items-center justify-between px-4 py-3 md:px-6 md:py-4 rounded-t-2xl ${headerBgClass}`}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="p-2 rounded-full text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150"
        title={t('studiesWorkspace.focusMode.exitFocus')}
        aria-label={t('studiesWorkspace.focusMode.exitFocus')}
      >
        <XMarkIcon className="h-5 w-5" />
      </button>

      {/* Counter */}
      <span className={`text-sm font-medium ${accentTextClass}`}>
        {t('studiesWorkspace.focusMode.noteOf', {
          current: currentIndex + 1,
          total: totalCount,
        })}
      </span>

      {/* Navigation arrows */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={!hasPrev}
          className={`p-2 rounded-full ${navButtonClass} disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150`}
          title={t('studiesWorkspace.focusMode.prevNote')}
          aria-label={t('studiesWorkspace.focusMode.prevNote')}
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasNext}
          className={`p-2 rounded-full ${navButtonClass} disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150`}
          title={t('studiesWorkspace.focusMode.nextNote')}
          aria-label={t('studiesWorkspace.focusMode.nextNote')}
        >
          <ChevronRightIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

