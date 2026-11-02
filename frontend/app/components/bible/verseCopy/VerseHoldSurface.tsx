'use client';

import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';

import { useLongPress } from '@/hooks/useLongPress';
import { recordDiagnostic } from '@/utils/appDiagnostics';

import { verseOfRow, verseRowAt, type VerseAt } from './selectedVerses';

import type { VerseCopy } from './useVerseCopy';

type Press = VerseAt & { x: number; y: number; touch: boolean; row: HTMLElement };

/** A control drawn in a verse — its number, its chip (a `span` with the role of a button), a badge, a link. */
const CONTROL = 'button, a, [role="button"]';
const onControl = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(CONTROL));


/**
 * THE READER'S TEXT, ANSWERING A HOLD — the hold of `useLongPress`, the app's one rule of pressing and holding,
 * on the whole text at once: the verse under the press is taken when it starts, and the hold opens that verse's
 * menu when the finger lifts. A computer's right button opens the same menu at once, unless text is selected —
 * then the browser's own menu stays. A press on a control of a verse (its number, its chip) is that control's.
 *
 * Choosing several, every press on a verse — its words, its number or its chip — is the hook's to judge: a press
 * chooses the verse (with Shift, the passage up to it), a hold chooses the passage, and a press given up by moving
 * or the click after a hold chooses nothing. A mark tool in hand draws: a finger's press here is not taken.
 *
 * An Apple Pencil paints, and its hold is the verse's like a finger's (the owner, 2026-11-02: «ручкой выделить нельзя»): held
 * still on a verse for the hold's time — a tool in hand or not — the stroke it began is dropped and the menu opens on the lift
 * (`onPenHold`, asked the moment the time runs, so a lift right after finds it decided); a stroke that reached another word stays
 * a stroke.
 */
