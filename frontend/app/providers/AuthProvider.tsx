'use client';

import { User, onAuthStateChanged } from 'firebase/auth';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { auth } from '@/services/firebaseAuth.service';
import { recordLastSeen } from '@/services/lastSeen.client';
import { claimPendingReferral } from '@/services/referral.client';
import { debugLog } from '@/utils/debugMode';
import { forgetReportedFailures } from '@/utils/writeRecovery';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAuthenticated: false,
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const referralClaimInFlight = useRef(false);

  useEffect(() => {
    // Firebase's onAuthStateChanged + browserLocalPersistence is the SINGLE
    // source of truth and already synchronises auth across tabs natively.
    //
    // We deliberately do NOT mirror auth into a custom localStorage key, and we
    // do NOT fall back to a cached `guestUser` here:
    //  - The old custom mirror cleared a valid session in one tab whenever
    //    another tab emitted a transient `null` (cold start / token refresh),
    //    collapsing client-SDK lists (gated on `enabled: !!uid`) to empty and
    //    throwing permission-denied on `users/{uid}` reads.
    //  - A `?? readGuestUser()` fallback would resurrect a phantom user on
    //    sign-out: Firebase notifies this listener with `null` BEFORE logOut()'s
    //    caller removes the `guestUser` cache (handleLogout in hooks/useAuth.ts),
    //    so the stale cache would re-authenticate the just-logged-out user.
    //
    // A genuine guest is an anonymous Firebase user, so it arrives here as a
    // non-null `firebaseUser` via Firebase's own persistence; route guards and
    // the uid hooks read the `guestUser` cache directly where they need it.
    // WHO the tab currently belongs to, so a CHANGE can be noticed. Firebase notifies
    // every open tab, but only the tab that ran `logOut()` cleared its recovery
    // messages — the others kept the previous account's text on screen, with a copy
    // button, for whoever signed in next.
    let previousUid: string | null | undefined;

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const nextUid = firebaseUser?.uid ?? null;
      if (previousUid !== undefined && previousUid !== nextUid) {
        // Recovery messages hold text that must not outlive the person who wrote it,
        // and the record of "already reported" must not silence the next session.
        toast.dismiss();
        forgetReportedFailures();
      }
      previousUid = nextUid;

      setUser(firebaseUser);
      setLoading(false);
      debugLog('Firebase auth state changed:', firebaseUser ? `User: ${firebaseUser.uid}` : 'No user');

      if (firebaseUser) {
        recordLastSeen(firebaseUser.uid);
        if (!referralClaimInFlight.current) {
          referralClaimInFlight.current = true;
          void claimPendingReferral(firebaseUser).finally(() => {
            referralClaimInFlight.current = false;
          });
        }
      }
    });

    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isAuthenticated: Boolean(user) }}>
      {children}
    </AuthContext.Provider>
  );
}
