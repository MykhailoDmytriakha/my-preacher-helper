'use client';

import React, { createContext, useContext, useCallback, useEffect } from 'react';

import { useKnownOffline } from '@/hooks/useKnownOffline';
import { useLasting } from '@/hooks/useLasting';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { knockNow, startConnectivityKnock, type KnockOutcome } from '@/utils/connectivityKnock';
import { debugLog } from '@/utils/debugMode';

interface ConnectionContextType {
  /** Did the last real request reach our server? What sending, reading and the knock follow. */
  isOnline: boolean;
  /** Whether "no connection" is said: the crossed-out Wi-Fi icon and the "Working offline" line. */
  offlineShown: boolean;
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
  // WHEN "NO CONNECTION" IS SAID (the owner, 2026-10-17: "while there is a connection, no banner; when
  // it breaks, the banner"). The answer turns "no" at the first request that does not reach — on a weak
  // signal a write that ran out of time — and the knock brings it back within seconds while the server
  // answers: "Working offline" flashed for a few seconds after a mark. The phone saying it has no
  // network is said at once — also when it says so while a failed request is still settling — and
  // stays said until a request gets through; a request that did not reach, only once "no" has lasted
  // (`useLasting`). Nothing else waits: sending, reading and the knock follow `isOnline` as before.
  const offlineShown = useLasting(!isOnline, useKnownOffline());

  useEffect(() => startConnectivityKnock(), []);

  const checkConnection = useCallback(async () => {
    debugLog('ConnectionProvider: manual check');
    return knockNow();
  }, []);

  return (
    <ConnectionContext.Provider value={{ isOnline, offlineShown, checkConnection }}>
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
