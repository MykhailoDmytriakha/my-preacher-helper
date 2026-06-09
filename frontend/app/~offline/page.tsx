'use client';

import { useEffect, useState } from 'react';

import DashboardPage from '@/(pages)/(private)/dashboard/page';

// Route-agnostic offline app-shell. The service worker serves this precached
// document as the navigation fallback whenever an offline navigation misses the
// cache (App Router SPA-visited routes only cache their RSC, not the HTML, so
// reloading them offline used to dead-end at /offline.html). The shell boots the
// React app from cache; here we dispatch on the requested path so high-value
// routes render their REAL content from the Firestore offline cache (deep
// per-route render — Phase 4 Increment 2) instead of a generic notice. Routes not
// yet wired fall back to the generic offline card below.
//
// Safe by construction: this file is ONLY rendered on an offline document-miss
// (online routes are untouched), and the page components it renders are
// self-contained w.r.t. providers — Auth, the React Query client and the
// Firestore offline cache all live in the ROOT layout, so a page rendered here
// reads the exact same cached data it would online. The (private) layout only
// adds nav chrome + the auth guard, neither of which the page body needs to
// render its cached content.

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

export default function OfflineShell() {
  // null until the effect reads the real URL the user tried to open (the shell
  // HTML is served at that URL). Rendering null first also keeps the precached
  // static HTML (path unknown) hydration-stable before we pick a branch.
  const [requestedPath, setRequestedPath] = useState<string | null>(null);

  useEffect(() => {
    setRequestedPath(window.location.pathname);
  }, []);

  if (requestedPath === null) {
    return null;
  }

  // Deep per-route render (wired incrementally). The dashboard page uses only
  // useRouter (no route-param hooks), so it renders correctly outside its own
  // route, reading sermons/series/notes/etc. from the Firestore offline cache.
  if (requestedPath === '/dashboard' || requestedPath === '/') {
    return <DashboardPage />;
  }

  return <GenericOfflineCard requestedPath={requestedPath} />;
}
