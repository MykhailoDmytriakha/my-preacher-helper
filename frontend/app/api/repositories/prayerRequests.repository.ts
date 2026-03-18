import { adminDb } from '@/config/firebaseAdminConfig';
import { PrayerCategory, PrayerRequest, PrayerStatus, PrayerUpdate } from '@/models/models';

const COLLECTION = 'prayerRequests';
const CATEGORIES_COLLECTION = 'prayerCategories';
const PRAYER_NOT_FOUND_ERROR = 'Prayer request not found';

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

function generateId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

export class PrayerRequestsRepository {
  async fetchByUserId(userId: string): Promise<PrayerRequest[]> {
    const snapshot = await adminDb.collection(COLLECTION).where('userId', '==', userId).get();
    return snapshot.docs
      .map((doc) => hydrate(doc.data() as Omit<PrayerRequest, 'id'>, doc.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async fetchById(id: string): Promise<PrayerRequest | null> {
    const doc = await adminDb.collection(COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    return hydrate(doc.data() as Omit<PrayerRequest, 'id'>, doc.id);
  }

  async create(payload: Omit<PrayerRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<PrayerRequest> {
    const now = new Date().toISOString();
    const data = stripUndefined({
      ...payload,
      updates: payload.updates || [],
      tags: payload.tags || [],
      status: payload.status || 'active',
      createdAt: now,
      updatedAt: now,
    });
    const ref = await adminDb.collection(COLLECTION).add(data);
    return hydrate(data as Omit<PrayerRequest, 'id'>, ref.id);
  }

  async update(id: string, updates: Partial<PrayerRequest>): Promise<PrayerRequest> {
    const current = await this.fetchById(id);
    if (!current) throw new Error(PRAYER_NOT_FOUND_ERROR);
    const patch = stripUndefined({ ...updates, updatedAt: new Date().toISOString() });
    await adminDb.collection(COLLECTION).doc(id).update(patch);
    return hydrate({ ...current, ...patch } as Omit<PrayerRequest, 'id'>, id);
  }

  async delete(id: string): Promise<void> {
    await adminDb.collection(COLLECTION).doc(id).delete();
  }

  async addUpdate(id: string, text: string): Promise<PrayerRequest> {
    const current = await this.fetchById(id);
    if (!current) throw new Error(PRAYER_NOT_FOUND_ERROR);
    const update: PrayerUpdate = { id: generateId(), text, createdAt: new Date().toISOString() };
    const updates = [...current.updates, update];
    return this.update(id, { updates });
  }

  async deleteUpdate(id: string, updateId: string): Promise<PrayerRequest> {
    const current = await this.fetchById(id);
    if (!current) throw new Error(PRAYER_NOT_FOUND_ERROR);
    const updates = current.updates.filter((u) => u.id !== updateId);
    return this.update(id, { updates });
  }

  async setStatus(id: string, status: PrayerStatus, answerText?: string): Promise<PrayerRequest> {
    const patch: Partial<PrayerRequest> = { status };
    if (status === 'answered') patch.answeredAt = new Date().toISOString();
    if (answerText !== undefined) patch.answerText = answerText;
    return this.update(id, patch);
  }

  // Categories
  async fetchCategoriesByUserId(userId: string): Promise<PrayerCategory[]> {
    const snapshot = await adminDb.collection(CATEGORIES_COLLECTION).where('userId', '==', userId).get();
    return snapshot.docs
      .map((doc) => ({ ...(doc.data() as Omit<PrayerCategory, 'id'>), id: doc.id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async createCategory(payload: Omit<PrayerCategory, 'id' | 'createdAt'>): Promise<PrayerCategory> {
    const now = new Date().toISOString();
    const data = { ...payload, createdAt: now };
    const ref = await adminDb.collection(CATEGORIES_COLLECTION).add(data);
    return { ...data, id: ref.id };
  }

  async deleteCategory(id: string): Promise<void> {
    await adminDb.collection(CATEGORIES_COLLECTION).doc(id).delete();
  }
}

export const prayerRequestsRepository = new PrayerRequestsRepository();
