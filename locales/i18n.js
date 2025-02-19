import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enTranslations from './en/translation.json';
import ruTranslations from './ru/translation.json';
import ukTranslations from './uk/translation.json';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: enTranslations },
    ru: { translation: ruTranslations },
    uk: { translation: ukTranslations }
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false
  }
});

export default i18n; 