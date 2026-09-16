import { useLayoutEffect } from 'react';

/**
 * HOLDING THE PAGE STILL WHILE A DIALOG IS OPEN.
 *
 * Two things the first version got wrong, both reported from the owner's iPad:
 *
 * 1. ONE PAGE CAN HOLD TWO DIALOGS. A picker opened from inside a form is a second lock, and
 *    the first version saved "the style before me" per hook. Closing the inner dialog then
 *    restored `overflow: hidden` as if it were the page's own value — or, the other way round,
 *    released the page while the outer dialog was still open. Locks are counted instead, and
 *    the page is restored once, by the last one to leave.
 *
 * 2. `overflow: hidden` ON THE BODY DOES NOT HOLD iOS. Safari keeps scrolling the document
 *    behind the dialog, which is what the pastor saw: he scrolled the sermon list while the
 *    "New sermon" form stood in front of it. There the page has to be pinned — `position:
 *    fixed` with the scroll offset carried in `top` — and the person put back exactly where
 *    they were reading when it is released. Pinning is a heavier trick (it changes what the
 *    body IS), so it is used only where the lighter one is known not to work.
 */

type LockedPage = {
  /** How many dialogs are currently holding the page. */
  holders: number;
  /** The page's own styles, taken once, before the first dialog touched anything. */
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyWidth: string;
  bodyPaddingRight: string;
  htmlOverflow: string;
  /** Where the person was reading, for the pinned road. */
  scrollY: number;
  pinned: boolean;
};

/**
 * Module state on purpose: the lock belongs to the PAGE, not to a component, and every hook
 * instance is talking about the same one page.
 */
let page: LockedPage | null = null;

/**
 * iOS ignores `overflow: hidden` on the body, and iPadOS reports itself as a Mac — the touch
 * points are what tell them apart. Everything else uses the lighter road.
 */
function needsPinning(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iPhoneOrIPod = /iPad|iPhone|iPod/.test(ua);
  const iPadPretendingToBeAMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return iPhoneOrIPod || iPadPretendingToBeAMac;
}

/** The gap a hidden scrollbar leaves behind, so the page does not jump sideways. */
function scrollbarWidth(): number {
  if (typeof window === 'undefined') return 0;
  return Math.max(0, window.innerWidth - document.documentElement.clientWidth);
}

function acquire(): void {
  if (page) {
    page.holders += 1;
    return;
  }

  const body = document.body;
  const html = document.documentElement;
  const pinned = needsPinning();
  const gap = scrollbarWidth();

  page = {
    holders: 1,
    bodyOverflow: body.style.overflow,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyWidth: body.style.width,
    bodyPaddingRight: body.style.paddingRight,
    htmlOverflow: html.style.overflow,
    scrollY: window.scrollY,
    pinned,
  };

  body.style.overflow = 'hidden';
  html.style.overflow = 'hidden';
  // Without this the page shifts sideways by the scrollbar's width the moment a dialog opens.
  if (gap > 0) body.style.paddingRight = `${gap}px`;

  if (pinned) {
    body.style.position = 'fixed';
    body.style.top = `-${page.scrollY}px`;
    body.style.width = '100%';
  }
}

function release(): void {
  if (!page) return;
  page.holders -= 1;
  if (page.holders > 0) return;

  const body = document.body;
  const html = document.documentElement;
  const { bodyOverflow, bodyPosition, bodyTop, bodyWidth, bodyPaddingRight, htmlOverflow, scrollY, pinned } = page;
  page = null;

  body.style.overflow = bodyOverflow;
  body.style.position = bodyPosition;
  body.style.top = bodyTop;
  body.style.width = bodyWidth;
  body.style.paddingRight = bodyPaddingRight;
  html.style.overflow = htmlOverflow;

  // Releasing a pinned page drops it back to the top unless the reader is put back by hand.
  if (pinned) window.scrollTo(0, scrollY);
}

/**
 * Hold the page still for as long as this component is mounted and `isLocked` is true.
 *
 * @param isLocked - Whether the scroll should be locked. Defaults to true.
 */
export const useScrollLock = (isLocked: boolean = true) => {
  useLayoutEffect(() => {
    if (!isLocked) return;
    acquire();
    return release;
  }, [isLocked]);
};
