'use client';

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { useTranslation } from '@locales/useTranslation';

const RegisterNotice = createContext<(() => () => void) | null>(null);

/** Only an actual notice registers. Its delivery and recovery remain owned by the caller. */
export function SyncNotice({ children }: { children: ReactNode }) {
  const register = useContext(RegisterNotice);
  useEffect(() => register?.(), [register]);
  return <>{children}</>;
}

/** A disclosure attached to the pinned header, outside the reader's scrolling layout. */
export function SyncNoticeDock({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const buttonId = useId();
  const panelId = useId();
  const register = useCallback(() => {
    setCount(current => current + 1);
    return () => setCount(current => current - 1);
  }, []);
  const available = count > 0;
  useEffect(() => {
    if (!available) setOpen(false);
  }, [available]);
  const expanded = available && open;
  useLayoutEffect(() => {
    const element = panel.current;
    const trigger = button.current;
    if (!expanded || !element || !trigger) return;
    const viewport = window.visualViewport;
    const fit = () => {
      const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const room = Math.max(0, bottom - element.getBoundingClientRect().top);
      element.style.setProperty('--sync-notice-room', `${room}px`);
    };
    fit();
    // The pinned header can fold and a translated button can wrap at a new width.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(trigger);
    const header = trigger.closest('nav');
    if (header) observer?.observe(header);
    window.addEventListener('resize', fit);
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', fit);
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
    };
  }, [expanded]);
  const label = t('dataSync.readerNotices');
  return <RegisterNotice.Provider value={register}>
    <div data-sync-notice-open={expanded ? "" : undefined} className="pointer-events-none absolute inset-x-4 top-full mt-1.5 lg:inset-x-auto lg:left-1/2 lg:w-[28rem] lg:-translate-x-1/2"
      onKeyDown={event => {
        if (event.key !== 'Escape' || !open || event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        button.current?.focus({ preventScroll: true });
      }}>
      <span role="status" className="sr-only">{available ? label : ''}</span>
      {available && <button ref={button} id={buttonId} type="button" aria-expanded={open} aria-controls={panelId}
        className="pointer-events-auto ml-auto block min-h-11 max-w-full rounded-full border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-950 shadow-sm hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600 dark:border-amber-700 dark:bg-gray-950 dark:text-amber-200 lg:mx-auto"
        onClick={() => setOpen(current => !current)}>{label}</button>}
      <section ref={panel} id={panelId} aria-labelledby={buttonId} hidden={!expanded} data-gesture-ignore
        className="pointer-events-auto mt-1.5 max-h-[min(32rem,max(0px,calc(var(--sync-notice-room,68dvh)-0.5rem-env(safe-area-inset-bottom))))] w-full overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white px-3 pt-3 shadow-xl dark:border-gray-700 dark:bg-gray-950">
        {children}
      </section>
    </div>
  </RegisterNotice.Provider>;
}
