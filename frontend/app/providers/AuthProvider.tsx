'use client';

import { User, onAuthStateChanged, IdTokenResult } from 'firebase/auth';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

import { auth } from '@/services/firebaseAuth.service';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
}

interface StoredAuthData {
  uid: string;
  email: string | null;
  displayName: string | null;
  isAnonymous: boolean;
  metadata: {
    creationTime?: string;
    lastSignInTime?: string;
  };
  timestamp: number;
}

// Type for restored user (minimal set of properties)
type RestoredUser = Pick<User, 'uid' | 'email' | 'displayName' | 'isAnonymous' | 'metadata'> & {
  // Add missing properties with default values
  emailVerified: false;
  providerData: [];
  refreshToken: '';
  tenantId: null;
  delete: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  getIdTokenResult: (forceRefresh?: boolean) => Promise<IdTokenResult>;
  reload: () => Promise<void>;
  toJSON: () => object;
  phoneNumber: null;
  photoURL: null;
  providerId: 'firebase';
};

// Local storage keys
const STORAGE_KEYS = {
  FIREBASE_AUTH_USER: 'firebase:authUser',
} as const;

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
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Function to create restored user object
  const createRestoredUser = useCallback((authData: StoredAuthData): RestoredUser => {
    return {
      uid: authData.uid,
      email: authData.email,
      displayName: authData.displayName,
      isAnonymous: authData.isAnonymous,
      metadata: authData.metadata,
      emailVerified: false,
      providerData: [],
      refreshToken: '',
      tenantId: null,
      delete: async () => { throw new Error('Cannot delete restored user'); },
      getIdToken: async () => { throw new Error('Cannot get ID token for restored user'); },
      getIdTokenResult: async () => { throw new Error('Cannot get ID token result for restored user'); },
      reload: async () => { throw new Error('Cannot reload restored user'); },
      toJSON: () => ({ uid: authData.uid }),
      phoneNumber: null,
      photoURL: null,
      providerId: 'firebase',
    };
  }, []);

  // Function to sync authentication state
  const syncAuthState = useCallback((currentUser: User | null) => {
    if (typeof window === 'undefined') return;

    try {
      if (currentUser) {
        const authData: StoredAuthData = {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          isAnonymous: currentUser.isAnonymous,
          metadata: {
            creationTime: currentUser.metadata.creationTime,
            lastSignInTime: currentUser.metadata.lastSignInTime,
          },
          timestamp: Date.now(),
        };
        
        localStorage.setItem(STORAGE_KEYS.FIREBASE_AUTH_USER, JSON.stringify(authData));
      } else {
        localStorage.removeItem(STORAGE_KEYS.FIREBASE_AUTH_USER);
      }
    } catch (error) {
      console.error('Error syncing auth state:', error);
    }
  }, []);

  // Function to handle localStorage changes from other tabs
  const handleStorageChange = useCallback((e: StorageEvent) => {
    if (e.key !== STORAGE_KEYS.FIREBASE_AUTH_USER) return;

    try {
      if (e.newValue) {
        const authData: StoredAuthData = JSON.parse(e.newValue);
        const isDataFresh = Date.now() - authData.timestamp < 5000; // 5 seconds

        if (isDataFresh && !user) {
          console.log('Syncing auth state from other tab:', authData.uid);
          // Create object with minimal properties for restoration
          const restoredUser = createRestoredUser(authData);
          setUser(restoredUser as User);
          setIsAuthenticated(true);
        }
      } else {
        console.log('Auth state cleared in other tab');
        // Check current Firebase state
        if (user && !auth.currentUser) {
          setUser(null);
          setIsAuthenticated(false);
        }
      }
    } catch (error) {
      console.error('Error parsing auth data from storage:', error);
    }
  }, [user, createRestoredUser]);

  // Function to restore authentication state from localStorage
  const restoreAuthState = useCallback(() => {
    if (typeof window === 'undefined') return false;

    try {
      // Check for guest user
      const guestData = localStorage.getItem('guestUser');
      if (guestData) {
        const guestUser = JSON.parse(guestData);
        console.log('Restored guest user:', guestUser.uid);
        setUser(guestUser);
        setIsAuthenticated(true);
        return true;
      }

      // Check saved Firebase state
      const firebaseAuthData = localStorage.getItem(STORAGE_KEYS.FIREBASE_AUTH_USER);
      if (firebaseAuthData) {
        const authData: StoredAuthData = JSON.parse(firebaseAuthData);
        const isDataValid = Date.now() - authData.timestamp < 60000; // 1 minute

        if (isDataValid) {
          console.log('Restored Firebase auth state:', authData.uid);
          const restoredUser = createRestoredUser(authData);
          setUser(restoredUser as User);
          setIsAuthenticated(true);
          return true;
        } else {
          console.log('Firebase auth data expired, removing');
          localStorage.removeItem(STORAGE_KEYS.FIREBASE_AUTH_USER);
        }
      }

      return false;
    } catch (error) {
      console.error('Error restoring auth state:', error);
      return false;
    }
  }, [createRestoredUser]);

  useEffect(() => {
    let isMounted = true;

    // Subscribe to Firebase authentication state changes
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!isMounted) return;

      console.log('Firebase auth state changed:', currentUser ? `User: ${currentUser.uid}` : 'No user');
      
      setUser(currentUser);
      setIsAuthenticated(Boolean(currentUser));
      setLoading(false);
      
      // Sync state
      syncAuthState(currentUser);
    });

    // Restore authentication state on initialization
    if (!user && !loading) {
      restoreAuthState();
    }

    // Listen for localStorage changes from other tabs
    window.addEventListener('storage', handleStorageChange);

    return () => {
      isMounted = false;
      unsubscribe();
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [syncAuthState, handleStorageChange, restoreAuthState, createRestoredUser, user, loading]);

  // Update authentication status when user changes
  useEffect(() => {
    const hasGuestUser = typeof window !== 'undefined' ? localStorage.getItem('guestUser') : null;
    setIsAuthenticated(Boolean(user || hasGuestUser));
  }, [user]);

  return (
    <AuthContext.Provider 
      value={{ 
        user, 
        loading, 
        isAuthenticated
      }}
    >
      {children}
    </AuthContext.Provider>
  );
} 