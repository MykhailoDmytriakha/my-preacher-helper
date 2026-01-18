import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Sermon } from '@/models/models';
import { debugLog } from '@/utils/debugMode';
import { auth } from '@services/firebaseAuth.service';
import { getSermons } from '@services/sermon.service';

interface UseDashboardSermonsResult {
  sermons: Sermon[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function resolveUid(): string | undefined {
  const currentUser = auth.currentUser;
  if (currentUser?.uid) {
    return currentUser.uid;
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const guestData = window.localStorage.getItem('guestUser');
    if (!guestData) {
      return undefined;
    }

    const parsed = JSON.parse(guestData) as { uid?: string };
    return parsed.uid;
  } catch (error) {
    console.error('Error parsing guestUser from localStorage', error);
    return undefined;
  }
}

export function useDashboardSermons(): UseDashboardSermonsResult {
  const isOnline = useOnlineStatus();
  // We need to wait for auth to be initialized or local storage to be checked
  // Ideally this should come from an auth hook, but for now we resolve it here
  // If uid is undefined, we might be loading or not logged in
  const uid = resolveUid();

  const { data: sermons = [], isLoading, error, refetch } = useQuery({
    queryKey: ['sermons', uid],
    queryFn: () => {
      if (!uid) return Promise.resolve([]);
      return getSermons(uid);
    },
    enabled: !!uid && isOnline, // Only fetch if we have a user ID and online
  });

  useEffect(() => {
    debugLog('Dashboard sermons state', {
      isOnline,
      uid,
      count: sermons.length,
      isLoading,
    });
  }, [isOnline, uid, sermons.length, isLoading]);

  const refresh = async () => {
    if (!isOnline) return;
    await refetch();
  };

  // Compatibility wrapper to match old interface
  // We return setSermons as a no-op or we expose mutation methods instead
  // But the old interface had setSermons. To fully migrate, we should use
  // queryClient.setQueryData in the components, or expose a mutation here.
  // For now, let's stick to the interface but note that setSermons is missing.
  // The components using this hook will need to be updated to NOT use setSermons directly
  // or we provide a wrapper for optimistic updates.

  return {
    sermons,
    loading: isLoading,
    error: error as Error | null,
    refresh,
  };
}

// Helper hook for optimistic updates (if needed later)
export function useSermonMutations() {
  const queryClient = useQueryClient();
  const uid = resolveUid();

  const updateSermonCache = (updatedSermon: Sermon) => {
    queryClient.setQueryData(['sermons', uid], (old: Sermon[] | undefined) => {
      if (!old) return [updatedSermon];
      return old.map((s) => (s.id === updatedSermon.id ? updatedSermon : s));
    });
    // Invalidate to ensure persisted cache syncs
    queryClient.invalidateQueries({ queryKey: ['sermons', uid] });
  };

  const deleteSermonFromCache = (id: string) => {
    queryClient.setQueryData(['sermons', uid], (old: Sermon[] | undefined) => {
      if (!old) return [];
      return old.filter((s) => s.id !== id);
    });
    // Invalidate to ensure persisted cache syncs
    queryClient.invalidateQueries({ queryKey: ['sermons', uid] });
  };

  const addSermonToCache = (newSermon: Sermon) => {
    queryClient.setQueryData(['sermons', uid], (old: Sermon[] | undefined) => {
      if (!old) return [newSermon];
      return [newSermon, ...old];
    });
    // Invalidate to ensure persisted cache syncs
    queryClient.invalidateQueries({ queryKey: ['sermons', uid] });
  };

  return { updateSermonCache, deleteSermonFromCache, addSermonToCache };
}

export default useDashboardSermons;
