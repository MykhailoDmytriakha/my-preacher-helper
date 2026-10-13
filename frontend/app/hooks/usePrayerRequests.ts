import { usePrayerRequestsEngine } from '@/hooks/usePrayerRequestsEngine';

/**
 * The prayer journal. Prayer requests are read and written only through the data engine
 * (engineOwnedCollections.ts).
 *
 * @param activeDocId id of the prayer the caller currently has OPEN. Supplying it
 *   makes a refused save durable: without a document key the conflict can only
 *   live in memory, and a reload before the person chooses destroys the only copy
 *   of the typed text. List screens can omit it — they do not edit text.
 */
export function usePrayerRequests(userId?: string | null, activeDocId?: string | null) {
  return usePrayerRequestsEngine(userId, activeDocId, true);
}
