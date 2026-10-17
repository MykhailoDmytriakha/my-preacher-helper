'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';

interface TextScaleContextType {
  scale: number; // 1.0 = 100%, 1.2 = 120%, etc.
  /** The size the page has taken: a frame after `scale` changes, see the provider. */
  appliedScale: number;
  setScale: (scale: number) => void;
  increaseScale: () => void;
  decreaseScale: () => void;
  resetScale: () => void;
  scalePercentage: number; // 100, 110, 120, etc.
  availableScales: number[]; // [1, 1.1, 1.2, ... 2]
}

const TextScaleContext = createContext<TextScaleContextType | undefined>(undefined);

const STORAGE_KEY = 'text-scale-preference';
/**
 * The floor is BELOW the default on purpose: 100% is where the app starts, not
 * the smallest a person may want. Someone who reads fine wants more text on
 * screen at once, and before this the minus button was dead at 100%.
 */
const MIN_SCALE = 0.8;
const MAX_SCALE = 2;
const STEP = 0.1;
const DEFAULT_SCALE = 1;

// Generate available scales: 0.8, 0.9, 1, ... 2 (10% increments)
// Iterate by integer step count so float drift never drops the final value (2).
const generateAvailableScales = (): number[] => {
  const scales: number[] = [];
  const stepCount = Math.round((MAX_SCALE - MIN_SCALE) / STEP);
  for (let i = 0; i <= stepCount; i++) {
    scales.push(Math.round((MIN_SCALE + i * STEP) * 100) / 100);
  }
  return scales;
};

export const TextScaleProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [scale, setScaleState] = useState<number>(DEFAULT_SCALE);
  const [appliedScale, setAppliedScale] = useState<number>(DEFAULT_SCALE);
  const [mounted, setMounted] = useState(false);
  const appliedOnce = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    let savedScale: string | null = null;
    // Browser storage can refuse (a private window, blocked site data): the reader still opens.
    try { savedScale = localStorage.getItem(STORAGE_KEY); } catch { savedScale = null; }
    if (savedScale) {
      const parsedScale = parseFloat(savedScale);
      if (!isNaN(parsedScale) && parsedScale >= MIN_SCALE && parsedScale <= MAX_SCALE) {
        setScaleState(parsedScale);
      }
    }
    setMounted(true);
  }, []);

  /*
   * Apply scale to root element via CSS variable. A new size restyles every word on the page — in a
   * big Bible book a third of a second on a computer, more on an iPad (the owner, 2026-10-16) — so a
   * change made by the person waits for the control to show it first: the number and the handle are
   * painted, then the page takes the size. The size read on opening is applied at once.
   */
  useEffect(() => {
    if (!mounted) return undefined;
    // The choice is kept at once: a page left before the restyle still opens next time at this size.
    try { localStorage.setItem(STORAGE_KEY, scale.toString()); } catch { /* the size lasts for the visit */ }
    const apply = () => {
      document.documentElement.style.setProperty('--text-scale', scale.toString());
      setAppliedScale(scale);
    };
    if (!appliedOnce.current) {
      appliedOnce.current = true;
      apply();
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => { timer = setTimeout(apply, 0); });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [scale, mounted]);

  const setScale = useCallback((newScale: number) => {
    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    // Round to 2 decimals so float drift (0.1 + 0.1 = 0.2000000000000001)
    // never leaks into the stored value or the --text-scale CSS variable.
    setScaleState(Math.round(clampedScale * 100) / 100);
  }, []);

  const increaseScale = useCallback(() => {
    setScale(scale + STEP);
  }, [scale, setScale]);

  const decreaseScale = useCallback(() => {
    setScale(scale - STEP);
  }, [scale, setScale]);

  const resetScale = useCallback(() => {
    setScale(DEFAULT_SCALE);
  }, [setScale]);

  const value: TextScaleContextType = {
    scale,
    appliedScale,
    setScale,
    increaseScale,
    decreaseScale,
    resetScale,
    scalePercentage: Math.round(scale * 100),
    availableScales: generateAvailableScales(),
  };

  return (
    <TextScaleContext.Provider value={value}>
      {children}
    </TextScaleContext.Provider>
  );
};

/**
 * The text size the page has taken, or null outside a provider — for a screen that only follows a change
 * of it (the Bible reader keeps the verse being read in place, once the new size is on the page), so it
 * renders in tests and previews without one.
 */
export const useTextScaleValue = (): number | null => useContext(TextScaleContext)?.appliedScale ?? null;

export const useTextScale = (): TextScaleContextType => {
  const context = useContext(TextScaleContext);
  if (!context) {
    throw new Error('useTextScale must be used within a TextScaleProvider');
  }
  return context;
};
