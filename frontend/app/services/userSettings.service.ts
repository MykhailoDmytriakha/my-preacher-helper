import { assertLegacyClientWriteAllowed } from '@/data-engine/clientPolicy';
import { UserSettings } from '@/models/models';
import { requestUserSettings } from '@/services/userSettingsTransport.client';
import { isBrowserOffline } from '@/utils/connectivity';
import { debugLog } from '@/utils/debugMode';
import { DEFAULT_LANGUAGE, COOKIE_LANG_KEY, COOKIE_MAX_AGE } from '@locales/constants';

import type { FirstDayOfWeek } from '@/utils/weekStart';

export interface ModelPreference {
  preferredProviderId: NonNullable<UserSettings['preferredProviderId']>;
  preferredModelId: string;
}

export type FunctionModelPreference = Pick<
  UserSettings,
  'preferredTranscription' | 'preferredText' | 'preferredTts'
>;

// Old persisted query mutations must never become a second writer after activation.
async function updateUserSettingsViaClient(userId: string, updates: Record<string, unknown>): Promise<void> {
  assertLegacyClientWriteAllowed('users');
  await requestUserSettings(userId, { operation: 'legacy', patch: updates });
}

/**
 * Get user language preference - optimized approach
 * Uses cookies for immediate access and DB as source of truth for authenticated users
 * 
 * @param userId The user ID
 * @returns The user's preferred language or default
 */
export async function getUserLanguage(userId: string): Promise<string> {
  try {
    if (isBrowserOffline()) {
      return getCookieLanguage();
    }
    // For guest users, only use cookies
    if (!userId) {
      return getCookieLanguage();
    }

    // For authenticated users
    // 1. First check cookie for instant response
    const cookieLang = getCookieLanguage();

    // 2. Then read from DB (source of truth)
    const settings = await requestUserSettings(userId);

    // 3. If DB has a value, use it (and update cookie if different)
    if (settings?.language) {
      const dbLang = settings.language;

      // Sync cookie with DB if they differ
      if (dbLang !== cookieLang) {
        setLanguageCookie(dbLang);
      }

      return dbLang;
    }

    // 4. If no DB setting but we have a cookie, persist cookie value to DB
    if (cookieLang !== DEFAULT_LANGUAGE) {
      await initializeUserSettings(userId, cookieLang);
    }

    return cookieLang;
  } catch (error) {
    console.error('Error getting user language:', error);
    // Fallback to cookie if DB access fails
    return getCookieLanguage();
  }
}

/**
 * Update user language preference
 * @param userId The user ID
 * @param language The language code (e.g., 'en', 'ru', 'uk')
 */
export async function updateUserLanguage(userId: string, language: string): Promise<void> {
  try {
    // Always update cookie first for immediate effect
    setLanguageCookie(language);

    // For guest users, we only use cookies
    if (!userId) {
      return;
    }

    // Private settings use the engine journal. The public selector has no workspace:
    // keep the cookie immediately, and make one bounded server attempt without replay.
    if (isBrowserOffline()) return;
    await requestUserSettings(userId, { operation: 'language', patch: { language } });
  } catch (error) {
    console.error('Error updating user language:', error);
    // Cookie is already updated, so user experience isn't affected
  }
}

/**
 * Update user profile information (email, displayName) without affecting language
 * @param userId The user ID
 * @param email User email
 * @param displayName User display name
 */
export async function updateUserProfile(
  userId: string,
  email?: string,
  displayName?: string
): Promise<void> {
  try {
    if (!userId) return;

    // Only update provided fields
    const updates: Record<string, unknown> = {};
    if (email !== undefined) updates.email = email;
    if (displayName !== undefined) updates.displayName = displayName;

    // Don't make the API call if there's nothing to update
    if (Object.keys(updates).length === 0) return;

    if (isBrowserOffline()) return;
    await requestUserSettings(userId, { operation: 'bootstrap', patch: updates });
  } catch (error) {
    console.error('Error updating user profile:', error);
  }
}

/**
 * Update user's preferred first day of week for app-controlled calendars.
 * @param userId The user ID
 * @param firstDayOfWeek Whether calendars should start on Sunday or Monday
 */
export async function updateFirstDayOfWeek(
  userId: string,
  firstDayOfWeek: FirstDayOfWeek
): Promise<void> {
  try {
    if (!userId) return;
    await updateUserSettingsViaClient(userId, { firstDayOfWeek });
  } catch (error) {
    console.error('Error updating first day of week:', error);
    throw error;
  }
}

/** Persist a text-model preference; entitlement remains server-controlled. */
export async function updateModelPreference(
  userId: string,
  preference: ModelPreference
): Promise<void> {
  try {
    if (!userId) return;
    await updateUserSettingsViaClient(userId, { ...preference });
  } catch (error) {
    console.error('Error updating model preference:', error);
    throw error;
  }
}

/** Persist one or more per-function model preferences; entitlement is still server-controlled. */
export async function updateFunctionModelPreference(
  userId: string,
  preference: FunctionModelPreference
): Promise<void> {
  try {
    if (!userId) return;
    await updateUserSettingsViaClient(userId, preference);
  } catch (error) {
    console.error('Error updating function model preference:', error);
    throw error;
  }
}

/**
 * Initialize user settings with default language
 * @param userId The user ID
 * @param language The language code (optional, defaults to system default)
 * @param email User email (optional)
 * @param displayName User display name (optional)
 */
