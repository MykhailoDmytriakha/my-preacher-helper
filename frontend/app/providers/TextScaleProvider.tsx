'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface TextScaleContextType {
  scale: number; // 1.0 = 100%, 1.2 = 120%, etc.
  setScale: (scale: number) => void;
  increaseScale: () => void;
  decreaseScale: () => void;
  resetScale: () => void;
  scalePercentage: number; // 100, 120, 140, etc.
  availableScales: number[]; // [1, 1.2, 1.4, 1.6, 1.8, 2]
}

const TextScaleContext = createContext<TextScaleContextType | undefined>(undefined);

const STORAGE_KEY = 'text-scale-preference';
const MIN_SCALE = 1;
const MAX_SCALE = 2;
const STEP = 0.2;
const DEFAULT_SCALE = 1;

// Generate available scales: 1, 1.2, 1.4, 1.6, 1.8, 2
const generateAvailableScales = (): number[] => {
  const scales: number[] = [];
  for (let s = MIN_SCALE; s <= MAX_SCALE; s += STEP) {
    scales.push(Math.round(s * 100) / 100);
  }
  return scales;
};

export const TextScaleProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [scale, setScaleState] = useState<number>(DEFAULT_SCALE);
  const [mounted, setMounted] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const savedScale = localStorage.getItem(STORAGE_KEY);
    if (savedScale) {
      const parsedScale = parseFloat(savedScale);
      if (!isNaN(parsedScale) && parsedScale >= MIN_SCALE && parsedScale <= MAX_SCALE) {
        setScaleState(parsedScale);
      }
    }
    setMounted(true);
  }, []);

  // Apply scale to root element via CSS variable
  useEffect(() => {
    if (!mounted) return;

    document.documentElement.style.setProperty('--text-scale', scale.toString());
    localStorage.setItem(STORAGE_KEY, scale.toString());
  }, [scale, mounted]);

  const setScale = useCallback((newScale: number) => {
    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    setScaleState(clampedScale);
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

export const useTextScale = (): TextScaleContextType => {
  const context = useContext(TextScaleContext);
  if (!context) {
    throw new Error('useTextScale must be used within a TextScaleProvider');
  }
  return context;
};
