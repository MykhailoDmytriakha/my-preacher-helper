import { adminDb, FieldValue } from '@/config/firebaseAdminConfig';
import { Sermon, SermonOutline, SermonDraft, SermonPoint, PreachDate } from '@/models/models';

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

  async updateSermonOutline(sermonId: string, outline: SermonOutline): Promise<SermonOutline> {
    console.log(`Updating sermon outline for sermon ${sermonId}`);
    try {
      const docRef = adminDb.collection("sermons").doc(sermonId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.error(`Sermon with id ${sermonId} not found in Firestore`);
        throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
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
        throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
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

  async updateSermonSeriesInfo(sermonId: string, seriesId: string | null, position: number | null): Promise<void> {
    console.log(`Updating sermon series info for sermon ${sermonId}`);

    try {
      const docRef = adminDb.collection("sermons").doc(sermonId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.error(`Sermon with id ${sermonId} not found in Firestore`);
        throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
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

  async addPreachDate(sermonId: string, preachDate: Omit<PreachDate, 'id' | 'createdAt'>): Promise<PreachDate> {
    console.log(`Firestore: adding preach date to sermon ${sermonId}`);
    try {
      const docRef = adminDb.collection(this.collection).doc(sermonId);
      const newPreachDate: PreachDate = {
        ...preachDate,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString()
      };

      await docRef.update({
        preachDates: FieldValue.arrayUnion(newPreachDate) as any
      });

      console.log(`Firestore: added preach date ${newPreachDate.id} to sermon ${sermonId}`);
      return newPreachDate;
    } catch (error) {
      console.error(`Error adding preach date to sermon ${sermonId}:`, error);
      throw error;
    }
  }

  async updatePreachDate(sermonId: string, dateId: string, updates: Partial<PreachDate>): Promise<PreachDate> {
    console.log(`Firestore: updating preach date ${dateId} for sermon ${sermonId}`);
    try {
      const docRef = adminDb.collection(this.collection).doc(sermonId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
      }

      const sermon = docSnap.data() as Sermon;
      const preachDates = sermon.preachDates || [];
      const index = preachDates.findIndex(pd => pd.id === dateId);

      if (index === -1) {
        throw new Error("Preach date not found");
      }

      const updatedPreachDate: PreachDate = {
        ...preachDates[index],
        ...updates,
        id: preachDates[index].id, // Ensure ID and createdAt are not changed
        createdAt: preachDates[index].createdAt
      };

      const updatedArray = [...preachDates];
      updatedArray[index] = updatedPreachDate;

      await docRef.update({ preachDates: updatedArray });
      console.log(`Firestore: updated preach date ${dateId} for sermon ${sermonId}`);
      return updatedPreachDate;
    } catch (error) {
      console.error(`Error updating preach date ${dateId} for sermon ${sermonId}:`, error);
      throw error;
    }
  }

  async deletePreachDate(sermonId: string, dateId: string): Promise<void> {
    console.log(`Firestore: deleting preach date ${dateId} from sermon ${sermonId}`);
    try {
      const docRef = adminDb.collection(this.collection).doc(sermonId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        throw new Error(ERROR_MESSAGES.SERMON_NOT_FOUND);
      }

      const sermon = docSnap.data() as Sermon;
      const preachDates = sermon.preachDates || [];
      const updatedArray = preachDates.filter(pd => pd.id !== dateId);

      await docRef.update({ preachDates: updatedArray });
      console.log(`Firestore: deleted preach date ${dateId} from sermon ${sermonId}`);
    } catch (error) {
      console.error(`Error deleting preach date ${dateId} from sermon ${sermonId}:`, error);
      throw error;
    }
  }

  async fetchSermonsWithPreachDates(userId: string, startDate?: string, endDate?: string): Promise<Sermon[]> {
    console.log(`Firestore: fetching sermons with preach dates for user ${userId}`);
    try {
      const query = adminDb.collection(this.collection).where("userId", "==", userId);

      const snapshot = await query.get();
      let sermons: Sermon[] = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as Sermon[];

      // Hydrate structure and draft for all fetched sermons
      sermons = sermons.map(s => {
        const hydrated: Sermon = { ...s };
        const hydratedStructure = s.thoughtsBySection || s.structure;
        if (hydratedStructure) {
          hydrated.thoughtsBySection = hydratedStructure;
          hydrated.structure = s.structure || hydratedStructure;
        }
        const hydratedDraft = s.draft || s.plan;
        if (hydratedDraft) {
          hydrated.draft = hydratedDraft;
          hydrated.plan = s.plan || hydratedDraft;
        }
        return hydrated;
      });

      // Simple filtering in memory for now because Firestore array filtering is limited
      // and we expect small number of sermons per user
      if (startDate || endDate) {
        sermons = sermons.filter(s => {
          if (!s.preachDates?.length) return false;
          return s.preachDates.some(pd => {
            const date = pd.date; // YYYY-MM-DD
            if (startDate && date < startDate) return false;
            if (endDate && date > endDate) return false;
            return true;
          });
        });
      }

      console.log(`Firestore: fetched ${sermons.length} sermons for user ${userId}`);
      return sermons;
    } catch (error) {
      console.error(`Error fetching sermons for user ${userId}:`, error);
      throw error;
    }
  }
}

// Export singleton instance
export const sermonsRepository = new SermonsRepository(); 
