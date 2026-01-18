'use client';

import { useState, useEffect } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { hasPrepModeAccess } from '@/services/userSettings.service';
import { debugLog } from '@/utils/debugMode';

/**
 * Hook to check if current user has access to prep mode
 * Returns loading state and access boolean
 */
export function usePrepModeAccess() {
  const { user, loading: authLoading } = useAuth();
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAccess() {
      if (authLoading) return;

      try {
        setLoading(true);
        debugLog('🔍 usePrepModeAccess: checking access for user:', user?.uid);
        const access = await hasPrepModeAccess(user?.uid || '');
        debugLog('✅ usePrepModeAccess: access result:', access);
        setHasAccess(access);
      } catch (error) {
        console.error('❌ usePrepModeAccess: Error checking prep mode access:', error);
        setHasAccess(false);
      } finally {
        setLoading(false);
      }
    }

    checkAccess();
  }, [user?.uid, authLoading]);

  return { hasAccess, loading: loading || authLoading };
}
