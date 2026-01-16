import { useEffect, useState } from 'react';

import { debugLog } from '@/utils/debugMode';

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.navigator.onLine;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    debugLog('Online status initialized', { isOnline: window.navigator.onLine });

    const handleOnline = () => {
      debugLog('Online status changed', { isOnline: true });
      setIsOnline(true);
    };
    const handleOffline = () => {
      debugLog('Online status changed', { isOnline: false });
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
