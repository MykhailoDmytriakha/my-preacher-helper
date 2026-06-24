import { adminDb } from '@/config/firebaseAdminConfig';
import { PrayerRequest } from '@/models/models';

const COLLECTION = 'prayerRequests';

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

function hydrate(data: Omit<PrayerRequest, 'id'>, id: string): PrayerRequest {
  return {
    ...data,
    id,
    updates: data.updates || [],
    tags: data.tags || [],
    status: data.status || 'active',
  };
}

// Phase 5: prayer reads/updates/deletes/status/updates + categories all run on
// the client Firestore SDK now. Only create stays server-side — it guards against
// a replayed offline setDoc clobbering mutable fields (updates[]/status) on an
// existing client-id doc.
export class PrayerRequestsRepository {
  async create(
    payload: Omit<PrayerRequest, 'id' | 'createdAt' | 'updatedAt'>,
    clientId?: string
  ): Promise<PrayerRequest> {
    const now = new Date().toISOString();
    const data = stripUndefined({
      ...payload,
      updates: payload.updates || [],
      tags: payload.tags || [],
      status: payload.status || 'active',
      createdAt: now,
      updatedAt: now,
    });

    // Idempotent create when the client supplies the id: a replayed offline
    // write reuses the same doc instead of duplicating. Guard ownership so a
    // client cannot overwrite another user's document by guessing an id.
    if (clientId) {
      const ref = adminDb.collection(COLLECTION).doc(clientId);
      const existing = await ref.get();
      if (existing.exists) {
        const existingData = existing.data() as Omit<PrayerRequest, 'id'>;
        // Idempotent replay only when the doc is the SAME user's. Any mismatch
        // (including a missing userId on the stored doc) is treated as a foreign
        // id and rejected, so a client can never reach another user's document.
        if (existingData.userId !== payload.userId) {
          throw new Error('Forbidden: prayer id belongs to another user');
        }
        return hydrate(existingData, clientId);
      }
      await ref.set(data);
      return hydrate(data as Omit<PrayerRequest, 'id'>, clientId);
    }

    const ref = await adminDb.collection(COLLECTION).add(data);
    return hydrate(data as Omit<PrayerRequest, 'id'>, ref.id);
  }
}

export const prayerRequestsRepository = new PrayerRequestsRepository();
