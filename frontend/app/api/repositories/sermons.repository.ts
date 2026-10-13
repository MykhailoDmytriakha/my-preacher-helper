
import { adminDb, FieldValue } from '@/config/firebaseAdminConfig';
import { isDataEngineRequired, updateLegacyDocument } from '@/data-engine/legacyBoundary.server';
import { Sermon, SermonPoint } from '@/models/models';

// Error message constants
const ERROR_MESSAGES = {
  SERMON_NOT_FOUND: "Sermon not found",
} as const;

/**
 * Repository for user settings database operations
 */
export class SermonsRepository {
  private readonly collection = "sermons";

  async fetchSermonById(id: string) {
    console.log(`Firestore: fetching sermon ${id}`);
    try {
      // Use the Admin SDK to fetch the sermon
      const docRef = adminDb.collection("sermons").doc(id);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.error(`Sermon with id ${id} not found in Firestore`);
        throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
      }
      const rawData = docSnap.data() as Sermon;
      const normalized: Sermon = {
        ...rawData,
        id: docSnap.id,
      };

      const hydratedStructure = rawData.thoughtsBySection || rawData.structure;
      if (hydratedStructure) {
        normalized.thoughtsBySection = hydratedStructure;
        normalized.structure = rawData.structure || hydratedStructure;
      }

      const hydratedDraft = rawData.draft || rawData.plan;
      if (hydratedDraft) {
        normalized.draft = hydratedDraft;
        normalized.plan = rawData.plan || hydratedDraft;
      }

      console.log(`Sermon retrieved: with id ${normalized.id} and title ${normalized.title}`);
      return normalized;
    } catch (error) {
      console.error(`Error fetching sermon with id ${id}:`, error);
      throw error;
    }
  }

  /**
   * @param aggregate which editable aggregate this write touches. Server writes go
   * around the client guard, so if they change data WITHOUT advancing the counter
   * it starts to lie: a later client save built from an older text then looks up to
   * date and is granted permission to overwrite what the server just stored.
   * Passing the aggregate keeps the counter truthful across both sides.
   */
  async updateSermonData(
    id: string,
    updateData: Record<string, unknown>,
    aggregate?: string
  ): Promise<void> {
    console.log(`Firestore: updating sermon data ${id}`);
    try {
      const docRef = adminDb.collection(this.collection).doc(id);

      // Inject the server timestamp for updatedAt
      const dataWithTimestamp = {
        ...updateData,
        ...(aggregate ? { [`rev.${aggregate}`]: FieldValue.increment(1) } : {}),
        updatedAt: new Date().toISOString()
      };

      await updateLegacyDocument(docRef, dataWithTimestamp);
      console.log(`Firestore: updated sermon data ${id} successfully`);
    } catch (error) {
      // An engine-owned document refuses the legacy road by design; the caller takes the engine one.
      if (!isDataEngineRequired(error)) console.error(`Error updating sermon data for ${id}:`, error);
      throw error;
    }
  }

  async fetchSermonOutlineBySermonId(sermonId: string) {
    console.log(`Fetching sermon outline for sermon ${sermonId}`);
    try {
      const docRef = adminDb.collection("sermons").doc(sermonId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.error(`Sermon with id ${sermonId} not found in Firestore`);
        throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
      }

      const sermon = docSnap.data() as Sermon;
      console.log(`Sermon outline retrieved for sermon id ${sermonId}`);
      return sermon.outline || {};
    } catch (error) {
      console.error(`Error fetching sermon outline with id ${sermonId}:`, error);
      throw error;
    }
  }

  /**
   * Fetches adjacent outline points (previous and next) for a given outline point.
   * This is used to provide context for AI generation.
   */
  async fetchAdjacentOutlinePoints(sermonId: string, outlinePointId: string) {
    console.log(`Fetching adjacent outline points for point ${outlinePointId} in sermon ${sermonId}`);
    try {
      const sermon = await this.fetchSermonById(sermonId);
      if (!sermon || !sermon.outline) return null;

      // Helper to find point in a specific section list
      const findInList = (list: SermonPoint[]) => list.findIndex(op => op.id === outlinePointId);

      // Check each section
      let section: 'introduction' | 'main' | 'conclusion' | null = null;
      let index = -1;
      let list: SermonPoint[] = [];

      if ((index = findInList(sermon.outline.introduction)) !== -1) {
        section = 'introduction';
        list = sermon.outline.introduction;
      } else if ((index = findInList(sermon.outline.main)) !== -1) {
        section = 'main';
        list = sermon.outline.main;
      } else if ((index = findInList(sermon.outline.conclusion)) !== -1) {
        section = 'conclusion';
        list = sermon.outline.conclusion;
      }

      if (!section) return null;

      const previousPoint = index > 0 ? list[index - 1] : null;
      const nextPoint = index < list.length - 1 ? list[index + 1] : null;

      // If at boundary of a section, we could technically fetch from adjacent sections,
      // but for now, let's stick to within-section context to keep it simple.

      return {
        previousPoint: previousPoint ? { text: previousPoint.text } : null,
        nextPoint: nextPoint ? { text: nextPoint.text } : null,
        section
      };
    } catch (error) {
      console.error(`Error fetching adjacent points for ${outlinePointId}:`, error);
      return null;
    }
  }
}

// Export singleton instance
export const sermonsRepository = new SermonsRepository(); 
