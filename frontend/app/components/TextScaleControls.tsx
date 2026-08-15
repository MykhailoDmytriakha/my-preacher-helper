'use client';

import React, { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useTextScale } from '@/providers/TextScaleProvider';

interface TextScaleControlsProps {
  className?: string;
  showPercentage?: boolean;
}

const EPSILON = 0.01; // Tolerance for floating-point comparison

/**
 * A− · rail · percentage · A+ — and the row NEVER changes shape.
 *
 * BUG-20260814-text-scale-panel-reflows: the panel is pinned to the right edge of
 * the screen, so anything that appears or vanishes with the scale widens it and
 * drags every button leftwards, out from under the finger that just pressed one.
 * Measured live: 224 px → 248 px after a single A+, and the second press in the
 * same spot landed in the gap and did nothing. Hence: a fixed set of controls, a
 * fixed-width percentage with tabular numerals, and reset living ON the
 * percentage instead of as a fourth button that comes and goes.
 *
 * The rail is what makes it fast. Twelve presses to cross the range is a chore
 * during a service; one tap on a tick is not. The tick at 100% is drawn taller
 * and green — home is recognised by shape, without reading the number.
 */
export const TextScaleControls: React.FC<TextScaleControlsProps> = ({
  className = '',
  showPercentage = true
}) => {
  const { t } = useTranslation();
  const {
    scale,
    increaseScale,
    decreaseScale,
    resetScale,
    setScale,
    scalePercentage,
    availableScales
  } = useTextScale();

  const railRef = useRef<HTMLDivElement>(null);

  // Use tolerance-based comparison for floating-point values
  const minScale = availableScales[0];
  const maxScale = availableScales[availableScales.length - 1];
  const isAtMinScale = scale <= minScale + EPSILON;
  const isAtMaxScale = scale >= maxScale - EPSILON;
  const isAtDefault = Math.abs(scale - 1) < EPSILON;

  const stepIndex = availableScales.findIndex((s) => Math.abs(s - scale) < EPSILON);
  const knobIndex = stepIndex === -1 ? availableScales.indexOf(1) : stepIndex;
  const knobPercent = (knobIndex / (availableScales.length - 1)) * 100;

  /** Nearest step to where the pointer is — a tap anywhere on the rail lands on a real value. */
  const scaleFromPointer = useCallback(
    (clientX: number) => {
      const rail = railRef.current;
      if (!rail) return null;
      const box = rail.getBoundingClientRect();
      if (box.width === 0) return null;
      const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      return availableScales[Math.round(ratio * (availableScales.length - 1))];
    },
    [availableScales]
  );

  const handleRailPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const picked = scaleFromPointer(event.clientX);
    if (picked !== null && picked !== undefined) setScale(picked);
    // Dragging keeps following the finger; jsdom has no pointer capture, hence the guard.
    railRef.current?.setPointerCapture?.(event.pointerId);
  };

  const handleRailPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return;
    const picked = scaleFromPointer(event.clientX);
    if (picked !== null && picked !== undefined) setScale(picked);
  };

  const handleRailKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      increaseScale();
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      decreaseScale();
      event.preventDefault();
    } else if (event.key === 'Home') {
      resetScale();
      event.preventDefault();
    } else if (event.key === 'End') {
      setScale(maxScale);
      event.preventDefault();
    }
  };

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {/* Decrease */}
      <button
        onClick={decreaseScale}
        disabled={isAtMinScale}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-gray-700 transition-colors duration-200 enabled:hover:bg-gray-200/80 disabled:opacity-40 disabled:cursor-not-allowed dark:text-gray-100 dark:enabled:hover:bg-white/10"
        title={t('textScale.decrease')}
        aria-label={t('textScale.decrease')}
      >
        A<span className="text-xs">−</span>
      </button>

      {/* Rail: tap a tick, or drag; the taller green tick is 100% */}
      <div
        ref={railRef}
        role="slider"
        tabIndex={0}
        aria-label={t('textScale.slider')}
        aria-valuemin={Math.round(minScale * 100)}
        aria-valuemax={Math.round(maxScale * 100)}
        aria-valuenow={scalePercentage}
        aria-valuetext={`${scalePercentage}%`}
        onPointerDown={handleRailPointerDown}
        onPointerMove={handleRailPointerMove}
        onKeyDown={handleRailKeyDown}
        className="relative h-11 w-24 shrink-0 cursor-pointer touch-none rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 sm:w-32"
      >
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-1">
          {availableScales.map((value, index) => {
            const isHome = Math.abs(value - 1) < EPSILON;
            const isPassed = index <= knobIndex;
            return (
              <span
                key={value}
                className={`w-0.5 rounded-full transition-colors duration-150 ${
                  isHome
                    ? 'h-5 bg-emerald-400/80'
                    : isPassed
                      ? 'h-2.5 bg-violet-400'
                      : 'h-2.5 bg-gray-300 dark:bg-gray-600'
                }`}
              />
            );
          })}
        </div>
        {/*
          THE HANDLE — a white capsule in a violet ring, picked by the owner from
          nine shapes (the rest live in `.demo/knob-options.html`).
          Shape from the capsule, colour from the coin: upright, so it reads as
          something to grab rather than a painted dot, and narrow, so it does not
          bury the ticks on either side. White fill rather than solid violet
          because a glow or a flat fill loses itself on the light theme — a body
          that carries its own background stays legible on both, and it is the
          ring, not the fill, that makes it look placed.
        */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 h-[26px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-violet-500 bg-white shadow-[0_3px_10px_-2px_rgba(15,23,42,0.45)] transition-[left] duration-200 ease-out dark:border-violet-400"
          style={{ left: `calc(${knobPercent}% + ${4 - (knobPercent / 100) * 8}px)` }}
        />
      </div>

      {/* Percentage — and the reset control, so the row never changes shape */}
      {showPercentage && (
        <button
          onClick={resetScale}
          disabled={isAtDefault}
          className="h-11 w-14 shrink-0 rounded-full text-sm font-medium tabular-nums text-gray-700 transition-colors duration-200 enabled:hover:bg-gray-200/80 disabled:cursor-default dark:text-gray-200 dark:enabled:hover:bg-white/10"
          title={t('textScale.reset')}
          aria-label={t('textScale.reset')}
        >
          {scalePercentage}%
        </button>
      )}

      {/* Increase */}
      <button
        onClick={increaseScale}
        disabled={isAtMaxScale}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-gray-700 transition-colors duration-200 enabled:hover:bg-gray-200/80 disabled:opacity-40 disabled:cursor-not-allowed dark:text-gray-100 dark:enabled:hover:bg-white/10"
        title={t('textScale.increase')}
        aria-label={t('textScale.increase')}
      >
        A<span className="text-xs">+</span>
      </button>
    </div>
  );
};
