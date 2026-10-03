'use client';

import { useTranslation } from 'react-i18next';
import { Toaster } from 'sonner';

/** The notification area, named in the interface language: sonner's own name for it is English. */
export function LocalizedToaster() {
  const { t } = useTranslation();
  return <Toaster richColors closeButton position="top-right" containerAriaLabel={t('common.notifications')} />;
}