export function VerseHoldSurface({ copy, articleRef, className, gestureIgnore, penSurface, onPenHold, children }: {
  copy: VerseCopy;
  articleRef: RefObject<HTMLElement | null>;
  /** The Pencil's press `pointerId` held still: `true` when its stroke gave way (`useReaderMarks().penHold`). */
  onPenHold?: (pointerId: number) => boolean;
  className: string;
  gestureIgnore?: '';
  penSurface?: '';
  children: ReactNode;
}) {
  const pressRef = useRef<Press | null>(null);
  const lastTouch = useRef(false);
  /** The Pencil's pointer while its press is held; null for a finger's or a mouse's. */
  const penPress = useRef<number | null>(null);
  /** The pointer whose press is being held: another finger touching meanwhile does not take the hold over (Codex, 02.11). */
  const holder = useRef<number | null>(null);
  /** The click being judged while choosing several: the verse it is on and whether Shift was held. */
  const clickRef = useRef<{ at: VerseAt; shift: boolean } | null>(null);
  const { state, handlers } = useLongPress({
    onArm: () => penPress.current === null || (onPenHold?.(penPress.current) ?? true),
    onPress: () => {
      const click = clickRef.current;
      if (!copy.picking || !click) return;
      if (click.shift) copy.rangeTo(click.at);
      else copy.toggle(click.at);
    },
    onLongPress: () => {
      const press = pressRef.current;
      if (!press || !copy.enabled) return;
      if (copy.picking) copy.rangeTo(press);
      else copy.openMenu(press, press.row, { x: press.x, y: press.y, touch: press.touch, held: true });
    },
  });
  /*
   * A FINGER'S OR A PENCIL'S PRESS NEVER STARTS THE SYSTEM'S SELECTION (the owner's iPad, 31.10: its handle stood over the
   * verse's menu). Decided by the press, not by the screen: `(hover: none)` is false on an iPad with a trackpad, and then the
   * card's `select-none` is off. A mouse or a trackpad still selects. `user-select` is not put on the text — it can blind the
   * word-under-a-point lookups the marks use (`.howto/paint-marks-over-bible-text.md`). A selection that comes all the same is
   * taken off, and the technical report says so once per press.
   */
  const pressCount = useRef(0);
  const reportedPress = useRef(-1);
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return undefined;
    const editable = (node: Node | null) => node instanceof Element
      ? Boolean(node.closest('input, textarea, [contenteditable="true"]'))
      : Boolean(node?.parentElement?.closest('input, textarea, [contenteditable="true"]'));
    const say = (result: string) => {
      if (reportedPress.current === pressCount.current) return;
      reportedPress.current = pressCount.current;
      recordDiagnostic('verse-pick', { source: 'touch', result });
    };
    const onSelectStart = (event: Event) => {
      if (!lastTouch.current || editable(event.target as Node | null)) return;
      event.preventDefault();
      say('selection-stopped');
    };
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!lastTouch.current || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const anchor = selection.anchorNode;
      if (!anchor || !article.contains(anchor) || editable(anchor)) return;
      selection.removeAllRanges();
      say('selection-cleared');
    };
    article.addEventListener('selectstart', onSelectStart);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      article.removeEventListener('selectstart', onSelectStart);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [articleRef]);

  // A hold back at rest has no holder, whatever lift or loss of the pointer ended it — a lift taken by another element (a
  // grip's capture) never leaves the next press locked out.
  useEffect(() => {
    if (state === 'idle') holder.current = null;
  }, [state]);

  // The verse lights when the hold has run its time: a touch that only starts a scroll lights nothing.
  const { hold } = copy;
  useEffect(() => {
    const press = pressRef.current;
    hold(state === 'armed' && press ? { chapter: press.chapter, verse: press.verse } : null);
  }, [hold, state]);

  // A tool in hand turns a finger's press into paint (`enabled` off); the Pencil's hold is the verse's all the same.
  const pressAt = (event: PointerEvent<HTMLElement> | MouseEvent<HTMLElement>, pen = false): Press | null => {
    const row = verseRowAt(event.target, articleRef.current);
    const at = row ? verseOfRow(row) : null;
    if (!row || !at || (!copy.enabled && !pen)) return null;
    return { ...at, x: event.clientX, y: event.clientY, touch: lastTouch.current, row };
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    // A new press on the text: the click after it is its own, not a grip's pull's (a grip's press never comes here).
    copy.forgetPullClick();
    const pen = event.pointerType === 'pen';
    pressCount.current += 1;
    if (holder.current !== null && holder.current !== event.pointerId) return;
    // A Pencil's menu stands as a finger's does: the verse lifted, the menu beside it.
    lastTouch.current = event.pointerType !== 'mouse';
    const othersPress = !copy.picking && onControl(event.target);
    pressRef.current = othersPress ? null : pressAt(event, pen);
    penPress.current = pen && pressRef.current ? event.pointerId : null;
    holder.current = pressRef.current ? event.pointerId : null;
    if (pressRef.current) handlers.onPointerDown?.(event);
  };
  // The holder's pointer gone: the next press, of any pointer, may hold.
  const release = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerId === holder.current) holder.current = null;
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
    copy.openMenu(press, press.row, { x: press.x, y: press.y, touch: false, held: false });
  };
  // Choosing several, a press on a verse is judged before its number, chip or badge can act on it.
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!copy.picking) return;
    const row = verseRowAt(event.target, articleRef.current);
    const at = row ? verseOfRow(row) : null;
    // The click a grip's pull sends after the lift is the pull's — on the grip, or on a verse (Safari on iPad, 01.11, took
    // the first verse off with it): it presses nothing (`useVerseCopy().takesPullClick`).
    if (copy.takesPullClick(Boolean(at))) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
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
    // A key on the text: the click it makes is its own, not a grip's pull's.
    copy.forgetPullClick();
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
      onPointerUp={(event) => { release(event); handlers.onPointerUp?.(event); }}
      onPointerLeave={(event) => { release(event); handlers.onPointerLeave?.(event); }}
      onPointerCancel={(event) => { release(event); handlers.onPointerCancel?.(event); }}
      onClick={onClick}
      onClickCapture={onClickCapture}
      onKeyDownCapture={onKeyDownCapture}
      onContextMenu={onContextMenu}
    >
      {children}
    </article>
  );
}
