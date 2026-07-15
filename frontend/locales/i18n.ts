import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LANGUAGE } from './constants';
import enGraceVerses from './en/graceVerses.json';
import enTranslation from './en/translation.json';
import { getInitialLanguage } from './getInitialLang';
import ruGraceVerses from './ru/graceVerses.json';
import ruTranslation from './ru/translation.json';
import ukGraceVerses from './uk/graceVerses.json';
import ukTranslation from './uk/translation.json';

// Get initial language before configuring i18n
const initialLanguage = typeof window !== 'undefined' ? getInitialLanguage() : DEFAULT_LANGUAGE;

// Create a reusable configuration
const i18nConfig = {
  resources: {
    en: { translation: enTranslation, graceVerses: enGraceVerses },
    ru: { translation: ruTranslation, graceVerses: ruGraceVerses },
    uk: { translation: ukTranslation, graceVerses: ukGraceVerses }
  },
  lng: initialLanguage, // Use initial language from cookie
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false
  },
  react: {
    useSuspense: false,
    // Disable hydration warnings
    transWrapTextNodes: 'span',
    transSupportBasicHtmlNodes: true,
    transKeepBasicHtmlNodesFor: ['br', 'strong', 'i', 'p']
  }
};

// Create i18n instance
export const i18n = createInstance(i18nConfig);

// Initialize with React
i18n.use(initReactI18next).init();

// Client-side initialization to ensure hydration is consistent
if (typeof window !== 'undefined' && initialLanguage !== i18n.language) {
  // This should rarely happen, but just in case
  setTimeout(() => {
    i18n.changeLanguage(initialLanguage);
  }, 0);
}

export default i18n;
