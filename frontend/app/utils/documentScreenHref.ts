import { getBookById } from './bibleBooks';
import { bibleHref } from './bibleLink';
import { marksDocumentId } from './bibleMarksIdentity';
import { isBibleId } from './bibles';

import type { DocumentData, ResourceRef } from '@/data-engine/types';

/**
 * THE SCREEN THAT OWNS A DOCUMENT'S DRAFT — where a refusal or a conflict of that draft is decided.
 *
 * The app-wide banner points there instead of deciding itself: two places settling one draft is
 * how an answer gets taken twice (BUG-20260813-late-refusal-silent-after-navigation). Null for a
 * collection with no screen of its own; the banner then still shows the text for copying.
 */
export function documentScreenHref(resource: ResourceRef, value?: DocumentData | null): string | null {
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
    case 'planTemplates': return `/settings/templates?template=${id}`;
    case 'occasionPlaces':
      return value && typeof value.occasionId === 'string' && value.occasionId ? `/care/word/${encodeURIComponent(value.occasionId)}` : '/care/word';
    case 'hardQuestionThemes': return `/care/questions/${id}`;
    // A question lives under its theme (`none` without one); a theme that is gone sends the page on to `none` itself.
    case 'hardQuestions':
      return `/care/questions/${value && typeof value.themeId === 'string' && value.themeId ? encodeURIComponent(value.themeId) : 'none'}/${id}`;
    case 'bibleMarks':
      if (!value || typeof value.userId !== 'string' || !isBibleId(value.bible)
        || typeof value.book !== 'string' || !getBookById(value.book)
        || resource.id !== marksDocumentId(value.userId, value.bible, value.book)) return null;
      return bibleHref({ book: value.book, bible: value.bible }, { locale: 'en', readingBible: value.bible });
    default: return null;
  }
}

/** Whether the person is on that screen now (or on one of its sub-screens, such as a sermon's plan). */
export function isOnDocumentScreen(pathname: string | null | undefined, resource: ResourceRef, value?: DocumentData | null, search = ''): boolean {
  const href = documentScreenHref(resource, value)?.split('?')[0];
  if (!href || !pathname) return false;
  if (resource.collection === 'bibleMarks') {
    const query = new URLSearchParams(search);
    const target = new URLSearchParams(documentScreenHref(resource, value)!.split('?')[1]);
    return pathname === href && query.get('book') === target.get('book')
      && (!query.has('read') || query.get('read') === target.get('read'));
  }
  // A question's screen is known by the question's own id, whatever theme segment the address carries
  // (the copy in hand may name a theme the page has already moved it out of).
  if (resource.collection === 'hardQuestions') {
    const segments = pathname.split('/').filter(Boolean);
    let id = segments[3] ?? '';
    try { id = decodeURIComponent(id); } catch { /* a broken escape names no question */ }
    return segments.length === 4 && segments[0] === 'care' && segments[1] === 'questions' && id === resource.id;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
