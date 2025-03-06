import { adminDb } from 'app/config/firebaseAdminConfig';
import { UserSettings } from '@/models/models';

/**
 * Repository for user settings database operations
 */
export class UserSettingsRepository {
  private readonly collection = "users";
  
  /**
   * Get user settings by userId
   * @param userId User ID
   * @returns User settings or null if not found
   */
  async getByUserId(userId: string): Promise<UserSettings | null> {
    try {
      const docRef = adminDb.collection(this.collection).doc(userId);
      const doc = await docRef.get();
        
      if (!doc.exists) {
        return null;
      }
      
      return { 
        id: doc.id, 
        ...doc.data() 
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
      const docRef = adminDb.collection(this.collection).doc(userId);
      const doc = await docRef.get();
      
      // Only update allowed fields (never isAdmin)
      const allowedUpdates = {
        language
      };
      console.log("Updating user settings for user:", userId, "with updates:", allowedUpdates);
      
      if (!doc.exists) {
        // Create new settings with userId as document ID
        await docRef.set(allowedUpdates);
        return userId;
      } else {
        // Update existing settings, preserving all other fields including isAdmin if it exists
        await docRef.update(allowedUpdates);
        return userId;
      }
    } catch (error) {
      console.error('Error creating/updating user settings:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const userSettingsRepository = new UserSettingsRepository(); 