'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useModalLayer } from '@/hooks/useModalLayer';

/*
 * A WINDOW OVER THE READER — the cross references of a verse, the verse as marked in another Bible.
 * Reading stays where it was: the window lies over the page. A phone gets it from the bottom edge, a
 * tablet in the middle, a wide screen as a card on the right. The keyboard goes into the window and
 * stays there — over a passage window too, whose own trap yields to the window above it — and goes
 * back to what opened it.
 */
export function ReaderSheet({ titleId, onClose, layerClassName = 'z-[120]', children }: {
  titleId: string;
  onClose: () => void;
  /** The window's layer: over the reader, or over the passage window, which stands at z-[250]. */
  layerClassName?: string;
  children: ReactNode;
}) {
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
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-black/30" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-white px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2 shadow-2xl dark:bg-gray-900 md:max-w-xl xl:mr-6 xl:mt-24 xl:max-h-[calc(100dvh-8rem)] xl:w-[24rem] xl:rounded-3xl xl:pb-5 xl:pt-4"
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-gray-300 xl:hidden dark:bg-gray-600" />
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
