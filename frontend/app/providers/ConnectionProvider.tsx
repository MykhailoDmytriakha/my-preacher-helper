'use client';

import React, { createContext, useContext, useCallback } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { probeConnectivity, type ProbeOutcome } from '@/utils/apiClient';
import { reportProbeSucceeded } from '@/utils/connectivity';
import { debugLog } from '@/utils/debugMode';

interface ConnectionContextType {
  isOnline: boolean;        // Real connectivity to the server
  isMagicAvailable: boolean; // UI-facing status for AI/Audio/Heavy features
  checkConnection: () => Promise<ProbeOutcome>;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

/**
 * ONE ANSWER TO "ARE WE ONLINE", AND THIS PROVIDER DOES NOT HOLD IT.
 *
 * It used to keep its own copy: starting at `true` and learning otherwise only from the
 * browser `offline` EVENT, which fires on a transition — so an app launched with the Wi-Fi
 * already off never received it, and the two elements that exist to say "you are offline",
 * the header icon and the top strip, both stayed hidden for the whole session.
 *
 * The answer now lives in `utils/connectivity`, which keeps the device signal and the
 * server signal apart and reconciles the device on the way back into the page. This is a
 * republisher, and deliberately nothing more: an earlier attempt had it fire its own health
 * probe when the browser announced a network, and a single timed-out probe could then
 * disable every server-first read with nothing left running that could re-enable them.
 * Connectivity recovers from ordinary traffic and from the device signal; a provider does
 * not need to help.
 */
export const ConnectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isOnline = useOnlineStatus();

  // Magic is available if we are online and not experiencing excessive latency.
  // For now, we sync it directly with isOnline.
  const isMagicAvailable = isOnline;

  /**
   * The manual "check again" button.
   *
   * A reply of any status means the network carried it, and that is the one piece of
   * evidence allowed to overrule a device flag that is stuck — which is exactly the state
   * a person is in when they press this button on an iPad resumed from the background.
   * Whether the SERVER was healthy is a separate answer, and it goes back to the caller so
   * the message they read matches what actually happened.
   */
  const checkConnection = useCallback(async () => {
    debugLog('ConnectionProvider: manual probe initiated');
    const outcome = await probeConnectivity();
    if (outcome !== 'unreachable') reportProbeSucceeded();
    return outcome;
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
