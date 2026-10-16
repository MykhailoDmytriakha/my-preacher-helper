'use client';

import { useTranslation } from 'react-i18next';

import { MARK_COLORS } from '@/utils/bibleMarks';

/*
 * WHAT THE COLOURS MEAN — a reference, not a label on every use (the owner, 2026-10-16): it lives in
 * the reader's "T" menu, under the text size and the cross references. The swatch is the colour the
 * words take (`globals.css`, `::highlight(bible-mark-…)`), so the legend reads like the page.
 */
const FILL: Record<(typeof MARK_COLORS)[number], string> = {
  red: 'bg-[#fdd8d8] dark:bg-[rgba(255,107,107,0.30)]',
  green: 'bg-[#d3f2df] dark:bg-[rgba(61,214,140,0.26)]',
  yellow: 'bg-[#fff0a0] dark:bg-[rgba(255,214,10,0.30)]',
  orange: 'bg-[#ffdcc2] dark:bg-[rgba(255,139,62,0.30)]',
  blue: 'bg-[#d9e2fc] dark:bg-[rgba(123,155,255,0.32)]',
};

export function MarkLegend() {
  const { t } = useTranslation();
  return (
    <div className="py-2" data-testid="mark-legend">
      <p className="text-sm font-semibold text-gray-900 dark:text-white">{t('bible.marks.legend')}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {MARK_COLORS.map((color) => (
          <li key={color} className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-200">
            <span aria-hidden="true" className={`h-4 w-7 shrink-0 rounded ${FILL[color]}`} />
            {t(`bible.marks.meaning.${color}`)}
          </li>
        ))}
        <li className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-200">
          <span aria-hidden="true" className="h-4 w-7 shrink-0 border-b-2 border-[#8b8f98] dark:border-gray-400" />
          {t('bible.marks.pencilMeaning')}
        </li>
        <li className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-200">
          <span aria-hidden="true" className="h-4 w-7 shrink-0 border-b-2 border-[#e5484d]" />
          {t('bible.marks.colorPencilMeaning')}
        </li>
      </ul>
    </div>
  );
}
