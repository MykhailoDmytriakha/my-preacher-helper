import { adminDb } from 'app/config/firebaseAdminConfig';
import { Sermon, SermonOutline, SermonDraft } from '@/models/models';

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
        throw new Error("Sermon not found");
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

      const hydratedDraft = (rawData as any).draft || (rawData as any).plan;
      if (hydratedDraft) {
        normalized.draft = hydratedDraft;
        normalized.plan = (rawData as any).plan || hydratedDraft;
      }

      console.log(`Sermon retrieved: with id ${normalized.id} and title ${normalized.title}`);
      return normalized;
    } catch (error) {
      console.error(`Error fetching sermon with id ${id}:`, error);
      throw error;
    }
  }
  
  async deleteSermonById(id: string): Promise<void> {
    console.log(`Firestore: deleting sermon ${id}`);
    try {
      // Use the Admin SDK to delete the sermon
      const docRef = adminDb.collection("sermons").doc(id);
      await docRef.delete();
      console.log(`Firestore: deleted sermon ${id}`);
    } catch (error) {
      console.error(`Error deleting sermon with id ${id}:`, error);
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
        throw new Error("Sermon not found");
      }

      const sermon = docSnap.data() as Sermon;
      console.log(`Sermon outline retrieved for sermon id ${sermonId}`);
      return sermon.outline || {};
    } catch (error) {
      console.error(`Error fetching sermon outline with id ${sermonId}:`, error);
      throw error;
    }
  }

  async updateSermonOutline(sermonId: string, outline: SermonOutline): Promise<SermonOutline> {
    console.log(`Updating sermon outline for sermon ${sermonId}`);
    try {
      const docRef = adminDb.collection("sermons").doc(sermonId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.error(`Sermon with id ${sermonId} not found in Firestore`);
        throw new Error("Sermon not found");
      }

      // Update the outline field in the sermon document
      await docRef.update({ outline });
      console.log(`Sermon outline updated for sermon id ${sermonId}`);
      
      return outline;
    } catch (error) {
      console.error(`Error updating sermon outline for sermon ${sermonId}:`, error);
      throw error;
    }
  }

  async updateSermonPlan(sermonId: string, draft: SermonDraft): Promise<SermonDraft> {
    console.log(`Updating sermon draft for sermon ${sermonId}`);
    console.log(`Draft data to update:`, JSON.stringify(draft, null, 2));
    
    // Validate plan structure before updating
    if (!draft || typeof draft !== 'object') {
      console.error('ERROR: Invalid draft data - draft is not an object');
      throw new Error('Invalid draft data');
    }
    
    if (!draft.introduction || !draft.main || !draft.conclusion) {
      console.error('ERROR: Invalid draft structure - missing required sections');
      throw new Error('Invalid draft structure');
    }
    
    if (typeof draft.introduction.outline !== 'string' || 
        typeof draft.main.outline !== 'string' || 
        typeof draft.conclusion.outline !== 'string') {
      console.error('ERROR: Invalid draft structure - outline values must be strings');
      throw new Error('Invalid draft structure - outline values must be strings');
    }
    
    try {
      const docRef = adminDb.collection("sermons").doc(sermonId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.error(`Sermon with id ${sermonId} not found in Firestore`);
        throw new Error("Sermon not found");
      }

      // Update both the new draft field and legacy plan for backward compatibility
      await docRef.update({ draft, plan: draft });
      console.log(`Sermon draft updated for sermon id ${sermonId}`);
      
      return draft;
    } catch (error) {
      console.error(`Error updating sermon plan for sermon ${sermonId}:`, error);
      throw error;
    }
  }

  async updateSermonSeriesInfo(sermonId: string, seriesId: string | null, position: number | null): Promise<void> {
    console.log(`Updating sermon series info for sermon ${sermonId}`);

    try {
      const docRef = adminDb.collection("sermons").doc(sermonId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.error(`Sermon with id ${sermonId} not found in Firestore`);
        throw new Error("Sermon not found");
      }

      // Prepare update data
      const updateData: { seriesId?: string | null; seriesPosition?: number | null } = {};

      if (seriesId !== undefined) {
        updateData.seriesId = seriesId;
      }

      if (position !== undefined) {
        updateData.seriesPosition = position;
      }

      if (Object.keys(updateData).length === 0) {
        console.log(`No series info updates needed for sermon ${sermonId}`);
        return;
      }

      // Update the sermon document
      await docRef.update(updateData);
      console.log(`Sermon series info updated for sermon id ${sermonId}`);
    } catch (error) {
      console.error(`Error updating sermon series info for sermon ${sermonId}:`, error);
      throw error;
    }
  }
}

// Export singleton instance
export const sermonsRepository = new SermonsRepository(); 
