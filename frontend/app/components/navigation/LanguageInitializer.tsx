'use client';

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { isCollectionOnEngine } from '@/data-engine/clientPolicy';
import { useAuth } from '@/providers/AuthProvider';
import { getCookieLanguage } from '@/services/userSettings.service';
import { initializeLanguageFromDB } from '@locales/getInitialLang';

/**
 * Component that initializes language settings from the database
 * once the user is authenticated.
 */
export default function LanguageInitializer() {
  const { user, loading } = useAuth();
  const { i18n } = useTranslation();
  const deviceLanguageApplied = useRef(false);

  // The page hydrated in the language the server rendered in (locales/i18n.ts); the device's own
  // language follows the moment hydration is over, without waiting for the account to answer.
  // Not inside this effect itself: the initializer sits before the page, so its effect runs before
  // later components subscribe to language changes, and a switch they did not hear left them in
  // English. A task later, every component of the first render is listening.
  useEffect(() => {
    if (deviceLanguageApplied.current) return;
    const timer = setTimeout(() => {
      deviceLanguageApplied.current = true;
      const cookieLang = getCookieLanguage();
      if (cookieLang !== i18n.language) void i18n.changeLanguage(cookieLang);
    }, 0);
    return () => clearTimeout(timer);
  }, [i18n]);

  useEffect(() => {
    // The root initializer is outside the workspace: it must not race the engine's
    // durable language draft with a second server read. Public pages keep the cookie.
    if (user && isCollectionOnEngine('users')) return;
    if (!loading) {
      if (user) {
        // Initialize language from database for authenticated users
        initializeLanguageFromDB()
          .catch((error: Error) => console.error('Failed to initialize language from DB:', error));
      } else {
        // For guest users, ensure the cookie language is applied — a task later, for the same
        // reason as the switch above: components after this one may not be listening yet.
        const timer = setTimeout(() => {
          const cookieLang = getCookieLanguage();
          if (cookieLang !== i18n.language) void i18n.changeLanguage(cookieLang);
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [user, loading, i18n]);
  
  // This is a utility component that doesn't render anything
  return null;
} 