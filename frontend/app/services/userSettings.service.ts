import { DEFAULT_LANGUAGE, COOKIE_LANG_KEY, COOKIE_MAX_AGE } from '@/../../frontend/locales/constants';
import { UserSettings } from '@/models/models';

// Constants for repeated strings
const USER_SETTINGS_API_URL = '/api/user/settings';

/**
 * Get user language preference - optimized approach
 * Uses cookies for immediate access and DB as source of truth for authenticated users
 * 
 * @param userId The user ID
 * @returns The user's preferred language or default
 */
export async function getUserLanguage(userId: string): Promise<string> {
  try {
    // For guest users, only use cookies
    if (!userId) {
      return getCookieLanguage();
    }
    
    // For authenticated users
    // 1. First check cookie for instant response
    const cookieLang = getCookieLanguage();
    
    // 2. Then fetch from DB (source of truth)
    const response = await fetch(`/api/user/settings?userId=${encodeURIComponent(userId)}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch user settings: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // 3. If DB has a value, use it (and update cookie if different)
    if (data.settings?.language) {
      const dbLang = data.settings.language;
      
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
    
    // For authenticated users, also update DB (source of truth)
    const response = await fetch(USER_SETTINGS_API_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, language }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to update user language: ${response.statusText}`);
    }
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
    
    // Update settings through API without specifying language
    const response = await fetch(USER_SETTINGS_API_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, ...updates }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to update user profile: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error updating user profile:', error);
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
    
    // Build request payload with only provided fields
    const payload: Record<string, unknown> = { userId };
    if (language !== undefined) payload.language = language;
    if (email !== undefined) payload.email = email; 
    if (displayName !== undefined) payload.displayName = displayName;
    
    // Create settings through API
    const response = await fetch(USER_SETTINGS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to initialize user settings: ${response.statusText}`);
    }
    
    // Only set language cookie if language was provided
    if (language) {
      setLanguageCookie(language);
    }
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

    const response = await fetch(`/api/user/settings?userId=${encodeURIComponent(userId)}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch user settings: ${response.statusText}`);
    }

    const data = await response.json();
    return data.settings;
  } catch (error) {
    console.error('Error getting user settings:', error);
    return null;
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

    const response = await fetch(USER_SETTINGS_API_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, enablePrepMode: enabled }),
    });

    if (!response.ok) {
      throw new Error(`Failed to update prep mode access: ${response.statusText}`);
    }
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
    console.log('🔍 hasPrepModeAccess: called with userId:', userId);
    // For guest users (no userId): Always return true
    if (!userId) {
      console.log('👤 hasPrepModeAccess: guest user, returning true');
      return true;
    }

    console.log('👤 hasPrepModeAccess: authenticated user, fetching settings...');
    // For authenticated users: check settings.enablePrepMode, default to false
    const settings = await getUserSettings(userId);
    console.log('📊 hasPrepModeAccess: fetched settings:', settings);
    const access = settings?.enablePrepMode || false;
    console.log('✅ hasPrepModeAccess: access result:', access);
    return access;
  } catch (error) {
    console.error('❌ hasPrepModeAccess: Error checking prep mode access:', error);
    // On error, default to false for authenticated users
    return false;
  }
} 