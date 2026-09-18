'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  hoverDelay?: number;
}

type TooltipPosition = { left: number; top: number };

/**
 * THE GAP BETWEEN TRIGGER AND TOOLTIP IS NOT A REASON TO CLOSE.
 *
 * The panel is a DOM child of the wrapper, so hovering it counts as hovering the wrapper —
 * but the eight pixels between them belong to neither, and crossing them fired `pointerleave`
 * and shut the tooltip in the reader's face. That made every control inside one unreachable
 * by mouse: reaching for it was exactly the move that dismissed it. Closing is delayed by
 * one short beat, and coming back in cancels it.
 */
const POINTER_BRIDGE_MS = 160;

/**
 * A small tooltip for short contextual help.
 * It opens after a hover delay, immediately on focus, and can be pinned with a click/tap.
 */
export default function Tooltip({ children, content, hoverDelay = 500 }: TooltipProps) {
  const tooltipId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [clickMode, setClickMode] = useState<'none' | 'open' | 'closed'>('none');
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0 });

  const isOpen = clickMode === 'open' || (clickMode === 'none' && (isHovered || isFocused));

  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const closeTooltip = useCallback(() => {
    clearHoverTimeout();
    clearCloseTimeout();
    setIsHovered(false);
    setIsFocused(false);
    setClickMode('closed');
  }, [clearCloseTimeout, clearHoverTimeout]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) closeTooltip();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTooltip();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      clearHoverTimeout();
      clearCloseTimeout();
    };
  }, [clearCloseTimeout, clearHoverTimeout, closeTooltip]);

  useLayoutEffect(() => {
    if (!isOpen || !wrapperRef.current || !tooltipRef.current) return;

    const updatePosition = () => {
      const triggerRect = wrapperRef.current?.getBoundingClientRect();
      const tooltipRect = tooltipRef.current?.getBoundingClientRect();
      if (!triggerRect || !tooltipRect) return;

      const horizontalPadding = 12;
      const left = Math.min(
        Math.max(triggerRect.left + triggerRect.width / 2, horizontalPadding + tooltipRect.width / 2),
        window.innerWidth - horizontalPadding - tooltipRect.width / 2
      );
      const top = triggerRect.top >= tooltipRect.height + 8
        ? triggerRect.top - tooltipRect.height - 8
        : triggerRect.bottom + 8;
      setPosition({ left, top });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  return (
    <span
      ref={wrapperRef}
      className="inline-flex"
      onPointerEnter={() => {
        clearHoverTimeout();
        clearCloseTimeout();
        setClickMode((mode) => mode === 'closed' ? 'none' : mode);
        hoverTimeoutRef.current = setTimeout(() => setIsHovered(true), hoverDelay);
      }}
      onPointerLeave={() => {
        clearHoverTimeout();
        clearCloseTimeout();
        // Both halves move together. Releasing the dismissal first while the hover flag is
        // still up — the shape this had when the flag fell synchronously — re-opens the panel
        // the moment the pointer walks off a control the reader just used inside it.
        closeTimeoutRef.current = setTimeout(() => {
          setIsHovered(false);
          setClickMode((mode) => mode === 'closed' ? 'none' : mode);
        }, POINTER_BRIDGE_MS);
      }}
      onFocus={() => {
        setClickMode((mode) => mode === 'closed' ? 'none' : mode);
        setIsFocused(true);
      }}
      onBlur={() => setIsFocused(false)}
      onClick={(event) => {
        /**
         * A CLICK INSIDE THE PANEL IS NOT A CLICK ON THE TRIGGER.
         *
         * The panel lives inside the wrapper, so using a control in it bubbled here and was
         * read as tapping the trigger — which toggles. Reaching for a link in an unpinned
         * tooltip therefore PINNED it, and it stayed on screen over the page the link had
         * just opened. Using something inside is the panel's work finished: it closes.
         */
        clearHoverTimeout();
        if (tooltipRef.current?.contains(event.target as Node)) {
          closeTooltip();
          return;
        }
        setClickMode((mode) => mode === 'open' ? 'closed' : 'open');
      }}
    >
      {React.isValidElement(children)
        ? React.cloneElement(children, {
          'aria-describedby': isOpen ? tooltipId : undefined,
        } as React.HTMLAttributes<HTMLElement>)
        : children}
      {isOpen && (
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className="fixed z-50 max-w-[min(20rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-md bg-slate-900 px-3 py-2 text-xs leading-5 text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
          style={position}
        >
          {content}
        </span>
      )}
    </span>
  );
}
