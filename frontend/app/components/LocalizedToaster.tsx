'use client';

import { useTranslation } from 'react-i18next';
import { Toaster } from 'sonner';

/** The notification area and each notification's close button, named in the interface language: sonner's own names are English. */
export function LocalizedToaster() {
  const { t } = useTranslation();
  return (
    <Toaster
      richColors
      closeButton
      position="top-right"
      containerAriaLabel={t('common.notifications')}
      toastOptions={{ closeButtonAriaLabel: t('common.closeNotification') }}
    />
  );
}
