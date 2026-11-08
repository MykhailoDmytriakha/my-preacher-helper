declare global {
  interface Window {
    __mphOfflineWorkerReady?: Promise<void>;
  }
}

/** Serialized into the initial HTML. Keep this function independent of the module around it. */
function startOfflineWorker() {
  if (!('serviceWorker' in navigator) || typeof caches === 'undefined' || window.__mphOfflineWorkerReady) return;
  const workers = navigator.serviceWorker;

  window.__mphOfflineWorkerReady = new Promise<void>(resolve => {
    let finished = false;
    let controller: ServiceWorker | null = null;
    let installing: ServiceWorker | null = null;
    let registration: ServiceWorkerRegistration | undefined;

    const finish = () => {
      if (finished) return;
      finished = true;
      workers.removeEventListener('controllerchange', checkController);
      controller?.removeEventListener('statechange', checkController);
      registration?.removeEventListener('updatefound', watchInstallation);
      installing?.removeEventListener('statechange', checkInstallation);
      window.removeEventListener('offline', finish);
      resolve();
    };
    const checkController = () => {
      if (controller !== workers.controller) {
        controller?.removeEventListener('statechange', checkController);
        controller = workers.controller;
        controller?.addEventListener('statechange', checkController);
      }
      if (controller?.state === 'activated') finish();
    };
    const checkInstallation = () => {
      if (installing?.state === 'redundant') finish();
    };
    const watchInstallation = () => {
      const next = registration?.installing;
      if (!next || next === installing) return;
      installing?.removeEventListener('statechange', checkInstallation);
      installing = next;
      installing.addEventListener('statechange', checkInstallation);
      checkInstallation();
    };

    workers.addEventListener('controllerchange', checkController);
    window.addEventListener('offline', finish, { once: true });
    checkController();
    if (!navigator.onLine && !finished) finish();

    // Registration starts during HTML parsing; it also checks for updates on later visits.
    void Promise.resolve().then(() => workers.register('/sw.js', { scope: '/' })).then(registered => {
      if (finished) return;
      registration = registered;
      // A worker that failed before the registration reply has already left all three slots.
      if (!registered.installing && !registered.waiting && !registered.active && !workers.controller) {
        finish();
        return;
      }
      registration.addEventListener('updatefound', watchInstallation);
      watchInstallation();
      if (!finished) checkController();
    }, finish);
  });
}

export const OFFLINE_WORKER_START_SCRIPT = `(${startOfflineWorker.toString()})();`;

export function initialOfflineWorkerReady(): Promise<void> | undefined {
  return typeof window === 'undefined' ? undefined : window.__mphOfflineWorkerReady;
}
