'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

import { onConnectivityChange, probeConnectivity } from '@/utils/apiClient';
import { debugLog } from '@/utils/debugMode';

interface ConnectionContextType {
  isOnline: boolean;        // Real connectivity to the server
  isMagicAvailable: boolean; // UI-facing status for AI/Audio/Heavy features
  checkConnection: () => Promise<boolean>;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

export const ConnectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOnline, setIsOnline] = useState(true);
  
  // Magic is available if we are online and not experiencing excessive latency.
  // For now, we sync it directly with isOnline.
  const isMagicAvailable = isOnline;

  useEffect(() => {
    // Sync with apiClient observers
    const unsubscribe = onConnectivityChange((status) => {
      setIsOnline(status);
      debugLog('ConnectionProvider: online status sync', { status });
    });

    // Also listen to browser events as secondary hints
    const handleOnline = () => {
      debugLog('ConnectionProvider: browser online event');
      // When browser says online, we might still be "WiFi dead", 
      // so we don't force isOnline = true here. We let the next fetch decide.
    };

    const handleOffline = () => {
      debugLog('ConnectionProvider: browser offline event');
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

  const checkConnection = useCallback(async () => {
    debugLog('ConnectionProvider: manual probe initiated');
    const result = await probeConnectivity();
    setIsOnline(result);
    return result;
  }, []);

  return (
    <ConnectionContext.Provider value={{ isOnline, isMagicAvailable, checkConnection }}>
      {children}
    </ConnectionContext.Provider>
  );
};

export const useConnection = () => {
  const context = useContext(ConnectionContext);
  if (context === undefined) {
    throw new Error('useConnection must be used within a ConnectionProvider');
  }
  return context;
};
