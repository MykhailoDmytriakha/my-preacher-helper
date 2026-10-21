'use client';

import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { linkBefore, ownLink, type Trail, type TrailPlace } from '@/utils/placeTrail';
import { placeIn } from '@/utils/versification';

import { ownTrailPlace, saveTrailPrefs, usePlaceTrail, useTrailPrefs } from './placeTrailStore';


import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';

/*
 * THE TRAIL ON SCREEN (`placeTrailStore.ts` keeps it, `utils/placeTrail.ts` decides it): a button beside
 * the way back that shows and hides it and counts its links, and the links in a row that scrolls
 * sideways, the place being read lit. Every link looks the same — which ones are recent is the rule's
 * business, not the person's (the owner, 2026-10-20). On a wide screen the row stands under the book's
 * line; on a phone above the bar with the way back, under the thumb.
 */

/** A link's place in the Bible being read: a place kept in another Bible is found in this one. */
export function trailPlaceIn(bible: BibleId, link: TrailPlace): { chapter: number; verse: number } | null {
  if (link.bible === bible) return { chapter: link.chapter, verse: link.verse };
  const found = placeIn(bible, link.bible, { book: link.book, chapter: link.chapter, verse: link.verse });
  return found ? { chapter: found.chapter, verse: found.verse } : null;
}

function linkLabel(link: TrailPlace, bible: BibleId, locale: AppLocale): string {
  const place = trailPlaceIn(bible, link) ?? link;
  return `${getLocalizedAbbrev(link.book, locale)} ${place.chapter}:${place.verse}`;
}

const ROUTE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-[18px] w-[18px]">
    <circle cx="5" cy="18" r="2.2" />
    <circle cx="19" cy="6" r="2.2" />
    <path d="M7.2 18H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h6.8" />
  </svg>
);

function buttonClasses(shown: boolean, floating: boolean): string {
  const state = shown
    ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-500/60 dark:bg-indigo-950/50'
    : floating ? 'border-gray-300 bg-white/90 dark:border-gray-600 dark:bg-gray-900/90' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900';
  return floating
    ? `pointer-events-auto inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold tabular-nums text-indigo-700 shadow-lg shadow-gray-900/15 backdrop-blur-md dark:text-indigo-300 dark:shadow-black/40 ${state}`
    : `mr-3 inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold tabular-nums text-indigo-700 transition hover:border-indigo-300 dark:text-indigo-300 ${state}`;
}

function linkClasses(here: boolean): string {
  return `inline-flex min-h-9 items-center whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold tabular-nums transition ${here
    ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-400 dark:bg-indigo-500'
    : 'border-gray-200 bg-white text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-gray-700 dark:bg-gray-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40'}`;
}

export function PlaceTrailButton({ count, shown, floating, onToggle }: { count: number; shown: boolean; floating: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      aria-label={t('bible.trail.toggle', { count })}
      className={buttonClasses(shown, floating)}
    >
      {ROUTE_ICON}
      {count}
    </button>
  );
}

