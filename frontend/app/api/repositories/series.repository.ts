import { FieldValue } from 'firebase-admin/firestore';

import { adminDb } from '@/config/firebaseAdminConfig';
import { runLegacyTransaction } from '@/data-engine/legacyBoundary.server';
import { Series } from '@/models/models';
import {
  deriveSermonIdsFromItems,
  inferSeriesKind,
  normalizeSeriesItems,
  removeSeriesItemByRef,
} from '@/utils/seriesItems';

/**
 * The one legacy series cascade left: deleting a sermon through the legacy sermon route. Series are
 * engine-owned, so the transaction refuses it whenever a series would change; it goes with that
 * route.
 */
export class SeriesRepository {
  private readonly collection = "series";

  private hydrateSeries(series: Series): Series {
    const items = normalizeSeriesItems(series.items, series.sermonIds || []);
    const sermonIds = deriveSermonIdsFromItems(items);
    return {
      ...series,
      items,
      sermonIds,
      seriesKind: series.seriesKind || inferSeriesKind(items),
    };
  }

  /**
   * Atomically deletes a sermon AND detaches it from every one of the owner's series.
   * The transaction retries from a fresh series snapshot when a concurrent edit commits,
   * so it provides both read isolation and all-or-nothing writes. Foreign-owned series are
   * never touched.
   */
  async deleteSermonAndDetachFromAllSeries(sermonId: string, ownerUid: string): Promise<void> {
    const seriesQuery = adminDb.collection(this.collection)
      .where('userId', '==', ownerUid).where('sermonIds', 'array-contains', sermonId).limit(101);
    const sermonRef = adminDb.collection('sermons').doc(sermonId);

    await runLegacyTransaction(async (transaction) => {
      const sermon = await transaction.get(sermonRef);
      if (sermon.exists && sermon.data()?.userId !== ownerUid) throw Object.assign(new Error('Forbidden'), { code: 'permission-denied' });
      const seriesSnapshot = await transaction.get(seriesQuery);

      seriesSnapshot.docs.forEach((doc) => {
        const series = this.hydrateSeries({ id: doc.id, ...doc.data() } as Series);
        if (series.userId !== ownerUid) {
          return; // never mutate a foreign-owned series
        }
        const nextItems = removeSeriesItemByRef(series.items || [], { type: 'sermon', refId: sermonId });
        transaction.update(doc.ref, {
          items: nextItems,
          sermonIds: deriveSermonIdsFromItems(nextItems),
          seriesKind: inferSeriesKind(nextItems),
          'rev.items': FieldValue.increment(1),
          updatedAt: new Date().toISOString(),
        });
      });

      transaction.delete(sermonRef);
    });
  }
}

export const seriesRepository = new SeriesRepository();
