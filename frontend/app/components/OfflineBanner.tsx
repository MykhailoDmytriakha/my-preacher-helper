'use client';

import { useEffect, useState } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted || isOnline) return null;

  return (
    <div className="w-full bg-amber-100 text-amber-900 text-sm px-4 py-2 border-b border-amber-200">
      You are offline. Viewing cached data (read-only).
    </div>
  );
}
