import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enTranslation from './en/translation.json';
import ruTranslation from './ru/translation.json';
import ukTranslation from './uk/translation.json';

// Added function to get initial language from cookie
const getInitialLanguage = () => {
  if (typeof window !== 'undefined') {
    const match = document.cookie.match('(^|;)\s*lang\s*=\s*([^;]+)');
    return match ? match.pop() : 'en';
  }
  return 'en';
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: enTranslation },
      ru: { translation: ruTranslation },
      uk: { translation: ukTranslation }
    },
    lng: getInitialLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n; 