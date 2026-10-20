'use client';

import { User, onAuthStateChanged } from 'firebase/auth';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { auth } from '@/services/firebaseAuth.service';
import { recordLastSeen } from '@/services/lastSeen.client';
import { claimPendingReferral } from '@/services/referral.client';
import { debugLog } from '@/utils/debugMode';
import { forgetServerAvailability } from '@/utils/serverAvailability';
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
    // Firebase's listener is the single source of both identity and restoration readiness. A genuine
    // guest is an anonymous Firebase user, restored by the same existing persistence. Routes and React
    // readers use this context; action-time ownership uses the SDK currentUser. Neither reads a
    // browser-storage mirror (BUG-20260810-auth-mirrors-in-localstorage).
    // Every tab hears identity changes through Firebase. Dismiss recovery messages from the prior
    // account so its text cannot remain on screen for the next person.
    let previousUid: string | null | undefined;

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const nextUid = firebaseUser?.uid ?? null;
      if (previousUid !== undefined && previousUid !== nextUid) {
        // Recovery messages hold text that must not outlive the person who wrote it,
        // and the record of "already reported" must not silence the next session.
        toast.dismiss();
        forgetReportedFailures();
        forgetServerAvailability();
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
