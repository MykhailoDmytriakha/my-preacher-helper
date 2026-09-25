import { FieldValue } from 'firebase-admin/firestore';

import { adminDb } from '@/config/firebaseAdminConfig';
import { deleteLegacyDocument, runLegacyTransaction } from '@/data-engine/legacyBoundary.server';
import { Series } from '@/models/models';
import {
  deriveSermonIdsFromItems,
  inferSeriesKind,
  normalizeSeriesItems,
  removeSeriesItemByRef,
} from '@/utils/seriesItems';

/**
 * Repository for series database operations
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

  async fetchSeriesById(seriesId: string): Promise<Series | null> {
    console.log(`Firestore: fetching series ${seriesId}`);

    try {
      const docSnap = await adminDb.collection(this.collection).doc(seriesId).get();

      if (!docSnap.exists) {
        console.error(`Series with id ${seriesId} not found in Firestore`);
        return null;
      }

      const series = this.hydrateSeries({ id: docSnap.id, ...docSnap.data() } as Series);
      console.log(`Series retrieved: ${series.id} - ${series.title}`);
      return series;
    } catch (error) {
      console.error(`Error fetching series with id ${seriesId}:`, error);
      throw error;
    }
  }

  async deleteSeries(seriesId: string): Promise<void> {
    console.log(`Firestore: deleting series ${seriesId}`);

    try {
      await deleteLegacyDocument(adminDb.collection(this.collection).doc(seriesId));
      console.log(`Series ${seriesId} deleted successfully`);
    } catch (error) {
      console.error(`Error deleting series ${seriesId}:`, error);
      throw error;
    }
  }

  /**
   * Removes a sermon ID from the owner's series that contain it.
   * This is called when a sermon is deleted to maintain referential integrity
   */
  async removeSermonFromAllSeries(sermonId: string, ownerUid: string): Promise<void> {
    console.log(`Firestore: removing sermon ${sermonId} from owner ${ownerUid}'s series`);

    try {
      // Find all series that contain this sermon
      const query = adminDb.collection(this.collection).where('userId', '==', ownerUid)
        .where('sermonIds', 'array-contains', sermonId).limit(101);
      await runLegacyTransaction(async transaction => {
        const snapshot = await transaction.get(query);
        for (const doc of snapshot.docs) {
          const series = this.hydrateSeries({ id: doc.id, ...doc.data() } as Series);
          if (series.userId !== ownerUid) continue;
          const items = removeSeriesItemByRef(series.items || [], { type: 'sermon', refId: sermonId });
          transaction.update(doc.ref, { items, sermonIds: deriveSermonIdsFromItems(items), seriesKind: inferSeriesKind(items),
            'rev.items': FieldValue.increment(1), updatedAt: new Date().toISOString() });
        }
      });

    } catch (error) {
      console.error(`Error removing sermon ${sermonId} from series:`, error);
      throw error;
    }
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

  /** Refuse the entire legacy cascade if any participant now belongs to DataEngine. */
  async deleteSeriesAndDetach(seriesId: string, ownerUid: string): Promise<void> {
    const seriesRef = adminDb.collection(this.collection).doc(seriesId);
    await runLegacyTransaction(async transaction => {
      const snapshot = await transaction.get(seriesRef);
      if (!snapshot.exists) return;
      const raw = snapshot.data()!;
      if (raw.userId !== ownerUid) throw Object.assign(new Error('Forbidden'), { code: 'permission-denied' });
      const series = this.hydrateSeries({ ...raw, id: snapshot.id } as Series);
      const refs = new Map<string, { collection: string; id: string }>();
      for (const item of series.items || []) {
        const collection = item.type === 'sermon' ? 'sermons' : 'groups';
        refs.set(`${collection}/${item.refId}`, { collection, id: item.refId });
      }
      if (refs.size > 99) throw Object.assign(new Error('Legacy cascade exceeds its atomic write budget'), { code: 'data-engine-required' });
      const targets = await Promise.all([...refs.values()].map(value => transaction.get(adminDb.collection(value.collection).doc(value.id))));
      for (const target of targets) {
        if (!target.exists || target.data()?.userId !== ownerUid) continue;
        // Only clear the back-reference that still belongs to the deleted series.
        if (target.data()?.seriesId && target.data()?.seriesId !== seriesId) continue;
        transaction.update(target.ref, { seriesId: null, seriesPosition: null });
      }
      transaction.delete(seriesRef);
    });
  }

  async removeGroupFromAllSeries(groupId: string, ownerUid: string): Promise<void> {
    console.log(`Firestore: removing group ${groupId} from owner ${ownerUid}'s series`);

    try {
      const ownerSeriesQuery = adminDb.collection(this.collection).where('userId', '==', ownerUid).limit(101);
      let removedFromCount = 0;
      await runLegacyTransaction(async (transaction) => {
        const snapshot = await transaction.get(ownerSeriesQuery);
        if (snapshot.docs.length > 100) throw Object.assign(new Error('Legacy cascade exceeds its atomic write budget'), { code: 'data-engine-required' });
        const candidates = snapshot.docs
          .map((doc) => ({ id: doc.id, data: this.hydrateSeries({ id: doc.id, ...doc.data() } as Series), ref: doc.ref }))
          .filter((entry) => entry.data.userId === ownerUid)
          .filter((entry) => (entry.data.items || []).some((item) => item.type === 'group' && item.refId === groupId));

        candidates.forEach(({ ref, data }) => {
          const nextItems = removeSeriesItemByRef(data.items || [], { type: 'group', refId: groupId });
          transaction.update(ref, {
            items: nextItems,
            sermonIds: deriveSermonIdsFromItems(nextItems),
            seriesKind: inferSeriesKind(nextItems),
            'rev.items': FieldValue.increment(1),
            updatedAt: new Date().toISOString(),
          });
        });

        removedFromCount = candidates.length;
      });

      // Log once, AFTER commit — never inside the retryable callback (retries would duplicate).
      console.log(
        removedFromCount === 0
          ? `No series found containing group ${groupId}`
          : `Removed group ${groupId} from ${removedFromCount} of the owner's series`
      );
    } catch (error) {
      console.error(`Error removing group ${groupId} from all series:`, error);
      throw error;
    }
  }
}

// Export singleton instance
export const seriesRepository = new SeriesRepository();
