import { adminDb } from '@/config/firebaseAdminConfig';
import { isEngineTombstone } from '@/utils/engineTombstone';

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
    // A tombstone written before 2026-09-18 still carries userId and answers the owner query.
    return snapshot.docs.filter((doc) => !isEngineTombstone(doc.data())).map((doc) => hydrate(doc.data() as Omit<ServiceOrder, 'id'>, doc.id));
  }

}

export const serviceOrdersRepository = new ServiceOrdersRepository();
