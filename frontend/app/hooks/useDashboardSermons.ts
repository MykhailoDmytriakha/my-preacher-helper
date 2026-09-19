import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { isCollectionOnEngine } from '@/data-engine/react.client';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSermonsDataCollection } from '@/hooks/useSermonsDataCollection';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { Sermon } from '@/models/models';
import { debugLog } from '@/utils/debugMode';
import { auth } from '@services/firebaseAuth.service';
import { getSermons } from '@services/sermon.service';

interface UseDashboardSermonsResult {
  sermons: Sermon[];
  loading: boolean;
  error: Error | string | null;
  state?: ReturnType<typeof useSermonsDataCollection>['state'];
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
  const engine = useSermonsDataCollection();
  // We need to wait for auth to be initialized or local storage to be checked
  // Ideally this should come from an auth hook, but for now we resolve it here
  // If uid is undefined, we might be loading or not logged in
  const uid = resolveUid();

  const { data: sermons = [], isLoading, error, refetch } = useServerFirstQuery({
    queryKey: ['sermons', uid],
    queryFn: () => {
      if (!uid) return Promise.resolve([]);
      return getSermons(uid);
    },
    enabled: !!uid && !isCollectionOnEngine('sermons'),
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

  if (isCollectionOnEngine('sermons')) return { ...engine, refresh: async () => { await engine.refresh(); } };

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

  const updateSermonCache = async (updatedSermon: Sermon) => {
    await queryClient.cancelQueries({ queryKey: ['sermons', uid] });
    queryClient.setQueryData(['sermons', uid], (old: Sermon[] | undefined) => {
      if (!old) return [updatedSermon];
      return old.map((s) => (s.id === updatedSermon.id ? updatedSermon : s));
    });
    // Invalidate to ensure persisted cache syncs without immediate refetch
    queryClient.invalidateQueries({ queryKey: ['sermons', uid], refetchType: 'none' });
  };

  const deleteSermonFromCache = async (id: string) => {
    await queryClient.cancelQueries({ queryKey: ['sermons', uid] });
    queryClient.setQueryData(['sermons', uid], (old: Sermon[] | undefined) => {
      if (!old) return [];
      return old.filter((s) => s.id !== id);
    });
    // Invalidate to ensure persisted cache syncs without immediate refetch
    queryClient.invalidateQueries({ queryKey: ['sermons', uid], refetchType: 'none' });
  };

  const addSermonToCache = async (newSermon: Sermon) => {
    await queryClient.cancelQueries({ queryKey: ['sermons', uid] });
    queryClient.setQueryData(['sermons', uid], (old: Sermon[] | undefined) => {
      if (!old) return [newSermon];
      return [newSermon, ...old];
    });
    // Invalidate to ensure persisted cache syncs without immediate refetch
    queryClient.invalidateQueries({ queryKey: ['sermons', uid], refetchType: 'none' });
  };

  return { updateSermonCache, deleteSermonFromCache, addSermonToCache };
}

export default useDashboardSermons;