export function PlaceTrailStrip({ trail, bible, locale, floating, onGo }: {
  trail: Trail; bible: BibleId; locale: AppLocale; floating: boolean; onGo: (link: TrailPlace) => void;
}) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLElement | null>(null);
  // The place being read stands in the middle of the row whenever it changes — a new link at the end, or
  // the light moved back to an earlier one.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const current = row?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!row || !current) return;
    row.scrollLeft = Math.max(0, current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2);
  }, [trail]);
  return (
    <nav
      ref={rowRef}
      aria-label={t('bible.trail.title')}
      className={floating
        ? 'pointer-events-auto fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-4 right-20 z-30 overflow-x-auto overscroll-contain rounded-full border border-gray-200 bg-white/95 px-2 py-1.5 shadow-lg shadow-gray-900/15 backdrop-blur-md dark:border-gray-700 dark:bg-gray-900/95 dark:shadow-black/40'
        : 'relative z-20 mb-3 shrink-0 overflow-x-auto overscroll-contain border-y border-gray-200 bg-gray-50 px-1 py-1.5 dark:border-gray-700 dark:bg-gray-950'}
    >
      <ol className="flex w-max items-center gap-1.5">
        {trail.links.map((link, index) => {
          const here = index === trail.at;
          return (
            <li key={`${index}:${link.book}:${link.chapter}`} className="flex items-center gap-1.5">
              {index > 0 ? <span aria-hidden="true" className="text-gray-400 dark:text-gray-500">›</span> : null}
              <button
                type="button"
                onClick={() => onGo(link)}
                aria-current={here ? 'location' : undefined}
                className={linkClasses(here)}
              >
                {linkLabel(link, bible, locale)}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The trail's look for Settings → Bible: its button with the number of places, and a row of a few
 * places, the last one lit — drawn as the reader draws them, pressing nothing. The words beside it say
 * what it is, so a screen reader is not read the picture.
 */
export function PlaceTrailSample({ labels }: { labels: string[] }) {
  return (
    <div aria-hidden="true" className="flex flex-wrap items-center gap-y-2">
      <span className={buttonClasses(false, false)}>
        {ROUTE_ICON}
        {labels.length}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {labels.map((label, index) => (
          <span key={label} className="flex items-center gap-1.5">
            {index > 0 ? <span className="text-gray-400 dark:text-gray-500">›</span> : null}
            <span className={linkClasses(index === labels.length - 1)}>{label}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * The way back along the trail: the screen of the app the reader's own link was opened from (a note), which
 * stands left of it; else the link left of it, with its place in the Bible being read.
 */
export type TrailBack =
  | { kind: 'screen'; screen: string }
  | { kind: 'link'; index: number; book: string; place: { chapter: number; verse: number }; label: string };

/**
 * The trail in the reader, where the screen puts it: on a wide screen the button in the book's line and
 * the row under it; on a phone the button in the bar with the way back and the row above that bar. A
 * trail of one link — the place being read — has nothing to show. A link opens its place through the
 * reader's own move to a place (`openPlace`), which brings it to the trail. `back` is the reader's way
 * back: the link left of the place being read (the owner, 2026-10-20: "←" goes left along the trail).
 */
export function useReaderTrail({ bible, locale, wide, here, openPlace }: {
  bible: BibleId; locale: AppLocale; wide: boolean; here: TrailPlace; openPlace: (book: string, place: { chapter: number; verse: number }) => void;
}): { inLine: ReactNode; underLine: ReactNode; inBar: ReactNode; overBar: ReactNode; back: TrailBack | null } {
  const trail = usePlaceTrail();
  const prefs = useTrailPrefs();
  const toggle = useCallback(() => saveTrailPrefs({ shown: !prefs.shown }, 'reader'), [prefs.shown]);
  const go = useCallback((link: TrailPlace) => {
    const place = trailPlaceIn(bible, link);
    if (place) openPlace(link.book, place);
  }, [bible, openPlace]);
  // From the place this page last put on the trail: a jump that did not scroll tells the reader nothing.
  const mine = ownTrailPlace() ?? here;
  const screen = trail.links[ownLink(trail, mine)]?.screen;
  const before = linkBefore(trail, mine);
  const link = trail.links[before];
  const place = link ? trailPlaceIn(bible, link) : null;
  const back: TrailBack | null = screen
    ? { kind: 'screen', screen }
    : link && place ? { kind: 'link', index: before, book: link.book, place, label: linkLabel(link, bible, locale) } : null;
  if (trail.links.length < 2) return { inLine: null, underLine: null, inBar: null, overBar: null, back };
  const button = <PlaceTrailButton count={trail.links.length} shown={prefs.shown} floating={!wide} onToggle={toggle} />;
  const row = prefs.shown ? <PlaceTrailStrip trail={trail} bible={bible} locale={locale} floating={!wide} onGo={go} /> : null;
  return wide
    ? { inLine: button, underLine: row, inBar: null, overBar: null, back }
    : { inLine: null, underLine: null, inBar: button, overBar: row, back };
}
