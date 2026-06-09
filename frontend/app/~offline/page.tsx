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
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import DashboardNav from '@/components/navigation/DashboardNav';

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
// Safe by construction: this file renders ONLY on an offline document-miss (online
// routes are untouched); the page bodies are self-contained w.r.t. providers (Auth,
// the React Query client and the Firestore cache live in the ROOT layout). Only
// paramless pages are wired; the Suspense boundary covers pages reading
// useSearchParams (e.g. /sermons). Param detail routes (/sermons/[id] etc.) are
// wired too: their pages read the id via useRouteId (useParams ?? location.pathname),
// so they self-resolve the id when rendered in the shell — no body extraction needed.

const LAZY_ROUTES: { test: (path: string) => boolean; Component: ComponentType }[] = [
  { test: (p) => p === '/sermons', Component: lazy(() => import('@/(pages)/(private)/sermons/page')) },
  { test: (p) => p === '/series', Component: lazy(() => import('@/(pages)/(private)/series/page')) },
  { test: (p) => p === '/groups', Component: lazy(() => import('@/(pages)/(private)/groups/page')) },
  { test: (p) => p === '/prayers', Component: lazy(() => import('@/(pages)/(private)/prayers/page')) },
  { test: (p) => p === '/studies', Component: lazy(() => import('@/(pages)/(private)/studies/page')) },
  { test: (p) => p === '/calendar', Component: lazy(() => import('@/(pages)/(private)/calendar/page')) },
  // Param detail routes — exact single-segment match (so /sermons/[id]/structure,
  // /plan etc. fall through to the generic card; those aren't wired offline).
  { test: (p) => /^\/sermons\/[^/]+$/.test(p), Component: lazy(() => import('@/(pages)/(private)/sermons/[id]/page')) },
  { test: (p) => /^\/series\/[^/]+$/.test(p), Component: lazy(() => import('@/(pages)/(private)/series/[id]/page')) },
  { test: (p) => /^\/studies\/[^/]+$/.test(p), Component: lazy(() => import('@/(pages)/(private)/studies/[id]/page')) },
  { test: (p) => /^\/groups\/[^/]+$/.test(p), Component: lazy(() => import('@/(pages)/(private)/groups/[id]/page')) },
];

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

function GenericOfflineCard({ requestedPath }: { requestedPath: string }) {
  return (
    <main className="min-h-screen grid place-items-center bg-[#0b1220] px-6 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-900/60 p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-amber-500/15 text-2xl">
          📡
        </div>
        <h1 className="mb-2 text-xl font-semibold">Нет соединения</h1>
        <p className="mb-1 text-sm text-slate-300">
          Приложение запущено из локального кэша — ваши данные на месте.
        </p>
        {requestedPath ? (
          <p className="mb-6 truncate text-xs text-slate-500">Запрошенная страница: {requestedPath}</p>
        ) : (
          <div className="mb-6" />
        )}

        <div className="flex flex-col gap-3">
          <a
            href="/dashboard"
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            На главную
          </a>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
          >
            Повторить
          </button>
        </div>
      </div>
    </main>
  );
}

// Wraps an offline-rendered page in the same nav chrome the (private) layout gives
// online (top nav + breadcrumbs + main container), so a never-visited page served by
// the shell looks consistent with a visited one (served from the cached real route).
// DashboardNav/Breadcrumbs read the real path via useShellPathname, so they're correct
// here even though the router context is /~offline.
function ShellChrome({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <DashboardNav />
      <div className="mx-auto w-full px-4 sm:px-6 lg:px-8">
        <Breadcrumbs />
      </div>
      <main className="mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">{children}</main>
    </div>
  );
}

export default function OfflineShell() {
  // null until the effect reads the real URL the user tried to open (the shell HTML
  // is served at that URL). Rendering null first keeps the precached static HTML
  // (path unknown at build) hydration-stable before we pick a branch.
  const [requestedPath, setRequestedPath] = useState<string | null>(null);

  useEffect(() => {
    setRequestedPath(window.location.pathname);
  }, []);

  if (requestedPath === null) {
    return null;
  }

  // Dashboard: static, guaranteed offline (the home).
  if (requestedPath === '/dashboard' || requestedPath === '/') {
    return (
      <Suspense fallback={null}>
        <ShellChrome>
          <DashboardPage />
        </ShellChrome>
      </Suspense>
    );
  }

  // Other overview routes: lazy chunk (cached on online visit) + graceful fallback.
  const lazyMatch = LAZY_ROUTES.find((route) => route.test(requestedPath));
  if (lazyMatch) {
    const RouteComponent = lazyMatch.Component;
    return (
      <OfflineRouteBoundary fallback={<GenericOfflineCard requestedPath={requestedPath} />}>
        <Suspense fallback={null}>
          <ShellChrome>
            <RouteComponent />
          </ShellChrome>
        </Suspense>
      </OfflineRouteBoundary>
    );
  }

  return <GenericOfflineCard requestedPath={requestedPath} />;
}
