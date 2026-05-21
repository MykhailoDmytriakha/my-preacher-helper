'use client';

import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useScrollLock } from '@/hooks/useScrollLock';

export interface StudyReaderShellProps {
  isOpen: boolean;
  onClose: () => void;
  /** Accessible label for the dialog. */
  ariaLabel: string;
  /** Floating top-right action group. */
  topRightSlot?: ReactNode;
  /** Optional sticky header above the scroll body (e.g. eyebrow + title). */
  headerSlot?: ReactNode;
  /** Scrollable body - receives the note content. */
  children: ReactNode;
  /** Modifier to switch aesthetic between the two existing modals. */
  variant?: 'preview' | 'focus';
  /** Optional card styling extension for caller-specific borders/shadows. */
  cardClassName?: string;
  /** Optional body styling override for caller-specific scroll structure. */
  bodyClassName?: string;
  /** Optional overlay-level content outside the card, e.g. a keyboard hint. */
  overlaySlot?: ReactNode;
}

const joinClasses = (...classes: Array<string | false | null | undefined>): string =>
  classes.filter(Boolean).join(' ');

const PREVIEW_CARD_CLASS =
  'relative flex w-full flex-col overflow-hidden rounded-[28px] border border-stone-200/80 bg-stone-50 text-stone-900 shadow-[0_30px_60px_-20px_rgba(15,23,23,0.45),0_15px_30px_-10px_rgba(16,185,129,0.18)] dark:border-stone-800/70 dark:bg-stone-950 dark:text-stone-100';

const FOCUS_CARD_CLASS =
  'absolute inset-1 z-10 flex flex-col rounded-2xl border bg-white dark:bg-gray-800 md:inset-2 lg:inset-3';

const PREVIEW_BODY_CLASS =
  'note-preview-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-2 sm:px-12 sm:pb-12 sm:pt-4';

const FOCUS_BODY_CLASS = 'min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable=true]',
].join(', ');

const getFocusableElements = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.offsetParent !== null);

export default function StudyReaderShell({
  isOpen,
  onClose,
  ariaLabel,
  topRightSlot,
  headerSlot,
  children,
  variant = 'preview',
  cardClassName,
  bodyClassName,
  overlaySlot,
}: StudyReaderShellProps) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    return () => {
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !mounted || !dialogRef.current) return;

    const [firstFocusable] = getFocusableElements(dialogRef.current);
    (firstFocusable ?? dialogRef.current).focus({ preventScroll: true });
  }, [isOpen, mounted]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusableElements = getFocusableElements(dialogRef.current);
    if (focusableElements.length === 0) {
      event.preventDefault();
      return;
    }

    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (activeElement === dialogRef.current) {
      event.preventDefault();
      (event.shiftKey ? lastFocusable : firstFocusable).focus({ preventScroll: true });
      return;
    }

    if (event.shiftKey && activeElement === firstFocusable) {
      event.preventDefault();
      lastFocusable.focus({ preventScroll: true });
      return;
    }

    if (!event.shiftKey && activeElement === lastFocusable) {
      event.preventDefault();
      firstFocusable.focus({ preventScroll: true });
    }
  };

  if (!isOpen || !mounted) return null;

  const isPreview = variant === 'preview';
  const rootClassName = isPreview
    ? 'fixed inset-0 z-[100] flex items-center justify-center px-3 py-6 sm:px-6 sm:py-10'
    : 'fixed inset-0 z-50';
  const backdropClassName = isPreview
    ? 'study-reader-backdrop absolute inset-0 bg-[rgba(15,23,23,0.55)] backdrop-blur-[10px] backdrop-saturate-[1.1]'
    : 'study-reader-backdrop absolute inset-0 z-0 bg-gray-900/40 backdrop-blur-sm';
  const cardStyle = isPreview
    ? { width: 'min(96vw, 920px)', height: 'min(94dvh, 920px)' }
    : undefined;
  const cardBaseClass = isPreview ? PREVIEW_CARD_CLASS : FOCUS_CARD_CLASS;
  const resolvedBodyClassName = bodyClassName ?? (isPreview ? PREVIEW_BODY_CLASS : FOCUS_BODY_CLASS);

  const shell = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={handleDialogKeyDown}
      className={rootClassName}
    >
      <style jsx global>{`
        @keyframes studyReaderBackdropIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes studyReaderCardIn {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .study-reader-backdrop {
          animation: studyReaderBackdropIn 180ms ease-out;
        }
        .study-reader-card {
          animation: studyReaderCardIn 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .note-preview-scroll::-webkit-scrollbar {
          width: 10px;
        }
        .note-preview-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .note-preview-scroll::-webkit-scrollbar-thumb {
          background: rgba(16, 185, 129, 0.18);
          border-radius: 9999px;
          border: 3px solid transparent;
          background-clip: padding-box;
        }
        .note-preview-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(16, 185, 129, 0.35);
          background-clip: padding-box;
          border: 3px solid transparent;
        }
        @media (prefers-reduced-motion: reduce) {
          .study-reader-backdrop,
          .study-reader-card {
            animation: none !important;
          }
        }
      `}</style>
      <div
        aria-hidden="true"
        className={backdropClassName}
        onMouseDown={onClose}
      />
      <div
        onMouseDown={(event) => event.stopPropagation()}
        className={joinClasses('study-reader-card', cardBaseClass, cardClassName)}
        style={cardStyle}
      >
        {topRightSlot ? (
          <div className="absolute right-4 top-4 z-20">{topRightSlot}</div>
        ) : null}
        {headerSlot}
        <div className={resolvedBodyClassName}>{children}</div>
        {isPreview ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-b-[28px] bg-gradient-to-t from-stone-50 via-stone-50/80 to-transparent dark:from-stone-950 dark:via-stone-950/80"
            aria-hidden="true"
          />
        ) : null}
      </div>
      {overlaySlot}
    </div>
  );

  return createPortal(shell, document.body);
}
