'use client';

import { usePathname } from 'next/navigation';

const OFFLINE_SHELL_PATH = '/~offline';

/**
 * `usePathname()`, with a fallback for the offline app-shell.
 *
 * When a page is rendered inside the offline shell (`/~offline`), Next's router
 * context is `/~offline` even though the service worker served the document at the
 * real URL (e.g. `/sermons/abc`), so `usePathname()` returns `/~offline`. In that
 * case we read the real path from `window.location.pathname`, so nav highlighting
 * and breadcrumbs reflect the page the user actually opened. Online this is
 * byte-identical to `usePathname()` — there it never returns `/~offline`.
 */
export function useShellPathname(): string {
  const pathname = usePathname();
  if (pathname && pathname !== OFFLINE_SHELL_PATH) return pathname;
  if (typeof window !== 'undefined') return window.location.pathname;
  return pathname ?? '';
}
