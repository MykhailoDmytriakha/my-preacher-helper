import { adminDb } from '@/config/firebaseAdminConfig';

import type { CouncilBody } from '@/api/councils/writeSupport';
import type { Council } from '@/models/models';

const COLLECTION = 'councils';
/** gRPC status for "this document is already there" — Firestore's answer to a losing `create`. */
const ALREADY_EXISTS = 6;

/**
 * THE SERVER'S OWN WAY TO THE COUNCILS — the second road, for the device where the browser's
 * Firestore is silent. The admin key bypasses Security Rules, so the rule they would have
 * enforced is written here, once: every method takes the VERIFIED caller and answers only about
 * that caller's documents.
 *
 * A council is one document, sections included, and it is written whole: the pastor edits it
 * from one device at a time, and a whole-document compare-and-set on `rev` is enough to catch
 * the rare second device — see `replaceForOwner`.
 */

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function hydrate(data: Record<string, unknown>, id: string): Council {
  return {
    ...(data as Omit<Council, 'id'>),
    id,
    topics: Array.isArray(data.topics) ? (data.topics as Council['topics']) : [],
    rev: typeof data.rev === 'number' ? data.rev : 0,
  };
}

export class CouncilsRepository {
  async listForOwner(userId: string): Promise<Council[]> {
    const snapshot = await adminDb.collection(COLLECTION).where('userId', '==', userId).get();
    return snapshot.docs.map((doc) => hydrate(doc.data(), doc.id));
  }

  async getForOwner(userId: string, id: string): Promise<Council | null> {
    const snapshot = await adminDb.collection(COLLECTION).doc(id).get();
    if (!snapshot.exists || snapshot.data()?.userId !== userId) return null;
    return hydrate(snapshot.data() ?? {}, id);
  }

  /**
   * Creates at the CLIENT's id, so a replayed create is a no-op instead of a twin: `create`
   * refuses an existing document, and an existing one that belongs to this caller is simply
   * handed back. One that belongs to someone else is a refusal, never a read.
   */
  async createForOwner(userId: string, id: string, body: CouncilBody): Promise<Council> {
    const ref = adminDb.collection(COLLECTION).doc(id);
    const data = stripUndefined({ ...body, userId, rev: 0 });
    try {
      await ref.create(data);
      return hydrate(data, id);
    } catch (error) {
      if ((error as { code?: number }).code !== ALREADY_EXISTS) throw error;
      const existing = await this.getForOwner(userId, id);
      if (!existing) throw Object.assign(new Error('Forbidden'), { code: 'permission-denied' });
      return existing;
    }
  }

  /**
   * Replaces the whole council if it is still at the revision the client last saw. A stale
   * client gets the current document back with `conflict: true` and decides what to do with it;
   * `expectedRev: null` is the offline-replay path that has no revision to state.
   */
  async replaceForOwner(
    userId: string,
    id: string,
    body: CouncilBody,
    expectedRev: number | null
  ): Promise<{ conflict: boolean; current: Council }> {
    const ref = adminDb.collection(COLLECTION).doc(id);
    return adminDb.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.data()?.userId !== userId) {
        throw Object.assign(new Error('Council not found'), { code: 'not-found' });
      }
      const current = hydrate(snapshot.data() ?? {}, id);
      if (expectedRev !== null && expectedRev !== current.rev) {
        return { conflict: true, current };
      }
      const next = stripUndefined({ ...body, userId, rev: (current.rev ?? 0) + 1 });
      tx.set(ref, next);
      return { conflict: false, current: hydrate(next, id) };
    });
  }

  async deleteForOwner(userId: string, id: string): Promise<void> {
    const ref = adminDb.collection(COLLECTION).doc(id);
    await adminDb.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.data()?.userId !== userId) {
        throw Object.assign(new Error('Council not found'), { code: 'not-found' });
      }
      tx.delete(ref);
    });
  }
}

export const councilsRepository = new CouncilsRepository();
