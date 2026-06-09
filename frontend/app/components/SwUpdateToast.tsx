'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

// Surfaces a non-blocking "new version available" toast when an updated service
// worker takes control of this page. Serwist ships with skipWaiting + clientsClaim,
// so a new deploy's SW activates and claims the open client immediately — at which
// point the page's already-loaded JS chunks can mismatch the controlling SW and a
// later lazy navigation may hit a chunk-load error. Instead of waiting for that
// reactive failure, we offer a proactive reload.
//
// Guards: only fires on a genuine UPDATE (a controller already existed at boot — the
// very first install/claim has no prior controller and must NOT prompt a reload),
// fires at most once, and never auto-reloads (the user decides, so there is no
// reload loop and no interruption of in-progress work).
export function SwUpdateToast() {
  const { t } = useTranslation();

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const container = navigator.serviceWorker;
    const hadControllerAtBoot = Boolean(container.controller);
    let notified = false;

    const onControllerChange = () => {
      if (!hadControllerAtBoot || notified) return;
      notified = true;
      toast(t('pwa.updateAvailable.title'), {
        description: t('pwa.updateAvailable.description'),
        duration: Infinity,
        action: {
          label: t('pwa.updateAvailable.action'),
          onClick: () => window.location.reload(),
        },
      });
    };

    container.addEventListener('controllerchange', onControllerChange);
    return () => {
      container.removeEventListener('controllerchange', onControllerChange);
    };
  }, [t]);

  return null;
}
