'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useConnection } from '@/providers/ConnectionProvider';

/**
 * THE ONE THING THE APP SAYS ABOUT A LOST CONNECTION.
 *
 * A crossed-out Wi-Fi glyph is the whole message, and it carries it in a glance —
 * which is why the freshness panel stands down offline instead of explaining the
 * same fact in a paragraph. That puts the weight on this button, so its words are
 * translated: they used to be hardcoded English sitting in a Russian interface, the
 * same defect already caught once in `OfflineBanner`.
 */
export function OfflineIndicator() {
  const { t } = useTranslation();
  const { isOnline, checkConnection } = useConnection();
  const [isChecking, setIsChecking] = useState(false);

  if (isOnline) return null;

  const handleRetry = async () => {
    if (isChecking) return;
    setIsChecking(true);
    try {
      const outcome = await checkConnection();
      // A newer request or device event has already replaced this evidence.
      if (outcome === 'superseded') return;
      /**
       * Three outcomes, three sentences. A single boolean here once told someone "still no
       * connection" and then removed the offline icon a moment later, because the server
       * had in fact replied — with an error. The network carrying a request and the server
       * being usable are different facts, and the message has to say which one is true.
       */
      if (outcome === 'unreachable') {
        toast.info(t('connection.probeStillOffline'), { id: 'offline-probe-failed' });
      } else if (outcome === 'unhealthy') {
        toast.warning(t('connection.probeServerUnhealthy'), { id: 'offline-probe-unhealthy' });
      } else {
        toast.success(t('connection.probeBackOnline'), { id: 'offline-probe-success' });
      }
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <button
      onClick={handleRetry}
      disabled={isChecking}
      title={t('connection.offlineIconTitle')}
      aria-label={t('connection.offlineIconLabel')}
      className={`
        relative flex items-center justify-center p-2 rounded-full
        transition-all duration-300
        bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400
        hover:bg-amber-200 dark:hover:bg-amber-800/40
        ${isChecking ? 'animate-pulse' : ''}
      `}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-5 h-5"
        aria-hidden="true"
      >
        <line x1="1" y1="1" x2="23" y2="23"></line>
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
        <line x1="12" y1="20" x2="12.01" y2="20"></line>
      </svg>
    </button>
  );
}
