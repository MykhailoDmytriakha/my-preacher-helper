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
  lng: 'en', // Всегда начинаем с английского на сервере
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false
  },
  react: {
    useSuspense: false,
    // Отключаем предупреждения о гидратации
    transWrapTextNodes: 'span',
    transSupportBasicHtmlNodes: true,
    transKeepBasicHtmlNodesFor: ['br', 'strong', 'i', 'p']
  }
});

i18n.use(initReactI18next).init();

// Функция для чтения языка из cookie на клиенте
if (typeof window !== 'undefined') {
  const clientLang = getInitialLanguage();
  if (clientLang !== 'en') {
    // Только после гидратации меняем язык на клиенте
    setTimeout(() => {
      i18n.changeLanguage(clientLang);
    }, 0);
  }
}

export default i18n; 