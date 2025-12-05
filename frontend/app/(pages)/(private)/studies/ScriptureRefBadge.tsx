'use client';

import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/20/solid';
import { ScriptureReference } from '@/models/models';
import { formatScriptureRef } from './bookAbbreviations';
import { BibleLocale } from './bibleData';

interface ScriptureRefBadgeProps {
  reference: ScriptureReference;
  onClick?: () => void;
  onRemove?: () => void;
  isEditing?: boolean;
}

/**
 * Compact badge/tag display for a Scripture reference.
 * Shows localized abbreviated format based on current language.
 * Example: "Ис.4:5-8" (RU), "Isa.4:5-8" (EN), "Іс.4:5-8" (UK)
 * Click to edit, X button to remove.
 */
const ScriptureRefBadge = memo(function ScriptureRefBadge({
  reference,
  onClick,
  onRemove,
  isEditing = false,
}: ScriptureRefBadgeProps) {
  const { i18n } = useTranslation();

  // Get current locale for Bible data
  const bibleLocale: BibleLocale = useMemo(() => {
    const lang = i18n.language?.toLowerCase() || 'en';
    if (lang.startsWith('ru')) return 'ru';
    if (lang.startsWith('uk')) return 'uk';
    return 'en';
  }, [i18n.language]);

  const displayText = formatScriptureRef(reference, bibleLocale);

  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-full 
        px-3 py-1 text-xs font-medium
        transition-all duration-150
        ${isEditing 
          ? 'bg-emerald-200 text-emerald-900 ring-2 ring-emerald-500 dark:bg-emerald-800 dark:text-emerald-100' 
          : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-200 dark:hover:bg-emerald-800/60'
        }
        ${onClick ? 'cursor-pointer' : ''}
      `}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      aria-label={`${reference.book} ${reference.chapter}:${reference.fromVerse}${reference.toVerse ? '-' + reference.toVerse : ''}`}
    >
      <span>{displayText}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-300 dark:hover:bg-emerald-700 transition-colors"
          aria-label="Remove reference"
        >
          <XMarkIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
});

export default ScriptureRefBadge;

