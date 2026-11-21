'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useRef, useState } from 'react';

import { BOOK_PART_TONES } from '@/utils/themeColors';
import { TOUCH_AREA } from '@/utils/touchTarget';
import { useTranslation } from '@locales/useTranslation';

import { PickerWindow, TRIGGER_OPEN } from './BiblePicker';
import { partsOf, type Testament } from './bookOrder';

/** The memo's width on a computer, as on the canvas board «Итог». */
const MEMO_WIDTH = 540;

/**
 * «?» beside a Testament: how to remember the order of its books — the groups in the order this Bible prints them,
 * a split group with its parts, each part's square in its books' colour. A book shows no hint on hover: the whole
 * explanation lives here (owner, 2026-11-21, canvas «Библия — группы книг»). A window of the page like a book's —
 * under its button on a computer, a sheet from the bottom on a phone.
 */
export function BookGroupsHelp({ testament, wide }: { testament: Testament; wide: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const title = t(`bible.bookGroupsHelp.title.${testament.key}`);
  const close = () => setOpen(false);

  return (
    <>
      {/* A bordered 32 px circle: the finger's layer starts inside the border, so «compact» would leave 42 px (Codex, 2026-11-21). */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={title}
        className={`${TOUCH_AREA.small} inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${open
          ? `${TRIGGER_OPEN} text-indigo-700 dark:text-indigo-300`
          : 'border-gray-300 bg-white text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300'}`}
      >
        ?
      </button>
      <PickerWindow open={open} onClose={close} anchorRef={triggerRef} returnFocusTo={triggerRef} align="start" width={wide ? MEMO_WIDTH : undefined} wide={wide} label={title}>
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[15px] font-bold leading-6 text-gray-900 dark:text-white">{title}</h3>
            <button
              type="button"
              onClick={close}
              aria-label={t('common.close')}
              className={`${TOUCH_AREA.compact} -mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200`}
            >
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <ol className="flex flex-col gap-3 text-[13px] leading-5 text-gray-700 dark:text-gray-300">
            {testament.groups.map((group, index) => {
              const parts = partsOf(group);
              return (
                <li key={group.key} className="flex flex-col gap-1.5">
                  <p>
                    <strong className="font-bold text-gray-900 dark:text-white">{index + 1}. {t(`bible.groups.${group.key}`)}</strong>
                    {' — '}{t(`bible.bookGroupsHelp.groups.${group.key}`)}
                  </p>
                  {parts ? (
                    <ul className="flex flex-col gap-1 pl-[18px]">
                      {parts.map((part, partIndex) => (
                        <li key={part.key} className="flex items-start gap-2.5">
                          <span aria-hidden="true" className={`mt-[3px] h-3.5 w-3.5 shrink-0 rounded border ${BOOK_PART_TONES[partIndex].swatch}`} />
                          <span>
                            <strong className="font-semibold text-gray-900 dark:text-white">{t(`bible.bookParts.${part.key}.name`)}</strong>
                            {' — '}{t(`bible.bookParts.${part.key}.memo`)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      </PickerWindow>
    </>
  );
}
