'use client';

import { useEffect } from "react";

import { auth, logOut, checkGuestExpiration } from "@services/firebaseAuth.service";

/**
 * Signs out a guest whose five days are over. It renders nothing: the guest banner it once drew
 * was never switched on (its flag stayed `false`), and its Russian-only words were removed with it
 * (BUG-20261011-spiritual-step-hardcoded-russian, class sweep).
 */
export function GuestBanner() {
  useEffect(() => {
    const user = auth.currentUser;
    if (user?.isAnonymous && !checkGuestExpiration(user)) {
      localStorage.removeItem('guestUser');
      // Through logOut, never `auth.signOut()` directly: signing out has to clear the
      // recovery messages too, and those hold text — a sermon title, a prayer answer —
      // that must not be waiting on screen for whoever uses this browser next.
      void logOut();
    }
  }, []);

  return null;
}
