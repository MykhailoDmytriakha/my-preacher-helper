import { adminDb } from '@/config/firebaseAdminConfig';
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
      await adminDb.collection(this.collection).doc(seriesId).delete();
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
      const seriesSnapshot = await adminDb.collection(this.collection)
        .where('sermonIds', 'array-contains', sermonId)
        .get();

      if (seriesSnapshot.empty) {
        console.log(`No series found containing sermon ${sermonId}`);
        return;
      }

      // Update each series to remove the sermon ID
      const updatePromises = seriesSnapshot.docs.map(async (doc) => {
        const series = this.hydrateSeries({ id: doc.id, ...doc.data() } as Series);
        if (series.userId !== ownerUid) {
          return;
        }
        const nextItems = removeSeriesItemByRef(series.items || [], { type: 'sermon', refId: sermonId });
        const nextSermonIds = deriveSermonIdsFromItems(nextItems);

        await doc.ref.update({
          items: nextItems,
          sermonIds: nextSermonIds,
          seriesKind: inferSeriesKind(nextItems),
          updatedAt: new Date().toISOString()
        });

        console.log(`Removed sermon ${sermonId} from series ${doc.id}`);
      });

      await Promise.all(updatePromises);
      console.log(`Successfully removed sermon ${sermonId} from ${seriesSnapshot.docs.length} series`);

    } catch (error) {
      console.error(`Error removing sermon ${sermonId} from series:`, error);
      throw error;
    }
  }

  /**
   * Atomically deletes a sermon AND detaches it from every one of the owner's series in a
   * SINGLE write batch — all-or-nothing. Either everything commits or nothing does, so a
   * delete can never leave a series pointing at a non-existent sermon (the previous flow
   * deleted the sermon first and swallowed a failed cleanup, returning 200 with dangling
   * refs). Foreign-owned series are never touched.
   */
  async deleteSermonAndDetachFromAllSeries(sermonId: string, ownerUid: string): Promise<void> {
    const seriesSnapshot = await adminDb.collection(this.collection)
      .where('sermonIds', 'array-contains', sermonId)
      .get();

    const batch = adminDb.batch();

    seriesSnapshot.docs.forEach((doc) => {
      const series = this.hydrateSeries({ id: doc.id, ...doc.data() } as Series);
      if (series.userId !== ownerUid) {
        return; // never mutate a foreign-owned series
      }
      const nextItems = removeSeriesItemByRef(series.items || [], { type: 'sermon', refId: sermonId });
      batch.update(doc.ref, {
        items: nextItems,
        sermonIds: deriveSermonIdsFromItems(nextItems),
        seriesKind: inferSeriesKind(nextItems),
        updatedAt: new Date().toISOString(),
      });
    });

    batch.delete(adminDb.collection('sermons').doc(sermonId));

    // One commit: series detach + sermon delete land together, or not at all.
    await batch.commit();
  }

  async removeGroupFromAllSeries(groupId: string, ownerUid: string): Promise<void> {
    console.log(`Firestore: removing group ${groupId} from owner ${ownerUid}'s series`);

    try {
      const snapshot = await adminDb.collection(this.collection).get();
      const candidates = snapshot.docs
        .map((doc) => ({ id: doc.id, data: this.hydrateSeries({ id: doc.id, ...doc.data() } as Series), ref: doc.ref }))
        .filter((entry) => entry.data.userId === ownerUid)
        .filter((entry) => (entry.data.items || []).some((item) => item.type === 'group' && item.refId === groupId));

      if (candidates.length === 0) {
        console.log(`No series found containing group ${groupId}`);
        return;
      }

      await Promise.all(
        candidates.map(async ({ ref, data, id }) => {
          const nextItems = removeSeriesItemByRef(data.items || [], { type: 'group', refId: groupId });
          await ref.update({
            items: nextItems,
            sermonIds: deriveSermonIdsFromItems(nextItems),
            seriesKind: inferSeriesKind(nextItems),
            updatedAt: new Date().toISOString(),
          });
          console.log(`Removed group ${groupId} from series ${id}`);
        })
      );
    } catch (error) {
      console.error(`Error removing group ${groupId} from all series:`, error);
      throw error;
    }
  }
}

// Export singleton instance
export const seriesRepository = new SeriesRepository();
