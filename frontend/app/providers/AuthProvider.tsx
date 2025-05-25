'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/services/firebaseAuth.service';

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

  useEffect(() => {
    let isMounted = true;
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (isMounted) {
        setUser(currentUser);
        setLoading(false);
      }
    });

    // Check for guest user in localStorage
    if (!user && !loading) {
      const guestData = localStorage.getItem('guestUser');
      if (guestData) {
        try {
          const guestUser = JSON.parse(guestData);
          setUser(guestUser);
        } catch (error) {
          console.error('Error parsing guest user data:', error);
          localStorage.removeItem('guestUser');
        }
      }
    }

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const isAuthenticated = Boolean(user || localStorage.getItem('guestUser'));

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