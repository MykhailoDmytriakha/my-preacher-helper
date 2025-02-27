'use client';

import { useEffect } from 'react';
import useAuth from '@/hooks/useAuth';
import { initializeLanguageFromDB } from '@/../../frontend/locales/getInitialLang';
import { useTranslation } from 'react-i18next';

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
      }
    }
  }, [user, loading]);
  
  // This is a utility component that doesn't render anything
  return null;
} 