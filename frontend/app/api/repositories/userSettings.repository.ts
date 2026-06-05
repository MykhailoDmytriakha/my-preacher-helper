import { adminDb } from '@/config/firebaseAdminConfig';
import { UserSettings } from '@/models/models';

/**
 * Fields a client may create/update on their own settings document.
 * Intentionally excludes identity (id/userId) and privilege (isAdmin).
 */
export type UserSettingsUpdate = Partial<Omit<UserSettings, 'id' | 'userId' | 'isAdmin'>>;

const UPDATABLE_FIELDS: (keyof UserSettingsUpdate)[] = [
  'language',
  'email',
  'displayName',
  'firstDayOfWeek',
  'enablePrepMode',
  'enableAudioGeneration',
  'enableStructurePreview',
  'enableGroups',
  'showAppVersion',
];

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
   * Create or update a user's settings document. Only whitelisted fields that
   * are explicitly provided (not undefined) are written, so a partial update
   * never clobbers unrelated fields (e.g. isAdmin).
   * @param userId User ID
   * @param updates Partial settings to apply
   * @returns ID of the created or updated document
   */
  async createOrUpdate(userId: string, updates: UserSettingsUpdate): Promise<string> {
    try {
      const docRef = adminDb.collection(this.collection).doc(userId);
      const doc = await docRef.get();

      const allowedUpdates: Record<string, unknown> = {};
      for (const field of UPDATABLE_FIELDS) {
        if (updates[field] !== undefined) {
          allowedUpdates[field] = updates[field];
        }
      }

      // If no fields to update, return early
      if (Object.keys(allowedUpdates).length === 0) {
        console.log("No fields to update for user:", userId);
        return userId;
      }

      console.log("Updating user settings for user:", userId, "with updates:", allowedUpdates);

      if (!doc.exists) {
        // For new documents, ensure language is always set.
        if (allowedUpdates.language === undefined) {
          allowedUpdates.language = 'en';
        }
        await docRef.set(allowedUpdates);
        return userId;
      }

      // Update existing settings, preserving all other fields including isAdmin.
      await docRef.update(allowedUpdates);
      return userId;
    } catch (error) {
      console.error('Error creating/updating user settings:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const userSettingsRepository = new UserSettingsRepository();
