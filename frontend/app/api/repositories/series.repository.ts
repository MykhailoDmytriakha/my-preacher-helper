import { adminDb } from '@/config/firebaseAdminConfig';
import { Series } from '@/models/models';

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

  async createSeries(series: Omit<Series, 'id' | 'createdAt' | 'updatedAt'>): Promise<Series> {
    console.log(`Firestore: creating series for user ${series.userId}`);

    try {
      const now = new Date().toISOString();

      // Filter out undefined values as Firestore doesn't accept them
      const cleanSeries = this.filterUndefinedValues(series);

      const docRef = await adminDb.collection(this.collection).add({
        ...cleanSeries,
        createdAt: now,
        updatedAt: now
      });

      const newSeries = { ...series, id: docRef.id, createdAt: now, updatedAt: now } as Series;
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
      } as Series));

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

      const series = { id: docSnap.id, ...docSnap.data() } as Series;
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
      // Filter out undefined values as Firestore doesn't accept them
      const cleanUpdates = this.filterUndefinedValues(updates);

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

      const series = seriesDoc.data() as Series;
      const currentSermonIds = series.sermonIds || [];

      // Remove sermon if already exists in the series
      const filteredIds = currentSermonIds.filter(id => id !== sermonId);

      // Add sermon at specific position or at the end
      const insertPosition = position !== undefined ? Math.min(position, filteredIds.length) : filteredIds.length;
      filteredIds.splice(insertPosition, 0, sermonId);

      await this.updateSeries(seriesId, { sermonIds: filteredIds });
      console.log(`Sermon ${sermonId} added to series ${seriesId} at position ${insertPosition}`);
    } catch (error) {
      console.error(`Error adding sermon ${sermonId} to series ${seriesId}:`, error);
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

      const series = seriesDoc.data() as Series;
      const updatedSermonIds = (series.sermonIds || []).filter(id => id !== sermonId);

      await this.updateSeries(seriesId, { sermonIds: updatedSermonIds });
      console.log(`Sermon ${sermonId} removed from series ${seriesId}`);
    } catch (error) {
      console.error(`Error removing sermon ${sermonId} from series ${seriesId}:`, error);
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

      await this.updateSeries(seriesId, { sermonIds });
      console.log(`Sermons reordered in series ${seriesId}: ${sermonIds.join(', ')}`);
    } catch (error) {
      console.error(`Error reordering sermons in series ${seriesId}:`, error);
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
        const series = doc.data() as Series;
        const updatedSermonIds = (series.sermonIds || []).filter(id => id !== sermonId);

        await doc.ref.update({
          sermonIds: updatedSermonIds,
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
}

// Export singleton instance
export const seriesRepository = new SeriesRepository();
