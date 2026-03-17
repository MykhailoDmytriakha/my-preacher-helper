'use client';

import { useEffect, useState } from 'react';

import { useConnection } from '@/providers/ConnectionProvider';

export function OfflineBanner() {
  const { isOnline } = useConnection();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted || isOnline) return null;

  return (
    <div className="w-full bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-100 text-xs sm:text-sm px-4 py-2 border-b border-amber-200 dark:border-amber-800 flex items-center justify-center gap-2">
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>Working in offline mode. Changes will be saved locally and synced when online.</span>
    </div>
  );
}
