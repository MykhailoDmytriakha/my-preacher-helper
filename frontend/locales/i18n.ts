import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LANGUAGE } from './constants';
import enGraceVerses from './en/graceVerses.json';
import enTranslation from './en/translation.json';
import ruGraceVerses from './ru/graceVerses.json';
import ruTranslation from './ru/translation.json';
import ukGraceVerses from './uk/graceVerses.json';
import ukTranslation from './uk/translation.json';

/**
 * THE FIRST RENDER IN THE BROWSER SPEAKS THE LANGUAGE THE SERVER RENDERED IN
 * (BUG-20260902-ssr-renders-english-labels-then-swaps).
 *
 * The server cannot know the device's language for a prerendered page, so it renders in the
 * default one. A browser that started in the cookie's language failed hydration on every
 * translated string: text was thrown away and rendered again, and mismatched attributes such as
 * `aria-label` were left in English. Both sides start in the default language; the device's own
 * is applied the moment hydration is over (`LanguageInitializer`).
 */
// Create a reusable configuration
const i18nConfig = {
  resources: {
    en: { translation: enTranslation, graceVerses: enGraceVerses },
    ru: { translation: ruTranslation, graceVerses: ruGraceVerses },
    uk: { translation: ukTranslation, graceVerses: ukGraceVerses }
  },
  lng: DEFAULT_LANGUAGE,
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

export default i18n;
