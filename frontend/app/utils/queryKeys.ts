import { auth } from '@services/firebaseAuth.service';

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
 * This keeps one definition so the two cannot drift apart again.
 *
 * NOTE this is one layer, not the whole fix: the IndexedDB persister still uses a
 * single store for all accounts. Splitting that store is the other half and is
 * tracked separately.
 */
export const sermonDetailKey = (uid: string | undefined, sermonId: string) =>
  ['sermon', uid ?? 'unresolved-owner', sermonId] as const;

/**
 * `uid` may be undefined while auth is still resolving: callers need a STABLE key for that
 * state too, and spelling one inline is how two copies of a key start to drift.
 */
export const sermonListKey = (uid: string | undefined) => ['sermons', uid] as const;

/**
 * The study-note list, owner-scoped like the sermon list.
 *
 * It lives here rather than inside `useStudyNotes` because a SECOND reader now shares the
 * same cache entry: the sermon screen resolves the titles of the notes it was built on, and
 * the note screen derives which sermons point back at it. Two hooks holding two spellings of
 * the same key would each fetch their own copy and then disagree about what is on the disk.
 */
export const studyNoteListKey = (uid: string | undefined) => ['study-notes', uid] as const;

/**
 * The owner of whatever is on screen right now: the signed-in user, or the guest
 * identity kept in localStorage. Undefined while auth is still resolving — callers
 * get a distinct key for that state rather than silently sharing one.
 */
export function resolveOwnerUid(): string | undefined {
  const currentUser = auth.currentUser;
  if (currentUser?.uid) {
    return currentUser.uid;
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const guestData = window.localStorage.getItem('guestUser');
    if (!guestData) {
      return undefined;
    }

    const parsed = JSON.parse(guestData) as { uid?: string };
    return parsed.uid;
  } catch (error) {
    console.error('Error parsing guestUser from localStorage', error);
    return undefined;
  }
}
