'use client';

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { hasOpenLayer } from '@/hooks/useModalLayer';

type Header = { content: ReactNode; compact: ReactNode };
type Publish = (publisher: string, header: Header | null) => void;
type Publisher = {
  publish: Publish;
  reveal: () => void;
  /** The page has just scrolled the window itself; the scroll event coming is not the person's. */
  pageMoved: () => void;
  pageMoving: { current: boolean };
};
const PublishContext = createContext<Publisher | null>(null);
const HeaderContext = createContext<Header | null>(null);
const RevealsContext = createContext(0);

/** Pages lend the shell their phone controls without adding another sticky header. */
export function ShellHeaderProvider({ children }: { children: ReactNode }) {
  const [headers, setHeaders] = useState<Record<string, Header>>({});
  const [reveals, setReveals] = useState(0);
  const publish = useCallback<Publish>((publisher, header) => {
    setHeaders((current) => {
      if (!header && !(publisher in current)) return current;
      const next = { ...current };
      delete next[publisher];
      if (header) next[publisher] = header;
      return next;
    });
  }, []);
  const reveal = useCallback(() => setReveals((count) => count + 1), []);
  const pageMoving = useRef(false);
  const pageMoved = useCallback(() => { pageMoving.current = true; }, []);
  const publisher = useMemo(() => ({ publish, reveal, pageMoved, pageMoving }), [publish, reveal, pageMoved]);
  const entries = Object.values(headers);
  return (
    <PublishContext.Provider value={publisher}>
      <RevealsContext.Provider value={reveals}>
        <HeaderContext.Provider value={entries.at(-1) ?? null}>{children}</HeaderContext.Provider>
      </RevealsContext.Provider>
    </PublishContext.Provider>
  );
}

/** Publishing is separate from reading, so shell updates never re-render the publishing page. */
export function useShellHeader(content: ReactNode | null, compact: ReactNode = null) {
  const publish = useContext(PublishContext)?.publish;
  const publisher = useId();
  useEffect(() => {
    publish?.(publisher, content === null ? null : { content, compact });
  }, [publish, publisher, content, compact]);
  useEffect(() => () => publish?.(publisher, null), [publish, publisher]);
}

/**
 * Shows the published header whole: a page that moves the person to another place calls it, because
 * right after a jump the way back is what they need (a folded header hides it). Stable across renders.
 */
export function useRevealShellHeader(): () => void {
  const reveal = useContext(PublishContext)?.reveal;
  return useCallback(() => reveal?.(), [reveal]);
}

/**
 * Says the page has just scrolled the window itself — a jump to a verse, the place kept while chapters
 * are drawn around it — so the header does not take that move for the person reading. Told only when the
 * window did move: a move to where it stood sends no scroll event, and the word would wait for the
 * person's next one. Stable across renders.
 */
export function useShellHeaderPageMoved(): () => void {
  const pageMoved = useContext(PublishContext)?.pageMoved;
  return useCallback(() => pageMoved?.(), [pageMoved]);
}

export function usePublishedShellHeader() {
  return useContext(HeaderContext);
}

/** How long after a finger, a wheel or a key a scroll is still the person's: iOS glides on after the finger lifts. */
const PERSON_SCROLL_MS = 1200;
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End']);

/**
 * Only a published phone header follows window scrolling; wide pages keep their normal shell. It folds
 * when the person reads down and opens when they scroll up — the person, not the page: a reader's own
 * moves (a jump to a verse, the chapters drawn around the place) scroll the window too, and taken for
 * reading they folded the header on arrival, hiding the way back. A move the page announces
 * (`useShellHeaderPageMoved`) is passed over even under the person's finger; a scroll no finger, wheel
 * or key started (the browser keeping what shows in place) is passed over too.
 */
export function useShellHeaderCollapse(active: boolean) {
  const [collapsed, setCollapsed] = useState(false);
  const reveals = useContext(RevealsContext);
  const pageMoving = useContext(PublishContext)?.pageMoving;
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollBaseline = useRef(0);
  const scrollBeforeResize = useRef(0);
  useEffect(() => {
    setCollapsed(false);
    if (!active) return;
    scrollBaseline.current = window.scrollY;
    let personMovedAt = Number.NEGATIVE_INFINITY;
    const personMoves = () => { personMovedAt = performance.now(); };
    const onKey = (event: KeyboardEvent) => { if (SCROLL_KEYS.has(event.key)) personMoves(); };
    const onScroll = () => {
      if (hasOpenLayer()) return;
      const top = Math.max(0, window.scrollY);
      const pageMoved = pageMoving?.current ?? false;
      if (pageMoving) pageMoving.current = false;
      if (pageMoved || performance.now() - personMovedAt > PERSON_SCROLL_MS) {
        scrollBaseline.current = top;
        return;
      }
      const delta = top - scrollBaseline.current;
      if (Math.abs(delta) <= 6) return;
      scrollBaseline.current = top;
      scrollBeforeResize.current = top;
      setCollapsed(top > 80 && delta > 6);
    };
    window.addEventListener('touchmove', personMoves, { passive: true });
    window.addEventListener('wheel', personMoves, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('touchmove', personMoves);
      window.removeEventListener('wheel', personMoves);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
    };
  }, [active, pageMoving]);
  // A jump opens the header without keeping the scroll: the verse jumped to then stands under the whole
  // header, where it would have stood had the header been open when it was jumped to.
  useEffect(() => {
    if (!reveals) return;
    scrollBeforeResize.current = 0;
    setCollapsed(false);
  }, [reveals]);
  // Changing the sticky header's height must not move the words under the person's eyes.
  // Keep the scroll coordinate with the flow change; no animation also respects reduced motion.
  const previousRowHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const height = rowRef.current?.getBoundingClientRect().height ?? 0;
    const previous = previousRowHeight.current;
    previousRowHeight.current = active ? height : null;
    if (active && previous !== null && height && previous !== height && scrollBeforeResize.current > 0) {
      const top = scrollBeforeResize.current + height - previous;
      scrollBaseline.current = top;
      window.scrollTo({ top, behavior: 'instant' });
    }
  }, [active, collapsed]);
  const expand = useCallback(() => {
    scrollBeforeResize.current = window.scrollY;
    setCollapsed(false);
    window.requestAnimationFrame(() => rowRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }));
  }, []);
  return { rowRef, collapsed, expand };
}
