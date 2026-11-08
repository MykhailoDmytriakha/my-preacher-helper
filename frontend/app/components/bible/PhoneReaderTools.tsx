'use client';

import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { Type } from 'lucide-react';
import { useRef, useState, type ReactNode, type RefObject } from 'react';

import { TextScaleControls } from '@/components/TextScaleControls';
import { useTranslation } from '@locales/useTranslation';

import { MarkCapsule } from './marks/MarkToolbar';

import type { MarkToolState } from './marks/markTool';

type MenuChildren = ReactNode | ((trigger: RefObject<HTMLButtonElement | null>) => ReactNode);

/** The text menu: the size of the text, then what the reader lends it — what the colours mean, the translation, the settings. */
function TextCard({ trigger, children }: { trigger: RefObject<HTMLButtonElement | null>; children: MenuChildren }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t('textScale.title')}>
      <TextScaleControls showPercentage className="justify-center" />
      <div className="mx-2 mt-1 border-t border-gray-200 pt-1 dark:border-gray-700">{typeof children === 'function' ? children(trigger) : children}</div>
    </div>
  );
}

/* A picker opened from the text card portals outside the popover: the card stays mounted when that focus closes the popover,
   so the picker can finish choosing a translation. */
const CARD = 'max-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-3xl border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-900';
const BOTTOM = 'bottom-[calc(1.5rem+env(safe-area-inset-bottom))]';

/**
 * THE READER'S TOOLS ON A PHONE. With marks (`tool`): the capsule at the bottom centre — marker, pencil, eraser and the text
 * menu's «T» — and over it the dots of the colours of the tool in hand (`MarkCapsule`; the owner's choice on the canvas,
 * 2026-11-07, K4: a column at the right edge covered the end of every line while marking). Without marks: one round «T».
 */
export function PhoneReaderTools({ tool, children }: { tool: MarkToolState | null; children: MenuChildren }) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The card is made at the first «T» and kept from then on (`CARD`): a reader that never opens it never mounts its controls.
  const [made, setMade] = useState(false);
  const card = made ? <TextCard trigger={triggerRef}>{children}</TextCard> : null;
  if (!tool) {
    return (
      <Popover className={`page-gesture-follow fixed ${BOTTOM} right-[max(1rem,env(safe-area-inset-right))] z-50`}>
        <PopoverButton
          ref={triggerRef}
          onClick={() => setMade(true)}
          aria-label={t('textScale.open')}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-gray-300 bg-white text-indigo-700 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-indigo-300"
        >
          <Type className="h-6 w-6" aria-hidden="true" />
        </PopoverButton>
        <PopoverPanel unmount={false} focus className={`absolute bottom-full right-0 mb-3 ${CARD}`}>
          {card}
        </PopoverPanel>
      </Popover>
    );
  }
  return (
    <Popover className={`page-gesture-follow fixed inset-x-0 ${BOTTOM} z-50 mx-auto w-fit`}>
      {({ open }) => <>
        <MarkCapsule
          tool={tool}
          menuOpen={open}
          trailing={<>
            <span aria-hidden="true" className="h-7 w-px bg-gray-200 dark:bg-gray-700" />
            <PopoverButton
              ref={triggerRef}
              onClick={() => setMade(true)}
              aria-label={t('textScale.open')}
              className="flex h-10 w-10 items-center justify-center rounded-full text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-950"
            >
              <Type className="h-5 w-5" aria-hidden="true" />
            </PopoverButton>
          </>}
        />
        <PopoverPanel unmount={false} focus className={`absolute bottom-full left-1/2 mb-3 -translate-x-1/2 ${CARD}`}>
          {card}
        </PopoverPanel>
      </>}
    </Popover>
  );
}
