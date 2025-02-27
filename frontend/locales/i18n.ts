import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getInitialLanguage } from './getInitialLang';
import enTranslation from './en/translation.json';
import ruTranslation from './ru/translation.json';
import ukTranslation from './uk/translation.json';

// Default language
export const DEFAULT_LANGUAGE = 'en';

// Create a reusable configuration
const i18nConfig = {
  resources: {
    en: { translation: enTranslation },
    ru: { translation: ruTranslation },
    uk: { translation: ukTranslation }
  },
  lng: DEFAULT_LANGUAGE, // Start with default language
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

// Client-side initialization using cookie value
if (typeof window !== 'undefined') {
  // Get initial language from cookie (fast, synchronous access)
  const cookieLanguage = getInitialLanguage();
  
  // Only change language if not the default
  if (cookieLanguage !== DEFAULT_LANGUAGE) {
    // Use setTimeout to avoid hydration issues
    setTimeout(() => {
      i18n.changeLanguage(cookieLanguage);
    }, 0);
  }
}

export default i18n; 