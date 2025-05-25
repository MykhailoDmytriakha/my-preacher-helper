'use client';

import { useEffect } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { initializeLanguageFromDB } from '@/../../frontend/locales/getInitialLang';
import { useTranslation } from 'react-i18next';
import { getCookieLanguage } from '@/services/userSettings.service';

/**
 * Component that initializes language settings from the database
 * once the user is authenticated.
 */
export default function LanguageInitializer() {
  const { user, loading } = useAuth();
  const { i18n } = useTranslation();
  
  useEffect(() => {
    if (!loading) {
      if (user) {
        // Initialize language from database for authenticated users
        initializeLanguageFromDB()
          .catch((error: Error) => console.error('Failed to initialize language from DB:', error));
      } else {
        // For guest users, ensure the cookie language is applied
        const cookieLang = getCookieLanguage();
        if (cookieLang !== i18n.language) {
          i18n.changeLanguage(cookieLang);
        }
      }
    }
  }, [user, loading, i18n]);
  
  // This is a utility component that doesn't render anything
  return null;
} 