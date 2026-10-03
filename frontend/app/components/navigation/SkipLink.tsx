'use client';

import { useTranslation } from 'react-i18next';

/** The first stop of the keyboard: jump past the navigation, said in the interface language. */
export function SkipLink() {
  const { t } = useTranslation();
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:z-[9999] focus:top-4 focus:left-4 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg dark:focus:bg-gray-800"
    >
      {t('navigation.skipToContent')}
    </a>
  );
}
