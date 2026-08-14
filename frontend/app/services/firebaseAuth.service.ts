import {
  getAuth,
  initializeAuth,
  GoogleAuthProvider,
  signInWithPopup,
  User,
  signOut,
  signInAnonymously,
  browserLocalPersistence,
  browserPopupRedirectResolver,
} from "firebase/auth";
import { toast } from "sonner";

import app from "@/config/firebaseConfig";
import { forgetReportedFailures } from "@/utils/writeRecovery";
import { updateUserProfile } from "@services/userSettings.service";
const GUEST_EXPIRATION_DAYS = 5;

/**
 * PERSISTENCE IS CHOSEN AT CREATION, NEVER MIGRATED AFTERWARDS.
 *
 * This used to be `getAuth(app)` followed by a fire-and-forget
 * `setPersistence(auth, browserLocalPersistence)`. That is two steps, and the gap
 * between them was the bug: `getAuth` picks IndexedDB when it is available and
 * moves the signed-in user there, then our call moved them back to localStorage —
 * DELETING the persistence record before writing the new one.
 *
 * Another tab watching that storage sees the record disappear and reads it as
 * "the user changed": it drops the identity, Firestore then sends requests with no
 * identity at all and the rules answer "missing or insufficient permissions". The
 * SDK does not refresh the token after that, because permission-denied counts as a
 * permanent failure — so the tab stays broken until it is fully closed. Reloading
 * repeats the same migration and does not help. Meanwhile ProtectedRoute, which
 * looks for Firebase's own `firebase:authUser:` key in localStorage, sees nothing
 * during the gap and bounces the other tab back to the landing page.
 *
 * `initializeAuth` sets the persistence up front, so the record is written once and
 * never removed. It must run before anything else touches auth on this app
 * instance; the fallback keeps a stray earlier `getAuth` from breaking sign-in.
 *
 * localStorage is deliberate, not incidental: ProtectedRoute depends on that key
 * (see ProtectedRoute.tsx). Moving persistence to IndexedDB would silently start
 * redirecting signed-in people to the landing page.
 *
 * `popupRedirectResolver` must be passed explicitly here — unlike `getAuth`,
 * `initializeAuth` does not install one, and `signInWithPopup` would fail without it.
 */
function createAuth() {
  // No browser storage during SSR — fall back to the default in-memory instance.
  if (typeof window === "undefined") return getAuth(app);
  try {
    return initializeAuth(app, {
      persistence: browserLocalPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    // Something already initialised auth on this app instance. Losing sign-in
    // entirely would be worse than losing the guarantee, so take what exists.
    return getAuth(app);
  }
}

export const auth = createAuth();
const provider = new GoogleAuthProvider();

export const checkGuestExpiration = (user: User): boolean => {
  if (!user.isAnonymous) return true;

  const creationTime = new Date(user.metadata.creationTime!).getTime();
  const expirationTime = creationTime + GUEST_EXPIRATION_DAYS * 86400 * 1000;
  return Date.now() < expirationTime;
};

export const signInWithGoogle = async (): Promise<User | null> => {
  try {
    console.log('Starting Google sign-in...');
    
    // Check Firebase configuration
    if (!process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) {
      throw new Error('Firebase auth domain not configured');
    }
    
    const result = await signInWithPopup(auth, provider);
    console.log("User signed in:", result.user.uid);

    // Store user email and displayName without affecting language settings
    await updateUserProfile(
      result.user.uid,
      result.user.email || undefined,
      result.user.displayName || undefined
    );

    return result.user;
  } catch (error) {
    console.error("Error signing in with Google:", error);
    
    // Check for specific errors
    if (error instanceof Error) {
      if (error.message.includes('popup-closed')) {
        throw new Error('Sign-in popup was closed');
      } else if (error.message.includes('popup-blocked')) {
        throw new Error('Sign-in popup was blocked by browser');
      } else if (error.message.includes('network')) {
        throw new Error('Network error during sign-in');
      }
    }
    
    throw error;
  }
};

export const signInAsGuest = async (): Promise<User | null> => {
  try {
    console.log('Starting guest sign-in...');
    
    const result = await signInAnonymously(auth);
    console.log("Guest user signed in:", result.user.uid);
    
    localStorage.setItem(
      "guestUser",
      JSON.stringify({
        ...result.user,
        creationTime: new Date().toISOString(),
      })
    );

    // Store anonymous user information with placeholder email and name
    // without affecting language settings
    await updateUserProfile(
      result.user.uid,
      `guest-${result.user.uid.substring(0, 6)}@guest.local`, // placeholder email
      `Guest User ${result.user.uid.substring(0, 6)}` // placeholder name
    );

    return result.user;
  } catch (error) {
    console.error("Error signing in as guest:", error);
    toast.error("Guest sign-in error");
    throw error;
  }
};

export const logOut = async (): Promise<void> => {
  try {
    await signOut(auth);
    /**
     * Recovery messages live until dismissed — that is deliberate, because they hold
     * text a person must not lose. But they must not OUTLIVE the person: a refusal
     * toast carrying someone's sermon title, prayer answer or note, with a "copy my
     * text" button, stayed on screen through a sign-out and was there for whoever
     * signed in next.
     */
    toast.dismiss();
    // …and forget that those refusals were ever announced, so signing back in shows
    // them again rather than treating them as handled.
    forgetReportedFailures();
  } catch (error) {
    console.error("Error logging out:", error);
    throw error;
  }
};
