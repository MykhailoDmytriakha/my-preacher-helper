import { adminDb } from '@/config/firebaseAdminConfig';
import { createLegacyDocument } from '@/data-engine/legacyBoundary.server';
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

    const owner = payload.userId;
    if (typeof owner !== 'string' || !owner) throw Object.assign(new Error('Prayer owner is required'), { status: 403 });
    const collection = adminDb.collection(COLLECTION);
    const ref = clientId ? collection.doc(clientId) : collection.doc();
    const result = await createLegacyDocument(ref, data, owner);
    return hydrate(result.data as Omit<PrayerRequest, 'id'>, ref.id);
  }
}

export const prayerRequestsRepository = new PrayerRequestsRepository();
