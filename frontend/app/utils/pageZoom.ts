import { useSyncExternalStore } from 'react';

/*
 * THE PAGE PINCHED BIGGER — the browser's own zoom (the visual viewport's scale), not the app's text size.
 * Magnified, a finger's sideways pull is the browser's: it pans the page to the clipped side. The page's
 * own swipe back stays off then (`navigation/gestures/usePageGestures.ts`), and the Bible's text gives
 * the sideways pull back to the browser (`components/bible/marks/useReaderMarks.tsx`).
 */
export function isPageZoomed(): boolean {
  return typeof window !== 'undefined' && Boolean(window.visualViewport) && window.visualViewport!.scale !== 1;
}

function subscribe(listener: () => void): () => void {
  const viewport = typeof window === 'undefined' ? null : window.visualViewport;
  viewport?.addEventListener('resize', listener);
  return () => viewport?.removeEventListener('resize', listener);
}

/** Whether the page is pinched bigger now; follows the pinch. */
export function usePageZoomed(): boolean {
  return useSyncExternalStore(subscribe, isPageZoomed, () => false);
}
