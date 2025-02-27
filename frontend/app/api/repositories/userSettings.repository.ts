import { adminDb } from 'app/config/firebaseAdminConfig';
import { UserSettings } from '@/models/models';

/**
 * Repository for user settings database operations
 */
export class UserSettingsRepository {
  private readonly collection = "userSettings";
  
  /**
   * Get user settings by userId
   * @param userId User ID
   * @returns User settings or null if not found
   */
  async getByUserId(userId: string): Promise<UserSettings | null> {
    try {
      const settingsRef = adminDb.collection(this.collection);
      const querySnapshot = await settingsRef
        .where("userId", "==", userId)
        .limit(1)
        .get();
        
      if (querySnapshot.empty) {
        return null;
      }
      
      return { 
        id: querySnapshot.docs[0].id, 
        ...querySnapshot.docs[0].data() 
      } as UserSettings;
    } catch (error) {
      console.error('Error fetching user settings:', error);
      throw error;
    }
  }
  
  /**
   * Create or update user settings
   * @param userId User ID
   * @param language Preferred language
   * @returns ID of the created or updated document
   */
  async createOrUpdate(userId: string, language: string = 'en'): Promise<string> {
    try {
      const settingsRef = adminDb.collection(this.collection);
      const querySnapshot = await settingsRef
        .where("userId", "==", userId)
        .limit(1)
        .get();
      
      if (querySnapshot.empty) {
        // Create new settings
        const newSettings = {
          userId,
          language
        };
        
        const docRef = await settingsRef.add(newSettings);
        return docRef.id;
      } else {
        // Update existing settings
        const settingsDoc = querySnapshot.docs[0];
        await settingsRef.doc(settingsDoc.id).update({ language });
        return settingsDoc.id;
      }
    } catch (error) {
      console.error('Error creating/updating user settings:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const userSettingsRepository = new UserSettingsRepository(); 