'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useModalLayer } from '@/hooks/useModalLayer';

/*
 * A WINDOW OVER THE READER — the cross references of a verse, the verse as marked in another Bible.
 * Reading stays where it was: the window lies over the page. A window opened from a window (one link out
 * of a verse's links, `depth` 2) lies over it as a cascade, a little narrower and lower, so the one under
 * it shows around it and is found exactly as it was when this one closes (the owner, 2026-10-16). A phone gets it from the bottom edge, a
 * tablet in the middle, a wide screen as a card on the right — as wide as the screen allows a verse's
 * text to read whole (the owner, 2026-10-16), and a tenth wider than that since (the owner, 2026-10-20:
 * a tablet keeps its width). The keyboard goes into the window and
 * stays there — over a passage window too, whose own trap yields to the window above it — and goes
 * back to what opened it.
 */
export function ReaderSheet({ titleId, onClose, layerClassName = 'z-[120]', depth = 1, fill = false, children }: {
  titleId: string;
  onClose: () => void;
  /** The window's layer: over the reader, or over the passage window, which stands at z-[250]. */
  layerClassName?: string;
  /** 1 — over the page; 2 — over another of these windows, as a cascade. */
  depth?: 1 | 2;
  /**
   * The window keeps its full height and does not scroll itself: its content is a column whose own
   * pane scrolls between a head and a foot that stay — a link's chapter (only with `depth` 2).
   */
  fill?: boolean;
  children: ReactNode;
}) {
  const stacked = depth === 2;
  const frame = stacked
    ? `ring-1 ring-gray-900/10 md:max-w-2xl xl:mr-12 xl:mt-44 xl:w-[28.5rem] dark:ring-white/10 ${fill
      ? 'flex h-[78dvh] flex-col overflow-hidden xl:h-[calc(100dvh-13rem)]'
      : 'max-h-[72dvh] overflow-y-auto xl:max-h-[calc(100dvh-13rem)]'}`
    : 'max-h-[85dvh] overflow-y-auto md:max-w-3xl xl:mr-6 xl:mt-24 xl:max-h-[calc(100dvh-8rem)] xl:w-[31rem]';
  const layer = useModalLayer({ onClose, active: true });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef, true);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div {...layer} className={`fixed inset-0 ${layerClassName} flex items-end justify-center xl:items-start xl:justify-end`}>
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} className={`absolute inset-0 cursor-default ${stacked ? 'bg-black/20' : 'bg-black/30'}`} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full rounded-t-3xl bg-white px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2 shadow-2xl dark:bg-gray-900 xl:rounded-3xl xl:pb-5 xl:pt-4 ${frame}`}
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-gray-300 xl:hidden dark:bg-gray-600" />
        {children}
      </div>
    </div>,
    document.body
  );
}

export function SheetCloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" onClick={onClose} aria-label={t('common.close')} className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
      <XMarkIcon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
