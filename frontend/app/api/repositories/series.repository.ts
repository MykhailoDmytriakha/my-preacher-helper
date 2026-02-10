import { adminDb } from '@/config/firebaseAdminConfig';
import { Series } from '@/models/models';
import {
  deriveSermonIdsFromItems,
  inferSeriesKind,
  normalizeSeriesItems,
  removeSeriesItemByRef,
  reorderSeriesItemsById,
  upsertSeriesItem,
} from '@/utils/seriesItems';

/**
 * Repository for series database operations
 */
export class SeriesRepository {
  /**
   * Filters out undefined values from an object as Firestore doesn't accept them
   */
  private filterUndefinedValues<T extends Record<string, unknown>>(obj: T): T {
    return Object.fromEntries(
      Object.entries(obj).filter(([, value]) => value !== undefined)
    ) as T;
  }
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

  private async persistSeriesItems(seriesId: string, itemsInput: Series['items']) {
    const items = normalizeSeriesItems(itemsInput);
    const sermonIds = deriveSermonIdsFromItems(items);
    const seriesKind = inferSeriesKind(items);

    await adminDb.collection(this.collection).doc(seriesId).update({
      items,
      sermonIds,
      seriesKind,
      updatedAt: new Date().toISOString(),
    });

    return { items, sermonIds, seriesKind };
  }

  async createSeries(series: Omit<Series, 'id' | 'createdAt' | 'updatedAt'>): Promise<Series> {
    console.log(`Firestore: creating series for user ${series.userId}`);

    try {
      const now = new Date().toISOString();

      const normalizedItems = normalizeSeriesItems(series.items, series.sermonIds || []);
      const seriesKind = series.seriesKind || inferSeriesKind(normalizedItems);
      const sermonIds = deriveSermonIdsFromItems(normalizedItems);

      // Filter out undefined values as Firestore doesn't accept them
      const cleanSeries = this.filterUndefinedValues({
        ...series,
        items: normalizedItems,
        sermonIds,
        seriesKind,
      });

      const docRef = await adminDb.collection(this.collection).add({
        ...cleanSeries,
        createdAt: now,
        updatedAt: now
      });

      const newSeries = this.hydrateSeries({
        ...series,
        id: docRef.id,
        createdAt: now,
        updatedAt: now,
        items: normalizedItems,
        sermonIds,
        seriesKind,
      } as Series);
      console.log(`Series created with id: ${newSeries.id}`);
      return newSeries;
    } catch (error) {
      console.error('Error creating series:', error);
      throw error;
    }
  }

  async fetchSeriesByUserId(userId: string): Promise<Series[]> {
    console.log(`Firestore: fetching series for user ${userId}`);

    try {
      const snapshot = await adminDb.collection(this.collection)
        .where('userId', '==', userId)
        .get();

      const series: Series[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Series)).map((entry) => this.hydrateSeries(entry));

      // Sort client-side by startDate (desc) to avoid composite index requirement
      series.sort((a, b) => {
        const aDate = a.startDate ? new Date(a.startDate).getTime() : 0;
        const bDate = b.startDate ? new Date(b.startDate).getTime() : 0;
        return bDate - aDate;
      });

      console.log(`Retrieved ${series.length} series for user ${userId}`);
      return series;
    } catch (error) {
      console.error(`Error fetching series for user ${userId}:`, error);
      throw error;
    }
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

