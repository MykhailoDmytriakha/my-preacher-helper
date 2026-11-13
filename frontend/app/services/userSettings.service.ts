import { UserSettings } from '@/models/models';
import { requestUserSettings } from '@/services/userSettingsTransport.client';
import { isKnownOffline } from '@/utils/connectivity';
import { DEFAULT_LANGUAGE, COOKIE_LANG_KEY, COOKIE_MAX_AGE } from '@locales/constants';

export interface ModelPreference {
  preferredProviderId: NonNullable<UserSettings['preferredProviderId']>;
  preferredModelId: string;
}

export type FunctionModelPreference = Pick<
  UserSettings,
  'preferredTranscription' | 'preferredText' | 'preferredTts'
>;

/**
 * Get user language preference - optimized approach
 * Uses cookies for immediate access and DB as source of truth for authenticated users
 * 
 * @param userId The user ID
 * @returns The user's preferred language or default
 */
export async function getUserLanguage(userId: string): Promise<string> {
  try {
    // The phone's "no network" counts only until a request reaches the server (BUG-20261011-raw-phone-flag-in-read-paths).
    if (isKnownOffline()) {
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
    if (isKnownOffline()) return;
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

    if (isKnownOffline()) return;
    await requestUserSettings(userId, { operation: 'bootstrap', patch: updates });
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

    const payload: Record<string, unknown> = {};
    if (language !== undefined) payload.language = language;
    if (email !== undefined) payload.email = email;
    if (displayName !== undefined) payload.displayName = displayName;
    if (language) setLanguageCookie(language);
    if (isKnownOffline()) return;
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
  return readLanguageCookie() || DEFAULT_LANGUAGE;
}

/** A stored device preference, without treating the app default as a known choice. */
export function readLanguageCookie(): string | undefined {
  if (typeof document !== 'undefined') {
    return document.cookie.match(new RegExp(`${COOKIE_LANG_KEY}=([^;]+)`))?.[1];
  }
  return undefined;
}

/**
 * Helper function to set language cookie
 */
export function setLanguageCookie(language: string): void {
  if (typeof document !== 'undefined') {
    document.cookie = `${COOKIE_LANG_KEY}=${language}; path=/; max-age=${COOKIE_MAX_AGE}`;
  }
}
