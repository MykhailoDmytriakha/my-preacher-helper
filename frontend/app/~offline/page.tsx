'use client';

import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';

import DashboardPage from '@/(pages)/(private)/dashboard/page';
import { PrivateChrome, PrivateWorkspace } from '@/components/PrivateWorkspace';
import { useAuth } from '@/providers/AuthProvider';
import { resolveOfflineShellRoute, type OfflineShellRoute } from '@/utils/offlineShellRoutes';
import { useTranslation } from '@locales/useTranslation';

// Route-agnostic offline app-shell. The service worker serves this precached
// document as the navigation fallback whenever an offline navigation misses the
// cache (App Router SPA-visited routes only cache their RSC, not the HTML, so
// reloading them offline used to dead-end at /offline.html). The shell boots the
// React app from cache and dispatches on the requested path so high-value routes
// render their REAL content from the Firestore offline cache (deep per-route
// render — Phase 4 Increment 2) instead of a generic notice.
//
// Bundle discipline: the dashboard (the home, always relevant offline) is a STATIC
// import so it is part of the precached shell and guaranteed available offline. The
// other overview/list routes are LAZY (separate chunks, not in the precache) — their
// chunk is cached by the runtime defaultCache when the route is visited online, so a
// previously-visited route renders offline; a never-visited one fails to load its
// chunk and the error boundary shows the generic card. This keeps the precached
// shell small (static-importing all of them ballooned /~offline to ~939kB First Load
// vs ~427kB for the dashboard alone) without losing graceful coverage.
//
// This file renders on a failed document or after a weak-network deadline. Auth and the React Query client live in the ROOT layout; the
// data engine, the settings and the chrome come from the same PrivateWorkspace the
// private layout renders its pages in. The Suspense boundary covers pages reading
// useSearchParams (e.g. /sermons). Param detail routes (/sermons/[id] etc.) are
// wired too: their pages read the id via useRouteId (useParams ?? location.pathname),
// so they self-resolve the id when rendered in the shell — no body extraction needed.

type OfflineRoute = {
  Component: ComponentType;
  Layout?: ComponentType<{ children: ReactNode }>;
};

// Reuse the layout and page modules a normal visit already loads.
const SettingsSectionLayout = lazy(() => import('@/(pages)/(private)/settings/layout'));
const LAZY_ROUTES: Record<Exclude<OfflineShellRoute, 'dashboard'>, OfflineRoute> = {
  settings: { Component: lazy(() => import('@/(pages)/(private)/settings/page')), Layout: SettingsSectionLayout },
  'settings:user': { Component: lazy(() => import('@/(pages)/(private)/settings/user/page')), Layout: SettingsSectionLayout },
  'settings:limits': { Component: lazy(() => import('@/(pages)/(private)/settings/limits/page')), Layout: SettingsSectionLayout },
  'settings:tags': { Component: lazy(() => import('@/(pages)/(private)/settings/tags/page')), Layout: SettingsSectionLayout },
  'settings:templates': { Component: lazy(() => import('@/(pages)/(private)/settings/templates/page')), Layout: SettingsSectionLayout },
  'settings:bible': { Component: lazy(() => import('@/(pages)/(private)/settings/bible/page')), Layout: SettingsSectionLayout },
  sermons: { Component: lazy(() => import('@/(pages)/(private)/sermons/page')) },
  series: { Component: lazy(() => import('@/(pages)/(private)/series/page')) },
  groups: { Component: lazy(() => import('@/(pages)/(private)/groups/page')) },
  prayers: { Component: lazy(() => import('@/(pages)/(private)/prayers/page')) },
  studies: { Component: lazy(() => import('@/(pages)/(private)/studies/page')) },
  studyShares: { Component: lazy(() => import('@/(pages)/(private)/studies/share-links/page')) },
  bible: { Component: lazy(() => import('@/(pages)/(private)/bible/page')) },
  calendar: { Component: lazy(() => import('@/(pages)/(private)/calendar/page')) },
  care: { Component: lazy(() => import('@/(pages)/(private)/care/page')) },
  councils: { Component: lazy(() => import('@/(pages)/(private)/care/council/page')) },
  orders: { Component: lazy(() => import('@/(pages)/(private)/care/orders/page')) },
  council: { Component: lazy(() => import('@/(pages)/(private)/care/council/[id]/page')) },
  councilConduct: { Component: lazy(() => import('@/(pages)/(private)/care/council/[id]/conduct/page')) },
  order: { Component: lazy(() => import('@/(pages)/(private)/care/orders/[id]/page')) },
  groupConduct: { Component: lazy(() => import('@/(pages)/(private)/groups/[id]/conduct/page')) },
  prayer: { Component: lazy(() => import('@/(pages)/(private)/prayers/[id]/page')) },
  sermon: { Component: lazy(() => import('@/(pages)/(private)/sermons/[id]/page')) },
  seriesDetail: { Component: lazy(() => import('@/(pages)/(private)/series/[id]/page')) },
  study: { Component: lazy(() => import('@/(pages)/(private)/studies/[id]/page')) },
  group: { Component: lazy(() => import('@/(pages)/(private)/groups/[id]/page')) },
  sermonPlan: { Component: lazy(() => import('@/(pages)/(private)/sermons/[id]/plan/page')) },
  sermonManualPlan: { Component: lazy(() => import('@/(pages)/(private)/sermons/[id]/plan/manual/page')) },
  sermonStructure: { Component: lazy(() => import('@/(pages)/(private)/sermons/[id]/structure/page')) },
};

