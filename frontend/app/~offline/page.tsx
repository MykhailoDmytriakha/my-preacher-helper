'use client';

import { useEffect, useState } from 'react';

// Route-agnostic offline app-shell. The service worker serves this precached
// document as the navigation fallback whenever an offline navigation misses the
// cache (App Router SPA-visited routes only cache their RSC, not the HTML, so
// reloading them offline used to dead-end at /offline.html). Serving this shell
// instead boots the React app from cache, so the user lands in a live app rather
// than a dead page. Deep per-route rendering (showing the exact requested route's
// content offline) is a later increment — this closes the "boots from cache
// instead of a dead-end" gap (task #14).
export default function OfflineShell() {
  const [requestedPath, setRequestedPath] = useState<string>('');

  useEffect(() => {
    // The real URL the user tried to open (the shell HTML is served at it).
    setRequestedPath(window.location.pathname);
  }, []);

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
