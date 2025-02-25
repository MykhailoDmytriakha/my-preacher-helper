import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getInitialLanguage } from './getInitialLang';
import enTranslation from './en/translation.json';
import ruTranslation from './ru/translation.json';
import ukTranslation from './uk/translation.json';

export const i18n = createInstance({
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

i18n.use(initReactI18next).init();

export default i18n; 