export async function initializeUserSettings(
  userId: string,
  language?: string,
  email?: string,
  displayName?: string
): Promise<void> {
  try {
    if (!userId) return;

    const payload: Record<string, unknown> = {};
    if (language !== undefined) payload.language = language;
    if (email !== undefined) payload.email = email;
    if (displayName !== undefined) payload.displayName = displayName;
    if (language) setLanguageCookie(language);
    if (isBrowserOffline()) return;
    await requestUserSettings(userId, { operation: 'bootstrap', patch: payload });
  } catch (error) {
    console.error('Error initializing user settings:', error);
    // Still set cookie even if DB update fails
    if (language) {
      setLanguageCookie(language);
    }
  }
}

/**
 * Helper function to get language from cookie
 */
export function getCookieLanguage(): string {
  if (typeof document !== 'undefined') {
    return document.cookie.match(new RegExp(`${COOKIE_LANG_KEY}=([^;]+)`))?.[1] || DEFAULT_LANGUAGE;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Helper function to set language cookie
 */
export function setLanguageCookie(language: string): void {
  if (typeof document !== 'undefined') {
    document.cookie = `${COOKIE_LANG_KEY}=${language}; path=/; max-age=${COOKIE_MAX_AGE}`;
  }
}

/**
 * Get user settings
 * @param userId The user ID
 * @returns The user settings or null if not found
 */
export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  try {
    if (!userId) {
      return null;
    }
    return requestUserSettings(userId);
  } catch (error) {
    console.error('Error getting user settings:', error);
    throw error;
  }
}

/**
 * Update user's prep mode feature flag
 * @param userId The user ID
 * @param enabled Whether prep mode should be enabled
 */
export async function updatePrepModeAccess(userId: string, enabled: boolean): Promise<void> {
  try {
    if (!userId) return;
    await updateUserSettingsViaClient(userId, { enablePrepMode: enabled });
  } catch (error) {
    console.error('Error updating prep mode access:', error);
    throw error;
  }
}

/**
 * Check if user has access to prep mode
 * @param userId The user ID
 * @returns Boolean indicating if user has prep mode access
 */
export async function hasPrepModeAccess(userId: string): Promise<boolean> {
  try {
    debugLog('🔍 hasPrepModeAccess: called with userId:', userId);
    // For guest users (no userId): Always return true
    if (!userId) {
      debugLog('👤 hasPrepModeAccess: guest user, returning true');
      return true;
    }

    debugLog('👤 hasPrepModeAccess: authenticated user, fetching settings...');
    if (isBrowserOffline()) {
      return false;
    }
    // For authenticated users: check settings.enablePrepMode, default to false
    const settings = await getUserSettings(userId);
    debugLog('📊 hasPrepModeAccess: fetched settings:', settings);
    const access = settings?.enablePrepMode || false;
    debugLog('✅ hasPrepModeAccess: access result:', access);
    return access;
  } catch (error) {
    console.error('❌ hasPrepModeAccess: Error checking prep mode access:', error);
    // On error, default to false for authenticated users
    return false;
  }
}

/**
 * Update user's audio generation feature flag
 * @param userId The user ID
 * @param enabled Whether audio generation should be enabled
 */
export async function updateAudioGenerationAccess(userId: string, enabled: boolean): Promise<void> {
  try {
    if (!userId) return;
    await updateUserSettingsViaClient(userId, { enableAudioGeneration: enabled });
  } catch (error) {
    console.error('Error updating audio generation access:', error);
    throw error;
  }
}

/**
 * Update user's "show app version" display flag
 * @param userId The user ID
 * @param enabled Whether the deployed app version should be shown in Settings
 */
export async function updateShowAppVersion(userId: string, enabled: boolean): Promise<void> {
  try {
    if (!userId) return;
    await updateUserSettingsViaClient(userId, { showAppVersion: enabled });
  } catch (error) {
    console.error('Error updating show app version:', error);
    throw error;
  }
}

/**
 * Update user's groups workspace feature flag
 * @param userId The user ID
 * @param enabled Whether groups workspace should be enabled
 */
export async function updateGroupsAccess(userId: string, enabled: boolean): Promise<void> {
  try {
    if (!userId) return;
    await updateUserSettingsViaClient(userId, { enableGroups: enabled });
  } catch (error) {
    console.error('Error updating groups access:', error);
    throw error;
  }
}

/**
 * Check if user has access to groups workspace
 * @param userId The user ID
 * @returns Boolean indicating if user has groups workspace access
 */
export async function hasGroupsAccess(userId: string): Promise<boolean> {
  // Keep the legacy helper compatible without requiring the retired beta preference.
  return Boolean(userId);
}

/**
 * Update user's structure preview feature flag
 * @param userId The user ID
 * @param enabled Whether structure preview should be enabled
 */
export async function updateStructurePreviewAccess(userId: string, enabled: boolean): Promise<void> {
  try {
    if (!userId) return;
    await updateUserSettingsViaClient(userId, { enableStructurePreview: enabled });
  } catch (error) {
    console.error('Error updating structure preview access:', error);
    throw error;
  }
}

/**
 * Check if user has access to structure preview
 * @param userId The user ID
 * @returns Boolean indicating if user has structure preview access
 */
export async function hasStructurePreviewAccess(userId: string): Promise<boolean> {
  try {
    if (!userId) {
      return false; // Not accessible to guests by default
    }

    if (isBrowserOffline()) {
      return false;
    }

    const settings = await getUserSettings(userId);
    return settings?.enableStructurePreview || false;
  } catch (error) {
    console.error('Error checking structure preview access:', error);
    return false;
  }
}
