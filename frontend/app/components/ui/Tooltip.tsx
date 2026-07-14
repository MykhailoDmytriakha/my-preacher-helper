'use client';

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  hoverDelay?: number;
}

type TooltipPosition = { left: number; top: number };

/**
 * A small, non-interactive tooltip for short contextual help.
 * It opens after a hover delay, immediately on focus, and can be pinned with a click/tap.
 */
export default function Tooltip({ children, content, hoverDelay = 500 }: TooltipProps) {
  const tooltipId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [clickMode, setClickMode] = useState<'none' | 'open' | 'closed'>('none');
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0 });

  const isOpen = clickMode === 'open' || (clickMode === 'none' && (isHovered || isFocused));

  const clearHoverTimeout = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  const closeTooltip = () => {
    clearHoverTimeout();
    setIsHovered(false);
    setIsFocused(false);
    setClickMode('closed');
  };

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
    };
  }, []);

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
        setClickMode((mode) => mode === 'closed' ? 'none' : mode);
        hoverTimeoutRef.current = setTimeout(() => setIsHovered(true), hoverDelay);
      }}
      onPointerLeave={() => {
        clearHoverTimeout();
        setIsHovered(false);
        setClickMode((mode) => mode === 'closed' ? 'none' : mode);
      }}
      onFocus={() => {
        setClickMode((mode) => mode === 'closed' ? 'none' : mode);
        setIsFocused(true);
      }}
      onBlur={() => setIsFocused(false)}
      onClick={() => {
        clearHoverTimeout();
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
