import { adminDb } from '@/config/firebaseAdminConfig';

import type { ServiceOrder } from '@/models/models';

const COLLECTION = 'serviceOrders';
/** gRPC status for "this document is already there" — Firestore's answer to a losing `create`. */
const ALREADY_EXISTS = 6;

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
    const existing = await this.listForOwner(userId);
    const present = new Set(existing.map((order) => order.catalogKey).filter(Boolean));
    const missing = drafts.filter((draft) => draft.catalogKey && !present.has(draft.catalogKey));
    if (missing.length === 0) return existing;

    /*
     * ONE RITE PER KEY, DECIDED BY THE DATABASE — not by the read above.
     *
     * Reading first and writing after is a guess with a gap in the middle: two presses a
     * hundred milliseconds apart both read an empty list and both write their ten, and the
     * pastor ends up with twenty. So each rite is written at a name derived from its owner and
     * its own key, with `create`, which REFUSES an existing document instead of replacing it.
     * The second press then loses every race it enters and changes nothing — the duplicate is
     * impossible rather than unlikely, and no rite already written in can be overwritten.
     */
    const created: ServiceOrder[] = [];
    for (const draft of missing) {
      // The owner is taken from the verified token, never from the payload: a client may say
      // which rites it wants, never whose they are.
      const data = stripUndefined({ ...draft, userId }) as Omit<ServiceOrder, 'id'>;
      const ref = adminDb.collection(COLLECTION).doc(`${userId}__${draft.catalogKey}`);
      try {
        await ref.create(data);
        created.push(hydrate(data, ref.id));
      } catch (error) {
        // ALREADY_EXISTS (6): another press won this rite. That is the outcome we wanted.
        if ((error as { code?: number }).code !== ALREADY_EXISTS) throw error;
      }
    }
    /*
     * Read again rather than adding up what THIS request did. Two simultaneous presses each
     * create part of the set and lose the rest to the other; adding up would hand each of them
     * its own half as if it were the whole list. By this line every key asked for either exists
     * or was just created, so the stored list is the complete and current answer.
     */
    return created.length > 0 ? this.listForOwner(userId) : existing;
  }
}

export const serviceOrdersRepository = new ServiceOrdersRepository();
