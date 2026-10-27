'use client';

import { ArrowsRightLeftIcon, ArrowUpOnSquareIcon, CheckCircleIcon, DocumentDuplicateIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent, type MouseEvent, type SVGProps } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useModalLayer } from '@/hooks/useModalLayer';

import { VERSE_TEXT_STYLE } from '../BookRibbon';

import type { VerseCopy, VerseMenuAt } from './useVerseCopy';

/** The click that ends a hold may land on what the hold just opened: for a moment that one click is not a choice. */
const CLICK_AFTER_HOLD_MS = 450;
const EDGE = 8;
const GAP = 10;

type Spot = { menuTop: number; menuLeft: number; cardTop?: number; cardLeft?: number; cardWidth?: number };

function MenuItem({ icon: Icon, label, strong = false, touch, onSelect }: {
  icon: ComponentType<SVGProps<SVGSVGElement>>; label: string; strong?: boolean; touch: boolean; onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return touch ? (
    <button type="button" role="menuitem" onClick={onSelect} className={`flex h-12 w-full items-center justify-between gap-4 border-b border-gray-200 px-4 text-left text-base text-gray-900 last:border-b-0 active:bg-gray-100 dark:border-gray-700 dark:text-gray-100 dark:active:bg-white/10 ${strong ? 'font-semibold' : ''}`}>
      {label}
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
    </button>
  ) : (
    <button type="button" role="menuitem" onClick={onSelect} className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-gray-700 hover:bg-gray-100 focus-visible:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10 dark:focus-visible:bg-white/10 ${strong ? 'font-semibold text-gray-900 dark:text-white' : ''}`}>
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      {label}
    </button>
  );
}

/** The row where it stands now: a turned iPad or a narrowed window has moved it since the press. */
const rowNow = (at: VerseMenuAt) => document.querySelector(`[data-verse="${at.chapter}:${at.verse}"]`)?.getBoundingClientRect() ?? at.row;
const cardWidthFor = (at: VerseMenuAt) => Math.min(rowNow(at).width + 2 * EDGE, window.innerWidth - 2 * EDGE);

/** Where the menu and, under a finger, the lifted verse stand: the verse in place, its menu under it or over it. */
function placeMenu(at: VerseMenuAt, menu: DOMRect, card: DOMRect | null): Spot {
  const row = rowNow(at);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));
  if (!card) {
    return { menuLeft: clamp(at.x, EDGE, width - menu.width - EDGE), menuTop: clamp(at.y, EDGE, height - menu.height - EDGE) };
  }
  const cardWidth = cardWidthFor(at);
  const cardLeft = clamp(row.left - EDGE, EDGE, width - cardWidth - EDGE);
  let cardTop = clamp(row.top - EDGE, EDGE, height - card.height - EDGE);
  let menuTop = cardTop + card.height + GAP;
  if (menuTop + menu.height > height - EDGE) {
    if (cardTop - GAP - menu.height >= EDGE) menuTop = cardTop - GAP - menu.height;
    else {
      cardTop = Math.max(EDGE, height - EDGE - menu.height - GAP - card.height);
      menuTop = cardTop + card.height + GAP;
    }
  }
  const menuLeft = clamp(cardLeft + (width < 640 ? EDGE : 3 * EDGE), EDGE, width - menu.width - EDGE);
  return { menuTop, menuLeft, cardTop, cardLeft, cardWidth };
}

function OpenVerseMenu({ copy, at }: { copy: VerseCopy; at: VerseMenuAt }) {
  const { t } = useTranslation();
  const { closeMenu } = copy;
  const layer = useModalLayer({ onClose: closeMenu });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  // A duration on the page's own clock: it never jumps with the wall clock.
  const opened = useRef(performance.now());
  const holdClick = useRef(at.held);
  const [spot, setSpot] = useState<Spot | null>(null);
  useFocusTrap(menuRef, true);

  const place = useCallback(() => {
    if (!menuRef.current) return;
    // The lifted verse takes its width first: its height, rewrapped, decides where the menu stands.
    const card = cardRef.current;
    if (card) card.style.width = `${cardWidthFor(at)}px`;
    setSpot(placeMenu(at, menuRef.current.getBoundingClientRect(), card?.getBoundingClientRect() ?? null));
  }, [at]);
  useLayoutEffect(place, [place]);
  // A screen turned or a window resized: the menu stays with its verse and on the screen.
  useEffect(() => {
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [place]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  // Only the one click a hold ends with is not a choice — never a key, never a click after a right button, never a
  // click whose press began in the menu (the lift's click may have gone to the verse, its press's target).
  const choose = (action: () => void) => (event: MouseEvent) => {
    const endsTheHold = holdClick.current && event.detail > 0 && performance.now() - opened.current < CLICK_AFTER_HOLD_MS;
    holdClick.current = false;
    if (!endsTheHold) action();
  };
  const arrows = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

  const verse = { chapter: at.chapter, verse: at.verse };
  const links = copy.linksOf(verse);
  const label = copy.labelOf(verse);
  const shown = spot ? 'visible' : 'hidden';
  return createPortal(
    <div {...layer} className="fixed inset-0 z-[125]" onPointerDownCapture={() => { holdClick.current = false; }}>
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={choose(closeMenu)}
        onContextMenu={(event) => { event.preventDefault(); closeMenu(); }}
        className={`absolute inset-0 cursor-default ${at.touch ? 'bg-gray-900/20 backdrop-blur-[6px] dark:bg-black/50' : ''}`}
      />
      {at.touch ? (
        // The verse lifted where it stood, over the dimmed page: the one the menu is about.
        <div
          ref={cardRef}
          aria-hidden="true"
          className="fixed max-h-[45dvh] overflow-y-auto rounded-2xl bg-white px-4 py-3 font-serif leading-[1.65] text-gray-800 shadow-2xl motion-safe:animate-verse-lift dark:bg-gray-900 dark:text-gray-100"
          style={{ ...VERSE_TEXT_STYLE, top: spot?.cardTop, left: spot?.cardLeft, width: spot?.cardWidth ?? at.row.width, visibility: shown }}
        >
          <span className="mr-1.5 align-super font-sans text-[11px] font-bold text-indigo-500 dark:text-indigo-300">{at.verse}</span>
          {copy.wordsOf(verse)}
        </div>
      ) : null}
      <div
        ref={menuRef}
        role="menu"
        aria-label={t('bible.copy.menu', { place: label })}
        onKeyDown={arrows}
        className={`fixed overflow-hidden shadow-2xl ring-1 ring-gray-900/10 dark:ring-white/10 ${at.touch
          ? 'w-64 rounded-2xl bg-white/95 dark:bg-gray-800/95'
          : 'w-72 rounded-xl bg-white p-1.5 dark:bg-gray-800'}`}
        style={{ top: spot?.menuTop ?? at.y, left: spot?.menuLeft ?? at.x, visibility: shown }}
      >
        {at.touch ? null : (
          <div className="mb-1 border-b border-gray-100 px-2.5 pb-2 pt-1.5 dark:border-gray-700">
            <div className="text-sm font-bold text-gray-900 dark:text-white">{label}</div>
            <div className="line-clamp-2 font-serif text-[13px] leading-snug text-gray-500 dark:text-gray-400">{copy.wordsOf(verse)}</div>
          </div>
        )}
        <MenuItem icon={DocumentDuplicateIcon} label={t('bible.copy.copy')} strong touch={at.touch} onSelect={choose(() => { void copy.copy([verse], 'quote'); })} />
        {copy.canShare ? <MenuItem icon={ArrowUpOnSquareIcon} label={t('bible.copy.share')} touch={at.touch} onSelect={choose(() => { void copy.share([verse], 'quote'); })} /> : null}
        <div aria-hidden="true" className={at.touch ? 'h-2 bg-gray-100 dark:bg-black/30' : 'mx-1.5 my-1 h-px bg-gray-100 dark:bg-gray-700'} />
        <MenuItem icon={CheckCircleIcon} label={t('bible.copy.several')} touch={at.touch} onSelect={choose(() => copy.startPicking(verse, at.touch))} />
        {links !== null ? (
          <MenuItem
            icon={ArrowsRightLeftIcon}
            label={links > 0 ? t('bible.copy.linksCount', { count: links }) : t('bible.copy.links')}
            touch={at.touch}
            onSelect={choose(() => copy.openLinks(verse))}
          />
        ) : null}
      </div>
    </div>,
    document.body
  );
}

/**
 * THE MENU OF ONE VERSE — opened by a hold, or by a computer's right button (`VerseHoldSurface`). Under a finger
 * the verse lifts over the dimmed page and the menu stands under it, as the phone's own menus do; under a mouse
 * the menu opens at the pointer with the verse named at its top. Copy · Send (where the device can) · Choose
 * several · the verse's links.
 */
export function VerseMenu({ copy }: { copy: VerseCopy }) {
  if (!copy.menu || typeof document === 'undefined') return null;
  const at = copy.menu;
  return <OpenVerseMenu key={`${at.chapter}:${at.verse}:${at.x}:${at.y}`} copy={copy} at={at} />;
}
