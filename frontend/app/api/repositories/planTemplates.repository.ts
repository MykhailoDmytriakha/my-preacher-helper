import { adminDb } from '@/config/firebaseAdminConfig';
import { PlanTemplate, SermonOutline } from '@/models/models';

const COLLECTION = 'planTemplates';
const NOT_FOUND_ERROR = 'Plan template not found';

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

function normalizeStructure(structure?: Partial<SermonOutline>): SermonOutline {
  return {
    introduction: structure?.introduction ?? [],
    main: structure?.main ?? [],
    conclusion: structure?.conclusion ?? [],
  };
}

function hydrate(data: Omit<PlanTemplate, 'id'>, id: string): PlanTemplate {
  return {
    ...data,
    id,
    name: data.name || '',
    structure: normalizeStructure(data.structure),
  };
}

export class PlanTemplatesRepository {
  async fetchByUserId(userId: string): Promise<PlanTemplate[]> {
    const snapshot = await adminDb.collection(COLLECTION).where('userId', '==', userId).get();
    return snapshot.docs
      .map((doc) => hydrate(doc.data() as Omit<PlanTemplate, 'id'>, doc.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async fetchById(id: string): Promise<PlanTemplate | null> {
    const doc = await adminDb.collection(COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    return hydrate(doc.data() as Omit<PlanTemplate, 'id'>, doc.id);
  }

  async create(
    payload: Omit<PlanTemplate, 'id' | 'createdAt' | 'updatedAt'>,
    clientId?: string
  ): Promise<PlanTemplate> {
    const now = new Date().toISOString();
    const data = stripUndefined({
      userId: payload.userId,
      name: payload.name,
      structure: normalizeStructure(payload.structure),
      createdAt: now,
      updatedAt: now,
    });

    // Idempotent create when the client supplies the id: a replayed offline write
    // reuses the same doc instead of duplicating. Guard ownership so a client cannot
    // overwrite another user's document by guessing an id.
    if (clientId) {
      const ref = adminDb.collection(COLLECTION).doc(clientId);
      const existing = await ref.get();
      if (existing.exists) {
        const existingData = existing.data() as Omit<PlanTemplate, 'id'>;
        if (existingData.userId !== payload.userId) {
          throw new Error('Forbidden: plan template id belongs to another user');
        }
        return hydrate(existingData, clientId);
      }
      await ref.set(data);
      return hydrate(data as Omit<PlanTemplate, 'id'>, clientId);
    }

    const ref = await adminDb.collection(COLLECTION).add(data);
    return hydrate(data as Omit<PlanTemplate, 'id'>, ref.id);
  }

  async update(id: string, updates: Partial<PlanTemplate>): Promise<PlanTemplate> {
    const current = await this.fetchById(id);
    if (!current) throw new Error(NOT_FOUND_ERROR);
    const patch = stripUndefined({
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.structure !== undefined ? { structure: normalizeStructure(updates.structure) } : {}),
      updatedAt: new Date().toISOString(),
    });
    await adminDb.collection(COLLECTION).doc(id).update(patch);
    return hydrate({ ...current, ...patch } as Omit<PlanTemplate, 'id'>, id);
  }

  async delete(id: string): Promise<void> {
    await adminDb.collection(COLLECTION).doc(id).delete();
  }
}

export const planTemplatesRepository = new PlanTemplatesRepository();
