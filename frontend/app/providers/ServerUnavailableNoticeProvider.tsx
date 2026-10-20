'use client';

import { useServerUnavailableShown } from '@/hooks/useServerUnavailable';
import { ServerUnavailableNoticeContext } from '@/hooks/useServerUnavailableNotice';
import { useAuth } from '@/providers/AuthProvider';
import { useConnection } from '@/providers/ConnectionProvider';

import type { ReactNode } from 'react';

/** Share the banner's delayed visibility, including with a status mounted after it appeared. */
export function ServerUnavailableNoticeProvider({ children }: { children: ReactNode }) {
  const settled = useServerUnavailableShown();
  const { user } = useAuth();
  const { offlineShown } = useConnection();
  return <ServerUnavailableNoticeContext.Provider value={settled && Boolean(user) && !offlineShown}>
    {children}
  </ServerUnavailableNoticeContext.Provider>;
}
