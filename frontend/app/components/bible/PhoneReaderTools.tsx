'use client';

import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { Type } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { TextScaleControls } from '@/components/TextScaleControls';

import { MarkToolbar } from './marks/MarkToolbar';
import { EraserIcon, MarkerIcon, PencilIcon } from './marks/MarkToolIcons';

import type { MarkToolState } from './marks/markTool';

/**
 * With the menu closed, Escape puts the tool in hand away, as on a wide screen (`MarkToolbar`). Open, Escape closes
 * the menu first and the tool stays — it is what marks the text, and the button wears it. The text card leaves no
 * toolbar mounted to hear that second Escape (Codex, 2026-10-26), so the button hears it.
 */
function EscapePutsAway({ active, putAway }: { active: boolean; putAway: (() => void) | undefined }) {
  useEffect(() => {
    if (!active || !putAway) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') putAway();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, putAway]);
  return null;
}

/** One thumb target lends the existing toolbar and text controls the same corner. */
export function PhoneReaderTools({ tool, children }: { tool: MarkToolState | null; children: ReactNode | ((trigger: RefObject<HTMLButtonElement | null>) => ReactNode) }) {
  const { t } = useTranslation();
  const [textOpen, setTextOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // The T button leaves the panel when the card opens; hand its focus to the first text control.
  useEffect(() => {
    if (textOpen) cardRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [textOpen]);
  const active = tool?.inHand;
  const face = !tool ? <Type className="h-6 w-6" aria-hidden="true" />
    : active === 'pencil' ? <PencilIcon line={tool.pencilColor} />
      : active === 'eraser' ? <EraserIcon /> : <MarkerIcon nib={tool.color} />;
  return (
    <Popover className="page-gesture-follow fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-50">
      {({ open }) => <>
        <EscapePutsAway active={!open && Boolean(active)} putAway={tool?.putAway} />
        <PopoverButton
          ref={triggerRef}
          onClick={() => setTextOpen(!tool)}
          aria-label={t(tool ? 'bible.toolsAndText' : 'textScale.open')}
          className={`flex h-14 w-14 items-center justify-center rounded-full border shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${active
            ? 'border-indigo-500 bg-indigo-600 text-white [&_circle]:fill-indigo-600 dark:bg-indigo-500 dark:[&_circle]:fill-indigo-500'
            : 'border-gray-300 bg-white text-indigo-700 dark:border-gray-600 dark:bg-gray-900 dark:text-indigo-300'}`}
        >
          {face}
        </PopoverButton>
        {/* A picker opened from the text card portals outside the popover. Keep its owner mounted
            when that focus closes the popover, so the picker can finish choosing a translation. */}
        <PopoverPanel unmount={false} focus className={`absolute bottom-full right-0 mb-3 max-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain rounded-3xl border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-900 ${textOpen || !tool ? 'w-[min(21rem,calc(100vw-2rem))]' : 'w-14'}`}>
          {textOpen ? (
            <div ref={cardRef} role="group" aria-label={t('textScale.title')}>
              <TextScaleControls showPercentage className="justify-center" />
              <div className="mx-2 mt-1 border-t border-gray-200 pt-1 dark:border-gray-700">{typeof children === 'function' ? children(triggerRef) : children}</div>
            </div>
          ) : tool ? (
            <>
              <MarkToolbar tool={tool} vertical />
              <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
              <button type="button" onClick={() => setTextOpen(true)} aria-label={t('textScale.open')}
                className="flex h-10 w-10 items-center justify-center rounded-full text-indigo-700 hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-950">
                <Type className="h-5 w-5" aria-hidden="true" />
              </button>
            </>
          ) : null}
        </PopoverPanel>
      </>}
    </Popover>
  );
}
