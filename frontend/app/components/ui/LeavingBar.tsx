'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A THIN LINE ALONG THE TOP OF THE SCREEN WHILE THE APP GOES TO ANOTHER SCREEN. A button that leaves with
 * `router.push` shows nothing until the server has answered for the next page (0.15 s, 1.3 s when it was
 * asleep), and the tap reads as lost (the owner, 2026-10-21: «кликнул, потом ждёшь, а потом что-то
 * происходит»). The line appears in the tap's own frame and grows while the screen waits; the next screen
 * takes it away by replacing this one.
 */
export function LeavingBar() {
  const { t } = useTranslation();
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setGrown(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return (
    <div role="status" data-testid="leaving-bar" className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-[100] h-[3px]">
      <span className="sr-only">{t('common.loading')}</span>
      <div
        className="h-full rounded-r-full bg-indigo-500 transition-[width] duration-[3000ms] ease-out dark:bg-indigo-400"
        style={{ width: grown ? '85%' : '8%' }}
      />
    </div>
  );
}
