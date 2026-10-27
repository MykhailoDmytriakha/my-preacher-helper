'use client';

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import Switch from '@/components/ui/Switch';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { verseWords } from '@/utils/bibleText';
import { linkBefore, linkOnScreen, litLinkKey, ownLink, type SeenVerses, type Trail, type TrailPlace } from '@/utils/placeTrail';
import { placeIn } from '@/utils/versification';

import { ownTrailPlace, saveTrailPrefs, usePlaceTrail, useTrailPrefs } from './placeTrailStore';
import { useBookTexts } from './useBookTexts';
import { useFollowAfterClose } from './useFollowAfterClose';


import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';

/*
 * THE TRAIL ON SCREEN (`placeTrailStore.ts` keeps it, `utils/placeTrail.ts` decides it): a button beside
 * the way back that shows and hides it and counts its links, and the links in a row that scrolls
 * sideways, the place being read lit. Every link looks the same — which ones are recent is the rule's
 * business, not the person's (the owner, 2026-10-20). On a screen from 1024 px the trail is a column left
 * of the text, in the margin that stood empty, newest on top (the owner, 2026-10-26); from 768 px the row
 * stands under the book's line; on a phone in a drawer opened from the shell header; on the list
 * of books in place of "Continue", the lit link being where the person stopped (the owner, 2026-10-20).
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

/** The trail's name: its column's and row's label, the drawer's title. */
const TRAIL_TITLE = 'bible.trail.title';

/** Where the trail's button stands: in a wide reader's line, or small in a phone's shell header. */
type ButtonLook = 'line' | 'header';

function buttonClasses(shown: boolean, look: ButtonLook = 'line'): string {
  const state = shown
    ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-500/60 dark:bg-indigo-950/50'
    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900';
  return look === 'header'
    ? `inline-flex h-9 shrink-0 items-center gap-0.5 rounded-full border px-1.5 text-[11px] font-semibold tabular-nums text-indigo-700 dark:text-indigo-300 [&_svg]:h-3.5 [&_svg]:w-3.5 ${state}`
    : `mr-3 inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold tabular-nums text-indigo-700 transition hover:border-indigo-300 dark:text-indigo-300 ${state}`;
}

function linkClasses(here: boolean): string {
  return `inline-flex min-h-9 items-center whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold tabular-nums transition ${here
    ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-400 dark:bg-indigo-500'
    : 'border-gray-200 bg-white text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-gray-700 dark:bg-gray-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40'}`;
}

/** In the line it shows and hides the trail; in a phone's header it opens the trail's drawer. */
export function PlaceTrailButton({ count, shown, look = 'line', onToggle }: { count: number; shown: boolean; look?: ButtonLook; onToggle: () => void }) {
  const { t } = useTranslation();
  const opensDrawer = look === 'header';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={opensDrawer ? undefined : shown}
      aria-haspopup={opensDrawer ? 'dialog' : undefined}
      aria-expanded={opensDrawer ? shown : undefined}
      aria-label={t('bible.trail.toggle', { count })}
      className={buttonClasses(shown, look)}
    >
      {ROUTE_ICON}
      {count}
    </button>
  );
}

/** Where the row stands: under the wide reader's line or on the list of books. */
type StripLook = 'line' | 'page';

/** The row's frame. A capsule's links stand 7 px in on every side, so their rounding (18 px) runs alongside
 *  the capsule's (25 px) — on a wide reader a capsule like the phone's, not a band cut square at the
 *  column's edges (the owner, 2026-10-21). */
const STRIP_FRAMES: Record<StripLook, string> = {
  line: 'relative z-20 mb-3 shrink-0 overflow-hidden rounded-full border border-gray-200 bg-gray-50 p-1.5 dark:border-gray-700 dark:bg-gray-950',
  page: 'relative min-w-0 py-1.5',
};

/**
 * A link cut by the row's edge fades out instead of standing there as a broken pill (a capsule's rounding
 * cut one to a sliver). Only an end that hides links fades: at rest the row's first and last links stand
 * whole. The row scrolls inside the frame, so the frame's own border never fades.
 */
const FADED_ENDS = {
  none: '',
  start: '[mask-image:linear-gradient(to_right,transparent,#000_1.5rem)]',
  end: '[mask-image:linear-gradient(to_left,transparent,#000_1.5rem)]',
  both: '[mask-image:linear-gradient(to_right,transparent,#000_1.5rem,#000_calc(100%_-_1.5rem),transparent)]',
} as const;

