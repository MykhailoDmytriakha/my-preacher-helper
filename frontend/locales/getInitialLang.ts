import { getCookieLanguage, getUserLanguage, setLanguageCookie } from '@/services/userSettings.service';
import { getAuth } from 'firebase/auth';
import i18n from './i18n';

/**
 * Get initial language for i18n initialization
 * This function must be synchronous as it's called during app initialization
 * We always use cookies for the initial load to avoid delays
 */
export function getInitialLanguage(): string {
  return getCookieLanguage();
}

/**
 * This function synchronizes the language between database and local state
 * Called after authentication state is confirmed
 */
export async function initializeLanguageFromDB(): Promise<void> {
  if (typeof window === 'undefined') return;
  
  const auth = getAuth();
  const user = auth.currentUser;
  
  // Not authenticated, so we just use cookies
  if (!user) return;
  
  try {
    // Get language from database (source of truth for authenticated users)
    const dbLanguage = await getUserLanguage(user.uid);
    
    // Only update if database language differs from current
    if (dbLanguage && dbLanguage !== i18n.language) {
      // Update the language in i18n
      i18n.changeLanguage(dbLanguage);
      
      // Also ensure cookie is in sync with DB
      setLanguageCookie(dbLanguage);
    }
  } catch (error) {
    console.error('Error synchronizing language from DB:', error);
    // On error, we keep using the cookie/current language
  }
} 