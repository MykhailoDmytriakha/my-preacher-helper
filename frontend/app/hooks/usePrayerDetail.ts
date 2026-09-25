import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { isCollectionOnEngine, useDataCollection } from '@/data-engine/react.client';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { PrayerRequest } from '@/models/models';
import { selectReadableCopy } from '@/utils/readFreshness';
import { auth } from '@services/firebaseAuth.service';
import { getPrayerRequestById } from '@services/prayerRequests.service';

function resolveUid(): string | undefined {
  return auth.currentUser?.uid ?? undefined;
}

export function usePrayerDetail(prayerId: string, userId?: string | null) {
  const queryClient = useQueryClient();
  const uid = userId ?? resolveUid();
  const onEngine = isCollectionOnEngine('prayerRequests');
  const engineRows = useDataCollection(onEngine && uid && prayerId ? 'prayerRequests' : null);
  const engineRow = engineRows.state?.documents?.find(row => row.resource.id === prayerId);
  const enginePrayer = engineRow?.value ? { ...(engineRow.value as unknown as PrayerRequest), id: prayerId } : null;

  // The persisted list can hydrate after this hook mounts. Subscribing to its key
  // lets an offline detail screen receive that stored prayer instead of sampling
  // an empty cache once and incorrectly concluding that the document is absent.
  const { data: cachedPrayers = [] } = useQuery<
    PrayerRequest[],
    Error,
    PrayerRequest[],
    readonly unknown[]
  >({
    queryKey: ['prayerRequests', uid],
    queryFn: skipToken,
    enabled: Boolean(uid),
    notifyOnChangeProps: ['data'],
  });

  const cachedFromList = useMemo(() => {
    if (!uid || !prayerId) return null;
    return cachedPrayers.find((prayer) => prayer.id === prayerId) ?? null;
  }, [cachedPrayers, uid, prayerId]);

  const detailKey = ['prayerRequest', prayerId] as const;
  const detailQuery = useServerFirstQuery<PrayerRequest | null>({
    queryKey: detailKey,
    queryFn: async () => {
      const server = await getPrayerRequestById(prayerId);
      const stored = queryClient.getQueryData<PrayerRequest>(detailKey) ?? cachedFromList;
      return selectReadableCopy(server, stored) ?? null;
    },
    enabled: !!prayerId && !onEngine,
    mode: 'server-first',
    // `null` means the server has proved absence. Feeding a cache miss in as
    // initial data would mark the query successful before its first getDoc and let
    // the detail page render a false not-found state while that read is in flight.
    initialData: cachedFromList ?? undefined,
    placeholderData: cachedFromList ?? undefined,
  });

  /**
   * Same rule as `useSermon` — see BUG-20260815-list-copy-hides-scratch.
   * The list entry is what this screen falls back to while the detail has not
   * arrived; it does not compete with the detail once it has. Comparing the two
   * by freshness lets a tie (neither copy carrying `rev` or `updatedAt`) hand the
   * screen to the older list snapshot.
   */
  if (onEngine) return { prayer: enginePrayer, isLoading: Boolean(prayerId) && !enginePrayer && engineRows.loading };
  const prayer = detailQuery.data ?? cachedFromList ?? null;
  return {
    prayer,
    isLoading: Boolean(prayerId) && !prayer && detailQuery.isFetching,
  };
}
