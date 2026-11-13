/**
 * WHO the cached data belongs to is part of its identity.
 *
 * React Query's cache is persisted to IndexedDB and survives sign-out, so a key
 * that names only the document is shared by every account that ever used this
 * browser. Reproduced live 2026-07-25 on a shared computer: signed out of account
 * A, signed in as B, opened A's sermon by direct link — A's title, date and verse
 * rendered from the local cache while the server correctly answered 401. Firestore
 * rules cannot help here; they gate the SERVER, not a copy already on the machine.
 *
 * The lists were already owner-scoped (`['sermons', uid]`); the detail was not.
 * Keys are defined here once, so two copies of one key cannot drift apart again.
 *
 * The other layer is accountQueryCache: each resolved account restores its own
 * persisted client, and QueryProvider remounts that lifetime on an identity change.
 * Older device copies are preserved or moved through canonical migration, never
 * globally cleared on sign-out.
 */

import { auth } from '@services/firebaseAuth.service';

/**
 * `uid` may be undefined while auth is still resolving: callers need a STABLE key for that
 * state too, and spelling one inline is how two copies of a key start to drift.
 */
export const sermonListKey = (uid: string | undefined) => ['sermons', uid] as const;

/** The SDK owns action-time identity; an obsolete browser mirror cannot resurrect a signed-out owner. */
export function resolveOwnerUid(): string | undefined {
  return auth.currentUser?.uid;
}
