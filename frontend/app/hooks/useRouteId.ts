'use client';

import { useParams } from 'next/navigation';

/**
 * The `[id]` route param, with a fallback for the offline app-shell.
 *
 * Normally this is just `useParams().id`. But when the page is rendered inside the
 * offline shell (`/~offline`), the service worker has served the shell document AT
 * the real URL (e.g. `/sermons/abc`) while the Next router context is `/~offline` —
 * so `useParams()` has no `id` there. In that case we read the id from
 * `window.location.pathname` (which IS `/sermons/abc`), letting a deep-linked detail
 * page render offline from the Firestore cache without refactoring the page body.
 *
 * Returns '' when no id can be resolved (e.g. SSR) — callers already guard their data
 * hooks on a falsy id.
 */
export function useRouteId(): string {
  const params = useParams<{ id?: string }>();
  if (params?.id) return params.id;
  if (typeof window !== 'undefined') {
    const segments = window.location.pathname.split('/').filter(Boolean);
    if (segments.length >= 2) return segments[1];
  }
  return '';
}
