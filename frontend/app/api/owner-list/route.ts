import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { adminDb } from '@/config/firebaseAdminConfig';

/**
 * ONE DOOR TO THE OWNER'S OWN LISTS — the second road, for every list at once.
 *
 * The browser normally reads Firestore itself. On one of the owner's devices that transport
 * returns nothing at all: `getDocs` neither resolves nor throws, and a screen waiting on it
 * waits for ever. Measured 2026-09-06 from that iPad — zero server snapshots from the SDK while
 * the app's own HTTPS read answered in 205 ms.
 *
 * A road per feature would mean the same rule — verify the caller, filter by the caller — written
 * out five times, and the fifth copy is where it eventually differs. So the rule is written once
 * and the collections it may be used for are named here, in one list. Anything not on that list
 * is refused, because a route that reads "whatever the caller names" is a route that reads
 * everything.
 */

/**
 * Collections whose documents belong to one person and carry `userId`. A collection is added
 * here only when both are true: the whole document is that person's, and nothing in it is
 * shared with another account.
 */
const OWNER_COLLECTIONS = new Set([
  'sermons',
  'prayerRequests',
  'planTemplates',
  'serviceOrders',
]);

/**
 * Read in pages, and never hand back a HALF list.
 *
 * The browser's own query has no limit, so a limit here would quietly lose documents: a sermon
 * past the cap simply would not exist on the device that needed this road — and the calendar,
 * which filters by date after reading, would drop it without a word. So the pages are followed
 * to the end, and the only thing the ceiling does is refuse: a list this long is a fault to
 * report, not a list to silently shorten.
 */
const PAGE_SIZE = 500;
const MAX_DOCUMENTS = 5000;

export async function GET(request: Request) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const collection = new URL(request.url).searchParams.get('collection') ?? '';
    if (!OWNER_COLLECTIONS.has(collection)) {
      return NextResponse.json({ error: 'Unknown collection' }, { status: 400 });
    }

    const documents: Record<string, unknown>[] = [];
    let after: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      let page = adminDb
        .collection(collection)
        .where('userId', '==', uid)
        // Ordered so the pages are a sequence and not an arbitrary redraw between requests.
        .orderBy('__name__')
        .limit(PAGE_SIZE);
      if (after) page = page.startAfter(after);
      const snapshot = await page.get();
      snapshot.docs.forEach((doc) => documents.push({ ...doc.data(), id: doc.id }));
      if (snapshot.size < PAGE_SIZE) break;
      if (documents.length >= MAX_DOCUMENTS) {
        return NextResponse.json({ error: 'List too large to read this way' }, { status: 507 });
      }
      after = snapshot.docs[snapshot.docs.length - 1];
    }
    return NextResponse.json(documents, {
      // A read taken to prove what the server holds must not be answered by something in between.
      headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' },
    });
  } catch (error) {
    console.error('Error reading owner list:', error);
    return NextResponse.json({ error: 'Failed to read list' }, { status: 500 });
  }
}
