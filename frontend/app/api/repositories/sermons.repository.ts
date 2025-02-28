import { adminDb } from 'app/config/firebaseAdminConfig';
import { Sermon } from '@/models/models';

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
}

// Export singleton instance
export const sermonsRepository = new SermonsRepository(); 