function useHiddenEnds(rowRef: RefObject<HTMLElement | null>): keyof typeof FADED_ENDS {
  const [ends, setEnds] = useState<keyof typeof FADED_ENDS>('none');
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const measure = () => {
      const start = row.scrollLeft > 1;
      const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
      setEnds(start && end ? 'both' : start ? 'start' : end ? 'end' : 'none');
    };
    measure();
    row.addEventListener('scroll', measure, { passive: true });
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    sizes?.observe(row);
    if (row.firstElementChild) sizes?.observe(row.firstElementChild);
    return () => {
      row.removeEventListener('scroll', measure);
      sizes?.disconnect();
    };
  }, [rowRef]);
  return ends;
}

export function PlaceTrailStrip({ trail, bible, locale, look, onGo, lit = false }: {
  trail: Trail; bible: BibleId; locale: AppLocale; look: StripLook; onGo: (link: TrailPlace) => void;
  /** The light's link is shown lit — only while its verse is on the screen (`useReaderTrail`). */
  lit?: boolean;
}) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const hidden = useHiddenEnds(rowRef);
  // The place being read stands in the middle of the row whenever the light goes to another link or the
  // links shift — a new link at the end, the light moved back; while only the lit link's verse moves
  // (reading on) the row stays where it was scrolled.
  const light = litLinkKey(trail);
  useLayoutEffect(() => {
    const row = rowRef.current;
    const current = row?.querySelector<HTMLElement>('[data-trail-at]');
    if (!row || !current) return;
    row.scrollLeft = Math.max(0, current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2);
  }, [light]);
  return (
    <nav aria-label={t(TRAIL_TITLE)} className={STRIP_FRAMES[look]}>
      <div ref={rowRef} className={`overflow-x-auto overscroll-contain ${look === 'page' ? 'px-4' : ''} ${FADED_ENDS[hidden]}`}>
        <ol className="flex w-max items-center gap-1.5">
          {trail.links.map((link, index) => {
            const here = lit && index === trail.at;
            return (
              <li key={`${index}:${link.book}:${link.chapter}:${link.verse}`} className="flex items-center gap-1.5">
                {index > 0 ? <span aria-hidden="true" className="text-gray-400 dark:text-gray-500">›</span> : null}
                <button
                  type="button"
                  onClick={() => onGo(link)}
                  data-trail-at={index === trail.at ? '' : undefined}
                  aria-current={here ? 'location' : undefined}
                  className={linkClasses(here)}
                >
                  {linkLabel(link, bible, locale)}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

/**
 * The column's width, and the reader's with it: the reader widens left by the column and its gap (the
 * reader's `gap-5`), so the column takes the empty margin first and the text only the rest — on a 1680 px
 * screen the text keeps its whole width (canvas v67, row «История слева»). Literal classes, for Tailwind.
 */
const COLUMN_WIDTH = { places: 'w-[164px]', verses: 'w-[244px]' } as const;
const READER_WIDTH = { alone: 'max-w-7xl', places: 'max-w-[1464px]', verses: 'max-w-[1544px]' } as const;

/** Where the light's link stands: in the middle of the column, measured against the column's own box. */
function centreLit(list: HTMLElement | null) {
  const current = list?.querySelector<HTMLElement>('[data-trail-at]');
  if (!list || !current) return;
  const box = list.getBoundingClientRect();
  const at = current.getBoundingClientRect();
  list.scrollTop = Math.max(0, list.scrollTop + at.top - box.top - (list.clientHeight - at.height) / 2);
}

/**
 * The trail as a column left of the text, newest on top: the place just reached is the first line, the
 * one under it is where "←" goes, and stepping back moves the light down the column, as it moves left
 * along the row (canvas v67, «←» in Play). A line of dots runs along the links, the lit one filled. At its foot the
 * switch "Verse start" puts the first words of each place's verse under it — off by default, so more
 * places fit (the owner, 2026-10-26: «только с начала стиха переключателем показывается»). The texts of
 * the places' books are fetched only while it is on.
 */
export function PlaceTrailColumn({ trail, bible, locale, verseStart, onToggleVerseStart, onGo, look = 'reader', lit = false }: {
  trail: Trail; bible: BibleId; locale: AppLocale; verseStart: boolean; onToggleVerseStart: () => void; onGo: (link: TrailPlace) => void;
  /** The light's link is shown lit — only while its verse is on the screen (`useReaderTrail`). */
  lit?: boolean;
  /** In the reader the column ends above the screen's edge, as the minimap does; on the list of books, with the Testaments. */
  look?: 'reader' | 'page' | 'drawer';
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const books = verseStart ? trail.links.map((link) => link.book) : [];
  const texts = useBookTexts(books, bible);
  // The light going to another link (or the links shifting) brings it into view; reading on, which only
  // moves the lit link's verse, leaves the column where the person scrolled it.
  const light = litLinkKey(trail);
  useLayoutEffect(() => centreLit(listRef.current), [light, verseStart]);
  const newestFirst = trail.links.map((link, index) => ({ link, index })).reverse();
  const width = verseStart ? COLUMN_WIDTH.verses : COLUMN_WIDTH.places;
  const frame = 'flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900';
  // On the list of books the column takes the Testaments' height and scrolls its places inside: standing in
  // the flow, thirty places would make it longer than the page and push its switch off the screen.
  const column = (
    <nav aria-labelledby={titleId} className={look === 'drawer' ? 'flex min-h-0 flex-1 flex-col' : look === 'reader' ? `mb-4 shrink-0 self-stretch ${width} ${frame}` : `absolute inset-0 ${frame}`}>
      <div id={titleId} className={`${look === 'drawer' ? 'sr-only' : ''} flex h-11 shrink-0 items-center gap-2 border-b border-gray-100 px-3.5 text-[13px] font-semibold text-gray-500 dark:border-gray-800 dark:text-gray-400`}>
        <span aria-hidden="true" className="text-indigo-700 dark:text-indigo-300">{ROUTE_ICON}</span>
        {t(TRAIL_TITLE)}
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2.5 pt-1.5">
        <ol>
          {newestFirst.map(({ link, index }, position) => {
            const here = lit && index === trail.at;
            const place = trailPlaceIn(bible, link) ?? link;
            const verse = verseStart ? texts.get(link.book)?.chapters[place.chapter - 1]?.[place.verse - 1] : undefined;
            // One link (the list of books shows even one) has no line to run along.
            const line = newestFirst.length === 1 ? 'hidden' : position === 0 ? 'top-1/2 bottom-0' : position === newestFirst.length - 1 ? 'top-0 bottom-1/2' : 'inset-y-0';
            return (
              <li key={`${index}:${link.book}:${link.chapter}:${link.verse}`} className="relative flex items-stretch pl-5">
                <span aria-hidden="true" className={`absolute left-[7px] w-0.5 bg-gray-200 dark:bg-gray-700 ${line}`} />
                <span
                  aria-hidden="true"
                  className={`absolute top-1/2 -translate-y-1/2 rounded-full border-2 ${here
                    ? 'left-0.5 h-3 w-3 border-indigo-600 bg-indigo-600 ring-[3px] ring-indigo-100 dark:border-indigo-500 dark:bg-indigo-500 dark:ring-indigo-500/30'
                    : 'left-1 h-2 w-2 border-indigo-400 bg-white dark:bg-gray-900'}`}
                />
                <button
                  type="button"
                  onClick={() => onGo(link)}
                  data-trail-at={index === trail.at ? '' : undefined}
                  aria-current={here ? 'location' : undefined}
                  className={`my-px flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-[10px] px-2.5 py-1.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${verseStart ? 'min-h-[54px]' : 'min-h-[34px]'} ${here ? 'bg-indigo-600 dark:bg-indigo-500' : 'hover:bg-indigo-50 dark:hover:bg-indigo-950/40'}`}
                >
                  <span className={`whitespace-nowrap text-[13px] font-semibold tabular-nums ${here ? 'text-white' : 'text-indigo-700 dark:text-indigo-300'}`}>
                    {linkLabel(link, bible, locale)}
                  </span>
                  {verse ? (
                    <span className={`line-clamp-2 text-xs leading-[1.4] ${here ? 'text-white/85' : 'text-gray-500 dark:text-gray-400'}`}>
                      {verseWords(verse).trim()}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="shrink-0 border-t border-gray-100 px-2 dark:border-gray-800">
        <Switch checked={verseStart} onClick={onToggleVerseStart} label={t('bible.trail.verseStart')} className="w-full justify-between" />
      </div>
    </nav>
  );
  return look !== 'page' ? column : <div className={`relative shrink-0 ${width}`}>{column}</div>;
}

/**
 * The trail on the list of books, in place of "Continue": the trail's sign, then its row, every link alike —
 * nothing is being read here (the owner, 2026-10-27: a link is lit only while its verse is on the screen). A link opens the reader at its place (`onOpen`), and the reader's arrival
 * lights it or adds it, as a tap on the row in the reader does. An empty trail shows nothing.
 */
export function PlaceTrailOnList({ trail, bible, locale, onOpen }: {
  trail: Trail; bible: BibleId; locale: AppLocale; onOpen: (book: string, place: { chapter: number; verse: number }) => void;
}) {
  const go = useCallback((link: TrailPlace) => {
    const place = trailPlaceIn(bible, link);
    if (place) onOpen(link.book, place);
  }, [bible, onOpen]);
  if (trail.links.length === 0) return null;
  return (
    <div className="flex w-full items-center rounded-2xl border border-gray-200 bg-white pl-3 dark:border-gray-700 dark:bg-gray-900">
      <span aria-hidden="true" className="shrink-0 text-indigo-700 dark:text-indigo-300">{ROUTE_ICON}</span>
      <PlaceTrailStrip trail={trail} bible={bible} locale={locale} look="page" onGo={go} />
    </div>
  );
}

/**
 * The trail on the list of books, where the screen puts it: from 1024 px a column left of the Testaments,
 * newest on top, the page widening left by it as the reader does (`pageWidth`); narrower, the row above
 * them (`above`). A link opens the reader at its place, whose arrival lights it or adds it.
 */
export function useTrailOnList({ trail, bible, locale, onOpen }: {
  trail: Trail; bible: BibleId; locale: AppLocale; onOpen: (book: string, place: { chapter: number; verse: number }) => void;
}): { above: ReactNode; beside: ReactNode; pageWidth: string } {
  const prefs = useTrailPrefs();
  const roomForColumn = useMediaQuery('(min-width: 1024px)', false);
  const toggleVerseStart = useCallback(() => saveTrailPrefs({ verseStart: !prefs.verseStart }, 'list'), [prefs.verseStart]);
  const go = useCallback((link: TrailPlace) => {
    const place = trailPlaceIn(bible, link);
    if (place) onOpen(link.book, place);
  }, [bible, onOpen]);
  if (trail.links.length === 0) return { above: null, beside: null, pageWidth: READER_WIDTH.alone };
  if (!roomForColumn) return { above: <PlaceTrailOnList trail={trail} bible={bible} locale={locale} onOpen={onOpen} />, beside: null, pageWidth: READER_WIDTH.alone };
  return {
    above: null,
    beside: <PlaceTrailColumn trail={trail} bible={bible} locale={locale} verseStart={prefs.verseStart} onToggleVerseStart={toggleVerseStart} onGo={go} look="page" />,
    pageWidth: prefs.verseStart ? READER_WIDTH.verses : READER_WIDTH.places,
  };
}

/**
 * The trail's look for Settings → Bible: its button with the number of places, and a row of a few
 * places, the last one lit — drawn as the reader draws them, pressing nothing. The words beside it say
 * what it is, so a screen reader is not read the picture.
 */
export function PlaceTrailSample({ labels }: { labels: string[] }) {
  return (
    <div aria-hidden="true" className="flex flex-wrap items-center gap-y-2">
      <span className={buttonClasses(false)}>
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
 * The trail in the reader, where the screen puts it: on a screen from 1024 px the button in the book's
 * line and the column left of the text (`beside`), the reader widening by it (`readerWidth`); from 768 px
 * the button in the line and the row under it; on a phone the button in the shell header and a drawer from the left edge. A trail of one link — the place being
 * read — has nothing to show. A link opens its
 * place through the reader's own move to a place (`openPlace`), which brings it to the trail. `back` is
 * the reader's way back: the link left of the place being read (the owner, 2026-10-20: "←" goes left
 * along the trail).
 */
export function useReaderTrail({ bible, locale, wide, here, seen, openPlace }: {
  bible: BibleId; locale: AppLocale; wide: boolean; here: TrailPlace;
  /** The verses on the screen, first and last: the light's link is lit only while its verse is among them. */
  seen: SeenVerses | null;
  openPlace: (book: string, place: { chapter: number; verse: number }) => void;
}): { inLine: ReactNode; underLine: ReactNode; beside: ReactNode; readerWidth: string; phoneButton: ReactNode; drawer: ReactNode; back: TrailBack | null } {
  const trail = usePlaceTrail();
  const prefs = useTrailPrefs();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openAfterClose = useFollowAfterClose(drawerOpen, closeDrawer, openPlace);
  useEffect(() => { if (wide) closeDrawer(); }, [wide, closeDrawer]);
  // An iPad standing (820 px) keeps the row: a column there would leave the text some 430 px.
  const roomForColumn = useMediaQuery('(min-width: 1024px)', false);
  const toggle = useCallback(() => saveTrailPrefs({ shown: !prefs.shown }, 'reader'), [prefs.shown]);
  const toggleVerseStart = useCallback(() => saveTrailPrefs({ verseStart: !prefs.verseStart }, 'reader'), [prefs.verseStart]);
  const go = useCallback((link: TrailPlace) => {
    const place = trailPlaceIn(bible, link);
    if (place) {
      if (wide) openPlace(link.book, place);
      else openAfterClose(link.book, place);
    }
  }, [bible, openPlace, openAfterClose, wide]);
  // From the place this page last put on the trail: a jump that did not scroll tells the reader nothing.
  const mine = ownTrailPlace() ?? here;
  const screen = trail.links[ownLink(trail, mine)]?.screen;
  const before = linkBefore(trail, mine);
  const link = trail.links[before];
  const place = link ? trailPlaceIn(bible, link) : null;
  const back: TrailBack | null = screen
    ? { kind: 'screen', screen }
    : link && place ? { kind: 'link', index: before, book: link.book, place, label: linkLabel(link, bible, locale) } : null;
  // Lit only while its verse is on the screen (the owner, 2026-10-27: «выделяется, когда ты прямо на этом стихе»).
  const lit = linkOnScreen(trail.links[trail.at], here.book, seen, bible);
  if (trail.links.length < 2) return { inLine: null, underLine: null, beside: null, readerWidth: READER_WIDTH.alone, phoneButton: null, drawer: null, back };
  const button = <PlaceTrailButton count={trail.links.length} shown={prefs.shown} onToggle={toggle} />;
  if (wide && roomForColumn) {
    const column = prefs.shown
      ? <PlaceTrailColumn trail={trail} bible={bible} locale={locale} verseStart={prefs.verseStart} onToggleVerseStart={toggleVerseStart} onGo={go} lit={lit} />
      : null;
    const readerWidth = !prefs.shown ? READER_WIDTH.alone : prefs.verseStart ? READER_WIDTH.verses : READER_WIDTH.places;
    return { inLine: button, underLine: null, beside: column, readerWidth, phoneButton: null, drawer: null, back };
  }
  const row = wide && prefs.shown ? <PlaceTrailStrip trail={trail} bible={bible} locale={locale} look="line" onGo={go} lit={lit} /> : null;
  return wide
    ? { inLine: button, underLine: row, beside: null, readerWidth: READER_WIDTH.alone, phoneButton: null, drawer: null, back }
    : {
      inLine: null, underLine: null, beside: null, readerWidth: READER_WIDTH.alone, back,
      phoneButton: <PlaceTrailButton count={trail.links.length} shown={drawerOpen} look="header" onToggle={() => setDrawerOpen(true)} />,
      drawer: (
        <TrailDrawer open={drawerOpen} onClose={closeDrawer}>
          <PlaceTrailColumn trail={trail} bible={bible} locale={locale} verseStart={prefs.verseStart} onToggleVerseStart={toggleVerseStart} onGo={go} look="drawer" lit={lit} />
        </TrailDrawer>
      ),
    };
}

function TrailDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} className="relative z-[90]">
      <DialogBackdrop data-testid="trail-drawer-backdrop" className="fixed inset-0 bg-gray-950/40 backdrop-blur-sm" />
      <DialogPanel className="fixed inset-y-0 left-0 flex h-dvh w-[min(300px,80vw)] flex-col border-r border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-3 dark:border-gray-700">
          <DialogTitle className="font-semibold text-gray-900 dark:text-gray-100">{t(TRAIL_TITLE)}</DialogTitle>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-gray-300 dark:hover:bg-gray-800">
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </DialogPanel>
    </Dialog>
  );
}
