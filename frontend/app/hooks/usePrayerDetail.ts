import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { PrayerRequest } from '@/models/models';
import { auth } from '@services/firebaseAuth.service';
import { getPrayerRequestById } from '@services/prayerRequests.service';

function resolveUid(): string | undefined {
  return auth.currentUser?.uid ?? undefined;
}

export function usePrayerDetail(prayerId: string) {
  const queryClient = useQueryClient();
  const uid = resolveUid();

  const cachedFromList = useMemo(() => {
    if (!uid || !prayerId) return null;
    const list = queryClient.getQueryData<PrayerRequest[]>(['prayerRequests', uid]) ?? [];
    return list.find((p) => p.id === prayerId) ?? null;
  }, [queryClient, uid, prayerId]);

  const { data } = useServerFirstQuery<PrayerRequest | undefined>({
    queryKey: ['prayerRequest', prayerId],
    queryFn: () => getPrayerRequestById(prayerId),
    enabled: !!prayerId && !cachedFromList,
  });

  return { prayer: cachedFromList ?? data ?? null };
}
