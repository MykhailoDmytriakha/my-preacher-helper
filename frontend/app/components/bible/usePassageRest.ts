'use client';

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

import { readingSurface } from './readingSurface';
import { restingScrollTop, type PassageBox } from './verseSheetGeometry';

type Layout = { width: number; height: number; textWidth: number; textHeight: number };
type Rest = { top: number; layout: Layout; smooth: boolean };

const sameLayout = (a: Layout, b: Layout) => Object.keys(a).every(key => Math.abs(a[key as keyof Layout] - b[key as keyof Layout]) < 1);

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);

function scrollInput(event: Event, pane: HTMLElement): boolean {
  if (event.type === 'wheel') return (event as WheelEvent).deltaY !== 0;
  if (event.type === 'keydown') {
    const key = (event as KeyboardEvent).key;
    const onButton = event.target instanceof Element && event.target.closest('button, [role="button"]');
    return SCROLL_KEYS.has(key) && !((key === ' ' || key === 'Spacebar') && onButton);
  }
  if (event.type.startsWith('pointer')) return event.target === pane;
  return event.type === 'touchmove';
}

/** Keep a passage centered through layout changes until the person scrolls away. */
export function usePassageRest({ paneRef, textRef, box, enabled, onLayout }: {
  paneRef: RefObject<HTMLElement | null>;
  textRef: RefObject<HTMLElement | null>;
  box: () => PassageBox | null;
  enabled: boolean;
  onLayout: () => void;
}) {
  const heldRef = useRef<Rest | null>(null);
  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;
  const layout = useCallback((): Layout => {
    const pane = paneRef.current;
    const text = textRef.current?.getBoundingClientRect();
    return { width: pane?.clientWidth ?? 0, height: pane?.clientHeight ?? 0, textWidth: text?.width ?? 0, textHeight: text?.height ?? 0 };
  }, [paneRef, textRef]);

  const rest = useCallback((smooth: boolean) => {
    const pane = paneRef.current;
    if (!pane) return;
    const passage = box();
    const top = passage ? restingScrollTop(passage, pane.clientHeight, pane.scrollHeight) : 0;
    const animated = smooth && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && typeof pane.scrollTo === 'function';
    // This module owns the landing; a browser anchor must not impersonate a person's scroll.
    readingSurface(pane).anchoring(false);
    heldRef.current = { top, layout: layout(), smooth: animated };
    if (animated) pane.scrollTo({ top, behavior: 'smooth' });
    else {
      pane.scrollTop = top;
      heldRef.current.top = pane.scrollTop;
    }
  }, [box, layout, paneRef]);

  const isResting = useCallback(() => heldRef.current !== null, []);
  const noteScroll = useCallback(() => {
    const held = heldRef.current;
    const pane = paneRef.current;
    if (!held || !pane) return;
    // Layout can clamp the scroll before ResizeObserver runs. New input settles that layout first.
    if (!sameLayout(held.layout, layout())) return;
    if (held.smooth) {
      if (Math.abs(pane.scrollTop - held.top) < 1) held.smooth = false;
      return;
    }
    if (Math.abs(pane.scrollTop - held.top) < 1) return;
    heldRef.current = null;
    readingSurface(pane).anchoring(true);
  }, [layout, paneRef]);

  const drawn = useCallback((moved: number) => {
    const held = heldRef.current;
    const pane = paneRef.current;
    if (!held || !pane) return;
    // A chapter window's correction belongs to the landing, unless a later scroll already moved it.
    if (Math.abs(pane.scrollTop - moved - held.top) < 1) rest(false);
    else noteScroll();
  }, [noteScroll, paneRef, rest]);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!enabled || !pane) return undefined;
    const settle = () => {
      const held = heldRef.current;
      if (held && !sameLayout(held.layout, layout())) rest(false);
    };
    const resized = () => { settle(); onLayoutRef.current(); };
    // Settle before an input's default scroll, so a later observer cannot undo that newer action.
    const beforeInput = (event: Event) => {
      settle();
      const held = heldRef.current;
      if (held?.smooth && scrollInput(event, pane)) { held.smooth = false; held.top = pane.scrollTop; }
    };
    const pointerMove = (event: PointerEvent) => { if (event.buttons) beforeInput(event); };
    const inputs = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const;
    for (const input of inputs) pane.addEventListener(input, beforeInput, { capture: true, passive: true });
    pane.addEventListener('pointermove', pointerMove, { capture: true, passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resized);
    observer?.observe(pane);
    if (textRef.current) observer?.observe(textRef.current);
    return () => {
      observer?.disconnect();
      for (const input of inputs) pane.removeEventListener(input, beforeInput, true);
      pane.removeEventListener('pointermove', pointerMove, true);
      heldRef.current = null;
      readingSurface(pane).anchoring(true);
    };
  }, [enabled, layout, paneRef, rest, textRef]);

  return { rest, isResting, noteScroll, drawn };
}
