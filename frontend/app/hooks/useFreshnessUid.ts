'use client';

import { useAuth } from '@/providers/AuthProvider';

/**
 * Whose listener is this, really?
 *
 * The freshness listener used to be keyed by the owner stored ON THE CACHED
 * DOCUMENT. That looks equivalent and is not: after a logout (or a switch to
 * another account on a shared computer) the cached entity still carries the old
 * owner, so the prop never changes, the effect never cleans up, and the listener
 * keeps running for a person who is no longer signed in. Firestore rules would
 * eventually kill it, but by then the screen has quietly slid into "cannot tell".
 *
 * Keying by the CURRENT signed-in user fixes the lifecycle — a sign-out changes
 * the value and detaches the listener. Requiring the document's owner to match is
 * the second half: a foreign document left in the cache gets no listener at all
 * instead of one that is guaranteed to fail.
 */
export function useFreshnessUid(documentOwnerId: string | null | undefined): string | null {
  const { user } = useAuth();
  const authUid = user?.uid ?? null;
  if (!authUid || !documentOwnerId) return null;
  return documentOwnerId === authUid ? authUid : null;
}
