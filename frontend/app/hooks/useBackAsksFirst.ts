'use client';

import { useEffect, useRef, useState } from 'react';

import { closeOnBrowserMove, historyStepHere, pushHistoryStep, takeHistoryStep } from '@/utils/historyStep';

/**
 * A WINDOW HOLDING WORK NOT YET SAVED STANDS ON A STEP OF THE BROWSER'S HISTORY (BUG-20261101-browser-back-closes-window-unasked).
 * Back — the browser's button, a swipe — leaves that step and nothing else: the page stays, and the window's own way out
 * runs, which asks before words go (the owner, 01.11: closing a window with data is the person's decision). Kept open, the
 * window stands on a new step, so the next Back asks again. Saved, emptied or closed by its own way out, it takes its step
 * back, and Back goes where it went before the window. The step primitive is `utils/historyStep.ts`, as an analysis
 * window's is.
 */
export function useBackAsksFirst({ active, onBack }: { active: boolean; onBack: () => void }): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  // Each Back that leaves the window open puts a new step under it.
  const [stood, setStood] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const step = pushHistoryStep(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    let left = false;
    const moved = () => {
      if (historyStepHere() === step) return;
      left = true;
      closeOnBrowserMove(() => onBackRef.current());
      setStood((count) => count + 1);
    };
    window.addEventListener('popstate', moved);
    return () => {
      window.removeEventListener('popstate', moved);
      if (!left) takeHistoryStep(step);
    };
  }, [active, stood]);
}
