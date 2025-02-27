import { UserSettings } from '@/models/models';
import { DEFAULT_LANGUAGE } from '@/../../frontend/locales/i18n';

const COOKIE_LANG_KEY = 'lang';
const COOKIE_MAX_AGE = 2592000; // 30 days

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
    const response = await fetch('/api/user/settings', {
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
 * Initialize user settings with default language
 * @param userId The user ID
 * @param language The language code (defaults to system default)
 */
export async function initializeUserSettings(userId: string, language: string = DEFAULT_LANGUAGE): Promise<void> {
  try {
    if (!userId) return;
    
    // Create settings through API
    const response = await fetch('/api/user/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, language }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to initialize user settings: ${response.statusText}`);
    }
    
    // Ensure cookie is in sync
    setLanguageCookie(language);
  } catch (error) {
    console.error('Error initializing user settings:', error);
    // Still set cookie even if DB update fails
    setLanguageCookie(language);
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