'use client';

import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';

export type SearchSign = '"' | '*' | '_';

const SIGNS: ReadonlyArray<{ sign: SearchSign; shown: string; label: string }> = [
  { sign: '"', shown: '" "', label: 'bible.search.signs.quote' },
  { sign: '*', shown: '*', label: 'bible.search.signs.star' },
  { sign: '_', shown: '_', label: 'bible.search.signs.letter' },
];

/**
 * A touch screen, the line in use: the signs of a search one tap away — on a phone's keyboard they hide
 * on a second page of symbols — and «Как искать» at the left. A press keeps the keyboard up: the line
 * does not lose its focus.
 */
export function SignBar({ onSign, onHelp }: { onSign: (sign: SearchSign) => void; onHelp: () => void }) {
  const { t } = useTranslation();
  const keepFocus = (event: React.PointerEvent | React.MouseEvent) => event.preventDefault();
  return (
    <div className="mt-2 flex items-center gap-1.5 border-t border-gray-100 pt-2 dark:border-gray-800">
      <button
        type="button"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={onHelp}
        className="-ml-2 mr-auto inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        <QuestionMarkCircleIcon className="h-[18px] w-[18px] text-gray-400" aria-hidden="true" />
        {t('bible.search.help')}
      </button>
      {SIGNS.map(({ sign, shown, label }) => (
        <button
          key={sign}
          type="button"
          aria-label={t(label)}
          title={t(label)}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => onSign(sign)}
          className="inline-flex h-11 min-w-12 items-center justify-center rounded-lg bg-gray-100 px-3 text-lg font-semibold text-gray-900 transition active:bg-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:active:bg-gray-700"
        >
          {shown}
        </button>
      ))}
    </div>
  );
}
