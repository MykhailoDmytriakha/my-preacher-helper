'use client';

import React, { createContext, useContext, useCallback, useEffect } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { knockNow, startConnectivityKnock, type KnockOutcome } from '@/utils/connectivityKnock';
import { debugLog } from '@/utils/debugMode';

interface ConnectionContextType {
  /** Did the last real request reach our server? What the crossed-out Wi-Fi icon shows. */
  isOnline: boolean;
  /** The "check again" button: knock now and say what came back. */
  checkConnection: () => Promise<KnockOutcome>;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

/**
 * ONE ANSWER TO "IS THERE A CONNECTION", AND THIS PROVIDER DOES NOT HOLD IT.
 *
 * The answer lives in `utils/connectivity` (yes: the last real request reached our server). This
 * provider republishes it and keeps the knocking running while it is "no", so a return of the
 * network is noticed without anybody pressing a button (`utils/connectivityKnock`).
 *
 * The answer only SHOWS (owner's rule 3): nothing reads it to switch off reading, editing or saving,
 * and AI actions are not disabled by it — pressing one makes a real request, which is itself the
 * test of the connection, and a failure is told like any failed request.
 */
export const ConnectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isOnline = useOnlineStatus();

  useEffect(() => startConnectivityKnock(), []);

  const checkConnection = useCallback(async () => {
    debugLog('ConnectionProvider: manual check');
    return knockNow();
  }, []);

  return (
    <ConnectionContext.Provider value={{ isOnline, checkConnection }}>
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
