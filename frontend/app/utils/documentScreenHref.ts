import type { ResourceRef } from '@/data-engine/types';

/**
 * THE SCREEN THAT OWNS A DOCUMENT'S DRAFT — where a refusal or a conflict of that draft is decided.
 *
 * The app-wide banner points there instead of deciding itself: two places settling one draft is
 * how an answer gets taken twice (BUG-20260813-late-refusal-silent-after-navigation). Null for a
 * collection with no screen of its own; the banner then still shows the text for copying.
 */
export function documentScreenHref(resource: ResourceRef): string | null {
  const id = encodeURIComponent(resource.id);
  switch (resource.collection) {
    case 'sermons': return `/sermons/${id}`;
    case 'groups': return `/groups/${id}`;
    case 'series': return `/series/${id}`;
    case 'councils': return `/care/council/${id}`;
    case 'serviceOrders': return `/care/orders/${id}`;
    case 'prayerRequests': return `/prayers/${id}`;
    case 'studyNotes': return `/studies/${id}`;
    case 'users': return '/settings';
    default: return null;
  }
}

/** Whether the person is on that screen now (or on one of its sub-screens, such as a sermon's plan). */
export function isOnDocumentScreen(pathname: string | null | undefined, resource: ResourceRef): boolean {
  const href = documentScreenHref(resource);
  if (!href || !pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
