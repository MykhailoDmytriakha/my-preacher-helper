'use client';

import { useEffect } from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { recordDiagnostic } from '@/utils/appDiagnostics';

/** Remains mounted with the navigation, even when a child route is still loading. */
export function DiagnosticsRecorder({ pathname }: { pathname: string }) {
  const { user, loading } = useAuth();
  useEffect(() => { recordDiagnostic('route', { route: pathname }); }, [pathname]);
  useEffect(() => { recordDiagnostic('auth', { authenticated: Boolean(user), loading }); }, [user, loading]);
  useEffect(() => {
    recordDiagnostic('boot', { online: navigator.onLine, visible: document.visibilityState === 'visible' });
    const visibility = () => recordDiagnostic('visibility', { visible: document.visibilityState === 'visible' });
    const focus = () => recordDiagnostic('focus');
    const online = () => recordDiagnostic('online');
    const offline = () => recordDiagnostic('offline');
    const show = (event: PageTransitionEvent) => recordDiagnostic('pageshow', { persisted: event.persisted });
    const hide = (event: PageTransitionEvent) => recordDiagnostic('pagehide', { persisted: event.persisted });
    // Classify messages in memory; never copy their potentially private contents.
    const error = (event: ErrorEvent) => recordDiagnostic('runtime-error', { code: /chunk|dynamically imported module/i.test(event.message) ? 'chunk-load' : 'javascript' });
    const rejection = () => recordDiagnostic('unhandled-rejection');
    const worker = () => recordDiagnostic('worker-change');
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', focus);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('pageshow', show);
    window.addEventListener('pagehide', hide);
    window.addEventListener('error', error);
    window.addEventListener('unhandledrejection', rejection);
    navigator.serviceWorker?.addEventListener('controllerchange', worker);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('pageshow', show);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('error', error);
      window.removeEventListener('unhandledrejection', rejection);
      navigator.serviceWorker?.removeEventListener('controllerchange', worker);
    };
  }, []);
  return null;
}
