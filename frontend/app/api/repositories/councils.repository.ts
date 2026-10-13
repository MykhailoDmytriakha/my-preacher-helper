import { adminDb } from '@/config/firebaseAdminConfig';
import { isEngineTombstone } from '@/utils/engineTombstone';

import type { Council } from '@/models/models';

const COLLECTION = 'councils';

/**
 * THE SERVER'S READS OF THE COUNCILS, for a device whose browser Firestore is silent. The admin
 * key bypasses Security Rules, so the rule they would have enforced is written here, once: every
 * method takes the VERIFIED caller and answers only about that caller's documents. Councils are
 * written only through the data engine.
 */

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
    return snapshot.docs.filter((doc) => !isEngineTombstone(doc.data())).map((doc) => hydrate(doc.data(), doc.id));
  }

  async getForOwner(userId: string, id: string): Promise<Council | null> {
    const snapshot = await adminDb.collection(COLLECTION).doc(id).get();
    if (!snapshot.exists || snapshot.data()?.userId !== userId || isEngineTombstone(snapshot.data())) return null;
    return hydrate(snapshot.data() ?? {}, id);
  }
}

export const councilsRepository = new CouncilsRepository();
