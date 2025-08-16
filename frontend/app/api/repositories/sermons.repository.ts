import { adminDb } from 'app/config/firebaseAdminConfig';
import { Sermon, Outline, Plan } from '@/models/models';

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
      const sermon = { id: docSnap.id, ...docSnap.data() } as Sermon;
      console.log(`Sermon retrieved: with id ${sermon.id} and title ${sermon.title}`);
      return sermon;
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

  async updateSermonOutline(sermonId: string, outline: Outline): Promise<Outline> {
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

  async updateSermonPlan(sermonId: string, plan: Plan): Promise<Plan> {
    console.log(`Updating sermon plan for sermon ${sermonId}`);
    console.log(`Plan data to update:`, JSON.stringify(plan, null, 2));
    
    // Validate plan structure before updating
    if (!plan || typeof plan !== 'object') {
      console.error('ERROR: Invalid plan data - plan is not an object');
      throw new Error('Invalid plan data');
    }
    
    if (!plan.introduction || !plan.main || !plan.conclusion) {
      console.error('ERROR: Invalid plan structure - missing required sections');
      throw new Error('Invalid plan structure');
    }
    
    if (typeof plan.introduction.outline !== 'string' || 
        typeof plan.main.outline !== 'string' || 
        typeof plan.conclusion.outline !== 'string') {
      console.error('ERROR: Invalid plan structure - outline values must be strings');
      throw new Error('Invalid plan structure - outline values must be strings');
    }
    
    try {
      const docRef = adminDb.collection("sermons").doc(sermonId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.error(`Sermon with id ${sermonId} not found in Firestore`);
        throw new Error("Sermon not found");
      }

      // Update the plan field in the sermon document
      await docRef.update({ plan });
      console.log(`Sermon plan updated for sermon id ${sermonId}`);
      
      return plan;
    } catch (error) {
      console.error(`Error updating sermon plan for sermon ${sermonId}:`, error);
      throw error;
    }
  }
}

// Export singleton instance
export const sermonsRepository = new SermonsRepository(); 