  async updateSeries(seriesId: string, updates: Partial<Series>): Promise<void> {
    console.log(`Firestore: updating series ${seriesId}`);

    try {
      const existing = await this.fetchSeriesById(seriesId);
      if (!existing) {
        throw new Error(`Series ${seriesId} not found`);
      }

      const hasItemLevelUpdate = updates.items !== undefined || updates.sermonIds !== undefined;
      const normalizedItems = hasItemLevelUpdate
        ? normalizeSeriesItems(updates.items, updates.sermonIds || existing.sermonIds || [])
        : existing.items || normalizeSeriesItems(undefined, existing.sermonIds || []);

      const cleanUpdates = this.filterUndefinedValues({
        ...updates,
        ...(hasItemLevelUpdate
          ? {
              items: normalizedItems,
              sermonIds: deriveSermonIdsFromItems(normalizedItems),
              seriesKind: updates.seriesKind || inferSeriesKind(normalizedItems),
            }
          : {}),
      });

      await adminDb.collection(this.collection).doc(seriesId).update({
        ...cleanUpdates,
        updatedAt: new Date().toISOString()
      });

      console.log(`Series ${seriesId} updated successfully`);
    } catch (error) {
      console.error(`Error updating series ${seriesId}:`, error);
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

  async addSermonToSeries(seriesId: string, sermonId: string, position?: number): Promise<void> {
    console.log(`Firestore: adding sermon ${sermonId} to series ${seriesId}`);

    try {
      const seriesDoc = await adminDb.collection(this.collection).doc(seriesId).get();

      if (!seriesDoc.exists) {
        throw new Error(`Series ${seriesId} not found`);
      }

      const series = this.hydrateSeries({ id: seriesDoc.id, ...seriesDoc.data() } as Series);
      const items = upsertSeriesItem(series.items || [], {
        type: 'sermon',
        refId: sermonId,
        position,
      });

      await this.persistSeriesItems(seriesId, items);
      console.log(`Sermon ${sermonId} added to series ${seriesId}`);
    } catch (error) {
      console.error(`Error adding sermon ${sermonId} to series ${seriesId}:`, error);
      throw error;
    }
  }

  async addGroupToSeries(seriesId: string, groupId: string, position?: number): Promise<void> {
    console.log(`Firestore: adding group ${groupId} to series ${seriesId}`);

    try {
      const seriesDoc = await adminDb.collection(this.collection).doc(seriesId).get();

      if (!seriesDoc.exists) {
        throw new Error(`Series ${seriesId} not found`);
      }

      const series = this.hydrateSeries({ id: seriesDoc.id, ...seriesDoc.data() } as Series);
      const items = upsertSeriesItem(series.items || [], {
        type: 'group',
        refId: groupId,
        position,
      });

      await this.persistSeriesItems(seriesId, items);
      console.log(`Group ${groupId} added to series ${seriesId}`);
    } catch (error) {
      console.error(`Error adding group ${groupId} to series ${seriesId}:`, error);
      throw error;
    }
  }

  async removeSermonFromSeries(seriesId: string, sermonId: string): Promise<void> {
    console.log(`Firestore: removing sermon ${sermonId} from series ${seriesId}`);

    try {
      const seriesDoc = await adminDb.collection(this.collection).doc(seriesId).get();

      if (!seriesDoc.exists) {
        throw new Error(`Series ${seriesId} not found`);
      }

      const series = this.hydrateSeries({ id: seriesDoc.id, ...seriesDoc.data() } as Series);
      const items = removeSeriesItemByRef(series.items || [], { type: 'sermon', refId: sermonId });

      await this.persistSeriesItems(seriesId, items);
      console.log(`Sermon ${sermonId} removed from series ${seriesId}`);
    } catch (error) {
      console.error(`Error removing sermon ${sermonId} from series ${seriesId}:`, error);
      throw error;
    }
  }

  async removeGroupFromSeries(seriesId: string, groupId: string): Promise<void> {
    console.log(`Firestore: removing group ${groupId} from series ${seriesId}`);

    try {
      const seriesDoc = await adminDb.collection(this.collection).doc(seriesId).get();

      if (!seriesDoc.exists) {
        throw new Error(`Series ${seriesId} not found`);
      }

      const series = this.hydrateSeries({ id: seriesDoc.id, ...seriesDoc.data() } as Series);
      const items = removeSeriesItemByRef(series.items || [], { type: 'group', refId: groupId });

      await this.persistSeriesItems(seriesId, items);
      console.log(`Group ${groupId} removed from series ${seriesId}`);
    } catch (error) {
      console.error(`Error removing group ${groupId} from series ${seriesId}:`, error);
      throw error;
    }
  }

  async reorderSermonsInSeries(seriesId: string, sermonIds: string[]): Promise<void> {
    console.log(`Firestore: reordering sermons in series ${seriesId}`);

    try {
      // Validate that all sermonIds are strings
      if (!Array.isArray(sermonIds) || !sermonIds.every(id => typeof id === 'string')) {
        throw new Error('Invalid sermonIds array');
      }

      const series = await this.fetchSeriesById(seriesId);
      if (!series) {
        throw new Error(`Series ${seriesId} not found`);
      }

      const normalizedItems = normalizeSeriesItems(series.items, series.sermonIds || []);
      const sermonItems = normalizedItems.filter((item) => item.type === 'sermon');
      const sermonItemMap = new Map(sermonItems.map((item) => [item.refId, item]));

      const orderedSermonItems = sermonIds
        .map((sermonId) => sermonItemMap.get(sermonId))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      for (const item of sermonItems) {
        if (!orderedSermonItems.find((candidate) => candidate.id === item.id)) {
          orderedSermonItems.push(item);
        }
      }

      let sermonCursor = 0;
      const merged = normalizedItems.map((item) => {
        if (item.type !== 'sermon') return item;
        const next = orderedSermonItems[sermonCursor];
        sermonCursor += 1;
        return next ?? item;
      });

      const reorderedWithFreshPositions = merged.map((item, index) => ({
        ...item,
        position: index + 1,
      }));

      await this.persistSeriesItems(seriesId, reorderedWithFreshPositions);
      console.log(`Sermons reordered in series ${seriesId}`);
    } catch (error) {
      console.error(`Error reordering sermons in series ${seriesId}:`, error);
      throw error;
    }
  }

  async reorderSeriesItems(seriesId: string, itemIds: string[]): Promise<void> {
    console.log(`Firestore: reordering mixed items in series ${seriesId}`);

    try {
      const series = await this.fetchSeriesById(seriesId);
      if (!series) {
        throw new Error(`Series ${seriesId} not found`);
      }

      const reordered = reorderSeriesItemsById(series.items || [], itemIds);
      await this.persistSeriesItems(seriesId, reordered);
      console.log(`Mixed items reordered in series ${seriesId}`);
    } catch (error) {
      console.error(`Error reordering mixed items in series ${seriesId}:`, error);
      throw error;
    }
  }

  /**
   * Removes a sermon ID from all series that contain it
   * This is called when a sermon is deleted to maintain referential integrity
   */
  async removeSermonFromAllSeries(sermonId: string): Promise<void> {
    console.log(`Firestore: removing sermon ${sermonId} from all series`);

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

  async removeGroupFromAllSeries(groupId: string): Promise<void> {
    console.log(`Firestore: removing group ${groupId} from all series`);

    try {
      const snapshot = await adminDb.collection(this.collection).get();
      const candidates = snapshot.docs
        .map((doc) => ({ id: doc.id, data: this.hydrateSeries({ id: doc.id, ...doc.data() } as Series), ref: doc.ref }))
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
