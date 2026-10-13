import { useDataCollection } from '@/data-engine/react.client';
import { PrayerRequest } from '@/models/models';
import { auth } from '@services/firebaseAuth.service';

function resolveUid(): string | undefined {
  return auth.currentUser?.uid ?? undefined;
}

/** One prayer, read from the data engine's rows (prayer requests are engine-owned). */
export function usePrayerDetail(prayerId: string, userId?: string | null) {
  const uid = userId ?? resolveUid();
  const engineRows = useDataCollection(uid && prayerId ? 'prayerRequests' : null);
  const engineRow = engineRows.state?.documents?.find(row => row.resource.id === prayerId);
  const prayer = engineRow?.value ? { ...(engineRow.value as unknown as PrayerRequest), id: prayerId } : null;
  return { prayer, isLoading: Boolean(prayerId) && !prayer && engineRows.loading };
}