// Renders the generic card if a lazy route's chunk can't be loaded (offline +
// never visited online, so defaultCache never cached the chunk) or the page throws.
class OfflineRouteBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function GenericOfflineCard({ requestedPath, pending = false }: { requestedPath: string; pending?: boolean }) {
  const { t } = useTranslation();
  return (
    <main className="min-h-screen grid place-items-center bg-[#0b1220] px-6 text-slate-100">
      <div className="min-w-0 w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-900/60 p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-amber-500/15 text-2xl">
          📡
        </div>
        <h1 className="mb-2 text-xl font-semibold">{t(pending ? 'connection.offlinePage.opening' : 'connection.offlinePage.title')}</h1>
        <p role={pending ? 'status' : undefined} className="mb-1 text-sm text-slate-300">
          {t(pending ? 'connection.offlinePage.waiting' : 'connection.offlinePage.fromCache')}
        </p>
        {requestedPath ? (
          <p className="mb-6 truncate text-xs text-slate-500">{t('connection.offlinePage.requested', { path: requestedPath })}</p>
        ) : (
          <div className="mb-6" />
        )}

        <div className="flex flex-col gap-3">
          <a
            href="/dashboard"
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            {t('connection.offlinePage.home')}
          </a>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
          >
            {t('buttons.retry')}
          </button>
        </div>
      </div>
    </main>
  );
}

// A page rendered by the shell sits in the same workspace and chrome the private layout
// gives it online. The router stands at /~offline here, so the address comes from the window.
function ShellWorkspace({ pathname, children }: { pathname: string; children: ReactNode }) {
  return (
    <PrivateWorkspace>
      <PrivateChrome pathname={pathname} search={window.location.search.slice(1)}>
        {children}
      </PrivateChrome>
    </PrivateWorkspace>
  );
}

export default function OfflineShell() {
  // Keep the build-time and first client render identical until the real address is read.
  const [requestedPath, setRequestedPath] = useState<string | null>(null);
  const { user, loading } = useAuth();

  useEffect(() => {
    setRequestedPath(window.location.pathname);
  }, []);

  if (requestedPath === null) {
    return <GenericOfflineCard requestedPath="" pending />;
  }

  // The shell stands in for private pages, which the private layout guards online. Someone signed out
  // on this device gets the card, not a private page: the worker opens this shell at the start of the
  // app on a weak signal too (BUG-20261004-weak-network-delays-offline-navigation).
  if (loading || !user) {
    return <GenericOfflineCard requestedPath={requestedPath} pending={loading} />;
  }

  // Dashboard: static, guaranteed offline (the home).
  const route = resolveOfflineShellRoute(requestedPath);
  if (route === 'dashboard') {
    return (
      <ShellWorkspace pathname={requestedPath}>
        <Suspense fallback={<GenericOfflineCard requestedPath={requestedPath} pending />}>
          <DashboardPage />
        </Suspense>
      </ShellWorkspace>
    );
  }

  // Other routes: lazy chunk (cached on online visit) + graceful fallback.
  const lazyMatch = route ? LAZY_ROUTES[route] : null;
  if (lazyMatch) {
    const RouteComponent = lazyMatch.Component;
    const RouteLayout = lazyMatch.Layout;
    const content = <RouteComponent />;
    // The chrome hides itself for ?planView=preaching, offline as online.
    return (
      <OfflineRouteBoundary fallback={<GenericOfflineCard requestedPath={requestedPath} />}>
        <ShellWorkspace pathname={requestedPath}>
          <Suspense fallback={<GenericOfflineCard requestedPath={requestedPath} pending />}>
            {RouteLayout ? <RouteLayout>{content}</RouteLayout> : content}
          </Suspense>
        </ShellWorkspace>
      </OfflineRouteBoundary>
    );
  }

  return <GenericOfflineCard requestedPath={requestedPath} />;
}
