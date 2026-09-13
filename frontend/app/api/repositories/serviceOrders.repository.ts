import { adminDb } from '@/config/firebaseAdminConfig';
import { assertLegacyWritable, runLegacyTransaction } from '@/data-engine/legacyBoundary.server';

import type { ServiceOrder } from '@/models/models';

const COLLECTION = 'serviceOrders';

/**
 * THE SERVER'S OWN WAY TO THE RITES.
 *
 * The browser normally talks to Firestore directly, and on most devices that is the whole
 * story. This exists for the device where that road is silent: the app's server holds an admin
 * key and answers over ordinary HTTPS, which the same device reaches without trouble.
 *
 * Ownership is not assumed here — every method takes the verified caller's id and filters by
 * it. The admin key bypasses Security Rules, so the rule a rule would have enforced has to be
 * written out, in one place, and that place is this file.
 */

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** What a rite is allowed to be missing and still be usable — the same shape the client hydrates. */
function hydrate(data: Omit<ServiceOrder, 'id'>, id: string): ServiceOrder {
  const steps = Array.isArray(data.steps) ? data.steps : [];
  return {
    ...data,
    id,
    title: typeof data.title === 'string' ? data.title : '',
    steps: steps.filter((step) => Boolean(step) && typeof step?.id === 'string'),
    rank: typeof data.rank === 'number' && Number.isFinite(data.rank) ? data.rank : Number.MAX_SAFE_INTEGER,
  };
}

export class ServiceOrdersRepository {
  async listForOwner(userId: string): Promise<ServiceOrder[]> {
    const snapshot = await adminDb.collection(COLLECTION).where('userId', '==', userId).get();
    return snapshot.docs.map((doc) => hydrate(doc.data() as Omit<ServiceOrder, 'id'>, doc.id));
  }

  /**
   * Creates only the rites this owner does not have yet, deciding by the rite's OWN key.
   *
   * Two devices pressing "завести типовые" in the same second therefore end with ten rites and
   * not twenty — the decision is made once, here, against the stored list, instead of twice in
   * two browsers that cannot see each other. A rite the pastor has already written in is never
   * touched: this only ever adds what is missing.
   */
  async seedMissingForOwner(
    userId: string,
    drafts: Omit<ServiceOrder, 'id'>[]
  ): Promise<ServiceOrder[]> {
    if (drafts.length > 100) throw Object.assign(new Error('Seed exceeds its atomic write budget'), { code: 'data-engine-required' });
    if (new Set(drafts.map(draft => draft.catalogKey)).size !== drafts.length) throw Object.assign(new Error('Duplicate catalog keys'), { code: 'invalid-argument' });
    return runLegacyTransaction(async transaction => {
      // Existing legacy records can have non-catalog document IDs. Read the owner
      // query and deterministic target IDs before staging any of the missing rites.
      const existing = await transaction.get(adminDb.collection(COLLECTION).where('userId', '==', userId).limit(101));
      if (existing.docs.length > 100) throw Object.assign(new Error('Seed exceeds its atomic read budget'), { code: 'data-engine-required' });
      const requested = new Set(drafts.map(draft => draft.catalogKey));
      const present = new Set<string>();
      const result: ServiceOrder[] = [];
      for (const document of existing.docs) {
        const raw = document.data();
        const data = raw as Omit<ServiceOrder, 'id'>;
        if (data.catalogKey && requested.has(data.catalogKey)) assertLegacyWritable(data);
        // Tombstones are never advertised as live orders by a legacy seed reply.
        if (raw._dataEngine && typeof raw._dataEngine === 'object' && 'deleted' in raw._dataEngine && raw._dataEngine.deleted) continue;
        if (data.catalogKey) present.add(data.catalogKey);
        result.push(hydrate(data, document.id));
      }
      const missing = drafts.filter(draft => draft.catalogKey && !present.has(draft.catalogKey));
      const refs = missing.map(draft => adminDb.collection(COLLECTION).doc(`${userId}__${draft.catalogKey}`));
      const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
      snapshots.forEach(snapshot => {
        if (!snapshot.exists) return;
        if (snapshot.data()?.userId !== userId) throw Object.assign(new Error('Forbidden'), { code: 'permission-denied' });
        assertLegacyWritable(snapshot.data());
      });
      missing.forEach((draft, index) => {
        const data = snapshots[index].exists ? snapshots[index].data()! : stripUndefined({ ...draft, userId });
        if (!snapshots[index].exists) transaction.create(refs[index], data);
        result.push(hydrate(data as Omit<ServiceOrder, 'id'>, refs[index].id));
      });
      return result;
    });
  }
}

export const serviceOrdersRepository = new ServiceOrdersRepository();
