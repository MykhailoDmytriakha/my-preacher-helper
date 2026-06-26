import { doc, getDoc, setDoc } from 'firebase/firestore';

import { DEFAULT_LANGUAGE, COOKIE_LANG_KEY, COOKIE_MAX_AGE } from '@/../../frontend/locales/constants';
import { getClientDb } from '@/config/firebaseClientDb';
import { UserSettings } from '@/models/models';
import { debugLog } from '@/utils/debugMode';

import type { FirstDayOfWeek } from '@/utils/weekStart';

// Settings reads and writes go through the client Firestore SDK (the `users`
// doc, keyed by doc-id == uid). The doc-id ownership rule
// (request.auth.uid == uid) makes reads of a not-yet-existing own doc safe.
const USERS_COLLECTION = 'users';

// Cold-start race: right after `initializeFirestore` the client can issue its
// first request before the Firebase auth token is attached to its credentials
// provider, yielding a transient `permission-denied` / `unauthenticated`. The
// list hooks ride React Query's built-in retry and self-heal; these imperative
// settings reads have no such retry, so a feature-flag check would log an error
// and fall back to `false` for a frame. A genuine denial can't occur here (an
// owner reading their own `users/{uid}`), so retrying a couple of times is safe.
const TRANSIENT_AUTH_ERROR_CODES = new Set(['permission-denied', 'unauthenticated']);
const SETTINGS_READ_RETRY_DELAYS_MS = [150, 400];

// UX / preference fields the client may write to its own settings doc. NEVER
// id/userId (identity): those are server-managed; the client whitelist keeps the
// app from ever writing them via the client SDK.
const SETTINGS_WRITABLE_FIELDS = [
  'language', 'email', 'displayName', 'firstDayOfWeek',
  'enablePrepMode', 'enableAudioGeneration', 'enableStructurePreview', 'enableGroups', 'showAppVersion',
];

async function getUserSettingsViaClient(userId: string): Promise<UserSettings | null> {
  const ref = doc(getClientDb(), USERS_COLLECTION, userId);

  for (let attempt = 0; ; attempt++) {
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return { id: snap.id, ...(snap.data() as Omit<UserSettings, 'id'>) } as UserSettings;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code && TRANSIENT_AUTH_ERROR_CODES.has(code) && attempt < SETTINGS_READ_RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, SETTINGS_READ_RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw error;
    }
  }
}

// setDoc(merge) = create-or-update, mirroring the server's createOrUpdate: a new
// user gets a doc with just these fields; an existing doc keeps everything else.
// Only whitelisted UX fields are ever written from the client.
async function updateUserSettingsViaClient(userId: string, updates: Record<string, unknown>): Promise<void> {
  const db = getClientDb();
  const allowed: Record<string, unknown> = {};
  for (const field of SETTINGS_WRITABLE_FIELDS) {
    if (updates[field] !== undefined) allowed[field] = updates[field];
  }
  if (Object.keys(allowed).length === 0) return;
  await setDoc(doc(db, USERS_COLLECTION, userId), allowed, { merge: true });
}

// Read/language helpers below keep their graceful cookie fallback.
const isBrowserOffline = () => typeof navigator !== 'undefined' && !navigator.onLine;

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
    const settings = await getUserSettingsViaClient(userId);

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

    if (isBrowserOffline()) {
      return;
    }

    // For authenticated users, also update DB (source of truth)
    await updateUserSettingsViaClient(userId, { language });
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

    if (isBrowserOffline()) {
      return;
    }

    // Only update provided fields
    const updates: Record<string, unknown> = {};
    if (email !== undefined) updates.email = email;
    if (displayName !== undefined) updates.displayName = displayName;

    // Don't make the API call if there's nothing to update
    if (Object.keys(updates).length === 0) return;

    // Update settings without specifying language
    await updateUserSettingsViaClient(userId, updates);
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

    if (isBrowserOffline()) {
      if (language) {
        setLanguageCookie(language);
      }
      return;
    }

    // Build request payload with only provided fields
    const payload: Record<string, unknown> = { userId };
    if (language !== undefined) payload.language = language;
    if (email !== undefined) payload.email = email;
    if (displayName !== undefined) payload.displayName = displayName;

    // setDoc(merge) only writes the provided fields; we deliberately do NOT
    // force a default language here, so a re-init can't clobber an existing
    // preference.
    await updateUserSettingsViaClient(userId, payload);

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
    return getUserSettingsViaClient(userId);
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
  try {
    if (!userId) {
      return false;
    }

    if (isBrowserOffline()) {
      return false;
    }

    const settings = await getUserSettings(userId);
    return settings?.enableGroups || false;
  } catch (error) {
    console.error('Error checking groups access:', error);
    return false;
  }
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
