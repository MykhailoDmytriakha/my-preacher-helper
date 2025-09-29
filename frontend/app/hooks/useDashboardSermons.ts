'use client';

import { useCallback, useEffect, useState } from 'react';
import { Sermon } from '@/models/models';
import { getSermons } from '@services/sermon.service';
import { auth } from '@services/firebaseAuth.service';

interface UseDashboardSermonsResult {
  sermons: Sermon[];
  setSermons: React.Dispatch<React.SetStateAction<Sermon[]>>;
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
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSermons = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const uid = resolveUid();
      if (!uid) {
        setSermons([]);
        return;
      }

      const fetchedSermons = await getSermons(uid);
      setSermons(fetchedSermons);
    } catch (err) {
      const normalizedError = err instanceof Error ? err : new Error(String(err));
      setError(normalizedError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSermons();
  }, [fetchSermons]);

  return {
    sermons,
    setSermons,
    loading,
    error,
    refresh: fetchSermons,
  };
}

export default useDashboardSermons;
