'use client';

import { useEffect } from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { recordDiagnostic } from '@/utils/appDiagnostics';
import { runtimeErrorDetails } from '@/utils/runtimeErrorDetails';

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
    // Keep the public build location and finite categories, never raw messages or stacks.
    const details = (input: Parameters<typeof runtimeErrorDetails>[0]) => runtimeErrorDetails(input, window.location, process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev');
    const error = (event: ErrorEvent) => recordDiagnostic('runtime-error', details(event));
    const rejection = (event: PromiseRejectionEvent) => recordDiagnostic('unhandled-rejection', details({ error: event.reason }));
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
