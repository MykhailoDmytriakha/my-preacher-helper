'use client';

import { useEffect, useRef } from 'react';

import { isCollectionOnEngine } from '@/data-engine/clientPolicy';
import { useAuth } from '@/providers/AuthProvider';
import { getCookieLanguage } from '@/services/userSettings.service';
import { initializeLanguageFromDB } from '@locales/getInitialLang';
import { useTranslation } from '@locales/useTranslation';

/**
 * Component that initializes language settings from the database
 * once the user is authenticated.
 */
export default function LanguageInitializer() {
  const { user, loading } = useAuth();
  const { i18n } = useTranslation();
  const deviceLanguageApplied = useRef(false);

  // Each translated consumer pins its own hydration snapshot, then catches up with the
  // live language. Apply the cookie after the root commits; later subscribers also catch it.
  useEffect(() => {
    if (deviceLanguageApplied.current) return;
    deviceLanguageApplied.current = true;
    const cookieLang = getCookieLanguage();
    if (cookieLang !== i18n.language) void i18n.changeLanguage(cookieLang);
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
        const cookieLang = getCookieLanguage();
        if (cookieLang !== i18n.language) void i18n.changeLanguage(cookieLang);
      }
    }
  }, [user, loading, i18n]);
  
  // This is a utility component that doesn't render anything
  return null;
} 