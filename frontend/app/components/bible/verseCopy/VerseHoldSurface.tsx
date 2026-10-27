'use client';

import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';

import { useLongPress } from '@/hooks/useLongPress';

import { verseOfRow, verseRowAt, type VerseAt } from './selectedVerses';

import type { VerseCopy, VerseMenuAt } from './useVerseCopy';

type Press = VerseAt & { x: number; y: number; touch: boolean; row: HTMLElement };

/** A control drawn in a verse — its number, its chip (a `span` with the role of a button), a badge, a link. */
const CONTROL = 'button, a, [role="button"]';
const onControl = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(CONTROL));

const menuAt = (press: Press, touch: boolean, held: boolean): VerseMenuAt => {
  const box = press.row.getBoundingClientRect();
  return {
    chapter: press.chapter, verse: press.verse, x: press.x, y: press.y, touch, held,
    row: { top: box.top, left: box.left, width: box.width, height: box.height },
  };
};

/**
 * THE READER'S TEXT, ANSWERING A HOLD — the hold of `useLongPress`, the app's one rule of pressing and holding,
 * on the whole text at once: the verse under the press is taken when it starts, and the hold opens that verse's
 * menu when the finger lifts. A computer's right button opens the same menu at once, unless text is selected —
 * then the browser's own menu stays. A press on a control of a verse (its number, its chip) is that control's.
 *
 * Choosing several, every press on a verse — its words, its number or its chip — is the hook's to judge: a press
 * chooses the verse (with Shift, the passage up to it), a hold chooses the passage, and a press given up by moving
 * or the click after a hold chooses nothing. A pen and a mark tool in hand draw: no press here is taken.
 */
export function VerseHoldSurface({ copy, articleRef, className, gestureIgnore, penSurface, children }: {
  copy: VerseCopy;
  articleRef: RefObject<HTMLElement | null>;
  className: string;
  gestureIgnore?: '';
  penSurface?: '';
  children: ReactNode;
}) {
  const pressRef = useRef<Press | null>(null);
  const lastTouch = useRef(false);
  /** The click being judged while choosing several: the verse it is on and whether Shift was held. */
  const clickRef = useRef<{ at: VerseAt; shift: boolean } | null>(null);
  const { state, handlers } = useLongPress({
    onPress: () => {
      const click = clickRef.current;
      if (!copy.picking || !click) return;
      if (click.shift) copy.rangeTo(click.at);
      else copy.toggle(click.at);
    },
    onLongPress: () => {
      const press = pressRef.current;
      if (!press) return;
      if (copy.picking) copy.rangeTo(press);
      else copy.openMenu(menuAt(press, press.touch, true));
    },
  });
  // The verse lights when the hold has run its time: a touch that only starts a scroll lights nothing.
  const { hold } = copy;
  useEffect(() => {
    const press = pressRef.current;
    hold(state === 'armed' && press ? { chapter: press.chapter, verse: press.verse } : null);
  }, [hold, state]);

  const pressAt = (event: PointerEvent<HTMLElement> | MouseEvent<HTMLElement>): Press | null => {
    const row = verseRowAt(event.target, articleRef.current);
    const at = row ? verseOfRow(row) : null;
    if (!row || !at || !copy.enabled) return null;
    return { ...at, x: event.clientX, y: event.clientY, touch: lastTouch.current, row };
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    lastTouch.current = event.pointerType === 'touch';
    const othersPress = event.pointerType === 'pen' || (!copy.picking && onControl(event.target));
    pressRef.current = othersPress ? null : pressAt(event);
    if (pressRef.current) handlers.onPointerDown?.(event);
  };
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    const press = pressAt(event);
    if (!press) return;
    // A finger's long press is ours (the hold), never the system's menu or selection.
    if (lastTouch.current) {
      event.preventDefault();
      return;
    }
    const selection = window.getSelection();
    if (copy.picking || (selection && !selection.isCollapsed)) return;
    event.preventDefault();
    copy.openMenu(menuAt(press, false, false));
  };
  // Choosing several, a press on a verse is judged before its number, chip or badge can act on it.
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!copy.picking) return;
    const row = verseRowAt(event.target, articleRef.current);
    const at = row ? verseOfRow(row) : null;
    if (!at) return;
    event.preventDefault();
    event.stopPropagation();
    clickRef.current = { at, shift: event.shiftKey };
    handlers.onClick(event);
    clickRef.current = null;
  };
  // Choosing several, a key on a verse's chip (a `span` with the role of a button, which acts on the key itself)
  // chooses the verse; a real button's key becomes a click, judged above.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLElement>) => {
    if (!copy.picking || (event.key !== 'Enter' && event.key !== ' ')) return;
    const target = event.target instanceof Element ? event.target.closest('[role="button"]') : null;
    const row = target && !(target instanceof HTMLButtonElement) ? verseRowAt(target, articleRef.current) : null;
    const at = row ? verseOfRow(row) : null;
    if (!at) return;
    event.preventDefault();
    event.stopPropagation();
    copy.toggle(at);
  };
  // Reading, the click after a hold given up or done is no press on the text; a control keeps its own click.
  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (onControl(event.target)) return;
    handlers.onClick(event);
  };

  return (
    <article
      ref={articleRef as RefObject<HTMLElement>}
      data-gesture-ignore={gestureIgnore}
      data-pen-surface={penSurface}
      className={`${className} ${copy.picking ? 'select-none' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerLeave={handlers.onPointerLeave}
      onPointerCancel={handlers.onPointerCancel}
      onClick={onClick}
      onClickCapture={onClickCapture}
      onKeyDownCapture={onKeyDownCapture}
      onContextMenu={onContextMenu}
    >
      {children}
    </article>
  );
}
