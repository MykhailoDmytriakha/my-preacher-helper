import { useEffect, useState } from 'react';

import { getConnectivityStatus, onConnectivityChange } from '@/utils/apiClient';
import { debugLog } from '@/utils/debugMode';

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.navigator.onLine && getConnectivityStatus();
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const resolveOnlineStatus = () => window.navigator.onLine && getConnectivityStatus();

    debugLog('Online status initialized', {
      browserOnline: window.navigator.onLine,
      apiOnline: getConnectivityStatus(),
      isOnline: resolveOnlineStatus(),
    });

    const unsubscribe = onConnectivityChange((apiOnline) => {
      const nextStatus = window.navigator.onLine && apiOnline;
      debugLog('Online status API connectivity changed', {
        browserOnline: window.navigator.onLine,
        apiOnline,
        isOnline: nextStatus,
      });
      setIsOnline(nextStatus);
    });

    const handleOnline = () => {
      const nextStatus = resolveOnlineStatus();
      debugLog('Online status changed', {
        browserOnline: true,
        apiOnline: getConnectivityStatus(),
        isOnline: nextStatus,
      });
      setIsOnline(nextStatus);
    };

    const handleOffline = () => {
      debugLog('Online status changed', {
        browserOnline: false,
        apiOnline: getConnectivityStatus(),
        isOnline: false,
      });
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
